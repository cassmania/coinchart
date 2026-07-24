/**
 * Elliott Wave Skill Analysis Engine (coin-wave-analysis)
 * Rules:
 * 1. Wave 2 never retraces more than 100% of Wave 1.
 * 2. Wave 3 is never the shortest among Impulse Waves 1, 3, 5.
 * 3. Wave 4 never enters the price territory of Wave 1.
 */

class ElliottWaveEngine {
    constructor() {
        this.minSwingPct = 0.015; // 1.5% ZigZag Pivot
    }

    analyze(candles) {
        if (!candles || candles.length < 30) {
            return { error: '데이터 부족 (최소 30개 캔들 필요)' };
        }

        const pivots = this.extractPivots(candles);
        const ewoData = this.calculateEWO(candles);

        if (pivots.length < 5) {
            return {
                stage: '파동 형성 중 (피봇 부족)',
                pivots,
                ewo: ewoData,
                rulesPassed: { rule1: true, rule2: true, rule3: true },
                signal: { action: '관망', reason: '명확한 5파 패턴 수립 대기', targetPrice: 0, stopLossPrice: 0 }
            };
        }

        // 최근 5개 피봇 기반 1~5파 검증
        const w0 = pivots[pivots.length - 5];
        const w1 = pivots[pivots.length - 4];
        const w2 = pivots[pivots.length - 3];
        const w3 = pivots[pivots.length - 2];
        const w4 = pivots[pivots.length - 1];
        const lastCandle = candles[candles.length - 1];

        const isBullish = w1.price > w0.price;

        // 3대 법칙 검증
        const rule1 = isBullish ? (w2.price > w0.price) : (w2.price < w0.price);
        const len1 = Math.abs(w1.price - w0.price);
        const len3 = Math.abs(w3.price - w2.price);
        const len5Estimate = Math.abs(lastCandle.close - w4.price);
        const rule2 = len3 >= len1 || len3 >= len5Estimate;
        const rule3 = isBullish ? (w4.price > w1.price) : (w4.price < w1.price);

        const rulesPassed = { rule1, rule2, rule3 };
        const allPassed = rule1 && rule2 && rule3;

        // 피보나치 목표가 산출
        let targetPrice = 0;
        let stopLossPrice = w4.price;
        let stage = '파동 형성 분석 중';
        let action = 'NEUTRAL';
        let reason = '파동 진행 관찰 필요';

        if (isBullish) {
            if (lastCandle.close > w2.price && lastCandle.close < w3.price) {
                stage = '3파 진행 중 (가장 강력한 상승파)';
                targetPrice = w2.price + len1 * 1.618;
                stopLossPrice = w2.price;
                action = 'LONG';
                reason = '피보나치 1.618 3파 확장 진행';
            } else if (lastCandle.close > w4.price) {
                stage = '5파 진행 중 (마지막 상승 마감파)';
                targetPrice = w4.price + len1 * 1.0;
                stopLossPrice = w4.price;
                action = 'LONG';
                reason = '피보나치 1.0 5파 목표가 추종';
            } else {
                stage = 'ABC 조정 파동 진행 중';
                targetPrice = w4.price - len1 * 0.618;
                action = 'SHORT';
                reason = '임펄스 완료 후 조정 진입';
            }
        }

        return {
            stage,
            isBullish,
            allPassed,
            rulesPassed,
            pivots: [w0, w1, w2, w3, w4],
            signal: {
                action,
                reason,
                targetPrice: parseFloat(targetPrice.toFixed(4)),
                stopLossPrice: parseFloat(stopLossPrice.toFixed(4))
            },
            ewo: ewoData
        };
    }

    extractPivots(candles) {
        const pivots = [];
        let lastType = null;
        let lastPivotIndex = 0;

        for (let i = 2; i < candles.length - 2; i++) {
            const cur = candles[i];
            const isHigh = cur.high > candles[i-1].high && cur.high > candles[i-2].high &&
                           cur.high > candles[i+1].high && cur.high > candles[i+2].high;
            const isLow = cur.low < candles[i-1].low && cur.low < candles[i-2].low &&
                          cur.low < candles[i+1].low && cur.low < candles[i+2].low;

            if (isHigh && lastType !== 'HIGH') {
                pivots.push({ index: i, time: cur.time, price: cur.high, type: 'HIGH' });
                lastType = 'HIGH';
            } else if (isLow && lastType !== 'LOW') {
                pivots.push({ index: i, time: cur.time, price: cur.low, type: 'LOW' });
                lastType = 'LOW';
            }
        }
        return pivots;
    }

    calculateEWO(candles) {
        const closes = candles.map(c => c.close);
        const sma5 = this.calculateSMA(closes, 5);
        const sma35 = this.calculateSMA(closes, 35);
        const ewo = [];

        for (let i = 0; i < closes.length; i++) {
            if (i < 34) {
                ewo.push({ time: candles[i].time, value: 0 });
            } else {
                ewo.push({ time: candles[i].time, value: sma5[i] - sma35[i] });
            }
        }
        return ewo;
    }

    calculateSMA(data, period) {
        const sma = [];
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
            if (i >= period) {
                sum -= data[i - period];
                sma.push(sum / period);
            } else if (i === period - 1) {
                sma.push(sum / period);
            } else {
                sma.push(0);
            }
        }
        return sma;
    }
}

if (typeof module !== 'undefined') {
    module.exports = ElliottWaveEngine;
}
