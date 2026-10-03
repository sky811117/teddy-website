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
  "必爭", "最寬", "置產傳家", "永久棟距", "永久視野", "最熟", "帶您成交",
];

/** 漲跌預測：房仲不能替買方預測房價，命中整句刪 */
export const PREDICTION_WORDS = [
  "增值潛力", "價值翻倍", "翻倍", "看漲", "保值", "抗跌", "起漲點", "起漲",
  "會漲", "保證增值", "投報率高達",
  "增值(?!稅)", "上漲", "價格可期", "潛力看好", "潛力無限", "漲幅",
  "(?:發展|開發|交通)潛力", "(?:發展|效益)可期", "(?:外溢|政策|人口)紅利",
  "估總銷", "投報率優於",
];

/** 舊版標題清洗就在砍的字（不在共用詞表，但同樣是公平交易法第 21 條的風險字） */
const LEGACY_TITLE_WORDS = [
  "絕美", "最優", "最低", "搶手", "完美無缺", "甜甜價", "俗俗賣", "千載難逢",
];

const EXAGGERATED_RE = new RegExp(
  [...EXAGGERATED_WORDS, ...LEGACY_TITLE_WORDS].join("|")
);
const PREDICTION_RE = new RegExp(PREDICTION_WORDS.join("|"));

// ── 未完工公共建設（2026-10-03 SEO/GEO 稽核 A 批；CLAUDE.md ⛔「蓋好了才能說」）──────────
// 出處：房仲工作站\450_上架巡檢\staging_quality.py 第 93-119 行 UNBUILT_GATE_RE（三平台閘門那一份），
// 逐字移植它的字組再補官網稽核漏網字；跟 ~/.claude/skills/properties-sync/scripts/text_sanitize.py
// 的 UNBUILT、scripts/audit-properties.mjs 的 UNBUILT_RE 三處逐字一致（改字三處一起改）。
// ⛔ 不用 lookbehind（JS／Python 方言才不會跑出不同結果）；不准放裸「規劃中」、裸 G\d站（綠線 G3-G17
//    已通車）、裸「區段徵收」、裸「未來性」、裸「預計」。「巨蛋」只擋台中那座（高雄巨蛋已啟用）。
export const UNBUILT_FIXED_WORDS = [
  "藍線", "茄苳腳", "輕軌", "橘線", "紫線", "太子(?:商場|置地)", "機捷(?!特區|專區|重劃區)",
  "綠線延伸", "規劃站點", "規劃站體", "(?:台中|臺中|北屯|雙|小)巨蛋",
  "洲際[^，。；！？\\n]{0,8}巨蛋", "成形在即", "成形可期", "(?:環評|審議)中",
  // 2026-10-03 審查補：興建中商場（1187694「高鐵娛樂購物城已開挖」）、開發中園區宣傳句（0240903）
  "已開挖", "高鐵娛樂(?:購物)?城", "娛樂購物城", "政府主導開發",
  "開發進程[^，。；！？、\\n]{0,6}推進", "通過[^，。；！？、\\n]{0,4}環評",
];
const UNBUILT_LEAD_WORDS = ["規劃中", "興建中", "施工中", "動工中", "籌建中", "預計", "即將", "擬建", "計畫中", "計劃中"];
const UNBUILT_LEAD_NOUNS = ["捷運", "輕軌", "車站", "重劃", "商場", "百貨", "購物中心", "快速道路", "道路", "交流道",
  "學校", "國小", "國中", "高中", "公園", "通車", "開幕", "啟用", "落成"];
const UNBUILT_FUTURE_NOUNS = ["捷運", "輕軌", "車站", "重劃", "商場", "百貨", "購物中心", "快速道路", "交流道", "聯外道路",
  "新校區", "學校", "國小", "國中", "高中", "公園"];
const UNBUILT_SUBJ_NOUNS = ["捷運", "輕軌", "車站", "重劃區", "商場", "百貨", "購物中心", "快速道路", "交流道", "聯外道路",
  "新校區", "學校", "國小", "國中", "高中", "公園"];
const UNBUILT_TRAIL_WORDS = ["規劃中", "興建中", "施工中", "動工中", "籌建中", "預計", "即將", "尚未通車", "未來將"];
const UB_NC = "[^，。；！？、\\n]"; // 不跨子句
export const UNBUILT_SOURCE =
  UNBUILT_FIXED_WORDS.join("|") +
  "|[Bb]\\s?\\d{1,2}\\s?站" +
  "|未來\\S{0,3}?(?:" + UNBUILT_FUTURE_NOUNS.join("|") + ")" +
  "|(?:" + UNBUILT_LEAD_WORDS.join("|") + ")" + UB_NC + "{0,8}?(?:" + UNBUILT_LEAD_NOUNS.join("|") + ")" +
  "|(?:" + UNBUILT_SUBJ_NOUNS.join("|") + ")" + UB_NC + "{0,6}?(?:" + UNBUILT_TRAIL_WORDS.join("|") + ")" +
  "|興建中|規劃中(?![島西式])" +
  "|未來捷運\\s*[A-Z]?\\d{0,2}" +
  "|捷運" + UB_NC + "{0,8}(?:規劃|延伸|預計|即將|未來|尚未通車)" +
  "|預計\\s*(?:20\\d\\d\\s*年)?" + UB_NC + "{0,6}(?:落成|完工|開幕|營運|通車)" +
  "|區段徵收.{0,12}(?:卡位|潛力|可期|成形|利多)" +
  "|(?:置產|提早|輕鬆|優先)卡位";
/** 未完工公共建設（不帶 g，可安全 .test） */
export const UNBUILT_RE = new RegExp(UNBUILT_SOURCE);
/** 「預計 2025 年第一季交屋」：年份 < 今年才算違規（過期交屋時程） */
const EXPIRED_HANDOVER_SOURCE = "預計\\s*(20\\d\\d)\\s*年" + UB_NC + "{0,10}?交屋";
/** 假第一人稱（2026-06-03 教訓：沒真的經歷過不准寫） */
export const FAKE_FIRST_PERSON_RE = /我自己跑|客戶問過|我自己也住|我(?:自己)?跑過\s*\d*\s*次/;
/** 借鄰戶門牌定位本戶：「與隔壁221號為雙店面」→「與隔壁為雙店面」（只留方位詞） */
export const NEIGHBOR_NUMBER_RE =
  /(隔壁|旁邊|對面|緊鄰|隔鄰|毗鄰)\s*\d+\s*(?:[之\-–]\d+)?\s*號(?!\s*(?:快速|道|線|出口|公園|公車|省道|縣道|國道))/g;
/** 標題片語（整段吃掉）。英數站碼前面要有 未來/規劃/預定/預計/即將 才吃（綠線「捷運G7站」不能砍），藍線 B 站直接吃 */
const UNBUILT_TITLE_RE = new RegExp(
  "(?:鄰近|緊鄰|近|靠近|步行可達)?(?:未來|規劃中?|預定|預計|興建中|即將)?(?:台中)?(?:捷運|輕軌)?\\s*" +
    "(?:藍線|橘線|紫線|茄苳腳)(?:站前|站點|生活圈|預定站|規劃站點|交會|增值|站)?" +
    "|(?:未來|規劃中?|預定|預計|即將)捷運\\s*[A-Z]\\d{1,2}\\s*(?:站前|站點|站)?" +
    "|捷運\\s*[Bb]\\d{1,2}\\s*(?:站前|站點|站)?" +
    "|未來捷運(?:站)?" +
    "|(?:即將完工的)?太子(?:商場|置地)" +
    "|機捷(?!特區|專區|重劃區)(?:\\s*[A-Z]\\d{1,2}\\s*站)?(?:雙軌)?",
  "g"
);

/**
 * 開發中園區當標題賣點（2026-10-03 景泰裁決）：夏田產業園區還在區段徵收中＝未完工建設，
 * 標題不准拿它當片語（0240900／0240901／0240903「夏田產業園區｜…」「夏田產業園區內｜…」）。
 * 只砍標題；description／body 的「位於夏田產業園區區段徵收範圍內」是法定狀態揭露，要留。
 * text_sanitize.py UNBUILT_TITLE_PLACE、scripts/audit-properties.mjs UNBUILT_TITLE_PLACE_RE 三處同一份。
 */
export const UNBUILT_TITLE_PLACE_SOURCE = "(?:大里區?)?夏田(?:產業)?園區(?:範圍內?|內|旁)?";
const UNBUILT_TITLE_PLACE_RE = new RegExp(UNBUILT_TITLE_PLACE_SOURCE, "g");

function thisYear(): number {
  return Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 4));
}
export function hasExpiredHandover(s: string, year = thisYear()): boolean {
  for (const m of (s || "").matchAll(new RegExp(EXPIRED_HANDOVER_SOURCE, "g"))) {
    if (Number(m[1]) < year) return true;
  }
  return false;
}
function stripExpiredHandover(s: string, year = thisYear()): string {
  return (s || "").replace(new RegExp(EXPIRED_HANDOVER_SOURCE, "g"), (m, y) => (Number(y) < year ? "" : m));
}
/** 含未完工公共建設／過期交屋時程？ */
export function isUnbuilt(s: string): boolean {
  return !!s && (UNBUILT_RE.test(s) || hasExpiredHandover(s));
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/gu;
const CLAUSE_LEAD_RE = /^[\s\-—>•・\u{2460}-\u{2473}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{1F000}-\u{1FAFF}\u{FE0F}\u{200D}]*/u;
const PAREN_RE = /[（(][^（）()]*[）)]/g;
const PAREN_DISCLAIMER_RE = /尚未|還沒|未通車/;

/**
 * 子句級刪除（跟 text_sanitize.py drop_unbuilt_clauses 同一套）：只丟含未完工建設的子句，
 * 每個子句都中（或命中跨子句）、或剩不到 6 字接不上的殘句，才整句丟。括號但書「（綠線延伸還沒通車）」只拿掉括號。
 */
export function dropUnbuiltClauses(sentence: string): string {
  if (!sentence || !isUnbuilt(sentence)) return sentence;
  let s = sentence.replace(PAREN_RE, g => (isUnbuilt(g) && PAREN_DISCLAIMER_RE.test(g) ? "" : g));
  if (!isUnbuilt(s)) return s;
  const lead = s.match(CLAUSE_LEAD_RE)?.[0] ?? "";
  const body = s.slice(lead.length);
  const trailWs = body.match(/\s*$/)?.[0] ?? "";
  const parts = body.replace(/([，、；,;。！？!?：:])/g, "$1\x00").split("\x00").filter(p => p);
  const kept: string[] = [];
  for (const p of parts) {
    if (isUnbuilt(p)) {
      const mp = p.match(/([，；。！？!?;,])\s*$/);
      if (kept.length && mp && /[，、,；;]\s*$/.test(kept[kept.length - 1])) {
        kept[kept.length - 1] = kept[kept.length - 1].replace(/[，、,；;](\s*)$/, (_m, ws) => mp[1] + ws);
      }
    } else kept.push(p);
  }
  const content = kept.filter(k => !/^[^：:]*[：:]\s*$/.test(k)).join("");
  if (kept.length === parts.length || (content.match(WORD_CHAR_RE) || []).length < 6) return "";
  let out = kept.join("").trimEnd().replace(/[，、,；;：:\s]+$/, "");
  const end = body.match(/([。！？!?；;])\s*$/);
  if (end && !/[。！？!?；;]$/.test(out)) out += end[1];
  out = out.replace(/^\s*[，、,；;]+\s*/, "");
  return lead + out + trailWs;
}

/**
 * 標題用的「片語級」刪除：先吃整個片語再吃單詞，避免留下「社區｜田尾長青墅」
 * 「屋主買三房」這種殘句（2026-09-05 查證實跑 32 筆標題的結論）。
 * 順序有意義：長片語在前。
 */
const TITLE_PHRASES: RegExp[] = [
  // 未完工建設片語（「西區捷運藍線站前電梯套房」→「西區電梯套房」；text_sanitize.py UNBUILT_TITLE 同一份）
  UNBUILT_TITLE_RE,
  // 開發中園區片語（2026-10-03 景泰裁決：「夏田產業園區｜74旁…」→「74旁…」）
  UNBUILT_TITLE_PLACE_RE,
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

/**
 * 去 emoji。replacement 預設 ""（標題用）；sanitizeCopy 傳句界記號，
 * 讓 ✅①🌈 這些條列符號被拿掉時「切句點」留著（2026-10-03：舊版先刪 emoji 再切句，
 * 條列整段被當成一句，命中一條就整段 description 變空字串）。
 */
export function stripEmoji(s: string, replacement = ""): string {
  return (s || "").replace(EMOJI_RE, replacement);
}

export function hasExaggeration(s: string): boolean {
  return (
    EXAGGERATED_RE.test(s) || PREDICTION_RE.test(s) || FAKE_FIRST_PERSON_RE.test(s) || isUnbuilt(s)
  );
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
  // 片語吃不到的未完工建設／假第一人稱：整個「｜段」丟（例「…｜輕鬆卡位蛋黃區」）
  s = s
    .split(/[｜|│／]/)
    .map(seg => seg.replace(/^[\s、,，\-—–*·•!！]+|[\s、,，\-—–*·•!！]+$/g, ""))
    .filter(seg => seg.length > 0 && !isUnbuilt(seg) && !FAKE_FIRST_PERSON_RE.test(seg))
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
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const rawLine of lines) {
    if (hasThirdPartyContact(rawLine)) continue;
    // 切句時保留句末標點：先把標點後面插一個切點。
    // 2026-10-03：emoji（✅①🌈…）拿掉時換成切點、「•」「・」前面與兩個以上空白也切
    // （同 text_sanitize.py _SENT_SPLIT），條列才不會整段被當成一句一起刪光。
    const sentences = stripEmoji(stripExpiredHandover(rawLine), "\x00")
      .replace(/([。！!；;？?])/g, "$1\x00")
      .replace(/(?=[•・])/g, "\x00")
      .replace(/\s{2,}/g, m => "\x00" + m)
      .split("\x00");
    const kept = sentences
      // 先刪未完工建設的子句，剩下的再判整句紅線（誇大／預測／假第一人稱）
      .map(sen => dropUnbuiltClauses(sen))
      .filter(
        sen =>
          sen.trim() &&
          !EXAGGERATED_RE.test(sen) &&
          !PREDICTION_RE.test(sen) &&
          !FAKE_FIRST_PERSON_RE.test(sen)
      )
      .map(sen =>
        sen
          .replace(INTERNAL_WORDS_RE, "")
          .replace(ADDRESS_RE, "$1")
          .replace(LANE_NUMBER_RE, "").replace(LANE_PAREN_RE, "").replace(LANE_AFTER_ROAD_RE, "")
          .replace(NEIGHBOR_NUMBER_RE, "$1")
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

// ── 自測（2026-10-03 A 批；案例跟 text_sanitize.py UNBUILT_MUST_HIT／MUST_NOT 同一組）──────────
// 跑法：node --experimental-strip-types -e "import('./src/utils/cleanPropertyTitle.ts').then(m=>console.log(m.unbuiltSelfTest()))"
export const UNBUILT_MUST_HIT = [
  "鄰近未來捷運藍線「茄苳腳站」", "未來捷運 G20 站", "近未來橘線捷運元保宮站", "三井Outlet、捷運藍線規劃中",
  "即將完工的漢神百貨與太子商場", "擁雙巨蛋百億商圈", "台中國際港灣成形在即", "捷運藍線未來發展提早卡位城市建設利多",
  "台中捷運綠線延伸線 G3 站（規劃中）", "散步即達漢神、洲際球場與巨蛋", "交通：機捷 G3 站 + 74 號快速道路",
  "預計2025年第一季交屋", "高鐵娛樂購物城已開挖", "近 13 期高鐵娛樂城", "2023年5月已通過二階環評",
  "開發進程明確推進", "位於夏田產業園區區段徵收範圍內，政府主導開發",
];
export const UNBUILT_MUST_NOT = [
  "開放式廚房規劃中島", "捷運綠線文心中清站", "近74快速道路捷運G7站", "市政府捷運站旁", "近楠梓高雄巨蛋商圈",
  "區段徵收與重劃開發程序進行中，進度以主管機關公告為準", "緊鄰74號快速道路", "很多人是被「機捷特區」這 4 個字勾過來的",
  "預計2030年第一季交屋", "只看七期、北屯機捷重劃區的買家", "位於大里夏田產業園區範圍，屬區段徵收範圍內",
];
export function unbuiltSelfTest(year = 2026): string[] {
  const fails: string[] = [];
  for (const s of UNBUILT_MUST_HIT)
    if (!(UNBUILT_RE.test(s) || hasExpiredHandover(s, year))) fails.push(`必中沒中：${s}`);
  for (const s of UNBUILT_MUST_NOT)
    if (UNBUILT_RE.test(s) || hasExpiredHandover(s, year)) fails.push(`必不中卻中：${s}`);
  const titles: Record<string, string> = {
    "中蔗路旁｜捷運藍線｜乙建自建置產都好": "中蔗路旁｜乙建自建置產都好",
    "澔宇築心｜西區黃金地段全新兩房兩衛｜捷運藍線": "澔宇築心｜西區黃金地段全新兩房兩衛",
    "西區捷運藍線站前電梯套房": "西區電梯套房",
    "彰化東區|泰和茂涵森三房附平車|未來捷運 G20": "彰化東區｜泰和茂涵森三房附平車",
    "土地20坪東山機捷｜一層一戶大四房雙車": "土地20坪東山｜一層一戶大四房雙車",
    "南屯鎮南段｜區段徵收潛力農地｜多塊可選A": "南屯鎮南段｜多塊可選A",
    "近74快速道路捷運G7站三房": "近74快速道路捷運G7站三房",
    // 2026-10-03 景泰裁決：夏田產業園區（區段徵收中）不當標題片語
    "夏田產業園區｜74旁｜環河首排置產節稅農地": "74旁｜環河首排置產節稅農地",
    "夏田產業園區｜40米環河路首排｜近74出口": "40米環河路首排｜近74出口",
    "夏田產業園區內｜臨路大面寬｜都計節稅農地": "臨路大面寬｜都計節稅農地",
    "大里夏田產業園區旁農地": "FALLBACK",
  };
  for (const [t, want] of Object.entries(titles)) {
    const got = cleanPropertyTitle(t, "FALLBACK");
    if (got !== want) fails.push(`標題：${t} → ${got}（要 ${want}）`);
  }
  const copies: Record<string, string> = {
    "1.與隔壁221號為雙店面，可合併購入": "1.與隔壁為雙店面，可合併購入",
    "緊鄰74號快速道路，國道1號 5 分鐘": "緊鄰74號快速道路，國道1號 5 分鐘",
    "♠️未來捷運藍線、台灣大道國三、國一、74快速道路中心點": "台灣大道國三、國一、74快速道路中心點",
    "- 要走路 3 分鐘到捷運站的（綠線延伸還沒通車）": "- 要走路 3 分鐘到捷運站的",
    "物件特色 • 捷運藍線規劃站點生活圈 • 家電家具齊全，附系統櫃": "物件特色 • 家電家具齊全，附系統櫃",
    "✅ 未來捷運 G20 站，步行可達 ✅ 國聖國小約250公尺，接送便利": "國聖國小約250公尺，接送便利",
    "② 六樓高度視野開闊 ③ 捷運藍線未來發展提早卡位城市建設利多 ④ 客餐廳一體設計": "六樓高度視野開闊 客餐廳一體設計",
    "邊間三面採光，我自己也住三樓。方正格局": "方正格局", // JS 端假第一人稱整句刪（片語改寫只在源頭 text_sanitize.py）
    "預計2025年第一季交屋公設比：33%": "公設比：33%",
    "開放式廚房規劃中島，捷運綠線文心中清站旁": "開放式廚房規劃中島，捷運綠線文心中清站旁",
  };
  for (const [t, want] of Object.entries(copies)) {
    const got = sanitizeCopy(t);
    if (got !== want) fails.push(`文案：${t} → ${JSON.stringify(got)}（要 ${JSON.stringify(want)}）`);
  }
  return fails;
}
