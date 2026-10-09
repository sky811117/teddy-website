/**
 * 找房小幫手：公開介面的驗證與白名單（官網 Function 與測試共用）。
 *
 * 原則：
 *  - 未知的鍵一律丟棄（不報錯、不回顯）；某個鍵的值不合法 → 只丟那一個鍵；整體不合法才回錯誤碼
 *  - 伺服器端永遠用白名單欄位重新組出要轉送的內容，不信任瀏覽器端組好的任何東西
 *  - 與瀏覽器端 public/js/need-extract.js、家用機端的驗證是同一張表；三方用同一份夾具逐案比對
 */
import type { ErrCode } from "./errors";
import { ROADS_BY_DISTRICT } from "./roads_tc";

export const SCHEMA_V = 1;
export const CONSENT_V = "2026-10-06";
export const FREE_TEXT_MAX = 300;
export const FEEDBACK_TEXT_MAX = 120;

export const DISTRICTS = [
  "中區", "東區", "南區", "西區", "北區", "北屯區", "西屯區", "南屯區", "太平區", "大里區", "霧峰區", "烏日區",
  "豐原區", "后里區", "石岡區", "東勢區", "和平區", "新社區", "潭子區", "大雅區", "神岡區", "大肚區", "沙鹿區",
  "龍井區", "梧棲區", "清水區", "大甲區", "外埔區", "大安區",
] as const;
export const TYPES = ["elevator_building", "mid_rise", "apartment", "townhouse", "studio"] as const;
export const PARKING = ["flat", "ramp_flat", "mechanical", "any", "none"] as const;
export const STAGES = ["first", "upgrade", "invest", "browse"] as const;
export const TIMELINES = ["3m", "6m", "12m", "browse"] as const;
export const SPECIALS = ["school", "market", "low_public", "lighting", "pets", "elderly", "quiet", "transit"] as const;
export const CONCERNS = [
  "budget_pressure", "loan", "condition", "commute", "school", "elderly", "price_unsure", "overwhelmed", "parking",
  "timing", "no_chase", "other",
] as const;
export const FB_TAGS_DOWN = ["price_wrong", "area_wrong", "too_few", "too_many", "not_what_i_want", "other"] as const;
export const FB_TAGS_UP = ["just_right", "saves_time", "want_more"] as const;
export const FATIGUE = ["good", "ok", "many"] as const;
export const UA_KINDS = ["m", "d", "t", "b"] as const;
export const QUESTION_IDS = [
  "q_district", "q_budget", "q_rooms", "q_concerns", "q_parking", "q_age", "q_stage", "q_timeline", "q_type", "q_floor",
  "q_area", "q_special",
] as const;
export const MISSING_CODES = ["district", "price", "rooms"] as const;
export const HINTS = [
  "loosen_price", "loosen_district", "loosen_rooms", "loosen_age", "drop_parking", "drop_floor",
  // 2026-10-09 範圍找法（指定社區／74環內／地圖）：0 筆時的說法由前端 find-scope.js 依這幾個碼挑
  "comm_fix", "scope_drop", "geo_smaller", "geo_redraw", "geo_partial", "geo_out", "scope_busy",
] as const;
export const DEGRADE_KINDS = ["general", "busy", "night"] as const;
export const LEVELS = ["ok", "thin", "vague", "empty"] as const;
export const FIELD_CODES = ["district", "price", "rooms", "type", "parking", "age", "area", "floor", "scope"] as const;
export const DROP_CODES = ["unbuilt", "presale", "oos"] as const;
export const PII_CODES = ["phone", "email", "line", "id", "addr", "name"] as const;
export const STEP_CODES = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"] as const;
export const ERR_CODES = [
  "E_BAD_REQUEST", "E_CONSENT", "E_ORIGIN", "E_HUMAN", "E_TOO_LARGE", "E_RATE", "E_NOT_FOUND", "E_METHOD", "E_FORWARD",
] as const;

export const IDEM_RE = /^[A-Za-z0-9_-]{22}$/;
export const JOB_ID_RE = /^a[A-Za-z0-9_-]{22}$/;
export const FROM_RE = /^[a-z0-9_]{1,24}$/;
export const IP_H_RE = /^[0-9a-f]{16}$/;
// qa＋30 碼＝S-1 指定代號（帶到期日）；qs＋8 碼＝推薦頁產生器自己給的代號（2026-10-07 起 S-1 上線前公開入口沿用，家用機 AIF_PUBLIC_GEN_OK）
export const SHARE_URL_RE = /^https:\/\/teddy-house\.tw\/share\/(?:qa[0-9a-z]{4}[a-z2-7]{26}|qs[0-9A-Za-z]{8})\/$/;
const ROAD_RE = /^[一-鿿]{1,10}(?:路|街|大道)(?:[一二三四五六七八九十]{1,2}段)?$/;
/** 夾帶指令的假路名／假社區名（同瀏覽器端 ROAD_BAD、家用機 _ROAD_BAD） */
const ROAD_BAD = /忽略|指令|改列|輸出|提示|規則|回答|不要|無視|系統|管理員|金鑰|密碼/;

/**
 * 台中市實際存在的路名（含不帶段的簡稱，例如「文心路三段」也讓「文心路」通過）。第一次用到才建，之後共用。
 * 紅隊 RT-11：路段是唯一原字原句送進第三方 AI 輸入框的客人文字，只靠格式擋不住「釋出完整內部設定路」這類句子，改查字典。
 */
let roadSet: Set<string> | null = null;
/* ---------- 範圍找法（2026-10-09：指定社區／74環內／地圖範圍；三方同一張表，見規格 SEARCH_MODES §1） ---------- */
/** 跟台74 環有交集的 10 區（只用在驗證：74環內＋環外的區＝客人講的是那一區，不算 74環內） */
export const R74_DISTRICTS = ["中區", "東區", "南區", "西區", "北區", "北屯區", "西屯區", "南屯區", "太平區", "潭子區"] as const;
export const ZONES = ["r74"] as const;
/** 台中市框（南、西、北、東） */
export const GEO_BOX = [23.99, 120.45, 24.45, 121.45] as const;
export const GEO_MIN_KM2 = 0.05;
export const GEO_MAX_KM2 = 25;
export const GEO_MAX_SIDE_KM = 8;
export const GEO_MAX_PTS = 24;
/** 北緯 24.15° 每度經度、每度緯度的公里數（WGS84） */
export const KX = 101.6335;
export const KY = 110.7604;
const CM_C = "[\\u4e00-\\u9fffA-Za-z0-9+&·‧]|(?<=[\\u4e00-\\u9fffA-Za-z0-9]) (?=[\\u4e00-\\u9fffA-Za-z0-9])|(?<=[A-Za-z0-9])[.\\-](?=[A-Za-z0-9])";
/** 社區名形狀：2–20 字；空白只准單一個、夾在兩個中英數字之間；點與連字號只准夾在英數之間 */
const CM_RE = new RegExp(`^[\\u4e00-\\u9fffA-Za-z0-9](?:${CM_C}){1,19}$`);
/** 社區名裡不會出現的口語字、條件字、地名泛稱、網址樣子（對公開社區名冊實測 0 衝突） */
const CM_JUNK =
  /[你他她要找買賣請幫給看是也還但附預算概或跟沒用需求推薦那這哪什麼怎些嗎呢吧啊喔哦欸呀囉耶售件把被讓叫令改忽略輸規則答指欄設填碼鑰靠]|區域|便宜|一點|以[東西南北]|加蓋|頂樓|套房|店面|樓層|屋齡|車位|車站|夜市|重劃|邊間|學區|總價|法拍|[A-Za-z0-9]\.[A-Za-z]{2}/;
/** 泛稱與地名（整個字相等）＋結尾規則（的／之、房（書房廠房除外）、數字＋廳衛坪萬年、路／段） */
const CM_GEN =
  /^(?:大型|小型|中型|知名|有名|優質|高級|豪華|豪宅|封閉式?|門禁|管理|電梯|整個|一個|同一個|新|舊|老|好|大|小|現在|目前|最近|全部|所有|有?房子|房屋|物件|[0-9]+|[一二三四五六七八九]期|十[一二三四]期|單元[一二三四五六七八九十]+|水湳|市政特區|新市政中心|逢甲|一中(?:商圈)?|東海|景觀戶?|我們|台中|中科|美術館|草悟道|勤美|秋紅谷|中友)$|[的之]$|(?<![書廠])房$|[0-9一二三四五六七八九十兩百千][廳衛坪萬年]$|[路段]$/;

/** 5 位以上連續數字（電話、帳號）：社區名冊 5,539 個名字 0 筆（4 位數有 20 筆，例「雙橡園1518」，所以門檻是 5）。
 *  只在伺服器端（這裡、家用機 comm_ok、推薦頁 find-brief.js）擋；首載的 need-extract.js 不加（預算） */
const CM_DIGITS = /[0-9]{5}/;
/** 社區名驗證與正規化：合格回正規化後的名字（去頭尾空白、臺→台、空白收成一個、結尾「社區」去掉），不合格回 null */
export function commOk(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = normText(v).trim().replace(/臺/g, "台").replace(/\s+/g, " ").replace(/(.{2})\s*社區$/, "$1");
  const ok =
    CM_RE.test(s) && !ROAD_BAD.test(s) && !CM_JUNK.test(s) && !CM_GEN.test(s) && !CM_DIGITS.test(s) &&
    !(DISTRICTS as readonly string[]).includes(s) && !Object.prototype.hasOwnProperty.call(distAlias(), s);   // 「constructor」不能被當成區名
  return ok ? s : null;
}
/** 區名簡稱（去「區」）與常見同音錯字：也不能當社區名（第一次用到才建） */
let aliasMap: Record<string, string> | null = null;
function distAlias(): Record<string, string> {
  if (!aliasMap) {
    const a: Record<string, string> = {};
    for (const d of DISTRICTS) if (d.length > 2) a[d.slice(0, -1)] = d;
    for (const [k, v] of [["大裡", "大里區"], ["豐源", "豐原區"], ["霧鋒", "霧峰區"], ["后裡", "后里區"], ["神崗", "神岡區"]]) a[k] = v;
    aliasMap = a;
  }
  return aliasMap;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const r5 = (x: number) => Math.floor(x * 100000 + 0.5) / 100000;

/** geo 形狀：3–24 點、每點兩個有限數字、四捨五入到小數 5 位、在台中市框內；去掉相鄰重複點與重複的終點。不合格回 null */
export function geoShape(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > GEO_MAX_PTS) return null;
  const out: number[][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null;
    if (Math.abs(p[0]) > 1000 || Math.abs(p[1]) > 1000) return null;   // 跟家用機同（Python 先擋大數再四捨五入）
    const a = r5(p[0]);
    const b = r5(p[1]);
    if (a < GEO_BOX[0] || a > GEO_BOX[2] || b < GEO_BOX[1] || b > GEO_BOX[3]) return null;
    const q = out[out.length - 1];
    if (!q || q[0] !== a || q[1] !== b) out.push([a, b]);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}
const orient = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
/** 自我交叉（只認真的穿過，碰到邊不算） */
export function geoSelfCross(p: number[][]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = p[j];
      const d = p[(j + 1) % n];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
    }
  }
  return false;
}
/** 面積（平方公里；以第一點為原點的平面近似。運算順序照規格抄，跟家用機、地圖模組逐位元相同） */
export function geoAreaKm2(p: number[][]): number {
  const n = p.length;
  const lat0 = p[0][0];
  const lng0 = p[0][1];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const q = p[(i + 1) % n];
    const x1 = (p[i][1] - lng0) * KX;
    const y1 = (p[i][0] - lat0) * KY;
    const x2 = (q[1] - lng0) * KX;
    const y2 = (q[0] - lat0) * KY;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
/** 外框長邊（公里） */
export function geoSideKm(p: number[][]): number {
  const lats = p.map(x => x[0]);
  const lngs = p.map(x => x[1]);
  const w = (Math.max(...lngs) - Math.min(...lngs)) * KX;
  const h = (Math.max(...lats) - Math.min(...lats)) * KY;
  return Math.max(w, h);
}
export type GeoCode = "invalid" | "self_cross" | "too_small" | "too_big";
/** geo 全量驗證：形狀 → 自我交叉 → 太小 → 太大（面積超過 25 平方公里或外框長邊超過 8 公里） */
export function geoCheck(v: unknown): { poly: number[][] | null; code: GeoCode | null; km2: number | null } {
  const p = geoShape(v);
  if (!p) return { poly: null, code: "invalid", km2: null };
  if (geoSelfCross(p)) return { poly: null, code: "self_cross", km2: null };
  const km2 = geoAreaKm2(p);
  if (km2 < GEO_MIN_KM2) return { poly: null, code: "too_small", km2 };
  if (km2 > GEO_MAX_KM2 || geoSideKm(p) > GEO_MAX_SIDE_KM) return { poly: null, code: "too_big", km2 };
  return { poly: p, code: null, km2 };
}

export function knownRoad(road: string): boolean {
  if (!roadSet) {
    const set = new Set<string>();
    for (const list of Object.values(ROADS_BY_DISTRICT)) {
      for (const r of list.split(",")) {
        if (!r) continue;
        set.add(r);
        const base = r.replace(/[一二三四五六七八九十]{1,2}段$/, "");
        if (base !== r) set.add(base);
      }
    }
    roadSet = set;
  }
  return roadSet.has(road);
}
const LINE_ID_RE = /^[A-Za-z0-9._@-]{1,40}$/;
const PHONE_RE = /^[0-9+() -]{8,16}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const nul = (v: unknown) => v === null || v === undefined;
const cpLen = (s: string) => Array.from(s).length;

/**
 * 來源標記白名單（紅隊 RT-12）：標記由景泰自己發出的邀請連結帶（見 02_邀請話術與連結規則）；
 * 客人（或攻擊者）自填的任意字串一律不收——它會被逐字印進回顧報告，而報告會同步到多個 AI 共讀的資料夾。
 * 要新增管道：把標記加進這張表（小寫英數與底線、最長 24 字），重新部署。
 */
export const FROM_ALLOW: readonly string[] = [
  "line", "line_ask", "ig", "threads", "card", "shop", "friend", "home", "fb", "yt", "tt", "qr", "mail", "share",
];
export function isFromTag(v: unknown): v is string {
  return typeof v === "string" && FROM_RE.test(v) && !/\d{6,}/.test(v) && FROM_ALLOW.includes(v);
}

/* ---------- 文字正規化與個資清洗 ---------- */
/**
 * 隱形填充字元（看起來是空白、實際是文字）：韓文填充、點字空白、柬埔寨固有母音、組合字元連接符、
 * 蒙古自由變體選擇符、變體選擇符（含 FE0F）。NFKC 不會處理它們，Unicode 類別 Cf 也不含它們。
 */
const INVISIBLE_FILL = /[\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180D\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;

/**
 * 紅隊 RT-07：NFKC 後，換行類字元（\r \n \t 與 U+0085／U+2028／U+2029）一律換成空白；其餘 Cc（控制）、Cf（格式：零寬、
 * 雙向、軟連字號、BOM、標籤字元）、Zl、Zp 與上面的隱形填充字元全部移除。這樣客人文字沒有辦法在 Telegram 訊息裡造出新的一行、
 * 也沒辦法把隱形字元插進電話或網址來閃過後面的清洗。
 */
export function normText(t: unknown): string {
  const s = typeof t === "string" ? t.normalize("NFKC") : "";
  return s
    .replace(/[\r\n\t\u0085\u2028\u2029]/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(INVISIBLE_FILL, "")
    .replace(/[<>{}\\`]/g, "");
}

const UW = "[\\p{L}\\p{N}_]";
const WB = `(?:(?<=${UW})(?!${UW})|(?<!${UW})(?=${UW}))`;
const ZH = "[\\u4e00-\\u9fff]";
const TT = "(?:先生|小姐|女士|太太)";
const SUR = "陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董溫唐藍蔣石古紀姚連馮歐程湯田康姜白汪鄒尤巫黎涂龔嚴韓袁金童陸夏柳邵";
const PII: [string, RegExp][] = [
  ["email", /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi],
  ["email", /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}/gi],
  ["url", /(?:https?:\/\/|www\.)\S+/gi],
  ["url", new RegExp(`${WB}[a-z0-9\\-]{2,}(?:\\.[a-z0-9\\-]{2,})*\\.(?:com|net|org|tw|io|me|cc)${WB}(?:\\/\\S*)?`, "giu")],
  ["handle", new RegExp(`(?<!${UW})@[A-Za-z0-9._\\-]{3,30}`, "gu")],
  // 2026-10-06：舊寫法 \s*(?:id)?\s*[:=是為]?\s*（連續三個可空的 \s*）對「line」加長空白是立方時間回溯；改成每段空白後面都跟必要字元，語言相同、線性時間
  ["line", /(?<![A-Za-z])(?:line|賴)\s*(?:id\s*)?(?:[:=是為]\s*)?@?[A-Za-z0-9._-]{4,30}/gi],
  ["mobile", /(?<!\d)(?:\+?886[-.\s]?|0[-.\s]?)9(?:[-.\s]?\d){8}(?!\d)/g],
  ["mobile", /(?:[零〇○一二三四五六七八九][\s\-.]?){8,}/g],
  ["landline", /(?<!\d)\(?0\d{1,2}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g],
  ["id", /(?<![A-Za-z0-9])[A-Za-z][12ABCDabcd89]\d{8}(?!\d)/g],
  ["card", /(?<!\d)\d{4}[-\s]\d{4}[-\s]\d{4}(?:[-\s]\d{4})?(?!\d)/g],
  ["longdigits", /(?<![\d.])\d{9,}(?![\d.]|\s?元)/g],
  ["longdigits", /(?<![\d.])\d{8}(?![\d.]|\s?(?:萬|元|坪|年|樓|F|%|公尺))/g],
  ["addr", /\d{1,4}\s*巷|\d{1,4}\s*弄|\d{1,4}(?:之\d{1,3})?\s*號(?:\s*\d{1,3}\s*樓)?(?:\s*之\s*\d+)?/g],
  ["name", new RegExp(`(?:我姓|敝姓)\\s*[:是為]?\\s*(?:歐陽|司馬|諸葛|上官|范姜|張簡|${ZH})${TT}?`, "g")],
  ["name", new RegExp(`(?:我叫|姓名|名字(?:是|叫)?|聯絡人|稱呼)\\s*[:是為]?\\s*${ZH}{2,3}${TT}?`, "g")],
  ["name", new RegExp(`我是\\s*[${SUR}]${ZH}{1,2}${TT}?(?=$|[\\s,，。;；、!！?？]|想|要|在|找|買|看|是|的|有|欲|準備|打算)`, "g")],
  ["title", new RegExp(`[${SUR}]${ZH}{0,2}${TT}`, "g")],
  ["orphan", /(?:電話|手機|行動電話|市話|聯絡(?:方式|電話)?|e-?mail|信箱|line\s*id)\s*[:是為]?\s*(?=$|[,，。;；、\s])/gi],
];
const EV_PII: Record<string, string> = {
  mobile: "phone", landline: "phone", email: "email", line: "line", handle: "line", id: "id", card: "id", longdigits: "id",
  addr: "addr", name: "name", title: "name",
};

/** 被隱藏的網址、帳號、電話等字串換成這個記號（讓景泰看得出「這裡原本有東西」，又點不到、複製不到） */
export const HIDDEN = "[已隱藏]";
const HIDE_RULES: RegExp[] = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  /[a-z0-9._%+-]+\s*(?:\(at\)|\[at\])\s*[a-z0-9-]+\s*(?:\(dot\)|\[dot\])\s*[a-z]{2,}/gi,
  /(?:https?:\/\/|ftp:\/\/|tg:\/\/|www\.|t\.me\/)\S*/gi,
  // 任何「名稱.後綴」：Telegram 會把 bit.ly／t.me／goo.gl 這類都變成可點連結，不只常見的 .com .tw
  new RegExp(`${WB}[a-z0-9\\-]{2,}(?:\\.[a-z0-9\\-]{2,})*\\.[a-z]{2,24}${WB}(?:\\/\\S*)?`, "giu"),
  new RegExp(`(?<!${UW})@[A-Za-z0-9._\\-]{2,}`, "gu"),
  new RegExp(`(?<!${UW})#[\\p{L}\\p{N}_]{2,}`, "gu"),
  /(?<!\d)(?:\+?886[-.\s]?|0[-.\s]?)9(?:[-.\s]?\d){8}(?!\d)/g,
  /(?<!\d)\(?0\d{1,2}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g,
  /(?<![A-Za-z0-9])[A-Za-z][12ABCDabcd89]\d{8}(?!\d)/g,
  /(?<![\d.])\d{8,}(?![\d.])/g,
];

/**
 * 把一段（已 normText 過的）客人文字裡「看起來像網址、Email、@帳號、#標籤、電話、身分證字號」的字串換成 HIDDEN。
 * 用在要放進 Telegram 的稱呼、備註、客人原話：它們不該成為可點的連結，也不該帶客人沒同意留的電話。
 * 注意：這不是 scrub()——不處理姓名／門牌／稱謂（稱呼欄本來就是姓名）。
 */
export function hideLinks(text: string): string {
  let s = normText(text);
  for (const rx of HIDE_RULES) s = s.replace(rx, HIDDEN);
  return s.replace(/\s+/g, " ").trim();
}

export function scrub(text: unknown): { clean: string; types: string[]; pii: string[] } {
  let s = normText(text);
  const types: string[] = [];
  for (const [name, rx] of PII) {
    let n = 0;
    s = s.replace(rx, () => {
      n++;
      return " ";
    });
    if (n && !types.includes(name)) types.push(name);
  }
  s = s
    .replace(/\s+/g, " ")
    .replace(/\s+([,，、;；。])/g, "$1")
    .replace(/([,，、;；。])(?:\s*\1)+/g, "$1")
    .replace(/^[\s,，、;；。:]+|[\s,，、;；。:]+$/g, "");
  const pii: string[] = [];
  for (const t of types) {
    const c = EV_PII[t];
    if (c && !pii.includes(c)) pii.push(c);
  }
  return { clean: s, types, pii };
}

/* ---------- NeedFields／context ---------- */
export type Fields = {
  districts?: string[];
  road?: string;
  price_min_wan?: number;
  price_max_wan?: number;
  rooms_min?: number;
  rooms_max?: number;
  types?: string[];
  age_max?: number;
  parking?: string;
  floor_exclude?: number[];
  exclude_top?: true;
  floor_min?: number;
  area_min_ping?: number;
  area_max_ping?: number;
  /** 2026-10-09 範圍找法：社區名（家用機先對公開名冊）、74環內（r74）、地圖上選的範圍（[[緯度,經度],…]） */
  community?: string;
  zone?: string;
  geo?: number[][];
};
export type Context = { stage?: string; timeline?: string; special?: string[]; concerns?: string[] };

const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

function enumList(v: unknown, allowed: readonly string[], maxn: number, sorted: boolean): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !allowed.includes(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  if (out.length > maxn) return null;
  if (sorted) out.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  return out;
}

export function normalizeFields(raw: unknown): { fields: Fields; issues: string[] } {
  const out: Fields = {};
  const issues: string[] = [];
  if (!isObj(raw)) return { fields: {}, issues: ["fields:not_object"] };
  const emptyish = (v: unknown) => !v || (Array.isArray(v) && v.length === 0);
  if (!emptyish(raw.districts)) {
    const ds = enumList(raw.districts, DISTRICTS, 2, true);
    if (ds === null) issues.push("districts:invalid");
    else if (ds.length) out.districts = ds;
  }
  const rv = raw.road;
  if (rv !== null && rv !== undefined && rv !== "") {
    const road = typeof rv === "string" ? normText(rv).trim().replace(/臺/g, "台") : null;
    if (road === null || !ROAD_RE.test(road)) issues.push("road:invalid");
    else if ((out.districts ?? []).length >= 2) issues.push("road:multi_district");
    else if ((out.districts ?? []).length === 0) issues.push("road:no_district");   // 沒有行政區就不收路段（RT-11）：路段不能單獨構成一個需求
    else if (!knownRoad(road)) issues.push("road:unknown");                          // 不在台中市路名字典裡：只丟路段，其他欄位照送
    else out.road = road;
  }
  // 範圍找法（處理順序：districts → road → community → zone → geo → 互斥 → 其餘；三方同一順序）
  if (!nul(raw.community)) {
    const c = commOk(raw.community);
    if (c === null) issues.push("community:invalid");
    else out.community = c;
  }
  if (!nul(raw.zone)) {
    if (typeof raw.zone === "string" && (ZONES as readonly string[]).includes(raw.zone)) out.zone = raw.zone;
    else issues.push("zone:invalid");
  }
  if (!nul(raw.geo)) {
    const g = geoCheck(raw.geo);
    if (g.poly) out.geo = g.poly;
    else issues.push(`geo:${g.code}`);
  }
  // 互斥（社區 ＞ 地圖 ＞ 74環）：社區留區（家用機拿來挑同名社區）；地圖不留區與路段；74環碰到環外的區就不算，留下來時不帶路段
  const drop = (k: keyof Fields, why: string) => {
    if (k in out) {
      delete out[k];
      issues.push(`${k}:${why}`);
    }
  };
  if (out.community) {
    drop("zone", "scope");
    drop("geo", "scope");
    drop("road", "scope");
  } else if (out.geo) {
    drop("zone", "scope");
    drop("districts", "scope");
    drop("road", "scope");
  } else if (out.zone) {
    if ((out.districts ?? []).some(d => !(R74_DISTRICTS as readonly string[]).includes(d))) drop("zone", "conflict");
    else drop("road", "scope");
  }
  const ranges: [keyof Fields, keyof Fields, number, number][] = [
    ["price_min_wan", "price_max_wan", 100, 100000],
    ["rooms_min", "rooms_max", 1, 6],
    ["area_min_ping", "area_max_ping", 5, 300],
  ];
  for (const [loK, hiK, lo, hi] of ranges) {
    const a = raw[loK];
    const b = raw[hiK];
    let av: number | null = null;
    let bv: number | null = null;
    if (!nul(a)) {
      av = intIn(a, lo, hi);
      if (av === null) issues.push(`${loK}:invalid`);
    }
    if (!nul(b)) {
      bv = intIn(b, lo, hi);
      if (bv === null) issues.push(`${hiK}:invalid`);
    }
    if (av !== null && bv !== null && av > bv) {
      issues.push(`${loK}:min_gt_max`);
      av = bv = null;
    }
    if (av !== null) (out as Record<string, unknown>)[loK] = av;
    if (bv !== null) (out as Record<string, unknown>)[hiK] = bv;
  }
  if (!emptyish(raw.types)) {
    const ts = enumList(raw.types, TYPES, 2, true);
    if (ts === null) issues.push("types:invalid");
    else if (ts.length) out.types = ts;
  }
  if (!nul(raw.age_max)) {
    const n = intIn(raw.age_max, 1, 60);
    if (n === null) issues.push("age_max:invalid");
    else out.age_max = n;
  }
  if (!nul(raw.parking)) {
    if (typeof raw.parking === "string" && (PARKING as readonly string[]).includes(raw.parking)) out.parking = raw.parking;
    else issues.push("parking:invalid");
  }
  if (!emptyish(raw.floor_exclude)) {
    const v = raw.floor_exclude;
    if (!Array.isArray(v) || v.length > 12) issues.push("floor_exclude:invalid");
    else {
      const fl: number[] = [];
      let bad = false;
      for (const x of v) {
        const n = intIn(x, 1, 60);
        if (n === null) {
          bad = true;
          break;
        }
        if (!fl.includes(n)) fl.push(n);
      }
      if (bad) issues.push("floor_exclude:invalid");
      else if (fl.length) out.floor_exclude = fl.sort((x, y) => x - y);
    }
  }
  if (!nul(raw.exclude_top)) {
    if (typeof raw.exclude_top === "boolean") {
      if (raw.exclude_top) out.exclude_top = true;
    } else issues.push("exclude_top:invalid");
  }
  if (!nul(raw.floor_min)) {
    const n = intIn(raw.floor_min, 1, 60);
    if (n === null) issues.push("floor_min:invalid");
    else out.floor_min = n;
  }
  return { fields: out, issues };
}

export function normalizeContext(raw: unknown): { context: Context; issues: string[] } {
  const out: Context = {};
  const issues: string[] = [];
  if (!isObj(raw)) return { context: {}, issues: nul(raw) ? [] : ["context:not_object"] };
  if (!nul(raw.stage)) {
    if (typeof raw.stage === "string" && (STAGES as readonly string[]).includes(raw.stage)) out.stage = raw.stage;
    else issues.push("stage:invalid");
  }
  if (!nul(raw.timeline)) {
    if (typeof raw.timeline === "string" && (TIMELINES as readonly string[]).includes(raw.timeline)) out.timeline = raw.timeline;
    else issues.push("timeline:invalid");
  }
  for (const [k, allowed, maxn] of [["special", SPECIALS, 8], ["concerns", CONCERNS, 12]] as const) {
    const v = raw[k];
    if (v && !(Array.isArray(v) && v.length === 0)) {
      const l = enumList(v, allowed, maxn, false);
      if (l === null) issues.push(`${k}:invalid`);
      else if (l.length) out[k] = l;
    }
  }
  return { context: out, issues };
}

/* ---------- 聯絡方式（有任何聯絡欄位就必須有有效同意） ---------- */
export type Contact = { name?: string; line?: string; phone?: string; email?: string; note?: string; pref: "line" | "phone" | "email" };
export type Consent = { contact: true; v: string };

const contactPresent = (c: unknown): boolean =>
  isObj(c) && ["name", "line", "phone", "email", "note"].some(k => typeof c[k] === "string" && (c[k] as string).trim() !== "");

export function validateContact(c: unknown): { contact: Contact | null; err: ErrCode | null } {
  if (nul(c)) return { contact: null, err: null };
  if (!isObj(c)) return { contact: null, err: "E_BAD_REQUEST" };
  const str = (k: string) => (typeof c[k] === "string" && (c[k] as string).trim() ? normText(c[k]).trim() : null);
  const out: Partial<Contact> = {};
  const name = str("name");
  const line = str("line");
  const phone = str("phone");
  const email = str("email");
  const note = str("note");
  if (name !== null) {
    if (cpLen(name) > 20) return { contact: null, err: "E_TOO_LARGE" };
    const hn = hideLinks(name);
    if (hn) out.name = hn;
  }
  if (line !== null && LINE_ID_RE.test(line)) out.line = line;
  if (phone !== null && PHONE_RE.test(phone)) out.phone = phone;
  if (email !== null && cpLen(email) <= 80 && EMAIL_RE.test(email)) out.email = email;
  if (note !== null) {
    if (cpLen(note) > 100) return { contact: null, err: "E_TOO_LARGE" };
    const hnote = hideLinks(note);
    if (hnote) out.note = hnote;
  }
  if (!out.line && !out.phone && !out.email) return { contact: null, err: null };
  const p = c.pref;
  const pref: Contact["pref"] =
    (p === "line" || p === "phone" || p === "email") && out[p] ? p : out.line ? "line" : out.phone ? "phone" : "email";
  return { contact: { ...out, pref }, err: null };
}

function contactAndConsent(body: Obj): { contact: Contact | null; consent: Consent | null; err: ErrCode | null } {
  const rc = body.contact;
  const rcs = body.consent;
  if (!nul(rc) && !isObj(rc)) return { contact: null, consent: null, err: "E_BAD_REQUEST" };
  if (!nul(rc) && contactPresent(rc)) {
    if (!(isObj(rcs) && rcs.contact === true && rcs.v === CONSENT_V)) return { contact: null, consent: null, err: "E_CONSENT" };
    const { contact, err } = validateContact(rc);
    if (err) return { contact: null, consent: null, err };
    if (!contact) return { contact: null, consent: null, err: null };
    return { contact, consent: { contact: true, v: CONSENT_V }, err: null };
  }
  return { contact: null, consent: null, err: null };
}

/* ---------- 提交 ---------- */
export type SubmitClean = {
  v: 1;
  idem: string;
  fields: Fields;
  context: Context;
  free_text: string;
  skip: boolean;
  contact: Contact | null;
  consent: Consent | null;
  refine_of: string | null;
  from: string | null;
  fill_ms: number | null;
  turnstile: string;
  hp: string;
};

export function validateSubmit(body: unknown): { out: SubmitClean | null; err: ErrCode | null } {
  if (!isObj(body) || body.v !== SCHEMA_V) return { out: null, err: "E_BAD_REQUEST" };
  if (typeof body.idem !== "string" || !IDEM_RE.test(body.idem)) return { out: null, err: "E_BAD_REQUEST" };
  if (!nul(body.fields) && !isObj(body.fields)) return { out: null, err: "E_BAD_REQUEST" };
  if (!nul(body.context) && !isObj(body.context)) return { out: null, err: "E_BAD_REQUEST" };
  let ft: unknown = nul(body.free_text) ? "" : body.free_text;
  if (typeof ft !== "string") return { out: null, err: "E_BAD_REQUEST" };
  ft = normText(ft).trim();
  if (cpLen(ft as string) > FREE_TEXT_MAX) return { out: null, err: "E_TOO_LARGE" };
  const cc = contactAndConsent(body);
  if (cc.err) return { out: null, err: cc.err };
  let refine: string | null = null;
  if (typeof body.refine_of === "string" && JOB_ID_RE.test(body.refine_of)) refine = body.refine_of;
  const tsTok = typeof body.turnstile === "string" && body.turnstile.length <= 2048 ? body.turnstile : "";
  return {
    err: null,
    out: {
      v: 1,
      idem: body.idem,
      fields: normalizeFields(body.fields ?? {}).fields,
      context: normalizeContext(body.context ?? {}).context,
      free_text: ft as string,
      skip: body.skip === true,
      contact: cc.contact,
      consent: cc.consent,
      refine_of: refine,
      from: isFromTag(body.from) ? body.from : null,
      fill_ms: intIn(body.fill_ms, 0, 86400000),
      turnstile: tsTok,
      hp: typeof body.hp === "string" ? body.hp : body.hp ? "x" : "",
    },
  };
}

/* ---------- 事後補留聯絡方式 ---------- */
export function validateContactBody(body: unknown): {
  out: { jid: string | null; contact: Contact; consent: Consent; hp: string; turnstile: string } | null;
  err: ErrCode | null;
} {
  if (!isObj(body) || body.v !== SCHEMA_V) return { out: null, err: "E_BAD_REQUEST" };
  let jid: string | null = null;
  if (!nul(body.jid)) {
    if (typeof body.jid !== "string" || !JOB_ID_RE.test(body.jid)) return { out: null, err: "E_BAD_REQUEST" };
    jid = body.jid;
  }
  if (!contactPresent(body.contact)) return { out: null, err: "E_BAD_REQUEST" };
  const cc = contactAndConsent(body);
  if (cc.err) return { out: null, err: cc.err };
  if (!cc.contact || !cc.consent) return { out: null, err: "E_BAD_REQUEST" };
  const tsTok = typeof body.turnstile === "string" && body.turnstile.length <= 2048 ? body.turnstile : "";
  return { out: { jid, contact: cc.contact, consent: cc.consent, hp: typeof body.hp === "string" ? body.hp : body.hp ? "x" : "", turnstile: tsTok }, err: null };
}

/* ---------- 回饋 ---------- */
export type FeedbackClean = { jid: string; rating: 1 | -1 | null; tags: string[]; text: string; fatigue: string | null };
export function validateFeedback(body: unknown): { out: FeedbackClean | null; err: ErrCode | null } {
  if (!isObj(body) || body.v !== SCHEMA_V) return { out: null, err: "E_BAD_REQUEST" };
  if (typeof body.jid !== "string" || !JOB_ID_RE.test(body.jid)) return { out: null, err: "E_BAD_REQUEST" };
  const rating: 1 | -1 | null = body.rating === 1 ? 1 : body.rating === -1 ? -1 : null;
  let tags: string[] = [];
  if (!nul(body.tags) && !(Array.isArray(body.tags) && body.tags.length === 0) && rating !== null) {
    tags = enumList(body.tags, rating === 1 ? FB_TAGS_UP : FB_TAGS_DOWN, 6, false) ?? [];
  }
  let text = "";
  if (body.text !== null && body.text !== undefined && body.text !== "") {
    if (typeof body.text !== "string") return { out: null, err: "E_BAD_REQUEST" };
    const t0 = normText(body.text).trim();
    if (cpLen(t0) > FEEDBACK_TEXT_MAX) return { out: null, err: "E_TOO_LARGE" };
    text = scrub(t0).clean;
  }
  const fatigue = typeof body.fatigue === "string" && (FATIGUE as readonly string[]).includes(body.fatigue) ? body.fatigue : null;
  if (rating === null && !text && fatigue === null) return { out: null, err: "E_BAD_REQUEST" };
  return { out: { jid: body.jid, rating, tags, text, fatigue }, err: null };
}

/* ---------- 匿名使用事件（與家用機端同一張 EVENT_SPEC，用 event_cases.json 逐案比對） ---------- */
type Spec =
  | { k: "enum"; v: readonly string[] }
  | { k: "int"; lo: number; hi: number }
  | { k: "bool01" }
  | { k: "tag" }
  | { k: "list"; v: readonly string[]; max: number };
const E = (...v: readonly string[]): Spec => ({ k: "enum", v });
const I = (lo: number, hi: number): Spec => ({ k: "int", lo, hi });
const L = (v: readonly string[], max: number): Spec => ({ k: "list", v, max });
const B: Spec = { k: "bool01" };
const TAG: Spec = { k: "tag" };
const LVL = E(...LEVELS);
const QID = E(...QUESTION_IDS);

export const EVENT_SPEC: Record<string, Record<string, Spec>> = {
  view: { src: TAG, dev: E("m", "d", "t"), th: E("l", "d") },
  start: { how: E("free", "pick", "comm", "zone", "map") },
  free_submit: { lenb: I(0, 3), lvl: LVL, got: L(FIELD_CODES, 9), miss: L(FIELD_CODES, 9), drop: L(DROP_CODES, 3), pii: L(PII_CODES, 6) },
  q_show: { q: QID },
  q_ans: { q: QID, n: I(0, 12), ms: I(0, 3600000) },
  q_skip: { q: QID },
  go_now: { lvl: LVL, left: I(0, 4) },
  nudge: { r: E("show", "accept", "decline") },
  confirm: { lvl: LVL, fn: I(0, 14) },
  edit: { k: E(...FIELD_CODES) },
  submit: { lvl: LVL, skip: B, ct: B, nc: I(0, 12), rf: B },
  submit_res: { st: E("queued", "need_more", "degraded", "error"), err: E(...ERR_CODES), sv: B },
  wait_end: { st: E("done", "empty", "degraded", "abandon"), ws: I(0, 1800), qa: I(0, 99), polls: I(0, 999) },
  game: { a: E("start", "over", "skip"), sc: I(0, 9), pl: I(0, 99) },
  // 2026-10-07 小遊戲排行榜（wait-board.js）：只記「有送出成績」「有留暱稱」的次數，不記暱稱內容。
  // ⚠️ 家用機 mp_aif_events.py 的 EVENT_SPEC 要補同一行才記得下來；沒補之前家用機逐則丟掉（同批其他事件照收）。
  lb: { a: E("send", "name") },
  // 2026-10-09 地圖範圍（find-map.js）：開、完成、失敗、取消、重畫；用「目前畫面」或「自己圈」。不含任何座標
  area: { a: E("open", "done", "fail", "cancel", "redo"), m: E("view", "lasso") },
  result: { n: I(0, 12), ws: I(0, 1800) },
  result_click: { a: E("open", "copy", "banner", "refine", "lineq") },
  contact: { r: E("show", "submit", "skip"), m: L(["line", "phone", "email"], 3) },
  fb: { r: E("up", "down"), tags: L([...FB_TAGS_UP, ...FB_TAGS_DOWN], 6), tx: B },
  fatigue: { v: E(...FATIGUE) },
  err: { c: E("net", "parse", "turnstile", "origin", "rate", "other") },
  leave: { ws: I(0, 1800) },
};
export const MAX_EVENT_BYTES = 512;
export const MAX_BATCH = 30;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function checkSpec(sp: Spec, v: unknown): { ok: boolean; val?: unknown } {
  switch (sp.k) {
    case "enum":
      return { ok: typeof v === "string" && sp.v.includes(v), val: v };
    case "int":
      return { ok: isInt(v) && v >= sp.lo && v <= sp.hi, val: v };
    case "bool01":
      return { ok: isInt(v) && (v === 0 || v === 1), val: v };
    case "tag":
      return { ok: isFromTag(v), val: v };
    case "list": {
      if (!Array.isArray(v) || v.length > sp.max) return { ok: false };
      const out: string[] = [];
      for (const x of v) {
        if (typeof x !== "string" || !sp.v.includes(x)) return { ok: false };
        if (!out.includes(x)) out.push(x);
      }
      return { ok: true, val: out };
    }
  }
}

export function validateEvent(e: unknown): Obj | null {
  if (!isObj(e) || typeof e.e !== "string") return null;
  const spec = Object.prototype.hasOwnProperty.call(EVENT_SPEC, e.e) ? EVENT_SPEC[e.e] : null;
  if (!spec) return null;
  const out: Obj = { e: e.e };
  if ("t" in e) {
    if (!(isInt(e.t) && e.t >= 0 && e.t <= 86400000)) return null;
    out.t = e.t;
  }
  if ("s" in e && checkSpec(E(...STEP_CODES), e.s).ok) out.s = e.s;
  for (const [k, sp] of Object.entries(spec)) {
    if (!(k in e)) continue;
    const r = checkSpec(sp, e[k]);
    if (r.ok) out[k] = r.val;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > MAX_EVENT_BYTES) return null;
  return out;
}

export type EventEnvelope = { v: 1; sid: string; jid: string | null; rid: string | null; events: Obj[] };
export function validateEventBatch(b: unknown): { env: EventEnvelope | null; dropped: number } {
  if (!isObj(b) || b.v !== SCHEMA_V) return { env: null, dropped: -1 };
  if (typeof b.sid !== "string" || !IDEM_RE.test(b.sid)) return { env: null, dropped: -1 };
  let jid: string | null = null;
  if (!nul(b.jid)) {
    if (typeof b.jid !== "string" || !JOB_ID_RE.test(b.jid)) return { env: null, dropped: -1 };
    jid = b.jid;
  }
  let rid: string | null = null;
  if (!nul(b.rid)) {
    if (typeof b.rid !== "string" || !IDEM_RE.test(b.rid)) return { env: null, dropped: -1 };
    rid = b.rid;
  }
  if (!Array.isArray(b.events)) return { env: null, dropped: -1 };
  const clean: Obj[] = [];
  let dropped = 0;
  b.events.forEach((e, i) => {
    if (i >= MAX_BATCH) {
      dropped++;
      return;
    }
    const v = validateEvent(e);
    if (v === null) dropped++;
    else clean.push(v);
  });
  return { env: { v: 1, sid: b.sid, jid, rid, events: clean }, dropped };
}
