/*! find-scope.js 找房小幫手「其他找法」：指定社區、74環內、地圖上選的範圍（s1 畫面），以及 s2「是社區的名字嗎？」、
 * s7／s8 的範圍說法。第一次用到才由 find-app.js 載入（網址在 s1 的 data-src）。
 * 只透過 find-app 給的 api（init(api)）改條件與切畫面；地圖只透過 window.FindMap（find-map.js，網址在 #scope-map 的 data-src）。
 * 沒有網路請求、沒有儲存；所有文字都是本檔固定表，只用 textContent。掛 window.FindScope（Node 端 module.exports 給測試）。 */
(function (root) {
'use strict';

var T = {
  head: { community: '找某個社區', zone: '74環內', geo: '在地圖上圈範圍' },
  badName: '這個名稱看起來不像社區名。只打社區的名字就好，不用打其他的字。',
  cg: '你說的這種找法（社區、74環內或地圖）現在暫時不能用，這次先照其他條件找。',
  ask: function (g) { return '你說的『' + g + '』是社區的名字嗎？'; },
  yes: '是，找這個社區',
  no: '不是',
  cfix: function (n, geo) { return '社區名冊裡找不到「' + n + '」。可能是字打錯，或是很新的社區。如果你說的是一個地方（像七期、逢甲），可以改用' + (geo ? '地圖或' : '') + '選區域。'; },
  cnone: function (n) { return '這次沒有找到' + n + '社區在賣的物件。想請景泰幫你留意，可以按下面的「LINE 問景泰」。'; },
  cless: function (n) { return '這次沒有找到' + n + '社區符合條件的物件。'; },
  cline: '想請景泰幫你留意這個社區有沒有新的，可以按下面的「LINE 問景泰」。',
  cask: '也可以直接 LINE 問景泰。',
  zone: '74環內這次沒有找到符合條件的物件。',
  loosen: '放寬一點再試試？',
  gsmall: '這個範圍跨了太多區，一次找不完。範圍小一點再試試？',
  gout: '這個範圍不在台中市。換到台中市內再試試？',
  gnone: '地圖上這一塊，這次沒看到在賣的物件。換個地方，或範圍大一點？',
  gpart: '這一塊在賣的不少，但這次只看了最新上架的一部分，裡面沒有符合條件的。加預算或房數條件，或改用選區域，會比較準。',
  gloose: '這次在這個範圍裡沒有找到符合條件的。放寬一點，或範圍大一點再試試？',
  busy: '這種找法現在用的人比較多，這次先沒有找。可以改用區域找，或晚一點再試。',
  b: {
    'sc-comm': '換個寫法找這個社區', 'sc-comm-new': '找別的社區', 'sc-map': '在地圖上圈範圍', 'sc-shrink': '把範圍縮小一點',
    'sc-redo': '重新選一個範圍', 'sc-pick': '改用區域找'
  },
  line: 'LINE 問景泰'
};
var KINDS = ['community', 'zone', 'geo'];
var HOW = { community: 'comm', zone: 'zone', geo: 'map' };   // 事件 start.how
var FROM = ['s0', 's3', 's4', 's8'];                          // 從哪幾步進來：回上一步、重新整理都回到那裡
var R74 = ['中區', '東區', '南區', '西區', '北區', '北屯區', '西屯區', '南屯區', '太平區', '潭子區'];
var SOFT = ['q_concerns', 'q_stage', 'q_timeline'];
// 「是社區的名字嗎？」：剩下的字去掉開頭口語（同 need-extract 的 CM_LEAD）、結尾問句後，像名字才問；寧可少猜
var CM_LEAD = /^(?:我想看|我想找|我想買|我要找|我要買|我要看|想看|想找|想買|看看|看一下|請問|問一下|有沒有|有無|幫我找|幫我看|找一下|關於|應該是|其實是|就是|台中市|找|看|買|在|於|的|是)/;
var GUESS_TAIL = /(?:的物件|的房子|的房|有嗎|還有嗎|有房子嗎|有沒有|的|出售|售屋|賣屋|物件|房子)$/;
var GUESS_BAD = /謝|測試|哈|嗨|安安|早安|午安|晚安|隨便|不知道|不確定|問一下|請教|小資|新婚|換屋|採光|通風|安靜|方正|格局|視野|景觀|明亮|乾淨|漂亮|划算|便宜|一點|好|近|離|靠|旁|附近|學校|學區|公園|市場|捷運|車站|上班|通勤|小孩|長輩|爸媽|預算|首購|自住|投資|出租|收租|裝潢|屋況|透天|公寓|華廈|大樓|套房|店面|車位|電梯|頂樓|樓|坪|房|廳|萬/;
var GUESS_OK = /^[\u4e00-\u9fffA-Za-z0-9+&·‧.\- ]{2,12}$/;
var GUESS_CHAT = /^(?:hi|hello|hey|test|testing|ok|okay|asdf|qwe|qwer|abc|123)$/i;   // 英文招呼、測試字（不分大小寫）

/* 純函式：剩下的字 → 可能的社區名（不像就回 null）。nf＝NeedExtract.normalizeFields（社區名驗證跟送出時同一張表） */
function guess(rest, nf) {
  var g = String(rest || '').trim().replace(CM_LEAD, ''), x;
  while ((x = GUESS_TAIL.exec(g)) && x.index > 0) g = g.slice(0, x.index);
  g = g.trim();
  if (!GUESS_OK.test(g) || GUESS_BAD.test(g) || GUESS_CHAT.test(g)) return null;
  return nf({ community: g }).fields.community || null;
}
/* 純函式：條件裡的範圍種類 */
function kindOf(f) { return f.community ? 'community' : f.geo ? 'geo' : f.zone ? 'zone' : null; }
/* 純函式：s8 的標題與按鈕（依序）。按鈕是 data-hint 代碼（find-app 的 applyHint 不認得就交回本檔的 hint()）；'line'＝LINE 問景泰排第一 */
function emptyPlan(f, hints, loosen, caps) {
  var k = kindOf(f), h = function (x) { return (hints || []).indexOf(x) >= 0; }, n = f.community, sfx = loosen ? T.loosen : '', geo = (caps || []).indexOf('geo') >= 0;
  if (!k) return null;
  if (h('scope_busy')) return { t: T.busy, b: ['sc-pick'] };
  if (k === 'community') {
    var only = Object.keys(f).every(function (x) { return x === 'community' || x === 'districts'; });
    if (h('comm_fix')) return { t: T.cfix(n, geo) + T.cask, b: ['sc-comm'].concat(geo ? ['sc-map'] : [], ['sc-pick']) };
    if (!loosen && only) return { t: T.cnone(n), b: ['line', 'sc-comm-new', 'sc-pick'] };
    return { t: T.cless(n) + sfx + T.cline, b: ['sc-pick'] };
  }
  if (k === 'zone') return { t: T.zone + sfx, b: ['sc-pick'] };
  if (h('geo_smaller')) return { t: T.gsmall, b: ['sc-shrink'] };
  if (h('geo_out')) return { t: T.gout, b: ['sc-redo'] };
  if (h('geo_partial')) return { t: T.gpart, b: ['sc-pick', 'sc-redo'] };
  if (loosen) return { t: T.gloose, b: ['sc-redo'] };
  return { t: T.gnone, b: ['sc-redo', 'sc-pick'] };
}

var core = { guess: guess, kindOf: kindOf, emptyPlan: emptyPlan, T: T };
var doc = root.document;
if (typeof module !== 'undefined' && module.exports) module.exports = core;
if (!doc) return;

/* ===================== 以下是畫面（DOM）部分 ===================== */
var A = null, mode = null, mapTry = null, guessed = null, s8orig = null;
function byId(id) { return doc.getElementById(id); }
function NE() { return root.NeedExtract; }
function S() { return A.S(); }
function h(tag, attrs, kids) {
  var e = doc.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
  (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
  return e;
}
function svg(id, cls) {
  var s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), u = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
  s.setAttribute('class', cls || 'u2-ico'); s.setAttribute('aria-hidden', 'true'); u.setAttribute('href', '#' + id); s.appendChild(u);
  return s;
}
function setFields(f) { var s = S(); s.fields = NE().normalizeFields(f).fields; s.cg = 0; }   // 這裡設的範圍都是 caps 有列的：確認畫面那句「已經先拿掉」收起來
function hasPR(f) { return (f.price_min_wan != null || f.price_max_wan != null) && (f.rooms_min != null || f.rooms_max != null); }

/* ---------- s1：三個面板與切換 ---------- */
function panel(kind) {
  var s = S(), caps = s.caps || [];
  if (KINDS.indexOf(kind) < 0) return;
  if (mode === 'geo' && kind !== 'geo') closeMap();
  mode = kind;
  byId('scope-comm').hidden = kind !== 'community';
  byId('scope-zone').hidden = kind !== 'zone';
  byId('scope-map').hidden = kind !== 'geo';
  byId('scope-h').textContent = T.head[kind];
  Array.prototype.forEach.call(doc.querySelectorAll('#scope-tabs [data-sc]'), function (b) {
    var k = b.getAttribute('data-sc').slice(3);
    b.hidden = caps.indexOf(k) < 0;
    b.setAttribute('aria-pressed', String(k === kind));
  });
  if (kind === 'community') {
    var inp = byId('scope-comm-in'), err = byId('scope-comm-err');
    inp.value = s.fields.community || '';
    inp.removeAttribute('aria-invalid');
    err.hidden = true; err.textContent = '';
  }
  A.show('s1');
  if (kind === 'geo') loadMap();
}
/* 從入口（s0、s8、s3）進來；kind＝community／zone／geo */
function open(kind) {
  var s = S();
  s.scopeFrom = FROM.indexOf(s.step) >= 0 ? s.step : 's0';
  if (HOW[kind]) A.startedHow(HOW[kind]);
  panel(kind);
}
/* 從確認畫面（s4）的「範圍｜改」進來：開目前的範圍那一個面板 */
function edit() {
  var s = S(), k = kindOf(s.fields) || (s.caps || [])[0];
  s.scopeFrom = 's4';
  panel(k);
}
function back() {
  closeMap();
  A.show(S().scopeFrom || 's0');
}
/* 不用範圍，改用選區域（pickMode 會先拿掉三個範圍欄位） */
function pick() {
  closeMap();
  A.pickMode();
}
/* 寫完範圍之後：從確認畫面來的回確認畫面；還缺預算或房數就只問硬題；社區直接到確認畫面 */
function next() {
  var s = S(), hard;
  if (s.scopeFrom === 's4' || s.fields.community || hasPR(s.fields)) { A.toConfirm(); return; }
  hard = NE().nextQuestions(s.fields, s.context, [], [], 4, false).filter(function (q) { return SOFT.indexOf(q) < 0; });
  if (hard.length) A.enterQuestions(hard, null); else A.toConfirm();
}
function submitComm(e) {
  if (e && e.preventDefault) e.preventDefault();
  var inp = byId('scope-comm-in'), err = byId('scope-comm-err'), c = NE().normalizeFields({ community: inp.value }).fields.community;
  if (!c) {
    err.textContent = T.badName; err.hidden = false;
    inp.setAttribute('aria-invalid', 'true');
    try { inp.focus(); } catch (x) { /* ignore */ }
    return;
  }
  err.hidden = true;
  setFields(Object.assign({}, S().fields, { community: c }));   // 社區優先：74環內、地圖、路段會被拿掉，區留著給家用機挑同名社區
  A.toConfirm();
}
function setZone() {
  var f = Object.assign({}, S().fields, { zone: 'r74' });
  delete f.community; delete f.geo; delete f.road;
  if (f.districts) f.districts = f.districts.filter(function (d) { return R74.indexOf(d) >= 0; });   // 環外的區拿掉（不然 74環內會被當成那一區）
  setFields(f);
  next();
}
function setGeo(poly) {
  var f = Object.assign({}, S().fields, { geo: poly });
  delete f.community; delete f.zone; delete f.districts; delete f.road;
  setFields(f);
  closeMap();
  next();
}

/* ---------- 地圖（find-map.js）：s1 先顯示出來再開；載不到或 15 秒沒好 → #scope-map-fail ---------- */
function mapFail() {   // 地圖程式或圖片載不到：收起地圖（含「地圖載入中…」），只留提示與「改用選區域」
  var f = byId('scope-map-fail'), m = byId('scope-map-mount');
  closeMap();
  if (m) m.hidden = true;
  if (f) f.hidden = false;
}
function closeMap() {
  try { if (root.FindMap) root.FindMap.close(); } catch (e) { /* 地圖模組自己的錯不影響流程 */ }
}
function openMap() {
  if (mode !== 'geo' || S().step !== 's1') return;   // 客人已經離開這個面板
  closeMap();
  try {
    root.FindMap.open(byId('scope-map-mount'), {
      poly: S().fields.geo || null,
      onDone: setGeo,
      onCancel: back,
      onFail: mapFail,
      track: function (n, p) { if (n === 'area') A.track(n, p); }
    });
  } catch (e) { mapFail(); }
}
function loadMap() {
  var box = byId('scope-map'), fail = byId('scope-map-fail'), mount = byId('scope-map-mount'), s, t;
  if (fail) fail.hidden = true;
  if (mount) mount.hidden = false;
  if (root.FindMap) { openMap(); return; }
  if (mapTry) return;
  function end(ok) {
    if (mapTry !== s) return;
    root.clearTimeout(t);
    if (ok && root.FindMap) openMap();
    else { mapTry = null; mapFail(); A.track('area', { a: 'fail' }); }
  }
  mapTry = s = doc.createElement('script');
  s.src = box.getAttribute('data-src');
  s.onload = function () { end(1); };
  s.onerror = function () { end(0); };
  t = root.setTimeout(function () { end(0); }, 15000);
  doc.head.appendChild(s);
}

/* ---------- s2：範圍被拿掉的說明；「是社區的名字嗎？」 ---------- */
function botMsg(kids) {
  var av = h('span', { class: 'u2-avatar', 'aria-hidden': 'true' }, [svg('u2-house')]);
  return h('div', { class: 'u2-msg u2-msg--bot' }, [av, h('div', { class: 'u2-bubble' }, kids)]);
}
function heard(r) {
  var s = S(), f = r.fields || {}, log = byId('s2-chat'), g, orig, q;
  if (s.step !== 's2' || r.out_of_scope || !log) return;
  if (s.cg) log.appendChild(h('div', { class: 'u2-banner u2-indent', role: 'note' }, [svg('i-info'), h('p', { class: 'u2-scope-ban', text: T.cg })]));
  if ((s.caps || []).indexOf('community') < 0 || f.districts || f.community || f.zone || f.geo) return;
  g = guess(r.rest, NE().normalizeFields);
  if (!g) return;
  guessed = g;
  // 「這句話我沒聽出條件」那種畫面：先把那一句收起來，換成問題；按「不是」再放回來
  if (!(root.FindCore && root.FindCore.condTags(f).length)) {
    orig = log.querySelectorAll('.u2-msg--bot');
    orig = orig[orig.length - 1];
    if (orig) { orig.hidden = true; orig.setAttribute('data-sc-hide', ''); }
  }
  q = botMsg([h('p', { text: T.ask(g) }), h('div', { class: 'u2-row' }, [
    h('button', { class: 'u2-btn u2-btn--primary', type: 'button', 'data-sc': 'guess-yes' }, [T.yes]),
    h('button', { class: 'u2-btn u2-btn--ghost', type: 'button', 'data-sc': 'guess-no' }, [T.no])
  ])]);
  q.id = 'scope-ask';
  log.appendChild(q);
}
function guessAnswer(yes) {
  var q = byId('scope-ask'), log = byId('s2-chat'), o = log && log.querySelector('[data-sc-hide]');
  if (yes && guessed) {
    setFields(Object.assign({}, S().fields, { community: guessed }));
    A.track('edit', { k: 'scope' });
    A.toConfirm();
    return;
  }
  if (q && q.parentNode) q.parentNode.removeChild(q);
  if (o) { o.hidden = false; o.removeAttribute('data-sc-hide'); }
}

/* ---------- s7：社區模式換一句（一般結果換回原句） ---------- */
function done() {
  var c = !!S().fields.community, a = byId('s7-first'), b = byId('s7-comm');
  if (a) a.hidden = c;
  if (b) b.hidden = !c;
}

/* ---------- s8：範圍的說法與按鈕（find-app 已經畫好認得的放寬；一般結果把標題換回原樣） ---------- */
function empty(hints) {
  var s = S(), title = byId('s8-title'), ul = byId('hint-list'), fb = byId('s8-scope-fb'), state = title && title.closest ? title.closest('[data-s="s8"]') : null;
  if (!title || !ul || !state) return;
  var sub = title.parentNode.querySelector('.u2-small'), lineRow = (state.querySelector('a[data-lineq]') || {}).parentNode;
  if (!s8orig) s8orig = { t: title.textContent, s: sub ? sub.textContent : '' };
  title.textContent = s8orig.t;
  if (sub) sub.hidden = false;
  if (lineRow) lineRow.hidden = false;
  var loosen = ul.querySelectorAll('[data-hint]').length, plan = emptyPlan(s.fields, hints, loosen, s.caps || []);
  if (!plan) return;
  if (fb) fb.hidden = true;
  title.textContent = plan.t;
  if (sub) sub.hidden = !loosen;   // 「點一下就會改條件」只在有放寬按鈕時說
  plan.b.forEach(function (code) {
    var el;
    if (code === 'line') {
      el = h('a', { class: 'u2-btn u2-btn--line', href: '/go/line?src=find-empty', 'data-lineq': '' }, [svg('i-chat'), T.line]);
      if (lineRow) lineRow.hidden = true;   // 移到第一個，下面那一顆收起來
      ul.insertBefore(h('li', {}, [el]), ul.firstChild);
      return;
    }
    el = h('button', { class: 'u2-opt u2-opt--btn', type: 'button', 'data-hint': code }, [h('span', { class: 'u2-opt__txt', text: T.b[code] })]);
    ul.appendChild(h('li', {}, [el]));
  });
}
/* s8 按鈕（find-app 的 applyHint 交過來，已經記成「改條件再找」） */
function hint(code) {
  var s = S();
  s.scopeFrom = 's8';
  if (code === 'sc-pick') pick();
  else if (code === 'sc-comm' || code === 'sc-comm-new') { panel('community'); if (code === 'sc-comm-new') byId('scope-comm-in').value = ''; }
  else if (code === 'sc-map' || code === 'sc-shrink' || code === 'sc-redo') panel('geo');
}

/* ---------- 啟動 ---------- */
function onClick(e) {
  var t = e.target && e.target.closest ? e.target.closest('[data-sc]') : null, a;
  if (!t || !A) return;
  a = t.getAttribute('data-sc');
  if (a.indexOf('to-') === 0) panel(a.slice(3));
  else if (a === 'zone-go') setZone();
  else if (a === 'back') back();
  else if (a === 'pick') pick();
  else if (a === 'guess-yes' || a === 'guess-no') guessAnswer(a === 'guess-yes');
}
function init(api) {
  if (A) { A = api; return; }
  A = api;
  doc.addEventListener('click', onClick);
  var form = byId('scope-comm');
  if (form) form.addEventListener('submit', submitComm);
}

root.FindScope = { init: init, open: open, edit: edit, heard: heard, done: done, empty: empty, hint: hint, core: core };
})(typeof window !== 'undefined' ? window : globalThis);
