/*! wait-board.js 蓋大樓排行榜：玩完一局才由 find-app.js 載入（網址帶 ?v=）。只連同源 /api/find/score、/api/find/top；
 * 暱稱只用 textContent。有工作編號才送分數、0 層不送；失敗靜默，不擋結果頁。事件只記計數（track），不記暱稱。
 * 掛 window.WaitBoard（Node 端 module.exports 給測試）；版面與固定文案在 find.astro 的 #wait-board。 */
(function (root) {
'use strict';

var API = '/api/find/';
var JOB_RE = /^a[A-Za-z0-9_-]{22}$/;
var FLOORS_MAX = 300, MS_MAX = 86400000, NAME_MAX = 8, TOP_TTL = 30000, NAME_KEY = 'find.lbn';
var T = {
  loading: '排行榜載入中…',
  empty: '排行榜暫時看不到，等一下再看看。',
  weekEmpty: '這週還沒有人上榜，可以切到「近 30 天」看看。',
  me: '你目前第 {r} 名，蓋到 {f} 層。',
  you: '你',
  guest: '訪客',
  floor: ' 層',
  named: '暱稱送出了。',
  noName: '好，排行榜上會顯示「訪客」。',
  badName: '暱稱只能用中文、英文或數字，也不要放電話號碼，換一個試試。',
  rejected: '這個暱稱沒通過檢查，先用「訪客」顯示，可以換一個再送。',
  fail: '暱稱暫時沒送出去，等一下可以再按一次。',
  live: '排行榜更新了。',
  liveRank: '排行榜更新了：你在{t}第 {r} 名。',
  tab: { week: '本週', all: '近 30 天' }
};
/* 暱稱的字＝score.ts 的 NAME_OUT_RE（中英數、注音、常見全形標點）；半形標點伺服器會換全形，這裡也先換 */
var NAME_OK = /^[A-Za-z0-9ㄅ-ㄯ㐀-䶿一-鿿！？，。、～…「」『』（）：；—_-]+$/;
var WORDY = /[A-Za-z0-9ㄅ-ㄯ㐀-䶿一-鿿]/;
var FULL = { '!': '！', '?': '？', ',': '，', '~': '～', '(': '（', ')': '）', ':': '：', ';': '；' };
var doc = root.document;
var st = null;   // 目前這筆需求（工作編號）的排行榜狀態；換一筆就整個重來

function noop() {}
function byId(id) { return doc ? doc.getElementById(id) : null; }
function now() { return Date.now(); }
function int(v, lo, hi) { v = Math.floor(Number(v)); return v >= lo ? (v <= hi ? v : hi) : lo; }
function fmt(t, v) { return String(t).replace(/\{(\w)\}/g, function (a, k) { return v[k] != null ? v[k] : ''; }); }
function el(tag, cls, text) {
  var e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function msg(e, text) { if (e) { e.textContent = text || ''; e.hidden = !text; } }
function live(text) { var lv = byId('lb-live'); if (lv) lv.textContent = text; }   // 讀屏提示（一直在頁面上）
function cut(s, n) { return Array.from(String(s)).slice(0, n).join(''); }

/* 照伺服器規則整理暱稱（NFKC、去空白、半形標點換全形、8 字）。有不收的字、沒有中英數、6 位以上連續數字 → null；空的 → '' */
function tidy(s) {
  s = String(s || '');
  try { s = s.normalize('NFKC'); } catch (e) { /* 不支援就照原字 */ }
  s = cut(s.replace(/\s+/g, '').replace(/\.\.\./g, '…').replace(/[!?,~():;]/g, function (c) { return FULL[c]; }), NAME_MAX);
  return !s || (NAME_OK.test(s) && WORDY.test(s) && !/[0-9]{6,}/.test(s)) ? s : null;
}

/* 同分頁重整後還記得這筆需求留過的暱稱（破紀錄送分數時一起帶）；儲存不能用就算了 */
function recall(jid) {
  try { var o = JSON.parse(root.sessionStorage.getItem(NAME_KEY) || 'null'); return o && o.j === jid && typeof o.n === 'string' ? cut(o.n, NAME_MAX) : ''; } catch (e) { return ''; }
}
function keep(jid, name) {
  try { root.sessionStorage.setItem(NAME_KEY, JSON.stringify({ j: jid, n: name })); } catch (e) { /* 不能存就不存 */ }
}

/* ---------- 網路（同源；失敗一律由呼叫端吞掉） ---------- */
function post(body) {
  return root.fetch(API + 'score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); });
}
function okSaved(j) { return !!(j && j.ok === true && j.saved === true); }
function rows(a) {
  var out = [];
  (Array.isArray(a) ? a : []).slice(0, 10).forEach(function (x) {
    if (!x || typeof x !== 'object') return;
    var f = int(x.floors, 0, FLOORS_MAX);
    if (!f) return;
    out.push({ rank: int(x.rank, 0, 1e6) || out.length + 1, name: typeof x.name === 'string' && x.name ? cut(x.name, 16) : T.guest, floors: f });
  });
  return out;
}
/* 伺服器回來的榜再保險一次：看不懂就回 null */
function clean(j) {
  if (!j || j.ok !== true) return null;
  var m = j.me && typeof j.me === 'object' ? j.me : null;
  return {
    week: rows(j.week), all: rows(j.all),
    me: m ? { rank: int(m.rank, 0, 1e6), weekRank: int(m.weekRank, 0, 1e6), floors: int(m.floors, 0, FLOORS_MAX) } : null
  };
}
/* 自己那列：名次和層數都要對上（伺服器去重、重新編號時只比名次可能標到別人） */
function isMe(r, me, tab) {
  var mr = me ? (tab === 'week' ? me.weekRank : me.rank) : 0;
  return mr > 0 && r.rank === mr && r.floors === me.floors;
}

/* ---------- 狀態 ---------- */
function start(jid) {
  var name = recall(jid);
  st = { jid: jid, best: 0, ms: 0, perfect: 0, saved: false, name: name, named: !!name, chk: '', sending: false, tab: 'week', top: null, at: 0, track: noop };
  var inp = byId('lb-name');
  if (inp) inp.value = '';
  msg(byId('lb-note'), '');
  live('');
  render(false);              // 上一筆的清單、表單、分頁先收掉，顯示載入中
}
function wire(box) {
  if (box.getAttribute('data-wired')) return;
  box.setAttribute('data-wired', '1');
  Array.prototype.forEach.call(box.querySelectorAll('[data-lb]'), function (b) {
    b.addEventListener('click', function () {
      if (!st) return;
      st.tab = b.getAttribute('data-lb') === 'all' ? 'all' : 'week';
      render(false);
    });
  });
  var f = byId('lb-form');
  if (f) f.addEventListener('submit', onName);
}

/* 玩完一局：jid 工作編號；e 遊戲的 over 事件（score＝層數、durationMs）；g＝getState()（perfects）；track＝find-app 的事件上報 */
function over(jid, e, g, track) {
  var box = byId('wait-board');
  if (!box || typeof jid !== 'string' || !JOB_RE.test(jid)) return;    // 沒有真的工作編號（收件、降級）：不顯示、不送
  if (!st || st.jid !== jid) start(jid);
  wire(box);
  if (typeof track === 'function') st.track = track;
  box.hidden = false;
  e = e || {};
  var f = int(e.score, 0, FLOORS_MAX);
  if (f > st.best) {                       // 破自己紀錄才送（0 層不送）；伺服器同一筆 1 分鐘只收 6 次
    st.best = f;
    st.ms = int(e.durationMs, 0, MS_MAX);
    st.perfect = int(g && g.perfects, 0, f);
    send();
  } else if (!st.at || now() - st.at >= TOP_TTL) loadTop(false);
  else render(false);
}
function send() {
  var my = st, b = { jobId: my.jid, floors: my.best, ms: my.ms, perfect: my.perfect };
  if (my.name) b.name = my.name;
  return post(b).then(function (j) {
    my.saved = okSaved(j);
    if (my.saved) my.track('lb', { a: 'send' });
  }, noop).then(function () { if (my === st) loadTop(true); });
}
function loadTop(announce) {
  var my = st;
  my.at = now();
  return root.fetch(API + 'top?id=' + encodeURIComponent(my.jid)).then(function (r) { return r.json(); }).then(function (j) {
    var v = clean(j);
    if (v) my.top = v;                       // 看不懂：舊榜先留著
    return !!v;
  }).catch(noop).then(function (fresh) {
    var said = fresh ? check(my) : '';      // 只拿新的榜比對暱稱
    my.chk = '';
    if (my === st) render(said || announce);
  });
}
/* 剛留的暱稱在榜上變「訪客…」＝沒通過伺服器過濾：說一聲、表單再打開 */
function check(my) {
  var v = my.chk, t = my.top, bad = false;
  if (!v || !t || !t.me) return '';
  ['week', 'all'].forEach(function (k) {
    t[k].forEach(function (r) { if (isMe(r, t.me, k) && r.name !== v && r.name.indexOf(T.guest) === 0) bad = true; });
  });
  if (!bad) return '';
  my.name = ''; my.named = false;
  keep(my.jid, '');
  if (my === st) msg(byId('lb-note'), T.rejected);
  return T.rejected;
}

/* ---------- 畫面 ---------- */
/* announce：true 唸榜的狀態；字串＝唸這句；false 不唸 */
function render(announce) {
  var my = st, box = byId('wait-board');
  if (!my || !box) return;
  var t = my.top, tab = my.tab, list = byId('lb-list'), form = byId('lb-form');
  var rs = t ? t[tab] : [], me = t && t.me, mr = me ? (tab === 'week' ? me.weekRank : me.rank) : 0, inList = false;
  Array.prototype.forEach.call(box.querySelectorAll('[data-lb]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lb') === tab)); });
  if (list) {
    list.textContent = '';
    rs.forEach(function (r) {
      var mine = isMe(r, me, tab);
      if (mine) inList = true;
      var li = el('li', 'u2-lb__row' + (mine ? ' is-me' : ''));
      li.appendChild(el('span', 'u2-lb__rk', String(r.rank)));
      li.appendChild(el('span', 'u2-lb__nm', r.name));        // 暱稱：只用 textContent
      if (mine) li.appendChild(el('span', 'u2-lb__you', T.you));
      li.appendChild(el('span', 'u2-lb__fl', r.floors + T.floor));
      list.appendChild(li);
    });
    list.hidden = !rs.length;
  }
  var any = !!(t && (t.week.length || t.all.length));
  msg(byId('lb-empty'), !my.at ? T.loading : !any ? T.empty : !rs.length ? (tab === 'week' ? T.weekEmpty : T.empty) : '');
  msg(byId('lb-me'), any && mr > 0 && !inList ? fmt(T.me, { r: mr, f: me.floors }) : '');
  if (form) form.hidden = !(my.best > 0 && my.saved && !my.named && any);   // 這次成績有送到、還沒留暱稱，才問
  if (announce) live(typeof announce === 'string' ? announce : !any ? T.empty : inList ? fmt(T.liveRank, { t: T.tab[tab], r: mr }) : T.live);
}

/* ---------- 留暱稱：同一筆、同層數再送一次（伺服器只更新暱稱） ---------- */
function onName(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  var my = st, inp = byId('lb-name'), btn = byId('lb-send'), note = byId('lb-note');
  if (!my || !inp || my.sending || !my.best) return;
  var v = tidy(inp.value);
  /* 表單收起來時焦點移到結果那句（讀屏會唸、不掉回頁首）；表單還在就焦點不動、改用 lb-live 唸 */
  function say(text, move) {
    msg(note, text);
    if (move && note) note.focus(); else live(text);
  }
  function wait(on) {                        // 用 aria-disabled（disabled 會丟焦點）
    my.sending = on;
    if (!btn) return;
    if (on) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    btn.classList[on ? 'add' : 'remove']('is-busy');
  }
  if (v === null) { say(T.badName); return; }
  if (!v) { my.named = true; say(T.noName, true); render(false); return; }   // 不填＝訪客，不用再送
  wait(true);
  msg(note, '');
  post({ jobId: my.jid, floors: my.best, ms: my.ms, perfect: my.perfect, name: v }).then(function (j) {
    wait(false);
    if (!okSaved(j)) { say(T.fail); return; }
    my.name = v; my.named = true; my.chk = v;
    keep(my.jid, v);
    my.track('lb', { a: 'name' });            // 只記「有留暱稱」，不記內容
    if (my !== st) return;
    say(T.named, true);
    render(false);
    loadTop(true);
  }, function () { wait(false); say(T.fail); });
}

/* 正在打暱稱（有焦點或有字）：find-app.js 改出「結果好了」橫幅，不切掉打到一半的字 */
function busy() {
  var box = byId('wait-board'), f = byId('lb-form'), i = byId('lb-name');
  return !!(box && !box.hidden && f && !f.hidden && i && (i.value || doc.activeElement === i));
}

var WaitBoard = { over: over, busy: busy, tidy: tidy, T: T, _reset: function () { st = null; } };
if (!root.WaitBoard) root.WaitBoard = WaitBoard;     // 被重複載入：保留第一份（狀態在它身上）
if (typeof module !== 'undefined' && module.exports) module.exports = WaitBoard;
})(typeof window !== 'undefined' ? window : globalThis);
