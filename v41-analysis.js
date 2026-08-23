/**
 * 코인분석스킬 V4.1 호환 레이어.
 *
 * 검증된 V3.1 시장구조 계산을 그대로 재사용하고, V4.1 보고서가 요구하는
 * 이동평균·데이터 가용성·근거 메타데이터를 확장합니다.
 */
(function (root, factory) {
  const v31 = typeof module === 'object' && module.exports
    ? require('./v3-analysis.js')
    : root.CoinV31;
  const api = factory(v31);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CoinV41 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (v31) {
  'use strict';

  const VERSION = '4.1.0';
  const PROTOCOL = 'PART 0~5 · 확정봉 · 근거/단위/가용성 우선';

  function analyze(timeframes, coinAnalysis) {
    if (!v31?.analyze) {
      return { version: VERSION, protocol: PROTOCOL, error: 'V3.1 구조 분석 모듈을 불러오지 못했습니다.', frames: {} };
    }

    const result = v31.analyze(timeframes, coinAnalysis);
    const frames = { ...result.frames };
    Object.entries(frames).forEach(([timeframe, frame]) => {
      const rows = Array.isArray(timeframes?.[timeframe]) ? timeframes[timeframe] : [];
      const closes = rows.map(row => row.close);
      frames[timeframe] = {
        ...frame,
        ma60: coinAnalysis?.lastFinite?.(coinAnalysis.sma(closes, 60)) ?? null,
        ma120: coinAnalysis?.lastFinite?.(coinAnalysis.sma(closes, 120)) ?? null,
        anchoredVwap: coinAnalysis?.lastFinite?.(coinAnalysis.anchoredVwap(rows, timeframe)) ?? null
      };
    });

    return {
      ...result,
      version: VERSION,
      protocol: PROTOCOL,
      frames,
      evidence: {
        candles: '공식 거래소 OHLCV · 진행 중 봉 제외',
        calculations: '브라우저 재현 계산',
        unavailableRule: '미수집 데이터는 추정하지 않고 현재 실시간 데이터 확인 불가로 표시'
      }
    };
  }

  return Object.freeze({
    ...v31,
    VERSION,
    PROTOCOL,
    analyze
  });
});
