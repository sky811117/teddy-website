#!/usr/bin/env node
/**
 * SEO Lint — 掃 posts frontmatter/正文 + pages/components 模板文字 + properties，找 SEO 不完整與紅線違規
 *
 * 檢查項目：
 * 1. title 必填、長度 10-65 字 (Google SERP 截斷)
 * 2. description 必填、長度 50-160 字 (Google meta description)
 * 3. tags 必填且非空陣列
 * 4. pubDatetime 必填 (posts)
 * 5. ogImage 有設或 dynamic OG 開啟 (warn only)
 * 6. 重複 title (警告)
 * 7. description 開頭不應為標點
 * 8. description / title 含廣告誇大形容詞 (警告)
 * 9. description 重複 (兩篇 description 內容完全相同、警告)
 * 10. tags 含「2026」這類年份標籤 (警告) — 之後 dated 會顯示老舊
 * 11. 編造的第一人稱客戶故事 (ERROR) — 景泰紅線，2026-06 清過 51 篇、2026-08 又復發 23 篇、2026-09 再抓 7 篇漏網
 * 12. 同業仲介品牌 (ERROR) — 不掛同業品牌
 * 13. 教議價 / 殺價 (ERROR) — 「議價空間」屬市場描述、不在此限；2026-09 起連「開價打 88%」「可砍 5-8%」這類數字句式也抓
 * 14. 「估價」二字 — 那是估價師法定業務，房仲寫「行情評估」。posts 為警告；pages/components 為 ERROR
 * 15. 經紀人／營業員證號揭露 (ERROR) — 已發布文章文末必須有
 * 16. 內文「本文更新於」但無 modDatetime (警告)；ogImage 不在 /og/ (警告)
 *     11-14 連 draft 也檢查（草稿之後會發布），draft 降級為 warning
 *
 * 掃描範圍（2026-09-06 擴充）：
 *   A. src/content/posts/**\/*.md|mdx — 全部規則
 *   B. src/pages/**\/*.astro、src/components/**\/*.astro、src/data/areas.ts
 *      — 只掃對外文字（frontmatter 字串常數 + 模板文字 + 屬性值），跳過 import 與註解。
 *        規則 11/12/13 為 ERROR、14「估價」為 ERROR、誇大詞為 WARNING。
 *   C. src/content/properties/*.md — title / highlights / description / body。
 *        ⚠️ 這批 md 每晚由 properties-sync 自動覆蓋產生，手改會被沖掉；同事物件標題帶「絕版/最強」
 *        不該擋整站部署，所以預設全部 WARNING（要升級擋 build 設環境變數 LINT_PROPERTIES_STRICT=1）。
 *        根治要在 sync 腳本加誇大詞 sanitizer。
 *
 * 逃生門（lintAllow）：
 *   - posts frontmatter：lintAllow: [fabrication|brand|negotiation|appraisal]
 *   - .astro / .ts：檔案內任一註解寫 `lintAllow: fabrication, appraisal`（逗號分隔）
 *   ⛔ 每加一次都要寫得出理由，這不是繞過紅線的方法。
 *
 * usage:
 *   node scripts/lint-seo.mjs
 *
 * exit code:
 *   0 = no errors (warnings OK)
 *   1 = has errors
 */
import { readdir, readFile, stat } from "node:fs/promises";

const POSTS_DIR = new URL("../src/content/posts/", import.meta.url);
const PROPERTIES_DIR = new URL("../src/content/properties/", import.meta.url);
const SOURCE_DIRS = [
  new URL("../src/pages/", import.meta.url),
  new URL("../src/components/", import.meta.url),
];
const SOURCE_FILES = [new URL("../src/data/areas.ts", import.meta.url)];
const PROPERTIES_STRICT = process.env.LINT_PROPERTIES_STRICT === "1";

function stripQuotes(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  let currentKey = null;
  let listValues = null;
  let scalarMultiline = null; // 累積多行 scalar value

  const lines = m[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 空行 → 重置 multi-line scalar
    if (line.trim() === "") {
      if (scalarMultiline !== null && currentKey) {
        meta[currentKey] = stripQuotes(scalarMultiline.trim());
        scalarMultiline = null;
      }
      continue;
    }

    // list item (- "value" 或 - value)，必須在某個 key 下
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && listValues !== null) {
      listValues.push(stripQuotes(listItem[1].trim()));
      continue;
    }

    // 新 key (key: value 或 key:)
    const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (km) {
      // 關閉前一個 list
      if (currentKey && listValues !== null) {
        meta[currentKey] = listValues;
        listValues = null;
      }
      // 關閉前一個 scalar multiline
      if (currentKey && scalarMultiline !== null) {
        meta[currentKey] = stripQuotes(scalarMultiline.trim());
        scalarMultiline = null;
      }
      currentKey = km[1];
      const v = km[2].trim();
      if (v === "") {
        // 後續可能是 list 或縮排 scalar
        listValues = [];
      } else {
        scalarMultiline = v; // 可能後續行還會續接
        listValues = null;
      }
      continue;
    }

    // 縮排續行 (多行 scalar value)
    const cont = line.match(/^\s+(.+)$/);
    if (cont && scalarMultiline !== null) {
      scalarMultiline += " " + cont[1].trim();
      continue;
    }

    // 縮排但前 key 是 list → 可能是 list 的縮排 item (- 開頭已處理)
    // 其他情況忽略
  }

  // 收尾
  if (currentKey) {
    if (listValues !== null) meta[currentKey] = listValues;
    else if (scalarMultiline !== null) meta[currentKey] = stripQuotes(scalarMultiline.trim());
  }

  return { meta, body: m[2] };
}

async function listFiles(dir, exts) {
  const files = [];
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const item of items) {
    if (item.name.startsWith("_")) continue;
    if (item.isDirectory()) {
      const sub = await listFiles(new URL(`${item.name}/`, dir), exts);
      files.push(...sub.map(f => `${item.name}/${f}`));
    } else if (exts.some(e => item.name.endsWith(e))) {
      files.push(item.name);
    }
  }
  return files;
}

const listMdFiles = dir => listFiles(dir, [".md", ".mdx"]);

/**
 * 紅線檢查要掃的全部對外文字 = 標題 + 描述 + 正文 + frontmatter 的 faqSchema。
 *
 * 為什麼要含 faqSchema：2026-08-28 查核發現站上 30 篇寫了 faqSchema，裡面藏著
 * 「議價建議」「最強保護」這類踩紅線的字，而原本的檢查只掃 title/description/body，
 * 完全掃不到。那段 JSON 是對外文字（會被爬蟲讀），一樣要受規範。
 *
 * faqSchema 在 frontmatter 是巢狀 YAML，parseFrontmatter 只回純量，
 * 所以這裡直接從原始 frontmatter 文字把那一段切出來當純文字掃。
 */
function scanText(meta, body, rawFrontmatter) {
  // 直接把整份 frontmatter 一起掃。
  // ⛔ 原本想用正規表示式只切出 faqSchema 那一段，但 /m 旗標下的 $ 會匹配到
  //    「faqSchema:」那一行的行尾，結果只切到 10 個字、等於沒掃。
  //    整份 frontmatter 都是對外文字（title/description 本來就在裡面），全掃最保險。
  return [meta.title || "", meta.description || "", rawFrontmatter || "", body || ""].join("\n");
}

/* ------------------------------------------------------------------ */
/* .astro / .ts 對外文字抽取                                            */
/* ------------------------------------------------------------------ */

// 去掉 TS/JS 註解：/* … */ 整段、以及 // 到行尾（前面不能是 ":"，避免吃掉 https://）
function stripTsComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, "$1");
}

// 抽出所有字串字面值（" ' `），跳過 import 行。模板字串內的 ${…} 保留原樣（只是字）。
function extractTsStrings(s) {
  s = stripTsComments(s).replace(/^\s*import\s[^\n]*$/gm, "");
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out.join("\n");
}

// 模板段：去 script/style/註解、去 placeholder 屬性（「陳先生 / 王小姐」這種表單示範不是故事），
// 再把標籤剝掉留文字；另外把模板裡的字串字面值（屬性值、{"…"}）也一併抽出。
function extractTemplateText(tpl) {
  // ⚠️ 自閉合的 <script … /> 要先拿掉，不然 <script[\s\S]*?</script> 會從第一個
  //    自閉合 script 一路吃到檔尾唯一的 </script>，整頁文字都被吞掉（index.astro 實測 37,884 → 41 字）
  // <script> 內的字串字面值是會顯示給使用者的 UI 文字（表單錯誤訊息、toast），一樣要掃
  const scriptStrings = [];
  let t = tpl
    .replace(/<script\b[^>]*\/>/gi, " ")
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, inner) => {
      scriptStrings.push(extractTsStrings(inner));
      return " ";
    })
    .replace(/<style\b[^>]*\/>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\bplaceholder=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, " ");
  const text = t.replace(/<[^>]+>/g, " ");
  return text + "\n" + extractTsStrings(t) + "\n" + scriptStrings.join("\n");
}

function extractSourceText(file, src) {
  if (file.endsWith(".astro")) {
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (m) return extractTsStrings(m[1]) + "\n" + extractTemplateText(m[2]);
    return extractTemplateText(src);
  }
  return extractTsStrings(src);
}

// .astro / .ts 的逃生門：檔案內任一註解寫 `lintAllow: fabrication, appraisal`
function sourceLintAllow(src) {
  const m = src.match(/lintAllow:\s*\[?\s*([a-z][a-z,\s]*)\]?/);
  if (!m) return [];
  return m[1].split(/[\s,]+/).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* 紅線規則（posts / pages / properties 共用）                          */
/* ------------------------------------------------------------------ */

// 編造第一人稱客戶故事的樣態。
// 第 1 條：時間詞後方 15 字內要出現人物、再接「找我 / 問我 / 來找…」才算，
// 避免誤殺「去年 11 月開徵地價稅」「台中 3 月反彈 70%，代表買方蜂擁而至」這種純市場敘述
// （2026-09-05 查核：結尾若只放單獨的「來」會誤殺 W02 移轉量那篇，所以改成「來找/來看/來問」）。
const FABRICATION_PATTERNS = [
  { re: /(?:上週|上個月|前陣子|前幾天|昨天|去年|前一陣子)[^。\n]{0,12}(?:客戶|屋主|買方|夫妻|小姐|先生|太太)/, label: "時間+人物" },
  {
    re: /(?:上週|上個月|前陣子|前幾天|昨天|去年|前一陣子|最近|兩個月前|三個月前|幾個月前|上季|年初|月初|上上週|\d\s?月)[^。\n]{0,15}(?:客戶|客人|買方|屋主|媽媽|爸爸|姐姐|先生|小姐|太太|夫妻|家庭|工程師)[^。\n]{0,10}(?:找我|問我|來找|來看|來問|來簽)/,
    label: "時間+人物+找我",
  },
  { re: /我(?:有|的)一?位?客戶/, label: "我的客戶" },
  { re: /客戶(?:問|跟|傳訊息問|LINE)我/, label: "客戶問我" },
  { re: /我幫(?:客戶|她|他)(?!你)/, label: "我幫客戶" },
  { re: /我帶[^。\n]{0,4}客戶/, label: "我帶客戶" },
  // 「歡迎來找我聊」「再來找我」「找我看房」是 CTA，不是故事；只抓敘事用法
  { re: /(?<!歡迎來|歡迎|再來|可以來|隨時|都可以來)找我(?:看(?!房)|簽約)/, label: "找我看" },
  // 「找我聊/談」只在前面有人物（客戶/屋主/先生…）時才算敘事；「找我談換屋」這種按鈕字是 CTA
  { re: /(?:客戶|客人|買方|屋主|夫妻|先生|小姐|太太|媽媽|爸爸|姐姐|朋友|同事)[^。\n]{0,12}找我(?:聊|談)/, label: "人物+找我聊" },
  { re: /我帶(?:她|他|他們|她們)(?:去|進|看)/, label: "我帶她去看" },
  { re: /(?:她|他)(?:跟我說|問我)/, label: "她跟我說" },
  { re: /我(?:有|帶|帶了|接到)\s*\d+\s*組/, label: "我有 N 組客戶" },
  { re: /(?:客戶|他們|她們)(?:反饋|回饋|最後選了)/, label: "客戶反饋" },
  // 「去年同期」本身是市場統計常用語（有來源可用）；只抓拿來包裝個人數據的寫法
  //  例「平均看 7-8 次才下訂（去年同期 4-5 次）」「我的成交…去年同期」
  { re: /去年同期\s*\d[\d\-~－]*\s*(?:次|組)|我[^。\n]{0,12}去年同期/, label: "個人數據 vs 去年同期" },
  { re: /我(?:看過|經手|帶看|帶過|接過)[^。\n]{0,8}(?:幾戶|幾筆|幾組|客人|客戶)/, label: "我看過幾戶" },
  { re: /<!--\s*景泰補/, label: "景泰補待填備註（AI 模板殘留，會外洩到 HTML）" },
  { re: /屋主(?:跟|對)我說/, label: "屋主跟我說" },
  { re: /一對[^。\n]{0,3}夫妻/, label: "一對夫妻" },
  { re: /真實案例/, label: "標榜真實案例" },
  { re: /我(?:自己)?(?:在|去)?[^。]{0,10}帶看(?:的)?經驗/, label: "帶看資歷" },
  { re: /「景泰[，,]/, label: "客戶直呼景泰" },
  { re: /(?:陳|林|王|李|張|黃|吳|劉|蔡|楊)(?:小姐|先生|太太|屋主)/, label: "虛構人名" },
];

// 同業仲介品牌（591 / 樂屋網 / 5168 / 樂居 是刊登與實價平台，不在此列）
// 引用語境 — 出現這些字代表是把同業當市場數據來源，屬景泰裁決 B 的允許範圍
const CITATION_MARKERS = [
  "資料來源", "數據來源", "來源：", "來源:", "根據", "統計", "調查",
  "房價指數", "指數", "市調", "發布", "報告", "前瞻", "集團", "研究", "引用",
];

const COMPETITOR_BRANDS = [
  "信義房屋", "永慶房屋", "永慶房產", "住商不動產", "東森房屋",
  "台灣房屋", "中信房屋", "21世紀不動產", "太平洋房屋",
];

// 教議價／殺價的用詞（「議價空間」是市場描述、刻意不列入）
// 只抓「真的在教讀者怎麼壓價」的用法。
// 刻意不抓的（都是描述，不是教學）：
//   「議價空間 / 殺價空間 5-8%」= 市場行情與定價策略描述
//   「不是行銷話術」「建商廣告話術」= 在否定或指涉別人
//   「買方會殺價」「結果不是買方殺價」= 描述市場行為
const NEGOTIATION_COACHING = [
  "殺價要", "殺價可以", "可以殺到", "能殺到", "再殺", "多殺",
  "壓價", "再壓", "怎麼開口談", "談判心理", "留尾數", "哀兵",
  "給賣方台階", "給屋主台階", "對話骨架", "砍仲介費", "議價話術", "殺價話術",
  // 2026-08-28 查核補：faq-23 有整張「建議價 / 下到 920」的出價指導表、
  // faq-23 的 faqSchema 寫「提供議價建議」、faq-25 寫「要不要再壓」，
  // 原本的清單一個都沒抓到。
  "議價建議", "議價策略", "建議價", "可以下多少",
];

// 2026-09-05 查核補：「開價打 88% 以下對方還是會談」「同社區同樓層可砍 5-8%」
// 「預算上限往下抓 90%」這種直接給買方出價比例的數字句式，固定字串抓不到。
// 「砍 N%」要有價格語境（把價砍 / 直接砍 / 可以砍），避免誤殺「使照件數砍 40%」這種市場統計。
const NEGOTIATION_COACHING_RE = [
  { re: /開價打\s?\d{2}\s?%/, label: "開價打 N%" },
  { re: /可砍\s?\d/, label: "可砍 N" },
  { re: /(?:價|出價|開價|總價|可以|直接|再|先|就|要)\s?砍\s?\d{1,2}\s?[-~至]?\s?\d{0,2}\s?%/, label: "砍 N%" },
  { re: /往下抓\s?\d{2}\s?%/, label: "往下抓 N%" },
  { re: /\d\.\d\s?折(?![舊扣抵])/, label: "X.X 折" },
];

const EXAGGERATED_TERMS = [
  "絕版", "最強", "全市場最低", "全市最低",
  "保證漲", "必漲", "穩賺",
  "頂級豪宅", "完美無缺",
  "千載難逢", "百年難得", "空前絕後", "前無古人",
  "無敵", "無可挑剔",
  // 2026-09-05 物件頁查核補：同事物件標題常見的廣告詞（H1/JSON-LD 都會帶出去）
  "賠售", "最俗", "全棟最便宜", "全社區最便宜", "社區最低價",
];

/**
 * 對一段對外文字跑紅線規則 11-14 + 誇大詞。
 * severity: { fabrication, brand, negotiation, appraisal, exaggerated } 各為 "error" | "warning" | "off"
 * 回傳 { errors: [msg], warnings: [msg] }
 */
function redlineChecks(whole, allow, severity) {
  const errors = [];
  const warnings = [];
  const push = (level, msg) => {
    if (level === "error") errors.push(msg);
    else if (level === "warning") warnings.push(msg);
  };

  // 11. 編造的第一人稱客戶故事
  if (!allow("fabrication") && severity.fabrication !== "off") {
    const hits = [];
    for (const { re, label } of FABRICATION_PATTERNS) {
      const m = whole.match(re);
      if (m) hits.push(`${label}「${m[0].slice(0, 24)}」`);
    }
    if (hits.length > 0) {
      push(severity.fabrication, `疑似編造的第一人稱客戶故事: ${hits.join("、")} — 景泰 2025-03 才轉房仲，此類敘述須為真實經歷，否則改中性寫法或明標「假設情境」`);
    }
  }

  // 12. 同業仲介品牌
  if (!allow("brand") && severity.brand !== "off") {
    for (const brand of COMPETITOR_BRANDS) {
      let idx = whole.indexOf(brand);
      while (idx !== -1) {
        // 景泰 2026-08-27 裁決 B：把同業當「市場數據來源」引用可以留，
        // 只有「比較優劣 / 幫對手曝光」才算違規。
        // 判斷法：看前後 30 字有沒有引用語境的字眼。
        const ctx = whole.slice(Math.max(0, idx - 30), idx + brand.length + 30);
        // 出處連結 [永慶房屋](https://…) 也算引用
        const linkCtx = whole.slice(Math.max(0, idx - 60), idx + brand.length + 120);
        const isSourceLink = linkCtx.includes("[") && linkCtx.includes("](http");
        const isCitation = isSourceLink || CITATION_MARKERS.some(k => ctx.includes(k));
        if (isCitation) { idx = whole.indexOf(brand, idx + 1); continue; }
        push(severity.brand, `同業品牌: 含「${brand}」且不在引用語境 — 引用市場數據可以留，比較優劣／幫對手曝光不行。前後文：…${ctx.trim().slice(0, 50)}…`);
        break;
      }
    }
  }

  // 13. 教議價 / 殺價 — 描述市場的「議價空間」不算
  if (!allow("negotiation") && severity.negotiation !== "off") {
    for (const term of NEGOTIATION_COACHING) {
      if (whole.includes(term)) {
        push(severity.negotiation, `教議價: 含「${term}」— 不教議價/殺價/跟仲介鬥智（單純描述市場的「議價空間」不在此限）`);
      }
    }
    for (const { re, label } of NEGOTIATION_COACHING_RE) {
      const m = whole.match(re);
      if (m) {
        push(severity.negotiation, `教議價: ${label}「${m[0]}」— 直接給買方出價比例/折數就是教砍價，改成「實價登錄顯示成交價與開價落差常見 X%」這種市場描述`);
      }
    }
  }

  // 14. 「估價」是不動產估價師的法定專屬業務，對外文字改「行情評估」
  if (!allow("appraisal") && severity.appraisal !== "off") {
    // 排除別的主體的行為或機構全名：銀行估價 / 銀行依物件估價 / 估價單 / 估價師
    const stripped = whole
      .replace(/銀行(?:依[^，。\n]{0,6})?(?:派)?(?:估|鑑)價/g, "")
      .replace(/估價師/g, "")
      .replace(/估價單/g, "");
    if (stripped.includes("估價")) {
      const idx = stripped.indexOf("估價");
      push(severity.appraisal, `用詞: 含「估價」— 那是不動產估價師的法定專屬業務，房仲對外請寫「行情評估」。前後文：…${stripped.slice(Math.max(0, idx - 15), idx + 17).replace(/\s+/g, " ")}…`);
    }
  }

  // 8. 廣告誇大形容詞（否定用法放行：「不是哪一個平台最強」是在破除迷思）
  if (severity.exaggerated !== "off") {
    for (const term of EXAGGERATED_TERMS) {
      let idx = whole.indexOf(term);
      while (idx !== -1) {
        const before = whole.slice(Math.max(0, idx - 10), idx);
        const negated = /不是|並非|沒有|不見得|未必/.test(before);
        if (!negated) {
          push(severity.exaggerated, `廣告誇大: 含「${term}」(房仲業違反公平交易法 21 條風險)。前文：…${whole
            .slice(Math.max(0, idx - 18), idx + term.length + 12)
            .replace(/\s+/g, " ")}…`);
          break;
        }
        idx = whole.indexOf(term, idx + 1);
      }
    }
  }

  return { errors, warnings };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function lintPosts(errors, warnings) {
  const files = await listMdFiles(POSTS_DIR);
  const titleMap = new Map();
  const descMap = new Map();
  let scanned = 0;

  for (const f of files) {
    const text = await readFile(new URL(f, POSTS_DIR), "utf-8");
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      errors.push({ file: f, msg: "frontmatter parse failed" });
      continue;
    }
    const { meta, body } = parsed;
    const rawFm = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
    scanned++;

    // 例外機制：frontmatter 寫 lintAllow: [fabrication|brand|negotiation|appraisal]
    // 就跳過該條檢查。用途是「文章本身在討論這些東西、必須引用原句」，
    // 例如檢討 AI 編造客戶故事的那篇，內文一定會引用假故事當證據。
    // ⛔ 這是逃生門，不是繞過紅線的方法 —— 每加一次都要寫得出理由。
    const lintAllow = Array.isArray(meta.lintAllow)
      ? meta.lintAllow
      : (meta.lintAllow ? [meta.lintAllow] : []);
    const allow = k => lintAllow.includes(k);
    const isDraft = meta.draft === "true" || meta.draft === true;

    // 11-14：draft 也要檢查（草稿之後會被發布，等到發布才擋就太晚了），只是降級成 warning。
    // 8（誇大詞）維持只掃已發布文章。
    const whole = scanText(meta, body, rawFm);
    const level = isDraft ? "warning" : "error";
    const r = redlineChecks(whole, allow, {
      fabrication: level,
      brand: level,
      negotiation: level,
      appraisal: "warning",
      exaggerated: isDraft ? "off" : "warning",
    });
    for (const msg of r.errors) errors.push({ file: f, msg });
    for (const msg of r.warnings) warnings.push({ file: f, msg });

    // draft post 之後的 SEO meta 檢查跳過
    if (isDraft) continue;

    // 1. title
    if (!meta.title) {
      errors.push({ file: f, msg: "缺 title" });
    } else {
      const len = meta.title.length;
      if (len < 10) {
        warnings.push({ file: f, msg: `title 太短 (${len} 字、建議 ≥10)` });
      } else if (len > 65) {
        warnings.push({ file: f, msg: `title 太長 (${len} 字、Google SERP 會截斷 ~65)` });
      }
      // dedup title check
      if (titleMap.has(meta.title)) {
        warnings.push({
          file: f,
          msg: `title 重複：與 ${titleMap.get(meta.title)} 相同`,
        });
      } else {
        titleMap.set(meta.title, f);
      }
    }

    // 2. description
    if (!meta.description) {
      errors.push({ file: f, msg: "缺 description (Google SERP 會撈隨機段落)" });
    } else {
      const dlen = meta.description.length;
      if (dlen < 50) {
        warnings.push({ file: f, msg: `description 太短 (${dlen} 字、建議 ≥50)` });
      } else if (dlen > 160) {
        warnings.push({ file: f, msg: `description 太長 (${dlen} 字、會截斷 ~160)` });
      }
      // 開頭不應為標點
      const firstChar = meta.description[0];
      if (/[、。，！？!?,\.;:]/.test(firstChar)) {
        warnings.push({ file: f, msg: `description 開頭是標點 "${firstChar}"` });
      }
      // description 重複檢測
      if (descMap.has(meta.description)) {
        warnings.push({
          file: f,
          msg: `description 重複：與 ${descMap.get(meta.description)} 相同`,
        });
      } else {
        descMap.set(meta.description, f);
      }
    }

    // 3. tags
    if (!meta.tags || (Array.isArray(meta.tags) && meta.tags.length === 0)) {
      warnings.push({ file: f, msg: "缺 tags (影響 /tags 聚合)" });
    } else if (Array.isArray(meta.tags) && meta.tags.includes("others")) {
      warnings.push({ file: f, msg: "tags 含 'others' 預設值 (建議用實際主題標籤)" });
    }

    // 4. pubDatetime
    if (!meta.pubDatetime) {
      errors.push({ file: f, msg: "缺 pubDatetime" });
    }

    // 15. 經紀人／營業員證號揭露
    // 2026-08-28 全站盤點發現 182 篇已發布文章有 74 篇沒有這段。法規要求揭露的是
    // 「廣告」，純知識文嚴格說不算，但文章底下有 LINE 與在售物件連結、界線本來就
    // 模糊，而且房地產與稅務屬 YMYL 內容，作者專業資格也是搜尋引擎的可信度訊號。
    // 景泰 2026-08-28 裁決一律補上，這條就是防止之後新文章又漏掉。
    if (!/黃永隆|彰縣字|登字第?\s*488296/.test(body || "")) {
      errors.push({
        file: f,
        msg: "缺經紀人／營業員證號揭露段落（文末應有「經紀人黃永隆 113 彰縣字第 324 號 / 營業員陳景泰 114 登字第 488296 號」）",
      });
    }

    // 5. ogImage (warn only — dynamic OG 開啟時 fallback OK)
    if (!meta.ogImage) {
      warnings.push({ file: f, msg: "缺 ogImage (走 dynamic OG fallback)" });
    } else if (!String(meta.ogImage).startsWith("/og/")) {
      // 2026-09-05 查核：一篇指到 /covers/ 的 1.1MB PNG，ogThumb() 只處理 /og/ 路徑，
      // 列表縮圖與 LINE/FB 預覽都會吃整張大圖。供文管線請一律產到 /og/。
      warnings.push({ file: f, msg: `ogImage 不在 /og/ 底下 (${meta.ogImage})：縮圖管線只處理 /og/，請轉成 /og/<slug>.jpg` });
    }

    // 16. 內文寫了「本文更新於」但 frontmatter 沒 modDatetime → Google 看不到 dateModified、頁面也不顯示「更新於」
    if (/本文更新於/.test(body || "") && !meta.modDatetime) {
      warnings.push({ file: f, msg: "內文有「本文更新於」但缺 modDatetime：請補 frontmatter modDatetime，否則 JSON-LD 不會有 dateModified" });
    }
  }
  return scanned;
}

// B. pages / components / data — 對外文字抽出後跑 11-14 + 誇大詞
async function lintSources(errors, warnings) {
  const targets = [];
  for (const dir of SOURCE_DIRS) {
    const files = await listFiles(dir, [".astro"]);
    for (const f of files) targets.push({ label: `${dir.pathname.replace(/^.*\/src\//, "src/")}${f}`, url: new URL(f, dir) });
  }
  for (const url of SOURCE_FILES) {
    try {
      await stat(url);
      targets.push({ label: url.pathname.replace(/^.*\/src\//, "src/"), url });
    } catch {
      // 檔案不存在就略過
    }
  }

  let scanned = 0;
  for (const { label, url } of targets) {
    const src = await readFile(url, "utf-8");
    scanned++;
    const allowList = sourceLintAllow(src);
    const allow = k => allowList.includes(k);
    const whole = extractSourceText(label, src);
    const r = redlineChecks(whole, allow, {
      fabrication: "error",
      brand: "error",
      negotiation: "error",
      appraisal: "error", // 對外頁面用「估價」是法規紅線，pages/components 直接擋
      exaggerated: "warning",
    });
    for (const msg of r.errors) errors.push({ file: label, msg });
    for (const msg of r.warnings) warnings.push({ file: label, msg });
  }
  return scanned;
}

// C. properties — 每晚自動產生，預設只警告（LINT_PROPERTIES_STRICT=1 才擋）
async function lintProperties(errors, warnings) {
  const files = await listMdFiles(PROPERTIES_DIR);
  const level = PROPERTIES_STRICT ? "error" : "warning";
  let scanned = 0;
  for (const f of files) {
    const text = await readFile(new URL(f, PROPERTIES_DIR), "utf-8");
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      warnings.push({ file: `properties/${f}`, msg: "frontmatter parse failed" });
      continue;
    }
    scanned++;
    const { meta, body } = parsed;
    const highlights = Array.isArray(meta.highlights) ? meta.highlights.join("\n") : "";
    const whole = [meta.title || "", highlights, meta.description || "", body || ""].join("\n");
    const r = redlineChecks(whole, () => false, {
      fabrication: level,
      brand: level,
      negotiation: level,
      appraisal: level,
      exaggerated: level,
    });
    for (const msg of r.errors) errors.push({ file: `properties/${f}`, msg });
    for (const msg of r.warnings) warnings.push({ file: `properties/${f}`, msg });
  }
  return scanned;
}

async function main() {
  const errors = [];
  const warnings = [];

  const postsScanned = await lintPosts(errors, warnings);
  const sourcesScanned = await lintSources(errors, warnings);
  const propsScanned = await lintProperties(errors, warnings);

  // 輸出
  console.log(`# SEO Lint Report`);
  console.log(``);
  console.log(`掃描 **${postsScanned}** 篇 posts .md、**${sourcesScanned}** 個 pages/components/data 檔、**${propsScanned}** 筆 properties${PROPERTIES_STRICT ? "（strict）" : "（只警告）"}`);
  console.log(`- 🔴 ERROR:   ${errors.length}`);
  console.log(`- 🟡 WARNING: ${warnings.length}`);
  console.log(``);

  if (errors.length > 0) {
    console.log(`## 🔴 ERROR (${errors.length})`);
    for (const e of errors.slice(0, 40)) {
      console.log(`- \`${e.file}\` · ${e.msg}`);
    }
    if (errors.length > 40) console.log(`- ... 還有 ${errors.length - 40} 筆`);
    console.log(``);
  }

  if (warnings.length > 0) {
    // 分類 warn
    const groupedWarn = {};
    for (const w of warnings) {
      // 萃取 msg 前綴當分類
      const cat = w.msg.match(/^(title|description|tags|ogImage|pubDatetime|缺 [a-zA-Z]+|用詞|廣告誇大|教議價|同業品牌|疑似編造)/)?.[0] || w.msg;
      if (!groupedWarn[cat]) groupedWarn[cat] = [];
      groupedWarn[cat].push(w);
    }
    const sortedCats = Object.entries(groupedWarn).sort((a, b) => b[1].length - a[1].length);
    console.log(`## 🟡 WARNING (${warnings.length})`);
    for (const [cat, list] of sortedCats) {
      console.log(`### ${cat} (${list.length})`);
      for (const w of list.slice(0, 10)) {
        console.log(`- \`${w.file}\` · ${w.msg}`);
      }
      if (list.length > 10) console.log(`- ... 還有 ${list.length - 10} 筆`);
      console.log(``);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✅ 所有文章 SEO meta 完整、無 lint 違規`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
