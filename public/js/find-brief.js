/*! find-brief.js 推薦頁「為你整理的重點」。由官網代理注入到找房小幫手的推薦頁（網址代號 qa 開頭）。
 * 條件與在意的事只存在網址的 #k= 片段裡：瀏覽器不會把片段送給任何伺服器，所以這些內容不會進推薦頁檔案、也不會進任何日誌。
 * ⛔ 但推薦頁自己的程式（產生器寫死的追蹤）會把 location.href 整個送出去，片段也在裡面。所以：
 *    讀到片段就「立刻」從網址列拿掉（history.replaceState），之後任何腳本讀 location.href 都沒有片段；
 *    官網代理另外把追蹤程式裡的 location.href 換成不含片段的版本（見 shareqa.ts），兩層保險。
 * 代價：重新整理後網址已經沒有片段，這一塊「為你整理的重點」就不會再出現（頁面本身不受影響）；從找房頁再按一次「開啟推薦頁」就有。
 * 零網路請求、零儲存；沒有片段或驗證失敗就什麼都不顯示（只留伺服器端的揭露區塊）。
 * 文案全是固定模板：中性、不預測、不承諾，沒有未完工建設、沒有倒數與稀缺。
 */
(function (root) {
'use strict';

var DIST = ['中區', '東區', '南區', '西區', '北區', '北屯區', '西屯區', '南屯區', '太平區', '大里區', '霧峰區', '烏日區', '豐原區', '后里區', '石岡區', '東勢區', '和平區', '新社區', '潭子區', '大雅區', '神岡區', '大肚區', '沙鹿區', '龍井區', '梧棲區', '清水區', '大甲區', '外埔區', '大安區'];
var TYPES = { elevator_building: '電梯大樓', mid_rise: '華廈', apartment: '公寓', townhouse: '透天', studio: '套房' };
var PK = { flat: '平面車位', ramp_flat: '坡道平面車位', mechanical: '機械車位', any: '有車位', none: '不需要車位' };
var CONCERNS = ['budget_pressure', 'loan', 'condition', 'commute', 'school', 'elderly', 'price_unsure', 'overwhelmed', 'parking', 'timing', 'no_chase', 'other'];
var SPECIALS = ['school', 'market', 'low_public', 'lighting', 'pets', 'elderly', 'quiet', 'transit'];
var STAGES = ['first', 'upgrade', 'invest', 'browse'];
var TIMELINES = ['3m', '6m', '12m', 'browse'];
var COPY = {
  budget_pressure: ['預算：先抓「每個月想付多少」，比先抓總價更準。站內的買方試算可以幫你算頭期款和月付。', '/tools/buyer-fee/', '買方費用試算'],
  loan: ['貸款：過不過要看收入、負債和銀行，每個人不一樣。先用試算看自備款大概多少，再問景泰怎麼準備。', '/tools/buyer-fee/', '買方費用試算'],
  condition: ['屋況：漏水、壁癌看一眼不一定看得出來。看屋時可以特別看天花板角落、窗框周圍和浴室外牆。'],
  commute: ['通勤：把上班地點告訴景泰，用實際車程回推區域，比看地圖距離準。'],
  school: ['學區：每間要用地址查才準。站內有學區查詢，查完再決定要不要看。', '/tools/school-district/', '學區查詢'],
  elderly: ['長輩：優先看有電梯、進出口沒有高低差、浴室有防滑空間的。'],
  price_unsure: ['行情：想知道這區大概多少錢，可以請景泰依實價登錄整理給你，再對照這幾間的開價。'],
  overwhelmed: ['挑選：先看這幾間就好。哪幾間不想看、為什麼，告訴景泰，下一輪會更準。'],
  parking: ['車位：型式（平面、機械）和位置會影響每天使用，頁面沒寫清楚的，可以請景泰補問。'],
  timing: ['時機：沒有人能保證哪天最好。比較實際的是先看預算、貸款和你想入住的時間，再決定看屋的節奏。'],
  no_chase: ['你不想被一直追問，所以這一頁沒有任何要你留資料的欄位。想問的時候，再主動傳訊息給景泰就好。']
};
var MAX_BYTES = 600;

function isInt(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi; }
function list(v, allowed, max) {
  if (!Array.isArray(v) || v.length > max) return [];
  var out = [];
  for (var i = 0; i < v.length; i++) { if (allowed.indexOf(v[i]) < 0) return []; if (out.indexOf(v[i]) < 0) out.push(v[i]); }
  return out;
}

/* #k= 片段 → 條件與在意的事；任何不合法回 null。嚴格：版本、列舉白名單、數值範圍、大小上限，未知的鍵一律丟棄。 */
function parse(token) {
  if (typeof token !== 'string' || !token || token.length > 900 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  var obj;
  try {
    var b = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length > MAX_BYTES) return null;
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.v !== 1) return null;
  var f = obj.f && typeof obj.f === 'object' && !Array.isArray(obj.f) ? obj.f : {};
  var out = { d: list(f.d, DIST, 2), pmax: isInt(f.pmax, 100, 100000) ? f.pmax : null, pmin: isInt(f.pmin, 100, 100000) ? f.pmin : null, r: null, t: list(f.t, Object.keys(TYPES), 2), a: isInt(f.a, 1, 60) ? f.a : null, pk: (typeof f.pk === 'string' && Object.prototype.hasOwnProperty.call(PK, f.pk)) ? f.pk : null, fx: [], top: f.top === 1 };
  if (Array.isArray(f.r) && f.r.length === 2) {
    var lo = isInt(f.r[0], 1, 6) ? f.r[0] : null, hi = isInt(f.r[1], 1, 6) ? f.r[1] : null;
    if (lo !== null || hi !== null) out.r = [lo, hi];
  }
  if (Array.isArray(f.fx) && f.fx.length <= 12 && f.fx.every(function (n) { return isInt(n, 1, 60); })) out.fx = f.fx.filter(function (n, i, a) { return a.indexOf(n) === i; });
  out.c = list(obj.c, CONCERNS, 12);
  out.s = list(obj.s, SPECIALS, 8);
  out.st = STAGES.indexOf(obj.st) >= 0 ? obj.st : null;
  out.tl = TIMELINES.indexOf(obj.tl) >= 0 ? obj.tl : null;
  return out;
}

function tags(m) {
  var t = [];
  if (m.d.length) t.push(m.d.join('、'));
  if (m.r) t.push(m.r[0] !== null && m.r[1] !== null ? (m.r[0] === m.r[1] ? m.r[0] + ' 房' : m.r[0] + '～' + m.r[1] + ' 房') : m.r[0] !== null ? m.r[0] + ' 房以上' : m.r[1] + ' 房以內');
  if (m.t.length) t.push(m.t.map(function (k) { return TYPES[k]; }).join('、'));
  if (m.pmin !== null && m.pmax !== null) t.push(m.pmin + '～' + m.pmax + ' 萬');
  else if (m.pmax !== null) t.push(m.pmax + ' 萬以內');
  else if (m.pmin !== null) t.push(m.pmin + ' 萬以上');
  if (m.a !== null) t.push(m.a + ' 年內');
  if (m.pk) t.push(PK[m.pk]);
  if (m.fx.length) t.push('不要 ' + m.fx.join('、') + ' 樓');
  if (m.top) t.push('不含頂樓');
  return t;
}

/* 資料 → 要顯示的內容（純函式，Node 可測） */
function model(token) {
  var m = parse(token);
  if (!m) return null;
  var points = [];
  m.c.forEach(function (k) { if (COPY[k]) points.push({ concern: k, text: COPY[k][0], link: COPY[k][1] || null, label: COPY[k][2] || null }); });
  return { tags: tags(m), points: points, noChase: m.c.indexOf('no_chase') >= 0, token: token };
}

var CSS = '#qa-brief{max-width:720px;margin:12px auto;padding:0 16px;color:#2c2522;font:17px/1.75 -apple-system,"PingFang TC","Microsoft JhengHei",sans-serif}' +
  '#qa-brief *{box-sizing:border-box}#qa-brief .qb-p{padding:16px;background:#fffdf8;border:1.5px solid #d6c3a2;border-radius:14px}' +
  '#qa-brief h2{margin:0 0 8px;font-size:20px;line-height:1.4;font-weight:700}#qa-brief h3{margin:16px 0 6px;font-size:17px;font-weight:700;color:#7a5630}' +
  '#qa-brief .qb-tags{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}' +
  '#qa-brief .qb-tags li{min-height:32px;padding:2px 12px;border:1px solid #d6c3a2;border-radius:999px;background:#eadfcb;font-size:15px}' +
  '#qa-brief ul.qb-pts{margin:0;padding:0;list-style:none}#qa-brief .qb-pts li{margin:0 0 10px}#qa-brief p{margin:0}' +
  '#qa-brief .qb-sub{color:#5a4d44}#qa-brief .qb-act{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}' +
  '#qa-brief a.qb-b{display:inline-flex;align-items:center;min-height:48px;padding:8px 18px;border-radius:12px;font-weight:700;text-decoration:none;color:#7a5630;border:2px solid #8a6539}' +
  '#qa-brief a.qb-line{background:#0c8540;border-color:#0c8540;color:#fff}' +
  '#qa-brief a:focus-visible{outline:3px solid #8a6539;outline-offset:3px}#qa-brief .qb-dots{margin:0;padding:0;list-style:none}#qa-brief .qb-dots li{position:relative;margin:0 0 6px;padding-left:18px}' +
  '#qa-brief .qb-dots li::before{content:"";position:absolute;left:2px;top:.75em;width:7px;height:7px;border-radius:50%;background:#8a6539}';

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function link(href, text, cls) { var a = el('a', cls || 'qb-b', text); a.setAttribute('href', href); return a; }

function render(m) {
  var host = el('section'), panel = el('div', 'qb-p');
  host.id = 'qa-brief';
  host.setAttribute('aria-labelledby', 'qb-h');
  var st = el('style', '', CSS); host.appendChild(st);
  var h2 = el('h2', '', '為你整理的重點'); h2.id = 'qb-h'; panel.appendChild(h2);
  if (m.tags.length) {
    panel.appendChild(el('h3', '', '你給的條件'));
    var ul = el('ul', 'qb-tags');
    m.tags.forEach(function (t) { ul.appendChild(el('li', '', t)); });
    panel.appendChild(ul);
  }
  if (m.points.length) {
    panel.appendChild(el('h3', '', '你在意的事'));
    var pts = el('ul', 'qb-pts');
    m.points.forEach(function (p) {
      var li = el('li'); li.appendChild(el('p', '', p.text));
      if (p.link) { var row = el('div', 'qb-act'); row.appendChild(link(p.link, p.label)); li.appendChild(row); }
      pts.appendChild(li);
    });
    panel.appendChild(pts);
  }
  panel.appendChild(el('h3', '', '接下來你可以'));
  var dots = el('ul', 'qb-dots');
  dots.appendChild(el('li', '', '點頁面上的愛心，標記喜歡的。'));
  var li2 = el('li');
  if (m.noChase) li2.appendChild(el('span', '', '想問的時候，再主動傳訊息給景泰就好。'));
  else { li2.appendChild(el('span', '', '想問哪一間，直接傳 LINE 給景泰。')); var r2 = el('div', 'qb-act'); r2.appendChild(link('/go/line?src=share-ai', 'LINE 問景泰', 'qb-b qb-line')); li2.appendChild(r2); }
  dots.appendChild(li2);
  var li3 = el('li'); li3.appendChild(el('span', '', '條件想換，回到找房小幫手調整。'));
  var r3 = el('div', 'qb-act'); r3.appendChild(link('/find/#k=' + m.token, '調整條件')); li3.appendChild(r3); dots.appendChild(li3);
  panel.appendChild(dots);
  panel.appendChild(el('p', 'qb-sub', '不急。想問的時候，再傳訊息給景泰就好。'));
  host.appendChild(panel);
  return host;
}

/* 取得 token：讀網址片段，並且「立刻」把片段從網址列拿掉（不認得的片段也一併清掉） */
function takeToken() {
  var tok = null, hash = root.location.hash || '';
  var m = /^#k=([A-Za-z0-9_-]+)$/.exec(hash);
  if (m) tok = m[1];
  if (hash) { try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) { /* ignore */ } }
  return tok;
}

function run() {
  var tok = takeToken();
  var data = tok ? model(tok) : null;
  if (!data) return; // 沒有片段或驗證失敗：只留伺服器端的揭露區塊
  var node = render(data), notice = document.getElementById('qa-notice');
  if (notice && notice.parentNode) notice.parentNode.insertBefore(node, notice.nextSibling);
  else if (document.body) document.body.insertBefore(node, document.body.firstChild);
}

var api = { parse: parse, model: model, tags: tags, COPY: COPY, takeToken: takeToken };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.FindBrief = api;
if (typeof document !== 'undefined' && root.location) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
}
})(typeof window !== 'undefined' ? window : globalThis);
