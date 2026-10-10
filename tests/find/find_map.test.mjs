// 地圖圈選（2026-10-09，find-map.js＋find-map.css＋自架 Leaflet 1.9.4）。
// 純函式：範圍驗證跟伺服器逐位元相同、圈選簡化、夾進台中市框、初始縮放。
// 畫面：用最小假 DOM＋假 Leaflet（只做 find-map 用到的 API）跑開圖、兩種用法、圈選、失敗與逾時、事件；
//       最後用建置好的 /find/ 頁把 find-app → find-scope → find-map 串起來走一次（需要先建置）。
// 這些不能取代真瀏覽器（版面、手指、深淺色），真瀏覽器的檢查在交付回報裡。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { transformSync } from "esbuild";
import { ROOT, bundleTs, readFixture, requireClassic } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock, flush, click, ev, submit, type } from "./fake_dom.mjs";

const MAP_PATH = "public/js/find-map.js";
const CSS_PATH = "public/js/find-map.css";
const VENDOR = "public/js/vendor/leaflet/1.9.4";
const MAP_SRC = fs.readFileSync(path.join(ROOT, MAP_PATH), "utf8");
const CSS_SRC = fs.readFileSync(path.join(ROOT, CSS_PATH), "utf8");
const M = requireClassic(MAP_PATH);
const S = (await bundleTs("src/lib/find/schema.ts")).mod;
const parse5 = await loadParse5();
const NO_DOM = parse5 ? false : "node_modules 內沒有 parse5";
const plain = x => JSON.parse(JSON.stringify(x));
const lf = s => s.replace(/\r\n/g, "\n");   // 以 repo 內的 LF 版本計（Windows 簽出會變 CRLF）
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");
const TILE = "https://wmts.nlsc.gov.tw/wmts/EMAP6_OPENDATA/default/GoogleMapsCompatible/{z}/{y}/{x}";

/* ===================== 靜態 ===================== */
test("find-map.js 靜態：IIFE、不用 innerHTML、沒有動態執行與網路請求、沒有儲存；外部網址只有 TILE_URL 一處；體積在預算內（LF 量測）", () => {
  const code = strip(MAP_SRC);
  assert.match(MAP_SRC, /^\/\*![\s\S]*?\*\/\s*\(function \(root\) \{/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"]/.test(code));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|document\.cookie|importScripts|\/api\//.test(code));
  // 網址字面（含註解）只有一處，就是規格那一串（預覽會整串替換，要一字不差）
  assert.deepEqual([...MAP_SRC.matchAll(/https?:\/\/[^\s'"`）)]+/g)].map(m => m[0]), [TILE]);
  assert.ok(MAP_SRC.includes(`var TILE_URL = '${TILE}';`));
  assert.equal(new URL(TILE).hostname, "wmts.nlsc.gov.tw");
  assert.equal((MAP_SRC.match(/wmts\.nlsc\.gov\.tw/g) || []).length, 1, "主機名稱只出現在 TILE_URL");
  assert.match(code, /new URL\(TILE_URL\)\.origin/, "preconnect 的網址從 TILE_URL 算");
  assert.match(code, /L\.tileLayer\(TILE_URL,/);
  assert.ok(!/['"]#[0-9a-f]{3,8}['"]|rgba?\(/i.test(code), "JS 裡不寫顏色（走 CSS token）");
  // 資源網址從頁面拿（不寫死）
  for (const a of ["data-lib", "data-css", "data-mcss"]) assert.ok(code.includes(`'${a}'`), a);
  assert.ok(!/vendor\/leaflet|find-map\.css/.test(code), "find-map.js 不寫死程式庫與樣式的路徑");
  const raw = Buffer.byteLength(lf(MAP_SRC));
  const min = transformSync(MAP_SRC, { minify: true, loader: "js", charset: "utf8", legalComments: "none" }).code;
  assert.ok(raw <= 24 * 1024, `原始檔 ${raw}`);
  assert.ok(zlib.gzipSync(min).length <= 7 * 1024, `gzip ${zlib.gzipSync(min).length}`);
  assert.ok(Buffer.byteLength(lf(CSS_SRC)) <= 8 * 1024, `CSS ${Buffer.byteLength(lf(CSS_SRC))}`);
});

test("預覽換圖片網址的規則（find-preview.mjs 的 TILE_RE）在 find-map.js 裡剛好對到一處，換完就沒有外部主機", () => {
  const pv = fs.readFileSync(path.join(ROOT, "scripts/find-preview.mjs"), "utf8");
  const m = /const TILE_RE = (\/.+\/g);/.exec(pv);
  assert.ok(m, "find-preview.mjs 沒有 TILE_RE");
  const re = new Function("return " + m[1])();
  assert.equal((MAP_SRC.match(re) || []).length, 1);
  const out = MAP_SRC.replace(re, "http://127.0.0.1:4321/__tiles/{z}/{y}/{x}");
  assert.ok(!/https:\/\//.test(out));
  assert.ok(out.includes("var TILE_URL = 'http://127.0.0.1:4321/__tiles/{z}/{y}/{x}';"));
});

test("postbuild-minify：find-map.js 會被壓縮（IIFE 不檢查頂層名稱）；壓完匯出與範圍驗證跟原檔相同", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/postbuild-minify.mjs"), "utf8");
  const m = /const missing = \((\/\^[^\n]*?\/)\.test\(code\)/.exec(src);
  assert.ok(m, "postbuild-minify.mjs 沒有 IIFE 例外判斷");
  assert.ok(new Function("return " + m[1])().test(MAP_SRC), "find-map.js 不是 IIFE 開頭");
  const mini = transformSync(MAP_SRC, { minify: true, loader: "js", legalComments: "none", charset: "utf8" }).code;
  assert.ok(mini.length < MAP_SRC.length);
  const mod = { exports: {} };
  vm.runInThisContext(`(function (module, exports) {${mini}\n})`)(mod, mod.exports);
  const B = mod.exports;
  assert.deepEqual(Object.keys(B).sort(), Object.keys(M).sort());
  assert.deepEqual(plain(B.T), plain(M.T), "固定文案沒有被壓壞");
  assert.equal(B.TILE_URL, TILE);
  for (const c of geoCases()) assert.deepEqual(plain(B.check(c.geo)), plain(M.check(c.geo)), c.id);
});

test("find-map.js／find-map.css 文案：沒有未完工建設、預測、絕對化字眼；沒有「次數／用完／上限」；沒有同業品牌與「估價」", () => {
  const brand = ["永", "慶"].join("");
  const bad = ["藍線", "輕軌", "橘線", "捷運", "預計", "即將", "規劃中", "興建中", "預測", "限時", "倒數", "稀缺", "搶", "絕版", "最強", "無敵", "保值", "抗跌", "增值", "看漲", "看跌",
    "次數", "用完", "上限", "今日額度", "估價", brand, "客戶回饋", "我有客戶", "我昨天", "殺價", "議價", "街廓", "圖磚"];
  for (const [f, s] of [[MAP_PATH, MAP_SRC], [CSS_PATH, CSS_SRC]]) {
    const t = strip(s);
    for (const w of bad) assert.ok(!t.includes(w), `${f} 含「${w}」`);
  }
  // 客人看得到的字都在固定表裡；繁體（沒有常見簡體字）
  const shown = JSON.stringify(plain(M.T)) + M.T.area("1.2") + M.T.got("1.2");
  assert.ok(!/[么为与来这个们说时会对过还没进]/.test(shown), "固定表有簡體字");
  assert.equal(M.T.credit, "地圖：內政部國土測繪中心 臺灣通用電子地圖（依政府資料開放授權條款第 1 版）");   // 審查 SEC-08
  assert.equal(M.T.keys, "用 Tab 移到地圖上，再用方向鍵移動、＋／－放大縮小，然後按『找這個畫面的範圍』。");
});

/* ===================== 純函式 ===================== */
function geoCases() {
  const FX = readFixture("need_fixtures.json");
  return FX.cases.filter(c => c.kind === "validate" && c.body && c.body.fields && typeof c.body.fields === "object" && "geo" in c.body.fields)
    .map(c => ({ id: c.id, only: c.only, geo: c.body.fields.geo, alone: Object.keys(c.body.fields).length === 1, expect: c.expect }));
}

test("FindMap.check：夾具裡每一個地圖範圍案（含只有伺服器跑的）跟 schema.ts 的 geoCheck 結果逐位元相同；只有範圍的案與期望值一致", () => {
  const cases = geoCases();
  assert.ok(cases.length >= 17, `地圖範圍案太少（${cases.length}）`);
  const ids = cases.map(c => c.id);
  for (const id of ["vs12", "vs13", "vs21", "vs22", "vs23", "vs26", "vs27", "vs28"]) assert.ok(ids.includes(id), id);
  for (const c of cases) {
    const a = M.check(c.geo), b = S.geoCheck(c.geo);
    assert.equal(a.ok, !!b.poly, c.id);
    assert.equal(a.code, b.code, c.id);
    assert.equal(a.km2, b.km2, c.id);   // 浮點數一模一樣（運算順序照抄）
    assert.deepEqual(a.poly, b.poly, c.id);
    if (c.alone && c.expect && c.expect.ok) assert.deepEqual(a.ok ? a.poly : undefined, c.expect.fields.geo, c.id);
  }
  // 各種壞資料不丟例外
  for (const v of [null, undefined, "x", [], [[1e308, 120.6], [24.16, 120.65], [24.17, 120.65]], [[-1e308, 120.6], [24.16, 120.65], [24.17, 120.65]],
    [[NaN, 1], [2, 3], [4, 5]], [[true, 120.64], [24.16, 120.65], [24.17, 120.65]], [["24.16", "120.64"], [24.16, 120.65], [24.17, 120.65]],
    Array.from({ length: 25 }, (_, i) => [24.1 + i / 1000, 120.6])]) {
    const r = M.check(v);
    assert.equal(r.ok, false);
    assert.equal(r.code, S.geoCheck(v).code);
  }
  assert.equal(M.check([[24.15, 120.6], [24.15, 120.68855], [24.1509, 120.68855], [24.1509, 120.6]]).code, "too_big", "長邊超過 8 公里");
});

test("四捨五入跟伺服器同公式（floor(x*1e5+0.5)/1e5，不用 Math.round）；夾進台中市框", () => {
  for (const x of [24.123455, 24.123445, 120.000005, 120.6600049999, 24.1599999, 0.000005, -24.123455]) {
    assert.equal(M.r5(x), Math.floor(x * 100000 + 0.5) / 100000, String(x));
  }
  const p = [[24.1600004, 120.6400004], [24.160002, 120.650003], [24.170001, 120.650001], [24.170004, 120.640002]];
  assert.deepEqual(M.shape(p), S.geoShape(p));
  assert.deepEqual(M.clampRect(24.1, 120.6, 24.2, 120.7), [[24.1, 120.6], [24.1, 120.7], [24.2, 120.7], [24.2, 120.6]]);
  assert.deepEqual(M.clampRect(23.9, 120.4, 24.0, 120.5), [[23.99, 120.45], [23.99, 120.5], [24.0, 120.5], [24.0, 120.45]], "超出框的部分夾掉");
  assert.equal(M.clampRect(25.0, 121.5, 25.1, 121.6), null, "完全在框外");
  assert.equal(M.clampRect(24.5, 120.6, 24.6, 120.7), null);
  assert.ok(M.check(M.clampRect(24.13, 120.63, 24.16, 120.66)).ok);
});

test("初始縮放依容器大小：343×440 → z14、680×520 → z15、768×520 → z15；量不到大小 → z14", () => {
  assert.equal(M.initZoom(343, 440), 14);
  assert.equal(M.initZoom(680, 520), 15);
  assert.equal(M.initZoom(768, 520), 15);
  assert.equal(M.initZoom(0, 0), 14);
  assert.equal(M.initZoom(undefined, undefined), 14);
  assert.equal(M.fmt(1.25), "1.3");
  assert.equal(M.fmt(0.31), "0.3");
  assert.equal(M.fmt(9.94), "9.9");
  assert.equal(M.fmt(11.47), "11");
  assert.equal(M.fmt(24.6), "25");
});

const circle = (cx, cy, r, n = 80, turns = 1) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * turns * i) / n), cy + r * Math.sin((2 * Math.PI * turns * i) / n)]);
test("圈選簡化：長筆畫 → ≤24 點、不交叉；畫成 8 字 → 改用凸包；太短 → null", () => {
  // 手抖的長筆畫（400 點）
  const noisy = Array.from({ length: 400 }, (_, i) => { const a = (2 * Math.PI * i) / 400, r = 120 + 6 * Math.sin(i * 1.7); return [200 + r * Math.cos(a), 200 + r * Math.sin(a)]; });
  const r1 = M.lassoRing(noisy);
  assert.ok(r1.length >= 3 && r1.length <= 24, String(r1.length));
  assert.equal(M.selfCross(r1), false);
  // 8 字
  const eight = Array.from({ length: 120 }, (_, i) => { const t = (2 * Math.PI * i) / 120; return [200 + 150 * Math.sin(t), 200 + 80 * Math.sin(2 * t)]; });
  const simp = M.capPts(eight);
  assert.equal(M.selfCross(simp), true, "簡化後還是交叉的 8 字");
  const r2 = M.lassoRing(eight);
  assert.equal(M.selfCross(r2), false);
  assert.deepEqual(r2, M.hull(simp), "8 字改用凸包");
  assert.equal(M.lassoRing(circle(100, 100, 5, 7)), null, "不到 8 點");
  assert.equal(M.lassoRing(null), null);
  // 首尾重疊的那一點去掉
  const closed = circle(100, 100, 80, 40);
  closed.push(closed[0].slice());
  const r3 = M.lassoRing(closed);
  assert.notDeepEqual(r3[0], r3[r3.length - 1]);
});

/* ===================== 畫面（假 DOM＋假 Leaflet） ===================== */
const BOX = [23.99, 120.45, 24.45, 121.45];
const COS = Math.cos((24.15 * Math.PI) / 180);
/** 假 Leaflet：只做 find-map 用到的 API。投影用線性近似（每像素經度 360/(256·2^z)，緯度再乘 cos 24.15°），夠驗面積與按鈕狀態。 */
function makeL(log) {
  class Ev {
    on(t, f) { ((this._h ||= {})[t] ||= []).push(f); return this; }
    fire(t, e) { for (const f of (this._h && this._h[t]) || []) f(e || {}); return this; }
  }
  class Layer extends Ev {
    constructor(kind, ll, o) { super(); this.kind = kind; this.ll = ll; this.options = o; this._map = null; }
    addTo(m) { m.layers.add(this); this._map = m; return this; }
    remove() { if (this._map) this._map.layers.delete(this); this._map = null; return this; }
    addLatLng(x) { this.ll.push(x); return this; }
  }
  class Handler { constructor(on) { this.on = on; } enable() { this.on = true; } disable() { this.on = false; } enabled() { return this.on; } }
  class FMap extends Ev {
    constructor(el, o) {
      super();
      Object.assign(this, { el, options: o, layers: new Set(), zoom: null, center: null, size: { x: 343, y: 440 }, calls: [] });
      for (const k of ["dragging", "touchZoom", "doubleClickZoom", "boxZoom", "keyboard"]) this[k] = new Handler(true);
      this.scrollWheelZoom = new Handler(!!o.scrollWheelZoom);
      log.maps.push(this);
      log.order.push("map");
    }
    setView(c, z) { this.center = c.slice(); this.zoom = z; this.calls.push(["setView", c, z]); this.fire("moveend"); return this; }
    fitBounds(b, o) {
      const la = b.map(p => p[0]), ln = b.map(p => p[1]);
      this.calls.push(["fitBounds", b, o]);
      return this.setView([(Math.min(...la) + Math.max(...la)) / 2, (Math.min(...ln) + Math.max(...ln)) / 2], Math.min(o.maxZoom, 15));
    }
    getZoom() { return this.zoom; }
    getMaxZoom() { return this.options.maxZoom; }
    getMinZoom() { return this.options.minZoom; }
    zoomIn() { this.zoom = Math.min(this.zoom + 1, 17); this.fire("moveend"); }
    zoomOut() { this.zoom = Math.max(this.zoom - 1, 11); this.fire("moveend"); }
    dx() { return 360 / (256 * 2 ** this.zoom); }
    getBounds() {
      const dx = this.dx(), dy = dx * COS, [lat, lng] = this.center, w = this.size.x / 2, h = this.size.y / 2;
      return { getSouth: () => lat - h * dy, getNorth: () => lat + h * dy, getWest: () => lng - w * dx, getEast: () => lng + w * dx };
    }
    containerPointToLatLng(p) {
      const [x, y] = Array.isArray(p) ? p : [p.x, p.y], b = this.getBounds(), dx = this.dx();
      return { lat: b.getNorth() - y * dx * COS, lng: b.getWest() + x * dx };
    }
    mouseEventToContainerPoint(e) { return { x: e.clientX, y: e.clientY }; }
    invalidateSize() { this.invalidated = (this.invalidated || 0) + 1; log.order.push("invalidateSize"); }
    remove() { this.removed = true; }
  }
  return {
    version: "1.9.4",
    map: (el, o) => new FMap(el, o),
    tileLayer: (url, o) => { const t = new Layer("tile", [], o); t.url = url; log.tiles.push(t); return t; },
    polyline: (ll, o) => new Layer("line", ll.slice(), o),
    polygon: (ll, o) => new Layer("polygon", ll, o),
  };
}

const PAGE = `<!doctype html><html><head></head><body><main class="ui2"><div class="u2-state" data-s="s1">
<div id="scope-map" class="u2-scope" data-src="/js/find-map.js?v=t" data-lib="/js/vendor/leaflet/1.9.4/leaflet.js" data-css="/js/vendor/leaflet/1.9.4/leaflet.css" data-mcss="/js/find-map.css?v=t">
<div id="scope-map-mount"><p class="u2-scope__help" role="status">地圖載入中…</p></div></div></div></main></body></html>`;

/** 開一個只有地圖面板的假頁面，執行 find-map.js；opts 給 FindMap.open */
async function mapEnv({ reduceMotion = false, size = null, preL = false, rects = null } = {}) {
  const clock = makeClock();
  const { doc, win } = makeEnv({ html: PAGE, parse5, fetchImpl: () => { throw new Error("地圖模組不應該發任何資料請求"); }, clock, reduceMotion });
  const log = { maps: [], tiles: [], order: [], track: [], done: [], fail: [], cancel: 0, capture: [], scrolled: [] };
  win.URL = URL;
  win.requestAnimationFrame = fn => clock.setTimeout(fn, 16);
  const L = makeL(log);
  if (preL) win.L = L;
  if (size || rects) {   // 讓地圖容器量得到大小（測初始縮放）；給版面位置（測「捲到地圖」）
    const mk = doc.createElement;
    doc.createElement = t => {
      const e = mk(t);
      if (t === "div" && size) { e.clientWidth = size[0]; e.clientHeight = size[1]; }
      if (t === "div" && rects) {
        win.innerHeight = rects.vh;
        win.scrollBy = o => log.scrolled.push(["window", o]);
        e.getBoundingClientRect = () => rects[e.className.split(" ")[0]] || { top: 0, bottom: 0, height: 0 };
        e.scrollIntoView = o => log.scrolled.push([e.className, o]);
      }
      return e;
    };
  }
  const ctx = vm.createContext(win);
  vm.runInContext(MAP_SRC, ctx, { filename: "find-map.js" });
  const $ = s => doc.querySelector(s);
  const $$ = s => doc.querySelectorAll(s);
  const head = re => doc.head.childNodes.filter(n => n.localName && re.test(n.getAttribute("href") || n.getAttribute("src") || ""));
  const opts = (over = {}) => ({
    poly: null,
    onDone: p => log.done.push(plain(p)),
    onCancel: () => { log.cancel++; },
    onFail: c => log.fail.push(c),
    track: (n, p) => log.track.push([n, plain(p)]),
    ...over,
  });
  /** 讓程式庫與兩份樣式「載好」，再等兩個畫面更新 */
  const loadLib = async () => {
    for (const el of head(/leaflet\.css|find-map\.css/)) el.onload();
    const js = head(/leaflet\.js/);
    if (js.length) { win.L = L; js[0].onload(); }
    await clock.advance(40);
  };
  const open = async (o = {}) => { win.FindMap.open($("#scope-map-mount"), opts(o)); await flush(); };
  const map = () => log.maps[log.maps.length - 1];
  const el = () => $(".u2-map");
  const btn = sel => $(`.u2-mapui [${sel}]`);
  const status = () => $(".u2-map__status").textContent;
  /** 在地圖上畫一筆（容器像素座標） */
  const stroke = (pts, { id = 1, primary = true } = {}) => {
    const m = el();
    m.dispatchEvent(ev("pointerdown", { isPrimary: primary, pointerId: id, pointerType: "touch", button: 0, clientX: pts[0][0], clientY: pts[0][1] }));
    for (const [x, y] of pts.slice(1)) m.dispatchEvent(ev("pointermove", { isPrimary: primary, pointerId: id, pointerType: "touch", clientX: x, clientY: y }));
    m.dispatchEvent(ev("pointerup", { isPrimary: primary, pointerId: id, pointerType: "touch", clientX: pts[pts.length - 1][0], clientY: pts[pts.length - 1][1] }));
  };
  const built = async (o = {}) => { await open(o); await loadLib(); el().setPointerCapture = id => log.capture.push(id); return map(); };
  return { clock, doc, win, log, L, $, $$, head, opts, open, loadLib, map, el, btn, status, stroke, built };
}
const areaOf = m => { const b = m.getBounds(); return M.check(M.clampRect(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())).km2; };
const areaEvents = log => log.track.map(([n, p]) => { assert.equal(n, "area", "只送 area 事件"); return p; });

test("開圖：先顯示「地圖載入中…」；程式庫與兩份樣式（網址從頁面拿）都載好、等兩個畫面更新才建；參數照規格；建完馬上 invalidateSize", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  await t.open();
  assert.equal(t.$("#scope-map-mount").textContent, "地圖載入中…");
  assert.equal(t.$("#scope-map-mount [role=status]").textContent, "地圖載入中…");
  const css = t.head(/leaflet\.css/), mcss = t.head(/find-map\.css/), js = t.head(/leaflet\.js/);
  assert.deepEqual([css.length, mcss.length, js.length], [1, 1, 1]);
  assert.equal(css[0].getAttribute("href"), "/js/vendor/leaflet/1.9.4/leaflet.css");
  assert.equal(mcss[0].getAttribute("href"), "/js/find-map.css?v=t");
  assert.equal(js[0].getAttribute("src"), "/js/vendor/leaflet/1.9.4/leaflet.js");
  const pc = t.doc.head.childNodes.filter(n => n.localName === "link" && n.getAttribute("rel") === "preconnect");
  assert.equal(pc.length, 1);
  assert.equal(pc[0].getAttribute("href"), "https://wmts.nlsc.gov.tw");
  assert.equal(pc[0].getAttribute("crossorigin"), "anonymous");
  // 程式庫到了、樣式還沒到：不建（Leaflet 樣式沒到就建會先出現沒排版的圖片）
  t.win.L = t.L;
  js[0].onload();
  css[0].onload();
  await t.clock.advance(1000);
  assert.equal(t.log.maps.length, 0, "樣式沒到不建地圖");
  mcss[0].onload();
  await t.clock.advance(16);
  assert.equal(t.log.maps.length, 0, "等兩個畫面更新");
  await t.clock.advance(16);
  assert.equal(t.log.maps.length, 1);
  assert.deepEqual(t.log.order, ["map", "invalidateSize"]);
  const m = t.map();
  assert.deepEqual(plain(m.options), {
    zoomControl: false, attributionControl: false, scrollWheelZoom: false, keyboard: true, minZoom: 11, maxZoom: 17,
    maxBounds: [[23.94, 120.4], [24.5, 121.5]], zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: true,
  });
  assert.equal(t.log.tiles.length, 1);
  assert.equal(t.log.tiles[0].url, TILE);
  assert.deepEqual(plain(t.log.tiles[0].options), {
    minZoom: 11, maxNativeZoom: 15, maxZoom: 17, referrerPolicy: "no-referrer", crossOrigin: "anonymous", detectRetina: false, bounds: [[23.99, 120.45], [24.45, 121.45]],
  });
  assert.ok(m.layers.has(t.log.tiles[0]));
  assert.deepEqual(plain(m.calls[0]), ["setView", [24.15, 120.66], 14]);
  // 版面：說明 → 鍵盤說明（在地圖前面）→ 地圖＋放大縮小 → 動作列 → 圖資標示
  const ui = t.$(".u2-mapui");
  assert.deepEqual(ui.childNodes.map(n => n.className), ["u2-map__lead", "u2-map__keys", "u2-map__wrap", "u2-map__bar", "u2-map__credit"]);
  assert.equal(t.$(".u2-map__lead").textContent, "把地圖移到想找的地方，再按下面的按鈕。");
  assert.equal(t.$(".u2-map__keys summary").textContent, "用鍵盤操作");
  assert.equal(t.$(".u2-map__credit").textContent, "地圖：內政部國土測繪中心 臺灣通用電子地圖（依政府資料開放授權條款第 1 版）");
  assert.equal(t.el().getAttribute("aria-label"), "地圖。用 Tab 移到這裡後，可以用方向鍵移動、加號減號放大縮小。");
  assert.deepEqual(t.$$(".u2-map__zbtn").map(b => b.textContent), ["放大", "縮小"]);
  assert.equal(t.$(".u2-map__status").getAttribute("aria-live"), "polite");
  assert.equal(t.$(".u2-map__modes").getAttribute("role"), "group");
  assert.deepEqual(t.$$(".u2-map__modes button").map(b => [b.textContent, b.getAttribute("aria-pressed")]), [["移動地圖", "true"], ["我要自己圈", "false"]]);
  assert.deepEqual(t.$$(".u2-map__acts button").filter(b => !b.hidden).map(b => b.textContent), ["找這個畫面的範圍"]);
  assert.equal(t.btn('data-ma="go"').disabled, false);
  assert.equal(t.status(), "這個畫面約 " + M.fmt(areaOf(m)) + " 平方公里");
  assert.ok(areaOf(m) > 11 && areaOf(m) < 12, String(areaOf(m)));
  assert.deepEqual(areaEvents(t.log), [{ a: "open", m: "view" }]);
  for (const b of t.$$(".u2-mapui button")) assert.equal(b.getAttribute("type"), "button");
});

test("初始畫面：電腦大地圖（680×520）用 z15；有舊範圍就 fitBounds（最大 z16）並畫成虛線；減少動態時關掉動畫", { skip: NO_DOM }, async () => {
  const a = await mapEnv({ size: [680, 520] });
  await a.built();
  assert.deepEqual(plain(a.map().calls[0]), ["setView", [24.15, 120.66], 15]);
  const SQ = [[24.16, 120.64], [24.16, 120.65], [24.17, 120.65], [24.17, 120.64]];
  const b = await mapEnv();
  await b.built({ poly: SQ });
  assert.equal(b.map().calls[0][0], "fitBounds");
  assert.deepEqual(plain(b.map().calls[0][1]), SQ);
  assert.deepEqual(plain(b.map().calls[0][2]), { maxZoom: 16, animate: false });
  const old = [...b.map().layers].find(l => l.kind === "polygon");
  assert.equal(old.options.className, "u2-map__old");
  assert.equal(old.options.interactive, false);
  const c = await mapEnv({ reduceMotion: true });
  await c.built({ poly: [[1, 2], [3, 4]] });
  assert.equal(c.map().calls[0][0], "setView", "舊範圍壞掉就當沒有");
  for (const k of ["zoomAnimation", "fadeAnimation", "markerZoomAnimation"]) assert.equal(c.map().options[k], false, k);
});

test("開完地圖：地圖露出不到九成（手機上面有標題與分頁按鈕）→ 把地圖畫面捲到最上面；露得夠就不動；減少動態時不用平滑捲動", { skip: NO_DOM }, async () => {
  const low = { vh: 812, "u2-map": { top: 402, bottom: 808, height: 406 }, "u2-map__bar": { top: 649, bottom: 812, height: 163 } };
  const a = await mapEnv({ rects: low });
  await a.built();
  assert.deepEqual(plain(a.log.scrolled), [["u2-mapui", { block: "start", behavior: "smooth" }]]);
  const b = await mapEnv({ rects: { vh: 812, "u2-map": { top: 139, bottom: 545, height: 406 }, "u2-map__bar": { top: 558, bottom: 720, height: 162 } } });
  await b.built();
  assert.deepEqual(b.log.scrolled, [], "整張地圖都看得到：不捲");
  const c = await mapEnv({ rects: low, reduceMotion: true });
  await c.built();
  assert.deepEqual(plain(c.log.scrolled), [["u2-mapui", { block: "start", behavior: "auto" }]]);
});

test("移動模式：畫面移動就更新面積；超過 25 平方公里或太長 → 主要按鈕不能按、字變「先放大一點」；台中外 → 不能按＋說明；狀態同一句不重念", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  const go = t.btn('data-ma="go"');
  m.zoomOut(); m.zoomOut(); m.zoomOut();
  assert.equal(m.getZoom(), 11);
  assert.equal(go.disabled, true);
  assert.equal(go.textContent, "先放大一點");
  assert.match(t.status(), /^這個畫面約 \d+ 平方公里$/);
  assert.equal(t.btn('data-mz="out"').disabled, true, "最小縮放：縮小鈕不能按");
  click(go);
  assert.equal(t.log.done.length, 0, "不能按就不送");
  m.zoomIn(); m.zoomIn(); m.zoomIn();
  assert.equal(go.disabled, false);
  assert.equal(go.textContent, "找這個畫面的範圍");
  assert.equal(t.btn('data-mz="out"').disabled, false);
  // 放大縮小鈕
  click(t.btn('data-mz="in"'));
  assert.equal(m.getZoom(), 15);
  click(t.btn('data-mz="in"')); click(t.btn('data-mz="in"'));
  assert.equal(m.getZoom(), 17);
  assert.equal(t.btn('data-mz="in"').disabled, true, "最大縮放：放大鈕不能按");
  click(t.btn('data-mz="out"')); click(t.btn('data-mz="out"')); click(t.btn('data-mz="out"'));
  // 長邊超過 8 公里（面積不大）：電腦超寬的地圖
  m.size = { x: 2200, y: 200 };
  m.fire("moveend");
  assert.equal(go.disabled, true);
  assert.equal(go.textContent, "先放大一點");
  m.size = { x: 343, y: 440 };
  // 台中外
  m.center = [25.03, 121.56];
  m.fire("moveend");
  assert.equal(go.disabled, true);
  assert.equal(t.status(), "這裡不在台中市，請移到台中市內。");
  m.center = [24.15, 120.66];
  m.fire("moveend");
  assert.equal(go.disabled, false);
  // 同一句不重念：畫面平移但面積沒變 → 狀態文字不動（這裡用手動改字來看它有沒有被重寫）
  const st = t.$(".u2-map__status");
  st.textContent = "（記號）";
  m.center = [24.16, 120.67];
  m.fire("moveend");
  assert.equal(st.textContent, "（記號）", "同一段文字不重念");
  // 按「找這個畫面的範圍」：夾進台中市框的 4 點矩形，過 check
  m.center = [23.995, 120.66];   // 南邊一部分在框外
  m.fire("moveend");
  click(go);
  assert.equal(t.log.done.length, 1);
  const poly = t.log.done[0];
  assert.equal(poly.length, 4);
  assert.ok(M.check(poly).ok);
  assert.deepEqual(M.check(poly).poly, poly, "已經四捨五入");
  assert.ok(poly.every(p => p[0] >= 23.99), "夾進台中市框");
  assert.deepEqual(areaEvents(t.log).slice(-1), [{ a: "done", m: "view" }]);
  // find-scope 收到後叫 close()：完成的不算取消；拆地圖、地圖區放回「地圖載入中…」
  t.win.FindMap.close();
  t.win.FindMap.close();   // 重複呼叫無害
  assert.equal(m.removed, true);
  assert.ok(!areaEvents(t.log).some(e => e.a === "cancel"));
  assert.equal(t.$("#scope-map-mount").textContent, "地圖載入中…");
  assert.equal(t.$(".u2-mapui"), null);
});

test("兩種用法都關滾輪縮放；進「我要自己圈」：aria-pressed、touch-action 的 class、關拖曳與手勢縮放；回「移動地圖」全部恢復", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  assert.equal(m.scrollWheelZoom.enabled(), false);
  click(t.btn('data-mm="lasso"'));
  assert.deepEqual(t.$$(".u2-map__modes button").map(b => b.getAttribute("aria-pressed")), ["false", "true"]);
  assert.ok(t.el().classList.contains("u2-map--draw"));
  for (const k of ["dragging", "touchZoom", "doubleClickZoom", "boxZoom"]) assert.equal(m[k].enabled(), false, k);
  assert.equal(m.keyboard.enabled(), true, "鍵盤照樣能移動");
  assert.equal(m.scrollWheelZoom.enabled(), false);
  assert.equal(t.status(), "用一根手指（電腦用滑鼠）在地圖上畫一圈。");
  assert.deepEqual(t.$$(".u2-map__acts button").filter(b => !b.hidden).map(b => [b.textContent, b.disabled]), [["用這一圈找", true]]);
  click(t.btn('data-mm="view"'));
  assert.ok(!t.el().classList.contains("u2-map--draw"));
  for (const k of ["dragging", "touchZoom", "doubleClickZoom", "boxZoom"]) assert.equal(m[k].enabled(), true, k);
  assert.equal(m.scrollWheelZoom.enabled(), false);
  assert.deepEqual(t.$$(".u2-map__acts button").filter(b => !b.hidden).map(b => b.textContent), ["找這個畫面的範圍"]);
});

test("自己圈：一筆畫完 → 簡化（≤24 點）→ 鎖住（不再收筆、拿掉 touch-action）→「圈好了」＋用這一圈找／重畫；送出的是過 check 的範圍", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  click(t.btn('data-mm="lasso"'));
  const pts = circle(170, 220, 90, 60);   // 每點相隔約 9.4 像素（≥6 才收）
  // 畫到一半：線即時畫出來
  const e0 = t.el();
  e0.dispatchEvent(ev("pointerdown", { isPrimary: true, pointerId: 7, pointerType: "touch", button: 0, clientX: pts[0][0], clientY: pts[0][1] }));
  assert.deepEqual(t.log.capture, [7], "setPointerCapture");
  for (const [x, y] of pts.slice(1, 30)) e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 7, clientX: x, clientY: y }));
  e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 7, clientX: pts[29][0] + 2, clientY: pts[29][1] }));   // 不到 6 像素不收
  const line = [...m.layers].find(l => l.kind === "line");
  assert.ok(line);
  assert.equal(line.options.className, "u2-map__line");
  assert.equal(line.ll.length, 30);
  e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 99, clientX: 0, clientY: 0 }));   // 別的手指的移動不收
  assert.equal(line.ll.length, 30);
  for (const [x, y] of pts.slice(30)) e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 7, clientX: x, clientY: y }));
  e0.dispatchEvent(ev("pointerup", { isPrimary: true, pointerId: 7, clientX: pts[59][0], clientY: pts[59][1] }));
  assert.ok(!m.layers.has(line), "畫完把線換成一圈");
  const ring = [...m.layers].find(l => l.kind === "polygon");
  assert.equal(ring.options.className, "u2-map__ring");
  assert.ok(ring.ll.length >= 3 && ring.ll.length <= 24, String(ring.ll.length));
  assert.ok(!t.el().classList.contains("u2-map--draw"), "圈完拿掉 touch-action（手指拖＝捲網頁）");
  const c = M.check(plain(ring.ll));
  assert.ok(c.ok);
  assert.equal(t.status(), `圈好了，約 ${M.fmt(c.km2)} 平方公里。可以按『用這一圈找』，或按『重畫』。`);
  assert.deepEqual(t.$$(".u2-map__acts button").filter(b => !b.hidden).map(b => [b.textContent, b.disabled]), [["用這一圈找", false], ["重畫", false]]);
  // 鎖住：再畫不收
  t.stroke(circle(100, 100, 40, 40), { id: 8 });
  assert.equal([...m.layers].filter(l => l.kind === "polygon" || l.kind === "line").length, 1, "圈完一筆就鎖住");
  // 換回移動地圖再回來：那一圈還在
  click(t.btn('data-mm="view"'));
  assert.ok(!m.layers.has(ring));
  click(t.btn('data-mm="lasso"'));
  assert.ok(m.layers.has(ring));
  assert.equal(t.btn('data-ma="use"').disabled, false);
  click(t.btn('data-ma="use"'));
  assert.deepEqual(t.log.done, [c.poly]);
  assert.deepEqual(areaEvents(t.log), [{ a: "open", m: "view" }, { a: "done", m: "lasso" }]);
});

test("圈完：黏在底部的動作列蓋到地圖下緣（320×640 實測蓋掉 98px）→ 網頁往下捲到不蓋（上面空間不夠就捲到地圖頂）；沒蓋到就不捲；減少動態時不用平滑捲動", { skip: NO_DOM }, async () => {
  const pts = circle(150, 160, 60, 40);
  const drawn = async (rects, reduceMotion = false) => {
    const t = await mapEnv({ rects, reduceMotion });
    await t.built();
    t.log.scrolled.length = 0;   // 開圖時的「捲到地圖」另外測
    click(t.btn('data-mm="lasso"'));
    t.stroke(pts);
    assert.match(t.status(), /^圈好了/);
    return plain(t.log.scrolled);
  };
  const cover = { vh: 640, "u2-map": { top: 138, bottom: 458, height: 320 }, "u2-map__bar": { top: 360, bottom: 640, height: 280 } };
  assert.deepEqual(await drawn(cover), [["window", { top: 98, behavior: "smooth" }]]);
  const tight = { vh: 568, "u2-map": { top: 40, bottom: 324, height: 284 }, "u2-map__bar": { top: 288, bottom: 568, height: 280 } };
  assert.deepEqual(await drawn(tight), [["window", { top: 36, behavior: "smooth" }]], "蓋 36、上面有 40 → 捲 36");
  const top = { vh: 568, "u2-map": { top: 10, bottom: 294, height: 284 }, "u2-map__bar": { top: 288, bottom: 568, height: 280 } };
  assert.deepEqual(await drawn(top), [["window", { top: 6, behavior: "smooth" }]], "蓋 6、上面只有 10 → 捲 6");
  const clear = { vh: 844, "u2-map": { top: 139, bottom: 561, height: 422 }, "u2-map__bar": { top: 574, bottom: 765, height: 191 } };
  assert.deepEqual(await drawn(clear), [], "沒蓋到：不捲");
  assert.deepEqual(await drawn(cover, true), [["window", { top: 98, behavior: "auto" }]]);
});

test("自己圈：第二根手指放上來就取消這一筆並說明；說明同一句 1 秒內不重念；重畫；只是點一下不算", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  click(t.btn('data-mm="lasso"'));
  const e0 = t.el(), pts = circle(170, 220, 90, 60);
  e0.dispatchEvent(ev("pointerdown", { isPrimary: true, pointerId: 1, pointerType: "touch", button: 0, clientX: pts[0][0], clientY: pts[0][1] }));
  for (const [x, y] of pts.slice(1, 20)) e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 1, clientX: x, clientY: y }));
  e0.dispatchEvent(ev("pointerdown", { isPrimary: false, pointerId: 2, pointerType: "touch", button: 0, clientX: 10, clientY: 10 }));
  assert.equal(t.status(), "畫的時候只用一根手指。要移動或放大地圖，先按『移動地圖』。");
  assert.equal([...m.layers].filter(l => l.kind === "line").length, 0, "這一筆取消");
  for (const [x, y] of pts.slice(20)) e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 1, clientX: x, clientY: y }));
  e0.dispatchEvent(ev("pointerup", { isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 }));
  assert.equal([...m.layers].filter(l => l.kind === "polygon").length, 0, "第一根手指放開也不算一圈");
  assert.ok(t.el().classList.contains("u2-map--draw"), "沒鎖住，可以再畫");
  // 1 秒內同一句不重念；過 1 秒可以再念
  const st = t.$(".u2-map__status");
  st.textContent = "（記號）";
  e0.dispatchEvent(ev("pointerdown", { isPrimary: true, pointerId: 3, pointerType: "touch", button: 0, clientX: 50, clientY: 50 }));
  e0.dispatchEvent(ev("pointerdown", { isPrimary: false, pointerId: 4, pointerType: "touch", button: 0, clientX: 60, clientY: 60 }));
  assert.equal(st.textContent, "（記號）", "1 秒內同一句不重念");
  await t.clock.advance(1100);
  e0.dispatchEvent(ev("pointerdown", { isPrimary: true, pointerId: 5, pointerType: "touch", button: 0, clientX: 50, clientY: 50 }));
  e0.dispatchEvent(ev("pointerdown", { isPrimary: false, pointerId: 6, pointerType: "touch", button: 0, clientX: 60, clientY: 60 }));
  assert.equal(st.textContent, "畫的時候只用一根手指。要移動或放大地圖，先按『移動地圖』。");
  // 只是點一下：不鎖、不說話
  st.textContent = "（記號）";
  t.stroke([[50, 50]]);
  assert.equal(st.textContent, "（記號）");
  assert.ok(t.el().classList.contains("u2-map--draw"));
  // 滑鼠右鍵不畫
  e0.dispatchEvent(ev("pointerdown", { isPrimary: true, pointerId: 9, pointerType: "mouse", button: 2, clientX: 50, clientY: 50 }));
  assert.equal([...m.layers].filter(l => l.kind === "line").length, 0);
  // 畫好再重畫
  t.stroke(circle(170, 220, 90, 80));
  assert.equal([...m.layers].filter(l => l.kind === "polygon").length, 1);
  click(t.btn('data-ma="redo"'));
  assert.equal([...m.layers].filter(l => l.kind === "polygon").length, 0);
  assert.ok(t.el().classList.contains("u2-map--draw"), "重畫：touch-action 加回來");
  assert.equal(t.status(), "用一根手指（電腦用滑鼠）在地圖上畫一圈。");
  assert.equal(t.btn('data-ma="use"').disabled, true);
  assert.equal(t.btn('data-ma="redo"').hidden, true);
  assert.deepEqual(areaEvents(t.log).slice(-1), [{ a: "redo", m: "lasso" }]);
  // pointercancel：丟掉這一筆
  e0.dispatchEvent(ev("pointerdown", { isPrimary: true, pointerId: 11, pointerType: "touch", button: 0, clientX: 50, clientY: 50 }));
  e0.dispatchEvent(ev("pointermove", { isPrimary: true, pointerId: 11, clientX: 90, clientY: 90 }));
  e0.dispatchEvent(ev("pointercancel", { isPrimary: true, pointerId: 11, clientX: 90, clientY: 90 }));
  assert.equal([...m.layers].filter(l => l.kind === "line" || l.kind === "polygon").length, 0);
});

test("自己圈的提示：太大、太小、台中外、8 字改凸包；不合格的圈畫成錯誤樣式、「用這一圈找」不能按", { skip: NO_DOM }, async () => {
  const cases = [
    { name: "太大", zoom: 11, center: [24.15, 120.66], pts: circle(170, 220, 160, 100), msg: "範圍太大了（超過 25 平方公里，或太長）。放大一點，或圈小一點。" },
    { name: "太小", zoom: 17, center: [24.15, 120.66], pts: circle(170, 220, 15, 12), msg: "範圍太小了，至少圈住一整條街的範圍。只想看某一個社區，可以改用『找某個社區』。" },
    { name: "台中外", zoom: 14, center: [24.452, 120.66], pts: circle(170, 100, 90, 80), msg: "這裡不在台中市，請移到台中市內。" },
  ];
  for (const c of cases) {
    const t = await mapEnv();
    const m = await t.built();
    m.setView(c.center, c.zoom);
    click(t.btn('data-mm="lasso"'));
    t.stroke(c.pts);
    assert.equal(t.status(), c.msg, c.name);
    const ring = [...m.layers].find(l => l.kind === "polygon");
    assert.equal(ring.options.className, "u2-map__ring u2-map__ring--bad", c.name);
    assert.equal(t.btn('data-ma="use"').disabled, true, c.name);
    assert.equal(t.btn('data-ma="redo"').hidden, false, c.name);
    click(t.btn('data-ma="use"'));
    assert.equal(t.log.done.length, 0, c.name);
  }
  // 筆畫太短（2–7 點）：說太小、不鎖
  const s = await mapEnv();
  await s.built();
  click(s.btn('data-mm="lasso"'));
  s.stroke([[10, 10], [30, 10], [50, 10]]);
  assert.match(s.status(), /^範圍太小了/);
  assert.ok(s.el().classList.contains("u2-map--draw"));
  // 8 字 → 凸包，照樣可以用
  const e = await mapEnv();
  const m = await e.built();
  click(e.btn('data-mm="lasso"'));
  e.stroke(Array.from({ length: 120 }, (_, i) => { const a = (2 * Math.PI * i) / 120; return [170 + 120 * Math.sin(a), 220 + 70 * Math.sin(2 * a)]; }));
  const ring = [...m.layers].find(l => l.kind === "polygon");
  assert.equal(ring.options.className, "u2-map__ring");
  assert.equal(M.selfCross(plain(ring.ll)), false);
  assert.match(e.status(), /^圈好了/);
});

test("載不到：程式庫錯誤 → onFail('load')＋fail 事件、地圖區放回；再開會重試；15 秒沒好也算失敗；樣式沒到就不建", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  await t.open();
  t.head(/leaflet\.js/)[0].onerror();
  assert.deepEqual(t.log.fail, ["load"]);
  assert.deepEqual(areaEvents(t.log), [{ a: "fail" }]);
  assert.equal(t.$("#scope-map-mount").textContent, "地圖載入中…");
  await t.open();
  assert.equal(t.head(/leaflet\.js/).length, 1, "舊的那支拿掉、重新載一次");
  await t.loadLib();
  assert.equal(t.log.maps.length, 1, "重試成功");
  // 逾時
  const u = await mapEnv();
  await u.open();
  await u.clock.advance(14900);
  assert.deepEqual(u.log.fail, []);
  await u.clock.advance(200);
  assert.deepEqual(u.log.fail, ["load"]);
  // 開到一半就關（客人換分頁）：之後載好也不建
  const w = await mapEnv();
  await w.open();
  w.win.FindMap.close();
  await w.loadLib();
  assert.equal(w.log.maps.length, 0);
  assert.ok(!areaEvents(w.log).some(e => e.a === "cancel"), "還沒開出來就關：不算取消");
  // 已經有 L（例如重開）：只載兩份樣式
  const x = await mapEnv({ preL: true });
  await x.open();
  assert.equal(x.head(/leaflet\.js/).length, 0);
  assert.equal(x.head(/\.css/).length, 2);
  // 程式庫載到了、建地圖卻丟例外（程式庫壞掉）：當成載不到
  const z = await mapEnv();
  await z.open();
  for (const el of z.head(/\.css/)) el.onload();
  z.win.L = { ...z.L, map: () => { throw new Error("壞掉的程式庫"); } };
  z.head(/leaflet\.js/)[0].onload();
  await z.clock.advance(40);
  assert.deepEqual(z.log.fail, ["load"]);
  assert.equal(z.$("#scope-map-mount").textContent, "地圖載入中…");
  // 掛載點不在 #scope-map 裡：拿不到資源網址 → 失敗
  const y = await mapEnv();
  const lone = y.doc.createElement("div");
  y.doc.body.appendChild(lone);
  y.win.FindMap.open(lone, y.opts());
  assert.deepEqual(y.log.fail, ["load"]);
});

test("圖片：10 秒一張都沒載好 → 慢的提示（不關地圖）、載到就恢復；連續 8 張失敗 → onFail('tiles')、拆地圖", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  const tl = t.log.tiles[0];
  await t.clock.advance(9900);
  assert.notEqual(t.status(), "地圖圖片載得很慢。可以再等一下，或改用選區域。");
  await t.clock.advance(200);
  assert.equal(t.status(), "地圖圖片載得很慢。可以再等一下，或改用選區域。");
  assert.equal(m.removed, undefined, "不關地圖");
  tl.fire("tileload");
  assert.match(t.status(), /^這個畫面約 /);
  for (let i = 0; i < 7; i++) tl.fire("tileerror");
  tl.fire("tileload");   // 中間有一張成功：重新算
  for (let i = 0; i < 7; i++) tl.fire("tileerror");
  assert.deepEqual(t.log.fail, []);
  tl.fire("tileerror");
  assert.deepEqual(t.log.fail, ["tiles"]);
  assert.equal(m.removed, true);
  assert.deepEqual(areaEvents(t.log), [{ a: "open", m: "view" }, { a: "fail" }]);
  t.win.FindMap.close();   // find-scope 收到 onFail 也會叫 close：無害、不記取消
  assert.ok(!areaEvents(t.log).some(e => e.a === "cancel"));
});

test("close()：沒完成就關 → cancel 事件（帶目前用法）；解除所有監聽；重開前先關舊的；事件內容都合規格", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  click(t.btn('data-mm="lasso"'));
  const el = t.el(), ui = t.$(".u2-mapui");
  t.win.FindMap.close();
  assert.deepEqual(areaEvents(t.log).slice(-1), [{ a: "cancel", m: "lasso" }]);
  assert.equal(m.removed, true);
  for (const k of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) assert.equal((el._listeners[k] || []).length, 0, k);
  assert.equal((ui._listeners.click || []).length, 0);
  assert.equal(t.log.cancel, 0, "close 不回呼 onCancel（find-scope 自己決定去哪）");
  // 重開：舊的先關掉
  await t.built();
  const m2 = t.map();
  await t.open();
  assert.equal(m2.removed, true);
  assert.deepEqual(areaEvents(t.log).slice(-1), [{ a: "cancel", m: "view" }]);
  // 事件全部合規格（不含座標）
  for (const p of areaEvents(t.log)) {
    const e = S.validateEvent({ e: "area", t: 1000, s: "s1", ...p });
    assert.ok(e, JSON.stringify(p));
    assert.deepEqual(Object.keys(p).filter(k => !["a", "m"].includes(k)), []);
    assert.ok(S.EVENT_SPEC.area.a.v.includes(p.a), p.a);
    if (p.m) assert.ok(S.EVENT_SPEC.area.m.v.includes(p.m), p.m);
  }
  // 只有 open 有 L 才能建；FindMap 介面
  assert.deepEqual(Object.keys(t.win.FindMap).sort(), ["check", "close", "core", "open"]);
});

/* ===================== CSS ===================== */
test("find-map.css：字 ≥17px、只用 token、覆寫 Leaflet 字級與底色、isolation、動作列 sticky、svh 與 vh、深色濾鏡兩種選擇器、按鈕 44px、320 寬", () => {
  const css = strip(CSS_SRC);
  assert.ok(!/--u2-fs-[01]\b/.test(css));
  for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) assert.match(m[1].trim(), /^var\(--u2-fs-[2-7]\)$/, m[0]);
  assert.ok(!/\d+(?:\.\d+)?px\s*\/|font:\s*\d/.test(css), "沒有寫死字級的 font 簡寫");
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), "不寫死顏色");
  assert.match(css, /\.u2-map\.leaflet-container \{ font: inherit; font-size: var\(--u2-fs-2\); background: var\(--u2-paper\); \}/);
  assert.match(css, /\.u2-map \{[^}]*position: relative; z-index: 0; isolation: isolate;/);
  assert.match(css, /height: clamp\(240px, 50vh, 440px\);\s*height: clamp\(240px, 50svh, 440px\);/, "svh 在後、vh 是退路");
  assert.match(css, /\.u2-map__bar \{[^}]*position: sticky; bottom: 0;[^}]*background: var\(--u2-paper\);/);
  assert.match(css, /\.u2-map__bar \{[^}]*border-top-color: var\(--u2-line-strong\)/);
  assert.match(css, /\.u2-map\.u2-map--draw \{ touch-action: none;/);
  assert.match(css, /min-width: 44px; min-height: 44px;/);
  const dark = "filter: invert(.93) hue-rotate(180deg) saturate(.7) contrast(1.1)";
  assert.ok(css.includes(`:root[data-theme="dark"] .u2-map .leaflet-tile-pane { ${dark}; }`));
  assert.match(css, new RegExp(`@media \\(prefers-color-scheme: dark\\) \\{\\s*:root:not\\(\\[data-theme="light"\\]\\) \\.u2-map \\.leaflet-tile-pane \\{ ${dark.replace(/[().]/g, "\\$&")}; \\}`));
  assert.ok(css.includes(".u2-map .leaflet-tile-pane { filter: saturate(.94) contrast(1.12) brightness(.97) hue-rotate(-6deg); }"));
  assert.match(css, /@media \(max-width: 359px\) \{\s*\.u2-map__acts \.u2-btn \{ flex: 1 1 0;/, "320 寬：圈完的兩顆按鈕並排（動作列少一排，不蓋地圖）");
  assert.match(css, /\.u2-map \.u2-map__ring \{[^}]*fill: var\(--u2-wood-500\)/);
  assert.match(css, /stroke: var\(--u2-wood\)/);
  assert.ok(!/@layer/.test(css), "不分層（要蓋過 Leaflet 沒分層的樣式）");
  assert.ok(!/u2-small|u2-cap/.test(MAP_SRC), "地圖畫面不用小字樣式");
});

/* ===================== 自架 Leaflet ===================== */
test("vendor：Leaflet 1.9.4 原版（保留 @preserve 版權、拿掉 sourceMappingURL）、樣式、授權檔；頁面上的資源路徑都在", () => {
  const dir = path.join(ROOT, VENDOR);
  const js = lf(fs.readFileSync(path.join(dir, "leaflet.js"), "utf8"));
  assert.match(js, /^\/\* @preserve\n \* Leaflet 1\.9\.4, a JS library for interactive maps\. https:\/\/leafletjs\.com\n \* \(c\) 2010-2023 Vladimir Agafonkin, \(c\) 2010-2011 CloudMade\n \*\//);
  assert.ok(js.includes('t.version="1.9.4"'));
  assert.ok(!/sourceMappingURL/.test(js));
  // 跟 npm 的 leaflet@1.9.4（dist.integrity sha512-nxS1ynzJ…74PA==）dist/leaflet.js 相同，只少最後一行 sourceMappingURL
  assert.equal(createHash("sha256").update(js).digest("hex"), "dc71f8a6880bc3ca1bd9fa8dc5f1af48c702dc510b0a78240a07c5feed7ce935");
  const css = lf(fs.readFileSync(path.join(dir, "leaflet.css"), "utf8"));
  assert.match(css, /\.leaflet-container/);
  assert.ok(!/sourceMappingURL|@import/.test(css), "沒有 sourcemap、不引入別的樣式");
  assert.ok(!/https?:/.test(strip(css)) && [...css.matchAll(/url\(([^)]*)\)/g)].every(m => !/^["']?(?:https?:)?\/\//.test(m[1])), "樣式不連外（註解裡的網址不算）");
  const lic = fs.readFileSync(path.join(dir, "LICENSE"), "utf8");
  assert.match(lic, /^BSD 2-Clause License/);
  assert.match(lic, /Copyright \(c\) 2010-2023, Volodymyr Agafonkin/);
  const page = fs.readFileSync(path.join(ROOT, "src/pages/find.astro"), "utf8");
  for (const a of ["data-lib", "data-css"]) {
    const m = new RegExp(`${a}="(/js/vendor/[^"]+)"`).exec(page);
    assert.ok(m, a);
    assert.ok(fs.existsSync(path.join(ROOT, "public", m[1])), m[1]);
  }
  assert.ok(fs.existsSync(path.join(ROOT, CSS_PATH)));
});

/* ===================== 串起來：find-app → find-scope → find-map（需要建置） ===================== */
const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HTML_PATH = path.join(DIST, "find", "index.html");
const NO_DIST = !fs.existsSync(HTML_PATH) || !parse5 ? "需要先建置（dist/find/index.html）且 node_modules 內有 parse5" : false;

test("整條流程：入口「在地圖上圈範圍」→ s1 載 find-map → 程式庫載好 → 按「找這個畫面的範圍」→ 問預算 → 確認畫面「範圍｜地圖上選的範圍」→ 送出帶 geo；事件合規格", { skip: NO_DIST }, async () => {
  const CONFIG = { ok: true, v: 1, mode: "live", turnstileSiteKey: null, needMax: 300, consentV: "2026-10-06", tplV: 1, caps: ["community", "zone", "geo"] };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url), key = u.replace("/api/find/", "").split("?")[0];
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const r = { config: () => CONFIG, submit: () => ({ ok: true, v: 1, status: "queued", jobId: "aX3kT9xLm2PzR8aVb5NcDe1", queue: { ahead: 0, eta_s: 30 }, saved: true }), status: () => ({ ok: true, v: 1, status: "searching" }), event: () => ({ ok: true }) }[key];
    if (!r) throw new Error("測試不准連到：" + u);
    return Response.json(r());
  };
  const clock = makeClock();
  const { doc, win } = makeEnv({ html: fs.readFileSync(HTML_PATH, "utf8"), parse5, fetchImpl, clock });
  win.URL = URL;
  win.requestAnimationFrame = fn => clock.setTimeout(fn, 16);
  const log = { maps: [], tiles: [], order: [] };
  const L = makeL(log);
  const ctx = vm.createContext(win);
  const run = (rel, name) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: name });
  run("public/js/need-extract.js", "need-extract.js");
  run("public/js/find-app.js", "find-app.js");
  await flush();
  const $ = s => doc.querySelector(s);
  const scripts = re => doc.head.childNodes.filter(n => n.localName === "script" && re.test(n.src || n.getAttribute("src") || ""));
  const state = () => (doc.querySelectorAll(".u2-state").find(d => !d.hidden) || {}).getAttribute?.("data-s");
  click($('#scope-entry [data-scope="geo"]'));
  const sc = scripts(/find-scope\.js/);
  assert.equal(sc.length, 1);
  run("public/js/find-scope.js", "find-scope.js");
  sc[0].onload();
  await flush();
  assert.equal(state(), "s1");
  const fm = scripts(/find-map\.js/);
  assert.equal(fm.length, 1);
  assert.equal(fm[0].src, $("#scope-map").getAttribute("data-src"));
  run(MAP_PATH, "find-map.js");
  fm[0].onload();
  await flush();
  assert.equal($("#scope-map-mount").textContent, "地圖載入中…");
  for (const l of doc.head.childNodes.filter(n => n.localName === "link" && /\.css/.test(n.getAttribute("href") || ""))) l.onload && l.onload();
  const lib = scripts(/leaflet\.js/);
  assert.equal(lib.length, 1);
  assert.equal(lib[0].getAttribute("src"), "/js/vendor/leaflet/1.9.4/leaflet.js");
  win.L = L;
  lib[0].onload();
  await clock.advance(40);
  assert.equal(log.maps.length, 1);
  assert.match($(".u2-map__status").textContent, /^這個畫面約 /);
  click($('.u2-mapui [data-ma="go"]'));
  await flush();
  assert.equal(log.maps[0].removed, true, "完成就拆地圖");
  assert.equal(state(), "s3", "缺預算與房數：只問硬題");
  assert.match($("#s3-chat").textContent, /地圖上選的範圍/);
  // 回答兩題硬題（跳過）→ 確認畫面
  for (let i = 0; i < 4 && state() === "s3"; i++) { click($('[data-act="q-skip"]')); await flush(); }
  assert.equal(state(), "s4");
  const rows = doc.querySelectorAll("#sheet-rows .u2-sheet__row").map(r => r.textContent.replace(/改.*$/, ""));
  assert.equal(rows[0], "範圍地圖上選的範圍");
  await clock.advance(6000);
  click($("#go-btn"));
  await flush();
  const body = calls.find(c => c.key === "submit").body;
  assert.deepEqual(Object.keys(body.fields), ["geo"]);
  assert.equal(body.fields.geo.length, 4);
  assert.ok(M.check(body.fields.geo).ok);
  assert.deepEqual(plain(S.validateSubmit(body).out.fields.geo), body.fields.geo, "伺服器端照收");
  await clock.advance(7000);
  const evs = [];
  for (const c of calls.filter(c => c.key === "event")) evs.push(...c.body.events);
  for (const b of win.__beacons) { try { evs.push(...JSON.parse(b.blob.__text || "{}").events); } catch { /* ignore */ } }
  const area = evs.filter(e => e.e === "area");
  assert.deepEqual(area.map(e => [e.a, e.m]), [["open", "view"], ["done", "view"]]);
  for (const e of evs) assert.deepEqual(S.validateEvent(e), e, JSON.stringify(e));
  assert.ok(!JSON.stringify(evs).includes("24.1"), "事件不含座標");
});

/* ===================== 2026-10-09 審查 W4／SEC-07 ===================== */
test("審查 W4：手機首屏只有幾張圖片、全部載不到 → 這一批結束（load）時一張都沒成功就 onFail('tiles')；有一張成功就不算", { skip: NO_DOM }, async () => {
  const t = await mapEnv();
  const m = await t.built();
  const tl = t.log.tiles[0];
  for (let i = 0; i < 4; i++) tl.fire("tileerror");
  assert.deepEqual(t.log.fail, [], "還沒湊到 8 張");
  tl.fire("load");   // Leaflet：這一批圖片全部結束（成功或失敗都算）
  assert.deepEqual(t.log.fail, ["tiles"]);
  assert.equal(m.removed, true);
  const u = await mapEnv();
  await u.built();
  const tl2 = u.log.tiles[0];
  tl2.fire("tileerror"); tl2.fire("tileload"); tl2.fire("tileerror");
  tl2.fire("load");
  assert.deepEqual(u.log.fail, [], "有一張成功：不算失敗");
});

test("審查 SEC-07：/find/* 有 CSP（圖片只准本站、data:、地圖圖片主機與既有分析服務；不准外掛物件、不准改 base、不准被框）", () => {
  const h = fs.readFileSync(path.join(ROOT, "public", "_headers.txt"), "utf8");
  const m = /^\/find\/\*\r?\n {2}Content-Security-Policy: (.+)$/m.exec(h);
  assert.ok(m, "要有 /find/* 的 CSP");
  const d = Object.fromEntries(m[1].split(";").map(x => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(d["img-src"], ["'self'", "data:", "https://wmts.nlsc.gov.tw", "https://*.google-analytics.com", "https://*.googletagmanager.com"]);
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'self'"]);
  assert.deepEqual(d["frame-ancestors"], ["'self'"]);
  assert.equal(new URL(M.TILE_URL.replace(/[{}]/g, "")).origin, "https://wmts.nlsc.gov.tw", "CSP 的主機跟 TILE_URL 同一台");
});
