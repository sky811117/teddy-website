#!/usr/bin/env node
/**
 * seo-diff.mjs — 改版前後的「SEO 語意不退步」對照（離線，只讀兩份建置產物）。
 *
 *   node scripts/seo-diff.mjs --base <改版前的 dist> --new <改版後的 dist> [--changed index.html,privacy/index.html] [--json 輸出檔]
 *
 * 另有 --allow <json 檔>：人看過、決定接受的「舊有但新版沒有」的可見文字、連結文字、圖片說明（格式見 loadAllow）。
 *   沒在清單裡的差異一律算不符，這樣「文字一字不動」才真的被證明，而不是靜靜過關。
 *
 * 檢查：
 *  1. 頁面清單：新增／消失的頁面（預期只多出新頁）
 *  2. 沒宣告要改的頁面，HTML 必須與改版前「逐位元組相同」（--changed 之外的所有 .html）
 *  3. 宣告有改的頁面，逐項對照：<title>、description、canonical、robots、og/twitter 標籤、H1 文字、H2／H3 集合、
 *     全部 JSON-LD（鍵排序後深度相等）、內部連結集合（舊 ⊂ 新）、id="hero"、data-track／data-cta／data-property-* 屬性
 *  4. sitemap 的網址集合、robots.txt、llms.txt、_headers、_redirects 是否有被動到
 *  5. dist/js 內既有腳本是否逐位元組相同
 * 退出碼：0＝全部符合；1＝有不符。輸出是人看的摘要；--json 另存逐項資料。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = n => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const BASE = opt("--base");
const NEW = opt("--new");
if (!BASE || !NEW) {
  console.error("用法：node scripts/seo-diff.mjs --base <dist> --new <dist> [--changed a.html,b/index.html] [--json out.json]");
  process.exit(2);
}
function loadAllow() {
  const f = opt("--allow");
  if (!f) return { text: new Set(), anchor: new Set(), img: new Set(), heading: new Set(), href: new Set() };
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  // 「href\t錨文字」「alt\t檔名」「h2\t文字」的 \t 是分隔符，不能被當成空白吃掉：逐段正規化再接回去
  const norm0 = s => String(s).split("\t").map(p => p.replace(/\s+/g, " ").trim()).join("\t");
  return {
    text: new Set((j.text || []).map(norm0)), // 舊有的可見文字行（被接受消失或改寫）
    anchor: new Set((j.anchor || []).map(norm0)), // "href\t錨文字"
    img: new Set((j.img || []).map(norm0)), // "alt\tsrc 檔名"
    heading: new Set((j.heading || []).map(norm0)), // "h2\t文字"
    href: new Set((j.href || []).map(norm0)), // 舊有但新版沒有的連結網址（例如 /go/line?src=… 這種追蹤用的轉址代碼）
  };
}
const ALLOW = loadAllow();
// --emit-allow <檔>：把「目前沒被接受的消失項目」完整寫成 allow 範本，給人逐項看過、刪掉不接受的，再當成 --allow 的內容。
// 不是自動放行：範本本身不會被讀成 --allow，必須由人另存、審過。
const EMIT = { text: new Set(), anchor: new Set(), img: new Set(), heading: new Set(), href: new Set() };
const CHANGED = new Set((opt("--changed") || "index.html,privacy/index.html").split(",").map(s => s.trim()).filter(Boolean));
const EXPECT_NEW_PAGES = new Set((opt("--new-pages") || "find/index.html").split(",").map(s => s.trim()).filter(Boolean));

function walk(dir, out = [], root = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, root);
    else out.push(path.relative(root, p).replace(/\\/g, "/"));
  }
  return out;
}
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const read = p => fs.readFileSync(p, "utf8");

const baseFiles = walk(BASE);
const newFiles = walk(NEW);
const baseSet = new Set(baseFiles);
const newSet = new Set(newFiles);
const problems = [];
const report = { pages: {}, notes: [] };
const bad = msg => problems.push(msg);

/* ---------- 1. 頁面清單 ---------- */
const htmlBase = baseFiles.filter(f => f.endsWith(".html"));
const htmlNew = newFiles.filter(f => f.endsWith(".html"));
const added = htmlNew.filter(f => !baseSet.has(f));
const removed = htmlBase.filter(f => !newSet.has(f));
console.log(`頁面數：改版前 ${htmlBase.length}　改版後 ${htmlNew.length}`);
console.log(`新增頁面：${added.length ? added.join("、") : "（無）"}`);
console.log(`消失頁面：${removed.length ? removed.join("、") : "（無）"}`);
for (const f of added) if (!EXPECT_NEW_PAGES.has(f)) bad(`多出預期之外的頁面：${f}`);
for (const f of removed) bad(`頁面消失：${f}`);
report.pages.added = added;
report.pages.removed = removed;

/* ---------- 2. 沒宣告要改的頁面：逐位元組相同（樣式表的雜湊檔名先依出現順序正規化；樣式表內容另在第 2b 步檢查） ---------- */
const CSS_HREF = /\/_astro\/([^"'\s/]+?)\.[A-Za-z0-9_-]{8}\.css/g;
const cssNames = html => [...html.matchAll(CSS_HREF)].map(m => m[0]);
// 字型檔名是「建置時的路徑＋內容」算出來的雜湊：兩份 dist 若放在不同資料夾，同一個字型檔會得到不同檔名。
// 這裡把 /_astro/fonts/<檔名> 換成「檔案內容」的雜湊，檔名不同但內容逐位元組相同就算相同；內容不同才算不符。
const FONT_URL = /\/_astro\/fonts\/([A-Za-z0-9_-]+\.(?:woff2|woff|ttf|otf))/g;
const fontSha = new Map();
const fontContentId = (root, name) => {
  const p = path.join(root, "_astro", "fonts", name);
  const key = root + "|" + name;
  if (!fontSha.has(key)) fontSha.set(key, fs.existsSync(p) ? sha(p).slice(0, 16) : "MISSING-" + name);
  return fontSha.get(key);
};
const normFonts = (html, root) => html.replace(FONT_URL, (_, name) => `/_astro/fonts/#${fontContentId(root, name)}`);
const normCss = (html, root) => { let n = 0; return normFonts(html, root).replace(CSS_HREF, () => `/_astro/CSS#${++n}.css`); };
const cssPairs = new Map();
let same = 0;
const differing = [];
for (const f of htmlBase) {
  if (!newSet.has(f) || CHANGED.has(f)) continue;
  const ha = read(path.join(BASE, f));
  const hb = read(path.join(NEW, f));
  const na = cssNames(ha);
  const nb = cssNames(hb);
  if (na.length === nb.length) na.forEach((x, i) => { if (x !== nb[i]) cssPairs.set(x + " => " + nb[i], [x, nb[i]]); });
  if (normCss(ha, BASE) === normCss(hb, NEW)) same++;
  else differing.push(f);
}
console.log(`未宣告要改的頁面：${same} 頁相同（逐位元組，僅樣式表與字型檔的雜湊檔名不同；字型檔以內容比對），${differing.length} 頁不同`);

/* ---------- 2b. 檔名變了的樣式表：新的規則必須是舊的規則的子集（只會少，不會多或變） ---------- */
function cssRuleSet(text) {
  const out = new Set();
  const parse = (str, ctx) => {
    let i = 0;
    while (i < str.length) {
      const open = str.indexOf("{", i);
      if (open < 0) { const tail = str.slice(i).trim(); if (tail) out.add(ctx + "|" + tail); break; }
      const head = str.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < str.length && depth) { if (str[j] === "{") depth++; else if (str[j] === "}") depth--; j++; }
      const inner = str.slice(open + 1, j - 1);
      if (inner.includes("{")) parse(inner, ctx + ">" + head);
      else out.add(ctx + "|" + head + "{" + inner + "}");
      i = j;
    }
  };
  parse(text.replace(/\/\*[\s\S]*?\*\//g, ""), "");
  return out;
}
// 少掉的樣式規則，用到它的 class 不能出現在任何「沒宣告要改」的頁面（那些頁面逐位元組不變，所以它們本來就不該用到）
let unchangedClassTokens = null;
const classTokensOfUnchangedPages = () => {
  if (unchangedClassTokens) return unchangedClassTokens;
  unchangedClassTokens = new Map();
  for (const f of htmlBase) {
    if (!newSet.has(f) || CHANGED.has(f)) continue;
    for (const m of read(path.join(BASE, f)).matchAll(/class=["']([^"']*)["']/g)) for (const t of m[1].split(/\s+/)) if (t && !unchangedClassTokens.has(t)) unchangedClassTokens.set(t, f);
  }
  return unchangedClassTokens;
};
const classesOfRule = r => {
  const bar = r.indexOf("|");
  const rest = r.slice(bar + 1);
  const head = rest.indexOf("{") >= 0 ? rest.slice(0, rest.indexOf("{")) : rest;
  return [...head.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)].map(m => m[1].replace(/\\(.)/g, "$1"));
};
let cssIdentical = 0, cssShrunk = 0;
for (const [, [oa, ob]] of cssPairs) {
  const pa = path.join(BASE, oa.replace(/^\//, ""));
  const pb = path.join(NEW, ob.replace(/^\//, ""));
  if (!fs.existsSync(pa) || !fs.existsSync(pb)) { bad(`樣式表檔不存在：${oa} 或 ${ob}`); continue; }
  if (sha(pa) === sha(pb)) { cssIdentical++; continue; }
  const ra = cssRuleSet(read(pa));
  const rb = cssRuleSet(read(pb));
  // 新檔裡舊檔沒有的規則，只允許是舊規則的「縮小版」：同一個上下文、選擇器清單與宣告清單都只少不多
  // （例如 Tailwind 把只有舊首頁用到的 .text-muted-foreground/40 從選擇器清單拿掉、少掉幾個 --tw 變數）
  const split = (str, sep) => { const out = []; let d = 0, q = null, cur = ""; for (const ch of str) { if (q) { cur += ch; if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; } if (ch === "(" || ch === "[") d++; if (ch === ")" || ch === "]") d--; if (ch === sep && d === 0) { out.push(cur.trim()); cur = ""; continue; } cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const parts = r => { const bar = r.indexOf("|"); const ctx = r.slice(0, bar); const rest = r.slice(bar + 1); const o = rest.indexOf("{"); if (o < 0 || !rest.endsWith("}")) return { ctx, head: new Set([rest]), body: new Set() }; return { ctx, head: new Set(split(rest.slice(0, o), ",")), body: new Set(split(rest.slice(o + 1, -1), ";")) }; };
  const oldParts = [...ra].map(parts);
  const isSubset = (a, b) => [...a].every(x => b.has(x));
  const extra = [...rb].filter(r => !ra.has(r)).filter(r => { const p = parts(r); return !oldParts.some(o => o.ctx === p.ctx && isSubset(p.head, o.head) && isSubset(p.body, o.body)); });
  const gone = [...ra].filter(r => !rb.has(r));
  const goneClasses = new Set(gone.flatMap(classesOfRule));
  const stillUsed = [...goneClasses].filter(c => classTokensOfUnchangedPages().has(c));
  if (stillUsed.length) bad(`樣式表 ${ob} 少掉的規則，其 class 仍被沒改的頁面使用：${stillUsed.slice(0, 8).map(c => c + "（" + classTokensOfUnchangedPages().get(c) + "）").join("、")}`);
  console.log(`  少掉的規則涉及 ${goneClasses.size} 個 class，沒改的頁面仍在用的：${stillUsed.length}`);
  console.log(`樣式表 ${oa} → ${ob}：規則 ${ra.size} → ${rb.size}（少了 ${gone.length} 條、多了 ${extra.length} 條）`);
  report.css ||= [];
  report.css.push({ from: oa, to: ob, before: ra.size, after: rb.size, removed: gone.length, added: extra.length });
  if (extra.length) bad(`樣式表 ${ob} 多出或改了 ${extra.length} 條規則（舊檔沒有）`);
  else cssShrunk++;
}
console.log(`樣式表配對：${cssPairs.size} 組，內容相同 ${cssIdentical}、只減不增 ${cssShrunk}`);
for (const f of differing.slice(0, 15)) bad(`未宣告要改的頁面內容變了：${f}`);
if (differing.length > 15) bad(`……另有 ${differing.length - 15} 頁也變了`);
report.pages.identical = same;
report.pages.differing = differing;

/* ---------- 3. 宣告有改的頁面：逐項對照 ---------- */
const norm = s => s.replace(/\s+/g, " ").trim();
// 標籤的屬性值裡可以有 ">"（Tailwind 的 [&>li>a]:... 就是），所以比對標籤時要把引號內的內容整段跳過
const TAG = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const stripTags = s => norm(s.replace(new RegExp(`<${TAG}>`, "g"), "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'"));
const all = (re, s) => [...s.matchAll(re)];
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);

function extract(html) {
  const head = (/<head[\s\S]*?<\/head>/i.exec(html) || [""])[0];
  const meta = {};
  for (const m of all(/<meta\s+([^>]*?)\/?>/gi, head)) {
    const a = m[1];
    const key = /\b(?:name|property)=["']([^"']+)["']/i.exec(a);
    const val = /\bcontent=["']([^"']*)["']/i.exec(a);
    if (key && val) (meta[key[1]] ||= []).push(val[1]);
  }
  const canonical = (/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(head) || /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(head) || [])[1] || null;
  const ld = all(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, html).map(m => {
    try {
      return JSON.stringify(sortKeys(JSON.parse(m[1])));
    } catch {
      return "INVALID:" + m[1].slice(0, 40);
    }
  });
  const hrefs = new Set(all(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi, html).map(m => m[1]));
  const attrs = {};
  for (const name of ["data-track", "data-cta", "data-property-id", "data-property-title", "data-property-price", "data-property-district"]) {
    attrs[name] = all(new RegExp(`\\b${name}=["']([^"']*)["']`, "gi"), html).map(m => m[1]).sort();
  }
  const body = (/<body[\s\S]*<\/body>/i.exec(html) || [html])[0];
  // 可見文字：去掉 script／style／svg／註解，再依「區塊級標籤」切成行；blob 是整頁的純文字（拿來判斷舊的一行是否還在新版裡）
  const BLOCK_TAGS = "p|div|li|ul|ol|h[1-6]|section|article|header|footer|nav|main|aside|tr|td|th|br|button|details|summary|dd|dt|dl|form|figure|figcaption|table|thead|tbody|blockquote|option|select|textarea|noscript";
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const visible = cleaned.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b${TAG}>`, "gi"), "\n");
  const lines = [...new Set(visible.split("\n").map(l => stripTags(l)).filter(l => l.length >= 2))];
  const blob = stripTags(cleaned);
  const headings = all(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, body).map(m => `h${m[1]}\t${stripTags(m[2])}`);
  const anchors = all(/<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, body).map(m => `${m[1]}\t${stripTags(m[2])}`);
  const imgs = all(/<img\b[^>]*>/gi, body).map(m => {
    const alt = (/\balt=["']([^"']*)["']/i.exec(m[0]) || [, ""])[1];
    const src = (/\bsrc=["']([^"']*)["']/i.exec(m[0]) || [, ""])[1];
    return `${stripTags(alt)}\t${src.split("?")[0].split("/").pop()}`;
  });
  const lang = (/<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html) || [, ""])[1];
  return {
    lang,
    lines,
    blob,
    headings,
    anchors,
    imgs,
    title: stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [, ""])[1]),
    description: (meta.description || [])[0] ?? null,
    canonical,
    robots: (meta.robots || []).join("|"),
    og: Object.fromEntries(Object.entries(meta).filter(([k]) => /^(og:|twitter:)/.test(k)).map(([k, v]) => [k, v.join("|")])),
    h1: all(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, body).map(m => stripTags(m[1])),
    h2: new Set(all(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, body).map(m => stripTags(m[1]))),
    h3: new Set(all(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, body).map(m => stripTags(m[1]))),
    ld,
    hrefs,
    hero: /\bid=["']hero["']/.test(body),
    attrs,
  };
}
// 去掉所有空白再比：行內標籤之間有沒有空白（<b>A</b> <small>B</small> 與 <b>A</b><small>B</small>）不影響讀到的字，中文也不靠空白斷詞
const sq = s => String(s).replace(/\s+/g, "");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setDiff = (a, b) => [...a].filter(x => !b.has(x));

/** 2026-10-06 審查修正：原本只比 title／meta／H1／集合，證明不了「文字一字不動」。這裡補四項，全部要「舊的在新版仍在」，
 *  不在的要嘛列進 --allow 清單（人看過、接受），要嘛算不符。 */
function deepChecks(a, b, check, rows) {
  // 1 可見文字：舊的每一行（至少 2 字）必須還出現在新版的整頁文字裡（被合併進更長的行也算還在）
  const bBlobSq = sq(b.blob);
  const lostText = a.lines.filter(l => !bBlobSq.includes(sq(l)) && !ALLOW.text.has(l));
  lostText.forEach(x => EMIT.text.add(x));
  check("可見文字：舊的每一行仍在新版（或已列入 --allow）", lostText.length === 0, lostText.slice(0, 12).map(x => `「${x.slice(0, 40)}」`).join(" "));
  const accepted = a.lines.filter(l => !bBlobSq.includes(sq(l)) && ALLOW.text.has(l));
  if (accepted.length) rows.push(["可見文字（已接受的變動）", accepted.map(x => `「${x.slice(0, 30)}」`).join(" ")]);
  // 2 連結的錨文字：舊的「連結＋文字」配對必須還在
  const bAnch = new Set(b.anchors.map(sq));
  // 舊的錨文字是空的（只有圖示的連結）沒有文字可以「失去」，不列入
  const lostAnch = [...new Set(a.anchors)].filter(x => sq(x.split("\t")[1] || "") && !bAnch.has(sq(x)) && !ALLOW.anchor.has(x));
  lostAnch.forEach(x => EMIT.anchor.add(x));
  check("連結與錨文字（href＋文字）：舊配對仍在新版（或已列入 --allow）", lostAnch.length === 0, lostAnch.slice(0, 8).map(x => x.replace("\t", " ⟶ ")).join(" | "));
  // 3 圖片：alt 與檔名配對
  // 只看「有 alt 的圖」，alt 文字必須還在新版：檔名可以換（改版換圖、縮圖尺寸不同都會讓檔名變）；alt 是空的＝裝飾圖，沒有文字可以失去
  const altOf = x => x.split("\t")[0];
  const bAlt = new Set(b.imgs.map(x => sq(altOf(x))));
  const lostImg = [...new Set(a.imgs)].filter(x => sq(altOf(x)) && !bAlt.has(sq(altOf(x))) && !ALLOW.img.has(x));
  lostImg.forEach(x => EMIT.img.add(x));
  check("圖片的 alt 文字：舊的每一個仍在新版（或已列入 --allow）", lostImg.length === 0, lostImg.slice(0, 8).map(x => x.replace("\t", " ⟶ ")).join(" | "));
  rows.push(["圖片數", `${a.imgs.length} → ${b.imgs.length}（有 alt 的 ${a.imgs.filter(altOf).length} → ${b.imgs.filter(altOf).length}）`]);
  // 4 標題序列：舊的 (層級, 文字) 依序仍是新序列的子序列（順序沒被打亂）
  const seq = b.headings;
  let at = 0;
  const miss = [];
  for (const h of a.headings) {
    const j = seq.indexOf(h, at);
    if (j < 0) { if (!ALLOW.heading.has(h)) { miss.push(h); EMIT.heading.add(h); } } else at = j + 1;
  }
  check("標題層級與順序：舊序列是新序列的子序列（或已列入 --allow）", miss.length === 0, miss.slice(0, 8).map(x => x.replace("\t", " ")).join(" | "));
}

for (const f of CHANGED) {
  if (!baseSet.has(f) || !newSet.has(f)) {
    bad(`宣告有改的頁面不存在：${f}`);
    continue;
  }
  const a = extract(read(path.join(BASE, f)));
  const b = extract(read(path.join(NEW, f)));
  const rows = [];
  const check = (name, ok, detail) => {
    rows.push([name, ok ? "相同" : "不同" + (detail ? `：${detail}` : "")]);
    if (!ok) bad(`${f} 的 ${name} 變了${detail ? "（" + detail + "）" : ""}`);
  };
  const isHome = f === "index.html";
  const isPrivacy = f === "privacy/index.html";
  if (isPrivacy) {
    // 隱私頁是「承諾文件」，正文本來就要改；title／canonical／robots／og 仍須不變，description 也不動
    check("<title>", a.title === b.title);
    check("canonical", a.canonical === b.canonical);
    check("robots", a.robots === b.robots);
    check("meta description", a.description === b.description);
    check("og／twitter", eq(a.og, b.og));
    check("H1", eq(a.h1, b.h1));
    check("JSON-LD", eq(a.ld, b.ld));
    check("內部連結（舊 ⊂ 新）", setDiff(a.hrefs, b.hrefs).length === 0, setDiff(a.hrefs, b.hrefs).join(" "));
    rows.push(["內部連結新增", setDiff(b.hrefs, a.hrefs).join(" ") || "（無）"]);
    check("<html lang>", a.lang === b.lang);
    deepChecks(a, b, check, rows);
  } else {
    check("<title>", a.title === b.title, `${a.title} → ${b.title}`);
    check("meta description", a.description === b.description);
    check("canonical", a.canonical === b.canonical, `${a.canonical} → ${b.canonical}`);
    check("robots", a.robots === b.robots);
    check("og／twitter", eq(a.og, b.og));
    check("H1 文字（空白正規化後逐字相同）", eq(a.h1, b.h1), `${JSON.stringify(a.h1)} → ${JSON.stringify(b.h1)}`);
    check("JSON-LD（全部，鍵排序後深度相等）", eq(a.ld, b.ld));
    const lostH2 = setDiff(a.h2, b.h2);
    check("H2：舊集合 ⊂ 新集合", lostH2.length === 0, lostH2.join("、"));
    const lostH3 = setDiff(a.h3, b.h3);
    check("H3：舊集合 ⊂ 新集合", lostH3.length === 0, lostH3.join("、"));
    const lostLinks = setDiff(a.hrefs, b.hrefs).filter(x => !ALLOW.href.has(x));
    setDiff(a.hrefs, b.hrefs).forEach(x => EMIT.href.add(x));
    check("內部連結：舊 ⊂ 新", lostLinks.length === 0, lostLinks.join(" "));
    check('id="hero" 仍在', a.hero === b.hero);
    for (const k of Object.keys(a.attrs)) check(`${k}（次數與值）`, eq(a.attrs[k], b.attrs[k]));
    check("<html lang>", a.lang === b.lang);
    deepChecks(a, b, check, rows);
    rows.push(["H2 新增", setDiff(b.h2, a.h2).join("、") || "（無）"]);
    rows.push(["H3 新增", setDiff(b.h3, a.h3).join("、") || "（無）"]);
    rows.push(["內部連結新增", setDiff(b.hrefs, a.hrefs).join(" ") || "（無）"]);
    if (!isHome) rows.push(["備註", "非首頁，僅供參考"]);
  }
  console.log(`\n── ${f} ──`);
  for (const [k, v] of rows) console.log(`  ${k}　${v}`);
  report.pages[f] = Object.fromEntries(rows);
}

/* ---------- 4. sitemap／robots／llms／headers ---------- */
function sitemapUrls(root) {
  const urls = new Set();
  for (const f of walk(root).filter(x => /^sitemap.*\.xml$/.test(x))) for (const m of read(path.join(root, f)).matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1]);
  return urls;
}
const sa = sitemapUrls(BASE);
const sb = sitemapUrls(NEW);
const sAdded = [...sb].filter(u => !sa.has(u));
const sRemoved = [...sa].filter(u => !sb.has(u));
console.log(`\nsitemap：舊 ${sa.size} 筆、新 ${sb.size} 筆；新增 ${sAdded.join("、") || "（無）"}；消失 ${sRemoved.join("、") || "（無）"}`);
for (const u of sRemoved) bad(`sitemap 網址消失：${u}`);
for (const u of sAdded) if (!/\/find\/$/.test(u)) bad(`sitemap 多出預期之外的網址：${u}`);
report.sitemap = { added: sAdded, removed: sRemoved };
for (const f of ["robots.txt", "llms.txt", "_headers", "_redirects", "_routes.json"]) {
  if (baseSet.has(f) !== newSet.has(f)) {
    bad(`${f} 存在與否不同`);
    continue;
  }
  if (!baseSet.has(f)) continue;
  const same2 = sha(path.join(BASE, f)) === sha(path.join(NEW, f));
  console.log(`${f}：${same2 ? "相同" : "不同"}`);
  if (!same2) bad(`${f} 內容變了`);
}

/* ---------- 5. 既有 JS 不變 ---------- */
const NEW_JS = new Set(["find-app.js", "need-extract.js", "wait-game.js", "find-brief.js"]);
let jsSame = 0;
for (const f of baseFiles.filter(x => /^js\/.*\.js$/.test(x))) {
  if (!newSet.has(f)) { bad(`既有腳本消失：${f}`); continue; }
  if (sha(path.join(BASE, f)) === sha(path.join(NEW, f))) jsSame++;
  else bad(`既有腳本變了：${f}`);
}
const jsAdded = newFiles.filter(x => /^js\//.test(x) && !baseSet.has(x));
for (const f of jsAdded) if (!NEW_JS.has(path.basename(f))) bad(`多出預期之外的腳本：${f}`);
console.log(`dist/js：既有 ${jsSame} 支逐位元組相同；新增 ${jsAdded.join("、") || "（無）"}`);

if (opt("--emit-allow")) fs.writeFileSync(opt("--emit-allow"), JSON.stringify({ text: [...EMIT.text], anchor: [...EMIT.anchor], img: [...EMIT.img], heading: [...EMIT.heading], href: [...EMIT.href] }, null, 2));
if (opt("--json")) fs.writeFileSync(opt("--json"), JSON.stringify(report, (k, v) => (v instanceof Set ? [...v] : v), 2));
console.log("");
if (problems.length) {
  console.error(`✖ 有 ${problems.length} 項不符：`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✔ 全部符合：頁面清單、未改頁面逐位元組相同、改動頁的 title／H1／canonical／JSON-LD／連結／屬性都沒退步。");
