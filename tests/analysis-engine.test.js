'use strict';

const assert = require('node:assert/strict');
const A = require('../analysis-engine.js');

function almostEqual(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual), `유한한 숫자가 필요하지만 ${actual}을 받았습니다.`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `예상값 ${expected}, 실제값 ${actual}, 허용오차 ${tolerance}`
  );
}

function candle(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume };
}

// SMA 시드 기반 EMA 검증
assert.deepEqual(A.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
assert.deepEqual(A.ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);

// Wilder RSI: 초기 평균과 이후 RMA 갱신을 각각 검증
const rsi = A.rsi([1, 2, 3, 2, 4, 3], 3);
almostEqual(rsi[3], 66.66666666666666);
almostEqual(rsi[4], 83.33333333333333);
almostEqual(rsi[5], 60.60606060606061);

// MACD: 빠른 EMA(2), 느린 EMA(3), 시그널 EMA(2)의 시드 정렬 검증
const macd = A.macd([1, 2, 3, 4, 5], 2, 3, 2);
assert.deepEqual(macd.line, [null, null, 0.5, 0.5, 0.5]);
assert.deepEqual(macd.signal, [null, null, null, 0.5, 0.5]);
assert.deepEqual(macd.histogram, [null, null, null, 0, 0]);

// Wilder ATR 검증
const atrRows = [
  candle(0, 9, 10, 8, 9, 1),
  candle(60, 9, 11, 9, 10, 1),
  candle(120, 10, 12, 9, 11, 1),
  candle(180, 11, 13, 10, 12, 1)
];
const atr = A.atr(atrRows, 3);
almostEqual(atr[2], 7 / 3);
almostEqual(atr[3], 23 / 9);

// 상승이 이어지는 샘플에서 SuperTrend가 유효한 상승 방향을 반환해야 합니다.
const trendRows = Array.from({ length: 8 }, (_, index) =>
  candle(index * 60, 10 + index, 11 + index, 9 + index, 10.8 + index, 10)
);
const supertrend = A.supertrend(trendRows, 3, 2);
assert.equal(A.lastFinite(supertrend.direction), 1);
assert.ok(Number.isFinite(A.lastFinite(supertrend.value)));

// UTC 날짜가 바뀌면 일중 VWAP이 초기화되어야 합니다.
const day1 = Date.UTC(2026, 7, 16, 23, 0, 0) / 1000;
const day2 = Date.UTC(2026, 7, 17, 0, 0, 0) / 1000;
const vwapRows = [
  candle(day1, 9, 11, 9, 10, 2),
  candle(day1 + 1800, 11, 13, 11, 12, 1),
  candle(day2, 19, 21, 19, 20, 3)
];
const vwap = A.anchoredVwap(vwapRows, '30m');
almostEqual(vwap[0], 10);
almostEqual(vwap[1], (10 * 2 + 12) / 3);
almostEqual(vwap[2], 20);

// 진행 중인 봉은 분석 배열에서 제외되고, 마감 시각이 지난 뒤에만 포함되어야 합니다.
const hourStart = Date.UTC(2026, 7, 17, 9, 0, 0) / 1000;
const closedRows = [
  candle(hourStart, 1, 2, 1, 2, 10),
  candle(hourStart + 3600, 2, 3, 2, 3, 20)
];
assert.equal(A.closedCandles(closedRows, '1h', hourStart + 5400).length, 1);
assert.equal(A.closedCandles(closedRows, '1h', hourStart + 7200).length, 2);

// 진행 중인 봉의 가격이 바뀌어도 확정봉 분석 입력은 바뀌지 않아야 합니다.
const before = A.closedCandles(closedRows, '1h', hourStart + 5400);
const changedLiveRows = [...closedRows.slice(0, 1), { ...closedRows[1], close: 999 }];
const after = A.closedCandles(changedLiveRows, '1h', hourStart + 5400);
assert.deepEqual(after, before);

// VPVR: 거래량 총합 보존과 캔들 가격범위 분배를 검증합니다.
const vpRows = [
  candle(0, 0, 10, 0, 5, 100),
  candle(60, 8, 10, 8, 9, 100)
];
const profile = A.volumeProfile(vpRows, 10);
almostEqual(profile.reduce((sum, bin) => sum + bin.vol, 0), 200);
almostEqual(profile[0].vol, 10);
almostEqual(profile[8].vol, 60);
almostEqual(profile[9].vol, 60);
const zones = A.volumeProfileZones(profile, 0.7);
almostEqual(zones.valueAreaRatio, 0.7);
almostEqual(zones.poc, 8.5);
assert.ok(zones.val <= zones.poc && zones.poc <= zones.vah);

// 피벗은 현재 진행 기간이 아니라 직전에 완전히 끝난 UTC 기간을 사용해야 합니다.
const previousDay = Date.UTC(2026, 7, 16, 0, 0, 0) / 1000;
const currentDay = Date.UTC(2026, 7, 17, 0, 0, 0) / 1000;
const pivotRows = [
  candle(previousDay, 9, 12, 8, 10, 1),
  candle(previousDay + 3600, 10, 11, 9, 11, 1),
  candle(currentDay, 11, 14, 10, 13, 1)
];
const previousOhlc = A.previousPeriodOhlc(pivotRows, '1h', currentDay + 7200);
assert.equal(previousOhlc.high, 12);
assert.equal(previousOhlc.low, 8);
assert.equal(previousOhlc.close, 11);
const pivots = A.classicPivots(previousOhlc);
almostEqual(pivots.pivot, 31 / 3);
almostEqual(pivots.r1, 38 / 3);
almostEqual(pivots.s1, 26 / 3);

// 합성 신호는 상관 지표를 네 축으로 묶고, 상승/하락 샘플에서 대칭적인 방향 우위를 내야 합니다.
function directionalRows(direction) {
  return Array.from({ length: 260 }, (_, index) => {
    const base = direction > 0 ? 100 + index * 0.5 : 300 - index * 0.5;
    const open = base - direction * 0.2;
    const close = base + direction * 0.2;
    return candle(index * 86400, open, Math.max(open, close) + 0.6, Math.min(open, close) - 0.6, close, 1000 + index * 2);
  });
}
const risingSignal = A.compositeSignal(directionalRows(1));
const fallingSignal = A.compositeSignal(directionalRows(-1));
assert.equal(risingSignal.ready, true);
assert.equal(fallingSignal.ready, true);
assert.ok(risingSignal.score > 0.15, `상승 점수가 너무 낮습니다: ${risingSignal.score}`);
assert.ok(fallingSignal.score < -0.15, `하락 점수가 너무 높습니다: ${fallingSignal.score}`);
assert.deepEqual(Object.keys(risingSignal.axes), ['trend', 'momentum', 'volatility', 'volume']);
assert.equal(A.compositeSignal(directionalRows(1).slice(0, 59)).ready, false);
assert.equal(A.compositeSignal(directionalRows(1).slice(0, 60)).ready, true);

// 미래 봉을 추가해도 과거 시점까지 잘라 계산한 신호는 바뀌지 않아야 합니다.
const historicalRows = directionalRows(1);
const historicalSignal = A.compositeSignal(historicalRows.slice(0, 240));
const sameHistoricalSignal = A.compositeSignal([...historicalRows.slice(0, 240), ...directionalRows(-1).slice(0, 20)].slice(0, 240));
almostEqual(historicalSignal.score, sameHistoricalSignal.score);

// 반대 방향 시간봉이 공존하면 평균으로 숨기지 않고 충돌로 표시해야 합니다.
const mtfConflict = A.summarizeTimeframes([
  { timeframe:'1h', signal:risingSignal },
  { timeframe:'4h', signal:risingSignal },
  { timeframe:'1w', signal:fallingSignal }
]);
assert.equal(mtfConflict.state, 'CONFLICT');
assert.equal(mtfConflict.up, 2);
assert.equal(mtfConflict.down, 1);
const mtfAligned = A.summarizeTimeframes([
  { timeframe:'1h', signal:risingSignal },
  { timeframe:'4h', signal:risingSignal },
  { timeframe:'12h', signal:risingSignal }
]);
assert.equal(mtfAligned.state, 'LONG_BIAS');

console.log('analysis-engine 테스트 통과: 표준 지표, 확정봉, VPVR, 피벗, 4축 신호, 다중 시간봉 충돌');
