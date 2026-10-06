/*! wait-game.js「守護小屋」等待用小遊戲：零依賴、零外部資源、零網路請求、完全不發聲。
 * classic script，掛 window.mountWaitGame / window.WaitGameCore；node 端 module.exports = { mountWaitGame, core }。
 * 寫法參考公開的入侵者類小遊戲（未複製任何程式碼）；圖形為 canvas 向量自繪；邏輯（core）與繪圖（view）分離。
 */
(function () {
'use strict';

/* ===== 1. 純邏輯 core：不碰 DOM、不碰時間，亂數用種子，可在 node 決定性測試 ===== */
var CFG = {
  STEP: 1 / 60, MAX_STEPS: 5,
  MAX_HP: 5, HEAL_EVERY: 25,
  HOUSE_W: 64, HOUSE_H: 52, BARREL_H: 16, ROOF_DROP: 18, GROUND_H: 30,
  BULLET_SPEED: 430, BULLET_LEN: 10, MAX_BULLETS: 10, FIRE_CD: 0.2,
  FIRST_SPAWN: 0.6
};
// r 半徑；v 速度倍率；pts 基本分；amp/freq 左右擺動；acc 越掉越快
var FOES = {
  mold: { r: 16, v: 0.8, pts: 10, amp: 0, freq: 0, acc: 0 },
  leak: { r: 14, v: 1.15, pts: 10, amp: 0, freq: 0, acc: 0 },
  termite: { r: 14, v: 1, pts: 15, amp: 10, freq: 2.6, acc: 0 },
  roach: { r: 13, v: 1.05, pts: 20, amp: 28, freq: 1.7, acc: 0 },
  noise: { r: 15, v: 0.85, pts: 25, amp: 0, freq: 0, acc: 0.3 }
};
var KEYS = ['mold', 'leak', 'termite', 'roach', 'noise'];
var BUCKETS = [0, 40, 90, 160, 260, 400, 600, 900, 1400, 2200]; // 分數級距 0～9 的下限

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// mulberry32：狀態存在 s.rs，所以整個遊戲狀態可原樣複製、重放
function rand(s) {
  s.rs = (s.rs + 0x6D2B79F5) | 0;
  var t = Math.imul(s.rs ^ (s.rs >>> 15), 1 | s.rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function createGame(o) {
  o = o || {};
  var W = Math.max(140, +o.W || 360), H = Math.max(120, +o.H || 240);
  var seed = o.seed != null ? +o.seed : Math.random() * 4294967296;
  return {
    W: W, H: H, gy: H - CFG.GROUND_H, t: 0, rs: seed | 0,
    hx: W / 2, hp: CFG.MAX_HP, score: 0, kills: 0, combo: 0, leaks: 0, shots: 0,
    spawnT: CFG.FIRST_SPAWN, fireCd: 0, nid: 0,
    bullets: [], foes: [], events: [], over: false
  };
}

// 難度只靠數值：間隔、速度、同時上限隨擊殺數緩升，皆有上限
function difficulty(kills, W, H) {
  var k = Math.max(0, kills | 0);
  var ws = clamp((W || 360) / 420, 0.8, 1.35), hs = clamp((H || 240) / 280, 0.7, 1.3);
  return {
    level: 1 + Math.floor(k / 10),
    interval: Math.max(0.42, 1.25 - k * 0.0115) / ws,
    speed: Math.min(132, 50 + k * 0.95) * hs,
    maxAlive: Math.min(11, Math.round((3 + k / 9) * ws)),
    weights: { mold: 3, leak: 3, termite: 2.5, roach: Math.min(3, 1 + k / 30), noise: 1.5 }
  };
}

function pickType(weights, u) {
  var sum = 0, i;
  for (i = 0; i < KEYS.length; i++) sum += weights[KEYS[i]];
  var x = clamp(u, 0, 0.999999) * sum;
  for (i = 0; i < KEYS.length; i++) { x -= weights[KEYS[i]]; if (x < 0) return KEYS[i]; }
  return KEYS[KEYS.length - 1];
}

function comboMult(c) { return 1 + 0.5 * Math.min(3, Math.floor(Math.max(0, c) / 6)); }
function scoreFor(type, combo) { return Math.round(FOES[type].pts * comboMult(combo)); }
function scoreBucket(sc) {
  sc = +sc || 0;
  var b = 0;
  for (var i = 1; i < BUCKETS.length; i++) { if (sc >= BUCKETS[i]) b = i; else break; }
  return b;
}

// 固定時間步長：這一幀該跑幾步；卡太久（>5 步）就丟掉積欠
function fixedSteps(acc, frameDt) {
  var d = +frameDt;
  if (!(d > 0)) d = 0;
  if (d > 0.25) d = 0.25;
  acc = (+acc || 0) + d;
  var n = Math.floor(acc / CFG.STEP + 1e-9);
  if (n > CFG.MAX_STEPS) { n = CFG.MAX_STEPS; acc = 0; } else acc = Math.max(0, acc - n * CFG.STEP);
  return { n: n, acc: acc };
}

// 子彈是一段 10px 的垂直線，怪物當圓；取線段上離圓心最近的點判斷
function hitBulletFoe(b, f) {
  var cy = clamp(f.y, b.y, b.y + CFG.BULLET_LEN), dx = b.x - f.x, dy = cy - f.y, rr = f.r * 0.92 + 1.5;
  return dx * dx + dy * dy <= rr * rr;
}

function roofY(s, dx) {
  return s.gy - CFG.HOUSE_H + Math.min(Math.abs(dx), CFG.HOUSE_W / 2) / (CFG.HOUSE_W / 2) * CFG.ROOF_DROP;
}
function hitsHouse(s, f) {
  var dx = f.x - s.hx;
  if (Math.abs(dx) > CFG.HOUSE_W / 2 + f.r * 0.5) return false;
  return f.y + f.r * 0.8 >= roofY(s, dx);
}

function foeX(f) {
  return f.amp ? f.bx + f.amp * Math.sin(f.age * f.freq + f.ph) : f.bx;
}

function spawnFoe(s, dif) {
  var type = pickType(dif.weights, rand(s)), sp = FOES[type], r = sp.r, m = r + 6 + sp.amp;
  var bx = 0, tries = 0, ok;
  do {
    bx = m + rand(s) * Math.max(0, s.W - 2 * m);
    ok = true;
    for (var i = 0; i < s.foes.length; i++) {
      var g = s.foes[i];
      if (g.y < r * 3 && Math.abs(g.x - bx) < (g.r + r) * 1.2) { ok = false; break; }
    }
  } while (!ok && ++tries < 5);
  var f = {
    id: ++s.nid, type: type, bx: bx, x: bx, y: -r, r: r, age: 0, ph: rand(s) * 6.2832,
    vy: dif.speed * sp.v * (0.9 + 0.2 * rand(s)), amp: sp.amp, freq: sp.freq, acc: sp.acc, dead: false
  };
  f.x = foeX(f);
  s.foes.push(f);
  return f;
}

function damage(s, f) {
  s.hp -= 1; s.combo = 0; s.leaks++;
  s.events.push({ t: 'leak', x: f.x, y: Math.min(f.y, s.gy) });
  if (s.hp <= 0) { s.hp = 0; s.over = true; s.events.push({ t: 'over', score: s.score }); }
}

function kill(s, f) {
  var pts = scoreFor(f.type, s.combo);
  s.combo++; s.kills++; s.score += pts;
  s.events.push({ t: 'kill', x: f.x, y: f.y, pts: pts, type: f.type, combo: s.combo });
  if (s.kills % CFG.HEAL_EVERY === 0 && s.hp < CFG.MAX_HP) { s.hp++; s.events.push({ t: 'heal' }); }
}

// inp = { dir: -1|0|1（鍵盤）, targetX: number|null（指標／觸控想去的位置）, fire: boolean（想射擊）}
function step(s, dt, inp) {
  if (s.over || !(dt > 0)) return s;
  inp = inp || {};
  dt = Math.min(dt, 0.1);
  s.t += dt;
  var i, f, b, W = s.W;

  var xmin = CFG.HOUSE_W / 2 + 3, xmax = W - xmin;
  if (typeof inp.targetX === 'number' && isFinite(inp.targetX)) {
    var m = W * 2.2 * dt, d = clamp(inp.targetX, xmin, xmax) - s.hx;
    s.hx += clamp(d, -m, m);
  } else if (inp.dir) {
    s.hx += (inp.dir > 0 ? 1 : -1) * clamp(W * 0.8, 240, 560) * dt;
  }
  s.hx = clamp(s.hx, xmin, xmax);

  s.fireCd = Math.max(0, s.fireCd - dt);
  if (inp.fire && s.fireCd <= 0 && s.bullets.length < CFG.MAX_BULLETS) {
    s.bullets.push({ x: s.hx, y: s.gy - CFG.HOUSE_H - CFG.BARREL_H, dead: false });
    s.fireCd = CFG.FIRE_CD; s.shots++;
    s.events.push({ t: 'shoot' });
  }

  var dif = difficulty(s.kills, W, s.H);
  s.spawnT -= dt;
  if (s.spawnT <= 0) {
    if (s.foes.length < dif.maxAlive) spawnFoe(s, dif);
    s.spawnT = dif.interval * (0.75 + 0.5 * rand(s));
  }

  for (i = 0; i < s.foes.length; i++) {
    f = s.foes[i]; f.age += dt;
    f.y += f.vy * (f.acc ? Math.min(2.2, 1 + f.acc * f.age) : 1) * dt;
    f.x = clamp(foeX(f), f.r + 2, W - f.r - 2);
  }
  for (i = 0; i < s.bullets.length; i++) s.bullets[i].y -= CFG.BULLET_SPEED * dt;

  // 子彈打怪：一顆只打一隻（最低的），一隻被第一顆命中就死
  for (i = 0; i < s.bullets.length; i++) {
    b = s.bullets[i];
    if (b.dead) continue;
    var best = null;
    for (var j = 0; j < s.foes.length; j++) {
      f = s.foes[j];
      if (!f.dead && f.y >= 4 && hitBulletFoe(b, f) && (!best || f.y > best.y)) best = f;   // 還沒進到畫面的打不到
    }
    if (best) { b.dead = true; best.dead = true; kill(s, best); }
    else if (b.y < -CFG.BULLET_LEN) b.dead = true;
  }

  // 漏掉（掉到地面）或撞上屋頂：屋況 -1、連擊歸零
  for (i = 0; i < s.foes.length && !s.over; i++) {
    f = s.foes[i];
    if (f.dead) continue;
    if (f.y + f.r * 0.7 >= s.gy || hitsHouse(s, f)) { f.dead = true; damage(s, f); }
  }

  s.foes = s.foes.filter(function (g) { return !g.dead; });
  s.bullets = s.bullets.filter(function (g) { return !g.dead; });
  return s;
}

function resize(s, W, H) {
  W = Math.max(140, W); H = Math.max(120, H);
  if (W === s.W && H === s.H) return s;
  var kx = W / s.W, gy = H - CFG.GROUND_H, ky = gy / s.gy, i, a;
  s.hx *= kx;
  for (i = 0; i < s.foes.length; i++) { a = s.foes[i]; a.x *= kx; a.bx *= kx; a.y *= ky; }
  for (i = 0; i < s.bullets.length; i++) { a = s.bullets[i]; a.x *= kx; a.y *= ky; }
  s.W = W; s.H = H; s.gy = gy;
  s.hx = clamp(s.hx, CFG.HOUSE_W / 2 + 3, W - CFG.HOUSE_W / 2 - 3);
  return s;
}

var core = {
  CFG: CFG, FOES: FOES, FOE_KEYS: KEYS, SCORE_BUCKETS: BUCKETS,
  clamp: clamp, rand: rand, createGame: createGame, step: step, resize: resize,
  difficulty: difficulty, pickType: pickType, spawnFoe: spawnFoe,
  comboMult: comboMult, scoreFor: scoreFor, scoreBucket: scoreBucket,
  fixedSteps: fixedSteps, hitBulletFoe: hitBulletFoe, hitsHouse: hitsHouse, roofY: roofY
};

/* ===== 2. 介面與繪圖（view） ===== */
var FONT = '"PingFang TC","Heiti TC","Microsoft JhengHei","微軟正黑體",sans-serif';
var TAU = Math.PI * 2;
var STYLE_ID = 'wg-style';

var LABELS = {
  title: '守護小屋',
  intro: '左右移動，點一下射擊。別讓壁癌、漏水、白蟻、蟑螂和噪音碰到小屋。',
  hintKey: '鍵盤：← → 或 A D 移動，空白鍵射擊',
  hintTouch: '手指在畫面上左右拖曳，會自動連射',
  start: '點一下開始',
  overTitle: '這局結束了',
  score: '分數', best: '最高', newBest: '新紀錄',
  again: '點一下，或按任意鍵，再玩一次',
  paused: '已暫停，點一下繼續',
  skip: '跳過遊戲',
  skipped: '好，不玩了。結果好了會在這裡出現。',
  hp: '屋況', combo: '連擊',
  aria: '守護小屋小遊戲：左右移動、點一下射擊，擋住壁癌、漏水、白蟻、蟑螂和噪音。'
};

// 內建雙主題色（取自設計系統色票）；頁面有 --u2-* 變數時以頁面為準
var BUILTIN = {
  light: { bg: '#ece5d9', paper: '#f5f1eb', vellum: '#fffdf8', wood: '#6b4a26', ink: '#2c2522', ink2: '#5a4d44', onWood: '#fffdf8', danger: '#a02f1b', ok: '#0a6a35' },
  dark:  { bg: '#171310', paper: '#1f1b17', vellum: '#2d2722', wood: '#c9a87c', ink: '#f5f1eb', ink2: '#c4b8ad', onWood: '#1f1b17', danger: '#f0a090', ok: '#6fcf9a' }
};
var VARMAP = {
  bg: ['--u2-sunken'], paper: ['--u2-paper'], vellum: ['--u2-vellum'], wood: ['--u2-wood-600', '--accent'],
  ink: ['--u2-ink', '--foreground'], ink2: ['--u2-ink-2', '--muted-foreground'], onWood: ['--u2-on-wood'],
  danger: ['--u2-err'], ok: ['--u2-ok']
};
var OVERRIDE = { bg: 'bg', fg: 'ink', accent: 'wood', muted: 'ink2', danger: 'danger', ok: 'ok' };
// 怪物填色固定（辨識靠輪廓與外形，不靠顏色）
var FC = { mold: '#7d8a5a', mold2: '#4f5a37', leak: '#5f9ea0', leak2: '#e8f3f2', termite: '#efe3c6', roach: '#6b4a2b', roach2: '#c9a87c', noise: '#e0a63a' };
var IDLE_X = [0.14, 0.33, 0.5, 0.68, 0.86], IDLE_Y = [0.3, 0.55, 0.2, 0.64, 0.4];
var NOLEAD = /[，。、！？：；）」』》,.!?:;)\]]/;

var CSS = '.wg-root{position:relative;box-sizing:border-box;width:100%;display:flex;flex-direction:column;overflow:hidden;contain:layout paint;' +
  'border:2px solid var(--wg-ink);border-radius:22px;background:var(--wg-bg);color:var(--wg-ink);font-family:' + FONT + ';-webkit-tap-highlight-color:transparent}' +
  '.wg-root [hidden]{display:none!important}.wg-bare{border:0;border-radius:0;background:transparent}' +
  '.wg-bar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:0 6px 0 16px;background:var(--wg-paper);border-bottom:2px solid var(--wg-ink)}' +
  '.wg-title{font-size:.9375rem;font-weight:700;letter-spacing:.06em}' +
  '.wg-skip{min-height:44px;min-width:44px;margin:0;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--wg-ink2);font:inherit;font-size:.875rem;text-decoration:underline;cursor:pointer}' +
  '.wg-skip:hover{color:var(--wg-ink)}.wg-skip:focus-visible{outline:3px solid var(--wg-wood);outline-offset:-3px}' +
  '.wg-field{position:relative;flex:1 1 auto;min-height:0}' +
  '.wg-canvas{position:absolute;left:0;top:0;width:100%;height:100%;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;outline:none}' +
  '.wg-canvas:focus-visible{outline:3px solid var(--wg-wood);outline-offset:-3px}' +
  '.wg-note{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:.9375rem;line-height:1.7;color:var(--wg-ink2)}';

function noop() {}
function noopApi() { return { destroy: noop, pause: noop, resume: noop, skip: noop, getState: function () { return { status: 'destroyed' }; } }; }
function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
function mm(q) { try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; } }
function font(px, w) { return (w || 400) + ' ' + px + 'px ' + FONT; }

function mountWaitGame(container, options) {
  var o = options || {};
  if (!container || typeof container.appendChild !== 'function' || typeof document === 'undefined') {
    return noopApi();
  }
  var cv = el('canvas', 'wg-canvas'), ctx = null;
  try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return noopApi();

  var L = {}, k;
  for (k in LABELS) L[k] = (o.labels && typeof o.labels[k] === 'string') ? o.labels[k] : LABELS[k];
  var totalH = clamp(Math.round(+o.height || 280), 200, 360);
  var storageKey = (typeof o.storageKey === 'string' && o.storageKey) ? o.storageKey : 'wg.best';
  var mqReduce = mm('(prefers-reduced-motion: reduce)'), mqDark = mm('(prefers-color-scheme: dark)'), mqCoarse = mm('(pointer: coarse)');
  var reduce = !!(mqReduce && mqReduce.matches);
  var coarse = !!(mqCoarse && mqCoarse.matches);
  var autoFire = typeof o.autoFire === 'boolean' ? o.autoFire : coarse;

  /* ---- DOM ---- */
  if (!document.getElementById(STYLE_ID)) {
    var styleEl = el('style'); styleEl.id = STYLE_ID; styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);
  }
  var bare = o.frame === false;   // 頁面自己有外框與固定高度時：不畫框、高度跟容器
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
  cv.setAttribute('role', 'img');   // application 會讓讀屏進入直通模式、吃掉方向鍵；aria-label 已足夠，操作靠鍵盤事件
  cv.setAttribute('aria-label', L.aria);
  field.appendChild(cv); root.appendChild(field);
  var note = el('div', 'wg-note'); note.hidden = true; root.appendChild(note);
  container.appendChild(root);

  /* ---- 狀態 ---- */
  var st = 'ready';  // ready | playing | over | skipped
  var paused = false, destroyed = false;
  var s = null, P = null;
  var W = 0, H = 0, dpr = 1;
  var best = readBest(), plays = 0, playMs = 0, newBest = false, overAt = 0;
  var mountAt = now();
  var fx = [], shake = 0, recoil = 0, scorePop = 0;
  var keys = { l: 0, r: 0, f: 0 };
  var ptr = { id: null, hold: false, target: null, off: 0 };
  var fireUntil = 0, arm = null;
  var raf = 0, last = null, acc = 0;
  var offs = [], observers = [];

  function on(t, type, fn, opt) { if (!t || !t.addEventListener) return; t.addEventListener(type, fn, opt); offs.push([t, type, fn, opt]); }

  function readBest() {
    try { var v = parseInt(window.localStorage.getItem(storageKey), 10); return v > 0 && v < 1e9 ? v : 0; } catch (e) { return 0; }
  }
  function writeBest(v) { try { window.localStorage.setItem(storageKey, String(v)); } catch (e) {} }

  function emit(type, ms) {
    if (typeof o.onEvent !== 'function') return;
    try { o.onEvent({ type: type, score: s ? s.score : 0, plays: plays, durationMs: Math.round(ms == null ? playMs : ms) }); } catch (e) {}
  }

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
      try { cs = window.getComputedStyle(container); } catch (e) {}
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
  function applyVars() {
    var m = { ink: P.ink, ink2: P.ink2, bg: P.bg, paper: P.paper, wood: P.wood };
    for (var key in m) root.style.setProperty('--wg-' + key, m[key]);
  }
  function refreshPalette() { P = resolvePalette(); applyVars(); if (!raf) draw(); }

  /* ---- 尺寸 ---- */
  function layout() {
    var w = Math.floor(field.clientWidth), h = Math.floor(field.clientHeight);
    if (!(w > 0 && h > 0)) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var nw = Math.round(w * dpr), nh = Math.round(h * dpr);
    if (cv.width !== nw || cv.height !== nh) { cv.width = nw; cv.height = nh; }
    if (w !== W || h !== H) {
      W = w; H = h;
      if (s) core.resize(s, W, H); else s = newGame();
    }
    return true;
  }
  function newGame() { return createGame({ W: W, H: H, seed: o.seed != null ? (+o.seed + plays) : undefined }); }

  /* ---- 輸入 ---- */
  function setTouch() {
    cv.style.touchAction = (st === 'playing' && !paused) ? 'none' : 'pan-y';
    cv.style.cursor = (st === 'playing' && !paused) ? 'crosshair' : 'pointer';
  }
  function focusCv() { try { cv.focus({ preventScroll: true }); } catch (e) {} }
  function localX(e) { return e.clientX - cv.getBoundingClientRect().left; }
  function resetInput() { keys.l = keys.r = keys.f = 0; ptr.id = null; ptr.hold = false; ptr.target = null; fireUntil = 0; arm = null; }

  function buildInput() {
    var dir = keys.r - keys.l;
    return {
      dir: dir,
      targetX: (dir === 0 && ptr.target != null) ? ptr.target : null,
      fire: !!(keys.f || ptr.hold || autoFire || now() < fireUntil)
    };
  }

  function onDown(e) {
    if (destroyed || st === 'skipped') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (st === 'playing' && !paused) {
      if (ptr.id === null) {
        ptr.id = e.pointerId; ptr.hold = true;
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        if (e.pointerType === 'mouse') ptr.target = localX(e);
        else { ptr.off = s.hx - localX(e); ptr.target = s.hx; }  // 觸控是相對拖曳：手指落下時小屋不會跳
      }
      fireUntil = now() + 140;
    } else {
      arm = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() };   // 非遊戲中：等放開才算「點一下」，捲動手勢不會誤觸
    }
  }
  function onMove(e) {
    if (destroyed || st !== 'playing' || paused) return;
    if (e.pointerType === 'mouse') ptr.target = localX(e);
    else if (e.pointerId === ptr.id) ptr.target = localX(e) + ptr.off;
  }
  function releasePtr(e) {
    if (ptr.id !== null && e.pointerId === ptr.id) {
      ptr.id = null; ptr.hold = false;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  }
  function onUp(e) {
    if (destroyed) return;
    if (arm && arm.id === e.pointerId) {
      var a = arm; arm = null;
      var dx = e.clientX - a.x, dy = e.clientY - a.y;
      if (dx * dx + dy * dy < 196 && now() - a.t < 900) activate();
      return;
    }
    releasePtr(e);
  }
  function onCancel(e) { if (arm && arm.id === e.pointerId) arm = null; releasePtr(e); }

  function activate() {
    if (st === 'ready') startRound();
    else if (st === 'over') { if (now() - overAt > 400) startRound(); }
    else if (st === 'playing' && paused) resumeGame();
    focusCv();
  }

  function keyDir(e) {
    var k = e.key || '', c = e.code;
    return (k === 'ArrowLeft' || c === 'KeyA' || k === 'a' || k === 'A') ? -1 : ((k === 'ArrowRight' || c === 'KeyD' || k === 'd' || k === 'D') ? 1 : 0);
  }
  function isFire(e) { return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'; }
  function onKeyDown(e) {
    if (destroyed || e.ctrlKey || e.metaKey || e.altKey) return;
    var kk = e.key || '', d = keyDir(e);
    var left = d < 0, right = d > 0, fire = isFire(e);
    var pauseKey = e.code === 'KeyP' || kk === 'p' || kk === 'P' || kk === 'Escape';
    var enter = kk === 'Enter';
    if (st === 'playing' && !paused) {
      if (left) keys.l = 1;
      else if (right) keys.r = 1;
      else if (fire) { keys.f = 1; }
      else if (pauseKey) { if (!e.repeat) doPause(); }
      else return;
      e.preventDefault();
    } else if (st === 'playing') {
      if (enter || fire || pauseKey) { if (!e.repeat) resumeGame(); e.preventDefault(); }
    } else if (st === 'ready') {
      if (enter || fire || left || right) { startRound(); e.preventDefault(); }
    } else if (st === 'over') {
      if (/^(Tab|Shift|Control|Alt|Meta|CapsLock|Escape|F[0-9]+|ContextMenu|Dead|Unidentified)$/.test(kk)) return;   // 這些鍵不算「任意鍵」
      if (!e.repeat && now() - overAt > 400) startRound();
      if (left || right || fire) e.preventDefault();
    }
  }
  function onKeyUp(e) {
    var d = keyDir(e);
    if (d < 0) keys.l = 0;
    if (d > 0) keys.r = 0;
    if (isFire(e)) keys.f = 0;
  }

  /* ---- 回合與暫停 ---- */
  function startRound() {
    plays++;
    s = newGame();
    st = 'playing'; paused = false; playMs = 0; newBest = false;
    fx.length = 0; shake = recoil = scorePop = 0; acc = 0; last = null;
    resetInput();
    setTouch(); focusCv();
    emit('start', 0);
    ensureLoop();
  }
  function finishRound() {
    st = 'over'; overAt = now();
    newBest = s.score > best;
    if (newBest) { best = s.score; writeBest(best); }
    resetInput(); setTouch();
    emit('over');
  }
  function doPause() {
    if (destroyed || st !== 'playing' || paused) return;
    paused = true;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    keys.l = keys.r = keys.f = 0; ptr.hold = false; ptr.id = null;
    setTouch(); draw();
    emit('pause');
  }
  function resumeGame() {
    if (destroyed || st !== 'playing' || !paused) return;
    paused = false; last = null; acc = 0;
    setTouch();
    emit('resume');
    ensureLoop();
  }
  function doSkip() {
    if (destroyed || st === 'skipped') return;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    var wasPlaying = st === 'playing';
    st = 'skipped'; paused = false; resetInput();
    field.hidden = true; note.textContent = L.skipped; note.hidden = false;
    if (skipBtn) skipBtn.hidden = true;
    emit('skip', now() - mountAt);
    if (typeof o.onSkip === 'function') { try { o.onSkip(wasPlaying); } catch (e) {} }
  }

  /* ---- 迴圈 ---- */
  function wantLoop() {
    return !destroyed && !paused && (st === 'playing' || (st === 'over' && (fx.length > 0 || shake > 0 || scorePop > 0)));
  }
  function ensureLoop() { if (!raf && wantLoop()) { last = null; raf = window.requestAnimationFrame(frame); } }
  function frame(ts) {
    raf = 0;
    if (destroyed) return;
    var dt = last == null ? 0 : (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    update(dt);
    draw();
    if (wantLoop()) raf = window.requestAnimationFrame(frame);
  }
  function update(dt) {
    var i;
    if (st === 'playing' && !paused && s) {
      var r = fixedSteps(acc, dt); acc = r.acc;
      var inp = buildInput();
      for (i = 0; i < r.n && !s.over; i++) core.step(s, CFG.STEP, inp);
      playMs += dt * 1000;
      consume();
      if (s.over) finishRound();
    }
    // 效果與計時（over 時讓最後的爆破跑完）
    for (i = fx.length - 1; i >= 0; i--) { fx[i].t += dt; if (fx[i].t >= fx[i].dur) fx.splice(i, 1); }
    shake = Math.max(0, shake - dt); recoil = Math.max(0, recoil - dt); scorePop = Math.max(0, scorePop - dt);
  }
  function consume() {
    var ev = s.events, i, e, j;
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (e.t === 'kill') {
        if (reduce) continue;
        scorePop = 0.25;
        fx.push({ k: 'burst', x: e.x, y: e.y, t: 0, dur: 0.22 });
        fx.push({ k: 'text', x: e.x, y: e.y - 12, t: 0, dur: 0.7, text: '+' + e.pts, color: P.wood });
        for (j = 0; j < 5; j++) {
          var a = (j / 5) * TAU + e.x, sp = 50 + (j % 3) * 22;
          fx.push({ k: 'chip', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0, dur: 0.38, c: FC[e.type] });
        }
      } else if (e.t === 'leak') {
        if (reduce) continue;
        shake = 0.18;
        fx.push({ k: 'burst', x: e.x, y: e.y, t: 0, dur: 0.22 });
        fx.push({ k: 'text', x: e.x, y: e.y - 14, t: 0, dur: 0.8, text: L.hp + ' -1', color: P.danger });
      } else if (e.t === 'heal') {
        if (!reduce) fx.push({ k: 'text', x: s.hx, y: s.gy - CFG.HOUSE_H - 24, t: 0, dur: 0.9, text: L.hp + ' +1', color: P.ok });
      } else if (e.t === 'shoot') {
        if (!reduce) recoil = 0.08;
      }
    }
    ev.length = 0;
  }

  /* ---- 繪圖 ---- */
  function pathPoly(pts) { ctx.beginPath(); for (var i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]); } ctx.closePath(); }
  function rrect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function wrap(text, maxW) {
    var out = [], line = '', i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (line && ctx.measureText(line + ch).width > maxW && !NOLEAD.test(ch)) { out.push(line); line = ch; } else line += ch;
    }
    if (line) out.push(line);
    return out;
  }

  function drawGround(gy) {
    ctx.fillStyle = P.paper; ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = P.wood; ctx.lineWidth = 3; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    ctx.globalAlpha = 0.28; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath();
    for (var i = 0; i < 14; i++) { var x = (i * 59 + 17) % Math.max(60, W - 20) + 10, y = gy + 9 + (i % 3) * 7; ctx.moveTo(x, y); ctx.lineTo(x + 12 + (i % 4) * 4, y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  function drawFoe(type, x, y, r, ph, age) {
    var i, kk, a, rr, px, py, anim = !reduce;
    ctx.lineWidth = 2; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (type === 'mold') {
      ctx.beginPath();
      for (i = 0; i < 14; i++) {
        a = i / 14 * TAU; rr = r * (0.86 + 0.14 * Math.sin(a * 3 + ph) + 0.07 * Math.sin(a * 5 + ph * 2));
        px = x + Math.cos(a) * rr; py = y + Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fillStyle = FC.mold; ctx.fill(); ctx.stroke();
      ctx.fillStyle = FC.mold2;
      [[-5, -3], [4, 2], [-1, 6]].forEach(function (d) { ctx.beginPath(); ctx.arc(x + d[0], y + d[1], 2.2, 0, TAU); ctx.fill(); });
    } else if (type === 'leak') {
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.25);
      ctx.bezierCurveTo(x + r * 0.95, y - r * 0.2, x + r, y + r * 0.95, x, y + r);
      ctx.bezierCurveTo(x - r, y + r * 0.95, x - r * 0.95, y - r * 0.2, x, y - r * 1.25);
      ctx.closePath(); ctx.fillStyle = FC.leak; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = FC.leak2; ctx.beginPath(); ctx.arc(x - 3, y + 2, r * 0.5, 2.6, 3.9); ctx.stroke();
    } else if (type === 'termite') {
      var w = anim ? Math.sin(age * 14) * 2 : 0;
      ctx.beginPath();
      [-1, 1].forEach(function (sd) { for (var q = -1; q <= 1; q++) { ctx.moveTo(x, y + q * 5); ctx.lineTo(x + sd * (r + 2), y + q * 8 + 4 + w * q); } });
      ctx.moveTo(x - 3, y + r * 0.95); ctx.lineTo(x - 6 - w, y + r * 1.3); ctx.moveTo(x + 3, y + r * 0.95); ctx.lineTo(x + 6 + w, y + r * 1.3);
      ctx.stroke();
      ctx.fillStyle = FC.termite;
      [[-r * 0.62, r * 0.55], [0, r * 0.5], [r * 0.6, r * 0.38]].forEach(function (c) { ctx.beginPath(); ctx.arc(x, y + c[0], c[1], 0, TAU); ctx.fill(); ctx.stroke(); });
    } else if (type === 'roach') {
      ctx.beginPath();
      ctx.moveTo(x - 4, y + r * 0.8); ctx.quadraticCurveTo(x - 10, y + r * 1.4, x - 13, y + r * 1.3);
      ctx.moveTo(x + 4, y + r * 0.8); ctx.quadraticCurveTo(x + 10, y + r * 1.4, x + 13, y + r * 1.3);
      ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.62, r * 0.95, 0, 0, TAU); ctx.fillStyle = FC.roach; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = FC.roach2; ctx.beginPath(); ctx.moveTo(x, y - r * 0.6); ctx.lineTo(x, y + r * 0.6); ctx.stroke();
    } else {
      var pr = anim ? 1 + 0.05 * Math.sin(age * 10) : 1;
      ctx.beginPath();
      for (kk = 0; kk < 16; kk++) {
        a = kk / 16 * TAU; rr = (kk % 2 ? r * 0.62 : r * 1.12) * pr;
        px = x + Math.cos(a) * rr; py = y + Math.sin(a) * rr;
        if (kk) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fillStyle = FC.noise; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y + 6, 1.2, 0, TAU); ctx.stroke();
    }
  }

  function drawHouse(x, gy, hp) {
    var w = CFG.HOUSE_W, h = CFG.HOUSE_H, top = gy - h;
    var sx = shake > 0 ? Math.sin(shake * 90) * 3 * (shake / 0.18) : 0;
    var by = recoil > 0 ? 3 * (recoil / 0.08) : 0;
    x += sx;
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = P.vellum; ctx.strokeStyle = P.ink;
    ctx.beginPath(); ctx.rect(x - w / 2 + 4, top + 16, w - 8, h - 16); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.ink; ctx.fillRect(x - 3.5, top - CFG.BARREL_H + by, 7, CFG.BARREL_H);
    ctx.strokeStyle = P.wood; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x - w / 2, top + 18); ctx.lineTo(x, top); ctx.lineTo(x + w / 2, top + 18); ctx.stroke();
    ctx.fillStyle = P.wood;
    ctx.beginPath(); ctx.moveTo(x - 8, gy); ctx.lineTo(x - 8, gy - 16); ctx.arc(x, gy - 16, 8, Math.PI, 0); ctx.lineTo(x + 8, gy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = P.ink2; ctx.lineWidth = 1.5;
    if (hp <= 2) { ctx.beginPath(); ctx.moveTo(x - 22, top + 24); ctx.lineTo(x - 17, top + 32); ctx.lineTo(x - 22, top + 38); ctx.stroke(); }
  }

  function drawFx() {
    var i, j, f, k2, a, r1;
    ctx.lineCap = 'round';
    for (i = 0; i < fx.length; i++) {
      f = fx[i]; k2 = f.t / f.dur;
      if (f.k === 'burst') {
        ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
        r1 = 6 + k2 * 10;
        for (j = 0; j < 6; j++) {
          a = j / 6 * TAU;
          ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.lineTo(f.x + Math.cos(a) * (r1 + 6), f.y + Math.sin(a) * (r1 + 6)); ctx.stroke();
        }
      } else if (f.k === 'chip') {
        ctx.globalAlpha = 1 - k2; ctx.fillStyle = f.c; ctx.strokeStyle = P.ink; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(f.x + f.vx * f.t, f.y + f.vy * f.t + 210 * f.t * f.t, 2.6, 0, TAU); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 1 - k2 * k2; ctx.fillStyle = f.color; ctx.font = font(14, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(f.text, f.x, f.y - 24 * k2); ctx.globalAlpha = 1;
      }
    }
  }

  function drawHud() {
    var pop = scorePop > 0 ? 1 + 0.25 * (scorePop / 0.25) : 1, i;
    ctx.textBaseline = 'top'; ctx.fillStyle = P.ink; ctx.textAlign = 'left';
    ctx.save(); ctx.translate(12, 10); ctx.scale(pop, pop);
    ctx.font = font(15, 700); ctx.fillText(L.score + ' ' + s.score, 0, 0); ctx.restore();
    if (s.combo >= 3) { ctx.font = font(12, 700); ctx.fillStyle = P.ink2; ctx.fillText(L.combo + ' ' + s.combo, 12, 31); }
    ctx.font = font(15, 700); ctx.fillStyle = P.ink; ctx.textAlign = 'right';
    ctx.fillText(L.hp + ' ' + s.hp + '/' + CFG.MAX_HP, W - 12 - 5 * 18, 10);
    for (i = 0; i < CFG.MAX_HP; i++) {
      var hx = W - 12 - (CFG.MAX_HP - i) * 18 + 4, hy = 12, alive = i < s.hp;
      ctx.lineWidth = 1.8; ctx.strokeStyle = P.ink; ctx.setLineDash(alive ? [] : [3, 3]);
      pathPoly([[hx + 7, hy], [hx + 14, hy + 6], [hx + 14, hy + 14], [hx, hy + 14], [hx, hy + 6]]);
      if (alive) { ctx.fillStyle = P.vellum; ctx.fill(); }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // 覆蓋層；放不下時先丟小字、再丟說明
  function overlay(title, body, btn, foot) {
    ctx.globalAlpha = 0.9; ctx.fillStyle = P.vellum; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    var tsz = H < 200 ? 18 : 22, lh = 21, maxW = Math.min(W - 32, 420), i;
    ctx.font = font(14, 400);
    var lines = body ? wrap(body, maxW) : [], fl = [];
    for (i = 0; i < foot.length; i++) if (foot[i]) fl = fl.concat(wrap(foot[i], maxW));
    var bh = btn ? 40 : 0;
    function total() { return tsz * 1.4 + (lines.length ? 8 + lines.length * lh : 0) + (fl.length ? 8 + fl.length * 19 : 0) + (btn ? 14 + bh : 0); }
    while (fl.length && total() > H - 12) fl.pop();
    if (total() > H - 12) lines = [];
    var y = Math.max(6, (H - total()) / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = P.ink;
    ctx.font = font(tsz, 700); ctx.fillText(title, W / 2, y); y += tsz * 1.4;
    if (lines.length) { y += 8; ctx.font = font(14, 400); for (i = 0; i < lines.length; i++) { ctx.fillText(lines[i], W / 2, y); y += lh; } }
    if (btn) {
      y += 14;
      var fs = 15; ctx.font = font(fs, 700);
      var bw = ctx.measureText(btn).width + 44;
      if (bw > W - 24) { fs = 13; ctx.font = font(fs, 700); bw = Math.min(W - 24, ctx.measureText(btn).width + 28); }
      rrect(W / 2 - bw / 2, y, bw, bh, 12); ctx.fillStyle = P.wood; ctx.fill();
      ctx.fillStyle = P.onWood; ctx.textBaseline = 'middle'; ctx.fillText(btn, W / 2, y + bh / 2 + 1); ctx.textBaseline = 'top';
      y += bh;
    }
    if (fl.length) { y += 8; ctx.font = font(13, 400); ctx.fillStyle = P.ink2; for (i = 0; i < fl.length; i++) { ctx.fillText(fl[i], W / 2, y); y += 19; } }
  }

  function draw() {
    if (destroyed || !s || !W || st === 'skipped') return;
    var gy = H - CFG.GROUND_H, i, f, b;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    drawGround(gy);
    if (st === 'ready') {
      for (i = 0; i < 5; i++) drawFoe(KEYS[i], W * IDLE_X[i], gy * IDLE_Y[i], FOES[KEYS[i]].r, i, 0);
    } else {
      for (i = 0; i < s.foes.length; i++) { f = s.foes[i]; drawFoe(f.type, f.x, f.y, f.r, f.ph, f.age); }
      ctx.strokeStyle = P.ink; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
      for (i = 0; i < s.bullets.length; i++) { b = s.bullets[i]; ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + CFG.BULLET_LEN); }
      ctx.stroke();
    }
    drawHouse(s.hx, gy, s.hp);
    drawFx();
    drawHud();
    if (st === 'ready') {
      overlay(L.title, L.intro, L.start, [best > 0 ? L.best + ' ' + best : '', coarse ? L.hintTouch : L.hintKey]);
    } else if (st === 'over') {
      overlay(L.overTitle, L.score + ' ' + s.score + '，' + (newBest ? L.newBest : L.best + ' ' + best), L.again, []);
    } else if (paused) {
      overlay(L.paused, '', '', []);
    }
  }

  /* ---- 綁定 ---- */
  P = resolvePalette(); applyVars(); setTouch();
  on(cv, 'pointerdown', onDown);
  on(cv, 'pointermove', onMove);
  on(cv, 'pointerup', onUp);
  on(cv, 'pointercancel', onCancel);
  on(cv, 'lostpointercapture', onCancel);
  on(cv, 'keydown', onKeyDown);
  on(cv, 'keyup', onKeyUp);
  on(cv, 'blur', function () { keys.l = keys.r = keys.f = 0; });
  on(cv, 'contextmenu', function (e) { if (st === 'playing') e.preventDefault(); });
  if (skipBtn) on(skipBtn, 'click', doSkip);
  on(document, 'visibilitychange', function () { if (document.hidden) doPause(); });
  if (mqReduce) on(mqReduce, 'change', function (e) { reduce = !!e.matches; if (reduce) { fx.length = 0; shake = recoil = scorePop = 0; } if (!raf) draw(); });
  if (mqDark) on(mqDark, 'change', function () { if (o.theme !== 'light' && o.theme !== 'dark') refreshPalette(); });

  try {
    if (window.MutationObserver && document.documentElement) {
      var mo = new MutationObserver(refreshPalette);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      observers.push(mo);
    }
  } catch (e) {}
  try {
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { if (layout() && !raf) draw(); });
      ro.observe(field); observers.push(ro);
    } else on(window, 'resize', function () { if (layout() && !raf) draw(); });
  } catch (e) {}
  try {
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (es) { if (es.length && !es[es.length - 1].isIntersecting) doPause(); });
      io.observe(root); observers.push(io);
    }
  } catch (e) {}

  layout(); draw();

  return {
    pause: doPause,
    resume: resumeGame,
    skip: doSkip,
    getState: function () {
      return { status: destroyed ? 'destroyed' : st, paused: paused, score: s ? s.score : 0, kills: s ? s.kills : 0,
        shots: s ? s.shots : 0, hp: s ? s.hp : 0, houseX: s ? s.hx : 0, plays: plays, best: best };
    },
    destroy: function () {
      if (destroyed) return;
      destroyed = true;
      if (raf) { try { window.cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
      for (var i = 0; i < offs.length; i++) { try { offs[i][0].removeEventListener(offs[i][1], offs[i][2], offs[i][3]); } catch (e) {} }
      offs.length = 0;
      for (i = 0; i < observers.length; i++) { try { observers[i].disconnect(); } catch (e) {} }
      observers.length = 0;
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
