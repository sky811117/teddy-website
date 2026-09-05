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
 *   WARN（只列出，不擋）
 *     - 第三人聯絡引導（營業員：/ LINE ID：/ 洽詢 / 聯絡人）
 *     - 預售敏感詞（預售 / 即將完工 / 代銷 …）— 需人工確認是不是在替建案打廣告
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
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const PROPERTIES_DIR = new URL("../src/content/properties/", import.meta.url);
const AUDIT_DIR = new URL("../audit/", import.meta.url);
const WARN_ONLY = process.argv.includes("--warn-only");

// ============ 共用詞表（B4 渲染層 / B5 audit / B6 產生腳本 三處一致） ============

// 誇大詞 EXAGGERATED
export const EXAGGERATED_RE =
  /絕版|最強|最低價|社區最低|全市場最低|稀有|賠售|急售|割愛|獨家|最便宜|最俗|最美|最愛|唯一|首選|超低|珍稀|限量|破盤|無敵|不敗|穩賺|必漲|保證漲|超值|買到賺到|錯過不再/g;

// 漲跌預測 PREDICTION
export const PREDICTION_RE =
  /增值潛力|價值翻倍|翻倍|看漲|保值|抗跌|起漲點|起漲|會漲|保證增值|投報率高達|增值(?!稅)|上漲|價格可期|潛力看好|漲幅/g;

// 第三人聯絡 CONTACT（手機另外用 PHONE_RE + 白名單）
export const CONTACT_RE = /經紀人[:：]|營業員[:：]|LINE\s*(?:ID)?[:：]|洽詢|聯絡人/g;

// 手機 + 白名單
export const PHONE_RE = /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g;
const PHONE_WHITELIST = [/^0920[-\s]?118[-\s]?756$/];
const STORE_PHONE_RE = /04[-\s]?2312[-\s]?0888/g; // 店電，不算違規

// 內部用語 INTERNAL
export const INTERNAL_RE = /專任|本店專任|委編|UG\d+|UA\d+/g;

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
const PRESALE_RE = /預售|即將完工|代銷|建設公司新案|新建案/g;
const NEGOTIATION_RE = /議價|殺價|砍價/g;

// 證號揭露
const BROKER_RE = /113\s*彰縣\s*字?\s*324/;
const AGENT_RE = /114\s*登\s*字?\s*488296/;

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

function scanField(name, value, findings, file) {
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

  // WARN：第三人聯絡引導（「經紀人：黃永隆」正常頁尾也會命中，所以只 WARN；
  // 真正的問題 — 電話、非黃永隆的經紀人 — 上面已經 ERROR）
  pushAll(findings, file, name, value, CONTACT_RE, "WARN", "第三人聯絡引導", m =>
    !/^經紀人/.test(m[0]) && !/^營業員/.test(m[0])
  );
  // WARN：預售敏感詞 / 議價
  pushAll(findings, file, name, value, PRESALE_RE, "WARN", "預售敏感詞");
  pushAll(findings, file, name, value, NEGOTIATION_RE, "WARN", "議價用語");
}

async function main() {
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

    scanField("title", meta.title, findings, file);
    scanField("streetArea", meta.streetArea, findings, file);
    scanField("community", meta.community, findings, file);
    scanField("description", meta.description, findings, file);
    scanField("highlights", extractHighlights(rawFm), findings, file);
    // body 結尾的 `> 委編：UG1234567` 是產生腳本固定加的物件編號 footer（每一筆都有），
    // 先剝掉再掃，否則 INTERNAL 規則會把 382 筆全擋掉。footer 以外任何地方出現
    // 「委編 / UG… / UA…」照樣 ERROR。（待辦：產生腳本改成「物件編號」後可拿掉這行豁免）
    const bodyForScan = body.replace(/^>\s*委編[:：].*$/gm, "");
    scanField("body", bodyForScan, findings, file);

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
  L.push("1. **「即將完工」** 若指周邊建設（例：漢神百貨即將完工）不是預售自家物件可忽略");
  L.push("2. **「議價空間」** 屬市場描述；教買方怎麼殺價才是紅線，需景泰裁決");
  L.push("3. **「洽詢」「聯絡人」** 若指管理室 / 物業，不是同事聯絡方式可忽略");
  L.push("4. ERROR 類（門牌 / 非白名單手機 / 經紀人非黃永隆 / 誇大 / 預測 / 內部用語）一律要修，沒有例外");

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
