const assert = require('node:assert/strict');
const CoinAnalysis = require('../analysis-engine.js');
const CoinV31 = require('../v3-analysis.js');

function rows(values) {
  return values.map((close, index) => ({
    time: 1700000000 + index * 14400,
    open: close - Math.sin(index) * 0.4,
    high: close + 0.6,
    low: close - 0.6,
    close,
    volume: 100 + index
  }));
}

{
  const values = [10,11,12,13,14,15,16,17,30,17,16,15,14,13,12,11,10,9,8,7,1,7,8,9,10,11,12,13,14,15,16];
  const pivots = CoinV31.confirmedPivots(rows(values), 5);
  assert.ok(pivots.some(pivot => pivot.type === 'high' && pivot.index === 8));
  assert.ok(pivots.some(pivot => pivot.type === 'low' && pivot.index === 20));
  assert.ok(pivots.every(pivot => pivot.confirmedAt === pivot.index + 5));
}

{
  const input = [
    {time:1,open:100,high:101,low:99,close:100,volume:100},
    {time:2,open:100,high:104,low:100,close:103,volume:100},
    {time:3,open:104,high:107,low:103,close:106,volume:100},
    {time:4,open:106,high:108,low:102,close:103,volume:100}
  ];
  const gaps = CoinV31.fairValueGaps(input);
  const bullish = gaps.find(gap => gap.type === 'bullish');
  assert.deepEqual([bullish.lower, bullish.upper], [101, 103]);
  assert.equal(bullish.status, '부분 메움');
}

{
  const input = rows(Array.from({length: 100}, (_, index) => 100 + index + Math.sin(index / 3) * 3));
  const result = CoinV31.analyze({'4h': input}, CoinAnalysis);
  assert.equal(result.version, '3.1.0');
  assert.equal(result.primaryTimeframe, '4h');
  assert.ok(Number.isFinite(result.frames['4h'].adx.adx));
  assert.ok(Number.isFinite(result.frames['4h'].ma50));
  assert.ok(Number.isFinite(result.frames['4h'].rsi));
  assert.ok(Number.isFinite(result.frames['4h'].macdHistogram));
  assert.ok(Number.isFinite(result.frames['4h'].volumeRatio));
}

{
  const rising = rows(Array.from({length: 90}, (_, index) => 100 + index + Math.sin(index / 3) * 4));
  const falling = rows(Array.from({length: 90}, (_, index) => 300 - index + Math.sin(index / 4) * 4));
  const btc = CoinV31.analyze({'4h': rising}, CoinAnalysis);
  const eth = CoinV31.analyze({'4h': falling}, CoinAnalysis);
  assert.notDeepEqual(btc, eth, '호출마다 전달된 종목 봉만 사용해야 합니다.');
}

{
  const result = CoinV31.analyze({'4h': rows([1, 2, 3])}, CoinAnalysis);
  assert.match(result.error, /확정봉이 부족/);
  assert.equal(result.frames['4h'].regime, '표본 부족');
}

console.log('V3.1 분석 회귀 테스트 통과: ADX·확정 피벗·FVG·종목 격리·표본 부족');
