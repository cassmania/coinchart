const assert = require('node:assert/strict');
const CoinAnalysis = require('../analysis-engine.js');
const CoinV41 = require('../v41-analysis.js');

const rows = Array.from({ length: 240 }, (_, index) => {
  const close = 100 + index * 0.15 + Math.sin(index / 7) * 2;
  return {
    time: 1_700_000_000 + index * 14_400,
    open: close - 0.2,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000 + index
  };
});

const result = CoinV41.analyze({ '4h': rows }, CoinAnalysis);
assert.equal(result.version, '4.1.0');
assert.match(result.protocol, /PART 0~5/);
assert.ok(Number.isFinite(result.frames['4h'].ma60));
assert.ok(Number.isFinite(result.frames['4h'].ma120));
assert.ok(Number.isFinite(result.frames['4h'].anchoredVwap));
assert.match(result.evidence.unavailableRule, /추정하지 않고/);

console.log('V4.1 분석 호환 레이어 테스트 통과');
