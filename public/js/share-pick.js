/*! share-pick.js 推薦頁「傳給景泰」。由官網代理注入到景泰本人的推薦頁（頁面寫 var LIKE_NOTIFY = true; 才注入，同事頁不注入）。
 * 客人按了「我喜歡」之後，畫面底部出現「已選 N 間　[傳給景泰]」；按下去填聯絡方式，選的物件連同聯絡方式
 * 送到 /api/find/pick，由官網直接傳到景泰的 Telegram。
 * - 送到哪裡：在正式網域（teddy-house.tw）就是同源的 /api/find/pick；在舊網址（teddy-website-blog.pages.dev，推薦頁連結還在用）
 *   就跨網域送到 https://teddy-house.tw/api/find/pick（不帶 cookie；伺服器只對舊網址這一個來源開 CORS）。其他主機不啟動。
 * - 不改頁面原本「我喜歡」的行為：只讀按鈕的 liked 狀態，以及頁面自己存的 localStorage（teddy_like_<代號>_<slug>）。
 * - 聯絡資料不存在瀏覽器（不寫 localStorage／sessionStorage）；送出成功就清空表單。
 * - 物件名稱只取卡片上本來就看得到的文字（標題、價格、坪數、樓層），一律用 textContent，不用 innerHTML。
 *   （伺服器會再用推薦頁本身核對，Telegram 裡的名稱以伺服器從頁面抓的為準。）
 * - 任何錯誤都靜默：這支壞掉，推薦頁原本的功能照常。
 */
(function (root) {
'use strict';

var doc = root.document;
var ME = doc && doc.currentScript;
var API = '/api/find/pick';
var API_PROD = 'https://teddy-house.tw/api/find/pick';
var OLD_HOST = 'teddy-website-blog.pages.dev';
// 伺服器最慢：核對推薦頁（6 秒，Pages 沒發布再讀一次原始檔）＋兩隻 Telegram 各 12 秒 ≈ 36 秒，這裡留到 45 秒
var MAX_ITEMS = 12, NAME_MAX = 20, NOTE_MAX = 200, ITEM_MAX = 60, BODY_MAX = 4000, TIMEOUT_MS = 45000;
var ID_RE = /^[A-Za-z0-9]{4,40}$/;
var SLUG_RE = /^[A-Za-z0-9_-]{1,40}$/;
var LINE_RE = /^[A-Za-z0-9._@-]{3,40}$/;
var LINE_HREF_RE = /line\.me\/ti\/p\/~([A-Za-z0-9._-]{1,40})(?:[/?#]|$)/;

/* ---------- 純函式（測試直接呼叫） ---------- */
function nfkc(s) { s = String(s == null ? '' : s); try { return s.normalize('NFKC'); } catch (e) { return s; } }
function chars(s) { return Array.from ? Array.from(s) : String(s).split(''); }
/** 正規化、空白縮成一個、超過 n 個字就直接截斷（不補記號）。送給伺服器的字一律用這個：
 *  「…」在伺服器的 NFKC 正規化之後會變成三個點（字數變多、可能超過上限），所以送出的字不能有它。 */
function clip(s, n) {
  var a = chars(nfkc(s).replace(/\s+/g, ' ').trim());
  return a.length > n ? a.slice(0, n).join('').replace(/\s+$/, '') : a.join('');
}
/** 畫面顯示用：超過 n 個字就截斷並補「…」（截完剛好 n 個字） */
function cut(s, n) {
  var t = clip(s, n + 1);
  return chars(t).length > n ? clip(t, n - 1) + '…' : t;
}
function txt(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

/** 手機：去掉空白、減號、括號；+886 9… 換成 09…；必須是 09 開頭 10 碼。不合格回 null，空的回 ''。 */
function normPhone(v) {
  var s = nfkc(v).replace(/[\s\-()（）.]/g, '');
  if (!s) return '';
  if (/^\+?886/.test(s)) s = '0' + s.replace(/^\+?886/, '');
  return /^09\d{8}$/.test(s) ? s : null;
}
/** LINE ID：去頭尾空白；只准英數與 . _ - @，3～40 字。不合格回 null，空的回 ''。 */
function normLine(v) {
  var s = nfkc(v).trim();
  if (!s) return '';
  return LINE_RE.test(s) ? s : null;
}

/** 卡片上看得到的文字 → { slug, title, detail, name }。name 是要送給景泰的那一行（≤60 字）。 */
function describe(btn, slug) {
  var card = btn && btn.closest ? btn.closest('.card') : null;
  var q = function (sel) { return card ? card.querySelector(sel) : null; };
  var title = txt(q('.card-tagline')) || txt({ textContent: btn.getAttribute('data-name') || '' }) ||
    (card ? card.getAttribute('data-community') || '' : '') || '物件';
  var floor = '';
  // 標題已經有樓層（「10樓」「7F」）就不再補；只認「數字＋F」，不會被社區名裡的英文 f 騙到
  if (!/樓|\d\s*F\b/i.test(title)) {
    var f = txt(q('.card-floor'));
    if (f) floor = /樓|\d\s*F\b/i.test(f) ? f : f + ' 樓';
  }
  var price = txt(q('.card-price'));
  if (price) {
    var unit = txt(q('.card-price-unit'));
    price = price + (unit ? ' ' + unit : '');
  }
  var area = '', firstPing = '';
  var specs = card ? card.querySelectorAll('.spec-item') : [];
  for (var i = 0; i < specs.length; i++) {
    var lab = txt(specs[i].querySelector('.spec-label'));
    var val = txt(specs[i].querySelector('.spec-value'));
    if (!val) continue;
    if (/權狀/.test(lab)) { area = val; break; }
    if (!firstPing && /坪/.test(lab + val)) firstPing = val;
  }
  if (!area) area = firstPing;
  var head = title + (floor ? ' ' + floor : '');
  var p = clip(price, 16), a = clip(area, 16);
  return {
    slug: slug,
    title: cut(head, 40),
    detail: [p, a].filter(Boolean).join('・'),
    name: clip([clip(head, 40), p, a].filter(Boolean).join('｜'), ITEM_MAX)
  };
}

/** 這個主機要送到哪裡：正式網域／本機 → 同源；舊網址 → 正式網域（跨網域）；其他主機 → ''（不啟動） */
function apiFor(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (/^(?:www\.)?teddy-house\.tw$/.test(h) || h === 'localhost' || h === '127.0.0.1') return API;
  if (h === OLD_HOST) return API_PROD;
  return '';
}

/** 頁面既有聯絡區的 LINE ID（a[href] 裡的 line.me/ti/p/~ID）。讀不到回 ''。 */
function lineFromPage(d) {
  try {
    var links = d.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var m = LINE_HREF_RE.exec(links[i].getAttribute('href') || '');
      if (m) return m[1];
    }
  } catch (e) { /* ignore */ }
  return '';
}

/** 表單驗證：回 { ok, errors:{欄位:訊息}, body } */
function validate(f) {
  var errors = {};
  var name = clip(f.name || '', NAME_MAX + 1);
  var line = normLine(f.line);
  var phone = normPhone(f.phone);
  var note = nfkc(f.note || '').trim();
  if (chars(name).length > NAME_MAX) errors.name = '稱呼最多 ' + NAME_MAX + ' 個字';
  if (line === null) errors.line = 'LINE ID 只能有英文、數字和 . _ -，請再確認一下';
  if (phone === null) errors.phone = '手機號碼請填 09 開頭的 10 碼';
  if (!errors.line && !errors.phone && !line && !phone) errors.contact = '請填 LINE ID 或手機號碼，至少一個';
  if (chars(note).length > NOTE_MAX) errors.note = '想問的最多 ' + NOTE_MAX + ' 個字';
  if (f.consent !== true) errors.consent = '請勾選同意，景泰才能聯絡你';
  var ok = true;
  for (var k in errors) if (Object.prototype.hasOwnProperty.call(errors, k)) ok = false;
  if (!ok) return { ok: false, errors: errors, body: null };
  var items = (f.items || []).slice(0, MAX_ITEMS).map(function (it) { return { slug: it.slug, name: it.name }; });
  var body = { share_id: f.shareId, items: items, consent: true, hp: String(f.hp || '') };
  if (name) body.name = name;
  if (line) body.line = line;
  if (phone) body.phone = phone;
  if (note) body.note = note;
  // 本文上限 4KB（伺服器會拒收）：超過就把物件名稱一路縮短。正常不會發生（12 間 × 60 字＋留言 200 字約 3.4KB）
  for (var lim = ITEM_MAX - 12; bytes(JSON.stringify(body)) > BODY_MAX && lim >= 12; lim -= 12) {
    for (var i = 0; i < items.length; i++) items[i].name = clip(items[i].name, lim);
  }
  return { ok: true, errors: errors, body: body };
}
function bytes(s) {
  try { if (typeof root.TextEncoder === 'function') return new root.TextEncoder().encode(s).length; } catch (e) { /* ignore */ }
  try { return unescape(encodeURIComponent(s)).length; } catch (e) { return s.length * 3; }
}

/* ---------- 畫面 ---------- */
var CSS = [
  '.sp-root,.sp-root *{box-sizing:border-box}',
  '.sp-root{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei","Noto Sans CJK TC",sans-serif;font-size:17px;line-height:1.6;color:#2c2522;letter-spacing:0}',
  '.sp-root [hidden]{display:none!important}',
  '.sp-bar{position:fixed;left:50%;bottom:calc(12px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9000;width:min(560px,calc(100% - 24px));display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;margin:0;background:#fffdf8;border:1px solid #d6c3a2;border-radius:16px;box-shadow:0 8px 28px rgba(60,45,20,.22)}',
  '.sp-count{flex:1;min-width:0;margin:0;font-size:17px;font-weight:700;color:#2c2522;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.sp-count b{color:#a85d3f;font-size:20px;font-weight:800;margin:0 2px}',
  '.sp-send,.sp-submit,.sp-okbtn{min-height:48px;padding:10px 18px;margin:0;border:0;border-radius:12px;background:#6b4a26;color:#fffdf8;font:inherit;font-size:17px;font-weight:800;cursor:pointer;white-space:nowrap}',
  '.sp-send:hover,.sp-submit:hover,.sp-okbtn:hover{background:#563b1e}',
  '.sp-min{min-height:48px;padding:8px 10px;margin:0;border:0;border-radius:10px;background:transparent;color:#6b4a26;font:inherit;font-size:17px;font-weight:700;cursor:pointer}',
  '.sp-chip{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9000;min-height:48px;padding:8px 18px;margin:0;border:2px solid #8a6539;border-radius:24px;background:#fffdf8;color:#6b4a26;font:inherit;font-size:17px;font-weight:800;cursor:pointer;box-shadow:0 6px 18px rgba(60,45,20,.2)}',
  '.sp-ov{position:fixed;inset:0;z-index:10040;background:rgba(44,37,34,.5)}',
  '.sp-sheet{position:fixed;left:50%;bottom:0;transform:translateX(-50%);z-index:10050;width:min(640px,100%);max-height:90vh;max-height:90dvh;overflow-y:auto;overscroll-behavior:contain;margin:0;padding:18px 16px calc(20px + env(safe-area-inset-bottom,0px));background:#fffdf8;border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(60,45,20,.25)}',
  '.sp-head{display:flex;align-items:flex-start;gap:12px;margin:0 0 6px}',
  '.sp-title{flex:1;margin:0;padding-top:6px;font-size:22px;line-height:1.4;font-weight:800;color:#2c2522;outline:none}',
  '.sp-x{width:48px;height:48px;flex:none;margin:0;padding:0;border:0;border-radius:12px;background:#f2ede4;color:#2c2522;font:inherit;font-size:24px;line-height:1;cursor:pointer}',
  '.sp-desc{margin:0 0 12px;color:#5a4d44}',
  '.sp-cap{margin:0 0 6px;font-weight:700;color:#6b4a26}',
  '.sp-list{list-style:none;margin:0 0 6px;padding:0;border:1px solid #e8dfd2;border-radius:12px;background:#fff}',
  '.sp-list li{margin:0;padding:10px 14px;border-top:1px solid #efe7da}',
  '.sp-list li:first-child{border-top:0}',
  '.sp-it-t{display:block;font-weight:700;color:#2c2522}',
  '.sp-it-d{display:block;color:#5a4d44}',
  '.sp-more{margin:0 0 6px;color:#5a4d44}',
  '.sp-form{display:grid;gap:14px;margin:14px 0 0}',
  '.sp-l{display:block;margin:0 0 6px;font-weight:700;color:#2c2522}',
  '.sp-in{display:block;width:100%;min-height:48px;margin:0;padding:10px 12px;border:1.5px solid #b9a382;border-radius:10px;background:#fff;color:#2c2522;font:inherit;font-size:17px}',
  'textarea.sp-in{min-height:96px;resize:vertical}',
  '.sp-in:focus{outline:3px solid #8a6539;outline-offset:1px;border-color:#8a6539}',
  '.sp-in[aria-invalid="true"]{border-color:#b3261e}',
  '.sp-fs{display:grid;gap:12px;margin:0;padding:10px 14px 14px;border:1px solid #e8dfd2;border-radius:12px;min-width:0}',
  '.sp-fs legend{padding:0 6px;font-weight:700;color:#2c2522}',
  '.sp-err{margin:6px 0 0;color:#b3261e;font-size:17px}',
  '.sp-ck{display:flex;gap:10px;align-items:flex-start;margin:0;font-weight:700;cursor:pointer}',
  '.sp-ck input{width:24px;height:24px;flex:none;margin:3px 0 0;accent-color:#6b4a26}',
  '.sp-fine{margin:0;color:#5a4d44;font-size:17px}',
  '.sp-msg{margin:0;font-size:17px;color:#2c2522}',
  '.sp-msg:empty{display:none}',
  '.sp-msg.is-err{color:#b3261e}',
  '.sp-msg a{color:#6b4a26;font-weight:800;text-decoration:underline}',
  '.sp-msg small{display:block;margin-top:4px;font-size:17px;color:#6b6258}',
  '.sp-submit{width:100%;min-height:52px;font-size:18px}',
  '.sp-submit[disabled]{opacity:.7;cursor:progress}',
  '.sp-done{margin:8px 0 4px;padding:18px 14px;text-align:center;border-radius:12px;background:#eef6ef;color:#1d5f34;font-weight:800;outline:none}',
  '.sp-okbtn{display:block;width:100%;margin-top:12px}',
  '.sp-hp{position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important}',
  '.sp-root button:focus-visible,.sp-chip:focus-visible{outline:3px solid #8a6539;outline-offset:2px}',
  'body.sp-on{padding-bottom:calc(var(--sp-lift,84px) + 12px)}',
  'body.sp-on .back-to-top,body.sp-on .print-fab{bottom:calc(var(--sp-lift,84px) + 14px)!important}',
  '@media (max-width:640px){body.sp-on .print-fab{bottom:calc(var(--sp-lift,84px) + 76px)!important}}',
  'body.sp-on .teddy-toast{bottom:calc(var(--sp-lift,84px) + 10px)!important}',
  '@media (prefers-reduced-motion:no-preference){.sp-bar{animation:sp-up .22s ease-out}}',
  '@keyframes sp-up{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}',
  // 列印／存 PDF（客人印 A4 售資）：浮動列不印，也不留它推出來的底部空白（審查 R6）
  '@media print{.sp-root{display:none!important}body.sp-on{padding-bottom:0!important}}'
].join('\n');

function el(tag, attrs, kids) {
  var n = doc.createElement(tag);
  if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'cls') n.className = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  if (kids) for (var i = 0; i < kids.length; i++) if (kids[i]) n.appendChild(kids[i]);
  return n;
}
function later(fn, ms) { try { return root.setTimeout(fn, ms || 0); } catch (e) { return 0; } }

function start() {
  if (!doc || !doc.body || root.__sharePick) return;
  var shareId = (ME && ME.getAttribute && ME.getAttribute('data-share')) || '';
  if (!ID_RE.test(shareId)) {
    var pm = /^\/share\/([A-Za-z0-9]{4,40})(?:\/|$)/i.exec((root.location && root.location.pathname) || '');
    shareId = pm ? pm[1] : '';
  }
  var api = apiFor(root.location && root.location.hostname);
  if (!api || !ID_RE.test(shareId) || !doc.querySelector('.card-like')) return;
  var cross = api !== API;
  root.__sharePick = true;

  var lineId = lineFromPage(doc);
  var collapsed = false, open = false, sending = false, opener = null, lastKey = '', sentKey = '', current = [];
  var prevOverflow = '';

  var style = el('style', { id: 'sp-style', text: CSS });
  (doc.head || doc.body).appendChild(style);

  /* 浮動列 */
  var countEl = el('p', { cls: 'sp-count', 'aria-live': 'polite', 'aria-atomic': 'true' });
  var sendBtn = el('button', { type: 'button', cls: 'sp-send', 'aria-haspopup': 'dialog', text: '傳給景泰' });
  var minBtn = el('button', { type: 'button', cls: 'sp-min', 'aria-expanded': 'true', 'aria-label': '收起這一列', text: '收起' });
  var bar = el('div', { cls: 'sp-bar', role: 'region', 'aria-label': '已選的物件' }, [countEl, sendBtn, minBtn]);
  var chip = el('button', { type: 'button', cls: 'sp-chip', 'aria-expanded': 'false' });

  /* 彈出表單 */
  var title = el('h2', { cls: 'sp-title', id: 'sp-title', tabindex: '-1', text: '把喜歡的物件傳給景泰' });
  var xBtn = el('button', { type: 'button', cls: 'sp-x', 'aria-label': '關閉', text: '×' });
  var desc = el('p', { cls: 'sp-desc', id: 'sp-desc', text: '景泰收到後，會先確認這幾間的現況，再用你留的方式聯絡你。' });
  var cap = el('p', { cls: 'sp-cap', id: 'sp-cap' });
  var list = el('ul', { cls: 'sp-list', 'aria-labelledby': 'sp-cap' });
  var more = el('p', { cls: 'sp-more', hidden: '' });

  function field(id, label, input, errId) {
    input.id = id;
    input.className = 'sp-in';
    input.setAttribute('aria-describedby', errId);
    var err = el('p', { cls: 'sp-err', id: errId, hidden: '' });
    return { wrap: el('div', null, [el('label', { cls: 'sp-l', for: id, text: label }), input, err]), input: input, err: err };
  }
  var fName = field('sp-name', '怎麼稱呼（選填）', el('input', { type: 'text', maxlength: String(NAME_MAX), autocomplete: 'name' }), 'sp-name-err');
  var fLine = field('sp-line', 'LINE ID', el('input', { type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email' }), 'sp-line-err');
  var fPhone = field('sp-phone', '手機號碼', el('input', { type: 'tel', maxlength: '20', autocomplete: 'tel', inputmode: 'tel', placeholder: '0912345678' }), 'sp-phone-err');
  var fNote = field('sp-note', '想問的（選填）', el('textarea', { rows: '3', maxlength: String(NOTE_MAX), placeholder: '例：想約週末看第 1 間' }), 'sp-note-err');
  var contactErr = el('p', { cls: 'sp-err', id: 'sp-contact-err', hidden: '' });
  var legend = el('legend', { text: '怎麼聯絡你（LINE 或手機，至少填一個）' });
  var fs = el('fieldset', { cls: 'sp-fs', 'aria-describedby': 'sp-contact-err' }, [legend, fLine.wrap, fPhone.wrap, contactErr]);
  // honeypot：畫面外、不可聚焦、讀屏不讀；真人不會填（只有它有 name，萬一腳本壞掉走原生送出，也只會送出這一格）。
  // name 用沒有語意的字（審查 R5）：叫 website 之類的，Safari 聯絡人自動填入或密碼管理員可能會幫真人填上，結果被當成機器人。
  var hpInput = el('input', { type: 'text', name: 'sp_x7', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
  var hp = el('div', { cls: 'sp-hp', 'aria-hidden': 'true' }, [el('label', { text: '這一格請留空' }), hpInput]);
  var consent = el('input', { type: 'checkbox', id: 'sp-ok', 'aria-describedby': 'sp-ok-err' });
  var consentErr = el('p', { cls: 'sp-err', id: 'sp-ok-err', hidden: '' });
  var consentWrap = el('div', null, [el('label', { cls: 'sp-ck', for: 'sp-ok' }, [consent, el('span', { text: '我同意景泰用這個方式聯絡我' })]), consentErr]);
  var fine = el('p', { cls: 'sp-fine', text: '資料只用來讓景泰聯絡你。' });
  var msg = el('p', { cls: 'sp-msg', role: 'status', 'aria-live': 'polite' });
  var submitBtn = el('button', { type: 'submit', cls: 'sp-submit', text: '傳給景泰' });
  // method／action 指向同一個端點：萬一腳本中途壞掉、瀏覽器走原生送出，也不會把資料放進網址（而且真正的欄位沒有 name，不會被送出）
  var form = el('form', { cls: 'sp-form', method: 'post', action: API, novalidate: '' },
    [fName.wrap, fs, fNote.wrap, hp, consentWrap, fine, msg, submitBtn]);
  var done = el('div', { cls: 'sp-done', tabindex: '-1', hidden: '' });
  var okBtn = el('button', { type: 'button', cls: 'sp-okbtn', hidden: '', text: '好' });
  var sheet = el('div', { cls: 'sp-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sp-title', 'aria-describedby': 'sp-desc', hidden: '' },
    [el('div', { cls: 'sp-head' }, [title, xBtn]), desc, cap, list, more, form, done, okBtn]);
  var overlay = el('div', { cls: 'sp-ov', hidden: '' });
  var rootEl = el('div', { cls: 'sp-root', id: 'sp-root' }, [bar, chip, overlay, sheet]);
  bar.hidden = true;
  chip.hidden = true;

  form.addEventListener('submit', function (e) {
    try { e.preventDefault(); } catch (x) { /* ignore */ }
    try { send(); } catch (x) { /* ignore */ }
  });
  doc.body.appendChild(rootEl);

  /* ---------- 已選幾間 ---------- */
  function stored(slug) {
    try { return root.localStorage.getItem('teddy_like_' + shareId + '_' + slug) === '1'; } catch (e) { return false; }
  }
  function collect() {
    var out = [], seen = {};
    var btns = doc.querySelectorAll('.card-like');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], slug = b.getAttribute('data-slug') || '';
      if (!SLUG_RE.test(slug) || seen[slug]) continue;
      var on = (b.classList && b.classList.contains('liked')) || stored(slug);
      if (!on) continue;
      seen[slug] = 1;
      out.push(describe(b, slug));
    }
    return out;
  }
  function setLift() {
    try {
      var h = bar.getBoundingClientRect ? bar.getBoundingClientRect().height : 0;
      if (h && doc.body.style && typeof doc.body.style.setProperty === 'function') doc.body.style.setProperty('--sp-lift', Math.ceil(h + 12) + 'px');
    } catch (e) { /* ignore */ }
  }
  function paint() {
    var n = current.length;
    var showBar = n > 0 && !collapsed && !open;
    bar.hidden = !showBar;
    chip.hidden = !(n > 0 && collapsed && !open);
    if (doc.body.classList) {
      if (showBar) doc.body.classList.add('sp-on'); else doc.body.classList.remove('sp-on');
    }
    if (showBar) setLift();
  }
  function refresh() {
    try {
      current = collect();
      var key = current.map(function (it) { return it.slug; }).join(',');
      if (key !== lastKey) {
        lastKey = key;
        var n = current.length;
        countEl.textContent = '';
        countEl.appendChild(doc.createTextNode('已選'));
        countEl.appendChild(el('b', { text: String(n) }));
        countEl.appendChild(doc.createTextNode(key && key === sentKey ? '間・已傳給景泰' : '間'));
        chip.textContent = '♥ 已選 ' + n + ' 間';
        chip.setAttribute('aria-label', '已選 ' + n + ' 間，點一下打開傳給景泰的那一列');
        if (!n && open) closeSheet(false);
      }
      paint();
    } catch (e) { /* ignore */ }
  }
  var pending = 0;
  function soon() { if (!pending) pending = later(function () { pending = 0; refresh(); }, 30); }

  /* ---------- 彈出表單：開、關、焦點 ---------- */
  function focusables() {
    var all = sheet.querySelectorAll('button, a, input, textarea, select'), out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.disabled || n.getAttribute('tabindex') === '-1' || (n.closest && n.closest('[hidden]'))) continue;
      out.push(n);
    }
    return out;
  }
  function fill() {
    list.textContent = '';
    var show = current.slice(0, MAX_ITEMS);
    for (var i = 0; i < show.length; i++) {
      list.appendChild(el('li', null, [
        el('span', { cls: 'sp-it-t', text: (i + 1) + '. ' + show[i].title }),
        show[i].detail ? el('span', { cls: 'sp-it-d', text: show[i].detail }) : null
      ]));
    }
    cap.textContent = '你選的 ' + current.length + ' 間';
    more.hidden = current.length <= MAX_ITEMS;
    more.textContent = '一次最多傳 ' + MAX_ITEMS + ' 間，這次會先傳前 ' + MAX_ITEMS + ' 間。';
  }
  function openSheet() {
    refresh();
    if (!current.length || open) return;
    opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : sendBtn;
    open = true;
    fill();
    form.hidden = false;
    done.hidden = true;
    okBtn.hidden = true;
    overlay.hidden = false;
    sheet.hidden = false;
    try { prevOverflow = doc.documentElement.style.overflow || ''; doc.documentElement.style.overflow = 'hidden'; } catch (e) { /* ignore */ }
    paint();
    try { title.focus(); } catch (e) { /* ignore */ }
  }
  function closeSheet(restore) {
    if (!open) return;
    open = false;
    sheet.hidden = true;
    overlay.hidden = true;
    try { doc.documentElement.style.overflow = prevOverflow; } catch (e) { /* ignore */ }
    paint();
    if (restore !== false) {
      var back = collapsed ? chip : sendBtn;
      if (opener && opener !== sendBtn && opener !== chip && opener.focus && !(opener.closest && opener.closest('[hidden]'))) back = opener;
      try { back.focus(); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- 表單：錯誤、送出 ---------- */
  function setErr(input, errEl, text) {
    if (input) {
      if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    errEl.textContent = text || '';
    errEl.hidden = !text;
  }
  function clearErrs() {
    setErr(fName.input, fName.err, '');
    setErr(fLine.input, fLine.err, '');
    setErr(fPhone.input, fPhone.err, '');
    setErr(fNote.input, fNote.err, '');
    setErr(null, contactErr, '');
    setErr(consent, consentErr, '');
  }
  function setMsg(nodes, isErr) {
    msg.textContent = '';
    msg.className = 'sp-msg' + (isErr ? ' is-err' : '');
    for (var i = 0; i < nodes.length; i++) msg.appendChild(typeof nodes[i] === 'string' ? doc.createTextNode(nodes[i]) : nodes[i]);
  }
  function failMsg(kind, diag) {
    var nodes = [];
    if (kind === 'rate') nodes.push('剛剛送了好幾次，請過幾分鐘再試。');
    if (lineId) {
      nodes.push(kind === 'rate' ? '也可以直接加 LINE：' : '目前送不出去，可以直接加 LINE：');
      nodes.push(el('a', { href: 'https://line.me/ti/p/~' + lineId, target: '_blank', rel: 'noopener', text: lineId }));
    } else if (kind !== 'rate') {
      nodes.push('目前送不出去，請稍後再試一次。');
    }
    if (diag && /^[a-z0-9-]{1,40}$/i.test(diag)) nodes.push(el('small', { text: '代碼：' + diag }));
    setMsg(nodes, true);
  }
  function lock(on) {
    sending = on;
    submitBtn.disabled = on;
    if (on) submitBtn.setAttribute('aria-busy', 'true'); else submitBtn.removeAttribute('aria-busy');
    submitBtn.textContent = on ? '傳送中…' : '傳給景泰';
  }
  function resetForm() {
    fName.input.value = '';
    fLine.input.value = '';
    fPhone.input.value = '';
    fNote.input.value = '';
    hpInput.value = '';
    consent.checked = false;
    clearErrs();
  }
  function succeed() {
    sentKey = lastKey;
    lastKey = '';
    resetForm();
    setMsg([], false);
    form.hidden = true;
    done.textContent = '已傳給景泰，他會盡快聯絡你';
    done.hidden = false;
    okBtn.hidden = false;
    try { done.focus(); } catch (e) { /* ignore */ }
    refresh();
  }
  function send() {
    if (sending) return;
    refresh();
    clearErrs();
    var v = validate({
      shareId: shareId, items: current, name: fName.input.value, line: fLine.input.value, phone: fPhone.input.value,
      note: fNote.input.value, consent: !!consent.checked, hp: hpInput.value
    });
    if (!v.ok) {
      var E = v.errors, first = null;
      if (E.name) { setErr(fName.input, fName.err, E.name); first = first || fName.input; }
      if (E.line) { setErr(fLine.input, fLine.err, E.line); first = first || fLine.input; }
      if (E.phone) { setErr(fPhone.input, fPhone.err, E.phone); first = first || fPhone.input; }
      if (E.contact) { setErr(null, contactErr, E.contact); fLine.input.setAttribute('aria-invalid', 'true'); first = first || fLine.input; }
      if (E.note) { setErr(fNote.input, fNote.err, E.note); first = first || fNote.input; }
      if (E.consent) { setErr(consent, consentErr, E.consent); first = first || consent; }
      setMsg(['還有地方要補，請看紅字。'], true);
      try { if (first) first.focus(); } catch (e) { /* ignore */ }
      return;
    }
    if (!v.body.items.length) { closeSheet(); return; }
    if (typeof root.fetch !== 'function') { failMsg('other', ''); return; }
    lock(true);
    setMsg(['傳送中，請稍等…'], false);
    var ctl = null, timer = 0;
    try { if (typeof root.AbortController === 'function') { ctl = new root.AbortController(); timer = later(function () { try { ctl.abort(); } catch (e) { /* ignore */ } }, TIMEOUT_MS); } } catch (e) { ctl = null; }
    // referrerPolicy：推薦頁整頁是 no-referrer；這一個請求改成只帶網域（不帶 /share/<代號>/ 路徑），
    // 伺服器沒收到 Origin 時（少數內建瀏覽器）還能用它判斷來源。跨網域（舊網址）不帶 cookie。
    var init = {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v.body),
      credentials: cross ? 'omit' : 'same-origin', mode: 'cors', referrerPolicy: 'origin'
    };
    if (ctl) init.signal = ctl.signal;
    var status = 0;
    root.fetch(api, init).then(function (res) {
      status = res.status;
      return res.json().catch(function () { return null; });
    }).then(function (j) {
      if (timer) try { root.clearTimeout(timer); } catch (e) { /* ignore */ }
      lock(false);
      if (status === 200 && j && j.ok === true && j.saved === true) succeed();
      else failMsg(status === 429 ? 'rate' : 'other', j && typeof j.diag === 'string' ? j.diag : '');
    }, function () {
      if (timer) try { root.clearTimeout(timer); } catch (e) { /* ignore */ }
      lock(false);
      failMsg('other', '');
    });
  }

  /* ---------- 事件 ---------- */
  function on(t, type, fn) { t.addEventListener(type, function (e) { try { fn(e); } catch (x) { /* ignore */ } }); }
  on(sendBtn, 'click', function () { openSheet(); });
  on(minBtn, 'click', function () {
    collapsed = true;
    minBtn.setAttribute('aria-expanded', 'false');
    paint();
    try { chip.focus(); } catch (e) { /* ignore */ }
  });
  on(chip, 'click', function () {
    collapsed = false;
    minBtn.setAttribute('aria-expanded', 'true');
    paint();
    try { sendBtn.focus(); } catch (e) { /* ignore */ }
  });
  on(xBtn, 'click', function () { closeSheet(); });
  on(okBtn, 'click', function () { closeSheet(); });
  on(overlay, 'click', function () { if (!sending) closeSheet(); });
  // 鍵盤：Esc 關閉；Tab 只在表單裡面打轉（焦點跑到外面也拉回來）
  on(doc, 'keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (!sending) { e.preventDefault(); closeSheet(); }
      return;
    }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], act = doc.activeElement;
    var inside = act && sheet.contains(act);
    if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (act === first || act === title)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
  });
  // 頁面原本的「我喜歡」：按下去之後頁面自己會加上 liked。document 上的監聽在按鈕自己的監聽之後才跑，再延一拍保險。
  on(doc, 'click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.card-like')) soon();
  });
  try {
    if (typeof root.MutationObserver === 'function') {
      new root.MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var c = ms[i].target && ms[i].target.className;
          if (typeof c === 'string' && c.indexOf('card-like') >= 0) { soon(); return; }
        }
      }).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  } catch (e) { /* ignore */ }
  try { if (root.addEventListener) { root.addEventListener('storage', function () { soon(); }); root.addEventListener('resize', function () { try { if (!bar.hidden) setLift(); } catch (e) { /* ignore */ } }); } } catch (e) { /* ignore */ }

  refresh();
}

var exp = { clip: clip, cut: cut, normPhone: normPhone, normLine: normLine, describe: describe, lineFromPage: lineFromPage, validate: validate, apiFor: apiFor, MAX_ITEMS: MAX_ITEMS, ITEM_MAX: ITEM_MAX };
if (typeof module !== 'undefined' && module.exports) module.exports = exp;
if (doc && root.location) {
  var boot = function () { try { start(); } catch (e) { /* 靜默：推薦頁原本的功能不受影響 */ } };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
}
})(typeof window !== 'undefined' ? window : globalThis);
