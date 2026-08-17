'use strict';

const fs = require('node:fs');
const path = require('node:path');
const A = require('../analysis-engine.js');
const config = require('./config.js');

const DATA_DIR = path.join(__dirname, 'data');
const RESULT_DIR = path.join(__dirname, 'results');

function loadData() {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('고정 데이터가 없습니다. 먼저 node backtest/fetch-snapshot.js 를 실행하세요.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sets = manifest.files.map(item => ({
    symbol: item.symbol,
    rows: JSON.parse(fs.readFileSync(path.join(DATA_DIR, item.file), 'utf8'))
  }));
  return { manifest, sets };
}

function fillPrice(rawPrice, direction, side, slippageRate) {
  // LONG 진입과 SHORT 청산은 매수, SHORT 진입과 LONG 청산은 매도입니다.
  const isBuy = (direction === 'LONG' && side === 'ENTRY') || (direction === 'SHORT' && side === 'EXIT');
  return rawPrice * (isBuy ? 1 + slippageRate : 1 - slippageRate);
}

function resolveTrade(rows, entryIndex, direction, atrAtSignal, settings = config) {
  const entryCandle = rows[entryIndex];
  if (!entryCandle || !(atrAtSignal > 0)) return null;
  const entry = fillPrice(entryCandle.open, direction, 'ENTRY', settings.slippageRatePerSide);
  const risk = atrAtSignal * settings.stopAtr;
  const isLong = direction === 'LONG';
  const stop = isLong ? entry - risk : entry + risk;
  const target = isLong ? entry + risk * settings.targetR : entry - risk * settings.targetR;
  const lastIndex = Math.min(rows.length - 1, entryIndex + settings.maxHoldBars - 1);
  let exitIndex = lastIndex;
  let rawExit = rows[lastIndex].close;
  let outcome = 'TIME';

  for (let index = entryIndex; index <= lastIndex; index += 1) {
    const candle = rows[index];
    const stopHit = isLong ? candle.low <= stop : candle.high >= stop;
    const targetHit = isLong ? candle.high >= target : candle.low <= target;
    if (stopHit) {
      // 같은 봉에서 둘 다 닿은 경우 봉 내부 순서를 알 수 없으므로 손절을 우선합니다.
      exitIndex = index;
      rawExit = stop;
      outcome = 'STOP';
      break;
    }
    if (targetHit) {
      exitIndex = index;
      rawExit = target;
      outcome = 'TARGET';
      break;
    }
  }

  const exit = fillPrice(rawExit, direction, 'EXIT', settings.slippageRatePerSide);
  const gross = isLong ? exit - entry : entry - exit;
  const fees = (entry + exit) * settings.feeRatePerSide;
  const netR = (gross - fees) / risk;
  return {
    entryIndex, exitIndex, direction, outcome, entry, exit, stop, target, risk, fees, netR,
    entryTime: entryCandle.time,
    exitTime: rows[exitIndex].time
  };
}

function simulateSymbol(symbol, rows, threshold, settings = config) {
  const trades = [];
  let previousRegime = 'WAIT';

  for (let decisionIndex = settings.warmupBars - 1; decisionIndex < rows.length - 1; decisionIndex += 1) {
    const history = rows.slice(0, decisionIndex + 1);
    const signal = A.compositeSignal(history);
    if (!signal.ready) continue;
    const regime = signal.score >= threshold ? 'LONG'
      : signal.score <= -threshold ? 'SHORT'
      : 'WAIT';

    if (regime === 'WAIT') {
      previousRegime = 'WAIT';
      continue;
    }
    if (regime === previousRegime) continue;
    previousRegime = regime;

    const trade = resolveTrade(rows, decisionIndex + 1, regime, signal.diagnostics.atr, settings);
    if (!trade) continue;
    trades.push({
      ...trade,
      symbol,
      threshold,
      signalTime: rows[decisionIndex].time,
      signalScore: signal.score,
      axes: signal.axes
    });
    // 포지션 보유 중에는 새 신호를 겹쳐 잡지 않습니다.
    decisionIndex = trade.exitIndex;
  }
  return trades;
}

function metrics(trades, minimumSample = config.minimumSample) {
  const ordered = [...trades].sort((a, b) => a.exitTime - b.exitTime || a.symbol.localeCompare(b.symbol));
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let wins = 0;
  for (const trade of ordered) {
    equityR += trade.netR;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
    if (trade.netR > 0) wins += 1;
  }
  const count = ordered.length;
  return {
    sample: count,
    status: count >= minimumSample ? '검증 표본 충족' : '표본 부족',
    winRate: count ? wins / count : null,
    averageR: count ? equityR / count : null,
    totalR: equityR,
    maxDrawdownR
  };
}

function chooseThreshold(tradesByThreshold, predicate, minimumSample) {
  const candidates = [...tradesByThreshold.entries()].map(([threshold, trades]) => ({
    threshold,
    result: metrics(trades.filter(predicate), minimumSample)
  })).filter(item => item.result.sample >= minimumSample);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.result.averageR - a.result.averageR || b.result.sample - a.result.sample)[0];
}

function walkForward(tradesByThreshold, sets, settings = config) {
  const allTimes = sets.flatMap(set => set.rows.map(row => row.time)).sort((a, b) => a - b);
  const uniqueTimes = [...new Set(allTimes)];
  const startIndex = Math.floor(uniqueTimes.length * 0.4);
  const step = Math.max(1, Math.floor((uniqueTimes.length - startIndex) / settings.walkForwardFolds));
  const folds = [];
  let combined = [];

  for (let fold = 0; fold < settings.walkForwardFolds; fold += 1) {
    const trainEnd = uniqueTimes[startIndex + fold * step];
    const testEnd = uniqueTimes[Math.min(uniqueTimes.length - 1, startIndex + (fold + 1) * step)];
    if (!trainEnd || !testEnd || testEnd <= trainEnd) continue;
    const selected = chooseThreshold(
      tradesByThreshold,
      trade => trade.exitTime < trainEnd,
      settings.minimumSample
    );
    if (!selected) {
      folds.push({ fold: fold + 1, trainEnd, testEnd, status: '학습 표본 부족' });
      continue;
    }
    const testTrades = tradesByThreshold.get(selected.threshold)
      .filter(trade => trade.signalTime >= trainEnd && trade.exitTime < testEnd);
    combined = combined.concat(testTrades);
    folds.push({
      fold: fold + 1,
      trainEndUtc: new Date(trainEnd * 1000).toISOString(),
      testEndUtc: new Date(testEnd * 1000).toISOString(),
      threshold: selected.threshold,
      train: selected.result,
      test: metrics(testTrades, settings.minimumSample)
    });
  }
  return { folds, combined: metrics(combined, settings.minimumSample) };
}

function symbolHoldout(tradesByThreshold, symbols, settings = config) {
  const rows = [];
  let combined = [];
  for (const heldOutSymbol of symbols) {
    const selected = chooseThreshold(
      tradesByThreshold,
      trade => trade.symbol !== heldOutSymbol,
      settings.minimumSample
    );
    if (!selected) {
      rows.push({ symbol: heldOutSymbol, status: '학습 표본 부족' });
      continue;
    }
    const testTrades = tradesByThreshold.get(selected.threshold)
      .filter(trade => trade.symbol === heldOutSymbol);
    combined = combined.concat(testTrades);
    rows.push({
      symbol: heldOutSymbol,
      threshold: selected.threshold,
      train: selected.result,
      test: metrics(testTrades, settings.minimumSample)
    });
  }
  return { symbols: rows, combined: metrics(combined, settings.minimumSample) };
}

function percent(value) {
  return value === null ? '데이터 없음' : `${(value * 100).toFixed(1)}%`;
}

function number(value, suffix = '') {
  return value === null ? '데이터 없음' : `${value.toFixed(3)}${suffix}`;
}

function markdownReport(report) {
  const lines = [
    '# 4축 합성 신호 백테스트 결과', '',
    `생성 시각(UTC): ${report.generatedAtUtc}`,
    `데이터: ${report.data.source}`,
    `스냅샷 생성 시각(UTC): ${report.data.fetchedAtUtc}`,
    `기간: ${report.data.requestedRange.startUtc} ~ ${report.data.requestedRange.endExclusiveUtc} 미만`,
    `대상: ${report.data.files.map(file => file.symbol).join(', ')}`, '',
    '## 체결 가정', '',
    `- 신호: 일봉 확정 종가에서 계산, 미래 봉 미사용`,
    `- 진입: 다음 일봉 시가`,
    `- 손절: ${report.assumptions.stopAtr} ATR, 목표: ${report.assumptions.targetR}R, 최대 보유: ${report.assumptions.maxHoldBars}봉`,
    `- 수수료: 편도 ${(report.assumptions.feeRatePerSide * 100).toFixed(3)}%, 슬리피지: 편도 ${(report.assumptions.slippageRatePerSide * 100).toFixed(3)}%`,
    `- 동일 봉 손절·익절 동시 도달: 손절 우선`, '',
    '## 워크포워드 아웃샘플', '',
    `- 표본: ${report.walkForward.combined.sample} (${report.walkForward.combined.status})`,
    `- 승률: ${percent(report.walkForward.combined.winRate)}`,
    `- 평균 기대값: ${number(report.walkForward.combined.averageR, 'R')}`,
    `- 최대 낙폭: ${number(report.walkForward.combined.maxDrawdownR, 'R')}`, '',
    '## 종목 홀드아웃', '',
    `- 표본: ${report.symbolHoldout.combined.sample} (${report.symbolHoldout.combined.status})`,
    `- 승률: ${percent(report.symbolHoldout.combined.winRate)}`,
    `- 평균 기대값: ${number(report.symbolHoldout.combined.averageR, 'R')}`,
    `- 최대 낙폭: ${number(report.symbolHoldout.combined.maxDrawdownR, 'R')}`, '',
    '## 해석 제한', '',
    '- 이 결과는 고정 스냅샷과 명시된 비용 가정에만 해당합니다.',
    '- 표본 충족은 수익 보장이나 통계적 유의성을 뜻하지 않습니다.',
    '- 펀딩비, 시장 충격, 호가 공백, 주문 거절은 모델에 포함되지 않았습니다.'
  ];
  return `${lines.join('\n')}\n`;
}

function main() {
  const { manifest, sets } = loadData();
  const tradesByThreshold = new Map();
  for (const threshold of config.thresholdCandidates) {
    let trades = [];
    for (const set of sets) trades = trades.concat(simulateSymbol(set.symbol, set.rows, threshold));
    tradesByThreshold.set(threshold, trades);
    const result = metrics(trades);
    console.log(`임계값 ${threshold.toFixed(2)}: ${result.sample}건 · 승률 ${percent(result.winRate)} · 평균 ${number(result.averageR, 'R')}`);
  }

  const walkForwardResult = walkForward(tradesByThreshold, sets);
  const holdoutResult = symbolHoldout(tradesByThreshold, sets.map(set => set.symbol));
  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    engine: 'analysis-engine.js / compositeSignal',
    data: manifest,
    assumptions: {
      warmupBars: config.warmupBars,
      maxHoldBars: config.maxHoldBars,
      stopAtr: config.stopAtr,
      targetR: config.targetR,
      feeRatePerSide: config.feeRatePerSide,
      slippageRatePerSide: config.slippageRatePerSide,
      sameBarPriority: 'STOP',
      entryTiming: 'NEXT_BAR_OPEN',
      minimumSample: config.minimumSample,
      thresholdCandidates: config.thresholdCandidates
    },
    allThresholds: Object.fromEntries([...tradesByThreshold].map(([threshold, trades]) => [threshold, metrics(trades)])),
    walkForward: walkForwardResult,
    symbolHoldout: holdoutResult
  };

  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULT_DIR, 'signal-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(RESULT_DIR, 'signal-report.md'), markdownReport(report));
  console.log(`워크포워드: ${walkForwardResult.combined.sample}건 · ${number(walkForwardResult.combined.averageR, 'R')}`);
  console.log(`종목 홀드아웃: ${holdoutResult.combined.sample}건 · ${number(holdoutResult.combined.averageR, 'R')}`);
}

if (require.main === module) main();

module.exports = { fillPrice, resolveTrade, simulateSymbol, metrics, chooseThreshold, walkForward, symbolHoldout };
