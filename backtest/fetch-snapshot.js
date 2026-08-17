'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config.js');

const DATA_DIR = path.join(__dirname, 'data');

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const body = await response.json();
  if (body.retCode !== 0) throw new Error(`Bybit ${body.retCode}: ${body.retMsg}`);
  return body;
}

async function fetchSymbol(symbol) {
  const start = Date.parse(config.startUtc);
  let cursor = Date.parse(config.endUtc) - 1;
  const rows = new Map();

  while (cursor >= start) {
    const query = new URLSearchParams({
      category: 'linear', symbol, interval: 'D', start: String(start), end: String(cursor), limit: '1000'
    });
    const body = await fetchJson(`https://api.bybit.com/v5/market/kline?${query}`);
    const list = body.result?.list || [];
    if (!list.length) break;

    for (const item of list) {
      const timeMs = Number(item[0]);
      if (timeMs < start || timeMs >= Date.parse(config.endUtc)) continue;
      rows.set(timeMs, {
        time: Math.floor(timeMs / 1000),
        open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]),
        volume: Number(item[5])
      });
    }

    const oldest = Math.min(...list.map(item => Number(item[0])));
    if (!Number.isFinite(oldest) || oldest <= start || list.length < 1000) break;
    cursor = oldest - 1;
    await sleep(120);
  }

  return [...rows.values()].sort((a, b) => a.time - b.time);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    fetchedAtUtc: new Date().toISOString(),
    source: config.source,
    timeframe: config.timeframe,
    requestedRange: { startUtc: config.startUtc, endExclusiveUtc: config.endUtc },
    files: []
  };

  for (const symbol of config.symbols) {
    process.stdout.write(`${symbol} 다운로드 중... `);
    const rows = await fetchSymbol(symbol);
    if (rows.length < config.warmupBars + config.maxHoldBars) {
      throw new Error(`${symbol}: 백테스트에 필요한 캔들이 부족합니다 (${rows.length}개)`);
    }
    const file = `${symbol}_1d.json`;
    const json = JSON.stringify(rows);
    fs.writeFileSync(path.join(DATA_DIR, file), json);
    manifest.files.push({
      symbol, file, bars: rows.length,
      firstTimeUtc: new Date(rows[0].time * 1000).toISOString(),
      lastTimeUtc: new Date(rows.at(-1).time * 1000).toISOString(),
      sha256: crypto.createHash('sha256').update(json).digest('hex')
    });
    console.log(`${rows.length}봉`);
    await sleep(120);
  }

  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`고정 스냅샷 저장 완료: ${DATA_DIR}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { fetchSymbol };
