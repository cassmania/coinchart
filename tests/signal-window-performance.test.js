'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const current = require('../analysis-engine.js');
// 수정 전 배포본의 독립 구현을 같은 499봉 입력으로 실행하여 모든 반환값을 대조한다.
const oldSource = execFileSync('git', ['show', 'ec657f5:analysis-engine.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
const sandbox = { module: { exports: {} } };
vm.runInNewContext(oldSource, sandbox);
const old = sandbox.module.exports;
const optimizedSandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../analysis-engine.js'), 'utf8'), optimizedSandbox);
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '../backtest/data/BTCUSDT_1d.json'), 'utf8'));
for (const end of [60, 240, 499, 750, 1200, rows.length]) {
  const expected = old.compositeSignal(rows.slice(Math.max(0, end - 499), end));
  const actual = current.compositeSignal(rows.slice(0, end));
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
}
const input = rows.slice(-499);
// 두 구현을 동일한 VM 환경에서 실행한다. 속도는 장비별 변동이 있어 합격 기준에서 제외한다.
function measure(engine) {
  for (let i = 0; i < 15; i++) engine.compositeSignal(input);
  const start = performance.now();
  for (let i = 0; i < 200; i++) engine.compositeSignal(input);
  return performance.now() - start;
}
console.log(JSON.stringify({ parity: '6개 시점 전체 필드 일치', repetitions: 200, beforeMs: measure(old), afterMs: measure(optimizedSandbox.module.exports) }));
