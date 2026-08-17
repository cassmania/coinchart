/**
 * AI MASTER CRYPTO TRADING ANALYST V3.1용 재현 가능한 구조 분석 모듈.
 *
 * 이 모듈은 전달받은 확정봉만 계산하며 전역 종목 상태를 저장하지 않습니다.
 * 따라서 종목을 바꿔도 이전 종목의 FVG·오더블록·피보나치가 섞이지 않습니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CoinV31 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '3.1.0';

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function round(value) {
    if (!finite(value)) return null;
    const absolute = Math.abs(value);
    const digits = absolute >= 1000 ? 2 : absolute >= 1 ? 6 : 10;
    return Number(value.toFixed(digits));
  }

  function lastFinite(values) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (finite(values[index])) return values[index];
    }
    return null;
  }

  function rma(values, period) {
    const output = Array(values.length).fill(null);
    const seed = [];
    let previous = null;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (!finite(value)) continue;
      if (previous === null) {
        seed.push(value);
        if (seed.length === period) {
          previous = seed.reduce((sum, item) => sum + item, 0) / period;
          output[index] = previous;
        }
        continue;
      }
      previous = (previous * (period - 1) + value) / period;
      output[index] = previous;
    }
    return output;
  }

  /** Wilder 방식 ADX(14)와 +DI/-DI를 계산합니다. */
  function adx(rows, period = 14) {
    const source = Array.isArray(rows) ? rows : [];
    const tr = Array(source.length).fill(null);
    const plusDm = Array(source.length).fill(null);
    const minusDm = Array(source.length).fill(null);

    for (let index = 1; index < source.length; index += 1) {
      const current = source[index];
      const previous = source[index - 1];
      const upMove = current.high - previous.high;
      const downMove = previous.low - current.low;
      tr[index] = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
      minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    }

    const atr = rma(tr, period);
    const smoothPlus = rma(plusDm, period);
    const smoothMinus = rma(minusDm, period);
    const plusDi = source.map((_, index) => finite(atr[index]) && atr[index] > 0
      ? 100 * smoothPlus[index] / atr[index]
      : null);
    const minusDi = source.map((_, index) => finite(atr[index]) && atr[index] > 0
      ? 100 * smoothMinus[index] / atr[index]
      : null);
    const dx = source.map((_, index) => {
      if (!finite(plusDi[index]) || !finite(minusDi[index])) return null;
      const total = plusDi[index] + minusDi[index];
      return total > 0 ? 100 * Math.abs(plusDi[index] - minusDi[index]) / total : 0;
    });
    const adxSeries = rma(dx, period);

    return {
      adx: lastFinite(adxSeries),
      plusDi: lastFinite(plusDi),
      minusDi: lastFinite(minusDi),
      series: { adx: adxSeries, plusDi, minusDi }
    };
  }

  /** 좌우 k개 확정봉보다 엄격히 높거나 낮은 봉만 확인 피벗으로 인정합니다. */
  function confirmedPivots(rows, k = 5) {
    const source = Array.isArray(rows) ? rows : [];
    const output = [];
    for (let index = k; index < source.length - k; index += 1) {
      let isHigh = true;
      let isLow = true;
      for (let cursor = index - k; cursor <= index + k; cursor += 1) {
        if (cursor === index) continue;
        if (source[index].high <= source[cursor].high) isHigh = false;
        if (source[index].low >= source[cursor].low) isLow = false;
      }
      if (isHigh) output.push({
        type: 'high', index, confirmedAt: index + k,
        time: source[index].time, price: source[index].high
      });
      if (isLow) output.push({
        type: 'low', index, confirmedAt: index + k,
        time: source[index].time, price: source[index].low
      });
    }
    return output.sort((a, b) => a.index - b.index);
  }

  /** 가장 최근 확인 고점·저점 한 쌍으로 피보나치 되돌림을 만듭니다. */
  function fibonacci(pivots) {
    const highs = pivots.filter(pivot => pivot.type === 'high');
    const lows = pivots.filter(pivot => pivot.type === 'low');
    if (!highs.length || !lows.length) return null;
    const high = highs.at(-1);
    const low = lows.at(-1);
    const span = high.price - low.price;
    if (!(span > 0)) return null;
    const rising = low.index < high.index;
    const levels = {};
    [0.382, 0.5, 0.618, 0.786].forEach(ratio => {
      levels[String(ratio)] = round(rising
        ? high.price - span * ratio
        : low.price + span * ratio);
    });
    return {
      direction: rising ? '상승 스윙 되돌림' : '하락 스윙 반등',
      from: rising ? low : high,
      to: rising ? high : low,
      levels
    };
  }

  /** 3봉 불균형 정의로 FVG를 찾고 이후 메움·재방문 상태를 계산합니다. */
  function fairValueGaps(rows) {
    const source = Array.isArray(rows) ? rows : [];
    const output = [];
    for (let index = 2; index < source.length; index += 1) {
      const first = source[index - 2];
      const third = source[index];
      let type = null;
      let lower = null;
      let upper = null;
      if (third.low > first.high) {
        type = 'bullish'; lower = first.high; upper = third.low;
      } else if (third.high < first.low) {
        type = 'bearish'; lower = third.high; upper = first.low;
      }
      if (!type) continue;

      let fillRatio = 0;
      let revisits = 0;
      for (let cursor = index + 1; cursor < source.length; cursor += 1) {
        const candle = source[cursor];
        if (type === 'bullish' && candle.low < upper) {
          revisits += 1;
          fillRatio = Math.max(fillRatio, candle.low <= lower ? 1 : (upper - candle.low) / (upper - lower));
        }
        if (type === 'bearish' && candle.high > lower) {
          revisits += 1;
          fillRatio = Math.max(fillRatio, candle.high >= upper ? 1 : (candle.high - lower) / (upper - lower));
        }
      }
      const filledPercent = Math.round(Math.max(0, Math.min(1, fillRatio)) * 100);
      output.push({
        type, index, time: third.time,
        lower: round(lower), upper: round(upper), revisits,
        status: filledPercent >= 100 ? '완전 메움' : filledPercent > 0 ? '부분 메움' : '미체결',
        filledPercent
      });
    }
    return output.slice(-12);
  }

  function lastOpposingCandle(rows, from, to, bullishBreak) {
    for (let index = to; index >= from; index -= 1) {
      const candle = rows[index];
      if (bullishBreak ? candle.close < candle.open : candle.close > candle.open) return index;
    }
    return null;
  }

  /** BOS/CHoCH, 유동성 스윕, BOS 직전 오더블록 후보를 기계적으로 연결합니다. */
  function marketStructure(rows, pivots) {
    const source = Array.isArray(rows) ? rows : [];
    const breaks = [];
    const sweeps = [];

    pivots.forEach(pivot => {
      const bullish = pivot.type === 'high';
      for (let index = pivot.confirmedAt + 1; index < source.length; index += 1) {
        const candle = source[index];
        const closeBreak = bullish ? candle.close > pivot.price : candle.close < pivot.price;
        const wickSweep = bullish
          ? candle.high > pivot.price && candle.close <= pivot.price
          : candle.low < pivot.price && candle.close >= pivot.price;
        if (wickSweep) {
          sweeps.push({
            type: bullish ? 'buy-side' : 'sell-side',
            pivotPrice: round(pivot.price), time: candle.time, index
          });
          break;
        }
        if (closeBreak) {
          breaks.push({
            direction: bullish ? 'bullish' : 'bearish',
            pivotPrice: round(pivot.price), breakPrice: round(candle.close),
            time: candle.time, index, pivotIndex: pivot.index
          });
          break;
        }
      }
    });

    const ordered = breaks
      .sort((a, b) => a.index - b.index || a.pivotIndex - b.pivotIndex)
      .filter((item, index, items) => index === 0
        || item.index !== items[index - 1].index
        || item.direction !== items[index - 1].direction);
    let previousDirection = null;
    ordered.forEach(item => {
      item.kind = previousDirection && previousDirection !== item.direction ? 'CHoCH' : 'BOS';
      previousDirection = item.direction;
    });

    const blocks = [];
    ordered.forEach(item => {
      const bullish = item.direction === 'bullish';
      const opposingIndex = lastOpposingCandle(
        source,
        Math.max(item.pivotIndex + 1, item.index - 12),
        item.index - 1,
        bullish
      );
      if (opposingIndex === null) return;
      const candle = source[opposingIndex];
      let invalidated = false;
      let revisits = 0;
      for (let index = item.index + 1; index < source.length; index += 1) {
        const later = source[index];
        if (later.high >= candle.low && later.low <= candle.high) revisits += 1;
        if ((bullish && later.close < candle.low) || (!bullish && later.close > candle.high)) {
          invalidated = true;
          break;
        }
      }
      const breakCandle = source[item.index];
      const recent = source.slice(Math.max(0, item.index - 20), item.index);
      const averageVolume = recent.length
        ? recent.reduce((sum, row) => sum + (finite(row.volume) ? row.volume : 0), 0) / recent.length
        : 0;
      const ranges = recent.map(row => row.high - row.low).filter(value => value > 0);
      const averageRange = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
      const displacement = Math.abs(breakCandle.close - breakCandle.open);
      const confirmed = averageRange > 0 && displacement >= averageRange
        && averageVolume > 0 && breakCandle.volume >= averageVolume * 1.2;
      blocks.push({
        type: item.direction,
        time: candle.time,
        lower: round(candle.low),
        upper: round(candle.high),
        quality: confirmed ? '확인' : '후보',
        status: invalidated ? '무효' : '유효',
        revisits
      });
    });

    const uniqueBlocks = blocks.filter((item, index, items) => items.findIndex(other =>
      other.type === item.type && other.lower === item.lower && other.upper === item.upper) === index);
    return {
      breaks: ordered.slice(-8),
      sweeps: sweeps.sort((a, b) => a.index - b.index).slice(-8),
      orderBlocks: uniqueBlocks.slice(-8)
    };
  }

  /** 확인 가격 피벗 두 개와 같은 시점의 RSI로 일반·히든 다이버전스를 판정합니다. */
  function rsiDivergences(rows, pivots, coinAnalysis) {
    if (!coinAnalysis?.rsi) return [];
    const rsiValues = coinAnalysis.rsi(rows.map(row => row.close), 14);
    const output = [];
    ['low', 'high'].forEach(type => {
      const matches = pivots.filter(pivot => pivot.type === type && finite(rsiValues[pivot.index]));
      if (matches.length < 2) return;
      const first = matches.at(-2);
      const second = matches.at(-1);
      const firstRsi = rsiValues[first.index];
      const secondRsi = rsiValues[second.index];
      let label = null;
      if (type === 'low' && second.price < first.price && secondRsi > firstRsi) label = '일반 상승';
      if (type === 'low' && second.price > first.price && secondRsi < firstRsi) label = '히든 상승';
      if (type === 'high' && second.price > first.price && secondRsi < firstRsi) label = '일반 하락';
      if (type === 'high' && second.price < first.price && secondRsi > firstRsi) label = '히든 하락';
      if (label) output.push({
        label,
        first: { time: first.time, price: round(first.price), rsi: round(firstRsi) },
        second: { time: second.time, price: round(second.price), rsi: round(secondRsi) }
      });
    });
    return output;
  }

  function regime(adxValue) {
    if (!adxValue || !finite(adxValue.adx)) return '표본 부족';
    if (adxValue.adx < 20) return '약한 추세/횡보';
    if (adxValue.adx < 25) return '추세 전환 구간';
    return adxValue.plusDi >= adxValue.minusDi ? '상승 추세 강화' : '하락 추세 강화';
  }

  function analyze(timeframes, coinAnalysis) {
    const source = timeframes || {};
    const frames = {};
    Object.keys(source).forEach(timeframe => {
      const rows = Array.isArray(source[timeframe]) ? source[timeframe] : [];
      const adxValue = adx(rows, 14);
      const closes = rows.map(row => row.close);
      const supertrend = coinAnalysis?.supertrend ? coinAnalysis.supertrend(rows, 10, 3) : null;
      const macd = coinAnalysis?.macd ? coinAnalysis.macd(closes, 12, 26, 9) : null;
      const recentVolumes = rows.slice(-21, -1).map(row => row.volume).filter(finite);
      const averageVolume = recentVolumes.length
        ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length
        : null;
      const lastVolume = rows.at(-1)?.volume;
      frames[timeframe] = {
        bars: rows.length,
        adx: adxValue,
        regime: regime(adxValue),
        ma20: coinAnalysis?.lastFinite(coinAnalysis.sma(closes, 20)) ?? null,
        ma50: coinAnalysis?.lastFinite(coinAnalysis.sma(closes, 50)) ?? null,
        ma200: coinAnalysis?.lastFinite(coinAnalysis.sma(closes, 200)) ?? null,
        supertrendDirection: supertrend ? coinAnalysis.lastFinite(supertrend.direction) : null,
        rsi: coinAnalysis?.rsi ? coinAnalysis.lastFinite(coinAnalysis.rsi(closes, 14)) : null,
        macdHistogram: macd ? coinAnalysis.lastFinite(macd.histogram) : null,
        volumeRatio: finite(lastVolume) && finite(averageVolume) && averageVolume > 0
          ? lastVolume / averageVolume
          : null
      };
    });

    const priority = ['4h', '12h', '1d', '1h', '1w', '1M'];
    const primaryTimeframe = priority.find(timeframe => source[timeframe]?.length >= 30) || null;
    if (!primaryTimeframe) {
      return { version: VERSION, error: '구조 분석에 필요한 확정봉이 부족합니다.', frames };
    }

    const rows = source[primaryTimeframe];
    const pivots = confirmedPivots(rows, 5);
    const structure = marketStructure(rows, pivots);
    return {
      version: VERSION,
      primaryTimeframe,
      frames,
      pivots: pivots.slice(-12),
      fibonacci: fibonacci(pivots),
      fvg: fairValueGaps(rows),
      breaks: structure.breaks,
      sweeps: structure.sweeps,
      orderBlocks: structure.orderBlocks,
      divergences: rsiDivergences(rows, pivots, coinAnalysis)
    };
  }

  return Object.freeze({
    VERSION,
    adx,
    confirmedPivots,
    fibonacci,
    fairValueGaps,
    marketStructure,
    rsiDivergences,
    regime,
    analyze
  });
});
