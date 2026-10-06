/*! find-app.js 找房小幫手：對話流程、送出、等待與輪詢、結果、降級、回饋與匿名使用事件。
 * 只呼叫同源的 /api/find/*；所有給客人看的文字都在本檔的固定表，不顯示任何伺服器端文字。
 * 沒有第三方分析：事件只送 /api/find/event，內容只有步驟代碼與數值，不含任何自由文字或個資。
 * classic script。純邏輯放在 FindCore（Node 可測）；DOM 部分只在瀏覽器執行。
 */
(function (root) {
'use strict';

var NE = root.NeedExtract;
var API = '/api/find/';
var SESSION_KEY = 'find.v1';

/* ===================== 固定文案與選項（鍵名與設計文件一致） ===================== */
var DIST_MAIN = ['北屯區', '西屯區', '南屯區', '北區', '西區', '南區', '東區', '太平區', '大里區', '烏日區', '潭子區', '大雅區'];
var CONCERN_OPTS = [['budget_pressure', '每月還款壓力'], ['loan', '貸款過不過'], ['condition', '屋況（漏水、壁癌）'], ['commute', '通勤時間'], ['school', '孩子的學區'], ['elderly', '長輩出入方便'], ['price_unsure', '不知道行情，怕買貴'], ['overwhelmed', '選太多，不知道從哪看起'], ['parking', '車位不好找'], ['timing', '不確定現在是不是時機'], ['no_chase', '不想被一直追問、打電話'], ['other', '其他']];
var TYPE_OPTS = [['elevator_building', '電梯大樓'], ['mid_rise', '華廈'], ['apartment', '公寓'], ['townhouse', '透天'], ['studio', '套房']];
var PK_OPTS = [['flat', '平面車位'], ['ramp_flat', '坡道平面'], ['mechanical', '機械也可以'], ['any', '有車位就好'], ['none', '不需要']];
var PK_LABEL = { flat: '平面車位', ramp_flat: '坡道平面車位', mechanical: '機械車位', any: '有車位', none: '不需要車位' };
var AGE_OPTS = [[5, '5 年內'], [10, '10 年內'], [20, '20 年內'], [30, '30 年內'], [0, '不限']];
var STAGE_OPTS = [['first', '第一次買'], ['upgrade', '換屋（賣舊買新）'], ['invest', '投資'], ['browse', '還在看看']];
var TL_OPTS = [['3m', '3 個月內'], ['6m', '半年內'], ['12m', '一年內'], ['browse', '還沒決定']];
var SPECIAL_OPTS = [['school', '學區'], ['market', '近市場、生活機能'], ['low_public', '公設比低'], ['lighting', '採光通風'], ['pets', '可養寵物'], ['elderly', '長輩友善'], ['quiet', '安靜'], ['transit', '交通方便（已通車路線）']];
var AREA_OPTS = [['lt20', '20 坪以下'], ['20_30', '20–30 坪'], ['30_40', '30–40 坪'], ['40_50', '40–50 坪'], ['ge50', '50 坪以上'], ['any', '不限']];
var AREA_RANGE = { lt20: [null, 20], '20_30': [20, 30], '30_40': [30, 40], '40_50': [40, 50], ge50: [50, null] };
var BUDGETS = [1000, 1500, 2000, 2500, 3000, 4000];
var ERR_MSG = {
  E_BAD_REQUEST: '資料格式不正確，請重新整理頁面後再試一次。', E_CONSENT: '留聯絡方式需要先勾選同意。', E_ORIGIN: '請從網站頁面使用。',
  E_HUMAN: '沒能完成人機驗證，請按下面的「再試一次」。', E_TOO_LARGE: '內容太長了，請縮短一點再送出。', E_RATE: '操作太頻繁，請稍等一下再試。',
  E_NOT_FOUND: '找不到這筆需求，可能已經過期了。', E_FORWARD: '暫時送不出去，請稍後再試一次。'
};
/* 降級訊息依「客人有沒有留聯絡方式」分兩套（匿名的客人景泰根本沒辦法回覆，不能說「景泰會回覆你」）；全站稱呼統一用「你」 */
var DEGRADE_MSG = {
  general: '需求記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來這頁看看。',
  busy: '現在比較多人，需求先記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來看看。',
  night: '現在是深夜，需求先記下來了。想明天收到回覆，請留 LINE 或電話。'
};
var DEGRADE_MSG_CONTACT = {
  general: '收到了，景泰會用你留的方式回覆你。',
  busy: '現在比較多人，景泰會用你留的方式回覆你。',
  night: '現在是深夜，景泰明天一早會用你留的方式回覆你。'
};
var DEGRADE_MSG_NOCHASE = {
  general: '需求記下來了。你選了不想被追問，所以我不會要你留資料；想問的時候，直接 LINE 景泰就好。',
  busy: '現在比較多人，需求先記下來了。你選了不想被追問，所以我不會要你留資料；想問的時候，直接 LINE 景泰就好。',
  night: '現在是深夜，需求先記下來了。你選了不想被追問，所以我不會要你留資料；想問的時候，直接 LINE 景泰就好。'
};
var INTAKE_TEXT = '目前我還不能自動找：你的需求會交給景泰看過。想讓他回你的話，可以留 LINE 或電話（選填）。';
var TS_RETRY_HINT = '還沒完成人機驗證。請先完成上面的驗證，再按一次。';
var CFG_RETRY_HINT = '頁面沒有載入完整，沒辦法確認是真人。請重新整理這一頁再試一次。';
var QCOPY = {
  q_district: ['想找哪一區？', '最多選 2 個，之後可以再換。不選也可以，我會先找整個台中。'],
  q_budget: ['預算上限大概多少？', '先抓個範圍就好，之後可以調。不確定也沒關係，選「還不確定」，我會用比較寬的範圍先找。'],
  q_rooms: ['想要幾房？', '可以複選，相鄰的會當成一個範圍。'],
  q_concerns: ['（選填）買房這件事，你最在意或擔心什麼？', '不影響找到的房子，只讓景泰之後更懂你。沒有標準答案，也可以直接略過。'],
  q_parking: ['車位呢？', '車位型式會影響每天好不好停，先選你的底線就好。'],
  q_age: ['屋齡有想避開的嗎？', '選一個上限就好。'],
  q_stage: ['（選填）你現在比較像哪一種？', '不影響找到的房子，只是讓景泰知道從哪聊起。'],
  q_timeline: ['（選填）大概什麼時候想有結果？', '不影響找到的房子。沒有標準答案，不會有人因為這題催你。']
};
var HINT_COPY = {
  loosen_price: '預算放寬一點', loosen_district: '多看一個區', loosen_rooms: '房數不限', loosen_age: '屋齡不限',
  drop_parking: '車位不用平面也可以', drop_floor: '樓層不限制'
};
/* 客人自己更正過、抽取器不確定最後要哪個：那一欄標「請確認」，前面接欄名、用一句白話問他（不責備、不嚇人，也不替他決定） */
var UNSURE = { district: '區域', rooms: '房數', price: '預算' };
var UNSURE_ASK = '你好像更正過，我先照聽到的放進來。哪一個才是你要的？';
var HINT_OK = ['loan', 'condition', 'commute', 'school', 'price_unsure'];
var SOFT_Q = ['q_concerns', 'q_stage', 'q_timeline'];   // 不影響搜尋、只讓景泰之後更懂客人的選填題
var NO_CHASE_ACK = '好，我不會問你要電話，這一頁也不會有要你留資料的欄位。';
var FIELD_CODE = { districts: 'district', price_min_wan: 'price', price_max_wan: 'price', rooms_min: 'rooms', rooms_max: 'rooms', types: 'type', parking: 'parking', age_max: 'age', area_min_ping: 'area', area_max_ping: 'area', floor_exclude: 'floor', exclude_top: 'floor', floor_min: 'floor' };

/* ===================== 純邏輯（Node 可測） ===================== */
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function has(v) { return v !== null && v !== undefined; }
function labelOf(opts, v) { for (var i = 0; i < opts.length; i++) if (opts[i][0] === v) return opts[i][1]; return ''; }

function roomsText(f) {
  if (has(f.rooms_min) && has(f.rooms_max)) return f.rooms_min === f.rooms_max ? f.rooms_min + ' 房' : f.rooms_min + '～' + f.rooms_max + ' 房';
  if (has(f.rooms_min)) return f.rooms_min + ' 房以上';
  if (has(f.rooms_max)) return f.rooms_max + ' 房以內';
  return '';
}
function priceText(f) {
  if (has(f.price_min_wan) && has(f.price_max_wan)) return f.price_min_wan + '～' + f.price_max_wan + ' 萬';
  if (has(f.price_max_wan)) return f.price_max_wan + ' 萬以內';
  if (has(f.price_min_wan)) return f.price_min_wan + ' 萬以上';
  return '';
}
function areaText(f) {
  if (has(f.area_min_ping) && has(f.area_max_ping)) return f.area_min_ping + '～' + f.area_max_ping + ' 坪';
  if (has(f.area_min_ping)) return f.area_min_ping + ' 坪以上';
  if (has(f.area_max_ping)) return f.area_max_ping + ' 坪以內';
  return '';
}
function floorText(f) {
  var p = [];
  if (f.floor_exclude && f.floor_exclude.length) p.push('不要 ' + f.floor_exclude.join('、') + ' 樓');
  if (f.exclude_top) p.push('不含頂樓');
  if (has(f.floor_min)) p.push(f.floor_min + ' 樓以上');
  return p.join('、');
}
/* 需求單的列：[鍵, 標題, 文字]（沒有值的必問三項也列出，方便點「改」） */
function sheetRows(f) {
  var rows = [['district', '區域', (f.districts || []).join('、') + (f.road || '') || '不限']];
  rows.push(['price', '預算', priceText(f) || '不限']);
  rows.push(['rooms', '房數', roomsText(f) || '不限']);
  if (f.types && f.types.length) rows.push(['type', '型態', f.types.map(function (t) { return labelOf(TYPE_OPTS, t); }).join('、')]);
  if (f.parking) rows.push(['parking', '車位', PK_LABEL[f.parking] || '']);
  if (has(f.age_max)) rows.push(['age', '屋齡', f.age_max + ' 年內']);
  var fl = floorText(f);
  if (fl) rows.push(['floor', '樓層', fl]);
  var ar = areaText(f);
  if (ar) rows.push(['area', '坪數', ar]);
  return rows;
}
/* u＝客人更正過、不確定要哪個的欄位（'district'／'price'／'rooms'），那一項後面加「（請確認）」 */
function condTags(f, u) {
  var t = [];
  function add(k, s) { if (s) t.push(s + (u && u.indexOf(k) >= 0 ? '（請確認）' : '')); }
  add('district', f.districts && f.districts.length ? f.districts.join('、') + (f.road || '') : '');
  add('rooms', roomsText(f));
  add('type', f.types && f.types.length ? f.types.map(function (x) { return labelOf(TYPE_OPTS, x); }).join('、') : '');
  add('price', priceText(f));
  add('age', has(f.age_max) ? f.age_max + ' 年內' : '');
  add('parking', f.parking ? PK_LABEL[f.parking] : '');
  add('floor', floorText(f));
  add('area', areaText(f));
  return t;
}
/* 抽取器說客人「更正過、但不確定最後要哪個」（inferred 含 correction_unsure）。它沒說是哪一欄，從抽出來的樣子猜：
   兩個區都留著＝區域；房數是範圍＝房數；這兩種都不是，就只剩預算（只留了第一個數字）。猜不到就不標（保守）。 */
function unsureKeys(f, inf) {
  var k = [];
  if (!inf || inf.indexOf('correction_unsure') < 0) return k;
  if ((f.districts || []).length > 1) k.push('district');
  if (has(f.rooms_min) && has(f.rooms_max) && f.rooms_min !== f.rooms_max) k.push('rooms');
  if (!k.length && (has(f.price_min_wan) || has(f.price_max_wan))) k.push('price');
  return k;
}
/* 路名是否在門牌索引裡（r＝index.json 的 r）。與伺服器端 knownRoad 同一個判斷：全市比對、「臺」當「台」、帶「N 段」的路也認不帶段的寫法 */
function roadKnown(r, road) {
  var ks = Object.keys(r);
  return ks.length < 500 || ks.some(function (k) { k = k.replace(/臺/g, '台'); return k === road || k.replace(/[一二三四五六七八九十]{1,2}段$/, '') === road; });   // 少於 500 條＝不像完整索引，當作無法判斷
}
function quietTags(c) {
  var t = [];
  (c.concerns || []).forEach(function (k) { t.push(labelOf(CONCERN_OPTS, k)); });
  if (c.stage) t.push(labelOf(STAGE_OPTS, c.stage));
  if (c.timeline) t.push(labelOf(TL_OPTS, c.timeline) + '想有結果');
  (c.special || []).forEach(function (k) { t.push(labelOf(SPECIAL_OPTS, k)); });
  return t;
}
function gotCodes(f) {
  var out = [];
  Object.keys(f).forEach(function (k) { var c = FIELD_CODE[k]; if (c && out.indexOf(c) < 0) out.push(c); });
  return out;
}
function lenBucket(n) { return n <= 20 ? 0 : n <= 60 ? 1 : n <= 150 ? 2 : 3; }

/* 把一題的答案寫進條件（val=null 代表略過／清空）。回傳 {fields, context}（新物件，不改原本的） */
function applyAnswer(fields, context, qid, val) {
  var f = clone(fields), c = clone(context);
  function del() { for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]]; }
  if (qid === 'q_district') { if (val && val.length) f.districts = val.slice(0, 2); else del(f, 'districts', 'road'); if ((f.districts || []).length > 1) delete f.road; }   // 路段不能沒有區域單獨存在（RT-11）
  else if (qid === 'q_budget') { if (has(val)) f.price_max_wan = val; else del(f, 'price_max_wan', 'price_min_wan'); }
  else if (qid === 'q_rooms') {
    del(f, 'rooms_min', 'rooms_max');
    if (val && val.length) {
      var lo = Math.min.apply(null, val), hi = Math.max.apply(null, val);
      f.rooms_min = lo;
      if (hi < 5) f.rooms_max = hi; // 5＝5 房以上：只有下限
    }
  }
  else if (qid === 'q_concerns') { if (val && val.length) c.concerns = val.slice(); else del(c, 'concerns'); }
  else if (qid === 'q_parking') { if (val) f.parking = val; else del(f, 'parking'); }
  else if (qid === 'q_age') { if (val) f.age_max = val; else del(f, 'age_max'); }
  else if (qid === 'q_stage') { if (val) c.stage = val; else del(c, 'stage'); }
  else if (qid === 'q_timeline') { if (val) c.timeline = val; else del(c, 'timeline'); }
  return { fields: NE.normalizeFields(f).fields, context: NE.normalizeContext(c).context };
}
/* 回上一題／修改時，先把目前的值勾起來 */
function preselect(fields, context, qid, hints) {
  var f = fields, c = context;
  if (qid === 'q_district') return f.districts || [];
  if (qid === 'q_budget') return has(f.price_max_wan) ? [f.price_max_wan] : [];
  if (qid === 'q_rooms') {
    if (!has(f.rooms_min) && !has(f.rooms_max)) return [];
    var lo = has(f.rooms_min) ? f.rooms_min : 1, hi = has(f.rooms_max) ? f.rooms_max : 5, out = [];
    for (var i = lo; i <= Math.min(hi, 5); i++) out.push(i);
    return out;
  }
  if (qid === 'q_concerns') return c.concerns || hints || [];
  if (qid === 'q_parking') return f.parking ? [f.parking] : [];
  if (qid === 'q_age') return has(f.age_max) ? [f.age_max] : [];
  if (qid === 'q_stage') return c.stage ? [c.stage] : [];
  if (qid === 'q_timeline') return c.timeline ? [c.timeline] : [];
  return [];
}
/* 小幫手回的那一句「記下來了」：確定性模板，不是 LLM，也不複述敏感內容的細節 */
function ackText(qid, val, picked) {
  val = val || [];
  if (!picked) return '好，先跳過。';
  if (qid === 'q_district') return val.length ? '記下來了：' + val.join('、') + '。' : '好，我先找整個台中。';
  if (qid === 'q_budget') return val.length ? '預算 ' + val[0] + ' 萬以內，記下來了。' : '好，我會用比較寬的範圍先找。';
  if (qid === 'q_concerns') {
    if (val.indexOf('no_chase') >= 0) return NO_CHASE_ACK;
    if (!val.length) return '好。';
    return '記下來了：' + val.map(function (k) { return labelOf(CONCERN_OPTS, k); }).join('、') + '。這些只讓景泰知道從哪聊起，不會拿去搜尋。';
  }
  return '記下來了。';
}
/* 空結果的一鍵放寬 */
function hintFix(f, c, hint) {
  var g = clone(f);
  if (hint === 'loosen_price' && has(g.price_max_wan)) g.price_max_wan = Math.min(100000, Math.round(g.price_max_wan * 1.1 / 50) * 50);
  else if (hint === 'loosen_rooms') { delete g.rooms_min; delete g.rooms_max; }
  else if (hint === 'loosen_age') delete g.age_max;
  else if (hint === 'drop_parking') delete g.parking;
  else if (hint === 'drop_floor') { delete g.floor_exclude; delete g.exclude_top; delete g.floor_min; }
  return NE.normalizeFields(g).fields;
}
function hintDetail(f, hint) {
  if (hint === 'loosen_price' && has(f.price_max_wan)) return f.price_max_wan + ' 萬以內，改成 ' + Math.round(f.price_max_wan * 1.1 / 50) * 50 + ' 萬以內';
  if (hint === 'loosen_district') return (f.districts || []).join('、') + '，再加一個區';
  if (hint === 'loosen_rooms') return '現在是 ' + roomsText(f);
  if (hint === 'loosen_age') return '現在是 ' + f.age_max + ' 年內';
  if (hint === 'drop_parking') return '現在是' + (PK_LABEL[f.parking] || '');
  if (hint === 'drop_floor') return '現在是 ' + floorText(f);
  return '';
}
function summaryText(f, c) {
  var l = ['條件：' + (condTags(f).join('｜') || '（沒有）')];
  var q = (c.concerns || []).map(function (k) { return labelOf(CONCERN_OPTS, k); });
  if (q.length) l.push('在意的事：' + q.join('、'));
  return l.join('\n');
}
function newId() {
  var a = new Uint8Array(16), s = '';
  if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
  else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
  for (var j = 0; j < a.length; j++) s += String.fromCharCode(a[j]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* 輪詢間隔（紅隊 RT-05：每一次輪詢都是一次 Function 呼叫，吃免費額度）：前景 6 秒起、超過 1 分鐘 8 秒、連線不穩時退到 10 秒、
   連續失敗後 30 秒；離開分頁（背景）30 秒。 */
function pollDelay(elapsedMs, pollMs, unknowns, lowFreq) {
  if (lowFreq) return 30000;
  if (unknowns > 0) return unknowns === 1 ? 6000 : unknowns === 2 ? 8000 : 10000;
  var base = has(pollMs) ? Math.max(6000, Math.min(10000, pollMs)) : 6000;
  return elapsedMs >= 60000 ? Math.max(base, 8000) : base;
}
function buildBody(S, turnstile, fillMs) {
  return {
    v: 1, idem: S.idem, fields: S.fields, context: { stage: S.context.stage, timeline: S.context.timeline, special: S.context.special, concerns: S.context.concerns },
    free_text: S.freeText || '', skip: !!S.skip, contact: null, consent: null, refine_of: S.refineOf || null,
    from: S.from || null, fill_ms: fillMs, turnstile: turnstile || '', hp: ''
  };
}
function shareLink(url, f, c) {
  var tok = NE.fragEncode(f, c);
  return tok ? url + '#k=' + tok : url;
}
/* 事件：只組規格內的鍵與值；任何自由文字都不會經過這裡 */
function mkEvent(name, t, step, props) {
  var e = { e: name, t: Math.max(0, Math.min(86400000, Math.round(t))) };
  if (step) e.s = step;
  Object.keys(props || {}).forEach(function (k) { if (has(props[k])) e[k] = props[k]; });
  return e;
}
var FindCore = {
  condTags: condTags, unsureKeys: unsureKeys, roadKnown: roadKnown, UNSURE: UNSURE, UNSURE_ASK: UNSURE_ASK, quietTags: quietTags, sheetRows: sheetRows, gotCodes: gotCodes, lenBucket: lenBucket, applyAnswer: applyAnswer,
  preselect: preselect, ackText: ackText, hintFix: hintFix, hintDetail: hintDetail, summaryText: summaryText, pollDelay: pollDelay,
  buildBody: buildBody, shareLink: shareLink, mkEvent: mkEvent, newId: newId, roomsText: roomsText, priceText: priceText,
  ERR_MSG: ERR_MSG, DEGRADE_MSG: DEGRADE_MSG, DEGRADE_MSG_CONTACT: DEGRADE_MSG_CONTACT, DEGRADE_MSG_NOCHASE: DEGRADE_MSG_NOCHASE, SOFT_Q: SOFT_Q, QCOPY: QCOPY, HINT_COPY: HINT_COPY, AREA_RANGE: AREA_RANGE, NO_CHASE_ACK: NO_CHASE_ACK,
  OPTS: { CONCERN: CONCERN_OPTS, TYPE: TYPE_OPTS, PARKING: PK_OPTS, AGE: AGE_OPTS, STAGE: STAGE_OPTS, TIMELINE: TL_OPTS, SPECIAL: SPECIAL_OPTS, AREA: AREA_OPTS, BUDGETS: BUDGETS, DIST_MAIN: DIST_MAIN }
};
root.FindCore = FindCore;
if (typeof module !== 'undefined' && module.exports) module.exports = FindCore;
if (typeof document === 'undefined' || !NE) return;

/* ===================== 以下是畫面（DOM）部分 ===================== */
var doc = document;
function $(s, r) { return (r || doc).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
function byId(id) { return doc.getElementById(id); }
function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
function h(tag, attrs, kids) {
  var e = doc.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    var v = attrs[k];
    if (v === false || v === null || v === undefined) return;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v));
  });
  (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
  return e;
}
function icon(id, cls) {
  var s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'u2-ico' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
  var u = doc.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u);
  return s;
}
function store(op, k, v) {
  try {
    if (op === 'get') return root.sessionStorage.getItem(k);
    if (op === 'set') root.sessionStorage.setItem(k, v);
    if (op === 'del') root.sessionStorage.removeItem(k);
  } catch (e) { /* 瀏覽器禁用儲存也要能用 */ }
  return null;
}
function lstore(op, k, v) {
  try {
    if (op === 'get') return root.localStorage.getItem(k);
    if (op === 'set') root.localStorage.setItem(k, v);
  } catch (e) { /* 同上 */ }
  return null;
}
var reduceMotion = false;
try { reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
var T0 = (root.performance && root.performance.now) ? root.performance.now() : 0;
function nowMs() { return ((root.performance && root.performance.now) ? root.performance.now() : Date.now()) - T0; }

/* 一份全新的狀態；o 只帶要沿用的幾項（回到開場時不重抓的設定） */
function freshS(o) {
  return {
    sid: o.sid, idem: '', jobId: null, step: 's0', fields: {}, context: {}, hints: [], freeText: '', skip: false, refineOf: null,
    plan: [], planIdx: 0, answered: [], skipped: [], nudged: false, returnTo: null, from: o.from, mode: o.mode, siteKey: o.siteKey, cfgOk: false, evt: '',
    consentV: o.consentV, startTs: 0, lastLvl: 'empty', extractMeta: null, res: null, answeredCount: 0, polls: 0, qaStart: 0,
    waitStart: 0, fatigueDone: false, contactSent: false, unsure: []
  };
}
var S = freshS({ sid: newId(), from: '', mode: 'live', siteKey: null, consentV: NE.CONSENT_V });
var timers = { poll: 0, tick: 0 };
var game = null, gameLoading = false, gameSkipped = false, tsToken = '', tsWidget = null, tsLoading = false, tsReady = false;
var evq = [], flushT = 0, qShownAt = 0;

/* ---------- 事件上報（匿名；官網不存；沒有第三方） ---------- */
function stepCode() { return /^s\d+$/.test(S.step) ? S.step : undefined; }
function track(name, props) {
  var p = Object.assign({}, props), s = p.__s;
  delete p.__s;
  evq.push(mkEvent(name, nowMs(), s || stepCode(), p));
  if (evq.length >= 25) flush(false);
  else if (!flushT) flushT = root.setTimeout(function () { flush(false); }, 6000);
}
function rid() {
  if (lstore('get', 'ga_consent') !== 'granted') return null;
  var r = lstore('get', 'find_rid');
  if (!r || !/^[A-Za-z0-9_-]{22}$/.test(r)) { r = newId(); lstore('set', 'find_rid', r); }
  return r;
}
function flush(beacon) {
  if (flushT) { root.clearTimeout(flushT); flushT = 0; }
  if (!evq.length) return;
  var batch = evq.splice(0, 30), body = JSON.stringify({ v: 1, sid: S.sid, jid: S.jobId, rid: rid(), et: S.evt || undefined, events: batch });
  try {
    if (beacon && root.navigator && root.navigator.sendBeacon) { root.navigator.sendBeacon(API + 'event', new Blob([body], { type: 'application/json' })); }
    else root.fetch(API + 'event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () { /* 事件送不出去就丟掉 */ });
  } catch (e) { /* ignore */ }
  if (evq.length) flush(beacon);
}

/* ---------- 網路 ---------- */
function api(path, method, body) {
  var opt = { method: method, headers: {} };
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  return root.fetch(API + path, opt).then(function (r) { return r.json().then(function (j) { return { http: r.status, j: j }; }); });
}

/* ---------- 持久化（只在同一個分頁；重整後可以接著等） ---------- */
function persist() {
  store('set', SESSION_KEY, JSON.stringify({ sid: S.sid, idem: S.idem, jobId: S.jobId, step: S.step, fields: S.fields, context: S.context, freeText: S.freeText, from: S.from, res: S.res, waitStart: S.waitStart, fatigueDone: S.fatigueDone, contactSent: S.contactSent, unsure: S.unsure }));
}

/* ---------- 狀態切換 ---------- */
var FOCUS = { s2: '#s2-chat', s3: '.u2-tray__q', s4: '#s4-title', s6: '#wait-h', s7: '#res-h', s8: '#s8-title', s9: '#deg-msg', s10: '#err-msg' };
function show(step, noFocus) {
  S.step = step;
  $$('.u2-state').forEach(function (d) { d.hidden = d.getAttribute('data-s') !== step; });
  var d = $('.u2-state[data-s="' + step + '"]');
  if (!noFocus && d) {
    var t = FOCUS[step] ? $(FOCUS[step], d) : null;
    var f = t || d;
    try { f.focus({ preventScroll: false }); } catch (e) { /* ignore */ }
    if (f && f.scrollIntoView) { try { f.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
  }
  applyNoChase();
  updateAside();
  persist();
}
function updateAside() {
  var tags = condTags(S.fields), box = byId('aside-sheet'), el = byId('aside-tags');
  if (!box || !el) return;
  box.hidden = !tags.length || S.step === 's0';
  el.textContent = '';
  tags.forEach(function (t) { el.appendChild(h('span', { class: 'u2-tag', text: t })); });
}
function tagsInto(el, tags) {
  if (!el) return;
  el.textContent = '';
  tags.forEach(function (t) { el.appendChild(h('span', { class: 'u2-tag', text: t })); });
}
function bubble(log, who, nodes) {
  if (!log) return null;
  var kids = (nodes || []).map(function (n) { return typeof n === 'string' ? h('p', { text: n }) : n; });
  var b = h('div', { class: 'u2-bubble' }, kids);
  var m = h('div', { class: 'u2-msg u2-msg--' + who + (reduceMotion ? '' : ' u2-msg--enter') });
  if (who === 'bot') {
    var av = h('span', { class: 'u2-avatar', 'aria-hidden': 'true' });
    var s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'u2-ico');
    var u = doc.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#u2-house'); s.appendChild(u); av.appendChild(s);
    m.appendChild(av);
  }
  m.appendChild(b); log.appendChild(m);
  return b;
}
function hasNoChase() { return (S.context.concerns || []).indexOf('no_chase') >= 0; }
/* 客人說了「不想被一直追問、打電話」之後，整個畫面都不能再出現要他留資料的欄位或催促：等待頁、結果頁、降級頁一起收。
   （只留「LINE 問景泰」「撥電話」這類由客人自己主動按的按鈕。） */
function applyNoChase() {
  var nc = hasNoChase();
  ['wait-lead', 'res-lead', 'deg-lead'].forEach(function (id) { var e = byId(id); if (e) e.hidden = nc; });
  var il0 = byId('intake-lead'); if (il0 && nc) il0.hidden = true;   // 收件模式的聯絡欄位什麼時候顯示由 toConfirm 決定；這裡只負責「說了不想被追問就收起來」
  var t = byId('wait-long-text');
  if (t) t.textContent = nc ? '比平常久一點。這一頁會一直等著，好了就會出現。' : '想先去忙的話，留 LINE 或電話，好了景泰會把連結傳給你。不留也可以，這一頁會一直等著。';
  var sub = byId('wait-sub');
  if (sub && nc) sub.textContent = '通常 1～2 分鐘。等的時候可以玩個小遊戲，不想玩就不用管它。';
}
function degradeText(kind) {
  var k = DEGRADE_MSG[kind] ? kind : 'general';
  if (hasNoChase() && !S.contactSent) return DEGRADE_MSG_NOCHASE[k];
  return (S.contactSent ? DEGRADE_MSG_CONTACT : DEGRADE_MSG)[k];
}

/* ---------- s0 → s2：一句話 ---------- */
function startedHow(how) {
  if (S.startTs) return;
  S.startTs = nowMs();
  track('start', { how: how });
}
function submitFree(text) {
  text = (text || '').trim();
  if (!text) { var ta = byId('free-text'); if (ta) ta.focus(); return; }
  startedHow('free');
  S.freeText = text.slice(0, 300);
  var r = NE.extract(S.freeText);     // 與送出的內容一致（伺服器只收 300 字）；#q= 網址帶進來的超長文字也不會整段餵給抽取器
  S.fields = r.fields;
  S.context = {};
  if (r.context.stage) S.context.stage = r.context.stage;
  if (r.context.special) S.context.special = r.context.special;
  // 抽取器從字面猜到的「在意的事」只當預先勾選的提示（客人按確定才算）；
  // 「車位」「電梯」這類字多半是條件不是擔心，不預勾，免得把沒說過的擔心記到景泰那邊
  S.hints = (r.context.concerns_hint || []).filter(function (k) { return HINT_OK.indexOf(k) >= 0; });
  S.extractMeta = r;
  S.lastLvl = r.level;
  S.unsure = unsureKeys(r.fields, r.inferred);
  var drop = r.dropped.slice(); if (r.out_of_scope) drop.push('oos');
  track('free_submit', { lenb: lenBucket(Array.from(text).length), lvl: r.level, got: gotCodes(r.fields), miss: r.missing, drop: drop, pii: r.pii });
  renderHeard(text, r);
  show('s2');
  verifyRoad();
}
function renderHeard(text, r) {
  var log = byId('s2-chat'), act = byId('s2-actions');
  log.textContent = ''; act.textContent = '';
  bubble(log, 'me', [text]);
  var tags = condTags(r.fields, S.unsure);
  if (r.out_of_scope) {
    bubble(log, 'bot', ['目前我只幫忙找台中的物件。其他縣市，可以直接問景泰。']);
    act.appendChild(h('a', { class: 'u2-btn u2-btn--line u2-btn--sm', href: '/go/line?src=find-oos' }, [icon('i-chat'), 'LINE 問景泰']));
    act.appendChild(h('button', { class: 'u2-btn u2-btn--ghost u2-btn--sm', type: 'button', 'data-act': 'restart' }, ['重新打一句']));
    return;
  }
  if (!tags.length) {
    bubble(log, 'bot', ['這句話我沒聽出條件。換個說法再打一次，或用選的就好。']);
    act.appendChild(h('button', { class: 'u2-btn u2-btn--primary', type: 'button', 'data-act': 'restart' }, ['再打一次']));
    act.appendChild(h('button', { class: 'u2-btn u2-btn--ghost', type: 'button', 'data-act': 'pick' }, ['用選的就好']));
    return;
  }
  var tagBox = h('div', { class: 'u2-tags' }, tags.map(function (t) { return h('span', { class: 'u2-tag', text: t }); }));
  bubble(log, 'bot', ['我聽到的是這些。有不對的，到確認畫面可以逐項修改。', tagBox]);
  var ban = [];
  if (r.dropped.indexOf('unbuilt') >= 0) ban.push('我只找已經蓋好、已經通車的條件，所以這一項先不放進去。');
  if (r.dropped.indexOf('presale') >= 0) ban.push('「新建案」這一項先不放進去。我目前只找已經蓋好的現成物件。');
  if (r.pii.length) ban.push('聯絡方式請填在最後的欄位，我不會拿它去找房。');
  S.unsure.forEach(function (k) { ban.push(UNSURE[k] + UNSURE_ASK); });
  ban.forEach(function (t) { log.appendChild(h('div', { class: 'u2-banner u2-indent', role: 'note' }, [icon('i-info'), h('p', { class: 'u2-small u2-bold', text: t })])); });
  var q = NE.nextQuestions(S.fields, S.context, [], [], 4, false);
  var hard = q.filter(function (x) { return SOFT_Q.indexOf(x) < 0; }), soft = q.filter(function (x) { return SOFT_Q.indexOf(x) >= 0; });
  if (hard.length) bubble(log, 'bot', ['再問你 ' + hard.length + ' 個小問題，會準一點。' + (soft.length ? '後面還有幾題選填的，不影響找到的房子。' : '') + '想直接開始也可以。']);
  else if (soft.length) bubble(log, 'bot', ['條件夠了。還有幾題選填的，不影響找到的房子，只是讓景泰之後更懂你。要回答嗎？']);
  act.appendChild(h('button', { class: 'u2-btn u2-btn--primary', type: 'button', 'data-act': 'continue' }, [hard.length ? '好，繼續' : (soft.length ? '好，回答選填題' : '確認條件')]));
  act.appendChild(h('button', { class: 'u2-btn u2-btn--ghost', type: 'button', 'data-act': 'go-now' }, ['直接開始找']));
}

/* 路名延遲驗證：JS 抽取器沒有路名字典，偶爾會抽出一個假路名，伺服器端稍後會丟掉它。
   抽到路名才在背景載入門牌索引（官網原本就有的那份，不進首載 JS）；台中市沒有這條路，就從條件與畫面拿掉。
   逾時 1.5 秒、載入失敗、格式不對：一律維持現狀、不報錯（伺服器端照樣會擋）。 */
function verifyRoad() {
  var road = S.fields.road, late = false, t;
  if (!road) return;
  t = root.setTimeout(function () { late = true; }, 1500);
  root.fetch('/data/tc-addr/index.json').then(function (r) { return r.json(); }).then(function (j) {
    root.clearTimeout(t);
    if (!late && S.fields.road === road && !roadKnown(j.r, road)) dropRoad();   // 太慢、或客人已經改掉路名：不動
  }).catch(function () { /* 維持現狀 */ });
}
function dropRoad() {
  delete S.fields.road;
  if (S.step === 's2') renderHeard(S.freeText, S.extractMeta);
  if (S.step === 's4') renderSheet();
  var p = $('#s3-chat [data-heard]'); if (p) p.textContent = heardLine();
  updateAside(); persist();
}

/* ---------- s3：一次一題 ---------- */
function heardLine() { return '我聽到的是：' + condTags(S.fields, S.unsure).join('、') + '。'; }
function prepareLog() {
  var log = byId('s3-chat');
  if (!log.childNodes.length) {
    if (S.freeText) bubble(log, 'me', [S.freeText]);
    if (condTags(S.fields).length) bubble(log, 'bot', [h('p', { 'data-heard': true, text: heardLine() })]);
  }
  return log;
}
function enterQuestions(plan, returnTo) {
  S.plan = plan; S.planIdx = 0; S.returnTo = returnTo || null;
  if (!plan.length) { toConfirm(); return; }
  if (!returnTo) prepareLog();
  showQuestion();
}
function D_ALL() { return NE.ENUM.DISTRICTS; }
function trayOptions(qid) {
  if (qid === 'q_district') return DIST_MAIN.map(function (d) { return [d, d]; });
  if (qid === 'q_budget') return BUDGETS.map(function (b) { return [b, b + ' 萬以內']; }).concat([['other', '其他金額'], ['unsure', '還不確定']]);
  if (qid === 'q_rooms') return [[1, '1 房'], [2, '2 房'], [3, '3 房'], [4, '4 房'], [5, '5 房以上']];
  if (qid === 'q_concerns') return CONCERN_OPTS.concat([['none', '沒特別擔心', { 'data-exclusive': '1' }]]);
  if (qid === 'q_parking') return PK_OPTS;
  if (qid === 'q_age') return AGE_OPTS;
  if (qid === 'q_stage') return STAGE_OPTS;
  if (qid === 'q_timeline') return TL_OPTS;
  return [];
}
function showQuestion() {
  var qid = S.plan[S.planIdx], tray = byId('s3-tray');
  tray.textContent = '';
  if (!qid) { toConfirm(); return; }
  track('q_show', { q: qid });
  qShownAt = nowMs();
  var multi = qid === 'q_district' || qid === 'q_rooms' || qid === 'q_concerns';
  var cp = QCOPY[qid] || ['', ''], qDomId = 'q-' + qid;
  var meta = h('div', { class: 'u2-tray__meta' }, [h('span', { text: '第 ' + (S.planIdx + 1) + ' 題，最多 ' + S.plan.length + ' 題' }), h('span', { text: multi ? '可以複選' : '選一個' })]);
  var body = h('div', { class: 'u2-tray__body u2-opts u2-opts--flow', id: 'tray-body' });
  var sel = preselect(S.fields, S.context, qid, S.hints).map(String);
  var inputs = [];
  function mk(val, label, extra) {
    var inp = h('input', { type: multi ? 'checkbox' : 'radio', name: 'a', value: String(val), checked: sel.indexOf(String(val)) >= 0 });
    if (extra) Object.keys(extra).forEach(function (k) { inp.setAttribute(k, extra[k]); });
    inputs.push(inp);
    return h('label', { class: 'u2-opt u2-opt--chip' + (multi ? '' : ' u2-opt--radio') }, [inp, h('span', { class: 'u2-opt__box' }), h('span', { class: 'u2-opt__txt', text: label })]);
  }
  trayOptions(qid).forEach(function (o) { body.appendChild(mk(o[0], o[1], o[2])); });
  var otherNum = null, restBox = null, moreBtn = null;
  if (qid === 'q_budget') {
    otherNum = h('div', { class: 'u2-field', hidden: true }, [h('label', { for: 'b-num', text: '預算上限（萬）' }), h('input', { id: 'b-num', class: 'u2-input u2-num', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '例：1800', 'aria-describedby': 'b-help' }), h('p', { class: 'u2-help', id: 'b-help', text: '填數字就好，單位是萬。' })]);
  }
  if (qid === 'q_district') {
    restBox = h('div', { class: 'u2-opts u2-opts--flow u2-tray__rest', hidden: true });
    D_ALL().filter(function (d) { return DIST_MAIN.indexOf(d) < 0; }).forEach(function (d) { restBox.appendChild(mk(d, d)); });
    moreBtn = h('button', { class: 'u2-btn u2-btn--text', type: 'button', 'aria-expanded': 'false' }, ['其他區']);
    on(moreBtn, 'click', function () { restBox.hidden = !restBox.hidden; moreBtn.setAttribute('aria-expanded', String(!restBox.hidden)); });
    if (sel.some(function (d) { return DIST_MAIN.indexOf(d) < 0; })) restBox.hidden = false;
  }
  var okBtn = h('button', { class: 'u2-btn u2-btn--primary', type: 'button', id: 'q-ok' }, ['確定']);
  function refresh() {
    var n = inputs.filter(function (i) { return i.checked; }).length;
    okBtn.textContent = multi ? '確定（' + n + '）' : '確定';
    if (qid === 'q_district') inputs.forEach(function (i) { i.disabled = !i.checked && n >= 2; });
    if (otherNum) otherNum.hidden = !inputs.some(function (i) { return i.checked && i.value === 'other'; });
  }
  inputs.forEach(function (i) {
    on(i, 'change', function () {
      if (i.getAttribute('data-exclusive') && i.checked) inputs.forEach(function (o) { if (o !== i) o.checked = false; });
      else if (multi && i.checked) inputs.forEach(function (o) { if (o.getAttribute('data-exclusive')) o.checked = false; });
      refresh();
    });
  });
  var foot = h('div', { class: 'u2-tray__foot' });
  if (S.planIdx > 0 || S.returnTo) foot.appendChild(h('button', { class: 'u2-btn u2-btn--text', type: 'button', 'data-act': 'q-back' }, [S.planIdx > 0 ? '上一題' : '回需求單']));
  foot.appendChild(h('button', { class: 'u2-btn u2-btn--text', type: 'button', 'data-act': 'q-skip' }, [multi ? '略過這題' : '略過']));
  foot.appendChild(okBtn);
  var trayEl = h('div', { class: 'u2-tray', role: multi ? 'group' : 'radiogroup', 'aria-labelledby': qDomId }, [
    meta, h('p', { class: 'u2-tray__q', id: qDomId, tabindex: '-1', text: cp[0] }), h('p', { class: 'u2-tray__hint', text: cp[1] }), body,
    moreBtn ? h('div', { class: 'u2-tray__more' }, [moreBtn]) : null, restBox, otherNum, foot
  ]);
  tray.appendChild(trayEl);
  refresh();
  var d = byId('s3-direct'); if (d) d.hidden = !!S.returnTo;
  show('s3');
  on(okBtn, 'click', function () { answerQuestion(qid, inputs, otherNum); });
  on(trayEl, 'keydown', function (e) { if (e.key === 'Enter' && !multi && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); answerQuestion(qid, inputs, otherNum); } });
}
/* 讀答案：回傳要寫進條件的值（沒有可寫的值＝null，例如「還不確定」「不限」）；有沒有勾任何選項另外看 picked */
function readAnswer(qid, inputs, otherNum) {
  var vals = inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
  if (qid === 'q_district' || qid === 'q_concerns') return vals.filter(function (v) { return v !== 'none'; });
  if (qid === 'q_rooms') return vals.map(Number);
  if (qid === 'q_budget') {
    if (!vals.length || vals[0] === 'unsure') return null;
    if (vals[0] === 'other') {
      var n = parseInt(String((otherNum && otherNum.querySelector('input').value) || '').replace(/[^\d]/g, ''), 10);
      return n >= 100 && n <= 100000 ? n : null;
    }
    return Number(vals[0]);
  }
  if (qid === 'q_age') { var a = vals.length ? Number(vals[0]) : 0; return a || null; }
  return vals.length ? vals[0] : null;
}
function answerQuestion(qid, inputs, otherNum) {
  var picked = inputs.some(function (i) { return i.checked; });
  var raw = readAnswer(qid, inputs, otherNum);
  var empty = raw === null || (Array.isArray(raw) && !raw.length);
  var r = applyAnswer(S.fields, S.context, qid, empty ? null : raw);
  S.fields = r.fields; S.context = r.context;
  S.unsure = S.unsure.filter(function (k) { return EDIT_Q[k] !== qid; });   // 答了這一題，那一欄就算確認過
  var arr = empty ? [] : (Array.isArray(raw) ? raw : [raw]);
  var log = byId('s3-chat');
  if (picked) {
    if (S.answered.indexOf(qid) < 0) S.answered.push(qid);
    var k = S.skipped.indexOf(qid); if (k >= 0) S.skipped.splice(k, 1);
    S.answeredCount++;
    var chosen = inputs.filter(function (x) { return x.checked; });
    track('q_ans', { q: qid, n: Math.min(12, chosen.length), ms: Math.min(3600000, Math.round(nowMs() - qShownAt)) });
    var said = chosen.map(function (x) { var t = x.parentNode && x.parentNode.querySelector ? x.parentNode.querySelector('.u2-opt__txt') : null; return t ? t.textContent : ''; }).filter(Boolean);
    bubble(log, 'me', [said.join('、') || '好']);
  } else {
    if (S.skipped.indexOf(qid) < 0) S.skipped.push(qid);
    track('q_skip', { q: qid });
    bubble(log, 'me', ['略過']);
  }
  bubble(log, 'bot', [ackText(qid, arr, picked)]);
  nextQuestion();
}
function nextQuestion() {
  if (S.returnTo) { S.returnTo = null; toConfirm(); return; }
  S.planIdx++;
  if (S.planIdx >= S.plan.length) { toConfirm(); return; }
  showQuestion();
}
function questionBack() {
  if (S.returnTo) { S.returnTo = null; toConfirm(); return; }
  if (S.planIdx > 0) { S.planIdx--; showQuestion(); }
}
function skipQuestion() {
  var qid = S.plan[S.planIdx];
  if (S.skipped.indexOf(qid) < 0) S.skipped.push(qid);
  track('q_skip', { q: qid });
  bubble(byId('s3-chat'), 'me', ['略過']);
  nextQuestion();
}
function goNow() {
  var a = NE.assess(S.fields, S.skip);
  track('go_now', { lvl: a.level, left: Math.max(0, Math.min(4, S.plan.length - S.planIdx)) });
  if (a.level === 'empty') {
    prepareLog();
    bubble(byId('s3-chat'), 'bot', ['至少要有一個條件，我才找得到。先選一個區域好嗎？']);
    enterQuestions(['q_district'], null);
    return;
  }
  if (a.level === 'vague' && !S.nudged) {
    // 只提示一次：條件太少，找到的會比較雜
    S.nudged = true;
    track('nudge', { r: 'show' });
    var log = prepareLog();
    var b = bubble(log, 'bot', ['只有這些條件的話，找到的會比較多、也比較雜。補一個預算，會準很多，要補嗎？']);
    if (b) b.appendChild(h('div', { class: 'u2-tags' }, [
      h('button', { class: 'u2-tag u2-tag--btn', type: 'button', 'data-act': 'nudge-yes' }, ['補預算']),
      h('button', { class: 'u2-tag u2-tag--btn', type: 'button', 'data-act': 'nudge-no' }, ['不用，直接找'])
    ]));
    byId('s3-tray').textContent = '';
    show('s3');
    return;
  }
  if (a.level === 'vague') S.skip = true;
  toConfirm();
}

/* ---------- s4：確認（需求單） ---------- */
function toConfirm() {
  var a = NE.assess(S.fields, S.skip);
  S.lastLvl = a.level;
  renderSheet();
  renderExtras();
  var mode = S.mode === 'intake';
  var gb = byId('go-btn'), gn = byId('go-note');
  if (gb) gb.textContent = mode ? '送出需求' : '開始找';
  if (gn) gn.textContent = mode ? '目前由景泰看過再回覆，不是自動找。' : '通常 1～2 分鐘。';
  // 收件模式：不是自動找，景泰要有聯絡方式才回得到客人，所以這一步就要問；「不想被追問」的客人不強迫
  var il = byId('intake-lead'), nl = byId('s4-nocontact'), ih = byId('intake-help');
  if (il) il.hidden = !mode || hasNoChase();
  if (nl) nl.hidden = mode && !hasNoChase();
  if (ih) ih.textContent = '想讓景泰回你，LINE 或手機留一項就好。不留也可以送出，只是景泰就沒辦法回你。';
  if (mode && hasNoChase() && nl) nl.textContent = '你選了不想被追問，所以留不留聯絡方式都可以。不留的話，這筆需求只會被記下來，想問的時候直接 LINE 景泰。';
  track('confirm', { lvl: a.level, fn: Math.min(14, Object.keys(S.fields).length) });
  ensureTurnstile();
  show('s4');
}
var EDIT_Q = { district: 'q_district', price: 'q_budget', rooms: 'q_rooms', age: 'q_age', parking: 'q_parking' };
function renderSheet() {
  var dl = byId('sheet-rows');
  dl.textContent = '';
  sheetRows(S.fields).forEach(function (r) {
    var btn = h('button', { class: 'u2-btn u2-btn--text', type: 'button', 'data-edit': r[0] }, ['改', h('span', { class: 'u2-sr', text: r[1] })]);
    var u = S.unsure.indexOf(r[0]) >= 0;   // 更正過、不確定要哪個：值後面標「請確認」，下面一句白話問他
    dl.appendChild(h('div', { class: 'u2-sheet__row' }, [h('dt', { text: r[1] }), h('dd', { class: 'u2-num' }, [r[2], u && h('span', { class: 'u2-tag u2-tag--check', text: '請確認' }), u && h('small', { class: 'u2-sheet__note', text: UNSURE_ASK })]), btn]));
  });
  var q = quietTags(S.context), zone = byId('sheet-quiet-zone'), box = byId('sheet-quiet');
  box.textContent = '';
  q.forEach(function (t) { box.appendChild(h('span', { class: 'u2-tag u2-tag--quiet', text: t })); });
  if (zone) zone.hidden = !q.length;
  updateAside();
}
function chipGroup(boxId, type, name, opts, checkedFn, onChange) {
  var box = byId(boxId);
  box.textContent = '';
  opts.forEach(function (o) {
    var inp = h('input', { type: type, name: name, value: String(o[0]), checked: checkedFn(o[0]) });
    on(inp, 'change', function () { onChange(inp, o[0]); });
    box.appendChild(h('label', { class: 'u2-opt u2-opt--chip' + (type === 'radio' ? ' u2-opt--radio' : '') }, [inp, h('span', { class: 'u2-opt__box' }), h('span', { class: 'u2-opt__txt', text: o[1] })]));
  });
}
function renderExtras() {
  var f = S.fields, c = S.context;
  chipGroup('x-type', 'checkbox', 'xt', TYPE_OPTS, function (v) { return (f.types || []).indexOf(v) >= 0; }, function (inp) {
    var cur = (S.fields.types || []).slice(), v = inp.value, i = cur.indexOf(v);
    if (inp.checked && i < 0) cur.push(v); else if (!inp.checked && i >= 0) cur.splice(i, 1);
    if (cur.length > 2) { cur = cur.slice(-2); renderExtras(); }
    S.fields = NE.normalizeFields(Object.assign({}, S.fields, { types: cur })).fields; if (!cur.length) delete S.fields.types; renderSheet();
  });
  chipGroup('x-pk', 'radio', 'xp', PK_OPTS, function (v) { return f.parking === v; }, function (inp) { S.fields.parking = inp.value; renderSheet(); });
  var floorOpts = [['no_top', '不要頂樓'], ['no_first', '不要一樓']];
  chipGroup('x-floor', 'checkbox', 'xf', floorOpts, function (v) { return v === 'no_top' ? !!f.exclude_top : (f.floor_exclude || []).indexOf(1) >= 0; }, function (inp) {
    var fl = (S.fields.floor_exclude || []).slice();
    if (inp.value === 'no_top') { if (inp.checked) S.fields.exclude_top = true; else delete S.fields.exclude_top; }
    else { var i = fl.indexOf(1); if (inp.checked && i < 0) fl.push(1); else if (!inp.checked && i >= 0) fl.splice(i, 1); if (fl.length) S.fields.floor_exclude = fl.sort(function (a, b) { return a - b; }); else delete S.fields.floor_exclude; }
    renderSheet();
  });
  chipGroup('x-area', 'radio', 'xa', AREA_OPTS, function (v) { var r = AREA_RANGE[v]; return !!r && (r[0] === (has(f.area_min_ping) ? f.area_min_ping : null)) && (r[1] === (has(f.area_max_ping) ? f.area_max_ping : null)); }, function (inp) {
    var r = AREA_RANGE[inp.value];
    delete S.fields.area_min_ping; delete S.fields.area_max_ping;
    if (r && has(r[0])) S.fields.area_min_ping = r[0];
    if (r && has(r[1])) S.fields.area_max_ping = r[1];
    renderSheet();
  });
  chipGroup('x-special', 'checkbox', 'xs', SPECIAL_OPTS, function (v) { return (c.special || []).indexOf(v) >= 0; }, function (inp) {
    var cur = (S.context.special || []).slice(), i = cur.indexOf(inp.value);
    if (inp.checked && i < 0) cur.push(inp.value); else if (!inp.checked && i >= 0) cur.splice(i, 1);
    if (cur.length) S.context.special = cur; else delete S.context.special;
    renderSheet();
  });
}
function editRow(key) {
  if (EDIT_Q[key]) { track('edit', { k: key }); enterQuestions([EDIT_Q[key]], 's4'); return; }
  track('edit', { k: key });
  var d = byId('more-details'); if (d) { d.open = true; var i = $('input', d); if (i) i.focus(); }
}

/* ---------- 人機驗證（只在需要時載入；site key 由 /api/find/config 在執行期給） ---------- */
function ensureTurnstile() {
  if (!S.siteKey || tsWidget !== null || tsLoading) return;
  var box = byId('ts-box');
  if (!box) return;
  function render() {
    try {
      tsWidget = root.turnstile.render(box, {
        sitekey: S.siteKey, action: 'find', appearance: 'interaction-only',
        callback: function (t) { tsToken = t; tsReady = true; },
        'error-callback': function () { tsToken = ''; },
        'expired-callback': function () { tsToken = ''; try { root.turnstile.reset(tsWidget); } catch (e) { /* ignore */ } }
      });
    } catch (e) { tsWidget = null; }
    tsLoading = false;
  }
  if (root.turnstile) { render(); return; }
  tsLoading = true;
  var s = doc.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.defer = true;
  s.onload = render;
  s.onerror = function () { tsLoading = false; };
  doc.head.appendChild(s);
}
function waitToken(ms) {
  return new Promise(function (resolve) {
    if (!S.siteKey || tsToken) { resolve(tsToken); return; }
    var n = 0, iv = root.setInterval(function () {
      n += 200;
      if (tsToken || n >= ms) { root.clearInterval(iv); resolve(tsToken); }
    }, 200);
  });
}

/* 取一個新的一次性人機驗證 token（聯絡表單、補送用）；用完就重置，下一個馬上開始準備。沒有 site key（設定沒抓到）就回空字串，由伺服器端決定。 */
function freshToken() {
  ensureTurnstile();
  if (!S.siteKey) return Promise.resolve('');
  function use(t) { tsToken = ''; try { if (tsWidget !== null) root.turnstile.reset(tsWidget); } catch (e) { /* ignore */ } return t; }
  if (tsToken) return Promise.resolve(use(tsToken));
  return waitToken(8000).then(use);
}

/* ---------- s5：送出 ---------- */
function setBusy(on) {
  var btn = byId('go-btn');
  if (!btn) return;
  if (on) { btn.setAttribute('aria-busy', 'true'); btn.classList.add('is-busy'); } else { btn.removeAttribute('aria-busy'); btn.classList.remove('is-busy'); }
}
function showTsHint(on, text) {
  var hint = byId('ts-hint'), box = byId('ts-box');
  if (hint) { hint.hidden = !on; hint.textContent = text || TS_RETRY_HINT; }
  if (on && box && box.scrollIntoView) { try { box.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
}
/* 收件模式的聯絡欄位：回 {contact, consent} 或 null（有問題時已經顯示提示） */
function readIntakeContact() {
  var il = byId('intake-lead');
  if (!il || il.hidden) return { contact: null, consent: null };
  var err = byId('ci-err');
  function bad(t) { if (err) { err.hidden = false; err.textContent = t; } }
  if (err) { err.hidden = true; err.textContent = ''; }
  var line = ((byId('ci-line') || {}).value || '').trim(), phone = ((byId('ci-phone') || {}).value || '').trim();
  if (!line && !phone) return { contact: null, consent: null };      // 選填、不強迫：不留也送得出去（景泰就沒辦法回覆，頁面說明裡寫明）
  var cb = byId('ci-consent');
  if (!cb || !cb.checked) { bad(ERR_MSG.E_CONSENT); return null; }
  var contact = { pref: line ? 'line' : 'phone' };
  if (line) contact.line = line; if (phone) contact.phone = phone;
  var vc = NE.validateContact(contact);
  if (!vc.contact) { bad('LINE ID 或手機的格式好像不對，再檢查一下。'); return null; }
  return { contact: vc.contact, consent: { contact: true, v: S.consentV } };
}
function submit() {
  var btn = byId('go-btn');
  if (btn && btn.getAttribute('aria-busy') === 'true') return;
  var a = NE.assess(S.fields, S.skip);
  if (a.level === 'empty') { // 一個條件都沒有：不送（送出去只是一筆空線索），回去先問區域
    prepareLog();
    bubble(byId('s3-chat'), 'bot', ['至少要有一個條件，我才找得到。先選一個區域好嗎？']);
    enterQuestions(['q_district'], null);
    return;
  }
  var ic = readIntakeContact();
  if (ic === null) return;                          // 收件模式要先有聯絡方式：留在確認畫面、提示已經顯示
  if (!S.cfgOk) {
    // 設定（人機驗證 site key）一直沒抓到：先再抓一次；還是抓不到就請客人重新整理，不送出一個一定會被擋掉的請求（紅隊 RT-04）
    setBusy(true);
    loadConfig().catch(function () { /* 看下面的 cfgOk */ }).then(function () {
      setBusy(false);
      if (S.cfgOk) submit(); else showTsHint(true, CFG_RETRY_HINT);
    });
    return;
  }
  setBusy(true);
  if (!S.idem) S.idem = newId();
  ensureTurnstile();
  var fillMs = Math.max(0, Math.round(nowMs() - (S.startTs || 0)));
  function send(token) {
    showTsHint(false);
    S.unsure = [];                                    // 客人看過確認畫面、按了開始找：不再標「請確認」（回來調條件時不會又出現）
    track('submit', { lvl: a.level, skip: S.skip ? 1 : 0, ct: ic.contact ? 1 : 0, nc: (S.context.concerns || []).length, rf: S.refineOf ? 1 : 0 });
    tagsInto(byId('s5-tags'), condTags(S.fields));
    show('s5');
    if (tsWidget !== null) { tsToken = ''; try { root.turnstile.reset(tsWidget); } catch (e) { /* ignore */ } }   // 先清空再重置：重置後新的 token 會由 callback 填進來
    var body = buildBody(S, token, fillMs);
    if (ic.contact) { body.contact = ic.contact; body.consent = ic.consent; S.contactSent = true; }
    api('submit', 'POST', body).then(function (r) {
      setBusy(false);
      handleSubmitResult(r);
    }).catch(function () {
      setBusy(false);
      track('submit_res', { st: 'error', err: 'E_FORWARD' });
      showError('E_FORWARD');
    });
  }
  if (S.siteKey && !tsToken) {
    // 驗證框可能需要客人動手：先別切到「送出中」，留在這一頁把驗證框捲進畫面，等它好（最多 8 秒）
    showTsHint(true);
    waitToken(8000).then(function (t) {
      if (!t) { setBusy(false); return; }             // 還是沒好：提示留著，客人完成後再按一次
      send(t);
    });
    return;
  }
  send(tsToken);
}
function showError(code) {
  var m = byId('err-msg');
  if (m) m.textContent = ERR_MSG[code] || ERR_MSG.E_FORWARD;
  show('s10');
}
function handleSubmitResult(r) {
  var j = r.j || {};
  if (j.ok === false) {
    var code = ERR_MSG[j.code] ? j.code : 'E_FORWARD';
    track('submit_res', { st: 'error', err: code });
    track('err', { c: code === 'E_HUMAN' ? 'turnstile' : code === 'E_ORIGIN' ? 'origin' : code === 'E_RATE' ? 'rate' : 'other' });
    showError(code);
    return;
  }
  if (j.status === 'need_more') {
    track('submit_res', { st: 'need_more' });
    S.nudged = true;
    var ask = (j.ask || []).filter(function (q) { return QCOPY[q]; });
    if (!ask.length) ask = ['q_budget'];
    enterQuestions(ask, null);
    return;
  }
  if (j.status === 'degraded') {
    track('submit_res', { st: 'degraded', sv: j.saved === false ? 0 : 1 });
    S.jobId = typeof j.jobId === 'string' ? j.jobId : null;
    showDegraded(DEGRADE_MSG[j.kind] ? j.kind : 'general', j.saved === false, j.diag);
    return;
  }
  if (j.status === 'queued' && typeof j.jobId === 'string') {
    track('submit_res', { st: 'queued', sv: 1 });
    S.jobId = j.jobId; S.polls = 0; S.res = null; S.waitStart = Date.now(); S.qaStart = j.queue ? Math.min(99, j.queue.ahead || 0) : 0;
    startWaiting(j);
    return;
  }
  track('submit_res', { st: 'error', err: 'E_FORWARD' });
  showError('E_FORWARD');
}

/* ---------- s6：等待、輪詢、小遊戲 ---------- */
var unknowns = 0, lowFreq = false, readyShown = false;
function startWaiting(first) {
  unknowns = 0; lowFreq = false; readyShown = false; gameSkipped = false;
  $$('.u2-ready, #ready-banner').forEach(function (e) { e.hidden = true; });
  var rb = byId('ready-banner'); if (rb) rb.hidden = true;
  var lw = byId('wait-long'); if (lw) lw.hidden = true;
  applyNoChase();
  setSteps('q');
  renderQueue(first && first.queue);
  show('s6');
  if (S.mode === 'live') mountGame();
  var fb = byId('fatigue-box'); if (fb) fb.hidden = true;
  schedulePoll(2000);
  if (timers.tick) root.clearInterval(timers.tick);
  timers.tick = root.setInterval(waitTick, 1000);
}
function setSteps(stage) {
  var order = ['q', 's', 'b'], at = order.indexOf(stage);
  $$('#wait-steps li').forEach(function (li, i) {
    li.className = i < at ? 'is-done' : (i === at ? 'is-current' : '');
    if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    var dot = $('.u2-steps__dot', li); if (dot) { dot.textContent = ''; if (i < at) dot.appendChild(icon('i-check')); }
  });
}
function renderQueue(q) {
  var el = byId('wait-queue');
  if (!el) return;
  if (q && typeof q.ahead === 'number' && q.ahead > 0) { el.hidden = false; el.textContent = '前面還有 ' + q.ahead + ' 位，預估約 ' + Math.max(1, Math.round((q.eta_s || 60) / 60)) + ' 分鐘。'; }
  else { el.hidden = true; el.textContent = ''; }
}
function schedulePoll(ms) {
  if (timers.poll) root.clearTimeout(timers.poll);
  timers.poll = root.setTimeout(poll, ms);
}
function elapsed() { return Date.now() - (S.waitStart || Date.now()); }
function poll() {
  if (S.step !== 's6' || !S.jobId) return;
  S.polls++;
  api('status?id=' + encodeURIComponent(S.jobId), 'GET').then(function (r) {
    var j = r.j || {};
    if (r.http === 404 || j.code === 'E_NOT_FOUND') { endWait('degraded', 'abandon'); showDegraded('general', false); return; }
    if (j.status === 'unknown' || j.ok === false || !j.status) { onUnknown(); return; }
    unknowns = 0;
    if (j.status === 'queued') { setSteps('q'); renderQueue(j.queue); }
    else if (j.status === 'searching') { setSteps('s'); renderQueue(null); }
    else if (j.status === 'building') { setSteps('b'); renderQueue(null); }
    else if (j.status === 'done' && typeof j.shareUrl === 'string') { onDone(j); return; }
    else if (j.status === 'empty') { endWait('empty'); showEmpty(j.hint || []); return; }
    else if (j.status === 'degraded') { endWait('degraded'); showDegraded(DEGRADE_MSG[j.kind] ? j.kind : 'general', false); return; }
    else if (j.status === 'expired') { endWait('degraded', 'abandon'); showDegraded('general', false); return; }
    nextPoll(j.pollMs);
  }).catch(function () { onUnknown(); });
}
function onUnknown() {
  unknowns++;
  if (unknowns >= 3 && !lowFreq) { lowFreq = true; track('err', { c: 'net' }); }
  nextPoll();
}
function nextPoll(pollMs) {
  if (S.step !== 's6') return;
  if (elapsed() > 600000) { endWait('degraded', 'abandon'); showDegraded('general', false); return; }
  schedulePoll(doc.hidden ? 30000 : pollDelay(elapsed(), pollMs, unknowns, lowFreq));   // 離開分頁就降到 30 秒一次，好了才有辦法在頁籤標題提示
}
function waitTick() {
  if (S.step !== 's6') { root.clearInterval(timers.tick); timers.tick = 0; return; }
  var el = elapsed();
  if (el >= 90000) {
    var lw = byId('wait-long');
    if (lw && lw.hidden) {
      lw.hidden = false;
      var nc = hasNoChase();
      var d = byId('wait-lead'); if (d && !nc) d.open = true;   // 說過不想被追問的客人：不展開、不催（applyNoChase 已經把整塊收起來）
      var sub = byId('wait-sub'); if (sub) sub.textContent = '比平常久一點。';
      var hh = byId('wait-h'); if (hh) hh.textContent = '還在整理';
      if (!nc) track('contact', { r: 'show' });
    }
  }
  if (el >= 10000 && S.answeredCount >= 1 && !S.fatigueDone) {
    var fb = byId('fatigue-box'); if (fb && fb.hidden) fb.hidden = false;
  }
  if (lowFreq && el >= 600000) { endWait('degraded', 'abandon'); showDegraded('general', false); }
}
function endWait(st, why) {
  if (timers.poll) { root.clearTimeout(timers.poll); timers.poll = 0; }
  if (timers.tick) { root.clearInterval(timers.tick); timers.tick = 0; }
  track('wait_end', { st: why || st, ws: Math.min(1800, Math.round(elapsed() / 1000)), qa: S.qaStart, polls: Math.min(999, S.polls) });
}
function onDone(j) {
  endWait('done');
  S.res = { shareUrl: j.shareUrl, count: typeof j.count === 'number' ? j.count : null };
  var playing = false;
  try { playing = !!(game && game.getState && game.getState().status === 'playing'); } catch (e) { playing = false; }
  if (playing) {
    readyShown = true;
    var rb = byId('ready-banner'); if (rb) rb.hidden = false;
    if (doc.hidden) doc.title = '（好了）' + doc.title.replace(/^（好了）/, '');
    persist();
    return;
  }
  showResult();
}
function mountGame() {
  var mount = byId('wait-game-mount'), wrap = byId('game-wrap');
  if (!mount || !wrap || game || gameLoading) { if (wrap) wrap.hidden = false; return; }
  wrap.hidden = false;
  var v = ($('main[data-v-game]') || {}).getAttribute ? $('main[data-v-game]').getAttribute('data-v-game') : 'dev';
  function go() {
    gameLoading = false;
    if (typeof root.mountWaitGame !== 'function') { wrap.hidden = true; return; }
    try {
      game = root.mountWaitGame(mount, {
        height: 280, frame: false, skipButton: false,
        onEvent: function (e) {
          if (e.type === 'start' || e.type === 'over' || e.type === 'skip') {
            var sc = root.WaitGameCore && root.WaitGameCore.scoreBucket ? root.WaitGameCore.scoreBucket(e.score) : 0;
            track('game', { a: e.type, sc: Math.max(0, Math.min(9, sc | 0)), pl: Math.min(99, e.plays | 0) });
          }
        }
      });
    } catch (e) { wrap.hidden = true; game = null; }
  }
  if (typeof root.mountWaitGame === 'function') { go(); return; }
  gameLoading = true;
  var s = doc.createElement('script');
  s.src = '/js/wait-game.js?v=' + encodeURIComponent(v || 'dev');
  s.onload = go; s.onerror = function () { gameLoading = false; wrap.hidden = true; };
  doc.head.appendChild(s);
}
function skipGame() {
  gameSkipped = true;
  var reported = false;
  try { if (game && game.skip) { game.skip(); reported = true; } } catch (e) { /* ignore */ }   // 遊戲自己會透過 onEvent 上報一次 skip
  try { if (game && game.destroy) game.destroy(); } catch (e) { /* ignore */ }
  game = null;
  var m = byId('wait-game-mount'), sk = byId('game-skipped'), b = byId('game-skip');
  if (m) m.hidden = true; if (sk) sk.hidden = false; if (b) b.hidden = true;
  if (!reported) track('game', { a: 'skip', sc: 0, pl: 0 });
  if (readyShown) showResult();
}
function destroyGame() {
  try { if (game && game.destroy) game.destroy(); } catch (e) { /* ignore */ }
  game = null;
}

/* ---------- s7：結果 ---------- */
function showResult() {
  destroyGame();
  var r = S.res || {};
  var cnt = byId('res-count');
  if (cnt) cnt.textContent = r.count ? '這是依你的條件挑出的 ' + r.count + ' 間。' : '這是依你的條件挑出的幾間。';
  var link = byId('open-link');
  if (link && r.shareUrl) link.setAttribute('href', shareLink(r.shareUrl, S.fields, S.context));
  tagsInto(byId('res-tags'), condTags(S.fields));
  var rl = byId('res-lead'); if (rl) rl.hidden = hasNoChase();
  var fbm = byId('fb-more'); if (fbm) fbm.hidden = true;
  var th = byId('fb-thanks'); if (th) th.hidden = true;
  $$('input[name="rate"]').forEach(function (i) { i.checked = false; });
  var door = byId('door-house');
  if (door) { if (reduceMotion) door.classList.add('is-open'); else { door.classList.remove('is-open'); root.setTimeout(function () { door.classList.add('is-open'); }, 60); } }
  track('result', { n: Math.min(12, r.count || 0), ws: Math.min(1800, Math.round(elapsed() / 1000)) });
  doc.title = doc.title.replace(/^（好了）/, '');
  show('s7');
}

/* ---------- s8：沒有完全符合 ---------- */
function showEmpty(hints) {
  destroyGame();
  var ul = byId('hint-list');
  ul.textContent = '';
  var list = hints.filter(function (x) { return HINT_COPY[x]; });
  if (!list.length) list = ['loosen_price', 'loosen_district', 'drop_floor'];
  list.forEach(function (x) {
    var b = h('button', { class: 'u2-opt u2-opt--btn', type: 'button', 'data-hint': x }, [h('span', { class: 'u2-opt__txt' }, [HINT_COPY[x], h('small', { text: hintDetail(S.fields, x) })])]);
    ul.appendChild(h('li', {}, [b]));
  });
  track('result', { n: 0, ws: Math.min(1800, Math.round(elapsed() / 1000)) });
  show('s8');
}
function applyHint(x) {
  track('result_click', { a: 'refine' });
  S.refineOf = S.jobId; S.idem = ''; S.jobId = null;
  if (x === 'loosen_district') { enterQuestions(['q_district'], 's4'); return; }
  S.fields = hintFix(S.fields, S.context, x);
  toConfirm();
}

/* ---------- s9：降級 ---------- */
function showDegraded(kind, lost, diag) {
  destroyGame();
  S.degradeKind = DEGRADE_MSG[kind] ? kind : 'general';
  var msg = byId('deg-msg'), ok = byId('deg-ok'), lostB = byId('deg-lost'), sb = byId('deg-summary-box'), copy = byId('deg-copy'), sum = byId('deg-summary');
  if (msg) msg.textContent = degradeText(kind);
  if (ok) ok.hidden = !!lost;
  if (lostB) lostB.hidden = !lost;
  // 送不出去的原因代碼（只有失敗種類，例如 tg-h403）：小字顯示，截圖就能查是哪一關
  var code = byId('deg-code');
  var dc = lost && typeof diag === 'string' && /^[a-z0-9-]{1,24}$/.test(diag) ? diag : '';
  if (code) { code.textContent = dc ? '代碼：' + dc : ''; code.hidden = !dc; }
  if (sb) sb.hidden = !lost;
  if (copy) copy.hidden = !lost;
  if (sum) sum.value = summaryText(S.fields, S.context);
  var help = byId('deg-help');
  if (help) help.textContent = '不留也可以，晚點再回來看看。';
  var sub = byId('deg-sub');
  if (sub) sub.textContent = S.contactSent ? '你的條件和聯絡方式都記下來了，不用再填一次。' : '你的條件已經記下來了，不用再填一次。';
  show('s9');
}

/* ---------- 聯絡表單（等待中、結果頁、降級頁共用） ---------- */
function setupLeadForms() {
  $$('[data-lead-form]').forEach(function (form) {
    on(form, 'submit', function (e) {
      e.preventDefault();
      var q = function (n) { var i = form.querySelector('[name="' + n + '"]'); return i ? i.value.trim() : ''; };
      var err = form.querySelector('[data-lead-err]'), note = form.querySelector('[data-lead-note]');
      function bad(t) { if (err) { err.hidden = false; err.textContent = t; } }
      if (err) { err.hidden = true; err.textContent = ''; }
      var line = q('line'), phone = q('phone'), name = q('name');
      if (!line && !phone) { bad('至少填 LINE 或手機其中一項。'); return; }
      var consent = form.querySelector('[name="consent"]');
      if (!consent || !consent.checked) { bad(ERR_MSG.E_CONSENT); return; }
      var contact = { pref: line ? 'line' : 'phone' };
      if (line) contact.line = line; if (phone) contact.phone = phone; if (name) contact.name = name;
      var vc = NE.validateContact(contact);
      if (!vc.contact) { bad('LINE ID 或手機的格式好像不對，再檢查一下。'); return; }
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
      function free() { if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; } }
      freshToken().then(function (token) {
        return api('contact', 'POST', { v: 1, jid: S.jobId, contact: vc.contact, consent: { contact: true, v: S.consentV }, hp: q('hp'), turnstile: token });
      }).then(function (r) {
        free();
        var j = r.j || {};
        if (j.ok === false) { bad(j.code === 'E_HUMAN' ? '沒能完成人機驗證。請稍等幾秒再按一次；還是不行，請直接用下面的 LINE 或電話聯絡景泰。' : (ERR_MSG[j.code] || ERR_MSG.E_FORWARD)); return; }
        var m = [];
        if (line) m.push('line'); if (phone) m.push('phone');
        track('contact', { r: 'submit', m: m });
        if (j.saved === false) { bad('目前沒能送出，請改用下面的 LINE 或電話聯絡景泰。'); return; }
        S.contactSent = true; persist();
        $$('input,button', form).forEach(function (i) { i.disabled = true; });
        if (note) note.textContent = '收到了。景泰會用你留的方式回覆。';
        var dm = byId('deg-msg'); if (dm && S.step === 's9') dm.textContent = degradeText(S.degradeKind || 'general');
      }).catch(function () { free(); bad(ERR_MSG.E_FORWARD); });
    });
  });
}

/* ---------- 回饋與疲勞題 ---------- */
var FB_UP = [['just_right', '剛剛好'], ['saves_time', '省時間'], ['want_more', '想再看更多']];
var FB_DOWN = [['price_wrong', '價格不對'], ['area_wrong', '區域不對'], ['too_few', '太少'], ['too_many', '太多'], ['not_what_i_want', '不是我要的'], ['other', '其他']];
function setupFeedback() {
  function fill(id, opts) {
    var b = byId(id); if (!b) return;
    opts.forEach(function (o) { b.appendChild(h('label', { class: 'u2-opt u2-opt--chip' }, [h('input', { type: 'checkbox', value: o[0] }), h('span', { class: 'u2-opt__box' }), h('span', { class: 'u2-opt__txt', text: o[1] })])); });
  }
  fill('fb-tags-up', FB_UP); fill('fb-tags-down', FB_DOWN);
  $$('input[name="rate"]').forEach(function (i) {
    on(i, 'change', function () {
      var up = i.value === 'up';
      byId('fb-more').hidden = false; byId('fb-tags-up').hidden = !up; byId('fb-tags-down').hidden = up;
      byId('fb-thanks').hidden = true;
    });
  });
  on(byId('fb-send'), 'click', function () {
    var sel = $('input[name="rate"]:checked'); if (!sel) return;
    var up = sel.value === 'up', box = byId(up ? 'fb-tags-up' : 'fb-tags-down');
    var tags = $$('input:checked', box).map(function (i) { return i.value; });
    var text = (byId('fb-text') || {}).value || '';
    track('fb', { r: up ? 'up' : 'down', tags: tags, tx: text.trim() ? 1 : 0 });
    if (S.jobId) api('feedback', 'POST', { v: 1, jid: S.jobId, rating: up ? 1 : -1, tags: tags, text: text.trim().slice(0, 120), fatigue: null }).catch(function () { /* 回饋送不出去不影響客人 */ });
    byId('fb-more').hidden = true; byId('fb-thanks').hidden = false;
  });
  $$('[data-fatigue]').forEach(function (b) {
    on(b, 'click', function () {
      var v = b.getAttribute('data-fatigue');
      track('fatigue', { v: v });
      S.fatigueDone = true; persist();
      if (S.jobId) api('feedback', 'POST', { v: 1, jid: S.jobId, rating: null, tags: [], text: '', fatigue: v }).catch(function () { /* ignore */ });
      var q = byId('fatigue-q'), t = byId('fatigue-tags'); if (q) q.textContent = '謝謝，這樣就夠了。'; if (t) t.hidden = true;
    });
  });
}

/* ---------- 點擊分派 ---------- */
function onClick(e) {
  var t = e.target && e.target.closest ? e.target.closest('[data-act],[data-edit],[data-hint],[data-fill],[data-lineq]') : null;
  if (!t) return;
  if (t.hasAttribute('data-fill')) { var ta = byId('free-text'); if (ta) { ta.value = t.getAttribute('data-fill'); ta.focus(); startedHow('free'); } return; }
  if (t.hasAttribute('data-edit')) { editRow(t.getAttribute('data-edit')); return; }
  if (t.hasAttribute('data-hint')) { applyHint(t.getAttribute('data-hint')); return; }
  if (t.hasAttribute('data-lineq')) { track('result_click', { a: 'lineq' }); return; }
  var act = t.getAttribute('data-act');
  if (act === 'continue') { var plan = NE.nextQuestions(S.fields, S.context, S.answered, S.skipped, 4, false); enterQuestions(plan, null); }
  else if (act === 'go-now') goNow();
  else if (act === 'q-back') questionBack();
  else if (act === 'q-skip') skipQuestion();
  else if (act === 'nudge-yes') { track('nudge', { r: 'accept' }); enterQuestions(['q_budget'], null); }
  else if (act === 'nudge-no') { track('nudge', { r: 'decline' }); S.skip = true; toConfirm(); }
  else if (act === 'refine') { track('result_click', { a: 'refine' }); S.refineOf = S.jobId; S.idem = ''; S.jobId = null; S.res = null; toConfirm(); }
  else if (act === 'restart') resetAll();
  else if (act === 'pick') pickMode();
}
function pickMode() {
  startedHow('pick');
  S.fields = S.fields || {};
  S.freeText = '';
  byId('s3-chat').textContent = '';
  enterQuestions(NE.nextQuestions(S.fields, S.context, [], [], 4, false), null);
}
function resetAll() {
  destroyGame();
  if (timers.poll) root.clearTimeout(timers.poll);
  if (timers.tick) root.clearInterval(timers.tick);
  store('del', SESSION_KEY);
  S = freshS(S);
  ['s2-chat', 's3-chat', 's3-tray'].forEach(function (id) { var e = byId(id); if (e) e.textContent = ''; });
  var ta = byId('free-text'); if (ta) ta.value = '';
  var w = byId('wait-game-mount'), sk = byId('game-skipped'), gb = byId('game-skip'); if (w) w.hidden = false; if (sk) sk.hidden = true; if (gb) gb.hidden = false;
  show('s0', true);
}

/* ---------- 啟動 ---------- */
function deviceKind() {
  var w = root.innerWidth || 1024;
  return w < 640 ? 'm' : w < 1024 ? 't' : 'd';
}
function theme() { return doc.documentElement.getAttribute('data-theme') === 'dark' ? 'd' : 'l'; }
/* 開場那一句要跟實際模式一致：收件模式（還不能自動找）時，一開始就講清楚，不要等客人答完才轉彎 */
function applyMode() {
  var t = byId('s0-mode-text');
  if (t && S.mode === 'intake') t.textContent = INTAKE_TEXT;
}
/* 執行期設定（人機驗證 site key、模式、事件憑證）。ok:true 才算抓到（cfgOk）；送出前若還沒抓到會再抓一次 */
function loadConfig() {
  return api('config', 'GET').then(function (r) {
    var j = r.j || {};
    if (j.mode === 'live' || j.mode === 'intake') S.mode = j.mode;
    applyMode();
    if (typeof j.turnstileSiteKey === 'string' && /^[0-9A-Za-z_-]{6,80}$/.test(j.turnstileSiteKey)) S.siteKey = j.turnstileSiteKey;
    if (typeof j.consentV === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.consentV)) S.consentV = j.consentV;
    if (typeof j.evt === 'string' && /^[0-9a-z]{1,8}\.[0-9a-f]{20}$/.test(j.evt)) S.evt = j.evt;
    if (j.ok === true) S.cfgOk = true;
  });
}
function init() {
  var live = byId('s0-live'); if (live) live.hidden = false;
  var qs = '';
  try { qs = new URLSearchParams(root.location.search).get('from') || ''; } catch (e) { qs = ''; }
  if (/^[a-z0-9_]{1,24}$/.test(qs) && !/\d{6,}/.test(qs)) S.from = qs;
  var ev = { src: S.from || undefined, dev: deviceKind(), th: theme() };
  track('view', Object.assign({ __s: 's0' }, ev));

  // 設定（人機驗證 site key、模式）：不擋畫面，抓到再用
  loadConfig().catch(function () { S.mode = 'intake'; applyMode(); });

  on(byId('free-form'), 'submit', function (e) { e.preventDefault(); submitFree((byId('free-text') || {}).value); });
  on(byId('free-text'), 'input', function () { startedHow('free'); });
  on(byId('pick-btn'), 'click', pickMode);
  on(byId('go-btn'), 'click', submit);
  on(byId('err-retry'), 'click', function () { toConfirm(); });
  on(byId('ready-btn'), 'click', function () { track('result_click', { a: 'banner' }); showResult(); });
  on(byId('game-skip'), 'click', skipGame);
  on(byId('clear-btn'), 'click', resetAll);
  on(byId('copy-btn'), 'click', function () {
    var url = (S.res && S.res.shareUrl) || '', note = byId('copy-note');
    track('result_click', { a: 'copy' });
    function done(ok) {
      var box = byId('copy-url');
      if (note) note.textContent = ok ? '已複製。這個連結不含你在意的事。' : '沒能自動複製，已經選取下面的連結，請長按複製。';
      if (!ok && box && url) { box.hidden = false; box.value = url; try { box.focus(); box.select(); } catch (e) { /* ignore */ } }
    }
    try { if (root.navigator.clipboard && url) { root.navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } else done(false); } catch (e) { done(false); }
  });
  on(byId('open-link'), 'click', function () { track('result_click', { a: 'open' }); });
  on(byId('deg-copy'), 'click', function () {
    var s = byId('deg-summary'); if (!s) return;
    try { s.select(); root.navigator.clipboard.writeText(s.value); } catch (e) { try { doc.execCommand('copy'); } catch (e2) { /* ignore */ } }
  });
  on(doc, 'click', onClick);
  on(doc, 'visibilitychange', function () {
    if (doc.hidden) flush(true);
    else {
      doc.title = doc.title.replace(/^（好了）/, '');
      if (S.step === 's6') { if (readyShown) return; poll(); }
    }
  });
  on(root, 'pagehide', function () { track('leave', { __s: stepCode(), ws: S.step === 's6' ? Math.min(1800, Math.round(elapsed() / 1000)) : undefined }); flush(true); });
  setupLeadForms();
  setupFeedback();

  // 重整後接著等（只在同一個分頁，且工作編號還有效）
  var saved = null;
  try { saved = JSON.parse(store('get', SESSION_KEY) || 'null'); } catch (e) { saved = null; }
  if (saved && saved.jobId && /^a[A-Za-z0-9_-]{22}$/.test(saved.jobId) && (saved.step === 's5' || saved.step === 's6' || saved.step === 's7') && saved.fields) {
    S.sid = typeof saved.sid === 'string' && /^[A-Za-z0-9_-]{22}$/.test(saved.sid) ? saved.sid : S.sid;
    S.idem = saved.idem || ''; S.jobId = saved.jobId; S.fields = NE.normalizeFields(saved.fields).fields; S.context = NE.normalizeContext(saved.context).context;
    S.freeText = typeof saved.freeText === 'string' ? saved.freeText.slice(0, 300) : ''; S.fatigueDone = !!saved.fatigueDone;
    S.waitStart = typeof saved.waitStart === 'number' ? saved.waitStart : Date.now(); S.startTs = nowMs();
    if (saved.step === 's7' && saved.res && typeof saved.res.shareUrl === 'string') { S.res = saved.res; showResult(); return; }
    S.contactSent = !!saved.contactSent;
    startWaiting(null);
    return;
  }
  // 還沒送出就重整（手機瀏覽器回收頁面、LINE 內建瀏覽器切出去再回來）：條件不要丟，直接回確認畫面
  if (saved && !saved.jobId && (saved.step === 's2' || saved.step === 's3' || saved.step === 's4') && saved.fields && Object.keys(saved.fields).length) {
    S.sid = typeof saved.sid === 'string' && /^[A-Za-z0-9_-]{22}$/.test(saved.sid) ? saved.sid : S.sid;
    S.fields = NE.normalizeFields(saved.fields).fields; S.context = NE.normalizeContext(saved.context).context;
    S.freeText = typeof saved.freeText === 'string' ? saved.freeText.slice(0, 300) : ''; S.startTs = nowMs();
    S.unsure = [].concat(saved.unsure || []).filter(function (k) { return typeof UNSURE[k] === 'string'; });
    toConfirm();
    verifyRoad();
    return;
  }
  // 首頁「先看幾間」交過來的一句話（放在同分頁的暫存，不在網址、不進伺服器）
  var say = store('get', 'find.say');
  if (say) store('del', 'find.say');
  var h2 = '';
  try { h2 = root.location.hash || ''; } catch (e) { h2 = ''; }
  var stash = store('get', 'find.hash');                  // 頁面一載入就把 #k=／#q= 收進這裡並從網址列拿掉了（見 find.astro 的 head）
  if (stash) { store('del', 'find.hash'); if (!h2) h2 = stash; }
  var km = /^#k=([A-Za-z0-9_-]+)$/.exec(h2);
  var qm = /^#q=(.+)$/.exec(h2);
  if (!say && qm) { try { say = decodeURIComponent(qm[1]); } catch (e) { say = ''; } }
  if (km) {
    var d = NE.fragDecode(km[1]);
    if (d) { S.fields = d.f; S.context = { concerns: d.c.length ? d.c : undefined, special: d.s.length ? d.s : undefined, stage: d.st || undefined, timeline: d.tl || undefined }; S.context = NE.normalizeContext(S.context).context; S.startTs = nowMs(); try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) { /* ignore */ } toConfirm(); return; }
  }
  if (qm) { try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) { /* ignore */ } }
  if (say) { var ta = byId('free-text'); if (ta) ta.value = say.slice(0, 300); submitFree(say); }
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
