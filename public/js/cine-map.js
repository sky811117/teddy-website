/*
 * cine-map.js — 電影感地圖共用工具（MapLibre GL JS 4.7.1 ＋ 國土測繪中心 EMAP 圖磚）
 *
 * 做的事：
 *   - 需要時才載入 MapLibre（unpkg，帶 SRI integrity），整頁只載一次
 *   - 建立暖色電影調色的 EMAP raster 地圖（深色模式＝夜晚暖燈版，跟著 data-theme 即時切換）
 *   - 開場鏡頭：環繞鏡頭（orbit）——同一個中心大幅轉動方位角、由俯視壓低成斜視、只推近 0.8 級
 *     （點陣圖磚放大倍率 ≤1.75，路線編號、區名不會先變巨大模糊字再跳成細字）；約 2.8 秒，
 *     等主視覺標題浮現完、地圖露出 20%、頁面停止捲動才播，只播一次
 *   - flyTo：帶旋轉的轉場飛到查詢點。縮放差很多（≥1.5 級）或距離遠時走「俯衝」三段：
 *     先把鏡頭壓成俯視 → 俯視推近（俯視時每一層要載的圖磚少很多）→ 到了再抬起斜視＋擺方位角；
 *     縮放差不多時一段 easeTo。
 *     地圖完全不在畫面內（例：手機在頂端查詢）→ 先把鏡頭擺在「預備機位」（目標上空、拉遠 1.2 級、較平、轉 22°），
 *     等使用者捲到地圖（露出 50%、停止捲動）再補播一段原地推近（只多載一層圖磚）
 *   - addPulsePin：鏡頭停下、地圖露出 35% 以上才落下彈跳＋地面擴散光環
 *   - 地圖移動時在 document 發 "cine:map-move"（detail.moving），主視覺在畫面內就暫停粒子和體積光，把效能讓給地圖
 *   - 地圖上方天空霧化＋四周暗角（.cine-map-grade），WebGL 不能用 → 友善訊息（查詢結果照常可用）
 *   - 手機 cooperativeGestures（單指捲頁、雙指操作地圖，中文提示）；prefers-reduced-motion → 不飛、直接跳
 *
 * 樣式在 src/styles/cinematic.css（.cine-map / .cine-mapframe / .cine-pin …），頁面要有那支 CSS。
 *
 * ── API ────────────────────────────────────────────────────────────────
 *   座標一律 [lng, lat]（MapLibre 慣例），也吃 {lng, lat} / {lon, lat}。
 *   ⚠ Leaflet 是 [lat, lng]；在台灣範圍內誤傳成 [lat, lng] 會自動校正。
 *
 *   CineMap.supported()            → boolean   這台瀏覽器能不能建 WebGL
 *   CineMap.reducedMotion()        → boolean
 *   CineMap.load()                 → Promise<maplibregl>  （create 會自己叫，通常不用）
 *   CineMap.circle(center, 公尺, 邊數=64) → GeoJSON Feature<Polygon>  （畫 300／500 公尺圈用）
 *   CineMap.create(容器元素或 id, 選項) → ctl（同步回傳；地圖好了 ctl.map 才有值）
 *
 *   選項（全部可省略）：
 *     center: [lng, lat]    開場最後停的位置（預設台中市區）
 *     zoom: 12.2            開場最後的縮放（手機預設 11.6）
 *     bounds: [[西, 南], [東, 北]]  用範圍決定開場最後的畫面（有給就蓋過 center/zoom）
 *     pitch: 52 / 手機 45    斜視角度；bearing: -14 旋轉
 *     intro: true           開場飛行；reduced-motion 一律關
 *     lazy: true            地圖容器接近畫面（200px 內）才下載 MapLibre；觸控裝置另外等主視覺進場結束、瀏覽器空閒才下載
 *                           （不跟標題光掃、數字 count-up 搶同一段時間）；false＝馬上載
 *     cooperativeGestures: "auto"  觸控裝置開、滑鼠關；也可 true / false
 *     navigation: "auto"    放大縮小＋指北針按鈕（觸控裝置不放）；true / false
 *     minZoom 8, maxZoom 18.5, maxBounds 台中周邊（null＝不限制）
 *     mapOptions: {}        其他 MapLibre Map 選項，最後覆蓋（暖色調色在 GRADE，改那裡）
 *     fallbackTitle / fallbackText   WebGL 不能用時的訊息（純文字）
 *     onReady(map, ctl)     地圖 load 完（可以 addSource / addLayer 了）
 *     onUnavailable(kind)   "nogl"（沒有 WebGL）/ "load"（MapLibre 載不到）/ "lost"
 *     onError(err)          非圖磚的錯誤（預設 console.warn；圖磚偶發失敗只計數不吵）
 *
 *   ctl.ready                      → Promise<maplibregl.Map | null>（不能用時是 null）
 *   ctl.map                        → maplibregl.Map | null
 *   ctl.available                  → false 代表已經顯示了 fallback 訊息
 *   ctl.flyTo([lng,lat], zoom?, {pitch, bearing, padding, offset, duration, animate}) → Promise
 *        電影感轉場（縮放差 ≥1.5 級或 6 公里外：俯衝三段；否則一段 easeTo；每次左右擺一次方位角）。
 *        地圖還沒好就先記著，好了直接飛過去。Promise 在鏡頭真的停下才 resolve（含「捲到地圖才補播」那段）。
 *        reduced-motion、animate:false → jumpTo。地圖不在畫面內 → 預備機位＋捲到才補播（見上）。
 *        呼叫後開場飛行自動取消（flyTo／jumpTo／fitBounds 都是）。
 *   ctl.jumpTo([lng,lat], zoom?, opts?)
 *   ctl.fitBounds([[西,南],[東,北]], {padding, maxZoom}) → Promise   電影感地飛到一個範圍
 *   ctl.addPulsePin([lng,lat], {variant: "pin"|"dot", label}) → handle
 *        handle.remove()、handle.el（直立圖釘元素）
 *        鏡頭停下、地圖露出 35% 以上才落下（捲到地圖才補播）；地圖還沒好就先排隊。
 *   ctl.whenSettled(fn, ratio=0.35) 鏡頭停下（含補播）、地圖露出 ratio 以上才做 fn（頁面自己的「落地」特效用，例：學區升起）
 *   ctl.isBusy()                   鏡頭正在轉場、或還有一段等捲到地圖才補播 → true
 *   ctl.cancelIntro()              頁面自己要擺鏡頭時取消開場飛行（flyTo／jumpTo／fitBounds 會自動叫）
 *   ctl.clearPins()
 *   ctl.setTheme("light"|"dark")   （會自動跟著 <html data-theme> 切，通常不用叫）
 *
 * ── 範例 ───────────────────────────────────────────────────────────────
 *   <div class="cine-mapframe"><div id="sd-map" style="height:60vh"></div></div>
 *   <script is:inline src="/js/cine-map.js?v=1"></script>
 *   <script is:inline>
 *     var cm = CineMap.create("sd-map", {
 *       bounds: [[120.58, 24.09], [120.76, 24.24]],
 *       onReady: function (map) {
 *         map.addSource("zones", { type: "geojson", data: "/data/xxx.geojson" });
 *         map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#c98f45", "fill-opacity": 0.18 } });
 *       }
 *     });
 *     // 查到地址後
 *     cm.flyTo([pt.lng, pt.lat], 16).then(function () { … });
 *     cm.clearPins(); cm.addPulsePin([pt.lng, pt.lat], { label: "查詢的地址" });
 *   </script>
 *
 *   ⚠ 樣式沒有 glyphs（沒有字型伺服器），symbol 圖層不要用 text-field；校名等文字請用 HTML Marker 或 Popup。
 */
(function (w, d) {
  "use strict";
  if (w.CineMap) return;

  var ML = {
    js: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
    jsSri: "sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj",
    css: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
    cssSri: "sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V"
  };
  var EMAP = "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}";
  var ATTR = '<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">© 內政部國土測繪中心</a>';
  var TC_CENTER = [120.672, 24.162];
  var TC_BOUNDS = [[120.2, 23.75], [121.7, 24.7]];
  var BEARING_A = -18, BEARING_B = 8;
  var NEAR_M = 6000;       // 查詢點在 6 公里內：easeTo（不拉高、不載一路上的各層圖磚）

  // 介面文字：只留這張地圖會出現的控制項（出處、放大縮小與指北針、彈窗、標記、兩指操作提示）
  var LOCALE = {
    "AttributionControl.ToggleAttribution": "顯示／收起資料來源",
    "Map.Title": "地圖",
    "Marker.Title": "地圖標記",
    "NavigationControl.ResetBearing": "轉回正北、放平",
    "NavigationControl.ZoomIn": "放大",
    "NavigationControl.ZoomOut": "縮小",
    "Popup.Close": "關閉",
    "CooperativeGesturesHandler.WindowsHelpText": "按住 Ctrl 再滾動滑鼠滾輪，才會縮放地圖",
    "CooperativeGesturesHandler.MacHelpText": "按住 ⌘ 再滾動滑鼠滾輪，才會縮放地圖",
    "CooperativeGesturesHandler.MobileHelpText": "用兩根手指移動、縮放地圖"
  };

  // 暖色電影調色：raster paint 在著色器裡算，不吃效能。深色＝反相＋色相轉 180°（保留原色相、明暗顛倒）＋琥珀疊色
  var GRADE = {
    light: {
      bg: "#efe6d8",
      raster: { "raster-saturation": -0.06, "raster-contrast": 0.12, "raster-brightness-min": 0, "raster-brightness-max": 0.97, "raster-hue-rotate": -6 },
      tint: "#f2b35e",
      tintOpacity: 0.08,
      sky: { "sky-color": "#f1d9ae", "horizon-color": "#fbeacd", "fog-color": "#f6e4c7", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.5, "atmosphere-blend": 0.7 }
    },
    dark: {
      bg: "#15110d",
      raster: { "raster-saturation": -0.3, "raster-contrast": 0.1, "raster-brightness-min": 0.9, "raster-brightness-max": 0.07, "raster-hue-rotate": 180 },
      tint: "#d9913a",
      tintOpacity: 0.13,
      sky: { "sky-color": "#120d09", "horizon-color": "#5b3b1c", "fog-color": "#2a1d12", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.5, "atmosphere-blend": 0.6 }
    }
  };

  function mq(q) { try { return w.matchMedia(q).matches; } catch (e) { return false; } }
  function reducedMotion() { return mq("(prefers-reduced-motion: reduce)"); }
  function isTouch() { return mq("(pointer: coarse)") || (!mq("(hover: hover)") && "ontouchstart" in w); }
  function isNarrow() { return (w.innerWidth || 1024) < 768; }
  function theme() { return d.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function distM(a, b) {
    var k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    var dx = (b[0] - a[0]) * 111320 * k, dy = (b[1] - a[1]) * 110540;
    return Math.sqrt(dx * dx + dy * dy);
  }
  // 主視覺（CinematicHero）標題浮現完才開場飛行：「標題 → 搜尋卡 → 鏡頭飛入」，不擠在同一秒
  function afterHero(cb) {
    var root = d.documentElement, done = false;
    function go() { if (!done) { done = true; cb(); } }
    if (root.hasAttribute("data-cine-hero-done") || !d.querySelector("[data-cine-hero]")) { go(); return; }
    d.addEventListener("cine:hero-done", go);
    setTimeout(go, 3500);
  }
  function ext(a, b) { for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; return a; }
  function now() { return w.performance && performance.now ? performance.now() : Date.now(); }
  function idle(cb) {
    if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 700 });
    else setTimeout(cb, 120);
  }

  // 使用者正在捲頁／手指滑過地圖嗎？（等停下來才補播鏡頭：不在滑動途中、不在「兩指操作」提示層底下落地）
  var lastScroll = -1e9, lastTouch = -1e9, inputBound = false;
  function bindInput() {
    if (inputBound) return;
    inputBound = true;
    var o = { passive: true, capture: true };
    w.addEventListener("scroll", function () { lastScroll = now(); }, o);
    ["wheel", "touchmove"].forEach(function (ev) {
      d.addEventListener(ev, function (e) {
        lastScroll = now();
        var t = e.target;
        if (t && t.closest && t.closest(".cine-map")) lastTouch = now();
      }, o);
    });
  }
  // 捲動停下 220ms，而且手指離開地圖 650ms（MapLibre 的「兩指操作」提示層在 cinematic.css 裡設成 0.35 秒後淡出）
  function whenInputIdle(cb) {
    bindInput();
    (function check() {
      var t = now(), wait = Math.max(220 - (t - lastScroll), 650 - (t - lastTouch));
      if (wait <= 0) cb();
      else setTimeout(check, Math.min(Math.max(wait, 40), 400));
    })();
  }

  // 地圖在動：通知主視覺（CinematicHero）暫停粒子與體積光，把 GPU 讓給地圖
  var uid = 0;
  function emitMove(ctl, moving) {
    if (ctl._moving === moving) return;
    ctl._moving = moving;
    try { d.dispatchEvent(new CustomEvent("cine:map-move", { detail: { id: ctl._uid, moving: moving } })); } catch (e) {}
  }

  function toLL(x) {
    if (!x) return null;
    var lng, lat;
    if (Array.isArray(x)) { lng = +x[0]; lat = +x[1]; }
    else { lng = +(x.lng != null ? x.lng : x.lon); lat = +x.lat; }
    if (!isFinite(lng) || !isFinite(lat)) return null;
    // 台灣範圍：誤傳 Leaflet 的 [lat, lng] 自動換回來
    if (lng > 0 && lng < 60 && lat > 60) { var t = lng; lng = lat; lat = t; }
    return [lng, lat];
  }

  function supported() {
    try {
      var c = d.createElement("canvas");
      var gl = c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return false;
      var lose = gl.getExtension && gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return true;
    } catch (e) { return false; }
  }

  var libPromise = null;
  function load() {
    if (w.maplibregl && w.maplibregl.Map) return Promise.resolve(w.maplibregl);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (res, rej) {
      if (!d.querySelector("link[data-cine-ml]")) {
        var l = d.createElement("link");
        l.rel = "stylesheet"; l.href = ML.css; l.integrity = ML.cssSri; l.crossOrigin = "anonymous";
        l.setAttribute("data-cine-ml", "");
        d.head.appendChild(l);
      }
      var s = d.createElement("script");
      s.src = ML.js; s.integrity = ML.jsSri; s.crossOrigin = "anonymous"; s.async = true;
      s.onload = function () { w.maplibregl && w.maplibregl.Map ? res(w.maplibregl) : rej(new Error("maplibregl missing")); };
      s.onerror = function () { libPromise = null; s.remove(); rej(new Error("MapLibre load failed")); };
      d.head.appendChild(s);
    });
    return libPromise;
  }

  function observe(el, opts, cb) {
    if (!("IntersectionObserver" in w)) { cb(); return; }
    var io = new IntersectionObserver(function (es) {
      for (var i = 0; i < es.length; i++) {
        if (es[i].isIntersecting && es[i].intersectionRatio >= (opts.ratio || 0)) { io.disconnect(); cb(); return; }
      }
    }, { rootMargin: opts.margin || "0px", threshold: opts.ratio ? [0, opts.ratio] : 0 });
    io.observe(el);
  }

  function circle(center, radius, steps) {
    var c = toLL(center), n = steps || 64, out = [];
    var dLat = radius / 111320, dLng = radius / (111320 * Math.cos(c[1] * Math.PI / 180));
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      out.push([c[0] + dLng * Math.cos(a), c[1] + dLat * Math.sin(a)]);
    }
    return { type: "Feature", properties: { radius: radius }, geometry: { type: "Polygon", coordinates: [out] } };
  }

  function buildStyle(g) {
    return {
      version: 8,
      sources: {
        "cine-emap": { type: "raster", tiles: [EMAP], tileSize: 256, maxzoom: 18, attribution: ATTR }
      },
      layers: [
        { id: "cine-bg", type: "background", paint: { "background-color": g.bg } },
        { id: "cine-emap", type: "raster", source: "cine-emap", paint: ext({ "raster-fade-duration": 250 }, g.raster) },
        { id: "cine-tint", type: "background", paint: { "background-color": g.tint, "background-opacity": g.tintOpacity } }
      ]
    };
  }

  var live = [];
  var themeWatch = null;
  function watchTheme() {
    if (themeWatch || !("MutationObserver" in w)) return;
    themeWatch = new MutationObserver(function () {
      var t = theme();
      for (var i = 0; i < live.length; i++) live[i].setTheme(t);
    });
    themeWatch.observe(d.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function Ctl(el, o) {
    var self = this;
    this.el = el;
    this.opts = o;
    this.map = null;
    this.available = true;
    this.pins = [];
    this.tileErrors = 0;
    this._queue = [];
    this._pending = null;
    this._theme = theme();
    this._ratio = -1;        // 地圖露出畫面的比例（-1＝還不知道，當作看得到）
    this._visH = 0;
    this._waits = [];
    this._afterReveal = [];
    this._reveal = null;
    this._tok = 0;
    this._uid = ++uid;
    this.frame = el.closest ? el.closest(".cine-mapframe") : null;
    el.classList.add("cine-map");
    this.ready = new Promise(function (r) { self._resolve = r; });
    if (!supported()) { this._fail("nogl"); return; }
    // 一建立就跟著切深淺色：MapLibre 還在下載、樣式還沒載好時切換，也會記下新主題（建樣式、load 時套用）
    live.push(this);
    watchTheme();
    if ("IntersectionObserver" in w) {
      this._io = new IntersectionObserver(function (es) {
        var e = es[es.length - 1], ws = self._waits;
        self._ratio = e.isIntersecting ? e.intersectionRatio : 0;
        self._visH = e.isIntersecting ? e.intersectionRect.height : 0;
        self._waits = [];
        for (var i = 0; i < ws.length; i++) self._when(ws[i].r, ws[i].fn);
      }, { threshold: [0, 0.2, 0.35, 0.5, 0.6] });
      this._io.observe(el);
    }
    if (o.lazy === false) this.load();
    else if (isTouch()) {
      // 手機：主視覺進場（標題光掃、數字 count-up）結束、瀏覽器空閒了才下載 MapLibre 和圖磚
      observe(el, { margin: "200px 0px" }, function () { afterHero(function () { idle(function () { self.load(); }); }); });
    } else observe(el, { margin: "200px 0px" }, function () { self.load(); });
  }

  // 地圖露出畫面至少 r（或露出 240px 以上：高地圖在矮螢幕上）才做 fn；沒有 IntersectionObserver 直接做。
  // 當下量一次位置（捲動中 IntersectionObserver 的紀錄會慢一拍），不夠就等它回報
  Ctl.prototype._measure = function () {
    if (!this._io) return;
    var b = this.el.getBoundingClientRect(), vh = w.innerHeight || d.documentElement.clientHeight;
    var h = Math.max(0, Math.min(b.bottom, vh) - Math.max(b.top, 0));
    this._visH = h;
    this._ratio = b.height ? h / b.height : 0;
  };
  Ctl.prototype._when = function (r, fn) {
    this._measure();
    if (!this._io || this._ratio >= r || (r > 0 && this._ratio > 0 && this._visH >= 240)) fn();
    else this._waits.push({ r: r, fn: fn });
  };
  Ctl.prototype.isBusy = function () { return !!(this._reveal || this._flying); };

  // 開場的起始機位：環繞鏡頭。推近只有 0.8 級（點陣圖磚放大 ≤1.75 倍、幾乎不換層），
  // 動感靠方位角大轉 40° 和俯視 → 斜視帶出來（像 UE 的 orbit／dolly shot）
  function introStart(fin, minZoom) {
    return { center: fin.center, zoom: Math.max(minZoom, fin.zoom - 0.8), pitch: 20, bearing: fin.bearing + 40 };
  }

  Ctl.prototype.load = function () {
    var self = this;
    if (this._loading || !this.available) return this.ready;
    this._loading = true;
    load().then(function (ml) { self._init(ml); }, function (e) { self._fail("load", e); });
    return this.ready;
  };

  Ctl.prototype._fail = function (kind, err) {
    this.available = false;
    var o = this.opts;
    var title = o.fallbackTitle || (kind === "load" ? "地圖沒有載入成功" : "這台裝置沒辦法顯示地圖");
    var text = o.fallbackText || (kind === "load"
      ? "可能是網路不穩，重新整理頁面再試一次。查詢結果照常可以用。"
      : "瀏覽器沒有開啟 3D 繪圖（WebGL）。查詢結果照常可以用。");
    if (!this.el.querySelector(".cine-map-fallback")) {
      var box = d.createElement("div");
      box.className = "cine-map-fallback";
      box.setAttribute("role", "note");
      box.innerHTML = '<p class="cine-glass"><strong></strong></p>';
      box.firstChild.firstChild.textContent = title;
      box.firstChild.appendChild(d.createTextNode(text));
      this.el.appendChild(box);
    }
    this.el.classList.add("is-fallback");
    if (this.frame) this.frame.classList.add("is-fallback");
    emitMove(this, false);
    if (kind !== "lost") {
      var i = live.indexOf(this);
      if (i >= 0) live.splice(i, 1);
      this._resolve(null);
    }
    if (o.onUnavailable) try { o.onUnavailable(kind, err); } catch (e) {}
  };

  Ctl.prototype._init = function (ml) {
    var self = this, o = this.opts, el = this.el;
    var narrow = isNarrow(), rm = reducedMotion();
    var fin = this._final = {
      center: toLL(o.center) || TC_CENTER,
      zoom: o.zoom != null ? o.zoom : (narrow ? 11.6 : 12.2),
      pitch: o.pitch != null ? o.pitch : (narrow ? 45 : 52),
      bearing: o.bearing != null ? o.bearing : -14
    };
    var high = o.intro !== false && !rm;          // 從高空開始（開場或第一次查詢都從高空飛進來）
    var intro = high && !this._pending;
    var coop = o.cooperativeGestures == null || o.cooperativeGestures === "auto" ? isTouch() : !!o.cooperativeGestures;
    var opts = {
      container: el,
      style: buildStyle(this._grade(this._theme)),
      center: fin.center, zoom: fin.zoom, pitch: fin.pitch, bearing: fin.bearing,
      minZoom: o.minZoom != null ? o.minZoom : 8,
      maxZoom: o.maxZoom != null ? o.maxZoom : 18.5,
      maxPitch: 60,
      cooperativeGestures: coop,
      locale: LOCALE,
      attributionControl: { compact: true },
      pixelRatio: Math.min(w.devicePixelRatio || 1, 2),
      fadeDuration: rm ? 0 : 250,
      refreshExpiredTiles: false
    };
    if (o.maxBounds !== null) opts.maxBounds = o.maxBounds || TC_BOUNDS;
    if (o.mapOptions) ext(opts, o.mapOptions);

    var map;
    try { map = new ml.Map(opts); } catch (e) { this._fail("nogl", e); return; }
    this._ml = ml;

    if (o.bounds) {
      try {
        var cam = map.cameraForBounds(o.bounds, { padding: narrow ? 16 : 36 });
        if (cam) { fin.center = toLL(cam.center); fin.zoom = Math.min(cam.zoom, opts.maxZoom); }
      } catch (e) {}
    }
    this._minZoom = opts.minZoom;
    map.jumpTo(high ? introStart(fin, opts.minZoom) : fin);

    var nav = o.navigation == null || o.navigation === "auto" ? !isTouch() : !!o.navigation;
    if (nav) map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");

    // 天空霧化＋暗角：插在 <canvas> 後面，Marker（之後才加進來）會在它上面
    var grade = d.createElement("div");
    grade.className = "cine-map-grade";
    grade.setAttribute("aria-hidden", "true");
    var cv = map.getCanvas();
    cv.parentNode.insertBefore(grade, cv.nextSibling);

    map.on("error", function (e) {
      if (e && (e.tile || e.sourceId)) { self.tileErrors++; return; }
      var err = e && e.error;
      if (o.onError) o.onError(err);
      else if (w.console) console.warn("[cine-map]", (err && err.message) || err);
    });
    map.on("webglcontextlost", function () { self._fail("lost"); });
    map.on("webglcontextrestored", function () {
      var fb = el.querySelector(".cine-map-fallback");
      if (fb) fb.remove();
      el.classList.remove("is-fallback");
      self.available = true;
    });
    ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach(function (ev) {
      map.on(ev, function (e) {
        if (!e || !e.originalEvent) return;
        self._touched = true;
        self._userMoved = true;
        // 使用者自己動地圖了：等捲到才補播的那段鏡頭就不播（不搶使用者的鏡頭）
        if (self._reveal) self._endReveal();
      });
    });
    // 地圖在動 → 主視覺暫停粒子、體積光（moveend 可能連發：下一格還沒再動才算停）。
    // 鏡頭被瞬間設定（頁面或外部程式 jumpTo；視窗縮放不算）→ 開場飛行不要再把畫面拉回全市
    var stopT = 0, mvT = 0, rsz = false;
    map.on("movestart", function () { clearTimeout(stopT); mvT = now(); rsz = false; emitMove(self, true); });
    map.on("resize", function () { rsz = true; });
    map.on("moveend", function () {
      if (!rsz && now() - mvT < 20) self._touched = true;
      clearTimeout(stopT);
      stopT = setTimeout(function () { if (!map.isMoving() && !self._flying) emitMove(self, false); }, 60);
    });

    map.on("load", function () {
      self.map = map;
      // 下載 MapLibre、載樣式期間切過深淺色 → 這裡再對一次（建樣式時用的主題可能已經舊了）
      self.setTheme(theme());
      el.classList.add("is-ready");
      if (self.frame) self.frame.classList.add("is-ready");
      if (self._pending) {
        var p = self._pending;
        self._pending = null;
        self._fly(p.center, p.zoom, p.opts).then(p.resolve);
      } else if (intro) {
        self._intro();
      }
      var q = self._queue;
      self._queue = [];
      for (var i = 0; i < q.length; i++) self._mountPin(q[i]);
      try { if (o.onReady) o.onReady(map, self); } catch (e) { if (w.console) console.warn("[cine-map] onReady", e); }
      self._resolve(map);
    });
  };

  Ctl.prototype._grade = function (t) { return GRADE[t] || GRADE.light; };

  Ctl.prototype._sky = function (t) {
    var map = this.map;
    if (!map || typeof map.setSky !== "function") return;
    try { map.setSky(this._grade(t).sky); } catch (e) {}
  };

  Ctl.prototype.setTheme = function (t) {
    this._theme = t === "dark" ? "dark" : "light";
    var map = this.map;
    if (!map) return;
    var g = this._grade(this._theme);
    try {
      map.setPaintProperty("cine-bg", "background-color", g.bg);
      for (var k in g.raster) map.setPaintProperty("cine-emap", k, g.raster[k]);
      map.setPaintProperty("cine-tint", "background-color", g.tint);
      map.setPaintProperty("cine-tint", "background-opacity", g.tintOpacity);
    } catch (e) {}
    this._sky(this._theme);
  };

  // 開場：環繞鏡頭（同一個中心，方位角轉 40°、俯視壓成斜視、推近 0.8 級）。
  // 等地圖露出 20%、主視覺標題浮現完、頁面停止捲動才播（不在滑動途中、不在「兩指操作」提示層底下播）
  Ctl.prototype._intro = function () {
    var self = this;
    this._when(0.2, function () {
      afterHero(function () {
        whenInputIdle(function () {
          var map = self.map, fin = self._final;
          if (!map || self._touched || self._flying || self._reveal || map.isMoving()) return;
          map.easeTo({
            center: fin.center, zoom: fin.zoom, pitch: fin.pitch, bearing: fin.bearing,
            duration: 2800, essential: true, easing: easeInOutCubic
          });
        });
      });
    });
  };

  Ctl.prototype.cancelIntro = function () { this._touched = true; };

  Ctl.prototype._cam = function (center, zoom, o) {
    var map = this.map, b = map.getBearing();
    var cam = {
      center: toLL(center),
      zoom: zoom != null ? zoom : Math.max(map.getZoom(), 15),
      pitch: o.pitch != null ? o.pitch : this._final.pitch,
      bearing: o.bearing != null ? o.bearing : (Math.abs(b - BEARING_A) > Math.abs(b - BEARING_B) ? BEARING_A : BEARING_B)
    };
    if (o.padding != null) cam.padding = o.padding;
    if (o.offset) cam.offset = o.offset;
    return cam;
  };

  // 一段鏡頭移動：moveend（或逾時）才 resolve；resolve(true)＝正常播完，false＝被新的轉場或使用者打斷
  // ⚠ 先下 easeTo 再掛 moveend：easeTo 會先停掉上一段動畫、同步發一次 moveend，先掛會被那一次誤觸
  Ctl.prototype._move = function (kind, opts, tok) {
    var self = this, map = this.map;
    return new Promise(function (res) {
      if (tok !== self._tok || !map) { res(false); return; }
      var done = false, t = 0;
      function end() {
        if (done) return;
        done = true;
        clearTimeout(t);
        map.off("moveend", end);
        res(tok === self._tok && !self._userMoved);
      }
      if (kind === "fly") map.flyTo(opts); else map.easeTo(opts);
      map.on("moveend", end);
      t = setTimeout(end, (opts.duration || 1000) + 900);
    });
  };

  function shortestDelta(a, b) { var x = ((b - a) % 360 + 540) % 360 - 180; return x; }
  function withPad(o, cam) { if (cam.padding != null) o.padding = cam.padding; if (cam.offset) o.offset = cam.offset; return o; }

  Ctl.prototype._fly = function (center, zoom, o) {
    var self = this, map = this.map;
    o = o || {};
    var cam = this._cam(center, zoom, o);
    if (!cam.center) return Promise.resolve();
    var tok = ++this._tok;
    this._userMoved = false;
    var old = this._reveal;
    this._reveal = null;
    try {
      this._measure();
      // 減少動態、指定不動畫 → 直接跳
      if (reducedMotion() || o.animate === false) { this._flying = false; map.jumpTo(cam); return Promise.resolve(); }
      // 地圖完全不在畫面內（例：手機在頂端查詢）：先擺預備機位，捲到地圖才補播原地推近
      if (this._ratio === 0) return this._armReveal(cam, tok);
      var c = map.getCenter(), near = distM([c.lng, c.lat], cam.center) < NEAR_M;
      var z0 = map.getZoom(), p0 = map.getPitch(), b0 = map.getBearing();
      var dive = !near || Math.abs(cam.zoom - z0) >= 1.5;
      var total = o.duration || (!near ? 3300 : dive ? 2550 : 2000);
      this._flying = true;
      var chain;
      if (!dive) {
        chain = this._move("ease", ext(ext({}, cam), { duration: total, easing: o.easing || easeInOutCubic, essential: true }), tok);
      } else {
        // 俯衝三段：①壓成俯視 ②俯視推近（遠的走 flyTo 弧線）③抬起斜視＋擺方位角。
        // 斜視時畫面遠方要多載很多圖磚，推近途中的每一層都要載一次；俯視推近只載眼前那幾張（實測 1280 寬少約 4 成）
        var LOW = Math.min(10, cam.pitch), db = shortestDelta(b0, cam.bearing);
        var tA = p0 > LOW + 6 ? Math.round(total * 0.14) : 0, tC = Math.round(total * 0.36), tB = total - tA - tC;
        var first = tA ? this._move("ease", { pitch: LOW, bearing: b0 + db * 0.2, duration: tA, easing: easeInOutSine, essential: true }, tok) : Promise.resolve(true);
        chain = first.then(function (ok) {
          if (!ok) return false;
          var mid = withPad({ center: cam.center, zoom: cam.zoom, pitch: LOW, bearing: b0 + db * 0.55, duration: tB, essential: true, easing: easeInOutCubic }, cam);
          if (near) return self._move("ease", mid, tok);
          return self._move("fly", ext(mid, { curve: 1.25 }), tok);
        }).then(function (ok) {
          if (!ok) return false;
          return self._move("ease", withPad({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, duration: tC, easing: easeInOutCubic, essential: true }, cam), tok);
        });
      }
      return chain.then(function () { if (tok === self._tok) self._flying = false; });
    } finally {
      // 上一段「等捲到才補播」作廢：放行它的 Promise、讓排隊的圖釘重新判斷（這時新的轉場狀態已經設好）
      if (old) setTimeout(function () { self._flushReveal(old); }, 0);
    }
  };

  // 預備機位：目標上空、拉遠 1.2 級、較平、轉 22°（只載一層圖磚）；地圖露出 50%、停止捲動後，原地推近到目標（1.4 秒）
  Ctl.prototype._armReveal = function (cam, tok) {
    var self = this, map = this.map;
    this._flying = false;
    map.jumpTo(withPad({ center: cam.center, zoom: Math.max(this._minZoom || 8, cam.zoom - 1.2), pitch: Math.max(0, cam.pitch - 12), bearing: cam.bearing + 22 }, cam));
    return new Promise(function (res) {
      var rv = self._reveal = { cam: cam, tok: tok, res: res };
      function go() {
        if (self._reveal !== rv) return;
        whenInputIdle(function () {
          if (self._reveal !== rv) return;
          self._measure();
          // 使用者只是滑過、地圖又離開畫面了 → 再等
          if (self._ratio < 0.3 && self._visH < 200) { self._when(0.5, go); return; }
          self._flying = true;
          self._move("ease", ext(ext({}, cam), { duration: 1400, easing: easeInOutCubic, essential: true }), tok).then(function () {
            if (tok === self._tok) self._flying = false;
            if (self._reveal === rv) self._endReveal();
          });
        });
      }
      self._when(0.5, go);
    });
  };
  Ctl.prototype._flushReveal = function (rv) {
    try { rv.res(); } catch (e) {}
    var q = this._afterReveal;
    this._afterReveal = [];
    for (var i = 0; i < q.length; i++) try { q[i](); } catch (e) {}
  };
  Ctl.prototype._endReveal = function () {
    var rv = this._reveal;
    if (!rv) return;
    this._reveal = null;
    this._flushReveal(rv);
  };

  // 鏡頭停下（含等捲到才補播的那段）、地圖露出 ratio 以上才做 fn
  Ctl.prototype.whenSettled = function (fn, ratio) {
    var self = this, r = ratio == null ? 0.35 : ratio;
    function check() {
      var map = self.map;
      if (!map) { self.ready.then(function (m) { if (m) setTimeout(check, 0); }); return; }
      if (self._reveal) { self._afterReveal.push(check); return; }
      if (self._flying || map.isMoving()) { map.once("moveend", function () { setTimeout(check, 120); }); return; }
      if (reducedMotion()) fn();
      else self._when(r, fn);
    }
    // 下一格再看（讓同一輪的 flyTo 先起飛）
    setTimeout(check, 180);
  };

  Ctl.prototype.flyTo = function (center, zoom, o) {
    if (!this.available) return Promise.resolve();
    this._touched = true;     // 頁面自己擺鏡頭了：開場飛行不要再把畫面拉回全市
    if (this.map) return this._fly(center, zoom, o);
    var self = this;
    return new Promise(function (res) {
      if (self._pending) self._pending.resolve();
      self._pending = { center: center, zoom: zoom, opts: o, resolve: res };
      self.load();
    });
  };

  Ctl.prototype.jumpTo = function (center, zoom, o) {
    return this.flyTo(center, zoom, ext(ext({}, o || {}), { animate: false }));
  };

  Ctl.prototype.fitBounds = function (bounds, o) {
    var self = this;
    o = o || {};
    this._touched = true;
    this.load();
    return this.ready.then(function (map) {
      if (!map) return;
      var cam = map.cameraForBounds(bounds, { padding: o.padding != null ? o.padding : (isNarrow() ? 24 : 48), maxZoom: o.maxZoom || 17 });
      if (!cam) return;
      return self._fly(cam.center, cam.zoom - 0.35, o);
    });
  };

  Ctl.prototype.addPulsePin = function (lngLat, o) {
    var self = this;
    var h = {
      lngLat: toLL(lngLat), opts: o || {}, el: null, ground: null, marker: null, groundMarker: null, removed: false,
      remove: function () {
        h.removed = true;
        if (h.marker) h.marker.remove();
        if (h.groundMarker) h.groundMarker.remove();
        var i = self.pins.indexOf(h);
        if (i >= 0) self.pins.splice(i, 1);
      }
    };
    this.pins.push(h);
    if (!h.lngLat || !this.available) return h;
    if (this.map) this._mountPin(h);
    else { this._queue.push(h); this.load(); }
    return h;
  };

  Ctl.prototype._mountPin = function (h) {
    if (h.removed) return;
    var ml = this._ml, map = this.map, o = h.opts, dot = o.variant === "dot";
    var pin = d.createElement("div");
    pin.className = "cine-pin" + (dot ? " cine-pin--dot" : "");
    pin.innerHTML = '<span class="cine-pin__drop"><span class="cine-pin__head"></span></span>';
    if (o.label) { pin.setAttribute("role", "img"); pin.setAttribute("aria-label", o.label); pin.title = o.label; }
    else pin.setAttribute("aria-hidden", "true");
    var gr = d.createElement("div");
    gr.className = "cine-pin-ground";
    gr.setAttribute("aria-hidden", "true");
    gr.innerHTML = '<span class="cine-pin-ground__core"></span><span class="cine-pin-ground__ring"></span><span class="cine-pin-ground__ring cine-pin-ground__ring--2"></span>';
    h.el = pin;
    h.ground = gr;
    h.groundMarker = new ml.Marker({ element: gr, anchor: "center", pitchAlignment: "map", rotationAlignment: "map" }).setLngLat(h.lngLat).addTo(map);
    h.marker = new ml.Marker({ element: pin, anchor: dot ? "center" : "bottom" }).setLngLat(h.lngLat).addTo(map);
    // 落地節拍：等鏡頭停下（下一格再看，讓同一輪的 flyTo 先起飛）＋地圖露出 35% 以上才落下；捲到地圖才補播
    var self = this;
    function go() { if (!h.removed) { pin.classList.add("is-live"); gr.classList.add("is-live"); } }
    function settle() {
      if (h.removed) return;
      if (self._reveal) { self._afterReveal.push(settle); return; }
      if (self._flying || map.isMoving()) { map.once("moveend", function () { setTimeout(settle, 120); }); return; }
      if (reducedMotion()) go();
      else self._when(0.35, go);
    }
    // 下一格再看（讓同一輪的 flyTo 先起飛）；多等一下，查詢後頁面正在捲到結果卡時量到的位置才準
    setTimeout(settle, 180);
  };

  Ctl.prototype.clearPins = function () {
    var ps = this.pins.slice();
    for (var i = 0; i < ps.length; i++) ps[i].remove();
    this._queue = [];
  };

  function create(container, opts) {
    var el = typeof container === "string" ? (d.getElementById(container) || d.querySelector(container)) : container;
    if (!el) throw new Error("CineMap.create: 找不到地圖容器 " + container);
    return new Ctl(el, opts || {});
  }

  w.CineMap = {
    version: "1.2.0",
    maplibreVersion: "4.7.1",
    EMAP_URL: EMAP,
    TC_CENTER: TC_CENTER,
    TC_BOUNDS: TC_BOUNDS,
    GRADE: GRADE,
    supported: supported,
    reducedMotion: reducedMotion,
    load: load,
    circle: circle,
    toLngLat: toLL,
    create: create
  };
})(window, document);
