/*! home-map.js 首頁第一眼的「在售物件地圖」：一個點是一間台中在售的房子。
 * 在輸入框（#hero-say）打一句話，地圖跟著篩、鏡頭推到那一區；點一顆，跳出那一間的小卡，點小卡進物件頁。
 * 資料：三個網址都從 <figure id="home-map"> 的 data-points／data-cards／data-zones 拿（同源，建置時產生），這支檔不寫死資料路徑。
 * 底圖：空拍影像與路名是內政部國土測繪中心的網路地圖服務，照對方的使用規定只能「直接連過去用」——
 *   由客人的瀏覽器連線顯示，本站伺服器不下載、不轉存、不代發；網址只有下面 TILE、TILE_LAB 兩處。
 *   部署前的稽核（scripts/leak-audit.mjs）只准這個網域出現在本檔和找房地圖 find-map.js。
 *   圖片請求不帶 Referer、不帶也不存對方的 cookie（跟隱私權頁寫的一致）。
 *   地圖右下角的出處（.hm-credit）是使用條件，不能拿掉。
 * 順序：先畫亮底版（不連外）；網頁載完才去接空拍圖，接不到就停在亮底版。
 * 樣式在 src/styles/home-map.css；畫面上的字只用 textContent。網址帶 ?hmdebug=1 才掛 window.__hm／__hmll（給測試讀）。 */
(function () {
  "use strict";
  var d = document, W = window, html = d.documentElement;
  var root = d.getElementById("home-map");
  if (!root) return;
  var shot = root;   // 這個圖塊在樣稿裡叫 shot：底下沿用同一個名字，方便逐段對照
  var hasIO = "IntersectionObserver" in W;
  var DPR = Math.min(W.devicePixelRatio || 1, 2);
  var mq = W.matchMedia ? W.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var conn = navigator.connection, saveData = !!(conn && conn.saveData);   // 省流量模式：不自動接空拍圖、不預先載讀句子的程式
  var debug = /[?&]hmdebug=1(?:&|$)/.test(location.search);
  var SVG = "http://www.w3.org/2000/svg";
  var dead = false, undo = null;

  /* ── 共用小工具 ── */
  // 安靜模式：系統開了「減少動態」，或版面被標成 .lite（低階手機、省流量；跑起來掉格時站上也會中途補上）。每次要重畫都重讀
  function isCalm() { return !!(mq && mq.matches) || html.classList.contains("lite"); }
  // 掛事件：地圖收掉之後（off）就不再有反應
  function on(el, type, fn, opt) { el.addEventListener(type, function (e) { if (!dead) fn(e); }, opt || false); }
  // 看得到才跑的畫格迴圈。fn 回 true＝還有東西在動，下一格繼續；回 false＝畫面靜下來了，停到下一次 kick()
  function loop(el, fn) {
    var seen = !hasIO, vis = !d.hidden, raf = 0, last = 0;
    function step(now) {
      raf = 0;
      if (!seen || !vis) return;
      var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
      var more = fn(now / 1000, dt);
      if (more && !raf) raf = requestAnimationFrame(step);   // fn 裡面如果已經 kick 過，就不重複排
    }
    function kick() { if (!raf && seen && vis) { last = performance.now(); raf = requestAnimationFrame(step); } }
    if (hasIO) new IntersectionObserver(function (es) { seen = es[es.length - 1].isIntersecting; kick(); }, { rootMargin: "60px 0px" }).observe(el);
    d.addEventListener("visibilitychange", function () { vis = !d.hidden; kick(); });
    kick.on = function () { return !!raf; };
    kick();
    return kick;
  }
  function fit(cv, w, h) {
    cv.width = Math.max(1, Math.round(w * DPR)); cv.height = Math.max(1, Math.round(h * DPR));
    cv.style.width = w + "px"; cv.style.height = h + "px";
    var g = cv.getContext("2d"); g.setTransform(DPR, 0, 0, DPR, 0, 0);
    return g;
  }
  // 固定種子的亂數（同一間房子每次都落在同一個位置）
  function rnd(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 抓同源的 JSON；抓不到、不是 JSON 都走 bad
  function getJSON(url, ok, bad) {
    if (!url) { bad(); return; }
    W.fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(ok, bad);
  }
  // 按鈕裡的線條圖示（一個一個節點組出來，不塞 HTML 字串）
  function icon(path) {
    var s = d.createElementNS(SVG, "svg"), p = d.createElementNS(SVG, "path");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "20"); s.setAttribute("height", "20");
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    p.setAttribute("d", path); s.appendChild(p);
    return s;
  }
  // 收起來的小卡列、彈卡：鍵盤走不進去、報讀軟體也讀不到
  function shut(el, closed) { if (closed) el.setAttribute("inert", ""); else el.removeAttribute("inert"); }
  // 地圖起不來（資料抓不到、瀏覽器太舊、程式出錯）：留著伺服器印好的數字，補一個「看全部在售物件」的連結，其他都收掉
  function off() {
    if (dead) return;
    dead = true;
    [].slice.call(shot.children).forEach(function (el) {
      if (!el.classList.contains("hm-hud") && el.tagName !== "NOSCRIPT") shot.removeChild(el);
    });
    if (undo) undo();
    ["is-on", "is-sat", "is-free", "is-pan", "can-pick", "has-strip", "hm-wide"].forEach(function (c) { shot.classList.remove(c); });
    var a = d.createElement("a"); a.className = "hm-all"; a.href = "/properties/"; a.textContent = "看全部在售物件";
    shot.appendChild(a);
    shot.classList.add("is-off");
  }
  // 程式出錯：畫面先退回去，錯誤照樣丟出來（看得到才修得到）
  function fail(err) { off(); setTimeout(function () { throw err; }, 0); }

  /* ════ 在售物件地圖 ════
     底圖兩種：亮底（一開始、也是接不到空拍圖時的樣子）／空拍圖（內政部國土測繪中心正射影像，推近之後再疊一層路名）。
     兩種都用同一種投影，點都畫在真實的經緯度上（只知道行政區的那幾間，在區中心附近隨機放）。 */
  function start(D) {
    if (!D || !D.d || !D.t || !D.p || !D.p.length) { off(); return; }
    var t0 = performance.now();
    var ta = d.getElementById("hero-say");
    // 數字那一塊是伺服器先印好的（沒有 JavaScript 也看得到間數）：這裡只接手，不重建
    var hud = shot.querySelector(".hm-hud"), numEl = shot.querySelector("[data-hm-n]"), labEl = shot.querySelector("[data-hm-l]");
    if (!hud || !numEl || !labEl) throw new Error("home-map: .hm-hud markup missing");
    var num0 = numEl.textContent, lab0 = labEl.textContent;
    undo = function () {   // 收掉的時候（off）：數字和說明改回伺服器印的，還在排隊的計時器全部取消
      numEl.textContent = num0; labEl.textContent = lab0;
      clearTimeout(tagT); clearTimeout(stripT); clearTimeout(tTimer);
    };
    shot.setAttribute("role", "group");
    var cv = d.createElement("canvas"); cv.setAttribute("aria-hidden", "true");
    var cvB = d.createElement("canvas"); cvB.className = "hm-tiles"; cvB.setAttribute("aria-hidden", "true");   // 空拍底圖畫在光點底下另一張畫布：鏡頭有動、或新的圖片到了才重畫。一開始就建好，接上空拍圖時由樣式淡入
    shot.insertBefore(cv, shot.firstChild); shot.insertBefore(cvB, cv);
    var tag = d.createElement("div"); tag.className = "hm-tag"; tag.setAttribute("aria-live", "polite"); shot.appendChild(tag);
    // 選了一區、或打了條件之後，圖塊底下滑出一排房子小卡；電腦版兩邊各一顆翻頁鈕
    var strip = d.createElement("div"); strip.className = "hm-strip"; shut(strip, true); shot.appendChild(strip);
    var navL = d.createElement("button"), navR = d.createElement("button");
    [[navL, "hm-nav hm-nav-l", "上一間", "M15 6l-6 6 6 6"], [navR, "hm-nav hm-nav-r", "下一間", "M9 6l6 6-6 6"]].forEach(function (o) {
      o[0].type = "button"; o[0].className = o[1]; o[0].setAttribute("aria-label", o[2]);
      o[0].appendChild(icon(o[3]));
      shot.appendChild(o[0]);
    });
    // 地圖操作鈕：放大、縮小、回到全台中（滾輪、拖曳、兩指縮放也可以）。用不到的時候是 disabled
    var zoomBox = d.createElement("div"); zoomBox.className = "hm-zoom";
    var zIn = d.createElement("button"), zOut = d.createElement("button"), zHome = d.createElement("button");
    [[zIn, "放大", "M12 5v14M5 12h14"], [zOut, "縮小", "M5 12h14"], [zHome, "回到全台中", "M4 11l8-7 8 7M6 10v9h12v-9"]].forEach(function (o) {
      o[0].type = "button"; o[0].setAttribute("aria-label", o[1]);
      o[0].appendChild(icon(o[2]));
      zoomBox.appendChild(o[0]);
    });
    zOut.disabled = zHome.disabled = true;
    shot.appendChild(zoomBox);
    // 鍵盤焦點在要收起、要停用的東西裡面：先移到一個一定按得到的鈕（「放大」永遠可以按），不然焦點會掉回頁面最上面
    function rescue(el, to) {
      if (!el || !el.contains(d.activeElement)) return;
      to = to && !to.disabled ? to : zIn;
      try { to.focus({ preventScroll: true }); } catch (x) { to.focus(); }
    }
    // 電腦：點開的那一間，卡片直接跳在那一顆旁邊
    var pop = d.createElement("div"); pop.className = "hm-pop"; shut(pop, true); shot.appendChild(pop);
    // 出處三行：第一行（影像、路名）接上空拍圖才顯示（樣式管）；第二、三行一直都在。
    // 點的位置是用市府門牌開放資料算的（建置時，見 src/utils/homeMapData.ts），照授權條款要寫提供機關
    var cr = d.createElement("p"); cr.className = "hm-credit";
    ["影像、路名：內政部國土測繪中心", "範圍線：臺中市政府地政局", "點位：臺中市政府數位發展局・空心點是大概位置"].forEach(function (s) {
      var x = d.createElement("span"); x.textContent = s; cr.appendChild(x);
    });
    shot.appendChild(cr);
    var FONT = getComputedStyle(shot).fontFamily || "sans-serif";

    // 各區大概的中心（緯度、經度）和物件散開的範圍，用區名查。只知道行政區的那幾間才用得到（位置是示意，不是門牌）
    var GEO = {
      "中區": [24.142, 120.6805, 0.0035, 0.004], "東區": [24.137, 120.699, 0.006, 0.0065], "南區": [24.121, 120.664, 0.007, 0.0075],
      "西區": [24.144, 120.665, 0.006, 0.0065], "北區": [24.159, 120.681, 0.0065, 0.007], "西屯區": [24.17, 120.641, 0.012, 0.0145],
      "南屯區": [24.14, 120.628, 0.0105, 0.0125], "北屯區": [24.183, 120.707, 0.011, 0.015], "豐原區": [24.25, 120.721, 0.009, 0.01],
      "東勢區": [24.257, 120.828, 0.008, 0.008], "大甲區": [24.348, 120.623, 0.008, 0.009], "清水區": [24.27, 120.566, 0.009, 0.009],
      "沙鹿區": [24.233, 120.567, 0.0085, 0.0085], "梧棲區": [24.254, 120.532, 0.008, 0.008], "后里區": [24.306, 120.712, 0.007, 0.007],
      "神岡區": [24.259, 120.665, 0.0075, 0.008], "潭子區": [24.211, 120.706, 0.0075, 0.008], "大雅區": [24.228, 120.648, 0.0075, 0.0085],
      "新社區": [24.232, 120.808, 0.0085, 0.0085], "石岡區": [24.274, 120.78, 0.006, 0.006], "外埔區": [24.332, 120.657, 0.0065, 0.0065],
      "大安區": [24.348, 120.587, 0.006, 0.006], "烏日區": [24.104, 120.627, 0.0085, 0.01], "大肚區": [24.152, 120.544, 0.0075, 0.0075],
      "龍井區": [24.193, 120.543, 0.008, 0.008], "霧峰區": [24.058, 120.7, 0.008, 0.008], "太平區": [24.126, 120.722, 0.009, 0.0105],
      "大里區": [24.1, 120.681, 0.0085, 0.0095], "和平區": [24.27, 120.88, 0.008, 0.008]
    };
    // 真實位置（跟網路地圖同一種投影，數值是 0–1 的世界座標）。亮底、空拍圖兩種底都用這一個，換底的時候點不會跳
    function merc(lat, lng) {
      var s = Math.sin(lat * Math.PI / 180);
      return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
    }
    var TILE = "https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}";   // 國土測繪中心正射影像（站上的地圖工具也用這一家）
    // 推近之後，空拍圖上面再疊一層路名（同一家的「臺灣通用電子地圖」透明版，第 14 層起）。
    // 路名那一層另外挑層級：一張圖在畫面上約 181–362 像素寬，字才夠大（空拍圖本身照舊用最細的，保持清楚）
    var TILE_LAB = "https://wmts.nlsc.gov.tw/wmts/EMAP2/default/GoogleMapsCompatible/{z}/{y}/{x}", MIXZ = 14;
    // 空拍圖最細只用到第 19 層：官方圖層清單寫的最大層級（第 20 層抓得到，但不在清單上、圖上有浮水印，哪天不給了推近就會整片失敗）。
    // 可以推多近照舊用第 20 層算（ZLIM），推到最近時第 19 層的圖略放大，2026-11-13 改
    var LMAX = 19, ZLIM = 20;
    // 讀句子的程式給的類型代號 → 資料裡的類型名（進來之後換成 D.t 裡的位置）
    var TYPE = { elevator_building: ["電梯大樓"], mid_rise: ["華廈"], apartment: ["公寓"], townhouse: ["透天厝", "別墅"], studio: ["套房"] };
    Object.keys(TYPE).forEach(function (k) {
      TYPE[k] = TYPE[k].map(function (nm) { return D.t.indexOf(nm); }).filter(function (i) { return i >= 0; });
    });

    // 點先畫成小圖，之後每一格只貼圖：白邊、實心芯、邊緣清楚（不要暈光），底下一點陰影跟底圖分開。halo＝符合條件時外面多一圈淡淡的底
    function pin(size, core, sh, halo) {
      var c = d.createElement("canvas"); c.width = c.height = size;
      var g2 = c.getContext("2d"), r = size / 2;
      if (halo) { g2.beginPath(); g2.arc(r, r, r * 0.5, 0, 6.2832); g2.fillStyle = halo; g2.fill(); }
      g2.shadowColor = sh; g2.shadowBlur = size * 0.05; g2.shadowOffsetY = size * 0.015;
      g2.beginPath(); g2.arc(r, r, r * 0.3, 0, 6.2832); g2.fillStyle = "#fff"; g2.fill();
      g2.shadowColor = "transparent"; g2.shadowBlur = 0; g2.shadowOffsetY = 0;
      g2.beginPath(); g2.arc(r, r, r * 0.215, 0, 6.2832); g2.fillStyle = core; g2.fill();
      return c;
    }
    // 位置只知道路段或行政區的那幾間：畫成空心的點（位置是大概）。對得到社區的才畫實心
    function hollow(size, core, sh, sat) {
      var c = d.createElement("canvas"); c.width = c.height = size;
      var g2 = c.getContext("2d"), r = size / 2;
      g2.shadowColor = sh; g2.shadowBlur = size * 0.05; g2.shadowOffsetY = size * 0.015;
      if (sat) {   // 空拍圖上：白色細圈，裡面一點淡藍
        g2.beginPath(); g2.arc(r, r, r * 0.255, 0, 6.2832); g2.lineWidth = r * 0.09; g2.strokeStyle = "#fff"; g2.stroke();
        g2.shadowColor = "transparent"; g2.shadowBlur = 0; g2.shadowOffsetY = 0;
        g2.beginPath(); g2.arc(r, r, r * 0.21, 0, 6.2832); g2.fillStyle = "rgba(10,132,255,.3)"; g2.fill();
      } else {     // 亮底上：白底、藍色細圈（白圈在亮底上看不出來）
        g2.beginPath(); g2.arc(r, r, r * 0.3, 0, 6.2832); g2.fillStyle = "#fff"; g2.fill();
        g2.shadowColor = "transparent"; g2.shadowBlur = 0; g2.shadowOffsetY = 0;
        g2.beginPath(); g2.arc(r, r, r * 0.195, 0, 6.2832); g2.lineWidth = r * 0.075; g2.strokeStyle = core; g2.stroke();
      }
      return c;
    }
    // 兩套顏色，執行中可以換：light＝亮底（深色字、站上的藍）；sat＝空拍圖（白字、亮一點的藍、黃色範圍線）。點的大小、樣子兩套一樣
    function theme(sat) {
      var core = sat ? "#0a84ff" : "#0071e3", sh = sat ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.3)";
      return {
        base: 17, hs: 1.25, idle: 1, off: 0.3, labA: 0.96,
        ring: sat ? "#fff" : core, labFg: sat ? "#fff" : "#1d1d1f", labBg: sat ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.92)",
        n: pin(160, core, sh, ""), h: pin(160, core, sh, sat ? "rgba(255,255,255,.32)" : "rgba(0,113,227,.2)"), o: hollow(160, core, sh, sat),
        zc: sat ? "#ffd60a" : core   // 重劃區範圍線和名字的顏色
      };
    }

    var names = D.d, G = [], vw = 0, vh = 0, g = null, wide = false, K = 1, ax = 0, ay = 0, aw = 0, ah = 0, tagMin = 10, labFont = "";
    var calm = isCalm();
    var P = D.p.map(function (row, i) {
      var geo = GEO[names[row[0]]] || GEO["中區"], r = rnd(i * 7919 + row[0] * 101 + 17);
      var m = Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))), an = 6.2832 * r();
      var n1 = Math.max(-2.1, Math.min(2.1, m * Math.cos(an))), n2 = Math.max(-2.1, Math.min(2.1, m * Math.sin(an)));
      // 位置準度 row[7]：2＝社區位置、1＝路段的大概位置（都用真的經緯度）；0＝只知道行政區，在區中心附近隨機放（示意）
      var lat = row[7] ? row[5] : geo[0] + n1 * geo[2], lng = row[7] ? row[6] : geo[1] + n2 * geo[3];
      var w = merc(lat, lng), ph = r() * 6.2832;
      r();   // 樣稿在這裡多抽過一個數（亮底版閃爍用，已拿掉）；照抽一次，後面每一顆的大小、進場順序才跟樣稿一樣
      // row[8]：落在哪幾塊重劃區（位元；建置時用排開之前的位置算好，排開後的點可能剛好滑進範圍線）。沒有這一欄才自己算
      var p = { wx: w[0], wy: w[1], lat: lat, lng: lng, pr: row[7] || 0, zi: null, zm: typeof row[8] === "number" ? row[8] : -1, di: row[0], price: row[1], rooms: row[2], ti: row[3], nw: row[4], ph: ph, sz: r(), br: 0, hl: 0, m: true, dl: r() * 0.9, bx: 0, by: 0, sx: 0, sy: 0, a: 0, s: 0 };
      p.d0 = p.dl; p.ia = r() * 6.2832; p.id = 60 + r() * 200;   // 一開始從散開的位置飛進來
      return p;
    });
    var cam = { x: 0, y: 0, z: 1 }, tcam = { x: 0, y: 0, z: 1 };
    var filter = null, fkey = "", tF = -1, tI = -1, focus = null, tagW = 0, tagT = 0, shown = 0, target = P.length, lastN = -1, NE = null;
    var hold = false;   // 使用者自己動過地圖（縮放、拖曳、點開）：輸入框的自動示範就不再換畫面
    var using = false;  // 客人在用小卡列（按下、手指滑、鍵盤走進來）：示範先不換畫面，等按「回到全台中」或自己打字
    var hov = -1, camK = 4, ZMAX = 12, dragged = false, lastPT = "mouse", homeOn = false, outOff = true, freeOn = false;   // hov：滑鼠正指著的那一顆；camK：鏡頭跟上的速度（自動 4、手動 14）
    var hudBox = [0, 0, 0, 0], hudDirty = true, tagX = 0, tagY = 0, crW = 0, crH = 0, zb = null;
    var run = null, on1 = false, act = false, pk = 0;   // act：上一格除了「新上架那一圈光」以外還有沒有東西在動；pk：那一圈光動的程度（有東西在動時 1＝一圈一圈散開，靜下來就收成 0＝固定的一圈，畫面才停得下來）
    var pal = "", sat = false, TH = null, THS = {};
    var n0 = parseInt(num0, 10);
    if (!isNaN(n0)) { shown = n0; lastN = n0; }   // 數字從伺服器印好的那個開始（不從 0 重數一次）
    // 要重畫的時候叫它（有人動了地圖、條件變了、圖片或資料到了、換了底色）：迴圈停著就叫起來；順便重讀安靜模式
    function kick() { calm = isCalm(); if (run) run(); }
    function setPalette(name) {
      if (dead || name === pal) return;
      pal = name; sat = name === "sat";
      TH = THS[name] || (THS[name] = theme(sat));
      shot.classList.toggle("is-sat", sat);
      hudDirty = true; bgDirty = true;   // 出處多一行或少一行、數字那一塊換顏色：重量一次
      kick();
    }
    // 數字那一塊的位置（數字、說明都填上之後才量得準）：區名不畫在它上面
    function measureHud() {
      var hr = hud.getBoundingClientRect(), sr = shot.getBoundingClientRect(), hk = vw / (sr.width || vw), hx0 = (hr.left - sr.left) * hk;
      hudBox = [hx0 - 10, (hr.top - sr.top) * hk - 8, Math.max((hr.right - sr.left) * hk, hx0 + 150) + 14, (hr.bottom - sr.top) * hk + 10];
      hudDirty = false;
      crW = cr.offsetWidth; crH = cr.offsetHeight;   // 右下角出處的寬高（亮底一行、空拍圖兩行）：地名不畫在它上面
      var zr = zoomBox.getBoundingClientRect();   // 右邊三顆鈕：區名、重劃區名不畫在它底下
      zb = zr.width ? [(zr.left - sr.left) * hk - 6, (zr.top - sr.top) * hk - 6, (zr.right - sr.left) * hk + 6, (zr.bottom - sr.top) * hk + 6] : null;
    }
    function labOff(c, z) { return Math.min(c.r * z, 34 * K) * 0.9 + 11; }   // 區名放在那一區光點的上緣

    // ── 空拍底圖 ──
    var gB = null, tiles = {}, nTiles = 0, drawN = 0, bgDirty = true, lastCam = [0, 0, 0], sc0 = 1, ox0 = 0, oy0 = 0, zBase = 11;
    function evict() {   // 逛了很多地方之後：把很久沒畫到的細圖丟掉（墊底那一層留著）
      Object.keys(tiles).forEach(function (k) { var t = tiles[k]; if ((t.lab || t.z !== zBase) && t.used < drawN - 40) { t.img.onload = t.img.onerror = null; delete tiles[k]; nTiles--; } });
    }
    // 這個放大倍率要用哪一層圖片：一張圖片（256 點）在畫面上不超過它本來的解析度，才不會糊
    function zFor(zz) { return Math.max(9, Math.min(LMAX, Math.ceil(Math.log(sc0 * zz * Math.min(DPR, 1.5) / 256) / Math.LN2 - 0.2))); }
    function labZ(zz) { return Math.min(19, Math.round(Math.log(sc0 * zz / 256) / Math.LN2)); }   // 路名那一層用第幾層
    function loadTile(t) {
      var im = new Image();
      t.img = im; t.busy = true;
      im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer"; im.decoding = "async";   // 一定要寫在 src 前面：圖片請求不帶來源網址、不帶也不存對方的 cookie（跟站上找房地圖一樣）
      im.onload = function () { t.busy = false; t.ok = true; tileDone(t, true); };
      im.onerror = function () { t.busy = false; t.bad++; t.at = performance.now(); tileDone(t, false); };
      im.src = t.src;
    }
    function getTile(zz, x, y, lab) {
      var k = (lab ? "L" : "") + zz + "/" + x + "/" + y, t = tiles[k];
      if (!t) {
        if (nTiles > 520) evict();
        t = tiles[k] = { img: null, src: (lab ? TILE_LAB : TILE).replace("{z}", zz).replace("{y}", y).replace("{x}", x), ok: false, busy: false, bad: 0, at: 0, used: drawN, z: zz, lab: !!lab }; nTiles++;
        loadTile(t);
      } else if (!t.ok && !t.busy && t.bad === 1 && performance.now() - t.at >= 4000) loadTile(t);   // 失敗過一次的：隔 4 秒、畫面上還用得到，才再要一次（只再試這一次）
      return t;
    }
    // 列出某個鏡頭下、畫面裡看得到的圖片格子
    function eachTile(zz, c, fn) {
      var n = Math.pow(2, zz), ts = sc0 / n;
      var x0 = Math.floor(((0 - ax) / c.z + c.x - ox0) / ts), x1 = Math.floor(((vw - ax) / c.z + c.x - ox0) / ts);
      var y0 = Math.floor(((0 - ay) / c.z + c.y - oy0) / ts), y1 = Math.floor(((vh - ay) / c.z + c.y - oy0) / ts), x, y;
      for (y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) for (x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) fn(x, y, x * ts + ox0, y * ts + oy0, ts);
    }
    function drawTiles() {
      var zt = zFor(tcam.z), zc = zFor(cam.z), top = zt >= zc ? Math.min(zt, zc + 1) : zc, lv = [], zz;
      if (tState === "try" && !tT0) { tT0 = performance.now(); clearTimeout(tTimer); tTimer = setTimeout(tilesCheck, 6000); }   // 這一輪第一次真的發出請求：6 秒、8 秒從這裡起算（地圖不在畫面上時不會發，也就不會被當成「接不到」）
      for (zz = zBase; zz <= top; zz++) lv.push(zz);
      drawN++;
      eachTile(zt, tcam, function (x, y) { getTile(zt, x, y).used = drawN; });   // 鏡頭要去的地方先開始載
      gB.clearRect(0, 0, vw, vh);
      lv.forEach(function (zz) {   // 由粗到細一層一層蓋上去：細的還沒載到，就先看得到粗的
        eachTile(zz, cam, function (x, y, bx, by, ts) {
          // 墊底那一層缺了就載；更細的那一層只畫已經載好的（要載哪些，上面照「鏡頭要去的地方」決定，不然推近途中會把整片都載下來）
          var t = zz === zBase ? getTile(zz, x, y) : tiles[zz + "/" + x + "/" + y]; if (!t || !t.ok) return;
          t.used = drawN;
          // 邊界對齊實體像素，相鄰兩張之間才不會有細縫
          var X0 = Math.round(((bx - cam.x) * cam.z + ax) * DPR) / DPR, Y0 = Math.round(((by - cam.y) * cam.z + ay) * DPR) / DPR;
          var X1 = Math.round(((bx + ts - cam.x) * cam.z + ax) * DPR) / DPR, Y1 = Math.round(((by + ts - cam.y) * cam.z + ay) * DPR) / DPR;
          gB.drawImage(t.img, X0, Y0, X1 - X0, Y1 - Y0);
        });
      });
      var zl = labZ(cam.z), zlt = labZ(tcam.z);   // 路名：鏡頭要去的地方先載，畫面上只貼已經載好的
      if (zlt >= MIXZ) eachTile(zlt, tcam, function (x, y) { getTile(zlt, x, y, true).used = drawN; });
      if (zl >= MIXZ) eachTile(zl, cam, function (x, y, bx, by, ts) {
        var t = tiles["L" + zl + "/" + x + "/" + y]; if (!t || !t.ok) return;
        t.used = drawN;
        var X0 = Math.round(((bx - cam.x) * cam.z + ax) * DPR) / DPR, Y0 = Math.round(((by - cam.y) * cam.z + ay) * DPR) / DPR;
        var X1 = Math.round(((bx + ts - cam.x) * cam.z + ax) * DPR) / DPR, Y1 = Math.round(((by + ts - cam.y) * cam.z + ay) * DPR) / DPR;
        gB.drawImage(t.img, X0, Y0, X1 - X0, Y1 - Y0);
      });
      bgDirty = false; lastCam = [cam.x, cam.y, cam.z];
    }

    // ── 空拍圖什麼時候接、什麼時候放棄 ──
    // tState：wait＝還沒開始；try＝在載，畫面還是亮底；sat＝接上了；off＝接不到，停在亮底、不再發請求
    var tState = "wait", tT0 = 0, tGot = 0, tBad = 0, tLog = [], tOnce = true, tEver = false, tBack = 0, tTimer = 0, tilesOk = 0, tilesErr = 0;
    function baseStat() {   // 目前畫面要用到的墊底圖：共幾張、載好幾張、還有幾張沒結果
      var n = 0, ok = 0, left = 0;
      eachTile(zBase, cam, function (x, y) {
        var t = tiles[zBase + "/" + x + "/" + y]; n++;
        if (t && t.ok) ok++; else if (!t || t.busy || t.bad < 2) left++;
      });
      return [n, ok, left];
    }
    function tilesGo() {   // 開始接（或重新接）
      if (dead || tState === "try" || tState === "sat") return;
      Object.keys(tiles).forEach(function (k) { var t = tiles[k]; if (!t.ok) { t.img.onload = t.img.onerror = null; delete tiles[k]; nTiles--; } });   // 上一輪沒載到的，這一輪重新要
      tState = "try"; tT0 = 0; tGot = 0; tBad = 0; tLog = [];
      clearTimeout(tTimer);
      bgDirty = true; kick();   // 下一格 drawTiles 才真的發請求、開始計時
    }
    function tilesStop() {   // 接不上：停在亮底（已經換成空拍圖的就換回來），不再發請求
      clearTimeout(tTimer);
      if (tState === "sat") { tEver = true; setPalette("light"); }
      if (tEver) tBack = performance.now();
      tState = "off";
    }
    function tilesCheck() {
      if (dead || tState !== "try" || !tT0) return;
      var el = performance.now() - tT0, s = baseStat();
      // 畫面上的墊底圖全到了就換；滿 6 秒之後，到了九成也換
      if (s[0] && (s[1] === s[0] || (el >= 6000 && s[1] >= s[0] * 0.9))) { clearTimeout(tTimer); tState = "sat"; setPalette("sat"); return; }
      // 8 秒了一張都沒到、第一張成功之前就失敗 8 張、或 8 秒後該有結果的都有了卻不到九成：放棄
      if ((!tGot && (el >= 8000 || tBad >= 8)) || (el >= 8000 && !s[2])) { tilesStop(); return; }
      clearTimeout(tTimer);
      if (el < 8000) tTimer = setTimeout(tilesCheck, (el < 6000 ? 6000 : 8000) - el + 20);
    }
    function tileDone(t, ok) {
      if (dead) return;
      if (ok) tilesOk++; else tilesErr++;
      if (!t.lab) {   // 「接不接得上」只看空拍圖那一層（路名那一層不算）
        tLog.push(ok ? 1 : 0); if (tLog.length > 20) tLog.shift();
        if (ok) tGot++; else if (!tGot) tBad++;
      }
      if (ok) { bgDirty = true; kick(); }
      else if (t.bad < 2) setTimeout(function () { if (tState === "try" || tState === "sat") { bgDirty = true; kick(); } }, 4100);   // 4 秒後重畫一次：那一格還在畫面上的話，getTile 會再要一次
      if (tState === "try") tilesCheck();
      else if (tState === "sat" && !ok && !t.lab && tLog.length - tLog.reduce(function (a, b) { return a + b; }, 0) >= 12) tilesStop();   // 接上之後又連不上（最近 20 張空拍圖有 12 張失敗）：退回亮底
    }
    function tilesArm() {   // 第一格亮底畫出來之後才排：網頁載完、或地圖起來滿 1.5 秒，看哪個先到
      if (saveData) return;   // 省流量模式不自動連外：等使用者自己動地圖（poke）
      var go = function () { if (tState === "wait") tilesGo(); };
      if (d.readyState === "complete") go();
      else { W.addEventListener("load", go); setTimeout(go, Math.max(0, 1500 - (performance.now() - t0))); }
    }
    // 使用者動了地圖（move＝縮放或拖動）：還沒開始接的現在開始；一開始沒接上的，第一次縮放或拖動再試一次（只一次）；
    // 接上之後才斷的，隔 30 秒以上再試
    function poke(move) {
      if (tState === "wait") tilesGo();
      else if (tState === "off") {
        if (tEver) { if (performance.now() - tBack >= 30000) tilesGo(); }
        else if (move && tOnce) { tOnce = false; tilesGo(); }
      }
    }

    // ── 選到的房子：圖塊底下一排小卡（照片、總價、格局），可以左右滑；點卡片進那間的物件頁（同一個分頁） ──
    var sel = -1, selT = 0, list = [], CARDS = null, cardsReq = false, cardWait = [], progT = 0, stripKey = "", stripT = 0, PADL = 12, MAXC = 40;
    var popOn = false, popAX = -1, popUp = true, popAway = null, PW = 300, PH = 96;
    function money(w) { return w >= 10000 ? (Math.round(w / 100) / 100) + " 億" : w.toLocaleString("en-US") + " 萬"; }
    function card(i) {
      var p = P[i], c = CARDS[i] || [], a = d.createElement("a"), tx = d.createElement("span"), b = d.createElement("b"), s1 = d.createElement("span"), s2 = d.createElement("span");
      a.className = "hm-card"; a.href = c[0] ? "/properties/" + c[0] + "/" : "/properties/"; a.draggable = false; a.setAttribute("data-i", i);
      // 跟站上其他物件卡同一套點擊統計（全站的統計程式認 data-track="property"）
      if (c[0]) { a.setAttribute("data-track", "property"); a.setAttribute("data-property-id", c[0]); a.setAttribute("data-property-price", p.price); a.setAttribute("data-property-district", names[p.di]); }
      if (c[3]) {
        var im = new Image(); im.alt = ""; im.loading = "lazy"; im.decoding = "async"; im.width = 76; im.height = 76; im.draggable = false;
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
        im.src = c[3]; a.appendChild(im);   // 站上現成的物件卡縮圖（網址由建置時給）
      }
      b.textContent = money(p.price);
      s1.textContent = [p.rooms ? p.rooms + " 房" : "", c[1] ? c[1] + " 坪" : "", D.t[p.ti] && D.t[p.ti] !== "其他" ? D.t[p.ti] : ""].filter(Boolean).join("・");
      s2.textContent = names[p.di] + (c[2] ? "・" + c[2] : "");
      tx.className = "hm-ct"; tx.appendChild(b); tx.appendChild(s1); tx.appendChild(s2); a.appendChild(tx);
      return a;
    }
    // 電腦版的翻頁鈕：已經在最左（最右）就收起來
    function navState() {
      var l = strip.scrollLeft < 8, r = strip.scrollLeft > strip.scrollWidth - strip.clientWidth - 8;
      if (l) rescue(navL, navR);
      if (r) rescue(navR, navL);
      navL.disabled = l; navR.disabled = r;
    }
    function mark() { [].forEach.call(strip.children, function (el) { el.classList.toggle("is-sel", el.hasAttribute("data-i") && +el.getAttribute("data-i") === sel); }); }
    function needCards(fn) {   // 房子的社區名、坪數、照片網址：第一次要用到才抓（平常閒下來會先抓好）
      if (CARDS) return fn();
      cardWait.push(fn);
      if (cardsReq) return;
      cardsReq = true;
      getJSON(shot.dataset.cards, function (j) {
        if (dead) return;
        // 抓到的跟點的資料不是同一次建置（筆數或物件清單對不上，例如剛好換版）：這次不出小卡，下次要用再抓。寧可不出，也不要價錢配到別間的照片
        if (!j || !j.c || j.c.length !== P.length || j.k !== D.k) { cardsReq = false; cardWait.length = 0; return; }
        CARDS = j.c; cardWait.splice(0).forEach(function (f) { f(); });
        kick();   // 資料晚到（迴圈可能已經停了）：卡片的位置、選中框要靠下一格畫好
      }, function () { cardsReq = false; cardWait.length = 0; });
    }
    function buildStrip() {
      var single = !filter && sel >= 0 && !wide;   // 手機：沒有條件時點開一顆，底下只放那一間
      if (!filter && !single) {
        rescue(strip); strip.classList.remove("on"); shut(strip, true);
        if (shot.classList.contains("has-strip")) { shot.classList.remove("has-strip"); hudDirty = true; kick(); }   // 出處、右邊三顆鈕的位置變了：區名的避讓要重量
        stripKey = ""; list = []; return;
      }
      if (!CARDS) { needCards(buildStrip); return; }
      var key = filter ? "f" + fkey : "s" + sel;
      if (stripKey !== key) {
        stripKey = key; list = [];
        if (single) list = [sel];
        else {
          P.forEach(function (p, i) { if (p.m) list.push(i); });
          list.sort(function (a, b) { return (P[b].nw - P[a].nw) || (P[a].price - P[b].price); });   // 新上架的排前面，再來由便宜到貴
          if (list.length > MAXC) {   // 太多就先放前 40 張；剛剛點的那一間如果排在後面，就放到最前面
            var pos = sel >= 0 ? list.indexOf(sel) : -1;
            list = pos >= MAXC ? [sel].concat(list.slice(0, MAXC - 1)) : list.slice(0, MAXC);
          }
        }
        rescue(strip); strip.textContent = "";
        list.forEach(function (i) { strip.appendChild(card(i)); });
        // 最後一張：看全部。只有一個區、而且那一區有物件，就連到那一區的列表頁（有分區頁用分區頁，沒有就帶區名去總列表）
        var di = single ? P[sel].di : filter.ds.length === 1 ? filter.ds[0] : -1, one = di >= 0 && G[di] ? names[di] : "", more = d.createElement("a");
        more.className = "hm-card hm-more"; more.draggable = false;
        more.href = "/properties/" + (one ? (D.s && D.s[di] ? D.s[di] + "/" : "?district=" + encodeURIComponent(one)) : "");
        // 沒有指定單一區：連到總列表（那一頁連外縣市一起列），所以不寫間數，免得跟點進去看到的對不上
        more.textContent = one ? "看" + one + "全部 " + G[di].n + " 間" : "看全部在售物件";
        if (!filter || !filter.zs.length) strip.appendChild(more);   // 打的是七期這種區塊：沒有對應的列表頁，就不放「看全部」
        if (!single && (sel < 0 || list.indexOf(sel) < 0)) sel = list.length ? list[0] : -1;
        selT = performance.now() / 1000;
        var el = sel >= 0 && strip.querySelector('[data-i="' + sel + '"]');
        progT = performance.now(); strip.scrollLeft = el ? el.offsetLeft - PADL : 0;
        mark();
      }
      strip.classList.add("on"); shut(strip, false);
      if (!shot.classList.contains("has-strip")) { shot.classList.add("has-strip"); hudDirty = true; kick(); }
      navState();
    }
    // 電腦、沒有條件時：點開的那一間，卡片直接跳在那一顆旁邊（位置每一格跟著那一顆算，見 frame 最後面）
    function renderPop() {
      var on = wide && !filter && sel >= 0;
      if (on && !CARDS) { needCards(renderPop); on = false; }
      rescue(pop);
      if (on) { pop.textContent = ""; pop.appendChild(card(sel)); }
      popOn = on; popAway = null; pop.classList.toggle("on", on); shut(pop, !on);
    }
    // 點開的那一顆要看得到：太靠邊、或會被卡片擋住，就把地圖挪一下（還在全台中的大小就順便推近一點）
    function reveal(i) {
      var p = P[i], z2 = tcam.z, x0 = 44, x1 = vw - 44, y0 = wide ? 124 : 150, y1 = vh - (wide ? 44 : 134);
      var sx = (p.bx - tcam.x) * z2 + ax, sy = (p.by - tcam.y) * z2 + ay;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return;
      if (z2 < 1.6) z2 = 1.6;
      tcam = clampCam({ x: p.bx - (Math.max(x0, Math.min(x1, sx)) - ax) / z2, y: p.by - (Math.max(y0, Math.min(y1, sy)) - ay) / z2, z: z2 });
      camK = 6;
    }
    function pick(i) {
      sel = i; selT = performance.now() / 1000;
      if (filter) {
        if (i >= 0 && list.indexOf(i) < 0) { stripKey = ""; buildStrip(); }   // 符合的太多、小卡只放了前 40 張：點到的那一間不在裡面，就重排一次，把它放第一張
        mark();
        var el = i >= 0 && strip.querySelector('[data-i="' + i + '"]');
        if (el) { progT = performance.now(); strip.scrollTo({ left: el.offsetLeft - PADL, behavior: calm ? "auto" : "smooth" }); }
      } else { if (i >= 0) reveal(i); buildStrip(); renderPop(); }
      kick();
    }

    // ── 重劃區、單元（七期、十四期、單元二…）：地政局官方範圍。推近到看得出大小時畫出範圍線和名字；打字提到也認得 ──
    var ZN = null, zonesReq = false, zoneWait = [];
    function inRing(r, lat, lng) {
      var o = false, i, j = r.length - 1;
      for (i = 0; i < r.length; j = i++) if ((r[i][0] > lat) !== (r[j][0] > lat) && lng < (r[j][1] - r[i][1]) * (lat - r[i][0]) / (r[j][0] - r[i][0]) + r[i][1]) o = !o;
      return o;
    }
    function projZones() {   // 範圍線換成畫面座標（版面一變就重算）
      if (!ZN) return;
      g.font = labFont;
      ZN.forEach(function (z) {
        var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, sx = 0, sy = 0, n = 0;
        z.rings = z.ll.map(function (r) {
          return r.map(function (q) {
            var w = merc(q[0], q[1]), bx = w[0] * sc0 + ox0, by = w[1] * sc0 + oy0;
            x0 = Math.min(x0, bx); x1 = Math.max(x1, bx); y0 = Math.min(y0, by); y1 = Math.max(y1, by); sx += bx; sy += by; n++;
            return [bx, by];
          });
        });
        z.cx = sx / n; z.cy = sy / n; z.bx = (x0 + x1) / 2; z.by = (y0 + y1) / 2; z.bw = x1 - x0; z.bh = y1 - y0; z.lw = g.measureText(z.n).width;
      });
    }
    function needZones(fn) {
      if (ZN) return fn();
      zoneWait.push(fn);
      if (zonesReq) return;
      zonesReq = true;
      getJSON(shot.dataset.zones, function (j) {
        if (dead) return;
        if (!j || !j.z) { zonesReq = false; zoneWait.length = 0; return; }
        // oi＝在範圍檔裡原本是第幾塊（點資料的第 9 欄照原檔順序記）
        ZN = j.z.map(function (z, i) { return z && z.n && z.r && z.r.length ? { n: z.n, al: z.a || [], ll: z.r, oi: i, rings: [], cx: 0, cy: 0, bx: 0, by: 0, bw: 0, bh: 0, a: 0, lw: 0 } : null; })
          .filter(Boolean);
        P.forEach(function (p) {   // 每一間落在哪幾塊裡（只算有社區或路段位置的）
          if (!p.pr) return;
          ZN.forEach(function (z, k) {
            var hit;
            if (p.zm >= 0) hit = z.oi < 31 && (p.zm & (1 << z.oi)) !== 0;
            else {   // 舊資料沒有第 9 欄：用畫面上的位置算（奇偶規則：被奇數圈包住才算，有的圈是洞）
              var n = 0;
              z.ll.forEach(function (r) { if (inRing(r, p.lat, p.lng)) n++; });
              hit = n % 2 === 1;
            }
            if (hit) (p.zi = p.zi || []).push(k);
          });
        });
        projZones();
        zoneWait.splice(0).forEach(function (f) { f(); });
        kick();
      }, function () { zonesReq = false; zoneWait.length = 0; });
    }
    // 一句話裡提到哪幾塊（比較長的叫法先比；「學期」「分期」「第二期」這種不算）
    function zoneHits(text) {
      var out = [], used = [], all = [];
      if (!ZN || !text) return out;
      ZN.forEach(function (z, k) { z.al.forEach(function (al) { all.push([al, k]); }); });
      all.sort(function (a, b) { return b[0].length - a[0].length; });
      all.forEach(function (o) {
        var al = o[0], from = 0, i, j, ok;
        if (!al) return;
        while ((i = text.indexOf(al, from)) >= 0) {
          from = i + al.length; ok = true;
          for (j = i; j < from; j++) if (used[j]) ok = false;
          if (ok && /期$|單元/.test(al)) {
            if (i > 0 && /[學預分頭第0-9一二三四五六七八九十]/.test(text.charAt(i - 1))) ok = false;
            if (/^(間|限|貨|望|初|末|款|數|工|付|繳)/.test(text.slice(from))) ok = false;
          }
          if (!ok) continue;
          for (j = i; j < from; j++) used[j] = true;
          if (out.indexOf(o[1]) < 0) out.push(o[1]);
        }
      });
      return out;
    }

    function layout() {
      // 客人自己推近過：換版面（手機轉向、改視窗大小）之後回到同一個地方、同一個比例，不要跳回全台中
      var keep = hold ? { wx: (tcam.x - ox0) / sc0, wy: (tcam.y - oy0) / sc0, gs: tcam.z * sc0 } : null;
      DPR = Math.min(W.devicePixelRatio || 1, 2);   // 瀏覽器縮放、換到另一個螢幕：畫布的解析度跟著換
      vw = shot.offsetWidth; vh = shot.offsetHeight; g = fit(cv, vw, vh);
      gB = fit(cvB, vw, vh); bgDirty = true;
      wide = vw > vh * 1.2;
      shot.classList.toggle("hm-wide", wide);
      // 寬版（電腦）：左邊三分之一留給大數字，光點排在右邊；直版（手機）：數字在上、光點在下
      var pt = wide ? 44 : 126, pb = wide ? 40 : 34, pl = wide ? Math.round(vw * 0.34) : 24, pr = wide ? Math.round(vw * 0.05) : 24;
      aw = vw - pl - pr; ah = vh - pt - pb; ax = pl + aw / 2; ay = pt + ah / 2; tagMin = wide ? Math.round(pl * 0.8) : 10;
      K = Math.max(0.85, Math.min(1.5, ah / 300));   // 光點大小跟著圖塊大小走：手機約 1、電腦 1.5、視窗縮小時 0.85
      var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      P.forEach(function (p) { x0 = Math.min(x0, p.wx); x1 = Math.max(x1, p.wx); y0 = Math.min(y0, p.wy); y1 = Math.max(y1, p.wy); });
      var sc = Math.min(aw / Math.max(x1 - x0, 2e-4), ah / Math.max(y1 - y0, 2e-4));   // 只有一兩間的時候範圍會是 0：最少當成 8 公里寬來排
      var ox = pl + (aw - (x1 - x0) * sc) / 2 - x0 * sc, oy = pt + (ah - (y1 - y0) * sc) / 2 - y0 * sc;
      P.forEach(function (p) { p.bx = p.wx * sc + ox; p.by = p.wy * sc + oy; });
      sc0 = sc; ox0 = ox; oy0 = oy; zBase = zFor(1);
      ZMAX = Math.max(12, 256 * Math.pow(2, ZLIM - 1) / sc0);   // 最多推到一個像素約 0.3 公尺（看得清楚一棟一棟）；亮底、空拍圖一樣
      G = names.map(function (nm, di) {
        var n = 0, cx = 0, cy = 0, rr = 0;
        P.forEach(function (p) { if (p.di === di) { n++; cx += p.bx; cy += p.by; } });
        if (!n) return null;
        cx /= n; cy /= n;
        P.forEach(function (p) { if (p.di === di) rr = Math.max(rr, Math.sqrt((p.bx - cx) * (p.bx - cx) + (p.by - cy) * (p.by - cy))); });
        return { name: nm, n: n, cx: cx, cy: cy, r: Math.max(12, rr), la: 0, lw: 0, lz: 1 };
      });
      // 區名：物件多的區先放；會跟別的區名疊到的、物件太少的先不放，等鏡頭推近、拉開了再出現
      var fs = wide && vh >= 420 ? 16 : 14, lh = fs + 6, placed = [], few = wide ? 5 : 6;
      labFont = "600 " + fs + "px " + FONT; g.font = labFont;
      G.map(function (c, i) { return c ? i : -1; }).filter(function (i) { return i >= 0; })
        .sort(function (a, b) { return G[b].n - G[a].n; })
        .forEach(function (i) {
          var c = G[i], zz, ok; c.lw = g.measureText(c.name).width; c.lz = 99;
          for (zz = c.n < few ? 1.6 : 1; zz <= 3.25; zz += 0.1) {
            ok = placed.every(function (j) {
              var o = G[j]; if (o.lz > zz) return true;
              return Math.abs(c.cx - o.cx) * zz >= (c.lw + o.lw) / 2 + 8 || Math.abs((c.cy - o.cy) * zz - (labOff(c, zz) - labOff(o, zz))) >= lh + 2;
            });
            if (ok) { c.lz = zz; break; }
          }
          placed.push(i);
        });
      hudDirty = true;
      projZones();
      aim(true);
      if (keep) { tcam = clampCam({ x: keep.wx * sc0 + ox0, y: keep.wy * sc0 + oy0, z: keep.gs / sc0 }); cam.x = tcam.x; cam.y = tcam.y; cam.z = tcam.z; }
      if (CARDS) { stripKey = ""; buildStrip(); renderPop(); }   // 版面換了（轉向、改視窗大小）：卡片照新的版面重排
    }
    // 鏡頭：有指定區就推過去，沒有就回到全台中
    function aim(snap) {
      focus = null;
      if (filter && filter.zs.length && ZN) {
        var zc = filter.zs.map(function (k) { return ZN[k]; }), zx = 0, zy = 0, zr = 0;
        zc.forEach(function (c) { zx += c.bx; zy += c.by; }); zx /= zc.length; zy /= zc.length;
        zc.forEach(function (c) { zr = Math.max(zr, Math.sqrt((c.bx - zx) * (c.bx - zx) + (c.by - zy) * (c.by - zy)) + Math.max(c.bw, c.bh) * 0.6); });
        focus = { cx: zx, cy: zy, r: Math.max(6, zr), zn: true, text: zc.map(function (c) { return c.n; }).join("・") };
      } else if (filter && filter.ds.length) {
        var cs = filter.ds.map(function (i) { return G[i]; }).filter(Boolean);
        if (cs.length) {
          var cx = 0, cy = 0, rad = 0;
          cs.forEach(function (c) { cx += c.cx; cy += c.cy; }); cx /= cs.length; cy /= cs.length;
          cs.forEach(function (c) { rad = Math.max(rad, Math.sqrt((c.cx - cx) * (c.cx - cx) + (c.cy - cy) * (c.cy - cy)) + c.r); });
          focus = { cx: cx, cy: cy, r: rad, text: cs.map(function (c) { return c.name; }).join("・") };
        }
      }
      clearTimeout(tagT);
      if (focus) {
        var z = Math.max(1.35, Math.min(focus.zn ? 16 : 3.2, 0.36 * Math.min(aw, ah) / focus.r));
        tcam = clampCam({ x: focus.cx, y: focus.cy - 26 / z + (wide ? 44 : 56) / z, z: z });   // 底下會滑出一排小卡，那一區往上讓一點
        if (tag.textContent !== focus.text) tag.textContent = focus.text;
        tagW = tag.offsetWidth; tag.classList.add("on");
      } else {
        tcam = { x: ax, y: ay, z: 1 };
        tag.classList.remove("on");
        tagT = setTimeout(function () { if (!focus) tag.textContent = ""; }, 400);   // 淡出之後把字清掉（報讀軟體才不會讀到上一次的地名）
      }
      camK = 4;
      if (snap) { cam.x = tcam.x; cam.y = tcam.y; cam.z = tcam.z; }
    }
    // 鏡頭不超出一開始那張全台中的範圍；最多放大到 ZMAX 倍
    function clampCam(c) {
      c.z = Math.max(1, Math.min(ZMAX, c.z));
      c.x = Math.max(ax / c.z, Math.min(vw - (vw - ax) / c.z, c.x));
      c.y = Math.max(ay / c.z, Math.min(vh - (vh - ay) / c.z, c.y));
      return c;
    }
    // 以畫面上某一點為中心放大縮小（那一點底下的地方不會跑掉）
    function zoomAt(px, py, nz) {
      nz = Math.max(1, Math.min(ZMAX, nz));
      var bx = (px - ax) / tcam.z + tcam.x, by = (py - ay) / tcam.z + tcam.y;
      tcam = clampCam({ x: bx - (px - ax) / nz, y: by - (py - ay) / nz, z: nz });
      camK = 14; kick();
    }
    // 使用者接手：自動示範帶出來的條件先收掉（鏡頭留在原地），之後不再自己換畫面
    function takeOver() {
      if (hold) return;
      hold = true;
      if (filter && !(ta && ta.value)) { var keep = { x: tcam.x, y: tcam.y, z: tcam.z }; setFilter(null); tcam = keep; camK = 14; }
    }
    function goHome() {
      hold = false; using = false; pick(-1);
      if (filter && ta && ta.value) aim(false); else { fkey = "?"; setFilter(null); }
      kick();
    }
    function match(p, f) {
      return (!f.ds.length || f.ds.indexOf(p.di) >= 0) && (!f.ts.length || f.ts.indexOf(p.ti) >= 0) &&
        (f.rmin == null || (p.rooms >= f.rmin && (f.rmax == null || p.rooms <= f.rmax))) &&
        (f.pmax == null || p.price <= f.pmax) && (f.pmin == null || p.price >= f.pmin) &&
        (!f.zs.length || !!(p.zi && f.zs.some(function (k) { return p.zi.indexOf(k) >= 0; })));   // 有點名七期這種區塊：要落在範圍線裡面
    }
    function setFilter(f) {
      var key = f ? JSON.stringify(f) : "";
      if (key === fkey) return;
      fkey = key; filter = f; tF = performance.now() / 1000;
      aim(false);
      var n = 0;
      P.forEach(function (p) {
        p.m = !f || match(p, f); if (p.m) n++;
        p.dl = focus ? Math.min(0.45, Math.sqrt((p.bx - focus.cx) * (p.bx - focus.cx) + (p.by - focus.cy) * (p.by - focus.cy)) / vw * 0.6) : Math.random() * 0.14;
      });
      target = f ? n : P.length;
      var only = f && (f.ds.length || f.zs.length) && !f.ts.length && f.rmin == null && f.pmax == null && f.pmin == null;
      labEl.textContent = !f ? "間台中在售" : only ? "間在售" : "間符合";
      if (sel >= 0 && (!f || !P[sel].m)) sel = -1;
      renderPop();
      clearTimeout(stripT);   // 小卡等地圖推到位再滑出來；連續打字時只在停下來之後排一次
      if (f && !calm) { strip.classList.remove("on"); shut(strip, true); stripT = setTimeout(buildStrip, 650); } else buildStrip();
      kick();
    }
    // 把一句話讀成條件（房數、預算、類型、行政區用站上現成的 need-extract.js；七期、十四期這種區塊自己比對叫法）
    function parse(text) {
      if (!NE || !text) return null;
      var x = NE.extract(text).fields || {}, f = { ds: [], ts: [], zs: [], rmin: null, rmax: null, pmin: null, pmax: null }, any = false;
      (x.districts || []).forEach(function (nm) { var i = names.indexOf(nm); if (i >= 0) { f.ds.push(i); any = true; } });
      (x.types || []).forEach(function (k) { if (TYPE[k] && TYPE[k].length) { f.ts = f.ts.concat(TYPE[k]); any = true; } });
      if (x.rooms_min != null) { f.rmin = x.rooms_min; f.rmax = x.rooms_max != null ? x.rooms_max : null; any = true; }
      if (x.price_max_wan != null) { f.pmax = x.price_max_wan; any = true; }
      if (x.price_min_wan != null) { f.pmin = x.price_min_wan; any = true; }
      var zh = zoneHits(text);
      if (zh.length) { f.zs = zh; any = true; }
      else if (!ZN && /期|單元|水湳|廍子|特區|重劃/.test(text)) needZones(function () { if (ta && ta.value) setFilter(parse(ta.value.trim())); });   // 範圍資料還沒載到：載好再讀一次
      return any ? f : null;
    }

    // 畫一格。回傳 true＝還有東西在動（鏡頭、淡入淡出、數字、波紋、新上架那一圈光），false＝靜下來了，迴圈可以停
    function frame(t, dt) {
      if (tI < 0) { tI = t; if (tF < 0) tF = t; }
      var jump = calm, busy = false, amb = false;   // jump：安靜模式不做緩動，一格到位
      var kc = jump ? 1 : 1 - Math.exp(-dt * camK), kl = jump ? 1 : 1 - Math.exp(-dt * 4), kp = jump ? 1 : 1 - Math.exp(-dt * 8), el = t - tF, ei = t - tI, i, p, c, sx, sy, a, s, q, rr, k, e, px, py, lift, tv;
      pk = jump ? 0 : pk + ((act ? 1 : 0) - pk) * kp;
      cam.x += (tcam.x - cam.x) * kc; cam.y += (tcam.y - cam.y) * kc; cam.z += (tcam.z - cam.z) * kc;
      // 鏡頭差不到 0.05 個像素就算到了（直接對齊），不然一直逼近、永遠停不下來
      if (Math.abs(tcam.x - cam.x) * cam.z < 0.05 && Math.abs(tcam.y - cam.y) * cam.z < 0.05 && Math.abs(tcam.z - cam.z) < cam.z * 0.0002) { cam.x = tcam.x; cam.y = tcam.y; cam.z = tcam.z; }
      else busy = true;
      var z = cam.z, grow = Math.min(1.7, 0.8 + 0.2 * z);
      // 底圖：有新圖到、鏡頭在畫面上動了 0.1 個像素以上、或鏡頭剛停好，才重畫
      if ((tState === "try" || tState === "sat") && (bgDirty || Math.abs(cam.x - lastCam[0]) * z > 0.1 || Math.abs(cam.y - lastCam[1]) * z > 0.1 || Math.abs(cam.z - lastCam[2]) > z * 0.0003 ||
        (!busy && (cam.x !== lastCam[0] || cam.y !== lastCam[1] || cam.z !== lastCam[2])))) drawTiles();
      if (focus) {
        tagX = Math.max(tagMin, Math.min(vw - tagW - 10, (focus.cx - cam.x) * z + ax - tagW / 2)); tagY = Math.max(!wide && tagX < hudBox[2] && tagX + tagW > hudBox[0] ? hudBox[3] + 2 : 10, (focus.cy - cam.y) * z + ay - focus.r * z - 44);   // 手機：標籤不蓋到數字那一塊
      }
      g.globalAlpha = 1; g.clearRect(0, 0, vw, vh);
      if (ZN) {   // 重劃區範圍線：那一塊在畫面上夠大（46 像素以上）才慢慢浮出來；被點名的那一塊一定畫
        g.lineWidth = 1.5; g.lineJoin = "round"; g.fillStyle = TH.zc; g.strokeStyle = TH.zc;
        for (i = 0; i < ZN.length; i++) {
          c = ZN[i]; q = filter && filter.zs.indexOf(i) >= 0;
          tv = q ? 1 : Math.max(0, Math.min(1, (Math.max(c.bw, c.bh) * z - 46) / 50)) * (filter ? 0.4 : 1);
          c.a += (tv - c.a) * kl;
          if (Math.abs(tv - c.a) > 0.004) busy = true; else c.a = tv;
          if (c.a < 0.02) continue;
          sx = (c.bx - cam.x) * z + ax; sy = (c.by - cam.y) * z + ay;
          if (sx + c.bw * z / 2 < 0 || sx - c.bw * z / 2 > vw || sy + c.bh * z / 2 < 0 || sy - c.bh * z / 2 > vh) continue;
          g.beginPath();
          for (k = 0; k < c.rings.length; k++) {
            rr = c.rings[k];
            for (e = 0; e < rr.length; e++) { px = (rr[e][0] - cam.x) * z + ax; py = (rr[e][1] - cam.y) * z + ay; if (e) g.lineTo(px, py); else g.moveTo(px, py); }
            g.closePath();
          }
          g.globalAlpha = c.a * (q ? 0.16 : 0.07); g.fill();
          g.globalAlpha = c.a * 0.92; g.stroke();
        }
      }
      // 第一輪：每一顆的位置、亮度、大小，先畫平常的樣子
      for (i = 0; i < P.length; i++) {
        p = P[i];
        if (jump || el >= p.dl) {
          tv = filter ? (p.m ? 1 : TH.off) : TH.idle; p.br += (tv - p.br) * kp;
          if (Math.abs(tv - p.br) > 0.004) busy = true; else p.br = tv;
          tv = filter && p.m ? 1 : 0; p.hl += (tv - p.hl) * kp;
          if (Math.abs(tv - p.hl) > 0.004) busy = true; else p.hl = tv;
        } else busy = true;
        px = p.bx; py = p.by;
        if (!jump) {
          k = (ei - p.d0) / 1.3;
          if (k < 1) { e = 1 - Math.pow(1 - (k < 0 ? 0 : k), 3); px += Math.cos(p.ia) * (1 - e) * p.id * K; py += Math.sin(p.ia) * (1 - e) * p.id * K; busy = true; }
        }
        sx = (px - cam.x) * z + ax; sy = (py - cam.y) * z + ay; lift = i === hov ? 0.45 : 0;   // 滑鼠指著的那一顆大一點
        p.sx = sx; p.sy = sy; p.a = 0;
        if (sx < -44 || sx > vw + 44 || sy < -44 || sy > vh + 44 || p.br < 0.01) continue;
        a = Math.min(1, p.br * (1 + 0.6 * lift));
        s = TH.base * K * (0.82 + 0.36 * p.sz) * grow * (1 + 0.3 * p.hl) * (1 + 0.5 * lift);
        if (!jump && filter && p.m && el > p.dl && el < p.dl + 0.5) { s *= 1 + 0.4 * Math.sin((el - p.dl) / 0.5 * 3.1416); busy = true; }   // 符合的那一顆彈一下
        if (i === sel) s *= 1.3;
        p.a = a; p.s = s;
        if (p.hl < 0.98) { g.globalAlpha = a * (1 - p.hl); g.drawImage(p.pr === 2 ? TH.n : TH.o, sx - s / 2, sy - s / 2, s, s); }
      }
      // 第二輪：符合條件的（畫在最上面）、近七天新上架的一圈光
      g.strokeStyle = TH.ring; g.lineWidth = 1.25;
      for (i = 0; i < P.length; i++) {
        p = P[i]; if (!p.a) continue;
        if (p.hl > 0.02) { s = p.s * TH.hs; g.globalAlpha = Math.min(1, p.a * p.hl); g.drawImage(p.pr === 2 ? TH.h : TH.o, p.sx - s / 2, p.sy - s / 2, s, s); }
        if (p.nw && p.br > 0.4) {
          q = 0.4 + ((t * 0.4 + p.ph) % 1 - 0.4) * pk; rr = (3 + q * 12) * grow * K; amb = true;   // pk＝1 一圈一圈散開；pk＝0 停成固定大小的一圈
          g.globalAlpha = (1 - q) * 0.55 * p.br; g.beginPath(); g.arc(p.sx, p.sy, rr, 0, 6.2832); g.stroke();
        }
      }
      if (sel >= 0 && P[sel].a) {   // 選到的那一間：再畫一次蓋在最上面，外面加一圈會呼吸的框
        p = P[sel]; s = p.s * TH.hs; amb = true;
        g.globalAlpha = 1; g.drawImage(p.pr === 2 ? TH.h : TH.o, p.sx - s / 2, p.sy - s / 2, s, s);
        g.lineWidth = 2.5; g.beginPath(); g.arc(p.sx, p.sy, s * (0.27 + 0.02 * pk * Math.sin((t - selT) * 3.2)), 0, 6.2832); g.stroke();
        g.lineWidth = 1.25;
      }
      if (hov >= 0 && hov !== sel && P[hov].a) {   // 滑鼠指著的那一顆：加一圈細框，表示可以點
        p = P[hov]; g.globalAlpha = 0.95; g.lineWidth = 1.5; g.beginPath(); g.arc(p.sx, p.sy, p.s * TH.hs * 0.25, 0, 6.2832); g.stroke(); g.lineWidth = 1.25;
      }
      if (focus && !jump && el < 1.5) {   // 鏡頭推過去時，從那一區散開兩圈波紋
        sx = (focus.cx - cam.x) * z + ax; sy = (focus.cy - cam.y) * z + ay; g.lineWidth = 1.5; busy = true;
        for (i = 0; i < 2; i++) {
          q = (el - i * 0.25) / 1.2; if (q <= 0 || q >= 1) continue;
          e = 1 - Math.pow(1 - q, 3);
          g.globalAlpha = (1 - q) * (1 - q) * 0.45; g.beginPath(); g.arc(sx, sy, focus.r * z * 0.5 + e * Math.max(aw, ah) * 0.6, 0, 6.2832); g.stroke();
        }
      }
      // 區名（畫在圖上，讓人看得出這是台中的哪裡；被指定的那一區改由上面的小標籤顯示）
      if (hudDirty && lastN >= 0) measureHud();
      g.font = labFont; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = 3.5;
      g.strokeStyle = TH.labBg; g.fillStyle = TH.labFg;
      var li = jump ? 1 : Math.max(0, Math.min(1, (ei - 0.9) / 0.8)), fds = filter && filter.ds.length ? filter.ds : null, LB = [];
      if (!jump && ei < 2.4) busy = true;   // 進場那兩秒多（光點飛進來、區名淡入）
      var mixOn = sat && labZ(cam.z) >= MIXZ;   // 底圖上已經疊了有路名、有地名的那一層：自己畫的行政區名就收起來，不重複
      var hs = shot.classList.contains("has-strip");   // 小卡滑出來時，出處會往上讓 104（寬版再往左讓 52，樣式管）
      var cb = crW ? [vw - 26 - crW - (hs && wide ? 52 : 0), vh - (hs ? 114 : 10) - crH - 20, vw, vh] : null;   // 右下角出處那一塊先佔位
      if (cb) LB.push(cb);
      if (zb) LB.push(zb);   // 右邊三顆鈕那一塊也佔位（重劃區名看 LB）
      for (i = 0; i < G.length; i++) {
        c = G[i]; if (!c) continue;
        tv = (cam.z + 0.01 >= c.lz ? 1 : 0) * (fds ? (fds.indexOf(i) >= 0 ? 0 : 0.5) : 1) * li * (mixOn ? 0 : 1);
        c.la += (tv - c.la) * kl;
        if (Math.abs(tv - c.la) > 0.004) busy = true; else c.la = tv;
        if (c.la < 0.02) continue;
        sx = (c.cx - cam.x) * z + ax; sy = (c.cy - cam.y) * z + ay - labOff(c, z); q = c.lw / 2;
        if (sx < q + 4 || sx > vw - q - 4 || sy < 12 || sy > vh - 12) continue;
        if (sx + q > hudBox[0] && sx - q < hudBox[2] && sy + 10 > hudBox[1] && sy - 10 < hudBox[3]) continue;   // 壓到數字那一塊的不畫（寬版、直版都一樣）
        if (focus && sx + q > tagX - 8 && sx - q < tagX + tagW + 8 && sy + 10 > tagY - 6 && sy - 10 < tagY + 36) continue;
        if (cb && sx + q > cb[0] && sy + 11 > cb[1] && sy - 11 < cb[3]) continue;
        if (zb && sx + q > zb[0] && sx - q < zb[2] && sy + 11 > zb[1] && sy - 11 < zb[3]) continue;   // 被右邊三顆鈕蓋到的區名不畫
        g.globalAlpha = c.la * TH.labA; g.strokeText(c.name, sx, sy); g.fillText(c.name, sx, sy);
        LB.push([sx - q - 4, sy - 13, sx + q + 4, sy + 13]);
      }
      if (ZN) {   // 重劃區的名字：放在那一塊的中間；範圍線還沒浮出來、放不下、會壓到區名或數字那一塊就不放
        g.fillStyle = TH.zc;
        for (i = 0; i < ZN.length; i++) {
          c = ZN[i]; q = c.lw / 2;
          if (c.a < 0.3 || c.bw * z < c.lw + 14 || (filter && filter.zs.indexOf(i) >= 0)) continue;
          sx = (c.cx - cam.x) * z + ax; sy = (c.cy - cam.y) * z + ay;
          if (sx < q + 4 || sx > vw - q - 4 || sy < 12 || sy > vh - 12) continue;
          if (sx + q > hudBox[0] && sx - q < hudBox[2] && sy + 10 > hudBox[1] && sy - 10 < hudBox[3]) continue;
          if (LB.some(function (b) { return sx + q > b[0] && sx - q < b[2] && sy + 11 > b[1] && sy - 11 < b[3]; })) continue;
          g.globalAlpha = Math.min(1, (c.a - 0.3) / 0.4) * TH.labA; g.strokeText(c.n, sx, sy); g.fillText(c.n, sx, sy);
          LB.push([sx - q - 4, sy - 13, sx + q + 4, sy + 13]);
        }
        g.fillStyle = TH.labFg;
      }
      g.globalAlpha = 1;
      if (jump || Math.abs(target - shown) < 0.5) shown = target;
      else { shown += (target - shown) * (1 - Math.exp(-dt * 7)); busy = true; }
      var n = Math.round(shown);
      if (n !== lastN) { numEl.textContent = n; lastN = n; }
      if (focus) tag.style.transform = "translate3d(" + tagX.toFixed(1) + "px," + tagY.toFixed(1) + "px,0)";
      if (popOn && sel >= 0) {   // 卡片跟著那一顆走：上面放得下就放上面，不然放下面；左右不超出圖塊；那一顆跑出畫面就先收起來
        p = P[sel]; rr = p.s * TH.hs * 0.3 + 12;
        var up = p.sy - rr - PH >= 8, pxx = Math.max(8, Math.min(vw - PW - 8, p.sx - PW / 2)), arrow = Math.round(Math.max(24, Math.min(PW - 24, p.sx - pxx)));
        pop.style.transform = "translate3d(" + pxx.toFixed(1) + "px," + (up ? p.sy - rr - PH : p.sy + rr).toFixed(1) + "px,0)";
        if (arrow !== popAX || up !== popUp) { popAX = arrow; popUp = up; pop.style.setProperty("--ax", arrow + "px"); pop.classList.toggle("below", !up); }
        q = !p.a; if (q !== popAway) { popAway = q; if (q) rescue(pop); pop.classList.toggle("away", q); shut(pop, q); }
      }
      var away = hold || tcam.z > 1.01 || !!filter;   // 「縮小」「回到全台中」兩顆鈕：已經在全台中就不能按
      if (away !== homeOn) { homeOn = away; if (!away) rescue(zHome); zHome.disabled = !away; }   // 按了「回到全台中」之後它自己變成不能按：焦點先移到「放大」
      q = tcam.z <= 1.01; if (q !== outOff) { outOff = q; if (q) rescue(zOut); zOut.disabled = q; }
      if (hold !== freeOn) { freeOn = hold; shot.classList.toggle("is-free", hold); hudDirty = true; }   // 自己在操作時，數字縮成左上角的小牌子
      act = busy;                                // 到這裡為止的 busy＝鏡頭、淡入淡出、數字、波紋這些「真的在動」的
      if (amb && pk > 0.004) busy = true;        // 新上架那一圈光、選中那一圈框還沒收好（不到一秒）
      if (hudDirty) busy = true;                 // 數字那一塊剛換了位置：下一格量好再畫一次
      if (!on1) { on1 = true; shot.classList.add("is-on"); tilesArm(); }   // 第一格畫好了：說明那一行可以出來，空拍圖可以開始排
      return busy;
    }

    setPalette("light");
    layout();
    run = loop(shot, function (t, dt) {
      if (dead) return false;
      try { return frame(t, dt); } catch (err) { fail(err); return false; }
    });
    // 測試用（網址帶 ?hmdebug=1 才有）：讓測試腳本讀得到鏡頭、底色、圖片張數和每一顆在畫面上的位置
    if (debug) {
      W.__hmll = function (lat, lng) {   // 某個經緯度現在在畫面上的哪裡
        var w = merc(lat, lng);
        return [((w[0] * sc0 + ox0) - cam.x) * cam.z + ax, ((w[1] * sc0 + oy0) - cam.y) * cam.z + ay];
      };
      W.__hm = function () {
        return { vw: vw, vh: vh, wide: wide, z: +tcam.z.toFixed(3), x: +tcam.x.toFixed(1), y: +tcam.y.toFixed(1), cz: +cam.z.toFixed(3), sel: sel, hov: hov, hold: hold, filter: !!filter, tiles: nTiles, zmax: +ZMAX.toFixed(1), zones: ZN ? ZN.length : 0, level: zFor(tcam.z),
          pts: P.map(function (p) { return [Math.round(p.sx), Math.round(p.sy), p.a > 0 ? 1 : 0]; }),
          mt: filter ? P.map(function (p) { return p.m ? 1 : 0; }) : null,   // 有條件時：每一顆符不符合
          palette: pal, tilesOk: tilesOk, tilesErr: tilesErr, running: run.on() };
      };
    }
    // 小卡要用的資料（社區名、坪數、照片網址）和重劃區範圍：畫面閒下來再先抓好，點下去才不用等
    (W.requestIdleCallback || function (fn) { setTimeout(fn, 1800); })(function () {
      if (dead) return;
      needCards(function () {}); needZones(function () {});
    }, { timeout: 4000 });
    function resized() { if (shot.offsetWidth !== vw || shot.offsetHeight !== vh) { layout(); kick(); } }
    if (W.ResizeObserver) new ResizeObserver(function () { if (!dead) resized(); }).observe(shot);
    else on(W, "resize", resized);
    // 視窗拖到解析度不同的螢幕（大小沒變，上面那個不會叫）：畫布照新的解析度重做，鏡頭不動
    var dq = null;
    function onDpr() {
      if (!dead) {
        var nd = Math.min(W.devicePixelRatio || 1, 2);
        if (nd !== DPR) { DPR = nd; g = fit(cv, vw, vh); gB = fit(cvB, vw, vh); zBase = zFor(1); bgDirty = true; hudDirty = true; kick(); }
      }
      watchDpr();
    }
    function watchDpr() {
      if (dq) { if (dq.removeEventListener) dq.removeEventListener("change", onDpr); else if (dq.removeListener) dq.removeListener(onDpr); }
      dq = W.matchMedia ? W.matchMedia("(resolution: " + (W.devicePixelRatio || 1) + "dppx)") : null;
      if (dq) { if (dq.addEventListener) dq.addEventListener("change", onDpr); else if (dq.addListener) dq.addListener(onDpr); }
    }
    watchDpr();
    // 右邊三顆鈕跟著小卡列上下讓位（有過場）：停好之後重量一次，區名的避讓才準
    on(zoomBox, "transitionend", function (e) { if (e.target === zoomBox) { hudDirty = true; kick(); } });

    // ── 操作地圖：滾輪放大縮小、按住拖著移動、兩指縮放；每一顆都可以點開 ──
    function at(e) { var r = cv.getBoundingClientRect(), k = vw / (r.width || vw); return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; }
    function ui(e) { return !!(e.target && e.target.closest && e.target.closest(".hm-strip, .hm-nav, .hm-zoom, .hm-pop")); }
    // 畫面上離這一點最近、可以點的那一顆。客人自己打的條件：只算符合的；輸入框自動示範帶出來的條件：每一顆都能點（點了就接手）
    function nearest(px, py, rad) {
      var best = -1, bd = rad * rad;
      P.forEach(function (p, i) {
        if (!p.a || (filter && !p.m && ta && ta.value)) return;
        var dd = (p.sx - px) * (p.sx - px) + (p.sy - py) * (p.sy - py);
        if (dd < bd) { bd = dd; best = i; }
      });
      return best;
    }
    var lastScr = -1e9;
    on(W, "scroll", function () { lastScr = performance.now(); }, { passive: true });
    on(shot, "wheel", function (e) {
      if (ui(e)) return;
      var k = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (e.ctrlKey) {   // 觸控板兩指捏合（瀏覽器送來的是按著 Ctrl 的滾輪，數值很小）：只縮放地圖，不要連整個網頁一起放大
        if (!k) return;
        k = Math.max(-320, Math.min(320, k * 10));
      } else {
        if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // 橫著滑：不是要縮放
        if (!hold && performance.now() - lastScr < 400) return;   // 網頁正在捲、只是剛好經過地圖：不要半路攔下來變成放大
        if (e.deltaY > 0 && (tcam.z <= 1.001 || !hold)) return;   // 已經是全台中、或地圖不是使用者自己推近的（自動示範、打字帶過去的）：往下滾讓網頁照常捲
      }
      e.preventDefault();
      takeOver(); poke(true);
      var q = at(e);
      zoomAt(q[0], q[1], tcam.z * Math.exp(-k * 0.0022));
    }, { passive: false });
    var pan = null;
    on(shot, "pointerdown", function (e) {
      lastPT = e.pointerType || "mouse";
      if (ui(e) || e.pointerType !== "mouse" || e.button !== 0) return;
      var q = at(e); pan = { x: q[0], y: q[1], cx: tcam.x, cy: tcam.y, moved: false };
    });
    on(W, "pointermove", function (e) {
      if (!pan) return;
      var q = at(e), dx = q[0] - pan.x, dy = q[1] - pan.y;
      if (!pan.moved && dx * dx + dy * dy > 25) {   // 拖超過 5 像素才算拖（不然只是點一下）
        pan.moved = true; takeOver(); poke(true); pan.cx = tcam.x; pan.cy = tcam.y; pan.x = q[0]; pan.y = q[1]; dx = dy = 0;
        shot.classList.add("is-pan"); hov = -1; shot.classList.remove("can-pick");
      }
      if (pan.moved) { tcam = clampCam({ x: pan.cx - dx / tcam.z, y: pan.cy - dy / tcam.z, z: tcam.z }); cam.x = tcam.x; cam.y = tcam.y; kick(); }
    });
    function endPan() {
      if (pan && pan.moved) { dragged = true; shot.classList.remove("is-pan"); setTimeout(function () { dragged = false; }, 0); }
      pan = null;
    }
    on(W, "pointerup", endPan);
    on(W, "pointercancel", endPan);
    on(shot, "pointermove", function (e) {   // 滑鼠指到哪一顆，哪一顆就變大、游標變成手指
      if (e.pointerType !== "mouse" || (pan && pan.moved)) return;
      var q = at(e), h = ui(e) ? -1 : nearest(q[0], q[1], 14);
      if (h !== hov) { hov = h; shot.classList.toggle("can-pick", h >= 0); kick(); }
    });
    on(shot, "pointerleave", function () { if (hov >= 0) { hov = -1; shot.classList.remove("can-pick"); kick(); } });
    // 手機：一根手指照常捲網頁、點一下是點開；兩根手指才是移動和縮放地圖
    var pinch = null;
    function two(e) {
      var r = cv.getBoundingClientRect(), k = vw / (r.width || vw), a = e.touches[0], b = e.touches[1];
      return { x: ((a.clientX + b.clientX) / 2 - r.left) * k, y: ((a.clientY + b.clientY) / 2 - r.top) * k, d: Math.max(20, Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2))) };
    }
    function endPinch() { if (pinch) { pinch = null; setTimeout(function () { dragged = false; }, 80); } }
    on(shot, "touchstart", function (e) {
      if (e.touches.length !== 2 || ui(e)) { endPinch(); return; }
      e.preventDefault(); takeOver(); poke(true);
      var q = two(e); pinch = { d: q.d, z: tcam.z, bx: (q.x - ax) / tcam.z + tcam.x, by: (q.y - ay) / tcam.z + tcam.y };
    }, { passive: false });
    on(shot, "touchmove", function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var q = two(e), nz = Math.max(1, Math.min(ZMAX, pinch.z * q.d / pinch.d));
      tcam = clampCam({ x: pinch.bx - (q.x - ax) / nz, y: pinch.by - (q.y - ay) / nz, z: nz });
      cam.x = tcam.x; cam.y = tcam.y; cam.z = tcam.z; dragged = true; kick();
    }, { passive: false });
    on(shot, "touchend", function (e) { if (e.touches.length < 2) endPinch(); });
    on(shot, "touchcancel", endPinch);   // 手勢被系統打斷（來電、切換畫面）：當成放開
    on(shot, "gesturestart", function (e) { e.preventDefault(); });   // iPhone：兩指縮放只縮放地圖，不要連整個網頁一起放大
    // 點一下：點到一顆就點開；點空白處就收起卡片
    on(shot, "click", function (e) {
      if (dragged || ui(e)) return;
      var q = at(e), hit = nearest(q[0], q[1], lastPT === "mouse" ? 14 : 26);
      poke(false);
      if (hit >= 0) { takeOver(); pick(hit); }
      else if (sel >= 0 && !filter) pick(-1);
    });
    on(shot, "dblclick", function (e) { if (ui(e)) return; e.preventDefault(); takeOver(); poke(true); var q = at(e); zoomAt(q[0], q[1], tcam.z * 2); });
    on(zIn, "click", function () { takeOver(); poke(true); zoomAt(ax, ay, tcam.z * 2); });
    on(zOut, "click", function () { takeOver(); poke(true); zoomAt(ax, ay, tcam.z / 2); });
    on(zHome, "click", function () { poke(false); goHome(); });
    // Esc：收起點開的那一間（跟點空白處一樣）
    on(d, "keydown", function (e) { if ((e.key === "Escape" || e.key === "Esc") && sel >= 0 && !filter) pick(-1); });

    // 小卡滑動：最左邊那一張對應的光點加框；電腦可以用滑鼠拖、或按兩邊的鈕
    var sraf = 0, drag = null;
    function leftCard() {
      var x = strip.scrollLeft + PADL, b = -1, bd = 1e9;
      [].forEach.call(strip.children, function (el) {
        if (!el.hasAttribute("data-i")) return;
        var dd = Math.abs(el.offsetLeft - x); if (dd < bd) { bd = dd; b = +el.getAttribute("data-i"); }
      });
      return b;
    }
    on(strip, "scroll", function () {
      navState();
      if (!filter || sraf || performance.now() - progT < 700) return;
      sraf = requestAnimationFrame(function () {
        sraf = 0; var b = leftCard();
        if (b >= 0 && b !== sel) { sel = b; selT = performance.now() / 1000; mark(); kick(); }
      });
    }, { passive: true });
    // 客人在用小卡列：示範先停（見 hookInput）。鍵盤走到某一張卡時，把那一張捲到看得到的地方，地圖上那一顆跟著加框
    on(strip, "pointerdown", function () { using = true; });
    on(strip, "touchstart", function () { using = true; }, { passive: true });
    on(strip, "focusin", function (e) {
      using = true;
      var el = e.target.closest && e.target.closest(".hm-card"), kb = false;
      if (!el) return;
      try { kb = el.matches(":focus-visible"); } catch (x) { kb = false; }
      if (!kb) return;   // 滑鼠、手指點的：不要捲（卡片會從游標底下跑掉，點不到連結）
      progT = performance.now();   // 底下捲動的處理先不要把最左邊那張當成選中
      strip.scrollLeft = el.offsetLeft - PADL;
      if (filter && el.hasAttribute("data-i")) { sel = +el.getAttribute("data-i"); selT = performance.now() / 1000; mark(); kick(); }
    });
    on(strip, "pointerover", function (e) {   // 電腦：滑鼠移到哪一張，哪一顆就加框
      var el = filter && e.pointerType === "mouse" && e.target.closest && e.target.closest("[data-i]");
      if (el && +el.getAttribute("data-i") !== sel) { sel = +el.getAttribute("data-i"); selT = performance.now() / 1000; mark(); kick(); }
    });
    function page(dir) { strip.scrollBy({ left: dir * Math.max(240, strip.clientWidth * 0.8), behavior: calm ? "auto" : "smooth" }); }
    on(navL, "click", function () { page(-1); }); on(navR, "click", function () { page(1); });
    on(strip, "pointerdown", function (e) { if (e.pointerType === "mouse" && e.button === 0) drag = { x: e.clientX, l: strip.scrollLeft, moved: false }; });
    on(W, "pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; strip.classList.add("is-drag"); }
      if (drag.moved) strip.scrollLeft = drag.l - dx;
    });
    function endDrag() {
      if (drag && drag.moved) { strip.classList.remove("is-drag"); strip.setAttribute("data-dragged", "1"); setTimeout(function () { strip.removeAttribute("data-dragged"); }, 0); }
      drag = null;
    }
    on(W, "pointerup", endDrag);
    on(W, "pointercancel", endDrag);
    on(strip, "click", function (e) { if (strip.hasAttribute("data-dragged")) e.preventDefault(); }, true);   // 剛拖完放開不算點

    // 跟著輸入框：自己打字、或框裡自動打出來的例句，光點都跟著變。
    // 讀句子的程式（need-extract.js）由首頁自己載，這裡不插：已經在就用，還沒有就等首頁發 ne:ready
    function overStrip() { try { return strip.matches(":hover"); } catch (x) { return false; } }
    function hookInput() {
      if (NE || !W.NeedExtract) return;
      NE = W.NeedExtract;
      if (!ta) return;
      var plen = (ta.placeholder || "").length;
      // 客人自己打的：地圖標籤的區名要唸出來（示範帶出來的不唸，見底下）
      var typed = function () { using = false; tag.setAttribute("aria-live", "polite"); setFilter(parse(ta.value.trim())); };
      on(ta, "input", typed);
      on(ta, "focus", typed);
      // 例句按鈕是直接把字填進輸入框（不發 input 事件；輸入框本來就在打字狀態時也不會再發 focus）：按了也讀一次
      on(d, "click", function (e) { if (e.target && e.target.closest && e.target.closest("#hero [data-fill]")) typed(); });
      if (W.MutationObserver) {
        new MutationObserver(function () {
          var s = ta.placeholder || "", shorter = s.length < plen; plen = s.length;
          // 客人正在用地圖或小卡（鍵盤焦點在地圖裡、滑鼠停在小卡上、按過或滑過小卡列）：示範不換畫面，免得小卡從手指底下被收走
          if (dead || ta.value || d.activeElement === ta || hold || using || shot.contains(d.activeElement) || overStrip()) return;
          tag.setAttribute("aria-live", "off");   // 示範帶出的區名不唸（報讀軟體才不會每幾秒插一句「北屯區」）
          setFilter(shorter || isCalm() ? null : parse(s));   // 安靜模式：自動示範不帶著地圖跑（已經帶出來的條件也收掉）
        }).observe(ta, { attributes: true, attributeFilter: ["placeholder"] });
      }
      if (ta.value) typed();
    }
    if (W.NeedExtract) hookInput(); else on(d, "ne:ready", hookInput);
    // 閒下來的時候請首頁先把它載好（自動示範才帶得動地圖）；安靜模式、省流量模式不主動要，等客人自己點輸入框
    function wantNE() { if (!dead && !W.NeedExtract && !saveData && !isCalm()) d.dispatchEvent(new CustomEvent("ne:want")); }
    function idleNE() { if (W.requestIdleCallback) W.requestIdleCallback(wantNE, { timeout: 4000 }); else setTimeout(wantNE, 2000); }
    if (d.readyState === "complete") idleNE(); else W.addEventListener("load", idleNE);
  }

  /* ── 啟動：瀏覽器太舊（沒有 fetch 或 canvas）、或在售資料抓不到，就留著數字、補一個連結 ── */
  var probe = d.createElement("canvas");
  if (typeof W.fetch !== "function" || !probe.getContext || !probe.getContext("2d")) { off(); return; }
  getJSON(shot.dataset.points, function (D) {
    try { start(D); } catch (err) { fail(err); }
  }, off);
})();
