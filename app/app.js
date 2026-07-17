/* ============================================================
   코인차트 모바일 앱 — cassmania.github.io/coinchart 기반
   데이터: Binance Futures REST + WebSocket
   차트: lightweight-charts 4.1.3
   ============================================================ */
'use strict';

const REST = 'https://fapi.binance.com/fapi/v1';
const WS = 'wss://fstream.binance.com/ws';
// Google Cloud Console에서 OAuth 클라이언트 ID 발급 후 교체
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

const SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT',
  'ADAUSDT','AVAXUSDT','LINKUSDT','SUIUSDT','TRXUSDT','DOTUSDT',
  'LTCUSDT','BCHUSDT','APTUSDT','ARBUSDT','OPUSDT','PEPEUSDT',
  'NEARUSDT','WLDUSDT'
];

const state = {
  user: null,
  tickers: {},          // sym -> {price, chg}
  favs: JSON.parse(localStorage.getItem('favs') || '["BTCUSDT","ETHUSDT","SOLUSDT"]'),
  sym: 'BTCUSDT',
  tf: '15m',
  inds: new Set(['ma', 'rsi']),
  ws: null,
  klineWs: null,
  chart: null, sub: null,
  candleSeries: null, volSeries: null,
  overlays: [],         // main-chart indicator series
  subSeries: [],        // sub-chart indicator series
  fibLines: [],         // fibonacci price lines
  candles: [],          // raw kline data
  split: [],            // {chart, series, sym, ws} x4
  splitTf: '15m',
  infoAt: 0,
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtP = p => p >= 1000 ? p.toLocaleString('en-US', {maximumFractionDigits: 1})
  : p >= 1 ? p.toFixed(2) : p.toPrecision(4);
const fmtC = c => (c >= 0 ? '+' : '') + c.toFixed(2) + '%';

/* ===================== 화면 전환 ===================== */
function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  $('tabbar').classList.toggle('hidden', name === 'auth');
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'chart') requestAnimationFrame(() => resizeCharts());
}

/* ===================== 인증 ===================== */
function initAuth() {
  const saved = localStorage.getItem('user');
  if (saved) { state.user = JSON.parse(saved); enterApp(); return; }

  $('btn-guest').onclick = () => {
    state.user = { name: 'guest' };
    localStorage.setItem('user', JSON.stringify(state.user));
    enterApp();
  };

  // Google Identity Services — 클라이언트 ID 설정 시에만 버튼 렌더
  const tryGsi = () => {
    if (!window.google?.accounts?.id) { setTimeout(tryGsi, 300); return; }
    if (GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
      $('gsi-button').innerHTML =
        '<div style="font-size:12px;color:var(--muted);text-align:center;padding:14px;border:1px dashed var(--line);border-radius:14px;width:100%">' +
        'Google 로그인은 클라이언트 ID 설정 후 활성화됩니다<br>(app.js의 GOOGLE_CLIENT_ID)</div>';
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (res) => {
        const payload = JSON.parse(atob(res.credential.split('.')[1]));
        state.user = { name: payload.name, email: payload.email, pic: payload.picture };
        localStorage.setItem('user', JSON.stringify(state.user));
        enterApp();
      }
    });
    google.accounts.id.renderButton($('gsi-button'), {
      theme: 'filled_black', size: 'large', shape: 'pill',
      text: 'continue_with', width: 300, locale: 'ko'
    });
  };
  tryGsi();
}

function enterApp() {
  show('home');
  loadTickers();
  connectTickerWs();
  loadFng();
}

/* ===================== 홈: 시세 ===================== */
async function loadTickers() {
  try {
    const rows = await (await fetch(REST + '/ticker/24hr')).json();
    for (const r of rows) {
      if (!SYMBOLS.includes(r.symbol)) continue;
      state.tickers[r.symbol] = { price: +r.lastPrice, chg: +r.priceChangePercent };
    }
    renderList();
    renderFavs();
  } catch (e) {
    $('coin-list').innerHTML = '<div class="list-loading">시세를 불러오지 못했어요. 네트워크 확인 후 다시 시도.</div>';
  }
}

function connectTickerWs() {
  if (state.ws) state.ws.close();
  const streams = SYMBOLS.map(s => s.toLowerCase() + '@miniTicker').join('/');
  const ws = new WebSocket('wss://fstream.binance.com/stream?streams=' + streams);
  state.ws = ws;
  ws.onopen = () => $('conn-dot').classList.add('live');
  ws.onclose = () => { $('conn-dot').classList.remove('live'); setTimeout(connectTickerWs, 3000); };
  let pending = false;
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data).data;
    if (!d) return;
    const open = +d.o, close = +d.c;
    state.tickers[d.s] = { price: close, chg: open ? (close - open) / open * 100 : 0 };
    if (!pending) {
      pending = true;
      setTimeout(() => { pending = false; renderList(); renderFavs(); }, 800);
    }
  };
}

function renderList() {
  const q = ($('coin-search').value || '').toUpperCase();
  const rows = SYMBOLS
    .filter(s => !q || s.includes(q))
    .map(s => {
      const t = state.tickers[s];
      if (!t) return '';
      const base = s.replace('USDT', '');
      const cls = t.chg >= 0 ? 'up' : 'dn';
      return `<button class="coin-row" data-sym="${s}">
        <div class="coin-ico">${base.slice(0, 3)}</div>
        <div class="coin-meta"><b>${base}</b><span>${s}</span></div>
        <div class="coin-nums">
          <span class="p">$${fmtP(t.price)}</span>
          <span class="c ${cls}">${fmtC(t.chg)}</span>
        </div>
      </button>`;
    }).join('');
  $('coin-list').innerHTML = rows || '<div class="list-loading">검색 결과 없음</div>';
}

function renderFavs() {
  $('fav-strip').innerHTML = state.favs.map(s => {
    const t = state.tickers[s];
    if (!t) return '';
    const base = s.replace('USDT', '');
    const cls = t.chg >= 0 ? 'up' : 'dn';
    return `<button class="fav-chip" data-sym="${s}">
      <b>${base}</b><span class="${cls}">$${fmtP(t.price)} · ${fmtC(t.chg)}</span>
    </button>`;
  }).join('');
}

/* ===================== 공포탐욕지수 ===================== */
async function loadFng() {
  try {
    const d = await (await fetch('https://api.alternative.me/fng/')).json();
    const v = +d.data[0].value;
    const el = $('fng-badge');
    el.textContent = '공포탐욕 ' + v;
    el.classList.toggle('fear', v < 45);
    el.classList.toggle('greed', v > 55);
  } catch (e) { /* 표시만 생략 */ }
}

/* ===================== 차트 ===================== */
const CHART_OPTS = {
  layout: { background: { color: 'transparent' }, textColor: '#A08D9A', fontSize: 11 },
  grid: { vertLines: { color: 'rgba(247,239,244,0.05)' }, horzLines: { color: 'rgba(247,239,244,0.05)' } },
  rightPriceScale: { borderColor: 'rgba(247,239,244,0.1)' },
  timeScale: { borderColor: 'rgba(247,239,244,0.1)', timeVisible: true },
  crosshair: { mode: 0 },
};

function initCharts() {
  state.chart = LightweightCharts.createChart($('chart-main'), CHART_OPTS);
  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#22C55E', downColor: '#EF4444',
    wickUpColor: '#22C55E', wickDownColor: '#EF4444', borderVisible: false,
  });
  state.volSeries = state.chart.addHistogramSeries({
    priceScaleId: 'vol', priceFormat: { type: 'volume' },
  });
  state.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  state.sub = LightweightCharts.createChart($('chart-sub'), CHART_OPTS);
  new ResizeObserver(() => resizeCharts()).observe($('chart-main'));
}

function resizeCharts() {
  const m = $('chart-main'), s = $('chart-sub');
  if (state.chart && m.clientWidth) state.chart.resize(m.clientWidth, m.clientHeight);
  if (state.sub && s.clientWidth) state.sub.resize(s.clientWidth, s.clientHeight);
  drawVpvr();
}

async function openChart(sym) {
  state.sym = sym;
  $('chart-sym').textContent = sym;
  updateFavBtn();
  show('chart');
  await loadKlines();
  connectKlineWs();
}

async function loadKlines() {
  const r = await fetch(`${REST}/klines?symbol=${state.sym}&interval=${state.tf}&limit=500`);
  const rows = await r.json();
  state.candles = rows.map(k => ({
    time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
  state.candleSeries.setData(state.candles);
  state.volSeries.setData(state.candles.map(c => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
  })));
  state.chart.timeScale().fitContent();
  drawIndicators();
  updateHeader();
}

function connectKlineWs() {
  if (state.klineWs) state.klineWs.close();
  const ws = new WebSocket(`${WS}/${state.sym.toLowerCase()}@kline_${state.tf}`);
  state.klineWs = ws;
  ws.onmessage = (ev) => {
    const k = JSON.parse(ev.data).k;
    if (!k) return;
    const c = { time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
    const last = state.candles[state.candles.length - 1];
    if (last && last.time === c.time) state.candles[state.candles.length - 1] = c;
    else state.candles.push(c);
    state.candleSeries.update(c);
    state.volSeries.update({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
    });
    drawIndicators(true);
    updateHeader();
  };
}

function updateHeader() {
  const t = state.tickers[state.sym];
  const last = state.candles[state.candles.length - 1];
  if (last) $('chart-price').textContent = '$' + fmtP(last.close);
  if (t) {
    const el = $('chart-chg');
    el.textContent = fmtC(t.chg);
    el.className = 'chart-chg ' + (t.chg >= 0 ? 'up' : 'dn');
  }
}

/* ===================== 지표 계산 ===================== */
function sma(data, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= n) sum -= data[i - n].close;
    if (i >= n - 1) out.push({ time: data[i].time, value: sum / n });
  }
  return out;
}

function ema(values, n) {
  const k = 2 / (n + 1);
  const out = [];
  let prev;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(data, n = 14) {
  const out = [];
  let gain = 0, loss = 0;
  for (let i = 1; i < data.length; i++) {
    const d = data[i].close - data[i - 1].close;
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) { gain += g / n; loss += l / n; }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
    if (i >= n) out.push({ time: data[i].time, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
  }
  return out;
}

function macd(data, fast = 12, slow = 26, sig = 9) {
  const closes = data.map(c => c.close);
  const fastE = ema(closes, fast), slowE = ema(closes, slow);
  const line = fastE.map((v, i) => v - slowE[i]);
  const signal = ema(line, sig);
  return data.map((c, i) => ({
    time: c.time, macd: line[i], signal: signal[i], hist: line[i] - signal[i],
  })).slice(slow);
}

function bollinger(data, n = 20, mult = 2) {
  const up = [], mid = [], low = [];
  for (let i = n - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += data[j].close;
    const m = sum / n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (data[j].close - m) ** 2;
    const sd = Math.sqrt(v / n);
    mid.push({ time: data[i].time, value: m });
    up.push({ time: data[i].time, value: m + mult * sd });
    low.push({ time: data[i].time, value: m - mult * sd });
  }
  return { up, mid, low };
}

function atr(data, n = 10) {
  const out = [];
  let prev;
  for (let i = 0; i < data.length; i++) {
    const c = data[i], pc = i ? data[i - 1].close : c.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    prev = i === 0 ? tr : (prev * (n - 1) + tr) / n;
    out.push(prev);
  }
  return out;
}

function supertrend(data, n = 10, mult = 3) {
  // 결과: [{time, value, up:boolean}] — 상승/하락 구간 색 분리용
  const a = atr(data, n);
  const out = [];
  let fUp = 0, fDn = Infinity, trendUp = true;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const mid = (c.high + c.low) / 2;
    const bUp = mid - mult * a[i];
    const bDn = mid + mult * a[i];
    fUp = (i && data[i - 1].close > fUp) ? Math.max(bUp, fUp) : bUp;
    fDn = (i && data[i - 1].close < fDn) ? Math.min(bDn, fDn) : bDn;
    if (i) trendUp = c.close > fDn ? true : c.close < fUp ? false : trendUp;
    out.push({ time: c.time, value: trendUp ? fUp : fDn, up: trendUp });
  }
  return out;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function drawFib() {
  state.fibLines.forEach(l => state.candleSeries.removePriceLine(l));
  state.fibLines = [];
  if (!state.inds.has('fib') || !state.candles.length) return;
  let hi = -Infinity, lo = Infinity;
  for (const c of state.candles) { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); }
  for (const lv of FIB_LEVELS) {
    const price = hi - (hi - lo) * lv;
    state.fibLines.push(state.candleSeries.createPriceLine({
      price, color: 'rgba(252,175,69,0.55)', lineWidth: 1, lineStyle: 2,
      title: (lv * 100).toFixed(1) + '%',
    }));
  }
}

function drawVpvr() {
  const cv = $('vpvr-canvas');
  const on = state.inds.has('vpvr') && state.candles.length;
  cv.classList.toggle('on', !!on);
  if (!on) return;
  const box = $('chart-main');
  cv.width = box.clientWidth * 0.38;
  cv.height = box.clientHeight;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);

  let hi = -Infinity, lo = Infinity;
  for (const c of state.candles) { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); }
  const BINS = 28;
  const bins = new Array(BINS).fill(0);
  for (const c of state.candles) {
    const tp = (c.high + c.low + c.close) / 3;
    const i = Math.min(BINS - 1, Math.floor((tp - lo) / (hi - lo) * BINS));
    bins[i] += c.volume;
  }
  const max = Math.max(...bins);
  const poc = bins.indexOf(max);
  const rowH = cv.height / BINS;
  for (let i = 0; i < BINS; i++) {
    const w = bins[i] / max * cv.width;
    const y = cv.height - (i + 1) * rowH; // 가격 낮음=아래
    ctx.fillStyle = i === poc ? 'rgba(225,48,108,0.5)' : 'rgba(131,58,180,0.28)';
    ctx.fillRect(cv.width - w, y, w, rowH - 1);
  }
}

function vwap(data) {
  // ponytail: 세션 구분 없는 누적 VWAP — 일중 리셋 필요해지면 UTC 자정 기준 추가
  const out = [];
  let pv = 0, vol = 0;
  for (const c of data) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume; vol += c.volume;
    out.push({ time: c.time, value: vol ? pv / vol : tp });
  }
  return out;
}

/* ===================== 지표 렌더 ===================== */
const MA_SET = [[20, '#FCAF45'], [60, '#F77737'], [120, '#E1306C'], [200, '#833AB4']];

function drawIndicators(liveOnly) {
  if (liveOnly) return redrawAll(); // 캔들 수 적으니 전체 재계산이 단순·충분
  redrawAll();
}

function redrawAll() {
  // 메인 오버레이 제거 후 재생성
  state.overlays.forEach(s => state.chart.removeSeries(s));
  state.overlays = [];
  state.subSeries.forEach(s => state.sub.removeSeries(s));
  state.subSeries = [];

  const d = state.candles;
  if (!d.length) return;

  if (state.inds.has('ma')) {
    for (const [n, color] of MA_SET) {
      if (d.length < n) continue;
      const s = state.chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s.setData(sma(d, n));
      state.overlays.push(s);
    }
  }

  if (state.inds.has('bb')) {
    const { up, mid, low } = bollinger(d);
    for (const [data, w] of [[up, 1], [mid, 1], [low, 1]]) {
      const s = state.chart.addLineSeries({ color: 'rgba(96,165,250,0.6)', lineWidth: w, priceLineVisible: false, lastValueVisible: false });
      s.setData(data);
      state.overlays.push(s);
    }
  }

  if (state.inds.has('vwap')) {
    const s = state.chart.addLineSeries({ color: '#22D3EE', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    s.setData(vwap(d));
    state.overlays.push(s);
  }

  if (state.inds.has('st')) {
    const st = supertrend(d);
    // 상승/하락 구간 별도 시리즈 — 반대 구간은 whitespace로 끊음
    const upData = st.map(x => x.up ? { time: x.time, value: x.value } : { time: x.time });
    const dnData = st.map(x => !x.up ? { time: x.time, value: x.value } : { time: x.time });
    const sUp = state.chart.addLineSeries({ color: '#22C55E', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    sUp.setData(upData);
    const sDn = state.chart.addLineSeries({ color: '#EF4444', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    sDn.setData(dnData);
    state.overlays.push(sUp, sDn);
  }

  drawFib();
  drawVpvr();

  // 서브차트: RSI 우선, 아니면 MACD
  const sub = $('chart-sub');
  if (state.inds.has('rsi')) {
    sub.classList.remove('hidden');
    const s = state.sub.addLineSeries({ color: '#E1306C', lineWidth: 1.5 });
    s.setData(rsi(d));
    state.subSeries.push(s);
    for (const lvl of [30, 70]) {
      s.createPriceLine({ price: lvl, color: 'rgba(160,141,154,0.4)', lineWidth: 1, lineStyle: 2, title: String(lvl) });
    }
    state.sub.timeScale().fitContent();
  } else if (state.inds.has('macd')) {
    sub.classList.remove('hidden');
    const md = macd(d);
    const hist = state.sub.addHistogramSeries({});
    hist.setData(md.map(x => ({ time: x.time, value: x.hist, color: x.hist >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)' })));
    const l1 = state.sub.addLineSeries({ color: '#FCAF45', lineWidth: 1 });
    l1.setData(md.map(x => ({ time: x.time, value: x.macd })));
    const l2 = state.sub.addLineSeries({ color: '#833AB4', lineWidth: 1 });
    l2.setData(md.map(x => ({ time: x.time, value: x.signal })));
    state.subSeries.push(hist, l1, l2);
    state.sub.timeScale().fitContent();
  } else {
    sub.classList.add('hidden');
  }
  resizeCharts();
}

/* ===================== 분할 차트 ===================== */
const SPLIT_N = 4;

function initSplit() {
  if (state.split.length) return;
  const grid = $('split-grid');
  const defaults = [...new Set([...state.favs, 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'])].slice(0, SPLIT_N);
  for (let i = 0; i < SPLIT_N; i++) {
    const panel = document.createElement('div');
    panel.className = 'split-panel';
    panel.innerHTML = `
      <div class="split-head">
        <select data-i="${i}">${SYMBOLS.map(s =>
          `<option value="${s}" ${s === defaults[i] ? 'selected' : ''}>${s.replace('USDT', '')}</option>`).join('')}
        </select>
        <span class="sp-chg" id="sp-chg-${i}">—</span>
      </div>
      <div class="split-body" id="sp-body-${i}"></div>`;
    grid.appendChild(panel);

    const chart = LightweightCharts.createChart($('sp-body-' + i), {
      ...CHART_OPTS,
      timeScale: { ...CHART_OPTS.timeScale, visible: false },
      rightPriceScale: { ...CHART_OPTS.rightPriceScale, borderVisible: false },
      handleScroll: false, handleScale: false,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22C55E', downColor: '#EF4444',
      wickUpColor: '#22C55E', wickDownColor: '#EF4444', borderVisible: false,
    });
    state.split.push({ chart, series, sym: defaults[i], ws: null });
    loadSplitPanel(i);
  }

  grid.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-i]');
    if (!sel) return;
    const i = +sel.dataset.i;
    state.split[i].sym = sel.value;
    loadSplitPanel(i);
  });

  $('split-tf').addEventListener('change', (e) => {
    state.splitTf = e.target.value;
    for (let i = 0; i < SPLIT_N; i++) loadSplitPanel(i);
  });

  new ResizeObserver(() => state.split.forEach((p, i) => {
    const el = $('sp-body-' + i);
    if (el.clientWidth) p.chart.resize(el.clientWidth, el.clientHeight);
  })).observe(grid);
}

async function loadSplitPanel(i) {
  const p = state.split[i];
  if (p.ws) { p.ws.close(); p.ws = null; }
  try {
    const r = await fetch(`${REST}/klines?symbol=${p.sym}&interval=${state.splitTf}&limit=120`);
    const rows = await r.json();
    const data = rows.map(k => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
    p.series.setData(data);
    p.chart.timeScale().fitContent();
    if (data.length > 1) {
      const chg = (data[data.length - 1].close - data[0].close) / data[0].close * 100;
      const el = $('sp-chg-' + i);
      el.textContent = fmtC(chg);
      el.className = 'sp-chg ' + (chg >= 0 ? 'up' : 'dn');
    }
    const ws = new WebSocket(`${WS}/${p.sym.toLowerCase()}@kline_${state.splitTf}`);
    p.ws = ws;
    ws.onmessage = (ev) => {
      const k = JSON.parse(ev.data).k;
      if (k) p.series.update({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c });
    };
  } catch (e) { /* 개별 패널 실패는 무시 */ }
}

/* ===================== 정보 탭 ===================== */
const PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
];

async function proxyJson(url) {
  let lastErr;
  for (const p of PROXIES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(p + encodeURIComponent(url), { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json(); // 레이트리밋 HTML이면 여기서 throw → 다음 프록시
    } catch (e) { lastErr = e; }
    finally { clearTimeout(t); }
  }
  throw lastErr;
}

async function loadInfo() {
  if (Date.now() - state.infoAt < 60_000) return;
  state.infoAt = Date.now();

  // 공포탐욕
  fetch('https://api.alternative.me/fng/').then(r => r.json()).then(d => {
    const v = +d.data[0].value;
    const el = $('m-fng');
    el.textContent = v + ' · ' + (v < 25 ? '극단적 공포' : v < 45 ? '공포' : v < 55 ? '중립' : v < 75 ? '탐욕' : '극단적 탐욕');
    el.className = v >= 55 ? 'up' : v <= 45 ? 'dn' : '';
  }).catch(() => {});

  // DXY (야후 — CORS 프록시 경유)
  proxyJson('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=5d&interval=1d')
    .then(d => {
      const res = d.chart.result[0];
      const closes = res.indicators.quote[0].close.filter(x => x != null);
      const last = closes[closes.length - 1], prev = closes[closes.length - 2];
      const chg = (last - prev) / prev * 100;
      const el = $('m-dxy');
      el.textContent = last.toFixed(2) + ' (' + fmtC(chg) + ')';
      el.className = chg >= 0 ? 'up' : 'dn';
    }).catch(() => { $('m-dxy').textContent = '로드 실패'; });

  // BTC 펀딩비 + 미결제약정
  fetch(REST + '/premiumIndex?symbol=BTCUSDT').then(r => r.json()).then(d => {
    const f = +d.lastFundingRate * 100;
    const el = $('m-fund');
    el.textContent = f.toFixed(4) + '%';
    el.className = f >= 0 ? 'up' : 'dn';
  }).catch(() => {});
  fetch(REST + '/openInterest?symbol=BTCUSDT').then(r => r.json()).then(d => {
    $('m-oi').textContent = (+d.openInterest).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' BTC';
  }).catch(() => {});

  // 경제 캘린더 (ForexFactory 주간 — 프록시 경유, 실패 시 캐시)
  try {
    let rows;
    try {
      rows = await proxyJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
      localStorage.setItem('cal-cache', JSON.stringify(rows));
    } catch (e) {
      rows = JSON.parse(localStorage.getItem('cal-cache') || 'null');
      if (!rows) throw e;
    }
    const events = rows.filter(e => e.impact === 'High' && e.country === 'USD');
    $('cal-list').innerHTML = events.length ? events.map(e => {
      const d = new Date(e.date);
      const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
      const hm = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      return `<div class="cal-item">
        <div class="cal-date"><b>${d.getMonth() + 1}/${d.getDate()}</b>${day} ${hm}</div>
        <div class="cal-title">${esc(e.title)}</div>
        <div class="cal-imp">HIGH</div>
      </div>`;
    }).join('') : '<div class="list-loading">이번 주 고임팩트 USD 일정 없음</div>';
  } catch (e) {
    $('cal-list').innerHTML = '<div class="list-loading">캘린더 로드 실패</div>';
  }
}

/* ===================== 즐겨찾기 ===================== */
function updateFavBtn() {
  $('btn-fav').classList.toggle('on', state.favs.includes(state.sym));
}

/* ===================== 이벤트 ===================== */
function bindEvents() {
  $('coin-search').addEventListener('input', renderList);

  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-sym]');
    if (row) openChart(row.dataset.sym);
  });

  $('btn-back').onclick = () => show('home');

  $('btn-fav').onclick = () => {
    const i = state.favs.indexOf(state.sym);
    if (i >= 0) state.favs.splice(i, 1); else state.favs.push(state.sym);
    localStorage.setItem('favs', JSON.stringify(state.favs));
    updateFavBtn();
    renderFavs();
  };

  $('tf-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tf]');
    if (!b) return;
    state.tf = b.dataset.tf;
    document.querySelectorAll('#tf-row button').forEach(x => x.classList.toggle('on', x === b));
    loadKlines();
    connectKlineWs();
  });

  $('ind-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ind]');
    if (!b) return;
    const ind = b.dataset.ind;
    // rsi/macd는 서브차트 하나를 공유 — 상호 배타
    if (ind === 'rsi' && !state.inds.has('rsi')) state.inds.delete('macd');
    if (ind === 'macd' && !state.inds.has('macd')) state.inds.delete('rsi');
    if (state.inds.has(ind)) state.inds.delete(ind); else state.inds.add(ind);
    document.querySelectorAll('#ind-row button').forEach(x =>
      x.classList.toggle('on', state.inds.has(x.dataset.ind)));
    redrawAll();
  });

  $('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const tab = b.dataset.tab;
    if (tab === 'chart') openChart(state.sym);
    else if (tab === 'split') { show('split'); initSplit(); }
    else if (tab === 'info') { show('info'); loadInfo(); }
    else show(tab);
  });
}

/* ===================== 시작 ===================== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
initCharts();
bindEvents();
initAuth();
