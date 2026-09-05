/**
 * 物件對外文字的渲染層防線（2026-09-06）
 *
 * 委託書的案名、賣點、文案是寫給同事看的，不是寫給買方或搜尋引擎看的：
 * 帶「專任」「賠售」「稀有」這類內部用語／誇大字眼、emoji、同事的聯絡電話、
 * 甚至完整門牌。properties-sync 產 md 時會先清一輪（源頭），這裡是頁面
 * 渲染前的最後一道，兩邊詞表要一致（scripts/audit-properties.mjs 也同一份）。
 *
 * 三個出口：
 *   cleanPropertyTitle(raw, fallback)  — 標題：片語級刪除 + emoji 去除 + 分隔符收斂 + 太短就 fallback
 *   sanitizeCopy(text)                 — 文案：誇大／預測句「整句刪」、含第三人聯絡的整行刪、門牌砍到路段
 *   sanitizeHighlights(list)           — 賣點條列：逐條 sanitizeCopy，清空的條目丟掉
 */

// ── 共用詞表（B4 渲染層 / B5 audit / B6 產生腳本 三處一致）────────────────

/** 誇大詞：命中就整句刪（文案）或整段刪（標題片語） */
export const EXAGGERATED_WORDS = [
  "絕版", "最強", "最低價", "社區最低", "全市場最低", "稀有", "賠售", "急售",
  "割愛", "獨家", "最便宜", "最俗", "最美", "最愛", "唯一", "首選", "超低",
  "珍稀", "限量", "破盤", "無敵", "不敗", "穩賺", "必漲", "保證漲", "超值",
  "買到賺到", "錯過不再",
];

/** 漲跌預測：房仲不能替買方預測房價，命中整句刪 */
export const PREDICTION_WORDS = [
  "增值潛力", "價值翻倍", "翻倍", "看漲", "保值", "抗跌", "起漲點", "起漲",
  "會漲", "保證增值", "投報率高達",
  "增值(?!稅)", "上漲", "價格可期", "潛力看好", "漲幅",
];

/** 舊版標題清洗就在砍的字（不在共用詞表，但同樣是公平交易法第 21 條的風險字） */
const LEGACY_TITLE_WORDS = [
  "絕美", "最優", "最低", "搶手", "完美無缺", "甜甜價", "俗俗賣", "千載難逢",
];

const EXAGGERATED_RE = new RegExp(
  [...EXAGGERATED_WORDS, ...LEGACY_TITLE_WORDS].join("|")
);
const PREDICTION_RE = new RegExp(PREDICTION_WORDS.join("|"));

/**
 * 標題用的「片語級」刪除：先吃整個片語再吃單詞，避免留下「社區｜田尾長青墅」
 * 「屋主買三房」這種殘句（2026-09-05 查證實跑 32 筆標題的結論）。
 * 順序有意義：長片語在前。
 */
const TITLE_PHRASES: RegExp[] = [
  // 「屋主賠售」「屋主割愛甜甜價」「急售」— 先吃，免得下一條的前綴吃到「售」
  /(?:屋主)?(?:賠售|割愛|急售)(?:甜甜價)?/g,
  // 「全社區最便宜」「彰化市最低價」「全棟最便宜」「社區最低」…含前綴整段
  // （前綴只列固定字，不用 [一-鿿]{2,3} 這種通配，2026-09-06 實測會吃到社區名）
  /(?:全社區|全棟|全區|全市|本社區|社區|市場|彰化市|彰化|台中市|台中|臺中|南投|埔里|溪湖|和美|田尾)?(?:最便宜|最低價|最低|最俗|最優|最強|最美|最愛|唯一)(?:釋出|出售|價|棟別)?/g,
  // 「首購首選」「投資置產首選」「小資理財首選」— 只吃常見的修飾語（最多兩個），別吃到社區名
  /(?:首購族?|投資客?|自住客?|置產|換屋|退休|小資族?|成家|收租|理財|小家庭|家庭|頭家|中科|通勤|新婚|包租公|包租婆|寧靜社區)?(?:首購族?|投資客?|自住客?|置產|換屋|退休|小資族?|成家|收租|理財|小家庭|家庭|頭家|中科|通勤|新婚|包租公|包租婆|寧靜社區)?首選/g,
  // 「稀有釋出」「珍稀釋出」「限量釋出」
  /(?:稀有|珍稀|限量|超值|絕版)(?:釋出|出售|物件|美宅)?/g,
  // 「超低價」「破盤價」
  /(?:超低|破盤)(?:總價|價)?/g,
  // 「建商最愛」「集團最愛」殘留的主詞
  /(?:建商|集團|投資客|自住客)(?=[｜|│、,，\-—–\s]|$)/g,
];

/** 委託類型／內部代號：買方看不懂也不該看 */
const INTERNAL_WORDS_RE =
  /本店專任|專任委託|專任|一般委託|獨家委託|委編[:：]?\s*[A-Z]{0,2}\d+|\b(?:UG|UA|UT|HG|QG)\d{5,}\b/g;
/** 舊版：標題開頭「（專任）｜」這種前綴 */
const INTERNAL_PREFIX_RE =
  /^\s*[（(【]?\s*(專任|一般|獨家)\s*[）)】]?\s*[｜|、,，\-—\s]*/;

/** 第三人聯絡方式：整行刪。景泰本人的電話／公司電話是白名單 */
const PHONE_RE = /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g;
const PHONE_WHITELIST = new Set(["0920118756", "0423120888"]);
const CONTACT_RE = /經紀人[:：]|營業員[:：]|LINE\s*(?:ID)?\s*[:：]|洽詢|聯絡人/i;

/** 完整門牌 → 砍到路段（與 scripts/fix_address_leak.py 的 PAT 同一套） */
const ADDRESS_RE =
  /([一-鿿]{2,6}?(?:路|街|大道)(?:[一二三四五六七八九十東西南北]{1,3}段)?)(\d+(?:[之\-–]\d+)?(?:巷\d+)?(?:弄\d+)?號)(?![快道])/g;
/** 沒有路名前綴、直接「12巷3弄5號」的殘型 */
const LANE_NUMBER_RE = /\d+\s*巷\s*(?:\d+\s*弄\s*)?\d+(?:[之\-–]\d+)?\s*號/g;
/** 只有巷（弄）沒有號：「（218巷）」「興進路218巷」→ 巷號屬「巷弄號碼」不公開 */
const LANE_PAREN_RE = /[（(]\s*\d+\s*巷(?:\s*\d+\s*弄)?\s*[)）]/g;
const LANE_AFTER_ROAD_RE = /(?<=[路街道段])\s*\d+\s*巷(?:\s*\d+\s*弄)?(?!\s*\d)/g;

/** emoji 與裝飾符號（沿用原 [...slug].astro 的 unicode range，補上變體選擇子與 dingbats） */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{3030}\u{303D}\u{3297}\u{3299}\u{1F1E6}-\u{1F1FF}]/gu;

export function stripEmoji(s: string): string {
  return (s || "").replace(EMOJI_RE, "");
}

export function hasExaggeration(s: string): boolean {
  return EXAGGERATED_RE.test(s) || PREDICTION_RE.test(s);
}

/** 標題分隔符收斂：連續分隔符壓成一個、去頭尾分隔符、壓空白 */
function tidySeparators(s: string): string {
  return s
    .replace(/[｜|│／]/g, "｜")
    .replace(/\s*\*+\s*/g, " ")
    .replace(/\s*｜\s*/g, "｜")
    .replace(/｜{2,}/g, "｜")
    .replace(/^[｜、,，\-—–*\s·•]+|[｜、,，\-—–*\s·•]+$/g, "")
    .replace(/[、,，]{2,}/g, "、")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 標題清洗。回傳一定非空：清完 < 4 字（或全砍光）就用 fallback，
 * fallback 沒給再退回去 emoji 後的原字串（總比空白好）。
 */
export function cleanPropertyTitle(raw: string, fallback?: string): string {
  let s = stripEmoji(raw || "").replace(INTERNAL_PREFIX_RE, "");
  s = s.replace(INTERNAL_WORDS_RE, "");
  for (const re of TITLE_PHRASES) s = s.replace(re, "");
  // 片語吃不到的單詞再掃一次（例如「無敵景觀」「破盤」）
  s = s.replace(new RegExp(EXAGGERATED_RE.source, "g"), "");
  s = s.replace(new RegExp(PREDICTION_RE.source, "g"), "");
  // 空掉的段落（例如「｜社區｜」清完剩「｜｜」）
  s = s
    .split(/[｜|│／]/)
    .map(seg => seg.replace(/^[\s、,，\-—–*·•!！]+|[\s、,，\-—–*·•!！]+$/g, ""))
    .filter(seg => seg.length > 0)
    .join("｜");
  s = tidySeparators(s);
  if (s.replace(/\s/g, "").length < 4) {
    const fb = (fallback || "").trim();
    if (fb) return fb;
    const orig = tidySeparators(stripEmoji(raw || ""));
    return orig || s;
  }
  return s;
}

/** 這一行含不是景泰／公司的電話或第三人聯絡資訊？ */
function hasThirdPartyContact(line: string): boolean {
  if (CONTACT_RE.test(line)) return true;
  const phones = line.match(PHONE_RE) || [];
  return phones.some(p => !PHONE_WHITELIST.has(p.replace(/\D/g, "")));
}

/**
 * 文案清洗（description / highlights / 物件介紹段）。
 * - 以 。！!；; 與換行切句：誇大／預測命中的「整句刪」，不換字，避免留半句
 * - 含第三人聯絡的整行刪
 * - 門牌砍到路段
 * - 內部代號（專任／委編）字詞刪
 * 保留原本的換行結構，讓呼叫端自己決定怎麼排版。
 */
export function sanitizeCopy(text: string): string {
  if (!text) return "";
  const lines = stripEmoji(text).split(/\r?\n/);
  const out: string[] = [];
  for (const rawLine of lines) {
    if (hasThirdPartyContact(rawLine)) continue;
    // 切句時保留句末標點：先把標點後面插一個切點
    const sentences = rawLine
      .replace(/([。！!；;？?])|(?=[✅✔✨🔹⭐●◆■▶►])/g, "$1\x00")
      .split("\x00");
    const kept = sentences
      .filter(sen => sen.trim() && !EXAGGERATED_RE.test(sen) && !PREDICTION_RE.test(sen))
      .map(sen =>
        sen
          .replace(INTERNAL_WORDS_RE, "")
          .replace(ADDRESS_RE, "$1")
          .replace(LANE_NUMBER_RE, "").replace(LANE_PAREN_RE, "").replace(LANE_AFTER_ROAD_RE, "")
      )
      .join("");
    const line = kept.replace(/\s{2,}/g, " ").replace(/^[\s，、,]+/, "").trim();
    if (line) out.push(line);
  }
  return out.join("\n").trim();
}

/** 同事文案常把「✨ 物件亮點」「🏢 社區規劃」這種小標題也塞進 highlights，去掉 */
const HIGHLIGHT_JUNK_RE = /^\s*(?:物件亮點|物件特色|社區規劃|賣點)\s*[:：]?\s*$/;

export function sanitizeHighlights(list: readonly string[] | undefined): string[] {
  if (!list) return [];
  return list
    .map(h => sanitizeCopy(h).replace(/\n+/g, " ").trim())
    .filter(h => h.length > 0 && !HIGHLIGHT_JUNK_RE.test(h));
}
