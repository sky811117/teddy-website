#!/usr/bin/env node
/**
 * 物件法規合規掃描
 *
 * 掃描 src/content/properties/*.md，輸出違規清單。
 *
 * 掃描項目：
 * 1. 完整門牌違規 — title/streetArea/community/description 含「巷X弄X號」「X巷X號」「X號之X」
 * 2. 屋主隱私違規 — 含手機格式 (09xx)、屋主姓名「X 先生/太太/小姐」
 * 3. 誇大形容詞違規 — 14 個絕對形容詞 (最強/絕版/全市場/保證漲...)
 * 4. 證號揭露 — 物件詳細頁渲染時自動加 footer (含 frontmatter brokerLicense/agentLicense)，
 *    所以這個檢查只看 markdown body 內容；body 沒寫不算違規 (頁面 OK)，但寫了不一致才算
 * 5. 預售建案名 — 含「預售」「即將完工」「待售案」字眼 (寬鬆判斷，需人工確認)
 *
 * 輸出：
 * - JSON 到 stdout
 * - 簡報 markdown 到 audit/audit-{date}.md
 * - TG 推播摘要
 *
 * usage:
 *   node scripts/audit-properties.mjs
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PROPERTIES_DIR = new URL("../src/content/properties/", import.meta.url);
const AUDIT_DIR = new URL("../audit/", import.meta.url);

// ============ 規則 ============

// 1. 完整門牌 — 巷弄號（"X巷"/"X弄"/"X號"）
//    寬鬆：只要含「巷」+「號」、或「弄」+「號」就算
//    例外：「樓層」常寫「X樓 之 X」不要誤報
const ADDR_PATTERNS = [
  /\d+\s*巷\s*\d+\s*弄\s*\d+\s*號/, // 完整門牌「76巷29弄9號」
  /\d+\s*巷\s*\d+\s*號(?!之)/,        // 「76巷9號」(避免「9號之2」誤判樓層)
  /\d+\s*弄\s*\d+\s*號/,              // 「29弄9號」
  /路\s*\d+\s*號\b/,                  // 「文心路123號」
  /街\s*\d+\s*號\b/,                  // 「中正街45號」
  /大道\s*\d+\s*號/,                  // 「環中東路一段123號」之類太寬鬆，先不加
];

// 2. 屋主隱私
// 景泰本人電話白名單 (他自己當聯絡人不算違規)
const TEDDY_PHONE = /09\s*20\s*[-\s]?\s*118\s*[-\s]?\s*756/;
const PRIVACY_PATTERNS = [
  { name: "手機號碼", re: /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/, whitelist: TEDDY_PHONE },
  { name: "屋主稱謂", re: /屋主[\s]?[一-鿿][\s]?(先生|太太|小姐|女士)/ },
  { name: "屋主姓氏", re: /([一-鿿])\s*(先生|太太|小姐|女士)\s*[售賣委]/ },
  { name: "身分證", re: /[A-Z][12]\d{8}/ },
];

// 3. 誇大形容詞 — 來自 CLAUDE.md「IG 圖卡發文鐵則」+ NCC/公平會廣告法
const EXAGGERATED_TERMS = [
  "絕版", "最強", "全市場最低", "全市最低",
  "保證漲", "必漲", "穩賺",
  "唯一", "第一", "獨家",
  "頂級豪宅",          // 法規敏感 — 「豪宅」一詞有定義
  "完美無缺",
  "千載難逢", "百年難得", "空前絕後",
  "前無古人",
  "無敵", "無可挑剔",
];

// 4. 證號揭露
const BROKER_RE = /113\s*彰縣\s*字?\s*324/;
const AGENT_RE = /114\s*登\s*字?\s*488296/;

// 5. 預售建案敏感詞
const PRESALE_TERMS = [
  "預售", "即將完工", "代銷", "建設公司新案", "新建案",
];

// ============ 掃描 ============

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const km = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (km) {
      let v = km[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      meta[km[1]] = v;
    }
  }
  return { meta, body: m[2] };
}

function scanField(name, value, findings, file) {
  if (!value) return;
  // 1. 完整門牌
  for (const re of ADDR_PATTERNS) {
    const m = value.match(re);
    if (m) {
      findings.push({
        file,
        severity: "HIGH",
        rule: "完整門牌",
        field: name,
        matched: m[0],
        snippet: value.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20),
      });
    }
  }
  // 2. 屋主隱私 (有 whitelist 的先過濾，用 matchAll 抓 field 內所有手機)
  for (const { name: rname, re, whitelist } of PRIVACY_PATTERNS) {
    const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of value.matchAll(globalRe)) {
      if (whitelist && whitelist.test(m[0])) continue;
      findings.push({
        file,
        severity: "HIGH",
        rule: `隱私: ${rname}`,
        field: name,
        matched: m[0],
        snippet: value.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20),
      });
    }
  }
  // 3. 誇大形容詞
  for (const term of EXAGGERATED_TERMS) {
    const idx = value.indexOf(term);
    if (idx >= 0) {
      findings.push({
        file,
        severity: "MEDIUM",
        rule: "廣告誇大",
        field: name,
        matched: term,
        snippet: value.slice(Math.max(0, idx - 20), idx + term.length + 20),
      });
    }
  }
  // 5. 預售建案
  for (const term of PRESALE_TERMS) {
    const idx = value.indexOf(term);
    if (idx >= 0) {
      findings.push({
        file,
        severity: "MEDIUM",
        rule: "預售敏感詞",
        field: name,
        matched: term,
        snippet: value.slice(Math.max(0, idx - 20), idx + term.length + 20),
      });
    }
  }
}

async function main() {
  const files = (await readdir(PROPERTIES_DIR))
    .filter(f => f.endsWith(".md"))
    .sort();

  const findings = [];
  const missingCredentials = [];
  let scanned = 0;

  for (const file of files) {
    const text = await readFile(new URL(file, PROPERTIES_DIR), "utf-8");
    const { meta, body } = frontmatter(text);
    scanned++;

    // 掃描 frontmatter 文字欄位
    scanField("title", meta.title, findings, file);
    scanField("streetArea", meta.streetArea, findings, file);
    scanField("community", meta.community, findings, file);
    scanField("description", meta.description, findings, file);
    scanField("highlights", meta.highlights, findings, file);
    scanField("body", body, findings, file);

    // 4. 證號揭露
    const hasBroker = BROKER_RE.test(body);
    const hasAgent = AGENT_RE.test(body);
    if (!hasBroker || !hasAgent) {
      missingCredentials.push({
        file,
        broker: hasBroker,
        agent: hasAgent,
        listingCode: meta.listingCode,
      });
    }
  }

  // Dedup：同 file + 同 rule + 同 matched 只算 1 筆
  // (例：手機號碼可能同時出現在 highlights / description / body 三個欄位)
  const seen = new Set();
  const dedupedFindings = [];
  for (const f of findings) {
    const key = `${f.file}::${f.rule}::${f.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedFindings.push(f);
  }
  findings.length = 0;
  findings.push(...dedupedFindings);

  // 統計
  const byRule = {};
  const bySeverity = { HIGH: 0, MEDIUM: 0 };
  for (const f of findings) {
    byRule[f.rule] = (byRule[f.rule] || 0) + 1;
    bySeverity[f.severity]++;
  }

  // 輸出 markdown report
  const today = new Date().toISOString().slice(0, 10);
  const reportLines = [];
  reportLines.push(`# 物件法規合規掃描 ${today}`);
  reportLines.push("");
  reportLines.push(`掃描 **${scanned}** 個物件，發現 **${findings.length}** 筆違規 + **${missingCredentials.length}** 筆證號缺失。`);
  reportLines.push("");
  reportLines.push("## 嚴重度");
  reportLines.push(`- 🔴 HIGH (完整門牌 / 隱私): ${bySeverity.HIGH}`);
  reportLines.push(`- 🟡 MEDIUM (廣告誇大 / 預售敏感): ${bySeverity.MEDIUM}`);
  reportLines.push("");
  reportLines.push("## 按規則分類");
  for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    reportLines.push(`- **${rule}**: ${count}`);
  }
  reportLines.push("");

  if (missingCredentials.length > 0) {
    reportLines.push(`## 證號 body 缺失 (${missingCredentials.length}) — ℹ️ 頁面渲染 footer 仍會自動補`);
    reportLines.push("");
    reportLines.push("> 註：物件詳細頁 (`/properties/[slug]`) 結尾會用 frontmatter `brokerLicense`/`agentLicense` 自動 render 兩證號 footer，所以這些物件**頁面上仍有揭露**，只是 markdown body 內沒寫。如果重視一致性可以補進 body，但**不算法規違規**。");
    reportLines.push("");
    for (const m of missingCredentials.slice(0, 30)) {
      const missing = [];
      if (!m.broker) missing.push("經紀人");
      if (!m.agent) missing.push("營業員");
      reportLines.push(`- \`${m.file}\` body 缺: ${missing.join(", ")}`);
    }
    if (missingCredentials.length > 30) {
      reportLines.push(`- ... 還有 ${missingCredentials.length - 30} 筆`);
    }
    reportLines.push("");
  }

  // 按 severity / rule 分組列違規
  const groupedHigh = findings.filter(f => f.severity === "HIGH");
  const groupedMed = findings.filter(f => f.severity === "MEDIUM");

  if (groupedHigh.length > 0) {
    reportLines.push(`## 🔴 HIGH 違規 (${groupedHigh.length})`);
    for (const f of groupedHigh.slice(0, 50)) {
      reportLines.push(`- \`${f.file}\` · ${f.rule} · field: ${f.field}`);
      reportLines.push(`  - matched: \`${f.matched}\``);
      reportLines.push(`  - snippet: ${f.snippet.replace(/\n/g, " ")}`);
    }
    if (groupedHigh.length > 50) {
      reportLines.push(`- ... 還有 ${groupedHigh.length - 50} 筆`);
    }
    reportLines.push("");
  }

  if (groupedMed.length > 0) {
    reportLines.push(`## 🟡 MEDIUM 違規 (${groupedMed.length})`);
    const dedupKey = new Map();
    for (const f of groupedMed) {
      const k = `${f.rule}:${f.matched}`;
      if (!dedupKey.has(k)) dedupKey.set(k, []);
      dedupKey.get(k).push(f);
    }
    for (const [k, list] of [...dedupKey.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const [rule, matched] = k.split(":");
      reportLines.push(`### ${rule} · \`${matched}\` (${list.length} 筆)`);
      for (const f of list.slice(0, 5)) {
        reportLines.push(`- \`${f.file}\` · field: ${f.field} · ${f.snippet.replace(/\n/g, " ")}`);
      }
      if (list.length > 5) reportLines.push(`- ... 還有 ${list.length - 5} 筆`);
      reportLines.push("");
    }
  }

  reportLines.push("---");
  reportLines.push("");
  reportLines.push("## ⚠️ false positive 提示");
  reportLines.push("");
  reportLines.push("自動掃描一定會誤報，景泰人工複審以下幾類：");
  reportLines.push("");
  reportLines.push("1. **「第X排」** (例「第一排面河」) 是**地理描述**不是廣告誇大，可忽略");
  reportLines.push("2. **「第X間」** (例「台中第一間凱悅」) 是**事實陳述**不是廣告誇大，可忽略");
  reportLines.push("3. **「即將完工」** 若指**周邊建設**(例漢神百貨即將完工) 不是預售自家物件可忽略");
  reportLines.push("4. **「獨家」** 若指「專任獨家」(房仲業界術語、簽委託書條件) 不是廣告誇大可忽略");
  reportLines.push("5. **景泰本人電話 0920-118756 已加白名單**，不會誤報");
  reportLines.push("");
  reportLines.push("真正需要改的：屋主姓名 / 同事完整手機 / 「最強/絕版/保證漲」這種絕對形容詞");

  // 確保 audit 資料夾存在
  if (!existsSync(AUDIT_DIR)) {
    await mkdir(AUDIT_DIR, { recursive: true });
  }
  const reportPath = new URL(`audit-${today}.md`, AUDIT_DIR);
  await writeFile(reportPath, reportLines.join("\n"), "utf-8");

  // 也寫 JSON 給程式用
  const jsonPath = new URL(`audit-${today}.json`, AUDIT_DIR);
  await writeFile(jsonPath, JSON.stringify({
    scanned,
    findings,
    missingCredentials,
    summary: { bySeverity, byRule, missingCredentialsCount: missingCredentials.length },
  }, null, 2), "utf-8");

  console.log(`scanned ${scanned} properties`);
  console.log(`  HIGH:   ${bySeverity.HIGH}`);
  console.log(`  MEDIUM: ${bySeverity.MEDIUM}`);
  console.log(`  missing credentials: ${missingCredentials.length}`);
  console.log(`report: ${reportPath.pathname}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
