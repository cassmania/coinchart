'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// 메인 확정봉 배열은 배열 동일성으로 판별하지 않고 명시적인 메인 문맥을 전달해야 합니다.
assert.match(html, /doWave\(rows, sym, tf, true\)/);

// 분할 차트는 메인 오버레이를 건드리지 않도록 명시적으로 false를 전달해야 합니다.
assert.match(html, /doWave\(rows, item\.symbol, item\.tf, false\)/);

// 종목 변경 즉시 이전 파동 가격을 지우고 새 종목 로딩 상태를 기록해야 합니다.
assert.match(html, /setWavePanelState\(s,tf,`\$\{s\.replace\('USDT',''\)\} \$\{tf\} 캔들 로딩 중`,'로딩',true\)/);

// 실패 시 이전 종목 분석을 남기지 않고 데이터 없음으로 교체해야 합니다.
assert.match(html, /엘리엇 분석 데이터 없음`,'데이터 없음',true/);

// 화면 결과에는 분석에 실제 사용한 종목·시간봉을 검증 가능한 데이터 속성으로 남깁니다.
assert.match(html, /box\.dataset\.symbol=analysisSymbol/);
assert.match(html, /box\.dataset\.timeframe=analysisTf/);

console.log('엘리엇 종목 동기화 회귀 테스트 통과: 메인·분할 문맥, 즉시 초기화, 실패 초기화, DOM 출처');
