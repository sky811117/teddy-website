/**
 * uf-page.js — /tools/undesirable-facilities/（台中嫌惡設施查詢地圖）的前端程式
 *
 * 頁面由 src/pages/tools/undesirable-facilities.astro 以 <script> 匯入（Astro 會打包、壓縮，只有這一頁下載）。
 * 依賴頁面先載好的兩支共用腳本：window.CineMap（/js/cine-map.js）、window.TcAddr（/js/tc-addr.js），沒有也不會壞。
 *
 * ⛔ 隱私：地址、定位座標只在瀏覽器裡比對；不放 URL、不送 GA、不送任何 API。
 *    GA 事件 uf_query 只帶 result（ok／empty／fail）、radius、cats（範圍內幾類）。
 *    查詢成功發 document 事件 "cine:radar-ping"，detail 只有 { radius }（主視覺的雷達場景用）。
 *
 * 主題「雷達掃描」：
 *   - 全市總覽＝設施熱度圖（heatmap，暖色）；放大到街區轉成依類別上色的點
 *   - 查詢：鏡頭飛到查詢點 → 300／500／1000 公尺三圈＋十字準線 → 一道光束繞一圈（uf-sweep.js），
 *     範圍內的設施在光束掃過它的方位角時才「叮」地亮起（擴散光環＋小六角光柱升起），範圍外的淡化
 *   - 結果：距離尺（uf-ruler.js）＋依距離排序的精簡清單（前 30 筆＋顯示全部）＋一句摘要
 *   - prefers-reduced-motion：不掃描、不飛，全部直接顯示
 *
 * 光束（uf-sweep.js）、距離尺（uf-ruler.js）第一次查詢才用 import() 載入（Vite 拆成獨立小檔），首屏不用下載
 */

(function () {
  "use strict";

  let BOOT = null;
  try { BOOT = JSON.parse(document.getElementById("uf-boot").textContent); } catch (e) { BOOT = null; }
  const PAGE = 30;
  const MAXR = 1000; // 查詢一次抓 1 公里內，切換 300／500／1000 不用重算
  const RINGS = [300, 500, 1000];

  const $ = id => document.getElementById(id);
  const E = {
    form: $("uf-form"), addr: $("uf-addr"), here: $("uf-here"), status: $("uf-status"), cands: $("uf-cands"),
    intro: $("uf-intro"), skel: $("uf-skel"), summary: $("uf-summary"),
    mapcol: $("uf-mapcol"), map: $("uf-map"), empty: $("uf-mapempty"), legend: $("uf-legend"), legendT: $("uf-legend-t"),
    fh: $("uf-f-h"), fall: $("uf-fall"), chips: $("uf-chips"), fzero: $("uf-fzero"),
    rulerwrap: $("uf-rulerwrap"), ruler: $("uf-ruler"), rinfo: $("uf-rinfo"),
    listwrap: $("uf-listwrap"), listinfo: $("uf-listinfo"), list: $("uf-list"), more: $("uf-more"),
  };
  if (!E.form || !E.map) return;
  const G = (BOOT && BOOT.groups) || [];
  const S = { pt: null, via: "", label: "", note: "", precision: "", radius: 300, seq: 0, all: [], off: {}, limit: PAGE, stale: false, sel: -1, anim: "" };
  let DATA = null; // [{i, g, n, y, x, s}]
  const isTouch = !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function haversine(aLat, aLon, bLat, bLon) {
    const R = 6371000, p = Math.PI / 180;
    const dLat = (bLat - aLat) * p, dLon = (bLon - aLon) * p;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  // 方位角（正北 0°、順時針）；1 公里內用平面近似就夠準
  function bearing(lat, lng, y, x) {
    const b = (Math.atan2((x - lng) * Math.cos((lat * Math.PI) / 180), y - lat) * 180) / Math.PI;
    return (b + 360) % 360;
  }
  function dest(ll, r, deg) {
    const a = (deg * Math.PI) / 180;
    return [ll[0] + (r * Math.sin(a)) / (111320 * Math.cos((ll[1] * Math.PI) / 180)), ll[1] + (r * Math.cos(a)) / 111320];
  }
  function mtxt(d) {
    if (d < 1000) return "約 " + Math.max(10, Math.round(d / 10) * 10) + " 公尺";
    return "約 " + (d / 1000).toFixed(1) + " 公里";
  }
  function rtxt(r) { return r >= 1000 ? r / 1000 + " 公里" : r + " 公尺"; }
  function setStatus(msg, isErr) {
    E.status.textContent = msg;
    E.status.classList.toggle("uf-err", !!isErr);
  }
  // GA：只記查詢成功與否、範圍、類別數（沒有地址、沒有座標）
  function track(name, params) {
    try {
      if (window.__gaMeasure === true && typeof window.gtag === "function") window.gtag("event", name, params);
    } catch (e) { /* 量測失敗不影響功能 */ }
  }
  function ping() {
    try { document.dispatchEvent(new CustomEvent("cine:radar-ping", { detail: { radius: S.radius } })); } catch (e) { /* 舊瀏覽器 */ }
  }
  function colStyle(g) { const c = G[g] || {}; return "--cl:" + esc(c.cl || "#8a8a8a") + ";--cd:" + esc(c.cd || "#b5b5b5"); }
  function gLabel(g) { return (G[g] && G[g].label) || ""; }
  // 來源：清單寫機關（短），彈窗寫機關〈清冊名〉（完整）；舊版資料沒有 org 就用名稱
  function srcOf(s) { return (BOOT && BOOT.src && BOOT.src[s]) || null; }
  function srcShort(s) { const x = srcOf(s); return !x || x.osm ? "OpenStreetMap" : x.org || x.name; }
  // 清冊原名太長或容易誤解的（「臺中市七處籌設列管攤販集中區」）彈窗用短名 short
  function srcFull(s) { const x = srcOf(s); const nm = x && (x.short || x.name); return !x || x.osm ? "OpenStreetMap" : x.org ? x.org + "〈" + nm + "〉" : nm; }
  // OSM 沒標名稱的點，名稱會跟類別名稱一樣 → 不重複講
  function hasName(it) { return !!it.n && it.n !== gLabel(it.g); }
  // 「（資料沒有名稱）」只給真的沒名稱的點；名稱是頁面刻意不顯示的（it.h）不加這句
  function noNameNote(it) { return hasName(it) || it.h ? "" : "（資料沒有名稱）"; }
  function nameOf(it) { return hasName(it) ? it.n : gLabel(it.g); }
  function isVis(it) { return !S.off[it.g]; }

  /* ---------- 資料 ---------- */
  let dataP = null;
  function prep(j) {
    const arr = (j && j.items) || [], cats = (j && j.categories) || {}, out = [];
    const k2g = (BOOT && BOOT.k2g) || {};
    let fbk = 0;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it || typeof it.y !== "number" || typeof it.x !== "number") continue;
      let g = k2g[it.k];
      if (g == null) {
        // 建置後才新增的類別（頁面還沒重建）：臨時給一個顏色，照樣顯示
        const lab = (cats[it.k] && cats[it.k].label) || it.k;
        for (let q = 0; q < G.length; q++) if (G[q].label === lab) g = q;
        if (g == null) {
          const fc = (BOOT.fallback && BOOT.fallback[fbk++ % BOOT.fallback.length]) || ["#8a8a8a", "#b5b5b5"];
          G.push({ label: lab, cl: fc[0], cd: fc[1] });
          g = G.length - 1;
          addChip(g);
        }
        k2g[it.k] = g;
      }
      // 「嫌惡」保持中立：社群標註的名稱帶「非法／違法」這類判定字眼的，不照抄，只顯示類別名稱
      // （建置腳本已經排除非正式傾倒點，這裡只是保險）
      const nm = String(it.n || ""), bad = /非法|違法/.test(nm);
      out.push({ i: out.length, g: g, n: bad ? "" : nm, h: bad ? 1 : 0, y: it.y, x: it.x, s: it.s || BOOT.defSrc });
    }
    DATA = out;
    return out;
  }
  function loadData() {
    if (DATA) return Promise.resolve(DATA);
    if (!dataP) {
      dataP = fetch(BOOT.dataUrl)
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(prep)
        .catch(e => { dataP = null; throw e; });
    }
    return dataP;
  }
  function nearby(items, lat, lng, R) {
    const dLat = R / 111320 + 0.0005, dLng = R / (111320 * Math.cos((lat * Math.PI) / 180)) + 0.0005;
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (Math.abs(it.y - lat) > dLat || Math.abs(it.x - lng) > dLng) continue;
      const d = haversine(lat, lng, it.y, it.x);
      if (d <= R) out.push({ it: it, d: d, b: bearing(lat, lng, it.y, it.x) });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  function inR() { const R = S.radius; return S.all.filter(x => x.d <= R); }
  function inRVis() { return inR().filter(x => isVis(x.it)); }
  function countBy(list) {
    const c = {};
    list.forEach(x => { c[x.it.g] = (c[x.it.g] || 0) + 1; });
    return c;
  }

  /* ---------- 地圖（MapLibre GL ＋ 國土測繪中心 EMAP 圖磚，共用 /js/cine-map.js） ---------- */
  // 座標：MapLibre 一律 [lng, lat]；資料 y＝緯度、x＝經度
  const CM = window.CineMap || null;
  const RM = !!(CM && CM.reducedMotion());
  let cm = null, M = null, ML = null, SW = null;
  // cm 可用就算（MapLibre 還在下載時，圖層資料、圖釘、鏡頭會先記著，好了再畫）；要直接操作 M 的地方另外檢查 M
  function mapOK() { return !!(cm && cm.available); }
  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
  function accent() { return isDark() ? "#e2b36e" : "#8a6539"; }
  function fcol(f) { return { type: "FeatureCollection", features: f || [] }; }
  function ptF(lng, lat, p, id) {
    const f = { type: "Feature", properties: p || {}, geometry: { type: "Point", coordinates: [lng, lat] } };
    if (id != null) f.id = id;
    return f;
  }
  function colExpr() { return ["get", isDark() ? "cd" : "cl"]; }
  function stroke() { return isDark() ? "#2a211a" : "#fffaf0"; }
  const MS = { q: fcol(), rings: fcol(), all: fcol(), inr: fcol(), hex: fcol(), nearPt: fcol() };
  function setSrc(k, data) { MS[k] = data; const src = M && M.getSource("uf-" + k); if (src) src.setData(data); }
  function offList() { const a = []; for (const k in S.off) if (S.off[k]) a.push(+k); return a; }
  function visFilter() { return ["!", ["in", ["get", "g"], ["literal", offList()]]]; }
  const ON = ["boolean", ["feature-state", "on"], false];
  const PP = ["coalesce", ["feature-state", "p"], 1];

  // 熱度圖：密度越高越暖越深（淺色）／越亮（深色＝夜裡的暖燈）
  function heatRamp() {
    return isDark()
      ? ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(120,70,30,0)", 0.08, "rgba(140,86,40,0.32)", 0.25, "rgba(186,118,56,0.52)",
        0.45, "rgba(222,156,84,0.68)", 0.65, "rgba(242,194,122,0.8)", 0.85, "rgba(255,222,168,0.9)", 1, "rgba(255,240,210,0.95)"]
      : ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(242,196,128,0)", 0.08, "rgba(244,206,146,0.34)", 0.25, "rgba(236,176,104,0.52)",
        0.45, "rgba(222,140,72,0.66)", 0.65, "rgba(196,102,52,0.76)", 0.85, "rgba(160,70,40,0.84)", 1, "rgba(122,48,30,0.9)"];
  }
  function heatOpacity() {
    const a = S.pt ? 0.5 : 0.9, b = S.pt ? 0.35 : 0.72;
    return ["interpolate", ["linear"], ["zoom"], 9, a, 13.2, b, 14.8, 0];
  }
  // 放大到街區才出現的單點（查詢後範圍外的淡化）
  function allOp(v) { return ["interpolate", ["linear"], ["zoom"], 12.3, 0, 13.6, v]; }
  function allOpacity() { return S.pt ? { dot: 0.34, halo: 0.07 } : { dot: 0.9, halo: 0.28 }; }

  // 彈窗：同時只開一個
  const pop = { cur: null, closedAt: 0 };
  function popW() { return Math.max(150, Math.min(300, (E.map ? E.map.clientWidth : 320) - 110)); }
  function mkPop(o) {
    const p = new ML.Popup(Object.assign({ maxWidth: popW() + "px", className: "uf-mlpop", focusAfterOpen: false }, o || {}));
    p.on("open", () => { if (pop.cur && pop.cur !== p) pop.cur.remove(); pop.cur = p; });
    p.on("close", () => { if (pop.cur === p) pop.cur = null; pop.closedAt = Date.now(); });
    return p;
  }
  function closePop() { if (pop.cur) pop.cur.remove(); }

  function camTo(ll, z) { if (!mapOK()) return Promise.resolve(); return cm.flyTo(ll, z); }
  // 查詢範圍圈塞得進地圖的縮放（MapLibre 512 圖磚：每像素公尺 = 40075016.686·cos(緯度) / (512·2^z)）
  function zoomFor(R) {
    const w = E.map.clientWidth || 360, h = E.map.clientHeight || 320;
    const dim = Math.max(180, Math.min(w, h * 1.3)) - 40;
    const lat = S.pt ? S.pt.lat : 24.15;
    const z = Math.log((40075016.686 * Math.cos((lat * Math.PI) / 180) * dim) / (512 * 2.3 * R)) / Math.LN2;
    return Math.max(12, Math.min(17.2, z));
  }
  function qLabel() { return S.via === "geo" ? "你的位置" : S.via === "address" ? "你查的地址" : "你在地圖上點的位置"; }

  function addLayers() {
    // 設施點位有 OpenStreetMap 的資料 → 地圖右下角的出處也要標（OSMF 標示指引：在地圖上就看得到）
    const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap 貢獻者</a>';
    ["q", "rings", "all", "inr", "hex", "nearPt"].forEach(k => M.addSource("uf-" + k, Object.assign({ type: "geojson", data: MS[k] }, k === "all" ? { attribution: OSM_ATTR } : {})));
    const col = colExpr(), a = accent(), op = allOpacity(), vf = visFilter();
    const L = o => M.addLayer(o);
    L({ id: "uf-heat", type: "heatmap", source: "uf-all", filter: vf,
      paint: {
        "heatmap-weight": 1,
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.45, 11, 0.9, 13, 1.6, 15, 2.4],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 11, 12, 13, 22, 15, 38],
        "heatmap-color": heatRamp(),
        "heatmap-opacity": heatOpacity(),
      } });
    // 雷達圈：選中的範圍＝填色＋柔光＋實線；另外兩圈虛線；十字準線
    L({ id: "uf-q-fill", type: "fill", source: "uf-q", paint: { "fill-color": "#dc9245", "fill-opacity": 0.08 } });
    L({ id: "uf-cross", type: "line", source: "uf-rings", filter: ["==", ["get", "kind"], "x"],
      paint: { "line-color": a, "line-width": 1.1, "line-opacity": 0.42, "line-dasharray": [1, 3] } });
    L({ id: "uf-ring-o", type: "line", source: "uf-rings", filter: ["all", ["==", ["get", "kind"], "r"], ["==", ["get", "sel"], 0]],
      paint: { "line-color": a, "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [2, 2.5] } });
    L({ id: "uf-q-glow", type: "line", source: "uf-q", paint: { "line-color": "#f2c27c", "line-width": 10, "line-blur": 9, "line-opacity": 0.45 } });
    L({ id: "uf-q-line", type: "line", source: "uf-q", paint: { "line-color": a, "line-width": 2, "line-opacity": 0.95 } });
    // 全市所有設施：放大才出現的小光點＋柔光（查詢後淡下來）
    L({ id: "uf-all-halo", type: "circle", source: "uf-all", filter: vf,
      paint: { "circle-color": col, "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 15, 10, 18, 16], "circle-blur": 1, "circle-opacity": allOp(op.halo) } });
    L({ id: "uf-all-dot", type: "circle", source: "uf-all", filter: vf,
      paint: {
        "circle-color": col, "circle-opacity": allOp(op.dot),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.4, 15, 4.2, 18, 6.5],
        "circle-stroke-color": stroke(),
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0, 14, 0.8, 17, 1.2],
        "circle-stroke-opacity": allOp(op.dot),
      } });
    // 範圍內：光束掃到才亮（feature-state on），亮起瞬間有一圈擴散光環（feature-state p：0 → 1）
    L({ id: "uf-in-halo", type: "circle", source: "uf-inr", filter: vf,
      paint: { "circle-color": col, "circle-radius": 18, "circle-blur": 1, "circle-opacity": ["case", ON, 0.5, 0], "circle-pitch-alignment": "map" } });
    L({ id: "uf-in-ping", type: "circle", source: "uf-inr", filter: vf,
      paint: {
        "circle-color": "rgba(0,0,0,0)", "circle-radius": ["+", 6, ["*", 26, PP]], "circle-pitch-alignment": "map",
        "circle-stroke-color": col, "circle-stroke-width": 2.2, "circle-stroke-opacity": ["case", ON, ["*", 0.95, ["-", 1, PP]], 0],
      } });
    L({ id: "uf-in-dot", type: "circle", source: "uf-inr", filter: vf,
      paint: {
        "circle-color": col, "circle-opacity": ["case", ON, 1, 0],
        "circle-radius": ["+", 5.5, ["*", 3, ["-", 1, PP]]],
        "circle-stroke-color": stroke(), "circle-stroke-width": 1.6, "circle-stroke-opacity": ["case", ON, 1, 0],
      } });
    L({ id: "uf-near-glow", type: "circle", source: "uf-nearPt",
      paint: { "circle-color": "#f6c77d", "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 28, 18, 44], "circle-blur": 1, "circle-opacity": 0.55, "circle-pitch-alignment": "map" } });
    // 小六角光柱：光束掃到才升起（feature-state r：0 → 1），最近的一處高一點
    L({ id: "uf-hex", type: "fill-extrusion", source: "uf-hex", filter: vf,
      paint: {
        "fill-extrusion-color": col,
        "fill-extrusion-base": 0,
        "fill-extrusion-height": ["*", ["get", "h"], ["coalesce", ["feature-state", "r"], 0]],
        "fill-extrusion-opacity": 0.86,
        "fill-extrusion-vertical-gradient": true,
      } });
    // 光柱是「光」不是柱子：把立體的明暗壓淡
    try { M.setLight({ anchor: "viewport", intensity: 0.12, color: "#fff4e0" }); } catch (e) { /* 舊版沒有 setLight */ }
  }
  function restyle() {
    if (!M) return;
    const col = colExpr(), st = stroke(), a = accent();
    try {
      M.setPaintProperty("uf-heat", "heatmap-color", heatRamp());
      ["uf-q-line", "uf-ring-o", "uf-cross"].forEach(id => M.setPaintProperty(id, "line-color", a));
      ["uf-all-halo", "uf-all-dot", "uf-in-halo", "uf-in-dot"].forEach(id => M.setPaintProperty(id, "circle-color", col));
      M.setPaintProperty("uf-in-ping", "circle-stroke-color", col);
      M.setPaintProperty("uf-all-dot", "circle-stroke-color", st);
      M.setPaintProperty("uf-in-dot", "circle-stroke-color", st);
      M.setPaintProperty("uf-hex", "fill-extrusion-color", col);
    } catch (e) { /* 圖層還沒建好 */ }
  }
  const FILTERED = ["uf-heat", "uf-all-halo", "uf-all-dot", "uf-in-halo", "uf-in-ping", "uf-in-dot", "uf-hex"];
  function applyMapFilter() {
    if (!M) return;
    const vf = visFilter();
    try { FILTERED.forEach(id => M.setFilter(id, vf)); } catch (e) { /* 還沒建好 */ }
  }
  function applyAllOpacity() {
    if (!M) return;
    const op = allOpacity();
    try {
      M.setPaintProperty("uf-all-dot", "circle-opacity", allOp(op.dot));
      M.setPaintProperty("uf-all-dot", "circle-stroke-opacity", allOp(op.dot));
      M.setPaintProperty("uf-all-halo", "circle-opacity", allOp(op.halo));
      M.setPaintProperty("uf-heat", "heatmap-opacity", heatOpacity());
    } catch (e) { /* 還沒建好 */ }
  }
  function props(it) {
    const c = G[it.g] || {};
    return { i: it.i, g: it.g, cl: c.cl || "#8a8a8a", cd: c.cd || "#b5b5b5" };
  }
  function drawAll() {
    if (!mapOK() || !DATA) return;
    setSrc("all", fcol(DATA.map(it => ptF(it.x, it.y, props(it)))));
  }

  function initMap() {
    if (!CM || !E.map) return;
    try {
      cm = CM.create(E.map, {
        // 電腦：滾輪照常捲頁面，按住 Ctrl／⌘ 才縮放；手機：單指捲頁面、兩指移動縮放
        cooperativeGestures: true,
        onReady: onMapReady,
        onUnavailable: kind => { if (kind !== "lost") mapGone(); },
      });
    } catch (e) { cm = null; }
  }
  function mapGone() {
    if (E.empty) E.empty.hidden = true;
    if (E.legend) E.legend.hidden = true;
    if (S.pt && !E.listwrap.hidden) renderResults(false);
  }
  let tip = null, tipKey = "";
  let mapVis = true;
  function hitLayers() { return M.getZoom() >= 12.8 ? ["uf-in-dot", "uf-hex", "uf-all-dot"] : ["uf-in-dot", "uf-hex"]; }
  function onMapReady(map) {
    M = map;
    ML = window.maplibregl;
    addLayers();
    loadData().then(() => { drawAll(); if (S.pt && S.all.length) { drawIn(); armReveal(); } }).catch(() => {
      if (!S.pt) setStatus("設施資料載入失敗，請檢查網路後重新整理。", true);
    });
    // 點擊判斷留一點寬容（手機手指比較粗）；範圍內的點優先
    function hit(p) {
      const r = isTouch ? 14 : 7;
      let best = null, bd = 1e9;
      M.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: hitLayers() }).forEach(f => {
        const i = +f.properties.i, it = DATA && DATA[i];
        if (!it) return;
        const q = M.project([it.x, it.y]);
        let dd = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
        if (f.layer && f.layer.id !== "uf-all-dot") dd -= 40;
        if (dd < bd) { bd = dd; best = i; }
      });
      return best;
    }
    // 點地圖：還沒查過 → 直接查；已經有結果 → 先跳「改查這個位置」小彈窗，按了才改查
    M.on("click", e => {
      const tg = e.originalEvent && e.originalEvent.target;
      if (tg && tg.closest && tg.closest(".maplibregl-marker, .maplibregl-popup, .maplibregl-ctrl")) return;
      const had = !!pop.cur || Date.now() - pop.closedAt < 400; // 這一下是在關掉彈窗
      if (tip) { tip.remove(); tipKey = ""; }
      const i = hit(e.point);
      if (i != null) { openItem(i); selectItem(i, "map"); return; }
      if (had) { closePop(); return; }
      if (!S.pt) { runQuery(e.lngLat.lat, e.lngLat.lng, "map", { label: "", note: "" }); return; }
      mkPop().setLngLat(e.lngLat)
        .setHTML('<div class="uf-pop"><button type="button" class="uf-btn uf-btn-primary uf-btn-sm" data-uf-here="' +
          e.lngLat.lat.toFixed(6) + "," + e.lngLat.lng.toFixed(6) + '">改查這個位置</button></div>')
        .addTo(M);
    });
    // 電腦：滑到光點上顯示名稱
    if (!isTouch) {
      tip = new ML.Popup({ closeButton: false, closeOnClick: false, className: "uf-mlpop uf-tip", offset: 12, maxWidth: "240px", focusAfterOpen: false });
      M.on("mousemove", e => {
        if (!DATA) return;
        const r = 6;
        const fs = M.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: hitLayers() });
        const f = fs[0];
        if (!f) {
          if (tipKey) { M.getCanvas().style.cursor = ""; tip.remove(); tipKey = ""; }
          return;
        }
        M.getCanvas().style.cursor = "pointer";
        const i = +f.properties.i, k = "i" + i, it = DATA[i];
        if (!it || (k === tipKey && tip.isOpen())) return;
        tipKey = k;
        tip.setLngLat([it.x, it.y]).setHTML('<div class="uf-pop"><b>' + esc(nameOf(it)) + "</b>" + (hasName(it) ? "<br>" + esc(gLabel(it.g)) : "") + "</div>");
        if (!tip.isOpen()) tip.addTo(M);
      });
      M.getCanvas().addEventListener("mouseleave", () => { if (tip) tip.remove(); tipKey = ""; });
    }
    // 手機：單指捲頁面、兩指移動縮放；要單指拖曳按右上角
    if (isTouch && M.cooperativeGestures && typeof M.cooperativeGestures.disable === "function") {
      M.addControl({
        onAdd: () => {
          const box = document.createElement("div");
          box.className = "maplibregl-ctrl uf-unlock-ctrl";
          const b = document.createElement("button");
          b.type = "button";
          b.className = "uf-unlock";
          b.textContent = "拖曳地圖";
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", ev => {
            ev.stopPropagation();
            const on = b.getAttribute("aria-pressed") !== "true";
            if (on) M.cooperativeGestures.disable(); else M.cooperativeGestures.enable();
            b.textContent = on ? "鎖定地圖" : "拖曳地圖";
            b.setAttribute("aria-pressed", on ? "true" : "false");
          });
          box.appendChild(b);
          return box;
        },
        onRemove: () => {},
      }, "top-right");
    }
    if ("IntersectionObserver" in window) {
      // 地圖露出 15% 以上才算看得到（看不到時雷達光束直接收尾，不在畫面外空轉）
      new IntersectionObserver(es => {
        const en = es[es.length - 1];
        mapVis = en.isIntersecting && en.intersectionRatio >= 0.15;
      }, { threshold: [0, 0.15] }).observe(E.map);
    }
    if ("MutationObserver" in window) {
      new MutationObserver(restyle).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
    if (S.pt) { drawQuery(false); if (S.all.length) { drawIn(); armReveal(); } }
  }
  function popHtml(it, d) {
    let h = '<div class="uf-pop" style="' + colStyle(it.g) + '"><strong>' + esc(nameOf(it)) + "</strong>" +
      '<div class="uf-pop-sub"><i class="uf-dot" aria-hidden="true"></i>' + esc(gLabel(it.g)) + (d != null ? "・直線" + mtxt(d) : "") + "</div>" +
      '<div class="uf-pop-note">來源：' + esc(srcFull(it.s)) + noNameNote(it) + "</div>";
    if (d != null && d <= S.radius && isVis(it)) h += '<button type="button" class="uf-linkbtn" data-uf-go="' + it.i + '">在清單裡看</button>';
    return h + "</div>";
  }
  function openItem(i) {
    const it = DATA && DATA[i];
    if (!M || !it) return;
    if (tip) { tip.remove(); tipKey = ""; }
    const d = S.pt ? haversine(S.pt.lat, S.pt.lng, it.y, it.x) : null;
    mkPop({ offset: 10 }).setLngLat([it.x, it.y]).setHTML(popHtml(it, d)).addTo(M);
  }

  /* ---------- 查詢範圍（雷達圈）、範圍內的點與光柱 ---------- */
  let qKey = "", qR = 0;
  function drawQuery(fit) {
    if (!mapOK() || !S.pt) return;
    const ll = [S.pt.lng, S.pt.lat];
    setSrc("q", fcol([CM.circle(ll, S.radius, 96)]));
    const rs = RINGS.map(r => { const f = CM.circle(ll, r, 96); f.properties = { kind: "r", r: r, sel: r === S.radius ? 1 : 0 }; return f; });
    const RX = RINGS[RINGS.length - 1];
    [0, 90].forEach(b => {
      rs.push({ type: "Feature", properties: { kind: "x" }, geometry: { type: "LineString", coordinates: [dest(ll, RX, b), dest(ll, RX, b + 180)] } });
    });
    setSrc("rings", fcol(rs));
    const k = S.seq + ":" + ll.join(",");
    if (k !== qKey) {
      qKey = k;
      qR = S.radius;
      cm.clearPins();
      cm.addPulsePin(ll, { variant: S.via === "geo" ? "dot" : "pin", label: qLabel() });
      if (fit) camTo(ll, zoomFor(S.radius));
    } else if (fit && qR !== S.radius) {
      qR = S.radius;
      if (M && !RM) { cm.cancelIntro(); M.easeTo({ center: ll, zoom: zoomFor(S.radius), duration: 1100, essential: true }); }
      else camTo(ll, zoomFor(S.radius));
    }
    applyAllOpacity();
  }
  function hexGeom(ll, r) {
    const ring = [];
    for (let k = 0; k < 6; k++) ring.push(dest(ll, r, 30 + k * 60));
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] };
  }
  function drawIn() {
    if (!mapOK()) return;
    const list = inR();
    setSrc("inr", fcol(list.map(x => ptF(x.it.x, x.it.y, props(x.it), x.it.i))));
    drawHex();
  }
  function drawHex() {
    if (!mapOK()) return;
    const list = inR(), R = S.radius;
    const rh = Math.max(4, R * 0.02);
    const h = R * (list.length > 60 ? 0.08 : 0.11);
    const near = inRVis()[0];
    const nid = near ? near.it.i : -1;
    setSrc("hex", fcol(list.map(x => {
      const p = props(x.it);
      p.h = x.it.i === nid ? h * 1.8 : h;
      return { type: "Feature", id: x.it.i, properties: p, geometry: hexGeom([x.it.x, x.it.y], x.it.i === nid ? rh * 1.25 : rh) };
    })));
  }
  function drawNear(show) {
    const x = show && S.pt ? inRVis()[0] : null;
    setSrc("nearPt", fcol(x ? [ptF(x.it.x, x.it.y)] : []));
  }

  // 雷達掃描：光束掃過設施的方位角時才讓它亮起
  const RV = { key: 0, tok: 0, list: [], k: 0, pings: [] };
  function fs(i, a, b) {
    try {
      M.setFeatureState({ source: "uf-inr", id: i }, a);
      if (b) M.setFeatureState({ source: "uf-hex", id: i }, b);
    } catch (e) { /* 圖層還沒建好 */ }
  }
  function resetReveal() {
    RV.key = 0;
    RV.list = [];
    RV.pings = [];
    if (SW) SW.stop(false);
    drawNear(false);
    if (!M) return;
    try {
      M.removeFeatureState({ source: "uf-inr" });
      M.removeFeatureState({ source: "uf-hex" });
    } catch (e) { /* 還沒建好 */ }
  }
  function revealAll() {
    RV.pings = [];
    inR().forEach(x => fs(x.it.i, { on: true, p: 1 }, { r: 1 }));
    drawNear(true);
  }
  // 光束模組：第一次要掃描時才載入
  let swP = null;
  function loadSweep() {
    if (!swP) {
      swP = import("./uf-sweep.js").then(m => {
        SW = m.createSweep(M, { isDark: isDark, isVisible: () => mapVis && document.visibilityState === "visible" });
        return SW;
      });
    }
    return swP;
  }
  function armReveal() {
    if (!M || !S.pt) return; // 地圖還沒好：onMapReady 會再叫一次
    resetReveal();
    if (RM) { revealAll(); return; }
    if (!SW) {
      // 模組還在下載（查詢一開始就開始抓，通常鏡頭飛完前就好了）：好了再掃；載不到就全部直接亮
      const at = S.seq + ":" + S.radius;
      loadSweep().then(() => { if (S.pt && S.seq + ":" + S.radius === at) armReveal(); }).catch(() => { if (S.pt) revealAll(); });
      return;
    }
    const key = (RV.key = ++RV.tok);
    cm.whenSettled(() => {
      if (RV.key !== key || !S.pt) return;
      const start = M.getBearing();
      RV.list = inR().map(x => ({ i: x.it.i, a: (((x.b - start) % 360) + 360) % 360 })).sort((p, q) => p.a - q.a);
      RV.k = 0;
      SW.play({
        center: [S.pt.lng, S.pt.lat],
        radius: S.radius,
        start: start,
        dur: S.radius >= 1000 ? 3300 : S.radius >= 500 ? 3000 : 2700,
        onAngle: onSweep,
        onDone: () => { if (RV.key === key) revealAll(); },
      });
    }, 0.35);
  }
  function onSweep(deg, t) {
    while (RV.k < RV.list.length && RV.list[RV.k].a <= deg) {
      const i = RV.list[RV.k].i;
      fs(i, { on: true, p: 0 }, { r: 0 });
      RV.pings.push({ i: i, t0: t });
      if (ruler) ruler.ping(i);
      RV.k++;
    }
    for (let j = RV.pings.length - 1; j >= 0; j--) {
      const pg = RV.pings[j], e = t - pg.t0;
      const p = Math.min(1, e / 900), r = Math.min(1, e / 650);
      fs(pg.i, { p: p }, { r: 1 - Math.pow(1 - r, 3) });
      if (p >= 1) RV.pings.splice(j, 1);
    }
  }

  /* ---------- 地址：外縣市判斷（跟垃圾車頁同一套；打錯字的相近路名由 tc-addr 回 candidates） ---------- */
  const OTHER_CITY = ["臺北市", "新北市", "桃園市", "臺南市", "高雄市", "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
    "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣", "臺北縣", "桃園縣",
    "臺南縣", "高雄縣"];
  const TC_TOWNS = ["豐原", "大里", "太平", "東勢", "大甲", "清水", "沙鹿", "梧棲", "后里", "神岡", "潭子", "大雅", "新社", "石岡",
    "外埔", "大安", "烏日", "大肚", "龍井", "霧峰", "和平"];
  function normAddr(q) { return String(q || "").replace(/[\s　]/g, "").replace(/台/g, "臺").replace(/^\d{3,6}/, ""); }
  function stripSec(r) { return String(r || "").replace(/[一二三四五六七八九十]+段$/, ""); }
  function tcDists() { return (window.TcAddr && window.TcAddr.districts) || []; }
  function outOfCity(q, r) {
    const n = normAddr(q);
    for (let i = 0; i < OTHER_CITY.length; i++) if (n.indexOf(OTHER_CITY[i]) === 0) return OTHER_CITY[i];
    if (n.indexOf("臺中") === 0 || !r || !window.TcAddr.parse) return "";
    const p = window.TcAddr.parse(q);
    if (!p || p.dist) return "";
    const road = r.ok ? stripSec(r.road) : r.candidates && r.candidates[0] ? stripSec(r.candidates[0].road) : "";
    const pr = String(p.road || "");
    if (!road || pr.length <= road.length || pr.slice(pr.length - road.length) !== road) return "";
    const m = pr.slice(0, pr.length - road.length).match(/([一-鿿]{1,3})([區鄉鎮市縣])$/);
    if (!m) return "";
    if (TC_TOWNS.indexOf(m[1]) !== -1 || tcDists().indexOf(m[1] + "區") !== -1) return "";
    return m[0];
  }
  // tc-addr 的說明是寫給學區頁的（里鄰對學校）；這頁只算距離 → 把里鄰那半句換成跟距離有關的說法
  function cleanNote(n) {
    return String(n || "")
      .replace(/；?里鄰可能不同，請再確認。?/, "。")
      .replace(/；?(這條巷弄跨 \d+ 個里，請補上門牌號|整條巷弄在同一個里，鄰別只能當參考|這條路經過 \d+ 個里，請輸入完整門牌|整條路都在「[^」]*」，鄰別只能當參考)。?/, "，距離從這個點算；補上完整門牌會更準。")
      .replace(/。。/g, "。");
  }
  function showCands(list, title) {
    if (!list || !list.length) { E.cands.hidden = true; E.cands.innerHTML = ""; E.cands._list = null; return; }
    const h = ['<p class="uf-small">' + esc(title) + '</p><div class="uf-cand-btns">'];
    list.forEach((c, i) => h.push('<button type="button" class="uf-cand" data-cand="' + i + '">' + esc(c.label) + "</button>"));
    h.push("</div>");
    E.cands.innerHTML = h.join("");
    E.cands.hidden = false;
    E.cands._list = list;
  }
  // 查新地址失敗時，把上一次的結果淡化、標明「這是上一次的」
  function markStale(on) {
    S.stale = !!on;
    [E.summary, E.rulerwrap, E.listwrap].forEach(el => { if (el) el.classList.toggle("uf-stale", !!on); });
    const old = $("uf-stale-note");
    if (old) old.parentNode.removeChild(old);
    if (on && !E.summary.hidden) {
      const p = document.createElement("p");
      p.id = "uf-stale-note";
      p.className = "uf-warn-box";
      p.textContent = "這次沒查到。下面還是上一次（" + (S.label || (S.via === "geo" ? "你的位置" : "地圖上點的位置")) + "）的結果。";
      E.summary.insertBefore(p, E.summary.firstChild);
    }
  }
  function lookupFail(msg) {
    setStatus(msg, true);
    if (S.pt) markStale(true);
    track("uf_query", { result: "fail", radius: S.radius, cats: 0 });
  }
  function lookupAddr(q, opts) {
    showCands(null);
    if (!q) { setStatus("請先輸入地址，例如「北屯區崇德路二段46號」。", true); return; }
    if (!window.TcAddr) { setStatus("地址比對元件沒有載入，請重新整理；也可以用「用我的位置」或直接點地圖。", true); return; }
    const city = outOfCity(q, null);
    if (city) { lookupFail("這個工具只查臺中市的地址（你輸入的是" + city + "）。"); return; }
    setStatus("比對地址中……");
    window.TcAddr.lookup(q, opts).then(r => {
      const oc = r.ok || r.reason === "ambiguous" ? outOfCity(q, r) : "";
      if (oc) { lookupFail("這個工具只查臺中市的地址，「" + oc + "」不在臺中市。"); return; }
      if (r.ok) {
        // 查無此號（near-number）：標題放使用者輸入的地址（只在本機顯示），下一行寫「查無 X 號，改用 Y 號定位」
        runQuery(r.lat, r.lng, "address", { label: r.precision === "near-number" ? String(q).trim() : r.label, note: cleanNote(r.note), precision: r.precision });
        // 區、段、路名是推測的 → 給其他選擇
        if (r.inferred && r.choices && r.choices.length > 1) showCands(r.choices.slice(1), "不是這裡？也可能是：");
        return;
      }
      if (r.reason === "ambiguous") {
        lookupFail(r.message || "這條路在好幾個地方都有，請選一個。");
        // tc-addr 的候選是「有這個門牌號的區」排前面、其他同名路接在後面 → 標題講清楚前幾個才有這一號
        const hn = /^有 (\d+) 個地方都有/.exec(r.message || "");
        const nHit = hn ? +hn[1] : 0;
        showCands(r.candidates, nHit && r.candidates && nHit < r.candidates.length ? "請選行政區（前 " + nHit + " 個有這個門牌號）：" : "請選行政區：");
      } else if (r.reason === "road-not-found" && r.renamed) {
        // 舊路名（中港路、中區／西區的中正路 → 臺灣大道）：tc-addr 刻意不給建議
        lookupFail(r.message || "這條路已經改名，請改用新地址再查一次。");
        if (r.renamed.src && r.renamed.src.url) {
          const rs = r.renamed.src;
          E.cands.innerHTML = '<p class="uf-small">📌 資料來源：<a class="uf-a" href="' + esc(rs.url) + '" target="_blank" rel="noopener">' +
            esc(rs.org + "〈" + rs.name + "〉") + "</a>（" + esc(rs.date) + "；新舊門牌對照表在這一頁下載）</p>";
          E.cands._list = [];
          E.cands.hidden = false;
        }
      } else if (r.reason === "road-not-found") {
        lookupFail((r.message || "找不到這條路。") + "請檢查路名，或直接點地圖。");
        // 相近路名（含只差一個字的）由 tc-addr 給
        if (r.candidates && r.candidates.length) showCands(r.candidates, "你要找的是不是：");
      } else if (r.reason === "not-taichung") {
        lookupFail(r.message || "這個工具只查臺中市的地址。");
      } else if (r.reason === "empty") {
        setStatus("請先輸入地址。", true);
      } else {
        lookupFail("看不出路名。請輸入像「北屯區崇德路二段46號」這樣的地址，或直接點地圖。");
      }
    }).catch(() => {
      lookupFail("地址資料載入失敗，請檢查網路後再試；也可以用「用我的位置」或直接點地圖。");
    });
  }

  /* ---------- 查詢 ---------- */
  function runQuery(lat, lng, via, info) {
    const seq = ++S.seq;
    S.pt = { lat: lat, lng: lng };
    S.via = via;
    S.label = info.label || "";
    S.note = info.note || "";
    S.precision = info.precision || "";
    S.limit = PAGE;
    S.sel = -1;
    markStale(false);
    if (via !== "address") showCands(null);
    if (E.empty) E.empty.hidden = true;
    setStatus("掃描附近設施中……");
    // 第一次查詢還沒有結果可看 → 骨架閃光（之後重查時保留上一次的結果，換好再滑入）
    if (E.skel) E.skel.hidden = !E.summary.hidden;
    if (E.intro) E.intro.hidden = true;
    resetReveal();
    // 光束、距離尺的模組：查詢一開始就先抓（鏡頭飛過去的時間就下載完）
    if (M && !RM) loadSweep().catch(() => { swP = null; });
    if (!ruler) renderRuler([], false); // 只觸發下載，不畫
    drawQuery(true);
    if (!BOOT) { if (E.skel) E.skel.hidden = true; setStatus("設施資料沒有載入，請重新整理再試。", true); return; }
    loadData().then(items => {
      if (seq !== S.seq) return;
      if (E.skel) E.skel.hidden = true;
      S.all = nearby(items, lat, lng, MAXR);
      S.anim = S.seq + ":" + S.radius;
      renderAll();
      const list = inR();
      setStatus(list.length ? (mapOK() ? "想改查別的位置：點地圖，再按「改查這個位置」。" : "查好了，結果在下面。") : "這個範圍內沒有查到，可以放大範圍或換個位置。");
      track("uf_query", { result: list.length ? "ok" : "empty", radius: S.radius, cats: Object.keys(countBy(list)).length });
      ping();
      maybeScroll();
    }).catch(() => {
      if (seq !== S.seq) return;
      if (E.skel) E.skel.hidden = true;
      setStatus("設施資料載入失敗，請檢查網路後再試一次。", true);
      track("uf_query", { result: "fail", radius: S.radius, cats: 0 });
    });
  }
  function maybeScroll() {
    if (window.innerWidth >= 1024) return;
    const r = E.summary.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.55 || r.top < 0) E.summary.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" });
  }
  function renderAll() {
    drawQuery(true);
    renderSummary();
    renderChips();
    renderResults(true);
    drawIn();
    armReveal();
    updateLegend();
  }
  function updateLegend() {
    if (!E.legendT) return;
    E.legendT.textContent = S.pt
      ? (RM || !mapOK() ? "" : "光束掃過時，範圍內的設施會依方位一處處亮起；") + "小光柱的顏色代表類別，最高的那根是最近的一處。點光點看名稱、距離與來源。"
      : "顏色越深代表設施越密集。放大地圖會變成一個個依類別上色的點，點了看名稱。";
    if (E.legend) E.legend.classList.toggle("is-query", !!S.pt);
  }

  /* ---------- 摘要：範圍內共幾處、最近的是什麼多遠 ---------- */
  function renderSummary() {
    const R = S.radius, list = inR(), cnt = countBy(list);
    const nCat = Object.keys(cnt).length;
    const h = ['<div class="uf-card uf-sum">'];
    const kicker = S.via === "address" ? "你查的地址" : S.via === "geo" ? "你目前的位置" : "你在地圖上點的位置";
    h.push('<div class="uf-sum-top"><div class="uf-dial' + (list.length ? "" : " is-zero") + '" aria-hidden="true"><i class="uf-dial-sweep"></i><b>' + list.length +
      "</b><small>處</small></div>");
    h.push('<div class="uf-sum-head"><p class="uf-kicker">' + kicker + "・" + rtxt(R) + "內</p>");
    if (S.label) h.push('<p class="uf-sum-title">' + esc(S.label) + "</p>");
    h.push("</div></div>");
    if (S.note) h.push('<p class="uf-note">' + esc(S.note) + "</p>");
    if (!list.length) {
      h.push('<p class="uf-sum-line">' + rtxt(R) + "內，這份資料沒有查到這幾類設施。</p>");
      const more = [];
      [500, 1000].forEach(r2 => {
        if (r2 <= R) return;
        const n2 = S.all.filter(x => x.d <= r2).length;
        more.push('<button type="button" class="uf-btn uf-btn-outline uf-btn-sm" data-uf-r="' + r2 + '">改看 ' + rtxt(r2) + (n2 ? "（有 " + n2 + " 處）" : "") + "</button>");
      });
      if (more.length) h.push('<div class="uf-actions">' + more.join("") + "</div>");
      h.push('<p class="uf-small uf-mt">沒查到不等於沒有：小型宮廟、剛蓋好的設施，資料可能還沒有。現場還是要走一趟。</p>');
    } else {
      const n0 = list[0].it;
      const what = hasName(n0) ? esc(gLabel(n0.g)) + "「" + esc(n0.n) + "」" : "一處" + esc(gLabel(n0.g));
      h.push('<p class="uf-sum-line">' + rtxt(R) + "內共 <b>" + list.length + "</b> 處，分屬 " + nCat + " 類；最近的是" + what + "，直線" + mtxt(list[0].d) + "。</p>");
      h.push('<p class="uf-small uf-mt">這裡只列附近有什麼，在不在意因人而異。</p>');
    }
    h.push("</div>");
    E.summary.innerHTML = h.join("");
    E.summary.hidden = false;
    if (S.stale) markStale(true);
  }

  /* ---------- 類別膠囊：地圖、距離尺、清單同步 ---------- */
  function addChip(g) {
    if (!E.chips) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "uf-chip";
    b.setAttribute("data-g", String(g));
    b.setAttribute("aria-pressed", S.off[g] ? "false" : "true");
    b.setAttribute("style", colStyle(g));
    b.innerHTML = '<i class="uf-dot" aria-hidden="true"></i><span>' + esc(gLabel(g)) + "</span>";
    E.chips.appendChild(b);
  }
  function chipEls() { return Array.prototype.slice.call(E.chips.querySelectorAll(".uf-chip")); }
  function syncChips() {
    chipEls().forEach(b => b.setAttribute("aria-pressed", S.off[+b.getAttribute("data-g")] ? "false" : "true"));
    const anyOff = G.some((_, g) => S.off[g]);
    E.fall.textContent = anyOff ? "全選" : "全部取消";
  }
  // 查詢後：只列範圍內有的類別（附數量），依數量排序；範圍內沒有的類別寫成一行
  function renderChips() {
    const cnt = S.pt ? countBy(inR()) : null;
    const els = chipEls();
    if (!cnt) {
      els.forEach(b => { b.hidden = false; const x = b.querySelector("b"); if (x) x.remove(); });
      E.fzero.hidden = true;
      E.fh.textContent = "地圖上顯示的類別";
      syncChips();
      return;
    }
    E.fh.textContent = "類別篩選（" + rtxt(S.radius) + "內）";
    const gi = b => +b.getAttribute("data-g");
    const have = els.filter(b => cnt[gi(b)]).sort((a, b) => cnt[gi(b)] - cnt[gi(a)] || gi(a) - gi(b));
    const zero = els.filter(b => !cnt[gi(b)]);
    have.forEach(b => {
      let x = b.querySelector("b");
      if (!x) { x = document.createElement("b"); b.appendChild(x); }
      x.textContent = String(cnt[gi(b)]);
      b.hidden = false;
      E.chips.appendChild(b);
    });
    zero.forEach(b => { b.hidden = true; E.chips.appendChild(b); });
    E.fzero.hidden = !zero.length;
    E.fzero.textContent = zero.length ? (have.length ? "這個範圍內沒查到：" : "這個範圍內都沒查到：") + zero.map(b => gLabel(gi(b))).join("、") : "";
    syncChips();
  }
  function onFilterChange() {
    syncChips();
    applyMapFilter();
    if (S.pt) {
      S.limit = PAGE;
      renderResults(false);
      if (mapOK()) { drawHex(); if (!RV.list.length || !SW || !SW.busy()) drawNear(true); }
    }
  }

  /* ---------- 距離尺＋精簡清單 ---------- */
  let ruler = null, rulerP = null;
  // 距離尺：模組第一次查詢才載入；載好之前清單照常先出來
  function renderRuler(list, anim) {
    if (!ruler) {
      if (!rulerP) {
        rulerP = import("./uf-ruler.js").then(m => {
          ruler = m.createRuler(E.ruler, { onPick: i => selectItem(i, "ruler") });
          if (S.pt && !E.rulerwrap.hidden) {
            renderRuler(inRVis(), anim);
            if (S.sel >= 0) ruler.select(S.sel, true);
          }
        }).catch(() => { rulerP = null; });
      }
      return;
    }
    const key = S.anim;
    ruler.render({
      R: S.radius,
      anim: anim && !RM && key !== ruler._k,
      items: list.map(x => ({ i: x.it.i, d: x.d, g: x.it.g, name: nameOf(x.it), cat: gLabel(x.it.g), style: colStyle(x.it.g) })),
    });
    ruler._k = key;
  }
  function renderResults(anim) {
    const all = inR();
    if (!S.pt || !all.length) {
      E.rulerwrap.hidden = true;
      E.listwrap.hidden = true;
      E.list.innerHTML = "";
      return;
    }
    const list = all.filter(x => isVis(x.it));
    const hid = all.length - list.length, hidG = Object.keys(countBy(all.filter(x => !isVis(x.it)))).length;
    // 距離尺
    E.rulerwrap.hidden = false;
    E.rinfo.textContent = list.length
      ? "0 到 " + rtxt(S.radius) + "，每個點是一處設施，越右邊越遠；點一下看名稱" + (mapOK() ? "，地圖也會跟著標出來" : "") + "。"
      : "選的類別在這個範圍內都沒有，可以在上面的類別膠囊打開其他類別。";
    renderRuler(list, anim);
    // 清單
    E.listwrap.hidden = false;
    E.listinfo.textContent = "依直線距離排序。" + rtxt(S.radius) + "內共 " + all.length + " 處" +
      (hid ? "，目前隱藏 " + hidG + " 類（" + hid + " 處），在上面的類別膠囊可以打開" : "") + "。";
    renderList(list);
    if (S.sel >= 0) selectItem(S.sel, "keep");
  }
  function renderList(list) {
    const shown = list.slice(0, S.limit);
    E.list.innerHTML = shown.length
      ? shown.map(x => {
        const it = x.it;
        return '<li class="uf-li" id="uf-i-' + it.i + '" style="' + colStyle(it.g) + '"><button type="button" class="uf-li-btn" data-i="' + it.i + '">' +
          '<i class="uf-dot" aria-hidden="true"></i><span class="uf-li-d">' + mtxt(x.d).replace("約 ", "") + "</span>" +
          '<span class="uf-li-m"><span class="uf-li-n">' + esc(nameOf(it)) + (noNameNote(it) ? "<small>" + noNameNote(it) + "</small>" : "") + "</span>" +
          '<span class="uf-li-c">' + esc(gLabel(it.g)) + "・來源：" + esc(srcShort(it.s)) + "</span></span></button></li>";
      }).join("")
      : '<li class="uf-none">選的類別在這個範圍內都沒有。可以在上面的類別膠囊打開其他類別。</li>';
    E.more.hidden = list.length <= S.limit;
    E.more.textContent = "顯示全部（共 " + list.length + " 處）";
  }
  // 選一處：距離尺標亮＋清單標亮；從尺或清單點的 → 地圖也標出來
  function selectItem(i, from) {
    S.sel = i;
    if (ruler && from !== "ruler") ruler.select(i, true);
    const old = E.list.querySelector(".uf-li.is-sel");
    if (old) old.classList.remove("is-sel");
    const li = $("uf-i-" + i);
    if (li) li.classList.add("is-sel");
    if ((from === "ruler" || from === "list") && mapOK()) focusOnMap(i, from === "list");
  }
  function focusOnMap(i, scroll) {
    const it = DATA && DATA[i];
    if (!M || !mapOK() || !it) return;
    if (scroll) {
      const r = E.map.getBoundingClientRect();
      if (r.top < -40 || r.bottom > window.innerHeight + 40) E.mapcol.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" });
    }
    closePop();
    // 點已經在畫面裡 → 只開彈窗，不動鏡頭（雷達圈留在原位）；不在 → 平移過去
    const p = M.project([it.x, it.y]), c = M.getCanvas();
    const W = c.clientWidth, H = c.clientHeight;
    if (p.x > 40 && p.x < W - 40 && p.y > 60 && p.y < H - 30) { openItem(i); return; }
    camTo([it.x, it.y], Math.max(M.getZoom(), 15.5)).then(() => openItem(i));
  }
  function goCard(i) {
    let el = $("uf-i-" + i);
    if (!el) {
      const list = inRVis();
      for (let k = 0; k < list.length; k++) if (list[k].it.i === i) { S.limit = Math.max(S.limit, k + 1); break; }
      renderList(list);
      el = $("uf-i-" + i);
    }
    if (!el) return;
    selectItem(i, "popup");
    el.classList.add("uf-flash");
    setTimeout(() => el.classList.remove("uf-flash"), 1600);
    el.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "center" });
  }
  function setRadius(v) {
    S.radius = v;
    S.limit = PAGE;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="uf-r"]'), el => { el.checked = Number(el.value) === v; });
    if (S.pt && S.all) {
      if (!DATA) return; // 資料還在載，載好時 runQuery 會用新的範圍
      S.anim = S.seq + ":" + S.radius;
      renderAll();
      const list = inR();
      track("uf_query", { result: list.length ? "ok" : "empty", radius: S.radius, cats: Object.keys(countBy(list)).length });
      ping();
    }
  }

  /* ---------- 事件 ---------- */
  function boot() {
    if (!BOOT) { setStatus("設施資料沒有載入，請重新整理再試。", true); return; }
    // 門牌索引帶版本字樣（跟 tc-addr.js 同一份建置），/data/* 有 1 天快取也不會拿到舊索引
    if (window.TcAddr && window.TcAddr.config && BOOT.vIdx) {
      try { window.TcAddr.config({ v: BOOT.vIdx }); } catch (e) { /* 舊版 tc-addr.js 沒有 v 參數也能用 */ }
    }
    initMap();
    if (!cm) {
      // cine-map.js 本身沒載到（網路擋住）→ 清單照常可用
      E.map.innerHTML = '<p class="uf-mapfail">地圖載入失敗（可能是網路擋住了地圖服務）。查詢結果照常可以用。</p>';
      if (E.map.parentNode) E.map.parentNode.classList.add("is-fallback");
      mapGone();
    }
    updateLegend();
    const skip = $("uf-skip");
    if (skip) skip.addEventListener("click", e => {
      e.preventDefault();
      const tgt = !E.listwrap.hidden ? $("uf-list-h") : $("uf-data-h");
      if (tgt) { if (!tgt.hasAttribute("tabindex")) tgt.setAttribute("tabindex", "-1"); tgt.focus(); tgt.scrollIntoView({ block: "start" }); }
    });
    E.form.addEventListener("submit", e => {
      e.preventDefault();
      E.addr.blur();
      lookupAddr((E.addr.value || "").trim());
    });
    // 第一次點輸入框就先載門牌索引與設施資料，按查詢時比較快
    E.addr.addEventListener("focus", () => {
      if (window.TcAddr) window.TcAddr.ready().catch(() => {});
      loadData().catch(() => {});
    }, { once: true });
    E.cands.addEventListener("click", e => {
      const b = e.target.closest("[data-cand]");
      if (!b || !E.cands._list) return;
      const c = E.cands._list[+b.getAttribute("data-cand")];
      if (!c) return;
      E.addr.value = c.query || c.label;
      lookupAddr(c.query || c.label, c.opts);
    });
    E.here.addEventListener("click", () => {
      if (!navigator.geolocation) { setStatus("這個瀏覽器不支援定位，請輸入地址或點地圖。", true); return; }
      setStatus("定位中……（需要你允許使用位置）");
      E.here.setAttribute("aria-busy", "true");
      navigator.geolocation.getCurrentPosition(pos => {
        E.here.removeAttribute("aria-busy");
        const acc = pos.coords.accuracy;
        runQuery(pos.coords.latitude, pos.coords.longitude, "geo", {
          label: "",
          note: acc && acc > 200 ? "定位誤差約 " + Math.round(acc) + " 公尺，結果可能有偏差；可以改輸入地址。" : "",
        });
      }, () => {
        E.here.removeAttribute("aria-busy");
        setStatus("拿不到位置（可能沒給權限）。請輸入地址，或直接點地圖。", true);
        track("uf_query", { result: "fail", radius: S.radius, cats: 0 });
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="uf-r"]'), el => {
      el.addEventListener("change", () => { if (el.checked) setRadius(Number(el.value) || 300); });
    });
    E.chips.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest(".uf-chip");
      if (!b) return;
      const g = +b.getAttribute("data-g");
      S.off[g] = !S.off[g];
      onFilterChange();
    });
    E.fall.addEventListener("click", () => {
      const anyOff = G.some((_, g) => S.off[g]);
      S.off = {};
      if (!anyOff) G.forEach((_, g) => { S.off[g] = true; });
      onFilterChange();
    });
    E.more.addEventListener("click", () => { S.limit = 1e9; renderList(inRVis()); if (S.sel >= 0) selectItem(S.sel, "keep"); });
    E.list.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest(".uf-li-btn");
      if (b) selectItem(+b.getAttribute("data-i"), "list");
    });
    // 摘要、地圖彈窗裡的按鈕（capture：地圖彈窗裡的點擊不一定會冒泡上來）
    document.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const go = t.closest("[data-uf-go]");
      if (go) { e.preventDefault(); closePop(); goCard(+go.getAttribute("data-uf-go")); return; }
      const here = t.closest("[data-uf-here]");
      if (here) {
        e.preventDefault();
        const ll = here.getAttribute("data-uf-here").split(",");
        closePop();
        runQuery(+ll[0], +ll[1], "map", { label: "", note: "" });
        return;
      }
      const rb = t.closest("[data-uf-r]");
      if (rb) { e.preventDefault(); setRadius(+rb.getAttribute("data-uf-r")); }
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
