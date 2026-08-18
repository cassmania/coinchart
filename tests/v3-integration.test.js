const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);

assert.ok(inlineScript, '인라인 앱 스크립트를 찾을 수 있어야 합니다.');
assert.doesNotThrow(() => new Function(inlineScript[1]), '인라인 앱 스크립트 문법이 유효해야 합니다.');
assert.match(html, /<script src="\.\/v3-analysis\.js"><\/script>/);
assert.match(html, /const MTF_TFS = \['1h','4h','12h','1d','1w','1M'\]/);
assert.match(html, /CoinV31\.analyze\(timeframes,CoinAnalysis\)/);
assert.match(html, /box\.dataset\.symbol=symbol/);
assert.match(html, /box\.dataset\.timeframe=primaryTf/);
assert.match(html, /CVD\/청산맵: 현재 실시간 데이터 확인 불가/);
assert.match(html, /fetchJson\('https:\/\/api\.upbit\.com\/v1\/ticker\?markets=KRW-USDT'\)/);
assert.match(html, /setV31PanelState\(s,tf,`\$\{s\.replace\('USDT',''\)\} \$\{tf\} 분석 데이터 로딩 중`,'로딩'\)/);
assert.match(html, /cacheV31Futures\(f,item\.symbol,item\.exchange\)/);
assert.match(html, /CoinV31\.confirmedPivots\(rows,5\)/);
assert.match(html, /id="usdtDominanceBox"/);
assert.match(html, /api\.coingecko\.com\/api\/v3\/global/);
assert.match(html, /USDT 도미넌스 현재 데이터 확인 불가/);
assert.match(html, /USDT\.D/);

console.log('V3.1 화면 통합 회귀 테스트 통과: 6개 시간봉·종목 격리·환율 출처·데이터 없음·확정 피보나치·USDT 도미넌스');
