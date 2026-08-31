'use strict';

const assert = require('node:assert/strict');
const { resolveTrade, metrics, chronologicalHoldout } = require('../backtest/signal-backtest.js');
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
const holdout = chronologicalHoldout(tradesByThreshold, [{ rows: Array.from({ length: 10 }, (_, time) => ({ time })) }], { minimumSample: 1 });
assert.equal(holdout.threshold, 0.2);
assert.equal(holdout.test.sample, 1);
assert.equal(holdout.test.averageR, -1);

console.log('signal-backtest 테스트 통과: 동일봉 손절 우선, 비용, PF, MDD, 데이터 품질, 시간순 홀드아웃');
