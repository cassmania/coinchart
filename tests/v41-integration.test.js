const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);

assert.ok(inlineScript);
assert.doesNotThrow(() => new Function(inlineScript[1]));
assert.match(html, /<script src="\.\/v41-analysis\.js"><\/script>/);
assert.match(html, /AI MASTER 분석 V4\.1/);
assert.match(html, /CoinV41\.analyze\(timeframes,CoinAnalysis\)/);
assert.match(html, /PART 0 · 데이터 기준 및 USDT\.D/);
assert.match(html, /PART 3 · 온체인 및 고래/);
assert.match(html, /PART 4 · 토큰노믹스 및 뉴스/);
assert.match(html, /SMA20\/60\/120\/200/);
assert.match(html, /Stochastic\(14,3,3\)/);
assert.match(html, /포지션 위험액 = 계좌 평가액 × 0\.5~1%/);
assert.match(html, /웹 조사 미수행/);

console.log('V4.1 화면 통합 테스트 통과');
