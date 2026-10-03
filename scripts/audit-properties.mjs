#!/usr/bin/env node
/**
 * 物件法規合規掃描（deploy 閘門）
 *
 * 掃描 src/content/properties/*.md 的 title / streetArea / community / description /
 * highlights / body，輸出違規清單。**有 ERROR 就 exit 1、擋 build**（deploy.yml 與
 * package.json build 都掛這步）。
 *
 * 嚴重度：
 *   ERROR（擋 build）
 *     - 完整門牌（路/街/大道 + 號、巷弄號）— 隱私鐵則
 *     - 非白名單手機（白名單：景泰 0920-118-756、店電 04-2312-0888）— 第三人聯絡資訊
 *     - 「經紀人：」後面不是黃永隆 — 法規揭露錯誤（營業員自稱經紀人 / 同事名）
 *     - 誇大詞（絕版 / 最強 / 社區最低 / 稀有 / 賠售 …）— 公平交易法第 21 條
 *     - 漲跌預測（增值潛力 / 翻倍 / 看漲 / 保值 …）— 景泰鐵則：無來源不預測房價
 *     - 內部用語（專任 / 委編 / UG1234…）— 對外文案不該出現
 *     - 屋主稱謂 / 姓氏 / 身分證
 *     - 未完工建設（藍線 / 橘線 / 巨蛋 / 規劃中 / 即將 / 預計… / 過期「預計 20XX 年交屋」）— CLAUDE.md 法規紅線
 *     - 假第一人稱（我自己跑 / 客戶問過 / 我自己也住…）— 景泰鐵則：沒經歷過不准寫
 *     - 標題拿開發中園區當片語（夏田產業園區…，只掃 title）— 2026-10-03 景泰裁決
 *     - 非綠線行政區的捷運宣稱（frontmatter district 非北屯/北區/西屯/南屯/南區/烏日，寫捷運生活圈/近捷運/捷運宅…；
 *       否定寫法不報、點名綠線真實車站只 WARN）— 2026-10-04 0239000 大肚
 *     - 借鄰戶門牌定位本戶（隔壁221號）— 歸「完整門牌」
 *   WARN（只列出，不擋）
 *     - 第三人聯絡引導（營業員：/ LINE ID：/ 洽詢 / 聯絡人）
 *     - 預售敏感詞（預售 / 代銷 …）— 需人工確認是不是在替建案打廣告
 *     - 議價 / 殺價（需景泰裁決）
 *     - body 缺證號（頁面 footer 會自動補，只是提醒一致性）
 *
 * 詞表跟 src/pages/properties（渲染層過濾）與 properties-sync 產生腳本（清洗）三處要一致，
 * 改詞先改共用詞表再同步三處。
 *
 * 輸出：stdout 摘要 + audit/audit-{date}.md + .json
 *
 * usage:
 *   node scripts/audit-properties.mjs            # 有 ERROR → exit 1
 *   node scripts/audit-properties.mjs --warn-only  # 只報告不擋（本機看報告用）
 *   node scripts/audit-properties.mjs --self-test  # 只跑詞表自測（必中／必不中），失敗 exit 1
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const PROPERTIES_DIR = new URL("../src/content/properties/", import.meta.url);
const AUDIT_DIR = new URL("../audit/", import.meta.url);
const WARN_ONLY = process.argv.includes("--warn-only");
const SELF_TEST = process.argv.includes("--self-test");

// ============ 共用詞表（B4 渲染層 / B5 audit / B6 產生腳本 三處一致） ============

// 誇大詞 EXAGGERATED
export const EXAGGERATED_RE =
  /絕版|最強|最低價|社區最低|全市場最低|稀有|賠售|急售|割愛|獨家|最便宜|最俗|最美|最愛|唯一|首選|超低|珍稀|限量|破盤|無敵|不敗|穩賺|必漲|保證漲|超值|買到賺到|錯過不再|必爭|最寬|置產傳家|永久棟距|永久視野|最熟|帶您成交/g;

// 漲跌預測 PREDICTION
export const PREDICTION_RE =
  /增值潛力|價值翻倍|翻倍|看漲|保值|抗跌|起漲點|起漲|會漲|保證增值|投報率高達|增值(?!稅)|上漲|價格可期|潛力看好|潛力無限|漲幅|(?:發展|開發|交通)潛力|(?:發展|效益)可期|(?:外溢|政策|人口)紅利|估總銷|投報率優於/g;

// 第三人聯絡 CONTACT（手機另外用 PHONE_RE + 白名單）
export const CONTACT_RE = /經紀人[:：]|營業員[:：]|LINE\s*(?:ID)?[:：]|洽詢|聯絡人/g;

// 手機 + 白名單
export const PHONE_RE = /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g;
const PHONE_WHITELIST = [/^0920[-\s]?118[-\s]?756$/];
const STORE_PHONE_RE = /04[-\s]?2312[-\s]?0888/g; // 店電，不算違規

// 內部用語 INTERNAL
export const INTERNAL_RE = /專任|本店專任|委編|UG\d+|UA\d+/g;

// 未完工公共建設 UNBUILT（2026-10-03 A 批）
// 出處：房仲工作站\450_上架巡檢\staging_quality.py 第 93-119 行 UNBUILT_GATE_RE（三平台閘門那一份），
// 跟 src/utils/cleanPropertyTitle.ts 的 UNBUILT_SOURCE、~/.claude/skills/properties-sync/scripts/text_sanitize.py
// 的 UNBUILT_SOURCE 逐字一致（改字三處一起改）。⛔ 不用 lookbehind；不放裸「規劃中」、裸 G\d站（綠線已通車）、
// 裸「區段徵收」、裸「未來性」、裸「預計」。「巨蛋」只擋台中那座（0397205 高雄巨蛋已啟用）。
const UNBUILT_FIXED_WORDS = [
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
const UB_NC = "[^，。；！？、\\n]";
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
export const UNBUILT_RE = new RegExp(UNBUILT_SOURCE, "g");
// 開發中園區當標題賣點（2026-10-03 景泰裁決）：夏田產業園區還在區段徵收中＝未完工建設，**只掃 title**。
// description／body 的「位於夏田產業園區區段徵收範圍內」是法定狀態揭露，不報。
// 跟 cleanPropertyTitle.ts UNBUILT_TITLE_PLACE_SOURCE、text_sanitize.py UNBUILT_TITLE_PLACE_SOURCE 同一份
// （那兩邊是「吃掉片語」用的完整寫法；這裡只要偵測，命中核心字「夏田(產業)園區」就 ERROR）。
export const UNBUILT_TITLE_PLACE_SOURCE = "(?:大里區?)?夏田(?:產業)?園區(?:範圍內?|內|旁)?";
export const UNBUILT_TITLE_PLACE_RE = new RegExp(UNBUILT_TITLE_PLACE_SOURCE, "g");

// 非綠線行政區的捷運宣稱（2026-10-04；0239000 大肚「大肚太平路捷運生活圈」）。
// 台中捷運目前只有綠線通車，車站所在行政區：北屯、北區、西屯、南屯、南區、烏日。其他行政區寫
// 「捷運生活圈／捷運宅／近捷運／捷運旁／捷運商圈」＝廣告不實（跟未完工建設同級）→ ERROR。
// 跟 cleanPropertyTitle.ts、text_sanitize.py 的 MRT_* 三處逐字一致（改字三處一起改）；⛔ 不用 lookbehind。
// 每個句段（不跨「，。；｜換行」）：有宣稱片語 → 否定寫法不報（單字「無／非／沒」必須緊貼「捷運」，
// 多字否定詞「沒有／不是／不在／不近／遠離」才准隔 ≤4 字；「非常近捷運」「無敵近捷運」不是否定）→
// frontmatter district 有值時只看 district（非綠線行政區 → ERROR；綠線區、外縣市不報，句段提到別區不算）；
// district 空字串才退回看句段裡的非綠線行政區名 → ERROR；
// 句段裡點名綠線真實車站（潭子「近捷運松竹站」）→ WARN 請人工確認距離（清洗端放行）。
export const MRT_OFFLINE_DISTRICTS = [
  "大肚", "沙鹿", "梧棲", "清水", "龍井", "大雅", "神岡", "豐原", "潭子", "太平", "大里",
  "霧峰", "東區", "中區", "西區", "后里", "外埔", "大甲", "大安", "新社", "石岡", "東勢", "和平",
];
export const MRT_CLAIM_SOURCE =
  "(?:鄰近|緊鄰|靠近|近|鄰)捷運(?:站)?(?:旁|口)?|捷運(?:站)?(?:生活圈|商圈|宅|旁|首排|第一排)|捷運站前";
export const MRT_PLACE_SOURCE =
  "(?:大肚|沙鹿|梧棲|清水|龍井|大雅|神岡|豐原|潭子|太平|大里|霧峰|后里|外埔|大甲|石岡|東勢)" +
  "(?![路街巷弄道段溪洋港模])" +
  "|新社(?![區路街巷弄道段])|(?:和平|大安)區|(?:^|[^北南竹義化])[東西]區|(?:^|[^台臺])中區";
export const MRT_GREEN_STATION_SOURCE =
  "(?:北屯總|舊社|松竹|四維國小|文心崇德|文心中清|文華高中|文心櫻花|市政府|水安宮|" +
  "文心森林公園|南屯|豐樂公園|大慶|九張犁|九德|烏日|高鐵臺中|高鐵台中)站|[Gg]\\s?\\d{1,2}\\s?站";
export const MRT_NEGATION_SOURCE =
  "(?:無|非|並非|沒)捷運" +
  "|(?:沒有|不是|不在|不近|遠離)[^，。；｜|│丨！？!?;,\\n]{0,4}捷運";
const MRT_SEG_SPLIT_SOURCE = "([，。；｜|│丨！？!?;,\\n])";
export function isOfflineMrtDistrict(district) {
  const d = (district || "").trim().replace(/^(?:台中市|臺中市)/, "").replace(/區$/, "");
  return MRT_OFFLINE_DISTRICTS.includes(d);
}
/** 句段判定：""＝沒事；"claim"＝不實宣稱；"station"＝非綠線物件但點名綠線車站 */
export function offlineMrtSegment(seg, district) {
  if (!seg || !new RegExp(MRT_CLAIM_SOURCE).test(seg) || new RegExp(MRT_NEGATION_SOURCE).test(seg)) return "";
  if ((district || "").trim()) {
    if (!isOfflineMrtDistrict(district)) return ""; // 有 district：只看 district
  } else if (!new RegExp(MRT_PLACE_SOURCE).test(seg)) return ""; // 沒 district：才看句段裡的行政區名
  return new RegExp(MRT_GREEN_STATION_SOURCE).test(seg) ? "station" : "claim";
}
/** 掃一個欄位，回傳 [{kind, matched, seg}] */
export function findOfflineMrtClaims(value, district) {
  const out = [];
  if (!value || !new RegExp(MRT_CLAIM_SOURCE).test(value)) return out;
  const pieces = value.split(new RegExp(MRT_SEG_SPLIT_SOURCE));
  for (let i = 0; i < pieces.length; i += 2) {
    const kind = offlineMrtSegment(pieces[i], district);
    if (!kind) continue;
    for (const m of pieces[i].matchAll(new RegExp(MRT_CLAIM_SOURCE, "g"))) out.push({ kind, matched: m[0], seg: pieces[i] });
  }
  return out;
}
// 「預計 2025 年第一季交屋」：年份 < 今年才算（過期交屋時程＝不實）
export const EXPIRED_HANDOVER_RE = new RegExp("預計\\s*(20\\d\\d)\\s*年" + UB_NC + "{0,10}?交屋", "g");
const THIS_YEAR = Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 4));

// 假第一人稱 FAKE_FIRST_PERSON（2026-06-03 教訓；⛔ 不要用「我.{0,6}的觀察是」，會誤殺有來源的看法）
export const FAKE_FIRST_PERSON_RE = /我自己跑|客戶問過|我自己也住|我(?:自己)?跑過\s*\d*\s*次/g;

// 完整門牌 ADDRESS（同 scripts/fix_address_leak.py 的 PAT + 巷弄號寫法）
export const ADDR_PATTERNS = [
  /[（(]\s*\d+\s*巷(?:\s*\d+\s*弄)?\s*[)）]/, // 「（218巷）」只有巷號也算巷弄號碼
  /(?:路|街|大道)(?:[一二三四五六七八九十東西南北]{1,3}段)?\s*\d+\s*巷(?!\s*\d*\s*[弄號])/, // 「興進路218巷」（帶弄/號的由下面規則抓）
  /\d+\s*巷\s*\d+\s*弄\s*\d+\s*號/, // 「76巷29弄9號」
  /\d+\s*巷\s*\d+\s*號(?!之)/, // 「76巷9號」(避免「9號之2」誤判樓層)
  /\d+\s*弄\s*\d+\s*號/, // 「29弄9號」
  // 路/街/大道 (+N段) + 地址數字（支援「52-4號」「之4號」「XX巷」）+ 號
  // ⚠️ 不用 \b：\b 對中文「號」無效會漏抓（活案例 UG1171985「精明一街52-4號」曾漏網）
  // 「74號快速道路 / 國道1號」因「號」前無「X路/街/大道」緊接前綴，不會誤判
  // 「環中路 74號快速道路」是道路名不是門牌 → 號後面接「快速 / 道」放行
  /(?:路|街|大道)(?:[一二三四五六七八九十東西南北]{1,3}段)?\s*\d+(?:[之\-–]\d+)?(?:巷\d+)?(?:弄\d+)?\s*號(?!\s*(?:快速|道))/,
  // 「隔壁221號」借鄰戶門牌定位本戶（2026-10-03；號後接 快速/道/線/出口/公園… 是道路地標引用，放行）
  /(?:隔壁|旁邊|對面|緊鄰|隔鄰|毗鄰)\s*\d+\s*(?:[之\-–]\d+)?\s*號(?!\s*(?:快速|道|線|出口|公園|公車|省道|縣道|國道))/,
];

// 「經紀人：」後面必須是黃永隆（法規揭露：經紀人只有他一位；營業員是陳景泰）
const BROKER_LINE_RE = /經紀人\s*[:：]\s*([^\s,，、。｜|/／]{1,10})/g;
const BROKER_NAME = "黃永隆";

// 屋主隱私
const OWNER_PATTERNS = [
  { name: "屋主稱謂", re: /屋主[\s]?[一-鿿][\s]?(先生|太太|小姐|女士)/g },
  { name: "屋主姓氏", re: /([一-鿿])\s*(先生|太太|小姐|女士)\s*[售賣委]/g },
  { name: "身分證", re: /[A-Z][12]\d{8}/g },
];

// WARN 類
const PRESALE_RE = /預售|代銷|建設公司新案|新建案/g; // 「即將完工」2026-10-03 移到 UNBUILT（ERROR）
const NEGOTIATION_RE = /議價|殺價|砍價/g;

// 證號揭露
const BROKER_RE = /113\s*彰縣\s*字?\s*324/;
const AGENT_RE = /114\s*登\s*字?\s*488296/;

// 未完工建設／假第一人稱的嚴重度：回洗後 --warn-only 掃到 0 筆 → ERROR（擋 build）
const UNBUILT_SEVERITY = "ERROR";

// ============ 掃描 ============

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text, rawFm: "" };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (km) {
      let v = km[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      meta[km[1]] = v;
    }
  }
  return { meta, body: m[2], rawFm: m[1] };
}

// highlights 是 YAML 清單，frontmatter() 的單行 parser 吃不到 → 從 rawFm 抓整段
function extractHighlights(rawFm) {
  const lines = rawFm.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (/^highlights:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) {
      out.push(item[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    if (/^\S/.test(line)) break;
  }
  return out.join("\n");
}

function snippetOf(value, idx, len) {
  return value
    .slice(Math.max(0, idx - 20), idx + len + 20)
    .replace(/\s+/g, " ");
}

function pushAll(findings, file, field, value, re, severity, rule, filter) {
  const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of value.matchAll(globalRe)) {
    if (filter && !filter(m)) continue;
    findings.push({
      file,
      severity,
      rule,
      field,
      matched: m[0],
      snippet: snippetOf(value, m.index, m[0].length),
    });
  }
}

function scanField(name, value, findings, file, district = "") {
  if (!value) return;

  // ERROR：完整門牌
  for (const re of ADDR_PATTERNS) {
    pushAll(findings, file, name, value, re, "ERROR", "完整門牌");
  }

  // ERROR：非白名單手機（先把店電拿掉，避免「04-2312-0888」被手機 regex 誤咬一部分）
  const noStore = value.replace(STORE_PHONE_RE, " ");
  pushAll(findings, file, name, noStore, PHONE_RE, "ERROR", "隱私: 非白名單手機", m =>
    !PHONE_WHITELIST.some(w => w.test(m[0].replace(/\s+/g, "")))
  );

  // ERROR：「經紀人：」後面不是黃永隆
  pushAll(findings, file, name, value, BROKER_LINE_RE, "ERROR", "揭露: 經紀人非黃永隆", m =>
    !m[1].includes(BROKER_NAME)
  );

  // ERROR：屋主隱私
  for (const { name: rname, re } of OWNER_PATTERNS) {
    pushAll(findings, file, name, value, re, "ERROR", `隱私: ${rname}`);
  }

  // ERROR：誇大詞 / 漲跌預測 / 內部用語
  pushAll(findings, file, name, value, EXAGGERATED_RE, "ERROR", "廣告誇大");
  pushAll(findings, file, name, value, PREDICTION_RE, "ERROR", "漲跌預測");
  pushAll(findings, file, name, value, INTERNAL_RE, "ERROR", "內部用語");

  // ERROR：未完工建設 / 過期交屋時程 / 假第一人稱（2026-10-03：md 已由 sanitize_existing.py 回洗到 0 筆才升 ERROR）
  pushAll(findings, file, name, value, UNBUILT_RE, UNBUILT_SEVERITY, "未完工建設");
  pushAll(findings, file, name, value, EXPIRED_HANDOVER_RE, UNBUILT_SEVERITY, "未完工建設", m =>
    Number(m[1]) < THIS_YEAR
  );
  pushAll(findings, file, name, value, FAKE_FIRST_PERSON_RE, UNBUILT_SEVERITY, "假第一人稱");
  // ERROR：開發中園區當標題片語（只掃 title；2026-10-03 景泰裁決）
  if (name === "title") {
    pushAll(findings, file, name, value, UNBUILT_TITLE_PLACE_RE, UNBUILT_SEVERITY, "未完工建設(標題園區)");
  }
  // ERROR：非綠線行政區的捷運宣稱（2026-10-04）；點名綠線真實車站的只 WARN（人工確認距離）
  for (const f of findOfflineMrtClaims(value, district)) {
    findings.push({
      file,
      severity: f.kind === "claim" ? UNBUILT_SEVERITY : "WARN",
      rule: f.kind === "claim" ? "非綠線捷運宣稱" : "非綠線捷運(點名綠線站，請人工確認距離)",
      field: name,
      matched: f.matched,
      snippet: f.seg.trim().replace(/\s+/g, " ").slice(0, 60),
    });
  }

  // WARN：第三人聯絡引導（「經紀人：黃永隆」正常頁尾也會命中，所以只 WARN；
  // 真正的問題 — 電話、非黃永隆的經紀人 — 上面已經 ERROR）
  pushAll(findings, file, name, value, CONTACT_RE, "WARN", "第三人聯絡引導", m =>
    !/^經紀人/.test(m[0]) && !/^營業員/.test(m[0]) &&
    // 「LINE：sky811117」是景泰本人（UG1139952 誤判，2026-10-03 排除）
    !/^\s*sky811117/i.test(value.slice(m.index + m[0].length))
  );
  // WARN：預售敏感詞 / 議價
  pushAll(findings, file, name, value, PRESALE_RE, "WARN", "預售敏感詞");
  pushAll(findings, file, name, value, NEGOTIATION_RE, "WARN", "議價用語");
}

// ============ 自測（案例跟 text_sanitize.py / cleanPropertyTitle.ts 同一組） ============
const UNBUILT_MUST_HIT = [
  "鄰近未來捷運藍線「茄苳腳站」", "未來捷運 G20 站", "近未來橘線捷運元保宮站", "三井Outlet、捷運藍線規劃中",
  "即將完工的漢神百貨與太子商場", "擁雙巨蛋百億商圈", "台中國際港灣成形在即", "捷運藍線未來發展提早卡位城市建設利多",
  "台中捷運綠線延伸線 G3 站（規劃中）", "散步即達漢神、洲際球場與巨蛋", "交通：機捷 G3 站 + 74 號快速道路",
  "預計2025年第一季交屋", "高鐵娛樂購物城已開挖", "近 13 期高鐵娛樂城", "2023年5月已通過二階環評",
  "開發進程明確推進", "位於夏田產業園區區段徵收範圍內，政府主導開發",
];
const UNBUILT_MUST_NOT = [
  "開放式廚房規劃中島", "捷運綠線文心中清站", "近74快速道路捷運G7站", "市政府捷運站旁", "近楠梓高雄巨蛋商圈",
  "區段徵收與重劃開發程序進行中，進度以主管機關公告為準", "緊鄰74號快速道路", "很多人是被「機捷特區」這 4 個字勾過來的",
  "預計2030年第一季交屋", "只看七期、北屯機捷重劃區的買家", "位於大里夏田產業園區範圍，屬區段徵收範圍內",
];
function unbuiltHit(s, year) {
  if (new RegExp(UNBUILT_SOURCE).test(s)) return true;
  return [...s.matchAll(new RegExp(EXPIRED_HANDOVER_RE.source, "g"))].some(m => Number(m[1]) < year);
}
function selfTest() {
  const fails = [];
  for (const s of UNBUILT_MUST_HIT) if (!unbuiltHit(s, 2026)) fails.push(`必中沒中：${s}`);
  for (const s of UNBUILT_MUST_NOT) if (unbuiltHit(s, 2026)) fails.push(`必不中卻中：${s}`);
  const fp = new RegExp(FAKE_FIRST_PERSON_RE.source);
  if (!fp.test("我自己跑太平找店面的客戶問過一輪")) fails.push("假第一人稱沒中");
  if (fp.test("我們的觀察是")) fails.push("假第一人稱誤中「我們的觀察是」");
  const nb = ADDR_PATTERNS[ADDR_PATTERNS.length - 1];
  if (!nb.test("1.與隔壁221號為雙店面")) fails.push("鄰戶門牌沒中");
  if (nb.test("緊鄰74號快速道路")) fails.push("鄰戶門牌誤中「緊鄰74號快速道路」");
  // 2026-10-03 景泰裁決：標題園區規則只看 title，description 的法定揭露不報
  const tp = [];
  scanField("title", "夏田產業園區內｜臨路大面寬｜都計節稅農地", tp, "self-test");
  if (!tp.some(f => f.rule === "未完工建設(標題園區)")) fails.push("標題園區沒中");
  const dp = [];
  scanField("description", "✅ 位於夏田產業園區區段徵收範圍內 ✅ 位於大里夏田產業園區範圍，屬區段徵收範圍內", dp, "self-test");
  if (dp.some(f => f.severity === "ERROR")) fails.push("description 法定揭露被誤報：" + dp.map(f => f.matched).join("、"));
  // 2026-10-04 非綠線行政區的捷運宣稱：[欄位值, district, 期望("ERROR"｜"WARN"｜"")]
  const mrtCases = [
    ["大肚太平路捷運生活圈｜黃金面寬美建地", "大肚區", "ERROR"], // 0239000 真實句子
    ["大肚太平路捷運生活圈｜黃金面寬美建地", "", "ERROR"],       // 沒 district 靠句中「大肚」
    ["捷運生活圈，機能完善", "太平區", "ERROR"],
    ["⃣ 交通便利性｜近捷運松竹站、頭家厝火車站", "北屯區", ""],   // 北屯真實寫法
    ["西屯捷運生活圈，步行可達捷運市政府站", "西屯區", ""],
    ["北屯大雅路近捷運", "北屯區", ""],                          // 「大雅路」不是大雅區
    ["交通便利性｜近捷運松竹站、頭家厝火車站", "潭子區", "WARN"], // 點名綠線站 → 人工看
    ["- 要走路到捷運的買家（神岡沒有捷運，要開車）", "神岡區", ""], // 否定寫法
    ["無捷運，但公車方便", "大里區", ""],
    ["太平不是捷運網路強的區", "太平區", ""],
    ["大里非常近捷運", "大里區", "ERROR"],                       // 單字「非」隔字不是否定
    ["大肚無敵近捷運", "大肚區", "ERROR"],                       // 單字「無」隔字不是否定
    ["太平非常靠近捷運站", "太平區", "ERROR"],
    ["沙鹿無縫接軌捷運生活圈", "沙鹿區", "ERROR"],
    ["北屯近捷運往潭子方便", "北屯區", ""],                      // 有 district 只看 district
    ["南區捷運宅 鄰近東區", "南區", ""],
    ["北屯捷運生活圈 大坑太平都近", "北屯區", ""],
    ["西屯捷運宅 近大雅交流道", "西屯區", ""],
    ["烏日捷運生活圈 近大肚山", "烏日區", ""],
    ["大慶站可轉乘捷運綠線", "西區", ""],                        // 不是生活圈宣稱
    ["台北東區捷運商圈", "信義區", ""],
  ];
  for (const [v, d, want] of mrtCases) {
    const fs = [];
    scanField("description", v, fs, "self-test", d);
    const got = fs.find(f => f.rule.startsWith("非綠線捷運"))?.severity ?? "";
    if (got !== want) fails.push(`捷運：${v}［${d || "無district"}］→ ${got || "不報"}（要 ${want || "不報"}）`);
  }
  return fails;
}

async function main() {
  if (SELF_TEST) {
    const fails = selfTest();
    console.log(`[audit-properties] self-test：${fails.length ? fails.length + " 個失敗" : "全過"}`);
    for (const f of fails) console.error(`  ✗ ${f}`);
    process.exit(fails.length ? 1 : 0);
  }
  const files = (await readdir(PROPERTIES_DIR))
    .filter(f => f.endsWith(".md") && !f.startsWith("_"))
    .sort();

  const findings = [];
  const missingCredentials = [];
  let scanned = 0;

  for (const file of files) {
    const text = await readFile(new URL(file, PROPERTIES_DIR), "utf-8");
    const { meta, body, rawFm } = frontmatter(text);
    scanned++;

    scanField("title", meta.title, findings, file, meta.district);
    scanField("streetArea", meta.streetArea, findings, file, meta.district);
    scanField("community", meta.community, findings, file, meta.district);
    scanField("description", meta.description, findings, file, meta.district);
    scanField("highlights", extractHighlights(rawFm), findings, file, meta.district);
    // body 結尾的 `> 委編：UG1234567` 是產生腳本固定加的物件編號 footer（每一筆都有），
    // 先剝掉再掃，否則 INTERNAL 規則會把 382 筆全擋掉。footer 以外任何地方出現
    // 「委編 / UG… / UA…」照樣 ERROR。（待辦：產生腳本改成「物件編號」後可拿掉這行豁免）
    const bodyForScan = body.replace(/^>\s*委編[:：].*$/gm, "");
    scanField("body", bodyForScan, findings, file, meta.district);

    // 證號揭露（WARN：頁面 footer 會用 frontmatter 自動補，不算違規）
    const hasBroker = BROKER_RE.test(body);
    const hasAgent = AGENT_RE.test(body);
    if (!hasBroker || !hasAgent) {
      missingCredentials.push({ file, broker: hasBroker, agent: hasAgent, listingCode: meta.listingCode });
    }
  }

  // Dedup：同 file + 同 rule + 同 matched 只算 1 筆
  // (例：手機號碼可能同時出現在 highlights / description / body 三個欄位)
  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    const key = `${f.file}::${f.rule}::${f.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  const errors = deduped.filter(f => f.severity === "ERROR");
  const warns = deduped.filter(f => f.severity === "WARN");

  const byRule = {};
  for (const f of deduped) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const errorFiles = new Set(errors.map(f => f.file));

  // ---- 報告 ----
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const L = [];
  L.push(`# 物件法規合規掃描 ${today}`);
  L.push("");
  L.push(
    `掃描 **${scanned}** 個物件：**${errors.length}** 筆 ERROR（${errorFiles.size} 檔，擋 build）、**${warns.length}** 筆 WARN、**${missingCredentials.length}** 筆 body 缺證號。`
  );
  L.push("");
  L.push("## 按規則分類");
  for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    L.push(`- **${rule}**: ${count}`);
  }
  L.push("");

  if (errors.length > 0) {
    L.push(`## 🔴 ERROR（${errors.length}）— 修好才能部署`);
    L.push("");
    L.push("> 物件 md 是 properties-sync 每晚自動產生的，**不要手改 md**；要改 `~/.claude/skills/properties-sync/scripts/apply_utrust.py` 的清洗規則，再對這幾筆重跑。");
    L.push("");
    for (const f of errors.slice(0, 200)) {
      L.push(`- \`${f.file}\` · ${f.rule} · field: ${f.field} · matched: \`${f.matched}\``);
      L.push(`  - ${f.snippet}`);
    }
    if (errors.length > 200) L.push(`- ... 還有 ${errors.length - 200} 筆`);
    L.push("");
  }

  if (warns.length > 0) {
    L.push(`## 🟡 WARN（${warns.length}）— 人工複審`);
    const grouped = new Map();
    for (const f of warns) {
      const k = `${f.rule}:${f.matched}`;
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(f);
    }
    for (const [k, list] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const [rule, matched] = k.split(":");
      L.push(`### ${rule} · \`${matched}\` (${list.length} 筆)`);
      for (const f of list.slice(0, 5)) {
        L.push(`- \`${f.file}\` · field: ${f.field} · ${f.snippet}`);
      }
      if (list.length > 5) L.push(`- ... 還有 ${list.length - 5} 筆`);
      L.push("");
    }
  }

  if (missingCredentials.length > 0) {
    L.push(`## ℹ️ 證號 body 缺失 (${missingCredentials.length}) — 頁面 footer 仍會自動補`);
    L.push("");
    for (const m of missingCredentials.slice(0, 30)) {
      const missing = [];
      if (!m.broker) missing.push("經紀人");
      if (!m.agent) missing.push("營業員");
      L.push(`- \`${m.file}\` body 缺: ${missing.join(", ")}`);
    }
    if (missingCredentials.length > 30) L.push(`- ... 還有 ${missingCredentials.length - 30} 筆`);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("## ⚠️ WARN 類的 false positive 提示");
  L.push("");
  L.push("1. **未完工建設（藍線／巨蛋／規劃中／即將／預計…）＝法規紅線，必修，沒有例外**（ERROR；要放行已通車的站名請改共用詞表，不要改 md）");
  L.push("2. **「議價空間」** 屬市場描述；教買方怎麼殺價才是紅線，需景泰裁決");
  L.push("3. **「洽詢」「聯絡人」** 若指管理室 / 物業，不是同事聯絡方式可忽略");
  L.push("4. ERROR 類（門牌 / 非白名單手機 / 經紀人非黃永隆 / 誇大 / 預測 / 內部用語 / 未完工建設 / 假第一人稱）一律要修，沒有例外");

  if (!existsSync(AUDIT_DIR)) await mkdir(AUDIT_DIR, { recursive: true });
  const reportPath = new URL(`audit-${today}.md`, AUDIT_DIR);
  await writeFile(reportPath, L.join("\n"), "utf-8");
  const jsonPath = new URL(`audit-${today}.json`, AUDIT_DIR);
  await writeFile(
    jsonPath,
    JSON.stringify(
      { scanned, errors, warns, missingCredentials, summary: { byRule, errorFiles: [...errorFiles] } },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`[audit-properties] scanned ${scanned} properties`);
  console.log(`  ERROR: ${errors.length} (${errorFiles.size} files)`);
  console.log(`  WARN:  ${warns.length}`);
  console.log(`  missing credentials in body: ${missingCredentials.length}`);
  console.log(`  report: ${reportPath.pathname}`);

  if (errors.length > 0) {
    // CI log 直接看得到是哪幾檔、哪條規則，不用再下載 artifact
    const perFile = new Map();
    for (const f of errors) {
      if (!perFile.has(f.file)) perFile.set(f.file, []);
      perFile.get(f.file).push(`${f.rule}「${f.matched}」`);
    }
    for (const [file, list] of perFile) {
      console.error(`  ✗ ${file}: ${[...new Set(list)].join("、")}`);
    }
    if (WARN_ONLY) {
      console.error(`[audit-properties] --warn-only：${errors.length} 筆 ERROR 未擋`);
    } else {
      console.error(`[audit-properties] ${errors.length} 筆 ERROR，擋 build（exit 1）`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
