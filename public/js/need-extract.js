/*! need-extract.js 白話需求整理（瀏覽器端提示用）
 * 把客人打的一句話整理成「物件條件」，並判斷還缺什麼、下一題問什麼。
 * 只做畫面提示與預填；送出後伺服器端會用白名單欄位重新驗證與組句，不信任這裡的結果。
 * 純函式、零網路、零儲存。classic script：掛 window.NeedExtract，Node 端 module.exports 同一份。
 * 與伺服器端規則用同一份夾具（tests/find/fixtures/need_fixtures.json）逐案比對。
 */
(function (root) {
'use strict';

var D = ['中區', '東區', '南區', '西區', '北區', '北屯區', '西屯區', '南屯區', '太平區', '大里區', '霧峰區', '烏日區', '豐原區', '后里區', '石岡區', '東勢區', '和平區', '新社區', '潭子區', '大雅區', '神岡區', '大肚區', '沙鹿區', '龍井區', '梧棲區', '清水區', '大甲區', '外埔區', '大安區'];
var TYPES = ['elevator_building', 'mid_rise', 'apartment', 'townhouse', 'studio'];
var PARKING = ['flat', 'ramp_flat', 'mechanical', 'any', 'none'];
var STAGES = ['first', 'upgrade', 'invest', 'browse'];
var TIMELINES = ['3m', '6m', '12m', 'browse'];
var SPECIALS = ['school', 'market', 'low_public', 'lighting', 'pets', 'elderly', 'quiet', 'transit'];
var CONCERNS = ['budget_pressure', 'loan', 'condition', 'commute', 'school', 'elderly', 'price_unsure', 'overwhelmed', 'parking', 'timing', 'no_chase', 'other'];
var CONSENT_V = '2026-10-06';
var ZH = '[\\u4e00-\\u9fff]';

function R(src, flags) { return new RegExp(src, flags); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function cpLen(s) { return Array.from(s).length; }

/* ---------- 個資清洗（先清再抽；被清掉的內容不進任何欄位） ---------- */
var UW = '[\\p{L}\\p{N}_]';
var WB = '(?:(?<=' + UW + ')(?!' + UW + ')|(?<!' + UW + ')(?=' + UW + '))';
var SUR = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董溫唐藍蔣石古紀姚連馮歐程湯田康姜白汪鄒尤巫黎涂龔嚴韓袁金童陸夏柳邵';
var TT = '(?:先生|小姐|女士|太太)';
// 數字一律 \p{Nd}（等同 Python 的 \d）：非 ASCII 數字的電話、門牌也要清，標籤與 Python 一致（手機的 0／9 是字面 ASCII，會落到 longdigits＝id）
var PII = [
  ['email', /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi],
  ['email', /[a-z0-9._%+\-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9\-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}/gi],
  ['url', /(?:https?:\/\/|www\.)\S+/gi],
  ['url', R(WB + '[a-z0-9\\-]{2,}(?:\\.[a-z0-9\\-]{2,})*\\.(?:com|net|org|tw|io|me|cc)' + WB + '(?:\\/\\S*)?', 'giu')],
  ['handle', R('(?<!' + UW + ')@[A-Za-z0-9._\\-]{3,30}', 'gu')],
  // 每個 \s* 後面都跟一個必要字元＝線性時間（舊寫法三個 \s* 相鄰：line＋2000 空白會立方時間回溯約 2.5 秒）；語言與舊寫法相同
  ['line', /(?<![A-Za-z])(?:line|賴)\s*(?:id\s*)?(?:[:=是為]\s*)?@?[A-Za-z0-9._\-]{4,30}/gi],
  ['mobile', /(?<!\p{Nd})(?:\+?886[-.\s]?|0[-.\s]?)9(?:[-.\s]?\p{Nd}){8}(?!\p{Nd})/gu],
  ['mobile', /(?:[零〇○一二三四五六七八九][\s\-.]?){8,}/g],
  ['landline', /(?<!\p{Nd})\(?0\p{Nd}{1,2}\)?[-.\s]?\p{Nd}{3,4}[-.\s]?\p{Nd}{4}(?!\p{Nd})/gu],
  ['id', /(?<![A-Za-z0-9])[A-Za-z][12ABCDabcd89]\p{Nd}{8}(?!\p{Nd})/gu],
  ['card', /(?<!\p{Nd})\p{Nd}{4}[-\s]\p{Nd}{4}[-\s]\p{Nd}{4}(?:[-\s]\p{Nd}{4})?(?!\p{Nd})/gu],
  ['longdigits', /(?<![\p{Nd}.])\p{Nd}{9,}(?![\p{Nd}.]|\s?元)/gu],
  ['longdigits', /(?<![\p{Nd}.])\p{Nd}{8}(?![\p{Nd}.]|\s?(?:萬|元|坪|年|樓|F|%|公尺))/gu],
  ['addr', /\p{Nd}{1,4}\s*巷|\p{Nd}{1,4}\s*弄|\p{Nd}{1,4}(?:之\p{Nd}{1,3})?\s*號(?:\s*\p{Nd}{1,3}\s*樓)?(?:\s*之\s*\p{Nd}+)?/gu],
  ['name', R('(?:我姓|敝姓)\\s*[:是為]?\\s*(?:歐陽|司馬|諸葛|上官|范姜|張簡|' + ZH + ')' + TT + '?', 'g')],
  ['name', R('(?:我叫|姓名|名字(?:是|叫)?|聯絡人|稱呼)\\s*[:是為]?\\s*' + ZH + '{2,3}' + TT + '?', 'g')],
  ['name', R('我是\\s*[' + SUR + ']' + ZH + '{1,2}' + TT + '?(?=$|[\\s,，。;；、!！?？]|想|要|在|找|買|看|是|的|有|欲|準備|打算)', 'g')],
  ['title', R('[' + SUR + ']' + ZH + '{0,2}' + TT, 'g')],
  ['orphan', /(?:電話|手機|行動電話|市話|聯絡(?:方式|電話)?|e-?mail|信箱|line\s*id)\s*[:是為]?\s*(?=$|[,，。;；、\s])/gi]
];
var EV_PII = { mobile: 'phone', landline: 'phone', email: 'email', line: 'line', handle: 'line', id: 'id', card: 'id', longdigits: 'id', addr: 'addr', name: 'name', title: 'name' };

// NFKC 之後：換行類字元（\r \n \t 與 U+0085／U+2028／U+2029）換成空白；其餘控制、格式（零寬、雙向、軟連字號、BOM、標籤字元）、Zl／Zp
// 與「看起來是空白的填充字元」（點字空白、韓文填充、變體選擇符…）全部移除，隱形字元插不進電話、區名、價格裡（與伺服器端 normText 同）
var INVISIBLE_FILL = /[\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180D\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;
function normText(t) {
  var s = typeof t === 'string' ? t.normalize('NFKC') : '';
  return s.replace(/[\r\n\t\u0085\u2028\u2029]/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(INVISIBLE_FILL, '').replace(/[<>{}\\`]/g, '');
}

// 非 ASCII 十進位數字（阿拉伯-印度、天城文、泰文…）換成 0-9：Python 的 \d 認、JS 的 \d 只認 0-9（全形等 NFKC 已換）。
// Nd 數字十個一組連續排列：往前找到該組起點，差值就是數值。
var ND_CACHE = {};
function asciiDigits(s) {
  if (!/[^\x00-\x7f]/.test(s)) return s;
  return s.replace(/\p{Nd}/gu, c => {
    var cp = c.codePointAt(0), hit;
    if (cp < 128) return c;
    hit = ND_CACHE[cp];
    if (hit === undefined) {
      var st = cp;
      while (st > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(st - 1))) st--;
      hit = ND_CACHE[cp] = String((cp - st) % 10);
    }
    return hit;
  });
}

function scrub(text) {
  var s = normText(text), types = [];
  PII.forEach(p => {
    var n = 0;
    s = s.replace(p[1], () => { n++; return ' '; });
    if (n && types.indexOf(p[0]) < 0) types.push(p[0]);
  });
  s = s.replace(/\s+/g, ' ').replace(/\s+([,，、;；。])/g, '$1').replace(/([,，、;；。])(?:\s*\1)+/g, '$1')
    .replace(/^[\s,，、;；。:]+|[\s,，、;；。:]+$/g, '');
  var pii = [];
  types.forEach(t => { var c = EV_PII[t]; if (c && pii.indexOf(c) < 0) pii.push(c); });
  return { clean: s, types: types, pii: pii };
}

/* ---------- 中文數字 ---------- */
var CD = { '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
var CU = { '十': 10, '百': 100, '千': 1000 };
var CNUM = '[零〇一二兩三四五六七八九十百千]';
var NUM = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|' + CNUM + '+(?:點[零〇一二三四五六七八九]+)?)';

function cnToNum(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim().replace(/,/g, '');
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  // 口語混寫「3千5」「2千8百」＝3500、2800（與伺服器端規則同）
  if (/^[1-9][千百](?:[1-9]百?)?$/.test(s)) s = s.replace(/[1-9]/g, d => '零一二三四五六七八九'.charAt(+d));
  var i = s.indexOf('點'), k, ch;
  if (i >= 0) {
    var a = s.slice(0, i), b = s.slice(i + 1), ip = a ? cnToNum(a) : 0, dig = '';
    if (ip === null || !b) return null;
    for (k = 0; k < b.length; k++) { if (!(b[k] in CD)) return null; dig += CD[b[k]]; }
    return parseFloat(Math.floor(ip) + '.' + dig);
  }
  var hasU = false;
  for (k = 0; k < s.length; k++) { ch = s[k]; if (!(ch in CD) && !(ch in CU)) return null; if (ch in CU) hasU = true; }
  if (!hasU) {
    if (s.length === 1) return CD[s];
    return parseInt(Array.from(s).map(c => CD[c]).join(''), 10);
  }
  var total = 0, num = 0;
  for (k = 0; k < s.length; k++) {
    ch = s[k];
    if (ch in CD) num = CD[ch];
    else {
      if (num === 0 && ch === '十' && total === 0) num = 1;
      total += num * CU[ch];
      num = 0;
    }
  }
  if (num) {
    var p = s[s.length - 2];
    total += (s.length >= 2 && (p === '百' || p === '千')) ? num * (CU[p] / 10) : num;
  }
  return total;
}
function isInt(n) { return typeof n === 'number' && Number.isInteger(n); }
function rint(x) { return Math.floor(x + 0.5); }
function mask(t, a, b) { return t.slice(0, a) + new Array(b - a + 1).join(' ') + t.slice(b); }
function all(rx, t) { return Array.from(t.matchAll(rx)); }
function cnSection(n) {
  var cn = '零一二三四五六七八九';
  if (n < 10) return cn[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + cn[n - 10];
  return cn[Math.floor(n / 10)] + '十' + (n % 10 ? cn[n % 10] : '');
}

/* ---------- 規則表 ---------- */
var ALIAS = {};
D.forEach(d => { if (d.length > 2) ALIAS[d.slice(0, -1)] = d; });
// 常見的同音／形近錯字（客人手機打字常見），只收「不會變成別的地名」的（與伺服器端規則同）
[['大裡', '大里區'], ['豐源', '豐原區'], ['霧鋒', '霧峰區'], ['后裡', '后里區'], ['神崗', '神岡區']].forEach(p => { if (D.indexOf(p[1]) >= 0) ALIAS[p[0]] = p[1]; });
function byLenDesc(a, b) { return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0); }
var DIST_ALT = D.concat(Object.keys(ALIAS)).sort(byLenDesc);
var DIST_RE = R('(' + DIST_ALT.join('|') + ')', 'g');
var DIST_BLOCK = /^(?:[路街溪橋模洋巷]|國小|國中|大道|公園|市場|夜市)/;
var OTHER_CITIES = ['台北', '新北', '桃園', '新竹', '苗栗', '彰化', '南投', '雲林', '嘉義', '台南', '高雄', '屏東', '宜蘭', '花蓮', '台東', '基隆', '澎湖', '金門', '馬祖'];

var UNBUILT_A = R('(?:近|靠近|附近|鄰近|旁邊|旁|在|位於|臨)?(?:未來的?|規劃中的?|興建中的?|預計|即將)?(?:台中)?(?:捷運藍線?|藍線|橘線|輕軌|巨蛋站|未來捷運|未來的捷運)(?:' + ZH + '{0,4}站|沿線|周邊|站點)?', 'g');
var UNBUILT_B = R('(?:預計|即將|規劃中的?|興建中的?|籌備中的?)[\\u4e00-\\u9fff0-9]{0,8}?(?:捷運|學校|國小|國中|高中|公園|商場|百貨|重劃區|重劃|道路|建設|站|醫院|機場|交流道|輕軌|BRT|大型)' + ZH + '{0,3}', 'g');
// 「還沒蓋好」的說法太多，不逐字列舉：標記詞（規劃中／還在蓋／以後會有…）與公共建設名詞在 10 字內同時出現（前後順序都算）。
// 已通車的（綠線、高鐵）沒有標記詞就不會中。字面與伺服器端規則一字不差（長度上限固定，不會平方時間）。
var UB_MARK = '(?:規劃中?|還在蓋|在蓋|要蓋|將蓋|快蓋好|興建中?|施工中|預定|預計|籌備中?|' +
  '(?:以後|將來|未來|日後)(?:會|要|將|才)(?:有|蓋|通|開|設|完工)|聽說' + ZH + '{0,4}?(?:要|會)(?:蓋|有|設))';
var UB_NOUN = '(?:捷運|輕軌|學校|小學|國小|國中|高中|大學|公園|商場|百貨|重劃區|重劃|道路|交流道|醫院|機場|車站|站點|' +
  '綠園道|BRT|巨蛋|市政|地標)';
var UNBUILT_C = R(UB_MARK + '[\\u4e00-\\u9fff0-9]{0,10}?' + UB_NOUN + '|' + UB_NOUN + '[\\u4e00-\\u9fff0-9]{0,6}?' + UB_MARK, 'g');
var PRESALE = /預售屋?|新建案|建案|期房|新案/;

var SEP = '(?:到|至|~|-)';
/* 樓層排除（W3 通則）：清單＋前後否定詞。
 *   清單項：1樓／一樓／4F／二十四樓／頂樓（含最頂樓、最高樓層）／區間（1樓到3樓、一到三樓）／連寫（一二樓＝1、2樓）；
 *   分隔：頓號逗號、及和與跟或、還有、空白、直接相連（一樓二樓）。沒有「樓／F／頂」的數字清單一律不收（4 14 的後面一定要有樓）。
 *   否定詞可在前（不要／排除／避開／忌諱／介意／別給我…）或在後（…都不要／都避開／免談）。「頂加」不在此處理。 */
var FL_N = '(?:\\d{1,2}(?!\\d)|[一二三四五六七八九十]{1,3})';
var FL_U = '(?:樓|[Ff](?![A-Za-z]))';
var FL_TOP = '(?:最頂|最高|頂)(?:樓層|樓|層)';
var FL_ONE = '(?:' + FL_N + '\\s*' + FL_U + ')';
var FL_BARE = '(?:' + FL_N + '(?![房坪年萬億間千百%點字號期個月歲位戶元公尺平層人口樓Ff]))';
var FL_RNG = '(?:' + FL_N + '\\s*' + FL_U + '?\\s*(?:到|至|~|～|-|－|—)\\s*' + FL_N + '\\s*' + FL_U + ')';
var FL_ITEM = '(?:' + FL_RNG + '|' + FL_ONE + '|' + FL_TOP + '|' + FL_BARE + ')';
var FL_NEXT_END = '(?!\\s*(?:以上|以下|之上|之下|或以上|及以上|起))';
var FL_SEP = '(?:\\s*(?:[、,，.．/及和與跟或]|還有|以及)\\s*|\\s+|(?=(?:' + FL_RNG + '|' + FL_ONE + ')))';
var FL_CHAIN = R(FL_ITEM + '(?:' + FL_SEP + FL_ITEM + FL_NEXT_END + ')*', 'g');
var FL_CUE = '(?:不要|請不要|排除|避開|避免|不想要|不想|不考慮|不含|不住|不選|不買|不看|不接受|拒絕|忌諱|介意|' +
  '別給我|別給|別住|別選|別買|別要|不能接受|不可以住|不能住)';
var FL_PRE = R(FL_CUE + '\\s*(?:住|給我|買|選|看|到|在|是|有)?\\s*$');
var FL_SUF_CUE = '(?:不要|不考慮|不想要|不想住|不想|避開|免談|不接受|排除|拒絕|避免|不住|不行|不可以|不能接受|不碰|不選|不看)';
var FL_SUF = R('^\\s*(?:店面|店鋪|的|那層|那間|層)?\\s*(?:我|都|也|更|真的|全部|通通|全都|還是|就|是)*\\s*' +
  '(' + FL_SUF_CUE + ')(?=$|[\\s，,。；;！!？?、：:）)」』\\]]|[了的啦喔哦啊吧嘛唷])' + // 否定詞後面要收尾（「3樓 不要太吵」不是排除3樓）
  '(?!\\s*(?:住|給我|買|選|看)?\\s*(?:' + FL_ONE + '|' + FL_TOP + '))');
var FL_EXCEPT = R('除了\\s*(' + FL_ITEM + '(?:' + FL_SEP + FL_ITEM + FL_NEXT_END + ')*)\\s*(?:以外|之外)?\\s*[，,、\\s]*(?:其他|其餘|別的)?' + ZH + '{0,4}?' +
  '(?:都可以|都行|都OK|都ok|都好|都沒問題|可以|OK|ok|沒問題|都接受)', 'g');
var FL_TOK = R('(' + FL_TOP + ')|(' + FL_N + ')\\s*' + FL_U + '?\\s*(?:到|至|~|～|-|－|—)\\s*(' + FL_N + ')\\s*' + FL_U + '|(' + FL_N + ')', 'g');
// 取消先前的排除（R4）：「不排除頂樓」「頂樓也可以」。排除與取消照出現順序處理，最後一次說了算。
var FL_OK_PRE = /(?:不排除|不用避開|不必避開|不需要避開|不需避開|不介意|不在意|可以接受|可以考慮|不拒絕)\s*(?:住|給我|買|選|看|到|在)?\s*$/;
var FL_OK_SUF = /^\s*(?:層|樓層|的)?\s*(?:我|都|也|其實|還是|也是|就|是|倒是|好像|似乎|應該|真的)*\s*(?:可以接受|可以考慮|可以|也行|行|OK|ok|沒關係|沒問題|不介意|不在意|無所謂|都好|接受|不排除|不用避開|不必避開)(?=$|[\s，,。；;！!？?、：:）)」』\]]|[了的啦喔哦啊吧嘛唷])/;
var TOP_SUFFIX = /頂[樓層]\s*(?:不要|不考慮|不想要|排除)/g;
var FLOOR_MIN = /(\d{1,2}|[一二三四五六七八九十]{1,3})\s*樓\s*(?:或|及)?\s*(?:以上|起)/g;

var AREA_RANGE = R('(' + NUM + ')\\s*' + SEP + '\\s*(' + NUM + ')\\s*坪', 'g');
var AREA = R('(?<!每)(' + NUM + ')\\s*坪\\s*(以上|起|以內|以下|之內|內|左右|上下|前後|大概)?', 'g');
var AGE_RANGE = R('屋齡\\s*(' + NUM + ')\\s*' + SEP + '\\s*(' + NUM + ')\\s*年', 'g');
var AGE_MAX = R('(?:屋齡\\s*(?:約|大概|大約)?\\s*)?(' + NUM + ')\\s*年\\s*(?:以內|之內|以下|內)', 'g');
var AGE_BARE = R('屋齡\\s*(?:約|大概|大約)?\\s*(' + NUM + ')\\s*年(?!\\s*(?:以上|起))', 'g');
var AGE_NEW = /新大樓|新成屋|新屋(?!區)/;

var RN = '(?:[1-6]|[一二兩三四五六])';
var ROOM_RANGE = R('(' + RN + ')\\s*' + SEP + '\\s*(' + RN + ')\\s*房', 'g');
var ROOM_PLUS = /(\d)\s*\+\s*(\d)\s*房/g;
var ROOM_OR = R('(' + RN + ')\\s*房?\\s*(?:或|/|、|還是)\\s*(' + RN + ')\\s*房', 'g');
var ROOM_ADJ = /([二兩三四五])([三四五六])\s*房/g;
// W3：「至少要三房」「最少2房的」只有下限；「三間房」＝3 房（「一間房子」是買一間屋，不收）；「房間至少四間」＝下限 4；
// 「兩房加一間書房／兩房+書房」＝2～3 房（書房、和室、工作室、多功能房算多一間可用的房）。
var ROOM_AT_LEAST = '(?:至少|最少|起碼|最低|最起碼)\\s*(?:要有|需要有|需有|要|需要|得|有)?\\s*';
var RN2 = '(?:[2-6]|[二兩三四五六])';
var ROOM_NOT_HOUSE = '(?!子|屋|仲|東|產|價|貸|地|號)'; // 「一間房子」「三間房東」不是房數
var ROOM_UP = R('(?:' + ROOM_AT_LEAST + ')?(' + RN + ')\\s*房\\s*(?:以上|起|或以上)|(?:' + ROOM_AT_LEAST + ')?(' + RN2 + ')\\s*間\\s*房' + ROOM_NOT_HOUSE + '\\s*(?:以上|起|或以上)|' +
  ROOM_AT_LEAST + '(' + RN + ')\\s*房|' + ROOM_AT_LEAST + '(' + RN2 + ')\\s*間\\s*房' + ROOM_NOT_HOUSE, 'g');
var ROOM_DOWN = R('(' + RN + ')\\s*房\\s*(?:以下|以內|之內)', 'g');
var ROOM_COUNT = R('(?:房間|房數|臥室|臥房|睡房)\\s*(至少|最少|起碼|最低|要有|需要有|需有|要|需要|共|有)?\\s*(' + RN2 + ')\\s*(?:間|個)\\s*(以上|起)?', 'g');
var ROOM_JIAN = R('(' + RN2 + ')\\s*(?:間|個)\\s*(?:房間|房|臥室|臥房|睡房)' + ROOM_NOT_HOUSE, 'g');
var ROOM_EXTRA_WORD = '(?:書房|和室|工作室|工作間|多功能(?:房|室)?|彈性房|客房|兒童房|小孩房|嬰兒房)';
var ROOM_EXTRA = R('(' + RN + ')\\s*房\\s*(?:加上|再加|外加|另加|加|\\+|＋)\\s*(?:([一二兩三1-3])\\s*(?:間|個)?\\s*)?(?:開放式)?' + ROOM_EXTRA_WORD, 'g');
var ROOM_ONE = R('(' + RN + ')\\s*房', 'g');

var UNIT_MULT = { '萬': 1, '千萬': 1000, '億': 10000 };
var PRICE_OWN_RANGE = R('(' + NUM + ')\\s*(千萬|萬|億)\\s*' + SEP + '\\s*(' + NUM + ')\\s*(千萬|萬|億)', 'g');
var PRICE_RANGE = R('(' + NUM + ')\\s*' + SEP + '\\s*(' + NUM + ')\\s*(千萬|萬|億)', 'g');
var PRICE_YI = R('(' + NUM + ')\\s*億\\s*(?:(' + NUM + ')\\s*(千萬|萬))?', 'g');
var PRICE_UNIT = R('(' + NUM + ')\\s*(千萬|萬)', 'g');
var PRICE_YUAN = /(?<![\d.])(\d{6,9})\s*元/g;
var PRICE_KRANGE = R('(?:預算|價位|總價|價格|售價)\\s*(?:在|約|是|為|大約在|大概在|大約|大概|落在|抓在|抓|設在)?\\s*(\\d{3,5})\\s*' + SEP + '\\s*(\\d{3,5})(?![\\d.]|\\s*[坪年樓房%公尺mM])', 'g');
var PRICE_KW = /(?:(預算|總價|價格|價位|售價|最多|不超過|不要超過|上限|頂多|至多|最高|至少|最少|下限|起碼|控制在)\s*(?:在|約|大約|大概|是|為|:)?\s*(\d{3,5})(?![\d.]|\s*[坪年樓房%公尺mM])|(?<![\d.])(\d{3,5})\s*(以內|之內|內|以下|以上|左右|上下|封頂|起)(?!\d))/g;
var PRICE_THOUSAND = /(?<![\d零〇一二兩三四五六七八九十百千])千萬\s*(以內|以下|內|以上|左右|上下)/g;
// 口語「一千八」「兩千二」「一千八百」（沒說萬）：只在有方向詞（以內／預算…）、或整句沒有其他價格時才收
var COLLOQ_NUM = '[一二兩三四五六七八九1-9]千(?:[一二三四五六七八九1-9]百?)?';
var COLLOQ_NOT_AFTER = '(?![\\d零〇一二兩三四五六七八九十百千萬億元坪房樓年公尺平])';
var PRICE_COLLOQ_RANGE = R('(?<![\\d.零〇一二兩三四五六七八九十百千])(' + COLLOQ_NUM + ')\\s*(?:到|至|~|～|-|—)\\s*(' + COLLOQ_NUM + ')' + COLLOQ_NOT_AFTER, 'g');
var PRICE_COLLOQ = R('(?<![\\d.零〇一二兩三四五六七八九十百千])(' + COLLOQ_NUM + ')' + COLLOQ_NOT_AFTER + '(?!\\s*(?:到|至|~|～|-|—)\\s*[\\d一二兩三四五六七八九])', 'g');
var SOFT_AFTER = /^\s*(?:出頭|多一點|多一些|多些|多點)/;
var COLLOQ_BAD_NEXT = /[\d零〇一二兩三四五六七八九十百千萬億元坪房樓年公尺平]/;
var COLLOQ_BAD_PREV = /[\d.零〇一二兩三四五六七八九十百千]/;
var DIR_MAX = ['以內', '之內', '以下', '之下', '內', '封頂', '為限', '上限'];
var DIR_MIN = ['以上', '之上', '起', '起跳', '起算'];
var PRE_MAX = /(?:預算|不超過|最多|上限|頂多|不要超過|至多|最高|不想超過|控制在|控在|總價|價位|售價)\s*(?:在|約|大約|大概|是|為|:)?\s*$/;
var PRE_MIN = /(?:至少|最少|下限|起碼)\s*(?:在|約|大約|大概|是|為|:)?\s*$/;
var SUF = /^\s*(以內|之內|以下|之下|內|封頂|為限|上限|以上|之上|起跳|起算|起|左右|上下|前後|大概|大約)/;
var NB_AFTER = /^(?:的)?(?:頭期|自備|首付|月付|月租|貸款|房貸|現金|訂金|裝潢|裝修)/;
var NB_BEFORE = /(?:頭期款?|自備款?|首付款?|月付|月租|貸款|房貸|現金|訂金|裝潢費?|裝修費?)\s*(?:大概|大約|約|是|有|準備|預計)?\s*$/;

var PK_NONE = /(?:不用|不需要|不要|不必|沒有|無需)\s*(?:車位|停車)/;
var PK_RAMP = /坡平|坡道平面(?:車位)?|坡道式平面/g;
var PK_FLAT = /平車|平面車位|平面停車|平面式|平面(?!圖|屋)/g;
var PK_MECH = /機械(?:式)?(?:車位|停車)?/g;
var PK_MECH_NEG = /(?:不要|不想要|不接受|避開|排除|不能|拒絕|不考慮|不用)\s*$/;
var PK_ANY = /(?:要|需要|有|附|含|一定要|必須|想要)\s*(?:[一二兩三1-3]個|雙)?\s*車位/;

var TYPE_RULES = [
  ['elevator_building', /電梯大樓|大樓/g], ['mid_rise', /電梯華廈|華廈/g], ['apartment', /公寓|無電梯/g],
  ['townhouse', /透天厝|透天|別墅|獨棟/g], ['studio', /套房/g]
];
var ELEVATOR = /(?:要|需要|有|一定要|必須|想要)\s*電梯/;

var FILLER = R('^(?:我想買|我想找|我想要|我要買|我要找|我想|我要|想買|想找|想要|要買|要找|找|買|在|於|的|近|靠近|附近|位於|位在|住|間|戶|新|老|中古|透天|大樓|華廈|公寓|套房|平車|車位|預算|以內|以下|和|與|跟|及|或|還有|而且|最好|希望|如果|可以|可能|大概|左右|上下|不要|排除|避開|有|沒有|無|台中市|台中|' + CNUM + '+(?:房|樓|坪|年|萬|億))');
var ROAD = R('((?:(?![路街])' + ZH + '){1,10})(大道|路|街)(?:\\s*(\\d{1,2}|[一二三四五六七八九十]{1,2})\\s*段)?', 'g');
var ROAD_BAD_BASE = ['道', '馬', '公', '高速公', '快速', '大', '小', '產業', '鐵', '國道', '省道', '縣道', '鄉道', '林道', '快速道', '高架', '這條', '那條', '哪條', '每條', '一', '兩'];
var ROAD_BAD_NEXT = '線口邊況程途徑人燈牌障';
// 路名裡絕對不會出現的口語字（人稱、動詞、助詞、介詞…）：台中市任何一條路名都沒有這些字（extract_rt11.test.mjs 用 roads_tc.ts 逐字核對），
// 所以含其中一字的「路名」，Python 的路名字典也一定丟掉——這裡先丟，結果一致。
// R4-CMP-1：末尾補「面離對側米沿著緊貼產」（面馬路、離大路、對面大馬路、十二米路、沿著馬路、緊臨馬路、產業道路），同樣 0 次出現在真路名。
// 「近／臨」在真路名裡（近山路、臨港路），不能放這裡；近馬路、臨大馬路這類泛稱在 extRoad 用形狀擋。
var ROAD_JUNK = /[我你他她想要找買賣住在到去從往請問幫給看換租搬是的了也就還但可能先再旁邊附預算房屋兩百層個廳位梯捷運超商透廈寓套價錢左右概約最希望果而且或跟與及沒無不用需求喜歡覺認為議推薦走步鐘騎搭乘周鄰靠於座落坐帶那這哪什麼怎因所然目未計即將規完蓋老古話絡箱謝感煩拜託出改免談付避加其實雄多點說少小期款起採養狗錯此式服務圍千速区万内价买个间两预贷学层厅没这还对时车东面離對側米沿著緊貼產]/;

var STAGE_RULES = [['first', /第一次買|第一次|首購|新手/], ['upgrade', /換屋|換大|換小|換房/], ['invest', /投資|收租|包租/], ['browse', /還在看|隨便看|先看看|只是看看|先了解/]];
var CONCERN_RULES = [['loan', /貸款|房貸|青安|頭期款|自備款|核貸/], ['condition', /漏水|壁癌|屋況/], ['commute', /通勤|上班/], ['school', /學區|國小|國中/], ['elderly', /長輩|爸媽|父母|老人|電梯/], ['price_unsure', /行情|怕買貴|被坑|被騙|貴不貴|合理價/], ['parking', /車位/]];
var SPECIAL_RULES = [['school', /學區/], ['market', /市場|生活機能|超市|賣場/], ['low_public', /公設比低|公設少|低公設/], ['lighting', /採光|通風|明亮/], ['pets', /寵物|養狗|養貓|毛小孩/], ['elderly', /長輩友善|無障礙/], ['quiet', /安靜|不吵/], ['transit', /近捷運|捷運宅|捷運旁|公車|交通方便|交通便利/]];
var PREFIXES = DIST_ALT;

/* 自我更正／別人的意見（W3；R4 擴到全部欄位群；規則與伺服器端同）：
 *   · 更正標記詞之後（同一句）出現某一欄位群的值（樓層排除、坪數、屋齡、房數、價格、車位、型態、區域），標記詞之前同群的值就不收（蓋成空白）。
 *   · 標記：改成／更正／口語（啊不是、欸不對、錯了、我是說）／不是 X 是 Y（舊值在後面）／原本、之前這一小句是舊的／提高到、降到、改兩房／後來想想。
 *   · 沒有標記詞 → 維持現狀。前面有「如果／不然…」或新值後面接「也可以」→ 兩個都留、inferred 加 correction_unsure。
 *   · 標記詞被否定（不要改成…）、或整句像在對 AI 下指令 → 不當更正（注入防線不被「改成」二字繞過）。
 *   · 「某某人想／要＋…，（後面）我要的是／但我要…」→ 某某人那一小句裡各欄位群的值不收。 */
var CORR_STRONG = '改成|改為|改說|改講|改一下|改回|更正|更改為|更改成|修改成|修改為|修正為|調整為|調成|重講|重新說|重新講|重說|' +
  '算了(?![一下算半天])|(?<!對)不對(?![外稱等勁起])|[說講打寫搞記算弄看選按]錯|口誤|' +
  '[啊喔哦噢欸呃哎唉]\\s*不是|不是啦|不對啦|錯了|不是[，,、]\\s*是|我是說|我說的是|我指的是|應該說|我的意思是|' +
  '(?:提高|調高|拉高|提升|增加|放寬|降低|調降|壓低|減少|縮減|加碼)[到至]|[降加拉調改升縮]到|' +
  '後來(?:想想|想了想|想一想|才?覺得|才?發現|決定|又覺得)|想(?:想|一想)還是|最後(?:決定|還是)|' +
  '改(?![裝建天善動版造良期約隔格])';
var CORR_SELFV = '我(?:真正|自己)?(?:想要?|要)(?:買|找)?的是|我真正(?:想要?|要)(?:找|買)?的?|真正(?:想要?|要)(?:找|買)?的?是?|' +
  '其實(?:我)?(?:想|要)|我自己(?:想|要)|(?:但|可是|不過|只是|而)我(?:自己)?(?:要|想|覺得|認為|比較喜歡|偏好|傾向|比較想|比較要|是要|是想)|' +
  '我比較(?:想|要)|我們要的是|我自己的(?:條件|需求|想法)|我的(?:真正)?(?:條件|需求)|(?:聽|照|依)我的';
var CORR_NEGVAL = '[^，,。；;！!？?\\n是]{1,12}'; // 「不是北屯，是西屯」：被否定的舊值（≤12 字、無標點）
// 群 1＝不是 X 是 Y；群 2＝原本／之前；其餘＝一般更正標記詞
var CORR_RE = R('((?:[啊喔哦噢欸呃哎唉]\\s*)?不是(?=' + CORR_NEGVAL + '[，,]?\\s*是))|(?:' + CORR_STRONG + ')|(?:應該是|其實是|' + CORR_SELFV + ')|(原本|本來|一開始|剛開始|起初|最初|之前|先前|原先|早先)', 'g');
var SELF_ONLY = R(CORR_SELFV);
var CORR_NEG = /(?:不要|不用|不必|別|不想|不會|沒有|不能|不可以|不需要|無需|沒要|沒打算|不打算)\s*$/;
var CORR_HEDGE = /(?:如果|萬一|要是|假如|倘若|不然|要不然|不行|不成|沒有的話|沒的話|備案|也許|或許|說不定)/;
var CORR_ALSO_OK = /^[^，,。；;！!？?\n]{0,14}?也(?:可以|行|OK|ok|好|沒問題)/;
var CORR_INSTR_ZH = /系統|管理員|管理者|指示|指令|提示詞|欄位|輸出|回傳|填成|填入|設為|設成|設定為|標示|標記為|忽略|無視|扮演|模型|機器人|資料庫|所有客|所有查詢|內含/;
var CORR_INSTR_EN = /vip|admin|system|prompt|ignore|override|instruction|json|yaml|xml|(?<![a-z])ai(?![a-z])/i;
var CORR_GENERIC_TARGET = /(?:區域|地區|縣市|城市)\s*(?:全部|都)?\s*$/;
var SENT_END = '。！？!?\n；;';
var CLAUSE_END = '，,。；;！!？?\n';
var OTHERS = R('(?:老公|老婆|先生|太太|丈夫|妻子|爸媽|爸爸|媽媽|父母|岳父|岳母|公公|婆婆|公婆|朋友|同事|小孩|孩子|兒子|女兒|' +
  '姊姊|姐姐|哥哥|弟弟|妹妹|家人|親戚|室友|男友|女友|(?<!其)他|她)' +
  '(?:的意見|們)?(?:都|還|也|比較|一直|有說|說)?(?:想要?|要|覺得|認為|喜歡|希望|建議|偏好|主張|想住|要住|叫我|勸我|逼我)', 'g');
var OTHERS_MAX_HITS = 6;  // 一份輸入最多看前 6 個「某某人想／要」命中
var OTHERS_MAX_SEG = 80;  // 「某某人想／要…」那一小句超過 80 字就不處理（正常口語 20～40 字；超長多半是灌字）
var CORR_MAX_MARKS = 6;
var EXTRACT_CLIP = 2000;  // extract 入口先截到這麼長（與伺服器端規則同；網頁輸入框只收 300 字，這是最後一道保險）
var NUMRUN = /[零〇一二兩三四五六七八九十百千]{13,}|\d{13,}/g; // 13 個以上的數字（中文或阿拉伯）連在一起不可能是價格／坪數／樓層：只留前 12 個，免得灌字讓數字正規式走平方時間

/* ---------- 抽取 ---------- */
function dropUnbuilt(t, dropped) {
  var n = 0;
  t = t.replace(UNBUILT_A, () => { n++; return ' '; });
  t = t.replace(UNBUILT_B, () => { n++; return ' '; });
  t = t.replace(UNBUILT_C, () => { n++; return ' '; });
  if (n) dropped.push('unbuilt');
  return t;
}

function priceDir(t, a, b) {
  var m = SUF.exec(t.slice(b, b + 6));
  if (m) {
    var w = m[1];
    return DIR_MAX.indexOf(w) >= 0 ? 'max' : DIR_MIN.indexOf(w) >= 0 ? 'min' : 'approx';
  }
  var pre = t.slice(Math.max(0, a - 10), a);
  if (PRE_MIN.test(pre)) return 'min';
  if (PRE_MAX.test(pre)) return 'max';
  if (/(?:約|大約|大概)\s*$/.test(pre)) return 'approx';
  return null;
}

// 樓層數字（回陣列）：阿拉伯數字；中文有「十」照一般讀法（十四＝14、二十四＝24），沒有「十」的連寫逐字拆（一二＝1、2）
function flNum(s) {
  if (/^\d+$/.test(s)) return [parseInt(s, 10)];
  if (s.indexOf('十') < 0 && s.length >= 2) {
    var out = [];
    for (var i = 0; i < s.length; i++) if (s.charAt(i) in CD) out.push(CD[s.charAt(i)]);
    return out;
  }
  var n = cnToNum(s);
  return isInt(n) ? [n] : [];
}
// 樓層清單字串 → { nums, top }。區間（1樓到3樓、一到三樓）展開；區間跨度上限 20 層
function flChainParse(chain) {
  var nums = [], top = false;
  all(FL_TOK, chain).forEach(m => {
    var a, b, i;
    if (m[1]) top = true;
    else if (m[2] !== undefined) {
      a = flNum(m[2]); b = flNum(m[3]);
      if (a.length === 1 && b.length === 1 && a[0] >= 1 && a[0] <= b[0] && b[0] <= 60 && b[0] - a[0] <= 20) for (i = a[0]; i <= b[0]; i++) nums.push(i);
    } else nums = nums.concat(flNum(m[4]));
  });
  return { nums: nums, top: top };
}

function extFloors(t, raw) {
  var ex = [], top = false, fm = null, evs = []; // evs：[位置, 樓層清單字串, 是排除嗎]，排除與取消照出現順序處理
  all(FL_EXCEPT, t).forEach(m => { evs.push([m.index, m[1], 1]); t = mask(t, m.index, m.index + m[0].length); }); // 除了一樓以外都可以
  all(FL_CHAIN, t).forEach(m => { // 清單 ＋ 前面或後面的否定詞（或「不排除／也可以」的取消詞）
    var chain = m[0];
    if (!/樓|[Ff]|頂|最高/.test(chain)) return;
    var s = m.index, e = s + chain.length, w0 = Math.max(0, s - 12), a, b, suf;
    var ok = FL_OK_PRE.exec(t.slice(w0, s)), pre = ok ? null : FL_PRE.exec(t.slice(w0, s));
    if (ok) { a = w0 + ok.index; b = e; }
    else if (pre) { a = w0 + pre.index; b = e; }
    else if ((suf = FL_SUF.exec(t.slice(e, e + 30)))) { a = s; b = e + suf[0].length; } // 否定詞後面只剩零寬度的收尾檢查，整段比對的結尾就是否定詞的結尾
    else if ((ok = FL_OK_SUF.exec(t.slice(e, e + 30)))) { a = s; b = e + ok[0].length; }
    else return;
    evs.push([s, chain, ok ? 0 : 1]);
    t = mask(t, a, b);
  });
  all(TOP_SUFFIX, t).forEach(m => { evs.push([m.index, '頂樓', 1]); t = mask(t, m.index, m.index + m[0].length); });
  evs.sort((x, y) => x[0] - y[0]).forEach(v => {
    var p = flChainParse(v[1]);
    if (v[2]) {
      top = top || p.top;
      p.nums.forEach(n => { if (n >= 1 && n <= 60 && ex.indexOf(n) < 0) ex.push(n); });
    } else {
      top = top && !p.top;
      ex = ex.filter(n => p.nums.indexOf(n) < 0);
    }
  });
  all(FLOOR_MIN, t).forEach(m => {
    var n = cnToNum(m[1]);
    if (isInt(n) && n >= 1 && n <= 60 && fm === null) fm = n;
    t = mask(t, m.index, m.index + m[0].length);
  });
  if (ex.length) raw.floor_exclude = ex;
  if (top) raw.exclude_top = true;
  if (fm !== null) raw.floor_min = fm;
  return t;
}

function extArea(t, raw, inferred) {
  all(AREA_RANGE, t).forEach(m => {
    var a = cnToNum(m[1]), b = cnToNum(m[2]);
    if (a !== null && b !== null) {
      var lo = rint(Math.min(a, b)), hi = rint(Math.max(a, b));
      if (lo >= 5 && hi <= 300 && !('area_min_ping' in raw)) { raw.area_min_ping = lo; raw.area_max_ping = hi; }
    }
    t = mask(t, m.index, m.index + m[0].length);
  });
  all(AREA, t).forEach(m => {
    var n = cnToNum(m[1]), d = m[2];
    t = mask(t, m.index, m.index + m[0].length);
    if (n === null || !(n >= 5 && n <= 300) || 'area_min_ping' in raw || 'area_max_ping' in raw) return;
    if (d === '以上' || d === '起') raw.area_min_ping = rint(n);
    else if (d === '以內' || d === '以下' || d === '之內' || d === '內') raw.area_max_ping = rint(n);
    else { raw.area_min_ping = rint(n * 0.9); raw.area_max_ping = rint(n * 1.1); inferred.push('area_approx'); }
  });
  return t;
}

function extAge(t, raw, inferred) {
  function put(n, tag) {
    if (typeof n === 'number' && n >= 1 && n <= 60 && !('age_max' in raw)) { raw.age_max = Math.trunc(n); if (tag) inferred.push(tag); }
  }
  all(AGE_RANGE, t).forEach(m => { put(cnToNum(m[2])); t = mask(t, m.index, m.index + m[0].length); });
  all(AGE_MAX, t).forEach(m => { put(cnToNum(m[1])); t = mask(t, m.index, m.index + m[0].length); });
  all(AGE_BARE, t).forEach(m => { put(cnToNum(m[1]), 'age_dir'); t = mask(t, m.index, m.index + m[0].length); });
  if (!('age_max' in raw) && AGE_NEW.test(t)) { raw.age_max = 5; inferred.push('age_new'); }
  return t;
}

function roomN(s) { return /^\d$/.test(s) ? parseInt(s, 10) : CD[s]; }
function extRooms(t, raw) {
  var lo = null, hi = null, seen = false, upOnly = null, downOnly = null;
  function add(a, b) { seen = true; lo = lo === null ? a : Math.min(lo, a); hi = hi === null ? b : Math.max(hi, b); }
  function eat(m) { t = mask(t, m.index, m.index + m[0].length); }
  [ROOM_RANGE, ROOM_OR].forEach(rx => {
    all(rx, t).forEach(m => {
      var a = roomN(m[1]), b = roomN(m[2]);
      if (a && b) add(Math.min(a, b), Math.max(a, b));
      eat(m);
    });
  });
  all(ROOM_EXTRA, t).forEach(m => { // 兩房加一間書房、2房+1書房、三房＋書房
    var a = roomN(m[1]), k = m[2] ? roomN(m[2]) : 1;
    if (a && k && a + k <= 6) add(a, a + k);
    eat(m);
  });
  all(ROOM_PLUS, t).forEach(m => {
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a >= 1 && a + b <= 6) add(a, a + b);
    eat(m);
  });
  all(ROOM_ADJ, t).forEach(m => {
    var a = roomN(m[1]), b = roomN(m[2]);
    if (a && b && b > a) add(a, b);
    eat(m);
  });
  all(ROOM_COUNT, t).forEach(m => { // 房間至少四間／房間要三間以上／房間三間
    var n = roomN(m[2]);
    if (n) {
      if (['至少', '最少', '起碼', '最低'].indexOf(m[1]) >= 0 || m[3]) upOnly = upOnly === null ? n : Math.min(upOnly, n);
      else add(n, n);
    }
    eat(m);
  });
  all(ROOM_UP, t).forEach(m => {
    var n = roomN(m[1] || m[2] || m[3] || m[4] || '');
    if (n) upOnly = upOnly === null ? n : Math.min(upOnly, n);
    eat(m);
  });
  all(ROOM_DOWN, t).forEach(m => {
    var n = roomN(m[1]);
    if (n) downOnly = downOnly === null ? n : Math.max(downOnly, n);
    eat(m);
  });
  all(ROOM_JIAN, t).forEach(m => { var n = roomN(m[1]); if (n) add(n, n); eat(m); }); // 三間房、兩個房間
  all(ROOM_ONE, t).forEach(m => { var n = roomN(m[1]); if (n) add(n, n); eat(m); });
  if (seen) { raw.rooms_min = lo; raw.rooms_max = hi; }
  else if (upOnly !== null) raw.rooms_min = upOnly;
  else if (downOnly !== null) raw.rooms_max = downOnly;
  return t;
}

function pval(numS, unit) {
  var n = cnToNum(numS);
  return n === null ? null : n * (UNIT_MULT[unit] || 1);
}
function nbMoney(t, a, b) { return NB_AFTER.test(t.slice(b, b + 6)) || NB_BEFORE.test(t.slice(Math.max(0, a - 8), a)); }

// 口語價格（一千八／3千5）前後的「原句」字元必須乾淨：前面的規則已把一部分換成空白，不能撿殘片（1千5百五十萬 ≠ 1千5）
function colloqClean(t0, a, b) {
  return !((b < t0.length && COLLOQ_BAD_NEXT.test(t0.charAt(b))) || (a > 0 && COLLOQ_BAD_PREV.test(t0.charAt(a - 1))));
}

function extPrice(t, raw, inferred) {
  var mins = [], maxs = [], soft = [], t0 = t; // t0＝進來時的原句（mask 只換成空白、長度不變，索引對得上）
  function put(v, d, b) {
    if (v === null || !(v >= 100 && v <= 100000)) return;
    v = rint(v);
    if (SOFT_AFTER.test(t0.slice(b, b + 6))) { soft.push(v); inferred.push('price_approx'); return; } // 「兩千出頭」：只是大概，不是下限
    if (d === null) { d = 'max'; inferred.push('price_dir'); }
    else if (d === 'approx') { d = 'max'; inferred.push('price_approx'); }
    (d === 'min' ? mins : maxs).push(v);
  }
  // 每個比對：先擋「頭期款、月付」這類不是總價的金額，再收；不管收不收，該段都遮掉（fn 回 false＝連遮都不遮）。
  // 口語價格（colloq）前後的原句字元不乾淨就整個不收、也不遮（別撿殘片）
  function pass(rx, fn, colloq) {
    all(rx, t).forEach(m => {
      var a = m.index, b = a + m[0].length;
      if (colloq && !colloqClean(t0, a, b)) return;
      if (!nbMoney(t, a, b) && fn(m, a, b) === false) return;
      t = mask(t, a, b);
    });
  }
  function range(a, b) {
    if (a !== null && b !== null && Math.min(a, b) >= 100 && Math.max(a, b) <= 100000) { mins.push(rint(Math.min(a, b))); maxs.push(rint(Math.max(a, b))); }
  }
  pass(PRICE_OWN_RANGE, m => { range(pval(m[1], m[2]), pval(m[3], m[4])); });
  pass(PRICE_RANGE, m => { range(pval(m[1], m[3]), pval(m[2], m[3])); });
  all(PRICE_YI, t).forEach(m => {
    var a = m.index, b = a + m[0].length;
    if (nbMoney(t, a, b)) { t = mask(t, a, b); return; }
    var base = cnToNum(m[1]);
    if (base === null) return;
    var v = base * 10000;
    if (m[2]) v += pval(m[2], m[3]) || 0;
    put(v, priceDir(t, a, b), b);
    t = mask(t, a, b);
  });
  pass(PRICE_UNIT, (m, a, b) => { put(pval(m[1], m[2]), priceDir(t, a, b), b); });
  pass(PRICE_THOUSAND, (m, a, b) => { put(1000, { '以內': 'max', '以下': 'max', '內': 'max', '以上': 'min' }[m[1]] || 'approx', b); });
  pass(PRICE_YUAN, (m, a, b) => { put(parseInt(m[1], 10) / 10000, priceDir(t, a, b), b); });
  pass(PRICE_KRANGE, m => { range(parseInt(m[1], 10), parseInt(m[2], 10)); });
  pass(PRICE_KW, (m, a, b) => {
    var n, d;
    if (m[1]) { n = parseInt(m[2], 10); d = ['至少', '最少', '下限', '起碼'].indexOf(m[1]) >= 0 ? 'min' : 'max'; }
    else { n = parseInt(m[3], 10); d = DIR_MAX.indexOf(m[4]) >= 0 ? 'max' : DIR_MIN.indexOf(m[4]) >= 0 ? 'min' : 'approx'; }
    put(n, d, b);
  });
  // 口語「一千八到一千五」「一千八以內」（沒說萬）
  pass(PRICE_COLLOQ_RANGE, m => { range(cnToNum(m[1]), cnToNum(m[2])); }, 1);
  pass(PRICE_COLLOQ, (m, a, b) => {
    var d = priceDir(t, a, b);
    if (d === null && (mins.length || maxs.length)) return false; // 沒方向詞、而且前面已經有價格了：不再收（避免把別的數字當第二個價格）
    put(cnToNum(m[1]), d, b);
  }, 1);
  if (mins.length) raw.price_min_wan = mins[0];
  if (maxs.length) raw.price_max_wan = maxs[0];
  else if (soft.length && !mins.length) raw.price_max_wan = soft[0]; // 只有「兩千出頭」這種大概說法：當上限（保守，不當下限）
  return t;
}

function extParking(t, raw, inferred) {
  var cands = [], negMech = false;
  all(PK_RAMP, t).forEach(m => { cands.push([m.index, 'ramp_flat']); t = mask(t, m.index, m.index + m[0].length); });
  all(PK_FLAT, t).forEach(m => { cands.push([m.index, 'flat']); t = mask(t, m.index, m.index + m[0].length); });
  all(PK_MECH, t).forEach(m => {
    if (PK_MECH_NEG.test(t.slice(Math.max(0, m.index - 6), m.index))) negMech = true;
    else cands.push([m.index, 'mechanical']);
    t = mask(t, m.index, m.index + m[0].length);
  });
  if (cands.length) { cands.sort((x, y) => x[0] - y[0]); raw.parking = cands[0][1]; return t; }
  var m = PK_NONE.exec(t);
  if (m) { raw.parking = 'none'; return mask(t, m.index, m.index + m[0].length); } // R4：「有車位／不用車位」也蓋掉，更正時才知道這段字是車位的值
  m = PK_ANY.exec(t);
  if (m) { raw.parking = 'any'; t = mask(t, m.index, m.index + m[0].length); }
  else if (negMech) { raw.parking = 'any'; inferred.push('parking_not_mech'); }
  return t;
}

function extTypes(t, raw, inferred) {
  var hits = [], types = [], spans = [];
  TYPE_RULES.forEach(r => {
    all(r[1], t).forEach(m => {
      if (r[0] === 'elevator_building' && m[0] === '大樓' && t.slice(Math.max(0, m.index - 2), m.index) === '電梯') return;
      if (!hits.some(h => h[1] === r[0])) hits.push([m.index, r[0]]);
      spans.push([m.index, m[0].length]);
    });
  });
  hits.sort((x, y) => x[0] - y[0]);
  hits.forEach(h => { if (types.indexOf(h[1]) < 0) types.push(h[1]); });
  var em = types.length ? null : ELEVATOR.exec(t);
  if (em) { types = ['elevator_building', 'mid_rise']; inferred.push('elevator'); spans.push([em.index, em[0].length]); }
  if (types.length) raw.types = types.slice(0, 2);
  spans.forEach(sp => { t = mask(t, sp[0], sp[0] + sp[1]); }); // R4：型態字眼也蓋掉（更正時才知道哪段是型態的值）
  return t;
}

function extDistricts(t, raw, inferred) {
  var found = [];
  all(DIST_RE, t).forEach(m => {
    var w = m[1], end = m.index + m[0].length;
    if (D.indexOf(w) >= 0 && w.length === 2 && t.charAt(m.index - 1) === '台') return;
    if (ALIAS[w] && DIST_BLOCK.test(t.slice(end, end + 2))) return;
    var d = ALIAS[w] || w;
    if (found.indexOf(d) < 0) found.push(d);
    t = mask(t, m.index, end);
  });
  if (found.length > 2) { found = found.slice(0, 2); inferred.push('districts_trunc'); }
  if (found.length) raw.districts = found;
  return t;
}

// 回 [路名主體, 最後一次剝的是不是「新／和」]（新生北路→生北路：剝完是殘片；新大樓文心路→後面還剝了「大樓」，不算）
function cleanRoadBase(run) {
  var base = run, changed = true, amb = false;
  while (changed) {
    changed = false;
    for (var i = 0; i < PREFIXES.length; i++) {
      var d = PREFIXES[i];
      if (base.indexOf(d) === 0 && base.length - d.length >= 2) { base = base.slice(d.length); changed = true; break; }
    }
    var m = FILLER.exec(base);
    if (m && m[0].length > 0 && base.length - m[0].length >= 2) { amb = m[0] === '新' || m[0] === '和'; base = base.slice(m[0].length); changed = true; }
  }
  return [base, amb];
}

function extRoad(t, raw) {
  if ((raw.districts || []).length > 1) return t;
  var ms = all(ROAD, t);
  for (var i = 0; i < ms.length; i++) {
    var m = ms[i], cb = cleanRoadBase(m[1]), base = cb[0], kind = m[2];
    var nxt = m[3] ? '' : t.charAt(m.index + m[1].length + kind.length);
    if (base.length < 2 || base.length > 6 || ROAD_BAD_BASE.indexOf(base) >= 0 || (nxt && ROAD_BAD_NEXT.indexOf(nxt) >= 0)) continue;
    // 同 Python：第一個能用的候選就是它，不像路名就整個不收。Python 靠路名字典；字典 40KB 放不進首載預算，這裡只做保守檢查：
    // 不會丟真路名，但會「多收」字典外的路名（改名的舊路名中港路、柏油路、夜市街…）——那些由 find-app.js 的 verifyRoad 與伺服器端 knownRoad 事後丟掉。
    // ① 含口語字（想住北屯路、高鐵站走路、面馬路）② 剝掉「新／和」③ 全是數字（太平十三街的「太平」被當區名剝掉）
    // ④ 近／臨開頭的泛稱（近馬路、臨大馬路、臨近大路；真路名近山路、臨港路不是這個形狀）
    if (ROAD_JUNK.test(base) || cb[1] || /^(?:[一二三四五六七八九十]+|[近臨]+大?[馬公]?)$/.test(base)) return t;
    var road = base + kind;
    if (m[3]) {
      var n = cnToNum(m[3]);
      if (isInt(n) && n >= 1 && n <= 20) road += cnSection(n) + '段';
    }
    raw.road = road;
    return t;
  }
  return t;
}

/* ---------- 自我更正／別人的意見（W3；邏輯與伺服器端規則一對一） ---------- */
var SEG_STEPS = [extFloors, extArea, extAge, extRooms, extPrice, extParking, extTypes, extDistricts]; // R4：更正看全部欄位群

// 一段文字裡各欄位群各自吃掉哪些字元位置：{ 群序號: [索引…] }（只含真的抽到值的群）
function segKinds(seg) {
  var raw = {}, inf = [], t = seg, out = {};
  SEG_STEPS.forEach((fn, k) => {
    var n0 = keys(raw), t2 = fn(t, raw, inf), set = [];
    if (keys(raw) > n0) { for (var i = 0; i < t.length; i++) if (t.charAt(i) !== t2.charAt(i)) set.push(i); out[k] = set; }
    t = t2;
  });
  return out;
}

function maskIdx(t, idxs) {
  if (!idxs.length) return t;
  var arr = t.split('');
  idxs.forEach(i => { if (i >= 0 && i < arr.length) arr[i] = ' '; });
  return arr.join('');
}

// 位置 i 所在的那一句（以。！？換行；為界）→ [起, 迄]
function sentBounds(t, i) {
  var a = -1, b = t.length, k, p;
  for (k = 0; k < SENT_END.length; k++) {
    p = i > 0 ? t.lastIndexOf(SENT_END.charAt(k), i - 1) : -1;
    if (p > a) a = p;
  }
  for (k = 0; k < SENT_END.length; k++) {
    p = t.indexOf(SENT_END.charAt(k), i);
    if (p >= 0 && p < b) b = p;
  }
  return [a + 1, b];
}

// 位置 i 之後最近的小句結尾（沒有＝字串結尾）
function clauseEnd(t, i) {
  var e = t.length, k, p;
  for (k = 0; k < CLAUSE_END.length; k++) { p = t.indexOf(CLAUSE_END.charAt(k), i); if (p >= 0 && p < e) e = p; }
  return e;
}

// 「他想住大里，我要的是南屯」：某某人想／要…那一小句裡各欄位群的值不收（後面要真有「我要的是／但我要…」才動作）
function dropOthersView(t) {
  if (!SELF_ONLY.test(t)) return t; // 整份都沒有「我要的是／但我要…」：不可能有動作，免做
  var src = t, rx = new RegExp(OTHERS.source, 'g'), m, hits = 0;
  while (hits < OTHERS_MAX_HITS && (m = rx.exec(src)) !== null) {
    hits++;
    var ce = clauseEnd(t, m.index + m[0].length); // 小句邊界與後面有沒有「我要的是」看「目前」的 t（前面的小句可能已蓋掉）
    if (ce - m.index > OTHERS_MAX_SEG) continue;
    if (!SELF_ONLY.test(t.slice(ce))) continue;
    var kinds = segKinds(t.slice(m.index, ce)), idx = [], name;
    for (name in kinds) kinds[name].forEach(i => { idx.push(m.index + i); });
    t = maskIdx(t, idx);
  }
  return t;
}

function applyCorrections(t, inferred) {
  t = dropOthersView(t);
  var marks = [], m, rx = new RegExp(CORR_RE.source, 'g'), unsure = false;
  while ((m = rx.exec(t)) !== null) {
    if (m[0].length === 0) { rx.lastIndex++; continue; }
    if (marks.length && m.index < marks[marks.length - 1][1]) continue;
    marks.push([m.index, m.index + m[0].length, m[1] ? 1 : m[2] ? 2 : 0]); // 0＝一般標記詞、1＝不是 X 是 Y、2＝原本／之前
    if (marks.length >= CORR_MAX_MARKS) break; // 只處理前 6 個標記詞，後面的不會被用到
  }
  marks.forEach(mk => {
    var s = mk[0], e = mk[1], g = mk[2];
    if (CORR_NEG.test(t.slice(Math.max(0, s - 4), s))) return;
    var bd = sentBounds(t, s), b = bd[1], a = bd[0];
    var sent = t.slice(a, b);
    if (CORR_INSTR_ZH.test(sent) || CORR_INSTR_EN.test(sent) || CORR_GENERIC_TARGET.test(t.slice(Math.max(0, s - 6), s))) return; // 像在對 AI 下指令：不當客人更正
    var o0 = 0, o1 = s, after; // 舊值在 t[o0, o1)、新值在 after
    if (g === 1) { // 舊值在標記詞後面，前面同群的值一併當舊的
      o1 = e + (new RegExp('^' + CORR_NEGVAL).exec(t.slice(e)) || [''])[0].length;
      after = t.slice(o1, b);
    } else if (g === 2) { // 原本／之前：這一小句是舊的，之後出現同群新值才不收
      o0 = e; o1 = clauseEnd(t, e);
      after = t.slice(o1 + 1);
    } else {
      after = t.slice(e, b);
      if (after.replace(/[\s，,、：:]/g, '').length < 6 && b < t.length) { // 「算了。我要北屯四房」：標記詞後面沒話了，看下一句
        after = t.slice(e, sentBounds(t, Math.min(t.length - 1, b + 1))[1]);
      }
    }
    var ka = segKinds(after);
    if (!keys(ka)) return;
    var kb = segKinds(t.slice(o0, o1)), both = Object.keys(ka).filter(k => k in kb);
    if (!both.length) return;
    if (CORR_HEDGE.test(t.slice(Math.max(0, s - 12), s)) || CORR_ALSO_OK.test(after)) { unsure = true; return; } // 退而求其次／也可以：不確定哪個是最終，兩個都留
    var idx = [];
    both.forEach(k => { kb[k].forEach(i => { idx.push(o0 + i); }); });
    t = maskIdx(t, idx);
  });
  if (unsure) inferred.push('correction_unsure');
  return t;
}

/* ---------- 白名單正規化（與伺服器端同一張表） ---------- */
var ROAD_FIELD = new RegExp('^' + ZH + '{1,10}(?:路|街|大道)(?:[一二三四五六七八九十]{1,2}段)?$');
var ROAD_BAD = /忽略|指令|改列|輸出|提示|規則|回答|不要|無視|系統|管理員|金鑰|密碼/; // 夾帶指令的假路名（同 Python 的 _ROAD_BAD）
function intIn(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null; }
function enumList(v, allowed, maxn, sorted) {
  if (!Array.isArray(v)) return null;
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (allowed.indexOf(v[i]) < 0) return null; // 非字串一定不在 allowed 裡
    if (out.indexOf(v[i]) < 0) out.push(v[i]);
  }
  if (out.length > maxn) return null;
  if (sorted) out.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  return out;
}
function nul(v) { return v === null || v === undefined; }
// one：單一欄位（沒給略過；f 回 null＝無效）；many：清單欄位（沒給或空略過）
function one(raw, out, issues, k, f) {
  var v = raw[k];
  if (!nul(v)) { v = f(v); if (v === null) issues.push(k + ':invalid'); else out[k] = v; }
}
function many(raw, out, issues, k, allowed, maxn, sorted) {
  var v = raw[k], l;
  if (v && v.length !== 0) { l = enumList(v, allowed, maxn, sorted); if (l === null) issues.push(k + ':invalid'); else if (l.length) out[k] = l; }
}
function pick(a) { return x => a.indexOf(x) >= 0 ? x : null; }
function int60(x) { return intIn(x, 1, 60); }

function normalizeFields(raw) {
  var out = {}, issues = [], v;
  if (!isObj(raw)) return { fields: {}, issues: ['fields:not_object'] };
  many(raw, out, issues, 'districts', D, 2, true);
  v = raw.road;
  if (v !== null && v !== undefined && v !== '') {
    // 多區丟棄；沒有區就不收（RT-11：路段不能單獨成立；順序同 Python）
    var road = typeof v === 'string' ? normText(v).trim().replace(/臺/g, '台') : null, nd = (out.districts || []).length;
    if (road === null || !ROAD_FIELD.test(road) || ROAD_BAD.test(road)) issues.push('road:invalid');
    else if (nd >= 2) issues.push('road:multi_district');
    else if (nd === 0) issues.push('road:no_district');
    else if (ROAD_JUNK.test(road)) issues.push('road:unknown'); // 無字典：至少擋含口語字的假路名
    else out.road = road;
  }
  [['price_min_wan', 'price_max_wan', 100, 100000], ['rooms_min', 'rooms_max', 1, 6], ['area_min_ping', 'area_max_ping', 5, 300]].forEach(g => {
    var a = raw[g[0]], b = raw[g[1]], av = null, bv = null;
    if (!nul(a)) { av = intIn(a, g[2], g[3]); if (av === null) issues.push(g[0] + ':invalid'); }
    if (!nul(b)) { bv = intIn(b, g[2], g[3]); if (bv === null) issues.push(g[1] + ':invalid'); }
    if (av !== null && bv !== null && av > bv) { issues.push(g[0] + ':min_gt_max'); av = bv = null; }
    if (av !== null) out[g[0]] = av;
    if (bv !== null) out[g[1]] = bv;
  });
  many(raw, out, issues, 'types', TYPES, 2, true);
  one(raw, out, issues, 'age_max', int60);
  one(raw, out, issues, 'parking', pick(PARKING));
  v = raw.floor_exclude;
  if (v && v.length !== 0) {
    var fl = [];
    if (!Array.isArray(v) || v.length > 12 || v.some(x => { var n = int60(x); if (n !== null && fl.indexOf(n) < 0) fl.push(n); return n === null; })) issues.push('floor_exclude:invalid');
    else if (fl.length) out.floor_exclude = fl.sort((x, y) => x - y);
  }
  if (!nul(raw.exclude_top)) { if (typeof raw.exclude_top === 'boolean') { if (raw.exclude_top) out.exclude_top = true; } else issues.push('exclude_top:invalid'); }
  one(raw, out, issues, 'floor_min', int60);
  return { fields: out, issues: issues };
}

function normalizeContext(raw) {
  var out = {}, issues = [];
  if (!isObj(raw)) return { context: {}, issues: nul(raw) ? [] : ['context:not_object'] };
  one(raw, out, issues, 'stage', pick(STAGES));
  one(raw, out, issues, 'timeline', pick(TIMELINES));
  many(raw, out, issues, 'special', SPECIALS, 8);
  many(raw, out, issues, 'concerns', CONCERNS, 12);
  return { context: out, issues: issues };
}

/* ---------- 缺漏判斷、追問挑題 ---------- */
function hasPrice(f) { return !nul(f.price_min_wan) || !nul(f.price_max_wan); }
function hasRooms(f) { return !nul(f.rooms_min) || !nul(f.rooms_max); }
function onlyStudio(f) { var ts = f.types || []; return ts.length > 0 && ts.every(t => t === 'studio'); }
function keys(o) { return Object.keys(o).length; }

function assess(fields, skip) {
  var f = fields || {}, hasD = !!(f.districts && f.districts.length), hp = hasPrice(f), hr = hasRooms(f), missing = [], level;
  if (!hasD) missing.push('district');
  if (!hp) missing.push('price');
  if (!hr) missing.push('rooms');
  if (!keys(f)) level = 'empty';
  else if (hasD && hp && hr) level = 'ok';
  else if (hasD && (hp || hr)) level = 'thin';
  else level = 'vague';
  return { level: level, sendable: level === 'ok' || level === 'thin' || (level === 'vague' && !!skip), missing: missing };
}

function nextQuestions(fields, context, answered, skipped, maxN, skip) {
  if (skip) return [];
  var f = fields || {}, c = context || {}, done = {}, out = [];
  (answered || []).forEach(q => { done[q] = 1; });
  (skipped || []).forEach(q => { done[q] = 1; });
  if (!(f.districts && f.districts.length)) out.push('q_district');
  if (!hasPrice(f)) out.push('q_budget');
  if (!hasRooms(f) && !onlyStudio(f)) out.push('q_rooms');
  if (nul(f.parking) && !onlyStudio(f)) out.push('q_parking');
  if (nul(f.age_max)) out.push('q_age');
  if (!(c.concerns && c.concerns.length)) out.push('q_concerns');
  if (!c.stage) out.push('q_stage');
  if (!c.timeline) out.push('q_timeline');
  out = out.filter(q => !done[q]);
  var n = maxN === undefined ? 4 : Math.max(0, Math.min(parseInt(maxN, 10) || 0, 4));
  return out.slice(0, n);
}

/* ---------- 一句話 → 條件 ---------- */
function extract(text) {
  if (typeof text === 'string' && text.length > EXTRACT_CLIP) text = text.slice(0, EXTRACT_CLIP); // 超長輸入只看前面一段（擋灌字）
  var sc = scrub(text), t = asciiDigits(sc.clean).replace(/臺/g, '台').replace(/仟/g, '千').replace(/佰/g, '百'), dropped = [], inferred = [], raw = {};
  t = t.replace(NUMRUN, run => run.slice(0, 12));
  var oos = OTHER_CITIES.some(c => t.indexOf(c) >= 0) && t.indexOf('台中') < 0;
  t = dropUnbuilt(t, dropped);
  if (PRESALE.test(t)) { dropped.push('presale'); t = t.replace(new RegExp(PRESALE.source, 'g'), ' '); }
  var hint = t;
  t = applyCorrections(t, inferred);
  t = extFloors(t, raw); t = extArea(t, raw, inferred); t = extAge(t, raw, inferred); t = extRooms(t, raw);
  t = extPrice(t, raw, inferred); t = extParking(t, raw, inferred); t = extTypes(t, raw, inferred);
  t = extDistricts(t, raw, inferred); t = extRoad(t, raw);
  var fields = normalizeFields(raw).fields, ctx = {};
  for (var i = 0; i < STAGE_RULES.length; i++) if (STAGE_RULES[i][1].test(hint)) { ctx.stage = STAGE_RULES[i][0]; break; }
  var sp = SPECIAL_RULES.filter(r => r[1].test(hint)).map(r => r[0]);
  if (sp.length) ctx.special = sp;
  var ch = CONCERN_RULES.filter(r => r[1].test(hint)).map(r => r[0]);
  if (ch.length) ctx.concerns_hint = ch;
  var a = assess(fields);
  return { fields: fields, context: ctx, dropped: dropped, pii: sc.pii, out_of_scope: oos, inferred: inferred, level: oos ? 'empty' : a.level, missing: a.missing };
}

/* ---------- 推薦頁片段（#k=）：條件與在意的事只在客人的瀏覽器裡，不進網址以外的任何地方 ---------- */
var FRAG_MAX = 600;
// 片段裡的短鍵 ↔ 欄位名（順序＝輸出順序；與伺服器端 token 逐字相同）
var FRAG_F = { d: 'districts', pmax: 'price_max_wan', pmin: 'price_min_wan', r: 'rooms', t: 'types', a: 'age_max', pk: 'parking', fx: 'floor_exclude', top: 'exclude_top' };
var FRAG_C = { c: 'concerns', s: 'special', st: 'stage', tl: 'timeline' };
function b64u(bytes) {
  return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fragEncode(fields, context) {
  var f = normalizeFields(fields || {}).fields, c = normalizeContext(context || {}).context, ff = {}, obj = { v: 1, f: ff }, k;
  if ('rooms_min' in f || 'rooms_max' in f) f.rooms = [f.rooms_min, f.rooms_max]; // 沒有的那端 JSON 會寫成 null
  if (f.exclude_top) f.exclude_top = 1;
  for (k in FRAG_F) if (FRAG_F[k] in f) ff[k] = f[FRAG_F[k]];
  for (k in FRAG_C) if (FRAG_C[k] in c) obj[k] = c[FRAG_C[k]];
  var bytes = new TextEncoder().encode(JSON.stringify(obj));
  return bytes.length > FRAG_MAX ? '' : b64u(bytes);
}
function fragDecode(token) {
  if (typeof token !== 'string' || !token || token.length > 900 || !/^[A-Za-z0-9_\-]+$/.test(token)) return null;
  var obj, k;
  try {
    var bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (bytes.length > FRAG_MAX) return null;
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) { return null; }
  if (!isObj(obj) || obj.v !== 1) return null;
  var ff = isObj(obj.f) ? obj.f : {}, r = ff.r, rf = {}, cx = {};
  for (k in FRAG_F) if (!nul(ff[k])) rf[FRAG_F[k]] = ff[k];
  rf.exclude_top = ff.top === 1;
  if (Array.isArray(r) && r.length === 2) {
    if (!nul(r[0])) rf.rooms_min = r[0];
    if (!nul(r[1])) rf.rooms_max = r[1];
  }
  for (k in FRAG_C) cx[FRAG_C[k]] = obj[k];
  var ctx = normalizeContext(cx).context;
  return { f: normalizeFields(rf).fields, c: ctx.concerns || [], s: ctx.special || [], st: ctx.stage || null, tl: ctx.timeline || null };
}

/* ---------- 提交前聯絡方式檢查（瀏覽器端先擋明顯錯誤；伺服器端另有同一張表）。整份提交本文的檢查 validateSubmit 只有測試在用，放在 tests/find/_ne_submit.mjs ---------- */
var CONTACT_OK = { line: /^[A-Za-z0-9._@\-]{1,40}$/, phone: /^[0-9+()\- ]{8,16}$/, email: /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/ };
function validateContact(c) {
  if (nul(c)) return { contact: null, err: null };
  if (!isObj(c)) return { contact: null, err: 'E_BAD_REQUEST' };
  var out = {}, k, v, av;
  for (k of ['name', 'line', 'phone', 'email', 'note']) {
    v = c[k];
    v = typeof v === 'string' && v.trim() ? normText(v).trim() : null;
    if (v === null) continue;
    if (k === 'name' || k === 'note') { if (cpLen(v) > (k === 'name' ? 20 : 100)) return { contact: null, err: 'E_TOO_LARGE' }; out[k] = v; }
    else if (CONTACT_OK[k].test(v) && (k !== 'email' || cpLen(v) <= 80)) out[k] = v;
  }
  av = ['line', 'phone', 'email'].filter(x => out[x]);
  if (!av.length) return { contact: null, err: null };
  out.pref = av.indexOf(c.pref) >= 0 ? c.pref : av[0];
  return { contact: out, err: null };
}

var api = {
  extract: extract, assess: assess, nextQuestions: nextQuestions, scrub: scrub, cnToNum: cnToNum,
  normalizeFields: normalizeFields, normalizeContext: normalizeContext, fragEncode: fragEncode, fragDecode: fragDecode,
  validateContact: validateContact, normText: normText,
  ENUM: { DISTRICTS: D, TYPES: TYPES, PARKING: PARKING, STAGES: STAGES, TIMELINES: TIMELINES, SPECIALS: SPECIALS, CONCERNS: CONCERNS }, CONSENT_V: CONSENT_V
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.NeedExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
