/*! wait-game.js「蓋大樓」等待用小遊戲：零依賴、零外部資源、零網路請求、不發聲。
 * 玩法參考 iamkun/tower_game（MIT）；程式與畫面為自行實作
 * classic script：掛 window.mountWaitGame / window.WaitGameCore；node 端 module.exports = { mountWaitGame, core }。
 * 邏輯（core：不碰 DOM／時間，亂數用種子，可決定性測試）與繪圖（view：canvas 2D 自繪）分離。
 */
(function () {
'use strict';

/* ===== 1. 純邏輯 core ===== */
// 世界座標：x 向右、y 向上，地面 y=0；螢幕 y = gy - (世界 y - cam)
var CFG = {
  STEP: 1 / 60, MAX_STEPS: 5, MIN_W: 140, MIN_H: 120,
  GROUND_H: 30, FOUND_H: 6, G: 1900, WAIT: 0.42,
  V0: 115, VSTEP: 4, VMAX: 240, CALM: 0.72,   // 擺盪速度 px/秒（140px 寬為準）；減少動態 ×0.72
  TOL: 5, TOL_AT: 25, TOL_N: 40, TOL_MIN: 0.4,   // 完美誤差 25 層起漸縮到 4 成（手準也會結束）
  GROW: 2, GROW_AT: 3, GROW_MAX: 20, CAM_K: 7, MISS_MIN: 0.5
};
// 層數級距 0～9（統計 sc）；舊遊戲是分數級距，看統計以部署日切開
var BUCKETS = [0, 3, 6, 10, 15, 20, 26, 33, 42, 55];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// mulberry32：狀態存在 s.rs，遊戲可原樣重放
function rand(s) {
  s.rs = (s.rs + 0x6D2B79F5) | 0;
  var t = Math.imul(s.rs ^ (s.rs >>> 15), 1 | s.rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 版面。吊點：擺到最旁邊抬高（約 0.22×擺幅）後仍在角落膠囊（底 33px）下
function metrics(W, H) {
  var fh = clamp(Math.round(H * 0.085), 16, 28), baseW = clamp(Math.round(W * 0.42), 110, 200), scale = baseW / 140;
  var amp = Math.max(30, Math.min(W / 2 - baseW / 2 - 4, Math.round(baseW / 2 + 34 * scale))), hangY = Math.round(clamp(36 + amp * 0.22, H * 0.2, H * 0.3));
  return {
    fh: fh, baseW: baseW, scale: scale, hangY: hangY, topY: hangY + fh + Math.max(30, Math.round(H * 0.16)),
    amp: amp, rope: Math.round(amp * 2.4), gy: H - CFG.GROUND_H, tol: CFG.TOL * scale
  };
}

function towerTop(s) { return CFG.FOUND_H + s.floors.length * s.m.fh; }
function topRef(s) { return s.floors.length ? s.floors[s.floors.length - 1] : s.found; }
// 速度只隨層數慢慢變快，有上限
function speed(s) { return Math.min(CFG.VMAX, CFG.V0 + s.floors.length * CFG.VSTEP) * s.m.scale * (s.calm ? CFG.CALM : 1); }
function tolAt(s) { return s.m.tol * Math.max(CFG.TOL_MIN, 1 - Math.max(0, s.floors.length - CFG.TOL_AT) / CFG.TOL_N); }
// 吊鉤像鐘擺，兩側微微抬高；a＝畫面插補的角度超前量
function hook(s, a) {
  var m = s.m, dx = m.amp * Math.sin(s.phi + (a || 0));
  s.hx = s.W / 2 + dx;
  s.hy = m.hangY - m.rope + Math.sqrt(m.rope * m.rope - dx * dx);
}
// 亮燈、陽台掛上時就抽好（吊著就有亮窗，落地不換燈）
function spawn(s) {
  s.cur = { x: s.hx, w: topRef(s).w, top: 0, vy: 0, lit: Math.floor(rand(s) * 65536) & Math.floor(rand(s) * 65536), b: rand(s) < 0.3 };
  s.ph = 'swing'; s.spawnT = s.t;
}

function createGame(o) {
  o = o || {};
  var W = Math.max(CFG.MIN_W, +o.W || 360), H = Math.max(CFG.MIN_H, +o.H || 276);
  var s = {
    W: W, H: H, m: metrics(W, H), t: 0, rs: (o.seed != null ? +o.seed : Math.random() * 4294967296) | 0, calm: !!o.calm,
    cam: 0, floors: [], found: null, cur: null, ph: 'swing', wait: 0, phi: 0, hx: 0, hy: 0, spawnT: 0,
    combo: 0, maxCombo: 0, perfects: 0, points: 0, drops: 0, style: 0, over: false, events: []
  };
  s.found = { x: (W - s.m.baseW) / 2, w: s.m.baseW };
  s.style = Math.floor(rand(s) * 4);
  s.phi = rand(s) < 0.5 ? -Math.PI / 2 : Math.PI / 2;   // 從一側開始擺，第一下就要對
  hook(s); spawn(s);
  return s;
}

// 判定：誤差 ≤ tol 完美不切；有疊到就切；疊不到或剩比 tol 窄就結束
function judge(px, pw, x, w, tol) {
  var d = x - px;
  if (Math.abs(d) <= tol) return { kind: 'perfect', x: px, w: Math.min(w, pw), cx: 0, cw: 0 };
  var lo = Math.max(x, px), hi = Math.min(x + w, px + pw);
  if (hi - lo < Math.max(CFG.MISS_MIN, tol)) return { kind: 'miss', x: x, w: w, cx: x, cw: w };
  return { kind: 'cut', x: lo, w: hi - lo, cx: d < 0 ? x : hi, cw: w - (hi - lo) };
}
function scoreFor(perfect, combo) { return 10 + (perfect ? 5 * clamp(combo | 0, 1, 6) : 0); }
function scoreBucket(n) {
  n = +n || 0;
  var b = 0;
  for (var i = 1; i < BUCKETS.length; i++) { if (n >= BUCKETS[i]) b = i; else break; }
  return b;
}

function land(s, top) {
  var m = s.m, c = s.cur, n = s.floors.length, p = topRef(s), j = judge(p.x, p.w, c.x - c.w / 2, c.w, tolAt(s));
  s.cur = null;
  if (j.kind === 'miss') {
    s.over = true; s.ph = 'over'; s.combo = 0;
    s.events.push({ t: 'miss', x: j.x, w: j.w, y: c.top - m.fh, vy: c.vy, lit: c.lit }, { t: 'over', floors: n });
    return;
  }
  var perfect = j.kind === 'perfect', x = j.x, w = j.w, g;
  s.combo = perfect ? s.combo + 1 : 0;
  if (perfect) { s.perfects++; if (s.combo > s.maxCombo) s.maxCombo = s.combo; }
  // 前 20 層連續完美 3 次起加寬 2px（不超過起始寬）
  if (perfect && s.combo >= CFG.GROW_AT && n < CFG.GROW_MAX && w < s.found.w) { g = Math.min(CFG.GROW * m.scale, s.found.w - w); x -= g / 2; w += g; }
  var pts = scoreFor(perfect, s.combo);
  s.points += pts;
  s.floors.push({ x: x, w: w, lit: c.lit, b: c.b });
  s.events.push({ t: 'land', n: n + 1, perfect: perfect, combo: s.combo, pts: pts, x: x, w: w });
  if (j.kind === 'cut') s.events.push({ t: 'cut', x: j.cx, w: j.cw, y: top, left: j.cx < x, lit: c.lit });
  s.ph = 'wait'; s.wait = CFG.WAIT;
}

// inp.drop：這一步要不要放下。先用畫面上的位置放下，再往前擺
function step(s, dt, inp) {
  if (s.over || !(dt > 0)) return s;
  dt = Math.min(dt, 0.1); inp = inp || {};
  var m = s.m, c = s.cur;
  s.t += dt;
  if (s.ph === 'swing' && inp.drop) { s.ph = 'fall'; c.x = s.hx; c.top = s.cam + m.gy - s.hy; c.vy = 0; s.drops++; s.events.push({ t: 'drop' }); }
  s.phi = (s.phi + speed(s) / m.amp * dt) % (Math.PI * 2);
  hook(s);
  if (s.ph === 'wait') {
    s.wait -= dt;
    if (s.wait <= 0) spawn(s);
  }
  if (s.ph === 'fall') {
    c.vy += CFG.G * dt; c.top -= c.vy * dt;
    var top = towerTop(s);
    if (c.top - m.fh <= top) land(s, top);
  }
  // 往上捲，塔頂停在 topY；減少動態直接到位
  var target = Math.max(0, towerTop(s) - (m.gy - m.topY));
  s.cam = s.calm ? target : s.cam + (target - s.cam) * (1 - Math.exp(-CFG.CAM_K * dt));
  return s;
}

// 固定步長：這幀跑幾步；超過 5 步丟掉積欠
function fixedSteps(acc, frameDt) {
  var d = +frameDt;
  if (!(d > 0)) d = 0;
  if (d > 0.25) d = 0.25;
  acc = (+acc || 0) + d;
  var n = Math.floor(acc / CFG.STEP + 1e-9);
  if (n > CFG.MAX_STEPS) { n = CFG.MAX_STEPS; acc = 0; } else acc = Math.max(0, acc - n * CFG.STEP);
  return { n: n, acc: acc };
}

// 換尺寸（轉向）：寬度按起始寬比例縮放並置中，不重來
function resize(s, W, H) {
  W = Math.max(CFG.MIN_W, W); H = Math.max(CFG.MIN_H, H);
  if (W === s.W && H === s.H) return s;
  var m0 = s.m, c0 = s.W / 2, i, a;
  s.W = W; s.H = H; s.m = metrics(W, H);
  var k = s.m.baseW / m0.baseW, ky = s.m.fh / m0.fh, list = s.floors.concat([s.found]);
  if (s.cur) list.push(s.cur);
  for (i = 0; i < list.length; i++) { a = list[i]; a.x = W / 2 + (a.x - c0) * k; a.w *= k; }
  if (s.cur) { s.cur.top *= ky; s.cur.vy *= ky; }
  s.cam *= ky;
  hook(s);
  return s;
}

var core = {
  CFG: CFG, SCORE_BUCKETS: BUCKETS,
  clamp: clamp, rand: rand, metrics: metrics, createGame: createGame, step: step, resize: resize,
  judge: judge, scoreFor: scoreFor, scoreBucket: scoreBucket, fixedSteps: fixedSteps,
  speed: speed, tolAt: tolAt, towerTop: towerTop, hook: hook
};

/* ===== 2. 介面與繪圖（view） ===== */
var FONT = '"PingFang TC","Heiti TC","Microsoft JhengHei","微軟正黑體",sans-serif';
var TAU = Math.PI * 2;
var STYLE_ID = 'wg-style';

var LABELS = {
  title: '蓋大樓',
  intro: '點一下放下樓層，疊得越準蓋得越高',
  keys: '也可以按空白鍵或 Enter',
  start: '開始蓋',
  startAria: '開始蓋大樓',
  overTitle: '你蓋了 {n} 層樓！',
  overZero: '這次沒疊上去',
  overBody: '第 {m} 層沒疊上，分數 {p}',
  overIdle: '一陣子沒動，這局先到這裡',
  best: '最高紀錄 {n} 層',
  newBest: '新紀錄！',
  again: '再蓋一棟',
  againAria: '再蓋一棟，重新開始',
  paused: '先停一下',
  resume: '繼續蓋',
  resumeAria: '繼續蓋大樓',
  floor: '第 {n} 層',
  score: '分數 {p}',
  perfect: '完美！',
  perfectN: '完美！×{c}',
  liveFloor: '蓋好第 {n} 層',
  livePerfect: '完美，連續 {c} 次，蓋好第 {n} 層',
  liveOver: '這局結束，你蓋了 {n} 層樓。',
  skip: '跳過遊戲',
  skipped: '好，不玩了。結果好了會在這裡出現。',
  aria: '蓋大樓小遊戲：吊著的樓層會左右擺，點一下畫面或按空白鍵放下，疊得越準蓋得越高。'
};

// 介面色取自設計系統；頁面有 --u2-* 以頁面為準
var BUILTIN = {
  light: { bg: '#ece5d9', paper: '#f5f1eb', vellum: '#fffdf8', wood: '#6b4a26', ink: '#2c2522', ink2: '#5a4d44', onWood: '#fffdf8' },
  dark:  { bg: '#171310', paper: '#1f1b17', vellum: '#2d2722', wood: '#c9a87c', ink: '#f5f1eb', ink2: '#c4b8ad', onWood: '#1f1b17' }
};
var VARMAP = {
  bg: ['--u2-sunken'], paper: ['--u2-paper'], vellum: ['--u2-vellum'], wood: ['--u2-wood-600', '--accent'],
  ink: ['--u2-ink', '--foreground'], ink2: ['--u2-ink-2', '--muted-foreground'], onWood: ['--u2-on-wood']
};
var OVERRIDE = { bg: 'bg', fg: 'ink', accent: 'wood', muted: 'ink2' };
// 場景色：明亮溫暖；深色是暖色傍晚。sky：低 → 中 → 高，各 [上, 下]
var SCENE = {
  light: {
    sky: [['#d6e6ea', '#f6efe3'], ['#efdcc6', '#fbefe0'], ['#ead6d4', '#f9e4cf']],
    sun: '#f6cf7a', cloud: '#ffffff', far: '#e0d6c6', ground: '#ddd1bd', grass: '#b7c896', shrub: '#93ad7c', found: '#b9ad9c',
    walls: ['#f3e7d3', '#e9d6bd', '#dfe3d5', '#f0dccd'], line: '#8d7f72', slab: '#cbb9a0',
    glass: '#c3d6da', lit: '#f6d488', frame: '#fffdf8', rail: '#6b4a26', awn: '#8a6539', awn2: '#fffdf8', door: '#6b4a26',
    rope: '#5a4d44', flash: '#fffdf8', star: ''
  },
  dark: {
    sky: [['#1d1b20', '#2b241f'], ['#271f27', '#352920'], ['#2c2131', '#3b2b23']],
    sun: '#ecdcae', cloud: '#3d3530', far: '#2a241f', ground: '#2a241f', grass: '#3f4c35', shrub: '#4f6343', found: '#4c443c',
    walls: ['#5a4e44', '#54493f', '#4b534d', '#5c4c46'], line: '#9a8878', slab: '#6b5e52',
    glass: '#2b3236', lit: '#e9c46a', frame: '#6a5d52', rail: '#c9a87c', awn: '#c9a87c', awn2: '#2d2722', door: '#c9a87c',
    rope: '#c4b8ad', flash: '#f7e3b0', star: '#f5f1eb'
  }
};

var CSS = '.wg-root{position:relative;box-sizing:border-box;width:100%;display:flex;flex-direction:column;overflow:hidden;contain:layout paint;' +
  'border:2px solid var(--wg-ink);border-radius:22px;background:var(--wg-bg);color:var(--wg-ink);font-family:' + FONT + ';-webkit-tap-highlight-color:transparent}' +
  '.wg-root [hidden]{display:none!important}.wg-bare{border:0;border-radius:0;background:transparent}' +
  '.wg-bar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:0 6px 0 16px;background:var(--wg-paper);border-bottom:2px solid var(--wg-ink)}' +
  '.wg-title{font-size:.9375rem;font-weight:700;letter-spacing:.06em}' +
  '.wg-skip{min-height:44px;min-width:44px;margin:0;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--wg-ink2);font:inherit;font-size:.875rem;text-decoration:underline;cursor:pointer}' +
  '.wg-skip:focus-visible,[data-kbd="1"] .wg-canvas:focus-visible{outline:3px solid var(--wg-wood);outline-offset:-3px}' +
  '.wg-field{position:relative;flex:1 1 auto;min-height:0;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
  '.wg-canvas{position:absolute;left:0;top:0;width:100%;height:100%;outline:none;cursor:pointer}' +
  '.wg-panel{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 16px;text-align:center;touch-action:manipulation}' +
  '.wg-panel:before{content:"";position:absolute;left:0;top:0;right:0;bottom:0;background:var(--wg-vellum);opacity:.8}' +
  '.wg-panel>*{position:relative;margin:0}' +
  '.wg-card{inset:50% auto auto 8px;transform:translateY(-50%);max-width:min(64%,300px);gap:2px;padding:10px 14px 12px;border-radius:16px}' +
  '.wg-card:before{border-radius:inherit;opacity:.92}.wg-card .wg-ph{font-size:1.125rem}' +
  '.wg-ph{font-size:1.25rem;font-weight:700;line-height:1.35}' +
  '.wg-pb{max-width:22em;font-size:.9375rem;line-height:1.6;color:var(--wg-ink2);text-wrap:balance}' +
  '.wg-pm{font-size:.9375rem;font-weight:700;color:var(--wg-wood)}' +
  '.wg-btn{min-height:44px;min-width:44px;margin-top:4px;padding:0 24px;border:0;border-radius:12px;background:var(--wg-wood);color:var(--wg-onwood);font:inherit;font-size:1rem;font-weight:700;cursor:pointer}' +
  '.wg-btn:focus-visible{outline:3px solid var(--wg-ink);outline-offset:3px}' +
  '.wg-pk{font-size:.875rem;color:var(--wg-ink2)}' +
  '.wg-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
  '.wg-note{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:.9375rem;line-height:1.7;color:var(--wg-ink2)}';

function noop() {}
function noopApi() { return { destroy: noop, pause: noop, resume: noop, skip: noop, getState: function () { return { status: 'destroyed' }; } }; }
function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
function mm(q) { try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; } }
function font(px, w) { return (w || 400) + ' ' + px + 'px ' + FONT; }
function fmt(t, v) { return String(t).replace(/\{(\w)\}/g, function (a, k) { return v[k] != null ? v[k] : ''; }); }
function mix(a, b, t) {
  var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16), out = '#', k, c;
  for (k = 16; k >= 0; k -= 8) { c = Math.round(((x >> k) & 255) * (1 - t) + ((y >> k) & 255) * t); out += (c < 16 ? '0' : '') + c.toString(16); }
  return out;
}

function mountWaitGame(container, options) {
  var o = options || {};
  if (!container || typeof container.appendChild !== 'function' || typeof document === 'undefined') return noopApi();
  var win = window;
  var cv = el('canvas', 'wg-canvas'), ctx = null;
  try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return noopApi();

  var L = {}, k;
  for (k in LABELS) L[k] = (o.labels && typeof o.labels[k] === 'string') ? o.labels[k] : LABELS[k];
  var totalH = clamp(Math.round(+o.height || 280), 200, 360);
  var storageKey = (typeof o.storageKey === 'string' && o.storageKey) ? o.storageKey : 'wg.tower.best';
  var mqReduce = mm('(prefers-reduced-motion: reduce)'), mqDark = mm('(prefers-color-scheme: dark)'), mqCoarse = mm('(pointer: coarse)');
  var reduce = !!(mqReduce && mqReduce.matches), coarse = !!(mqCoarse && mqCoarse.matches);

  /* ---- DOM ---- */
  if (!document.getElementById(STYLE_ID)) {
    var styleEl = el('style'); styleEl.id = STYLE_ID; styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);
  }
  var bare = o.frame === false;   // 頁面自己有外框：不畫框、高度跟容器
  var root = el('div', bare ? 'wg-root wg-bare' : 'wg-root'); root.style.height = bare ? '100%' : totalH + 'px';
  var skipBtn = null;
  if (o.skipButton !== false) {
    var bar = el('div', 'wg-bar'), ttl = el('span', 'wg-title');
    ttl.textContent = L.title;
    skipBtn = el('button', 'wg-skip'); skipBtn.type = 'button'; skipBtn.textContent = L.skip;
    bar.appendChild(ttl); bar.appendChild(skipBtn); root.appendChild(bar);
  }
  var field = el('div', 'wg-field');
  cv.tabIndex = 0;
  cv.setAttribute('role', 'img');   // 不用 application（讀屏會吃按鍵）
  cv.setAttribute('aria-label', L.aria);
  var panel = el('div', 'wg-panel'), ph = el('p', 'wg-ph'), pb = el('p', 'wg-pb'), pm = el('p', 'wg-pm'), btn = el('button', 'wg-btn'), pk = el('p', 'wg-pk');
  btn.type = 'button';
  panel.appendChild(ph); panel.appendChild(pb); panel.appendChild(pm); panel.appendChild(btn); panel.appendChild(pk);
  field.appendChild(cv); field.appendChild(panel); root.appendChild(field);
  var live = el('p', 'wg-sr'); live.setAttribute('aria-live', 'polite'); root.appendChild(live);
  var note = el('div', 'wg-note'); note.hidden = true; root.appendChild(note);
  container.appendChild(root);

  /* ---- 狀態 ---- */
  var st = 'ready';  // ready | playing | over | skipped
  var paused = false, destroyed = false, s = null, P = null, SC = SCENE.light;
  var W = 0, H = 0, dpr = 1;
  var best = readBest(), plays = 0, playMs = 0, idleMs = 0, newBest = false, idleEnd = false, overAt = 0, panelKind = '', panelAt = 0;
  var mountAt = now(), fx = [], wantDrop = false, grace = 0, arm = null, inp = { drop: false };
  var raf = 0, last = null, acc = 0, offs = [], observers = [], dq = null;
  var vc = 0, zp = 0, zk = 1, zx = 0;   // 畫面用 cam；結束拉遠的進度、縮放、樓的中心 x
  var skyQ = -1, skyH = 0, skySC = null, skyG = null, skyBot = '', hudN = -1, hudP = -1, hudA = '', hudB = '';

  function on(t, type, fn) { if (!t || !t.addEventListener) return; t.addEventListener(type, fn); offs.push([t, type, fn]); }
  function readBest() {
    try { var v = parseInt(win.localStorage.getItem(storageKey), 10); return v > 0 && v < 1e6 ? v : 0; } catch (e) { return 0; }
  }
  function writeBest(v) { try { win.localStorage.setItem(storageKey, String(v)); } catch (e) {} }
  function emit(type, ms) {
    if (typeof o.onEvent !== 'function') return;
    try { o.onEvent({ type: type, score: s ? s.floors.length : 0, points: s ? s.points : 0, plays: plays, durationMs: Math.round(ms == null ? playMs : ms) }); } catch (e) {}
  }
  function say(t) { if (live.textContent !== t) live.textContent = t; }

  /* ---- 主題與配色 ---- */
  function okColor(c) {
    try {
      ctx.fillStyle = '#010203'; ctx.fillStyle = c; var a = ctx.fillStyle;
      ctx.fillStyle = '#040506'; ctx.fillStyle = c;
      return a === ctx.fillStyle;
    } catch (e) { return false; }
  }
  function detectTheme() {
    var t = o.theme;
    if (t === 'light' || t === 'dark') return t;
    var a = document.documentElement && document.documentElement.getAttribute('data-theme');
    if (a === 'dark' || a === 'light') return a;
    return (mqDark && mqDark.matches) ? 'dark' : 'light';
  }
  function resolvePalette() {
    var theme = detectTheme(), p = { theme: theme }, key, i;
    for (key in BUILTIN[theme]) p[key] = BUILTIN[theme][key];
    if (o.theme !== 'light' && o.theme !== 'dark') {
      var cs = null;
      try { cs = win.getComputedStyle(container); } catch (e) {}
      if (cs) {
        for (key in VARMAP) {
          for (i = 0; i < VARMAP[key].length; i++) {
            var v = (cs.getPropertyValue(VARMAP[key][i]) || '').trim();
            if (v && okColor(v)) { p[key] = v; break; }
          }
        }
      }
    }
    if (o.palette) for (key in OVERRIDE) { if (typeof o.palette[key] === 'string' && okColor(o.palette[key])) p[OVERRIDE[key]] = o.palette[key]; }
    return p;
  }
  function refreshPalette() {
    P = resolvePalette(); SC = SCENE[P.theme];
    for (var key in BUILTIN.light) root.style.setProperty('--wg-' + key.toLowerCase(), P[key]);
    if (!raf) draw();
  }

  /* ---- 尺寸 ---- */
  function layout() {
    var w = Math.floor(field.clientWidth), h = Math.floor(field.clientHeight);
    if (!(w > 0 && h > 0)) return false;
    dpr = Math.min(win.devicePixelRatio || 1, 3);
    var nw = Math.round(w * dpr), nh = Math.round(h * dpr);
    if (cv.width !== nw || cv.height !== nh) { cv.width = nw; cv.height = nh; }
    if (w !== W || h !== H) {
      W = w; H = h;
      if (s && st !== 'ready') resize(s, W, H); else s = newGame();   // 還沒開始：照新尺寸重建
      if (panelKind) showPanel(panelKind);
    }
    return true;
  }
  // 倍率變了但大小沒變（換螢幕、改縮放）：重算畫布
  function onDpr() { layout(); if (!raf) draw(); watchDpr(); }
  function watchDpr() {
    if (dq && dq.removeEventListener) dq.removeEventListener('change', onDpr);
    dq = mm('(resolution: ' + (win.devicePixelRatio || 1) + 'dppx)');
    on(dq, 'change', onDpr);
  }
  function newGame() { return createGame({ W: W || 360, H: H || 276, calm: reduce, seed: o.seed != null ? (+o.seed + plays) : undefined }); }

  /* ---- 覆蓋面板（真按鈕，可用鍵盤操作） ---- */
  function txt(e, t) { e.textContent = t; e.hidden = !t; }
  function showPanel(kind) {
    var n = s ? s.floors.length : 0, small = H > 0 && H < 230, tiny = H > 0 && H < 175;
    if (kind === 'ready') {
      txt(ph, L.title); txt(pb, tiny ? '' : L.intro); txt(pm, best > 0 ? fmt(L.best, { n: best }) : '');
      btn.textContent = L.start; btn.setAttribute('aria-label', L.startAria);
    } else if (kind === 'over') {
      txt(ph, n > 0 ? fmt(L.overTitle, { n: n }) : L.overZero);
      txt(pb, tiny ? '' : (idleEnd ? L.overIdle : (n > 0 ? fmt(L.overBody, { m: n + 1, p: s.points }) : '')));
      txt(pm, newBest ? L.newBest : (best > 0 ? fmt(L.best, { n: best }) : ''));
      btn.textContent = L.again; btn.setAttribute('aria-label', L.againAria);
    } else {
      txt(ph, L.paused); txt(pb, ''); txt(pm, '');
      btn.textContent = L.resume; btn.setAttribute('aria-label', L.resumeAria);
    }
    txt(pk, coarse || small || kind === 'over' ? '' : L.keys);
    if (panelKind !== kind) panelAt = now();
    panel.className = kind === 'over' ? 'wg-panel wg-card' : 'wg-panel';   // 結束：靠左小卡片
    panelKind = kind; panel.hidden = false;
    if (kind === 'over') {   // 卡片右邊放得下整棟樓的縮放與中心
      var r = (+panel.offsetWidth || W / 2 - 8) + 8;
      zx = (r + W) / 2;
      zk = clamp(Math.min((W - r - 16) / s.found.w, (s.m.gy - 16) / (towerTop(s) + 4)), 0.05, 1);
    }
  }
  function hidePanel() { panelKind = ''; panel.hidden = true; }

  /* ---- 輸入 ---- */
  function setTouch() { cv.style.touchAction = (st === 'playing' && !paused) ? 'none' : 'manipulation'; }   // 遊戲中才擋捲動
  function focusCv() { try { cv.focus({ preventScroll: true }); } catch (e) {} }
  // 用鍵盤時才畫畫布焦點框
  function kbd(v) { root.setAttribute('data-kbd', v); }
  function onDown(e) {
    if (destroyed || st === 'skipped') return;
    kbd(0);
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (st === 'playing' && !paused) { wantDrop = true; focusCv(); return; }   // 按下就放
    arm = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() };   // 非遊戲中：放開才算點（捲動不誤觸）
  }
  function onUp(e) {
    if (destroyed || !arm || arm.id !== e.pointerId) return;
    var a = arm, dx = e.clientX - a.x, dy = e.clientY - a.y;
    arm = null;
    if (e.target !== btn && dx * dx + dy * dy < 196 && now() - a.t < 900) activate();   // 按鈕有自己的 click
  }
  function onCancel() { arm = null; }
  function activate() {
    if (destroyed) return;
    if (st === 'ready') startRound();
    else if (st === 'over') { if (panelKind === 'over' && now() - panelAt > 350) startRound(); }
    else if (st === 'playing' && paused) resumeGame();
  }
  function onKeyDown(e) {
    if (destroyed || e.ctrlKey || e.metaKey || e.altKey) return;
    var kk = e.key || '', act = kk === ' ' || e.code === 'Space' || kk === 'Enter';
    var pauseKey = e.code === 'KeyP' || kk === 'p' || kk === 'P' || kk === 'Escape';
    if (st === 'playing' && !paused) {
      if (act) { if (!e.repeat) wantDrop = true; } else if (pauseKey) { if (!e.repeat) doPause(); } else return;
    } else if (st === 'playing') {
      if (!(act || pauseKey)) return;
      if (!e.repeat) resumeGame();
    } else if (st === 'ready' || st === 'over') {
      if (!act) return;
      if (!e.repeat) activate();
    } else return;
    e.preventDefault();
  }

  /* ---- 回合與暫停 ---- */
  function startRound() {
    plays++;
    s = newGame();
    st = 'playing'; paused = idleEnd = newBest = false; playMs = idleMs = zp = 0; grace = 250;
    fx.length = 0; acc = 0; last = null; wantDrop = false; arm = null;
    hidePanel(); setTouch(); focusCv();
    say(fmt(L.floor, { n: 1 }));
    emit('start', 0);
    ensureLoop();
  }
  // 疊不上或 30 秒沒放（idle）都結束（頁面看到 over 直接切結果）；有舊紀錄才說「新紀錄！」
  function finishRound(idle) {
    var n = s.floors.length;
    st = 'over'; overAt = now(); wantDrop = false; idleEnd = !!idle;
    newBest = best > 0 && n > best;
    if (n > best) { best = n; writeBest(best); }
    setTouch();
    say(fmt(L.liveOver, { n: n }) + (newBest ? L.newBest : (best > 0 ? fmt(L.best, { n: best }) : '')));
    emit('over');
  }
  function doPause() {
    if (destroyed || st !== 'playing' || paused) return;
    paused = true; wantDrop = false;
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
    showPanel('paused'); setTouch(); draw();
    emit('pause');
  }
  function resumeGame() {
    if (destroyed || st !== 'playing' || !paused) return;
    paused = false; last = null; acc = idleMs = 0; grace = 250;
    hidePanel(); setTouch(); focusCv();
    emit('resume');
    ensureLoop();
  }
  function doSkip() {
    if (destroyed || st === 'skipped') return;
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
    var wasPlaying = st === 'playing';
    st = 'skipped'; paused = false; wantDrop = false; arm = null;
    field.hidden = true; note.textContent = L.skipped; note.hidden = false;
    if (skipBtn) skipBtn.hidden = true;
    emit('skip', now() - mountAt);
    if (typeof o.onSkip === 'function') { try { o.onSkip(wasPlaying); } catch (e) {} }
  }

  /* ---- 迴圈（只用 rAF，不開計時器） ---- */
  function wantLoop() { return !destroyed && !paused && (st === 'playing' || (st === 'over' && (fx.length > 0 || panelKind !== 'over' || zp < 1))); }
  function ensureLoop() { if (!raf && wantLoop()) { last = null; raf = win.requestAnimationFrame(frame); } }
  function frame(ts) {
    raf = 0;
    if (destroyed) return;
    var dt = last == null ? 0 : (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    update(dt);
    draw();
    if (wantLoop()) raf = win.requestAnimationFrame(frame);
  }
  function update(dt) {
    var i, f;
    if (st === 'playing' && !paused && s) {
      if (grace > 0) { grace -= dt * 1000; wantDrop = false; }   // 開始後 0.25 秒不收放下（擋連點）
      var r = fixedSteps(acc, dt);
      acc = r.acc;
      for (i = 0; i < r.n && !s.over; i++) { inp.drop = wantDrop; wantDrop = false; step(s, CFG.STEP, inp); }
      playMs += dt * 1000;
      idleMs = s.ph === 'swing' ? idleMs + dt * 1000 : 0;
      consume();
      if (s.over) finishRound();
      else if (idleMs > 30000) finishRound(1);
    }
    for (i = fx.length - 1; i >= 0; i--) {
      f = fx[i]; f.t += dt;
      if (f.k === 'chunk' && !reduce) { f.vy -= CFG.G * 0.8 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.r += f.vr * dt; }
      if (f.t >= f.dur) fx.splice(i, 1);
    }
    if (st === 'over' && panelKind !== 'over' && now() - overAt >= (reduce ? 300 : 800)) showPanel('over');   // 先演完掉落
    if (panelKind === 'over') zp = reduce ? 1 : Math.min(1, zp + dt / 0.6);   // 再拉遠鏡頭
  }
  function chunk(e, dir, vy, dur) {
    fx.push({ k: 'chunk', x: e.x, y: e.y, w: e.w, lit: e.lit, vx: dir * 50, vy: vy, r: 0, vr: dir * 2.6, t: 0, dur: reduce ? 0.35 : dur });
  }
  function consume() {
    var ev = s.events, i, e;
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (e.t === 'land') {
        idleMs = 0;
        say(e.perfect && e.combo > 1 ? fmt(L.livePerfect, { c: e.combo, n: e.n }) : fmt(L.liveFloor, { n: e.n }));
        if (e.perfect) {
          var tx = e.combo > 1 ? fmt(L.perfectN, { c: e.combo }) : L.perfect;
          fx.push({ k: 'text', text: tx, x: e.x + e.w / 2, y: towerTop(s), t: 0, dur: 0.9 });
          if (!reduce) fx.push({ k: 'flash', i: e.n - 1, t: 0, dur: 0.32 });
        }
      } else if (e.t === 'cut') chunk(e, e.left ? -1 : 1, -60, 1.1);
      else if (e.t === 'miss') chunk(e, e.x + e.w / 2 < s.W / 2 ? -1 : 1, -e.vy * 0.6, 1.4);
      else if (e.t === 'drop') idleMs = 0;
    }
    ev.length = 0;
  }

  /* ---- 繪圖 ---- */
  function rrect(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }   // 舊瀏覽器方角
  function sy(wy) { return s.m.gy - (wy - vc); }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  // 一層樓：牆、樓板、窗（亮燈）、偶有陽台；一樓店面。hi：吊著／掉落／切下的描木色框
  function drawFloor(x, y, w, h, f, shop, hi) {
    var C = SC, i, n, ww, wh, gp, x0, wy, span, lit = f ? f.lit : 0;
    if (P.theme === 'dark') lit |= lit >> 3;
    ctx.fillStyle = C.walls[s.style % 4]; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.slab; ctx.fillRect(x, y, w, Math.max(2, h * 0.12));
    if (shop) {
      for (i = 0; i * 6 < w; i++) { ctx.fillStyle = i % 2 ? C.awn2 : C.awn; ctx.fillRect(x + i * 6, y + h * 0.12, Math.min(6, w - i * 6), h * 0.22); }
      ctx.globalAlpha = 0.6; ctx.fillStyle = C.lit; ctx.fillRect(x + 4, y + h * 0.44, Math.max(0, w - 8), h * 0.46); ctx.globalAlpha = 1;
      var dw = Math.min(10, w * 0.22); ctx.fillStyle = C.door; ctx.fillRect(x + w / 2 - dw / 2, y + h * 0.4, dw, h * 0.6);
    } else {
      ww = clamp(h * 0.4, 5, 11); wh = h * 0.46; gp = ww * 0.9;
      n = Math.min(16, Math.max(0, Math.floor((w - 8 + gp) / (ww + gp))));
      span = n * ww + (n - 1) * gp; x0 = x + (w - span) / 2; wy = y + h * 0.3;
      for (i = 0; i < n; i++) {
        ctx.fillStyle = C.frame; ctx.fillRect(x0 + i * (ww + gp) - 1, wy - 1, ww + 2, wh + 2);
        ctx.fillStyle = (lit >> i) & 1 ? C.lit : C.glass; ctx.fillRect(x0 + i * (ww + gp), wy, ww, wh);
      }
      if (f && f.b && n >= 2) {
        var ry = y + h * 0.62, q;
        ctx.strokeStyle = C.rail; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.moveTo(x0 - 2, ry); ctx.lineTo(x0 + span + 2, ry);
        for (q = x0; q <= x0 + span; q += 4) { ctx.moveTo(q, ry); ctx.lineTo(q, y + h - 1.5); }
        ctx.stroke();
      }
    }
    ctx.strokeStyle = hi ? P.wood : C.line; ctx.lineWidth = hi ? 1.5 : 1; ctx.beginPath(); ctx.rect(x + 0.5, y + 0.5, Math.max(0, w - 1), h - 1); ctx.stroke();
  }

  function drawSky() {
    var m = s.m, k = SC.sky, q = Math.round(clamp(s.cam / (m.fh * 14), 0, 2) * 12) / 12, i, j, x, y;
    if (q !== skyQ || H !== skyH || SC !== skySC) {   // 漸層只在天色變時重做
      i = Math.min(1, Math.floor(q));
      var top = mix(k[i][0], k[i + 1][0], q - i);
      skyBot = mix(k[i][1], k[i + 1][1], q - i);
      skyG = null;
      if (ctx.createLinearGradient) { skyG = ctx.createLinearGradient(0, 0, 0, H); skyG.addColorStop(0, top); skyG.addColorStop(1, skyBot); }
      skyQ = q; skyH = H; skySC = SC;
    }
    ctx.fillStyle = skyG || skyBot; ctx.fillRect(0, 0, W, H);
    if (SC.star) {
      ctx.fillStyle = SC.star; ctx.globalAlpha = 0.3 + q * 0.2;
      for (j = 0; j < 14; j++) ctx.fillRect((j * 73 % 97) / 97 * W, (j * 41 % 89) / 89 * H * 0.55, 1.6, 1.6);
    }
    ctx.fillStyle = SC.sun; ctx.globalAlpha = 0.25; circle(W - 48, 62, 22); ctx.globalAlpha = 0.95; circle(W - 48, 62, 12);
    var base = s.cam * 0.5, drift = reduce ? 0 : s.t, span = W + 120, j0 = Math.max(0, Math.floor((base + m.gy - H - 230) / 110));
    ctx.fillStyle = SC.cloud; ctx.globalAlpha = P.theme === 'dark' ? 0.7 : 0.85;
    for (j = j0; j < j0 + 6; j++) {
      y = m.gy - (150 + j * 110 + (j * 37) % 40 - base);
      if (y < -30 || y > H + 30) continue;
      x = ((j * 0.618 % 1) * span + drift * (6 + (j % 3) * 4)) % span - 60;
      var r = 11 + (j % 3) * 4;
      circle(x, y, r); circle(x + r, y + r * 0.3, r * 0.75); circle(x - r, y + r * 0.35, r * 0.65);
    }
    ctx.globalAlpha = 1;
  }
  function drawGround() {
    var m = s.m, g = m.gy + vc, fy = m.gy + vc * 0.55, x, i, bw, bh, f = s.found;
    if (fy - 60 < H) {   // 遠方街景
      ctx.fillStyle = SC.far;
      for (x = 0, i = 0; x < W; i++, x += bw) { bw = 20 + (i * 7 % 4) * 7; bh = 22 + (i * 13 % 5) * 9; ctx.fillRect(x, fy - bh, bw - 3, bh + Math.max(0, H - fy)); }
    }
    if (g >= H + 2) return;
    ctx.fillStyle = SC.ground; ctx.fillRect(0, g, W, H - g + 1);
    ctx.fillStyle = SC.grass; ctx.fillRect(0, g, W, 4);
    ctx.fillStyle = SC.shrub;
    for (i = 0; i < 9; i++) {
      x = (i * 0.137 + 0.04) % 1 * W;
      if (x > f.x - 14 && x < f.x + f.w + 14) continue;
      circle(x, g - 2, 6 + (i % 3) * 2);
    }
  }
  function drawCrane() {
    var m = s.m, hx = s.hx, hy = s.hy - 9, c = s.cur;
    ctx.strokeStyle = SC.rope; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W / 2, m.hangY - m.rope); ctx.lineTo(hx, hy); ctx.stroke();
    if (s.ph === 'swing' && c) {
      var x = hx - c.w / 2;
      ctx.globalAlpha = reduce ? 1 : clamp((s.t - s.spawnT) / 0.15, 0, 1);
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + c.w * 0.2, s.hy); ctx.lineTo(hx, hy); ctx.lineTo(x + c.w * 0.8, s.hy); ctx.stroke();
      drawFloor(x, s.hy, c.w, m.fh, c, s.floors.length === 0, 1);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = SC.rope; rrect(hx - 4, hy - 4, 8, 6, 2); ctx.fill();
    if (s.ph === 'fall' && c) drawFloor(c.x - c.w / 2, sy(c.top), c.w, m.fh, c, s.floors.length === 0, 1);
  }
  function pill(t, x, y, al, px, col, a) {
    ctx.font = font(px, 700);
    var w = ctx.measureText(t).width + 16, h = px + 10, x0 = al === 1 ? x - w : (al === 2 ? x - w / 2 : x);
    ctx.globalAlpha = a * 0.88; ctx.fillStyle = P.vellum; rrect(x0, y, w, h, h / 2); ctx.fill();
    ctx.globalAlpha = a; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, x0 + w / 2, y + h / 2 + 1); ctx.globalAlpha = 1;
  }
  function drawFx() {
    var i, f, kk, fh = s.m.fh;
    for (i = 0; i < fx.length; i++) {
      f = fx[i]; kk = f.t / f.dur;
      if (f.k === 'chunk') {
        ctx.save(); ctx.translate(f.x + f.w / 2, sy(f.y) - fh / 2);
        if (f.r) ctx.rotate(f.r);
        ctx.globalAlpha = reduce ? 1 - kk : clamp((1 - kk) / 0.4, 0, 1);
        drawFloor(-f.w / 2, -fh / 2, f.w, fh, f, false, 1);
        ctx.restore(); ctx.globalAlpha = 1;
      } else if (f.k === 'flash') {
        var fl = s.floors[f.i];
        if (fl) { ctx.globalAlpha = 0.75 * (1 - kk); ctx.fillStyle = SC.flash; ctx.fillRect(fl.x - 2, sy(CFG.FOUND_H + (f.i + 1) * fh) - 2, fl.w + 4, fh + 4); ctx.globalAlpha = 1; }
      } else {
        pill(f.text, f.x, sy(f.y) - 30 - (reduce ? 0 : 14 * kk), 2, 15, P.wood, 1 - kk * kk);
      }
    }
  }

  // 結束拉遠：樓以地面為基準縮 k 倍、移到卡片右邊；天空地面不縮
  function draw() {
    if (destroyed || !s || !W || st === 'skipped') return;
    var m = s.m, n = s.floors.length, i, f, y, e = 1 - Math.pow(1 - zp, 3), k = 1 + (zk - 1) * e, G;
    vc = s.cam * (1 - e); G = m.gy + vc;
    if (st === 'playing' && !paused) hook(s, speed(s) / m.amp * acc);   // 插補到現在（不頓），放下也用這位置
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    drawSky();
    drawGround();
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (W / 2 + (zx - W / 2) * e - k * W / 2), dpr * G * (1 - k));
    ctx.fillStyle = SC.found; ctx.fillRect(s.found.x, G - CFG.FOUND_H, s.found.w, CFG.FOUND_H + 2);
    for (i = 0; i < n; i++) {
      y = sy(CFG.FOUND_H + (i + 1) * m.fh);
      if (k === 1 && (y > H || y + m.fh < 0)) continue;
      f = s.floors[i];
      drawFloor(f.x, y, f.w, m.fh, f, i === 0);
      if (i === n - 1) { ctx.fillStyle = SC.slab; ctx.fillRect(f.x - 1, y - 3, f.w + 2, 3); }   // 女兒牆
    }
    if (!e) drawCrane();
    drawFx();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st === 'playing') {
      if (hudN !== n) { hudN = n; hudA = fmt(L.floor, { n: n + 1 }); }
      if (hudP !== s.points) { hudP = s.points; hudB = fmt(L.score, { p: s.points }); }
      pill(hudA, 10, 8, 0, 15, P.ink, 1);
      pill(hudB, W - 10, 9, 1, 13, P.ink2, 1);
    }
  }

  /* ---- 綁定 ---- */
  refreshPalette(); setTouch(); showPanel('ready');
  on(field, 'pointerdown', onDown);
  on(field, 'pointerup', onUp);
  on(field, 'pointercancel', onCancel);
  on(cv, 'keydown', onKeyDown);
  on(document, 'keydown', function () { kbd(1); });
  on(btn, 'click', activate);
  on(field, 'contextmenu', function (e) { if (st === 'playing') e.preventDefault(); });
  if (skipBtn) on(skipBtn, 'click', doSkip);
  on(document, 'visibilitychange', function () { if (document.hidden) doPause(); });
  if (mqReduce) on(mqReduce, 'change', function (e) { reduce = !!e.matches; if (s) s.calm = reduce; if (reduce) fx.length = 0; if (!raf) draw(); });
  if (mqDark) on(mqDark, 'change', function () { if (o.theme !== 'light' && o.theme !== 'dark') refreshPalette(); });
  try {
    if (win.MutationObserver && document.documentElement) {
      var mo = new MutationObserver(refreshPalette);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      observers.push(mo);
    }
  } catch (e) {}
  try {
    if (win.ResizeObserver) {
      var ro = new ResizeObserver(function () { if (layout() && !raf) draw(); });
      ro.observe(field); observers.push(ro);
    } else on(window, 'resize', function () { if (layout() && !raf) draw(); });
  } catch (e) {}
  try {
    if (win.IntersectionObserver) {
      var io = new IntersectionObserver(function (es) { if (es.length && !es[es.length - 1].isIntersecting) doPause(); });
      io.observe(root); observers.push(io);
    }
  } catch (e) {}

  layout(); watchDpr(); draw();

  return {
    pause: doPause,
    resume: resumeGame,
    skip: doSkip,
    getState: function () {
      var t = s ? s.floors.length : 0, r = s ? (t ? s.floors[t - 1] : s.found) : null;
      return { status: destroyed ? 'destroyed' : st, paused: paused, score: t, floors: t, points: s ? s.points : 0,
        perfects: s ? s.perfects : 0, combo: s ? s.combo : 0, width: r ? r.w : 0, targetX: r ? r.x + r.w / 2 : 0,
        hookX: s ? s.hx : 0, phase: s ? s.ph : '', plays: plays, best: best };
    },
    destroy: function () {
      if (destroyed) return;
      destroyed = true;
      if (raf) { try { win.cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
      for (var i = 0; i < offs.length; i++) { try { offs[i][0].removeEventListener(offs[i][1], offs[i][2]); } catch (e) {} }
      offs.length = 0;
      for (i = 0; i < observers.length; i++) { try { observers[i].disconnect(); } catch (e) {} }
      observers.length = 0;
      fx.length = 0;
      if (root.parentNode) root.parentNode.removeChild(root);
      if (!document.querySelector || !document.querySelector('.wg-root')) {
        var sty = document.getElementById(STYLE_ID);
        if (sty && sty.parentNode) sty.parentNode.removeChild(sty);
      }
    }
  };
}

var api = { mountWaitGame: mountWaitGame, core: core };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') { window.mountWaitGame = mountWaitGame; window.WaitGameCore = core; }
})();
