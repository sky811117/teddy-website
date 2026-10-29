/*! find-ai.js 找房小幫手「那句話先交給 AI 讀」（2026-10-29 景泰：「AI在輸入需求那邊就要介入了 第一手就要介入了」）。
 * 客人在開場打完一句話、按送出時，先把那句話交給官網的 understand 端點（官網 Function 驗過人機驗證才轉給家用機，
 * 家用機 AI 先讀、規則補洞），拿回來的條件直接進「我聽到的」。家用機回報 caps 有 ai、客人開始打字時才由 find-app.js 載入
 * （網址在 #s0-live 的 data-src）。
 * 讀不到（逾時、人機驗證沒好、家用機沒開、任何錯誤）一律照瀏覽器裡的規則讀（find-app 原本的結果），客人感覺不到差別。
 * 只透過 find-app 給的 api（init(api)）送請求、拿人機驗證 token；拿回來的條件再過一次 NeedExtract.normalizeFields 白名單。
 * 沒有儲存；所有文字都在頁面上（#ai-wait），只切換顯示。掛 window.FindAI。 */
(function (root) {
'use strict';

var LIMIT_MS = 9000;     // 從按送出起算，最多等這麼久；超過就照瀏覽器規則讀（家用機那頭最多等 8 秒）
var A = null, busy = false;

function byId(id) { return root.document.getElementById(id); }

/* AI 讀到的條件取代瀏覽器規則讀到的條件；其餘（在意的事、被拿掉的字、個資提示、範圍的猜測）照瀏覽器規則 */
function merge(r, fields) {
  var NE = root.NeedExtract, o = Object.assign({}, r), a;
  o.fields = NE.normalizeFields(fields).fields;
  o.inferred = [];
  a = NE.assess(o.fields);
  o.level = r.out_of_scope ? 'empty' : a.level;
  o.missing = a.missing;
  o.ai = true;
  return o;
}

/* 客人開始打字時：先把人機驗證準備好，按送出時 token 多半已經在手上 */
function prep() { if (A) A.ensureTs(); }

/* text：客人那句話（已截 300 字）；r：瀏覽器規則讀到的結果；done(結果) 一定只叫一次 */
function read(text, r, done) {
  var S = A && A.S(), fin = false, w = byId('ai-wait'), t;
  if (busy) return;                                 // 讀取中又按一次：不重送
  if (!S || !S.siteKey || r.out_of_scope) { done(r); return; }   // 沒有人機驗證就問不了；外縣市不用問
  function end(x) {
    if (fin) return;
    fin = true; busy = false;
    root.clearTimeout(t);
    if (w) w.hidden = true;
    done(x);
  }
  busy = true;
  if (w) w.hidden = false;
  t = root.setTimeout(function () { end(r); }, LIMIT_MS);
  A.token().then(function (tok) {
    if (!tok || fin) { end(r); return; }
    return A.api('understand', 'POST', { v: 1, text: text, turnstile: tok }).then(function (res) {
      var j = res.j || {};
      end(j.ok === true && j.fields && typeof j.fields === 'object' && !Array.isArray(j.fields) ? merge(r, j.fields) : r);
    });
  }).catch(function () { end(r); });
}

function init(api) { A = api; return root.FindAI; }

root.FindAI = { init: init, prep: prep, read: read, merge: merge };
})(typeof window !== 'undefined' ? window : globalThis);
