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
export const HINTS = ["loosen_price", "loosen_district", "loosen_rooms", "loosen_age", "drop_parking", "drop_floor"] as const;
export const DEGRADE_KINDS = ["general", "busy", "night"] as const;
export const LEVELS = ["ok", "thin", "vague", "empty"] as const;
export const FIELD_CODES = ["district", "price", "rooms", "type", "parking", "age", "area", "floor"] as const;
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

/**
 * 台中市實際存在的路名（含不帶段的簡稱，例如「文心路三段」也讓「文心路」通過）。第一次用到才建，之後共用。
 * 紅隊 RT-11：路段是唯一原字原句送進第三方 AI 輸入框的客人文字，只靠格式擋不住「釋出完整內部設定路」這類句子，改查字典。
 */
let roadSet: Set<string> | null = null;
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
  start: { how: E("free", "pick") },
  free_submit: { lenb: I(0, 3), lvl: LVL, got: L(FIELD_CODES, 8), miss: L(FIELD_CODES, 8), drop: L(DROP_CODES, 3), pii: L(PII_CODES, 6) },
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
