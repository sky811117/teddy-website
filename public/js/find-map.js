/*! find-map.js 找房小幫手「在地圖上圈範圍」：s1 的地圖畫面（用目前畫面當範圍，或用手指／滑鼠自己圈一塊）。
 * 按「在地圖上圈範圍」才由 find-scope.js 載入（網址在 #scope-map 的 data-src），只透過 FindMap.open／close／check 往來。
 * 地圖程式（Leaflet 1.9.4）與樣式放本站 /js/vendor/：網址從 #scope-map 的 data-lib／data-css／data-mcss 拿，自己載、整頁只載一次。
 * 地圖圖片：內政部國土測繪中心開放圖資，網址只有下面 TILE_URL 一處；圖片請求不帶 Referer、不帶也不存對方的 cookie。
 * 沒有資料請求、沒有儲存；客人選的範圍只交給 opts.onDone（由 find-scope 寫進條件）。文字都是本檔固定表，只用 textContent。
 * check() 跟 src/lib/find/schema.ts 的 geoCheck、家用機 mp_aif_schema.py 逐位元相同（規格 SEARCH_MODES §1.4，運算順序照抄）。
 * 掛 window.FindMap（Node 端 module.exports 給測試）。 */
(function (root) {
'use strict';

var TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP6_OPENDATA/default/GoogleMapsCompatible/{z}/{y}/{x}';
var BOX = [23.99, 120.45, 24.45, 121.45];          // 台中市框（南、西、北、東）＝伺服器的 GEO_BOX
var MIN_KM2 = 0.05, MAX_KM2 = 25, MAX_SIDE = 8, MAX_PTS = 24;
var KX = 101.6335, KY = 110.7604;                   // 北緯 24.15° 每度經度、每度緯度的公里數（WGS84）
var CENTER = [24.15, 120.66];
var STEP_PX = 6, TOL_PX = 4, MIN_STROKE = 8;        // 手指移動多少像素才收一點、簡化起始容差、一筆至少幾點
var LOAD_MS = 15000, SLOW_MS = 10000, TILE_FAILS = 8;

var T = {
  loading: '地圖載入中…',
  lead: '把地圖移到想找的地方，再按下面的按鈕。',
  keysT: '用鍵盤操作',
  keys: '用 Tab 移到地圖上，再用方向鍵移動、＋／－放大縮小，然後按『找這個畫面的範圍』。',
  aria: '地圖。用 Tab 移到這裡後，可以用方向鍵移動、加號減號放大縮小。',
  zin: '放大',
  zout: '縮小',
  modes: '地圖的用法',
  mView: '移動地圖',
  mLasso: '我要自己圈',
  go: '找這個畫面的範圍',
  zoomMore: '先放大一點',
  use: '用這一圈找',
  redo: '重畫',
  area: function (n) { return '這個畫面約 ' + n + ' 平方公里'; },
  draw: '用一根手指（電腦用滑鼠）在地圖上畫一圈。',
  one: '畫的時候只用一根手指。要移動或放大地圖，先按『移動地圖』。',
  got: function (n) { return '圈好了，約 ' + n + ' 平方公里。可以按『用這一圈找』，或按『重畫』。'; },
  big: '範圍太大了（超過 25 平方公里，或太長）。放大一點，或圈小一點。',
  small: '範圍太小了，至少圈住一整條街的範圍。只想看某一個社區，可以改用『找某個社區』。',
  out: '這裡不在台中市，請移到台中市內。',
  messy: '這一圈沒有畫好，請按『重畫』再畫一次。',
  slow: '地圖圖片載得很慢。可以再等一下，或改用選區域。',
  credit: '地圖：內政部國土測繪中心 臺灣通用電子地圖（依政府資料開放授權條款第 1 版）'
};

/* ===================== 純函式（範圍驗證、圈選簡化、初始縮放） ===================== */
function num(x) { return typeof x === 'number' && isFinite(x); }
function r5(x) { return Math.floor(x * 100000 + 0.5) / 100000; }   // 跟伺服器同公式（不用 Math.round）
function inBox(a, b) { return a >= BOX[0] && a <= BOX[2] && b >= BOX[1] && b <= BOX[3]; }
/* 形狀：3–24 點、每點兩個有限數字、四捨五入到小數 5 位、在台中市框內；去掉相鄰重複點與重複的終點。不合格回 null */
function shape(v) {
  if (!Array.isArray(v) || v.length < 3 || v.length > MAX_PTS) return null;
  var out = [], i, p, a, b, q;
  for (i = 0; i < v.length; i++) {
    p = v[i];
    if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) return null;
    if (Math.abs(p[0]) > 1000 || Math.abs(p[1]) > 1000) return null;   // 跟家用機同（Python 先擋大數再四捨五入）
    a = r5(p[0]); b = r5(p[1]);
    if (!inBox(a, b)) return null;
    q = out[out.length - 1];
    if (!q || q[0] !== a || q[1] !== b) out.push([a, b]);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}
function orient(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
/* 自我交叉（只認真的穿過，碰到邊不算）。座標是 [緯度, 經度] 或 [x, y] 都可以 */
function selfCross(p) {
  var n = p.length, i, j, a, b, c, d;
  for (i = 0; i < n; i++) {
    a = p[i]; b = p[(i + 1) % n];
    for (j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      c = p[j]; d = p[(j + 1) % n];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
    }
  }
  return false;
}
/* 面積（平方公里；以第一點為原點的平面近似） */
function areaKm2(p) {
  var n = p.length, lat0 = p[0][0], lng0 = p[0][1], s = 0, i, q, x1, y1, x2, y2;
  for (i = 0; i < n; i++) {
    q = p[(i + 1) % n];
    x1 = (p[i][1] - lng0) * KX;
    y1 = (p[i][0] - lat0) * KY;
    x2 = (q[1] - lng0) * KX;
    y2 = (q[0] - lat0) * KY;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
/* 外框長邊（公里） */
function sideKm(p) {
  var la = p.map(function (x) { return x[0]; }), ln = p.map(function (x) { return x[1]; });
  var w = (Math.max.apply(null, ln) - Math.min.apply(null, ln)) * KX, h = (Math.max.apply(null, la) - Math.min.apply(null, la)) * KY;
  return Math.max(w, h);
}
/* 全量驗證：形狀 → 自我交叉 → 太小 → 太大（面積超過 25 平方公里或外框長邊超過 8 公里）。poly 只在通過時給（四捨五入後） */
function check(v) {
  var p = shape(v), km2;
  if (!p) return { ok: false, code: 'invalid', km2: null, poly: null };
  if (selfCross(p)) return { ok: false, code: 'self_cross', km2: null, poly: null };
  km2 = areaKm2(p);
  if (km2 < MIN_KM2) return { ok: false, code: 'too_small', km2: km2, poly: null };
  if (km2 > MAX_KM2 || sideKm(p) > MAX_SIDE) return { ok: false, code: 'too_big', km2: km2, poly: null };
  return { ok: true, code: null, km2: km2, poly: p };
}

function perp(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t;
  if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/* Douglas-Peucker（迭代版，長筆畫不會遞迴太深）；點是螢幕像素 [x, y] */
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  var keep = [], stack = [[0, pts.length - 1]], se, i, d, idx, max;
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    se = stack.pop(); idx = -1; max = tol;
    for (i = se[0] + 1; i < se[1]; i++) {
      d = perp(pts[i], pts[se[0]], pts[se[1]]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0) { keep[idx] = 1; stack.push([se[0], idx], [idx, se[1]]); }
  }
  return pts.filter(function (x, k) { return keep[k]; });
}
/* 點數超過 24 就加大容差再簡化 */
function capPts(pts) {
  var tol = TOL_PX, out = simplify(pts, tol);
  while (out.length > MAX_PTS) { tol *= 1.3; out = simplify(pts, tol); }
  return out;
}
/* 凸包（Andrew monotone chain）：畫成 8 字的那一圈改用它 */
function hull(pts) {
  var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }), lo = [], up = [], i, q;
  function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  for (i = 0; i < p.length; i++) { q = p[i]; while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (i = p.length - 1; i >= 0; i--) { q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/* 一筆（螢幕像素點）→ 簡化後的一圈（≤24 點、不交叉）；太短回 null */
function lassoRing(stroke) {
  var ring, a, b;
  if (!stroke || stroke.length < MIN_STROKE) return null;
  ring = capPts(stroke);
  a = ring[0]; b = ring[ring.length - 1];
  if (ring.length > 2 && a[0] === b[0] && a[1] === b[1]) ring.pop();
  if (ring.length < 3) return null;
  return selfCross(ring) ? hull(ring) : ring;
}
/* 目前畫面（南、西、北、東）夾進台中市框 → 4 點矩形；完全在框外回 null */
function clampRect(s, w, n, e) {
  s = Math.max(s, BOX[0]); w = Math.max(w, BOX[1]); n = Math.min(n, BOX[2]); e = Math.min(e, BOX[3]);
  return s < n && w < e ? [[s, w], [s, e], [n, e], [n, w]] : null;
}
/* 初始縮放：z14 的畫面超過 12 平方公里（電腦大地圖）就用 z15，按「找這個畫面的範圍」才不會太大 */
function initZoom(w, h) {
  var m = 156543.03392 * Math.cos(24.15 * Math.PI / 180) / 16384;   // z14 每像素公尺（約 8.72）
  return w > 0 && h > 0 && (w * m) * (h * m) / 1e6 > 12 ? 15 : 14;
}
function fmt(km2) { return km2 < 10 ? km2.toFixed(1) : String(Math.round(km2)); }

var core = { TILE_URL: TILE_URL, BOX: BOX, T: T, r5: r5, shape: shape, selfCross: selfCross, areaKm2: areaKm2, sideKm: sideKm, check: check,
  simplify: simplify, capPts: capPts, hull: hull, lassoRing: lassoRing, clampRect: clampRect, initZoom: initZoom, fmt: fmt };
var doc = root.document;
if (typeof module !== 'undefined' && module.exports) module.exports = core;
if (!doc) return;

/* ===================== 以下是畫面（DOM）部分 ===================== */
var lib = null, st = null;
function h(tag, attrs, kids) {
  var e = doc.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
  (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
  return e;
}
function btn(cls, data, text) { var a = { class: cls, type: 'button' }; a[data[0]] = data[1]; return h('button', a, [text]); }
function raf(fn) { return root.requestAnimationFrame ? root.requestAnimationFrame(fn) : root.setTimeout(fn, 16); }
function reduced() { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
function loadingNote() { return h('p', { class: 'u2-scope__help', role: 'status', text: T.loading }); }

/* 地圖程式與兩份樣式：都載好才建地圖（Leaflet 的樣式沒到就建，會先出現沒排版的圖片）；15 秒沒好算失敗，下次再開會重試 */
function needLib(box, cb) {
  var L0;
  if (lib && lib.ok) { cb(true); return; }
  if (lib && lib.ok === false) { lib.els.forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); }); lib = null; }
  if (!lib) {
    L0 = lib = { ok: null, cbs: [], els: [], left: 0 };
    var end = function (ok) {
      if (L0.ok !== null) return;
      L0.ok = ok;
      root.clearTimeout(L0.t);
      L0.cbs.splice(0).forEach(function (f) { f(ok); });
    };
    var add = function (el) {
      L0.left++;
      el.onload = function () { if (!--L0.left) end(!!root.L); };
      el.onerror = function () { end(false); };
      L0.els.push(el);
      doc.head.appendChild(el);
    };
    add(h('link', { rel: 'stylesheet', href: box.getAttribute('data-css') }));
    add(h('link', { rel: 'stylesheet', href: box.getAttribute('data-mcss') }));
    if (!root.L) add(h('script', { src: box.getAttribute('data-lib') }));
    L0.t = root.setTimeout(function () { end(false); }, LOAD_MS);
  }
  lib.cbs.push(cb);
}
/* 先跟圖片主機握手（網址從 TILE_URL 算，本檔只有那一處寫網址）；圖片請求是匿名跨來源，握手也要匿名 */
function preconnect() {
  try {
    if (doc.querySelector('link[data-map-pc]')) return;
    doc.head.appendChild(h('link', { rel: 'preconnect', href: new URL(TILE_URL).origin, crossorigin: 'anonymous', 'data-map-pc': '' }));
  } catch (e) { /* 只是加速，失敗不影響 */ }
}

function track(s, a, m) {
  var p = { a: a };
  if (m) p.m = m;
  try { if (s.o.track) s.o.track('area', p); } catch (e) { /* 事件送不出去不影響畫面 */ }
}
/* 狀態列：同一段文字 1 秒內不重念；soft（畫面移動時的面積）＝文字沒變就不動 */
function say(s, t, soft) {
  var n = Date.now();
  if (t === s.said && (soft || n - s.sayAt < 1000)) return;
  s.said = t; s.sayAt = n;
  s.status.textContent = t;
}
function cls(el, c, on) { if (on) el.classList.add(c); else el.classList.remove(c); }

/* ---------- 開、關 ---------- */
function open(mount, opts) {
  var s, box;
  close();
  if (!mount) return;
  box = mount.closest ? mount.closest('#scope-map') : null;
  s = st = { mount: mount, o: opts || {}, mode: 'view', said: null, sayAt: 0, tiles: 0, bad: 0 };
  mount.textContent = '';
  mount.appendChild(loadingNote());
  preconnect();
  if (!box) { fail(s, 'load'); return; }
  needLib(box, function (ok) {
    if (st !== s) return;   // 客人已經離開
    if (!ok) { fail(s, 'load'); return; }
    // s1 已經顯示；等兩個畫面更新、容器量得到大小再建（在藏起來的容器裡建會得到 0 尺寸的灰地圖）
    raf(function () { raf(function () { if (st === s) { try { build(s); } catch (e) { fail(s, 'load'); } } }); });
  });
}
function close() {
  var s = st;
  if (!s) return;
  st = null;
  if (s.map && !s.done && !s.failed) track(s, 'cancel', s.mode);
  root.clearTimeout(s.slowT);
  if (s.el) ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (t, i) { s.el.removeEventListener(t, PH[i]); });
  if (s.ui) s.ui.removeEventListener('click', onUi);
  if (s.map) { try { s.map.remove(); } catch (e) { /* 拆不乾淨也不影響下一次 */ } }
  s.mount.textContent = '';
  s.mount.appendChild(loadingNote());
}
function fail(s, code) {
  if (st !== s || s.failed) return;
  s.failed = true;
  track(s, 'fail');
  try { if (s.o.onFail) s.o.onFail(code); } catch (e) { /* ignore */ }
  if (st === s) close();
}
function done(s, m, poly) {
  s.done = true;
  track(s, 'done', m);
  if (s.o.onDone) s.o.onDone(poly.map(function (p) { return p.slice(); }));   // 之後 find-scope 會叫 close()
}

/* ---------- 建地圖 ---------- */
function build(s) {
  var L = root.L, rm = reduced(), poly = shape(s.o.poly), map, tl, w, ht;
  s.el = h('div', { class: 'u2-map', role: 'application', 'aria-label': T.aria });
  s.zin = btn('u2-map__zbtn', ['data-mz', 'in'], T.zin);
  s.zout = btn('u2-map__zbtn', ['data-mz', 'out'], T.zout);
  s.mv = btn('u2-btn u2-btn--ghost', ['data-mm', 'view'], T.mView);
  s.ml = btn('u2-btn u2-btn--ghost', ['data-mm', 'lasso'], T.mLasso);
  s.go = btn('u2-btn u2-btn--primary', ['data-ma', 'go'], T.go);
  s.use = btn('u2-btn u2-btn--primary', ['data-ma', 'use'], T.use);
  s.re = btn('u2-btn u2-btn--ghost', ['data-ma', 'redo'], T.redo);
  s.status = h('p', { class: 'u2-map__status', role: 'status', 'aria-live': 'polite' });
  s.ui = h('div', { class: 'u2-mapui' }, [
    h('p', { class: 'u2-map__lead', text: T.lead }),
    h('details', { class: 'u2-map__keys' }, [h('summary', { text: T.keysT }), h('p', { text: T.keys })]),
    h('div', { class: 'u2-map__wrap' }, [s.el, h('div', { class: 'u2-map__zoom' }, [s.zin, s.zout])]),
    s.bar = h('div', { class: 'u2-map__bar' }, [
      s.status,
      h('div', { class: 'u2-map__modes', role: 'group', 'aria-label': T.modes }, [s.mv, s.ml]),
      h('div', { class: 'u2-map__acts' }, [s.go, s.use, s.re])
    ]),
    h('p', { class: 'u2-map__credit', text: T.credit })
  ]);
  s.mount.textContent = '';
  s.mount.appendChild(s.ui);
  w = s.el.clientWidth; ht = s.el.clientHeight;
  map = s.map = L.map(s.el, {
    zoomControl: false, attributionControl: false, scrollWheelZoom: false, keyboard: true, minZoom: 11, maxZoom: 17,
    maxBounds: [[23.94, 120.4], [24.5, 121.5]],   // 台中市框放寬 0.05°（拖出去會彈回來）
    zoomAnimation: !rm, fadeAnimation: !rm, markerZoomAnimation: !rm
  });
  tl = L.tileLayer(TILE_URL, {
    minZoom: 11, maxNativeZoom: 15, maxZoom: 17, referrerPolicy: 'no-referrer', crossOrigin: 'anonymous', detectRetina: false,
    bounds: [[BOX[0], BOX[1]], [BOX[2], BOX[3]]]
  });
  tl.on('tileload', function () { if (st !== s) return; s.tiles++; s.bad = 0; if (s.said === T.slow) draw(s); });
  tl.on('tileerror', function () { if (st === s && ++s.bad >= TILE_FAILS) fail(s, 'tiles'); });
  // 這一批圖片全部結束（成功或失敗都算）卻一張都沒載到 → 失敗。手機首屏只有 4 張左右，湊不到 TILE_FAILS
  tl.on('load', function () { if (st === s && !s.tiles) fail(s, 'tiles'); });
  tl.addTo(map);
  if (poly) {
    map.fitBounds(poly, { maxZoom: 16, animate: false });
    L.polygon(poly, { className: 'u2-map__old', interactive: false }).addTo(map);   // 原本的範圍（虛線），要改可以照著看
  } else map.setView(CENTER, initZoom(w, ht), { animate: false });
  map.invalidateSize();
  map.on('moveend', function () { if (st === s) upd(s); });
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (t, i) { s.el.addEventListener(t, PH[i]); });
  s.ui.addEventListener('click', onUi);
  s.slowT = root.setTimeout(function () { if (st === s && !s.tiles) say(s, T.slow); }, SLOW_MS);
  mode(s, 'view');
  track(s, 'open', 'view');
  reveal(s);
}
/* 地圖露出不到九成（手機上面還有標題與分頁按鈕）→ 把地圖畫面捲到最上面：不用自己捲，就看得到地圖與「找這個畫面的範圍」 */
function reveal(s) {
  var vh = root.innerHeight, r, b;
  if (!vh || !s.el.getBoundingClientRect) return;
  r = s.el.getBoundingClientRect(); b = s.bar.getBoundingClientRect();
  if (Math.min(r.bottom, b.top, vh) - Math.max(r.top, 0) >= r.height * 0.9) return;
  try { s.ui.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* 捲不動就算了 */ }
}

/* ---------- 兩種用法：移動地圖（目前畫面當範圍）／我要自己圈 ---------- */
function mode(s, m) {
  var lasso = m === 'lasso', map = s.map;
  s.mode = m;
  ['dragging', 'touchZoom', 'doubleClickZoom', 'boxZoom'].forEach(function (k) { if (map[k]) map[k][lasso ? 'disable' : 'enable'](); });
  dropLine(s);
  if (s.ring) { if (lasso) s.ring.addTo(map); else s.ring.remove(); }   // 圈好的那一圈留著，換回來還在
  draw(s);
}
function draw(s) {
  var lasso = s.mode === 'lasso';
  cls(s.el, 'u2-map--draw', lasso && !s.lock);   // 畫的時候手指不捲網頁；圈完就拿掉（手指拖＝捲網頁，不會蓋掉剛圈的）
  s.mv.setAttribute('aria-pressed', String(!lasso));
  s.ml.setAttribute('aria-pressed', String(lasso));
  s.go.hidden = lasso;
  s.use.hidden = !lasso;
  s.use.disabled = !s.poly;
  s.re.hidden = !lasso || !s.lock;
  if (lasso) say(s, s.lock ? s.msg : T.draw);
  else { s.said = null; upd(s); }
}
function viewCheck(s) {
  var b = s.map.getBounds(), r = clampRect(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  return r ? check(r) : { ok: false, code: 'out', km2: null, poly: null };
}
/* 畫面移動後：面積、主要按鈕（太大＝不能按、「先放大一點」）、放大縮小鈕 */
function upd(s) {
  var map = s.map, z = map.getZoom(), v;
  s.zin.disabled = z >= map.getMaxZoom();
  s.zout.disabled = z <= map.getMinZoom();
  if (s.mode !== 'view') return;
  v = viewCheck(s);
  s.go.disabled = !v.ok;
  s.go.textContent = v.code === 'too_big' ? T.zoomMore : T.go;
  say(s, v.code === 'out' ? T.out : v.km2 == null || v.code === 'too_small' ? T.small : T.area(fmt(v.km2)), true);
}

/* ---------- 圈選（Pointer Events；一根手指或滑鼠左鍵） ---------- */
function dropLine(s) { s.stroke = null; if (s.line) { s.line.remove(); s.line = null; } }
function addPt(s, e) {
  var p = s.map.mouseEventToContainerPoint(e), q = [p.x, p.y], k = s.stroke, last = k[k.length - 1], ll;
  if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < STEP_PX) return;
  k.push(q);
  ll = s.map.containerPointToLatLng(q);
  if (s.line) s.line.addLatLng(ll);
  else s.line = root.L.polyline([ll], { className: 'u2-map__line', interactive: false }).addTo(s.map);
}
function onDown(e) {
  var s = st;
  if (!s || s.mode !== 'lasso' || s.lock) return;
  if (!e.isPrimary) { if (s.stroke) { dropLine(s); say(s, T.one); } return; }   // 第二根手指：取消這一筆
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.preventDefault) e.preventDefault();
  try { s.el.setPointerCapture(e.pointerId); } catch (x) { /* 舊瀏覽器沒有也能畫 */ }
  s.pid = e.pointerId;
  s.stroke = [];
  addPt(s, e);
}
function onMove(e) {
  var s = st;
  if (s && s.stroke && e.pointerId === s.pid) addPt(s, e);
}
function onUp(e) {
  var s = st, k;
  if (!s || !s.stroke || e.pointerId !== s.pid) return;
  k = s.stroke;
  if (e.type === 'pointercancel') { dropLine(s); return; }
  dropLine(s);
  finish(s, k);
}
var PH = [onDown, onMove, onUp, onUp];
/* 一筆畫完：簡化 → 交叉就改凸包 → 換經緯度 → 驗證；圈完就鎖住（要再畫按「重畫」） */
function finish(s, k) {
  var ring = lassoRing(k), ll, c;
  if (k.length < 2) return;   // 只是點一下
  if (!ring) { say(s, T.small); return; }
  ll = ring.map(function (p) { var q = s.map.containerPointToLatLng(p); return [r5(q.lat), r5(q.lng)]; });
  c = check(ll);
  s.lock = true;
  s.poly = c.ok ? c.poly : null;
  s.msg = c.ok ? T.got(fmt(c.km2)) : ll.some(function (p) { return !inBox(p[0], p[1]); }) ? T.out
    : c.code === 'too_big' ? T.big : c.code === 'self_cross' ? T.messy : T.small;
  s.ring = root.L.polygon(c.ok ? c.poly : ll, { className: 'u2-map__ring' + (c.ok ? '' : ' u2-map__ring--bad'), interactive: false }).addTo(s.map);
  draw(s);
  unhide(s);
}
/* 圈完：黏在底部的動作列變高、蓋到地圖下緣 → 網頁往下捲一點讓圈整個露出（地圖上面還有空間才捲，捲不完就捲到地圖頂） */
function unhide(s) {
  var r, b, d;
  if (!s.el.getBoundingClientRect) return;
  r = s.el.getBoundingClientRect(); b = s.bar.getBoundingClientRect();
  d = Math.min(r.bottom - b.top, r.top);
  if (d > 0) try { root.scrollBy({ top: d, behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* 捲不動就算了 */ }
}
function redo(s) {
  if (s.ring) { s.ring.remove(); s.ring = null; }
  s.lock = false; s.poly = null; s.msg = null;
  track(s, 'redo', 'lasso');
  draw(s);
}
function onUi(e) {
  var s = st, t = e.target && e.target.closest ? e.target.closest('button') : null, k, v;
  if (!s || !t || t.disabled) return;
  if ((k = t.getAttribute('data-mm'))) { if (k !== s.mode) mode(s, k); }
  else if ((k = t.getAttribute('data-mz'))) s.map[k === 'in' ? 'zoomIn' : 'zoomOut']();
  else if ((k = t.getAttribute('data-ma')) === 'go') { v = viewCheck(s); if (v.ok) done(s, 'view', v.poly); else upd(s); }
  else if (k === 'use') { if (s.poly) done(s, 'lasso', s.poly); }
  else if (k === 'redo') redo(s);
}

root.FindMap = { open: open, close: close, check: check, core: core };
})(typeof window !== 'undefined' ? window : globalThis);
