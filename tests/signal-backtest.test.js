'use strict';

const assert = require('node:assert/strict');
const { resolveTrade, simulateSymbol, metrics, chooseThreshold, chronologicalHoldout, walkForward } = require('../backtest/signal-backtest.js');
const { dataQuality } = require('../backtest/fetch-snapshot.js');

const settings = {
  slippageRatePerSide: 0,
  feeRatePerSide: 0,
  stopAtr: 1,
  targetR: 1,
  maxHoldBars: 2
};

// 진입 봉에서 손절과 익절을 모두 통과하면 보수적으로 손절이 우선되어야 합니다.
const bothHitRows = [
  { time: 0, open: 100, high: 102, low: 98, close: 101, volume: 1 },
  { time: 1, open: 100, high: 102, low: 98, close: 100, volume: 1 }
];
const bothHit = resolveTrade(bothHitRows, 0, 'LONG', 1, settings);
assert.equal(bothHit.outcome, 'STOP');
assert.equal(bothHit.netR, -1);

// 비용은 기대값에서 빠져야 하며, 최대 낙폭은 누적 R 고점 대비 하락으로 계산합니다.
const costSettings = { ...settings, feeRatePerSide: 0.001, slippageRatePerSide: 0.001 };
const withCost = resolveTrade(bothHitRows, 0, 'LONG', 1, costSettings);
assert.ok(withCost.netR < -1);
const result = metrics([
  { netR: 1, exitTime: 1, symbol: 'A' },
  { netR: -2, exitTime: 2, symbol: 'A' },
  { netR: 0.5, exitTime: 3, symbol: 'A' }
], 3);
assert.equal(result.sample, 3);
assert.equal(result.winRate, 2 / 3);
assert.equal(result.profitFactor, 0.75);
assert.equal(result.maxDrawdownR, 2);

const quality = dataQuality([
  { time: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
  { time: 86400 * 2, open: 10, high: 11, low: 9, close: 10, volume: 0 }
]);
assert.equal(quality.missingDays, 1);
assert.equal(quality.invalidOhlc, 0);
assert.equal(quality.zeroVolume, 1);
assert.equal(dataQuality([{ time: 0, open: 10, high: Infinity, low: 9, close: 10, volume: 1 }]).invalidOhlc, 1);
assert.equal(dataQuality([{ time: 0, open: 10, high: 11, low: 9, close: 10, volume: Infinity }]).zeroVolume, 1);

const tradesByThreshold = new Map([
  [0.2, [
    { signalTime: 1, exitTime: 2, netR: 1, symbol: 'A' },
    { signalTime: 3, exitTime: 4, netR: 0.5, symbol: 'A' },
    { signalTime: 6, exitTime: 7, netR: -1, symbol: 'A' }
  ]],
  [0.3, [
    { signalTime: 1, exitTime: 2, netR: 0.1, symbol: 'A' },
    { signalTime: 6, exitTime: 7, netR: 1, symbol: 'A' }
  ]]
]);
const selected = chooseThreshold(tradesByThreshold, trade => trade.exitTime < 6, 1);
assert.equal(selected.threshold, 0.2);

// 손절가보다 불리한 시가에서는 손실을 -1R로 잘라서는 안 된다.
const gapRows = [
  { time: 0, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1 },
  { time: 86400, open: 95, high: 96, low: 94, close: 95, volume: 1 }
];
assert.equal(resolveTrade(gapRows, 0, 'LONG', 1, settings).netR, -5);
const shortGap = gapRows.map((row, i) => i === 0 ? row : { ...row, open: 105, high: 106, low: 104, close: 105 });
assert.equal(resolveTrade(shortGap, 0, 'SHORT', 1, settings).netR, -5);
const bounded = resolveTrade(gapRows, 0, 'LONG', 1, settings, 1);
assert.equal(bounded.outcome, 'BOUNDARY');
assert.equal(bounded.exitIndex, 0);
assert.equal(bounded.netR, 0);

// 실제 합성 신호를 사용해 검증 구간의 독립 실행과 미래 꼬리 변경 불변성을 검증한다.
const rows = Array.from({ length: 600 }, (_, i) => {
  const open = 200 + i * 0.08 + 12 * Math.sin(i / 11);
  return { time: i * 86400, open, high: open + 3, low: open - 3, close: open + Math.cos(i / 4), volume: 100 + i % 13 };
});
const conf = { ...settings, warmupBars: 60, minimumSample: 1, walkForwardFolds: 5 };
const sets = [{ symbol: 'A', rows }];
const all = new Map([0.2, 0.3].map(threshold => [threshold, simulateSymbol('A', rows, threshold, conf)]));
const holdout = chronologicalHoldout(all, sets, conf);
assert.ok(holdout.test.sample > 0);
assert.deepEqual(holdout.test, metrics(simulateSymbol('A', rows, holdout.threshold, conf, { startTime: holdout.splitTime }), 1));
const endTime = rows[400].time;
const originalPeriod = simulateSymbol('A', rows, 0.2, conf, { startTime: rows[300].time, endTime });
const changed = rows.map((r, i) => i < 400 ? r : { ...r, open: 9999, high: 10000, low: 9998, close: 9999 });
assert.deepEqual(simulateSymbol('A', changed, 0.2, conf, { startTime: rows[300].time, endTime }), originalPeriod);
assert.ok(originalPeriod.every(t => t.entryIndex > 300 && t.exitIndex < 400));
const wf = walkForward(all, sets, conf);
assert.equal(wf.folds.at(-1).testEndUtc, new Date((rows.at(-1).time + 86400) * 1000).toISOString());

console.log('signal-backtest 테스트 통과: 동일봉 손절 우선, 비용, PF, MDD, 데이터 품질, 시간순 홀드아웃');
