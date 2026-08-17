'use strict';

// 이 값들은 거래소가 보장하는 고정 비용이 아니라 재현 가능한 보수적 가정입니다.
// 실제 계정 등급과 주문 방식에 따라 비용이 다르므로 결과 보고서에 반드시 함께 기록합니다.
module.exports = Object.freeze({
  source: 'Bybit public API / v5 market kline / linear perpetual',
  timeframe: '1d',
  startUtc: '2019-01-01T00:00:00.000Z',
  endUtc: '2026-08-17T00:00:00.000Z',
  symbols: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
    'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT'
  ],
  warmupBars: 240,
  maxHoldBars: 20,
  stopAtr: 2,
  targetR: 1.5,
  feeRatePerSide: 0.0006,
  slippageRatePerSide: 0.0002,
  minimumSample: 60,
  thresholdCandidates: [0.2, 0.3, 0.4, 0.5],
  walkForwardFolds: 5
});
