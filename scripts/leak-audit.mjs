#!/usr/bin/env node
/**
 * leak-audit.mjs — 零痕跡洩漏稽核（找房小幫手）。
 *
 * 目的：官網與瀏覽器端不得出現任何「後端查詢來源」的痕跡（網域、端點、品牌字、案件編號格式、內部主機名…）。
 * 這支腳本本身不含任何禁字——禁字清單放在工作站（不進任何 repo），用 --denylist 指定；讀不到清單就直接失敗。
 *
 * 清單格式（一行一條正規式，# 開頭是註解，不分大小寫）：
 *   T1:<regex>   絕對禁止：新增的程式碼、新頁、前端檔、建置產物、回應，每個輸出面都不得出現
 *   T2:<regex>   公司網域層：新增的程式碼與新頁專屬區塊禁用；既有的 JSON-LD 與頁尾公司揭露區塊（data-company-disclosure）白名單
 *   T3:<regex>   內部結構層：瀏覽器端檔案與建置產物禁用；允許出現在 functions/、src/lib/find/、scripts/、tests/ 原始碼
 *   沒有前綴視為 T1。
 *
 * 比對方式（每個檔案做三遍，命中時規則編號後面會帶標記）：
 *   原文       逐行比對（行號最準）
 *   ~n 正規化  NFKC、去零寬字元與軟連字號、解 HTML 實體、解 \uXXXX／\xXX／CSS 跳脫、解 %XX、去註解（把被註解切開的字接回來）、
 *              接起 "a"+"b" 與 ["a","b"].join("")、把 12 字元以上的 base64 字串解開附在後面
 *   ~sq 壓平   整個檔案只留英數與中日韓字再比對（抓得到被斷行、被標籤、被空白切開的字）；只用 T1 裡「字面夠長」的規則
 *
 * 模式：
 *   --diff [--base <ref>]       掃「本分支相對 base 的新增行；新檔掃全文」（含尚未 commit 的修改與未追蹤的新檔）。
 *                               base 預設是環境變數 LEAK_BASE，再沒有就 main。⚠️ 合併進 main 之後 main 對 main 是空的，
 *                               要改指「上一次上線的 commit 或 tag」，不然什麼都掃不到。
 *   --dist <dir>                掃建置產物：<dir>/find/**、首頁、隱私頁、404、新 JS（find-app、need-extract、wait-game、wait-board、find-brief、
 *                               find-scope、find-map）、find-map.css、自架的地圖程式庫 js/vendor/**、_astro/*.js、含 u2- 的 CSS（設計系統）、
 *                               sitemap／llms.txt／_headers／_redirects
 *   --bundle <dir>              掃 Function 打包物（T1、T2；T3 允許）。打包物要用 charset=utf8 產生，否則中文被轉成 \uXXXX
 *                               （本腳本也會解開，但請兩邊都做）
 *   --samples <dir>             掃「端點回應樣本」（含標頭）：T1、T2、T3 全部禁用（瀏覽器看得到的回應不得有任何一層）
 *   --hosts --dist <dir>        對外主機白名單：載入資源（script／link／img／iframe／form／fetch／import／url()）的目標必須是同源或白名單主機
 *   --no-sourcemap <dir>...     找不到任何 .map 檔、也沒有 sourceMappingURL 註解
 *   --min-files N               （搭配 --dist／--bundle／--hosts）掃到的檔案少於 N 個就失敗（預設 1）。目錄不存在、路徑寫錯、
 *                               建置產物是空的，以前都會印「乾淨（掃了 0 個）」而通過；現在一律失敗。
 *
 * 2026-10-06 紅隊修補（RT-01／RT-10／RT-19）：
 *  - 拿掉 --hashed 模式與「加鹽雜湊檔」及其產生器：加鹽雜湊的鹽與雜湊同檔，進公開 repo 等於公開禁字（紅隊用幾十個猜測詞
 *    就還原大半）。雲端改成：完整禁字清單放 GitHub Actions secret LEAK_DENYLIST，job 內寫到 $RUNNER_TEMP，跑上面的「完整模式」。
 *  - 讀檔不再「讀不到就略過」：含 NUL 的文字類檔案（.js .css .html .json…）若不是 UTF-16（BOM 會先解碼再比對），回報 UNREADABLE 而失敗；
 *    以前它們會被靜默略過（這台電腦的 PowerShell 5.1 預設就寫 UTF-16）。
 * 退出碼：0＝乾淨；1＝命中；2＝用法錯誤或讀不到清單。
 * 輸出只列「檔案:行:規則編號」，不印命中的原字串（避免日誌洩漏）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = n => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const cwd = process.cwd();

const BROWSER_JS = ["find-app.js", "need-extract.js", "wait-game.js", "wait-board.js", "find-brief.js", "find-scope.js", "find-map.js"];
// 跟著瀏覽器端 JS 出貨的其他檔：地圖畫面的樣式（find-map.css）；自架的地圖程式庫整個資料夾（js/vendor/**，2026-10-09 Leaflet 1.9.4）
const BROWSER_OTHER = ["find-map.css"];
const VENDOR_DIR = ["js", "vendor"];
// T3 允許出現的原始碼位置（相對 repo 根，正斜線）
const T3_OK = [/^functions\//, /^src\/lib\/find\//, /^scripts\//, /^tests\//];
// 對外主機白名單（載入資源用）：同源，加上人機驗證與全站既有的分析腳本（Layout 一律載入，Consent Mode 預設拒絕）；
const HOST_OK = new Set(["teddy-house.tw", "www.teddy-house.tw", "challenges.cloudflare.com", "www.googletagmanager.com", "www.google-analytics.com"]);
// 只准出現在特定檔案的主機（2026-10-09 地圖圖片＝內政部國土測繪中心開放圖資）：網域只能寫在 find-map.js（TILE_URL 那一處）
// 與 _headers（/find/ 的 CSP img-src）。其他任何檔出現這個網域都算違規——不管是不是載入型寫法（find.astro 檔頭的規定）
const HOST_FILE_ONLY = { "wmts.nlsc.gov.tw": /(^|[\\/])(?:js[\\/]find-map\.js|_headers(?:\.txt)?)$/ };
// 二進位（圖片、字型…）不逐行掃；svg 是文字，要掃
const BINARY_EXT = /\.(png|jpe?g|webp|gif|ico|avif|woff2?|ttf|otf|mp4|webm|mp3|pdf|zip|gz|br|map)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|ico)$/i;
const SQ_MIN_ASCII = 7; // 壓平比對：字面至少這麼長（太短會在長檔案裡跨詞誤報）
const SQ_MIN_CJK = 2;

function fail2(msg) {
  console.error(`[leak-audit] ${msg}`);
  process.exit(2);
}

function loadDenylist() {
  const file = opt("--denylist") || process.env.LEAK_DENYLIST;
  if (!file) fail2("沒有指定禁字清單（--denylist <檔> 或環境變數 LEAK_DENYLIST）。清單放在工作站，不進 repo。");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fail2("讀不到禁字清單，稽核無法進行。");
  }
  const rules = [];
  text.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = /^(T[123]):(.*)$/.exec(line);
    const tier = m ? m[1] : "T1";
    const src = (m ? m[2] : line).trim();
    if (!src) return;
    try {
      rules.push({ tier, id: `${tier}-${rules.filter(r => r.tier === tier).length + 1}`, re: new RegExp(src, "i"), src });
    } catch {
      fail2(`禁字清單有一條不是合法的正規式（${tier} 第 ${rules.filter(r => r.tier === tier).length + 1} 條）。`);
    }
  });
  if (!rules.length) fail2("禁字清單是空的。");
  return rules;
}

/** 從規則字面抽出「壓平後」要比對的字串（小寫英數＋中日韓）；字面太短就不用（回 null） */
export function squashLiteral(src) {
  if (src.includes("|")) return null; // 有「或」的規則字面不明確，不做壓平比對（原文與正規化兩遍照樣比）
  const lit = src
    .replace(/\[([^\]])[^\]]*\]/g, "$1") // 字元類別取第一個字
    .replace(/\\[sSdDwWbB]\??(?:\{[^}]*\})?/g, "") // \s? \b \d{5,}…
    .replace(/\\(.)/g, "$1")
    .replace(/[\^$|()?*+.[\]{}]/g, "");
  const q = squash(lit);
  if (!q) return null;
  const cjk = (q.match(/[㐀-鿿]/g) || []).length;
  const ascii = q.length - cjk;
  if (cjk >= SQ_MIN_CJK || ascii >= SQ_MIN_ASCII) return q;
  return null;
}

/* ---------- 正規化 ---------- */
const ZW_RE = /[​-‏‪-‮⁠-⁤﻿­͏᠎]/g;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "", zwj: "", zwnj: "", colon: ":", sol: "/", period: ".", hyphen: "-", lowbar: "_" };
const cp = n => {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
};
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d) => cp(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m));
}
function decodeEscapes(s) {
  return s
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_m, h) => cp(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_m, h) => cp(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_m, h) => cp(parseInt(h, 16)))
    .replace(/\\([0-9a-f]{2,6})\s?/gi, (_m, h) => cp(parseInt(h, 16))); // CSS 跳脫（至少 2 位；單一位數太容易跟 \d \b 這類混在一起）
}
function decodePercent(s) {
  return s.replace(/(?:%[0-9a-f]{2})+/gi, m => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });
}
function joinStrings(s) {
  // "a" + "b"、'a'+'b'、`a`+`b` → 接起來
  let out = s;
  for (let k = 0; k < 4; k++) {
    const nxt = out.replace(/(["'`])\s*\+\s*\1/g, "").replace(/(["'])\s*,\s*\1/g, "$1,$1");
    if (nxt === out) break;
    out = nxt;
  }
  // ["a","b"].join("") → ab
  out = out.replace(/\[\s*((?:(["'`])[^"'`\n]*\2\s*,?\s*){2,})\]\s*\.join\(\s*(["'`])\3\s*\)/g, (_m, items) => [...items.matchAll(/(["'`])([^"'`\n]*)\1/g)].map(x => x[2]).join(""));
  return out;
}
function decodeBase64Tokens(s) {
  const extra = [];
  for (const m of s.matchAll(/[A-Za-z0-9+/_-]{12,}={0,2}/g)) {
    let buf;
    try {
      buf = Buffer.from(m[0].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    } catch {
      continue;
    }
    if (buf.length < 6) continue;
    const t = buf.toString("utf8");
    const printable = [...t].filter(c => /[\x20-\x7e㐀-鿿]/.test(c)).length;
    if (printable / Math.max(1, [...t].length) >= 0.9) extra.push(t);
  }
  return extra.length ? s + "\n" + extra.join("\n") : s;
}
export function normalize(text) {
  let s = text;
  for (let k = 0; k < 3; k++) {
    const before = s;
    s = s.normalize("NFKC");
    s = decodeEntities(s);
    s = decodeEscapes(s);
    s = decodePercent(s);
    s = s.replace(ZW_RE, "");
    s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    s = joinStrings(s);
    if (s === before) break;
  }
  return decodeBase64Tokens(s);
}
const MARKUP_RE = /\.(html?|xml|svg|astro)$/i;
const stripTags = t => t.replace(/<[^>]*>/g, "");
export function squash(text) {
  return text.normalize("NFKC").replace(ZW_RE, "").toLowerCase().replace(/[^a-z0-9㐀-鿿]/g, "");
}

const hits = [];
const hit = (file, line, id) => {
  const k = `${file}:${line}:${id}`;
  if (!hits.includes(k)) hits.push(k);
};

/** 剝掉 JSON-LD 與頁尾公司揭露區塊（行數不變：換成同樣數量的換行），給 T2 用 */
function stripWhitelisted(html) {
  const blank = s => s.replace(/[^\n]/g, "");
  return html
    .replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, blank)
    .replace(/<([a-z0-9]+)\b[^>]*data-company-disclosure[^>]*>[\s\S]*?<\/\1>/gi, blank);
}

/** 首頁「房市筆記」新聞卡片（<article … data-editorial-feed>）：編輯內容（新聞標題與摘要）依慣例會標註第三方統計的資料來源，
 *  不是查詢功能的痕跡；只在首頁（modeDist 只對 dist/index.html 開）剝掉，行數不變。卡片外面、其他頁面、JS、CSS 一律照樣嚴查。 */
function stripEditorial(html) {
  return html.replace(/<article\b[^>]*data-editorial-feed[^>]*>[\s\S]*?<\/article>/gi, s => s.replace(/[^\n]/g, ""));
}

function scanLines(rel, text, rules, { allowT3 = false, whitelistT2 = false, addedOnly = null, mark = "" } = {}) {
  const lines = text.split(/\r?\n/);
  const t2lines = whitelistT2 ? stripWhitelisted(text).split(/\r?\n/) : lines;
  lines.forEach((ln, i) => {
    const n = i + 1;
    if (addedOnly && !addedOnly.has(n)) return;
    for (const r of rules) {
      if (r.tier === "T3" && allowT3) continue;
      const target = r.tier === "T2" ? t2lines[i] ?? "" : ln;
      if (r.re.test(target)) hit(rel, n, r.id + mark);
    }
  });
}

/** 一個文字檔的完整比對：原文逐行 → 正規化逐行 → 壓平（只比 T1 的長字面）。addedOnly（只掃新增行）時，後兩遍改看整個檔案。 */
function scanText(rel, text, rules, opts = {}) {
  if (opts.editorial) text = stripEditorial(text);
  scanLines(rel, text, rules, opts);
  if (opts.deep === false) return; // 不會出貨的檔案（tests／scripts／docs）只做原文比對：測試本來就會用拆字、編碼來避免把禁字寫進來
  let base = opts.whitelistT2 ? stripWhitelisted(text) : text;
  // 只掃新增行（既有檔的舊內容不在範圍）
  if (opts.addedOnly) base = text.split(/\r?\n/).filter((_l, i) => opts.addedOnly.has(i + 1)).join("\n");
  const norm = normalize(base);
  if (norm !== base) scanLines(rel, norm, rules.filter(r => r.tier !== "T3" || !opts.allowT3), { ...opts, whitelistT2: false, addedOnly: null, mark: "~n" });
  const sq = squash(MARKUP_RE.test(rel) ? stripTags(norm) : norm); // 網頁檔先去掉標籤，被標籤切開的字才接得回來
  if (sq.length) {
    for (const r of rules) {
      if (r.tier !== "T1") continue;
      const lit = r.sq === undefined ? (r.sq = squashLiteral(r.src)) : r.sq;
      if (lit && sq.includes(lit)) hit(rel, 1, r.id + "~sq");
    }
  }
}

/** 圖片等二進位：只看裡面的可讀字串（中繼資料、註解），T1 才算 */
function scanBinary(rel, buf, rules) {
  const s = buf.toString("latin1");
  for (const r of rules) if (r.tier === "T1" && r.re.test(s)) hit(rel, 0, r.id + "~bin");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}
const rel = p => path.relative(cwd, p).replace(/\\/g, "/");
const TEXT_EXT = /(?:\.(?:html?|xml|svg|astro|js|mjs|cjs|ts|css|json|txt|md|mdx|yml|yaml|webmanifest|csv)|[\\/]_(?:headers|redirects))$/i;
/**
 * 讀成文字。UTF-16（有 BOM）先解碼再比對；含 NUL 的二進位檔回 null（圖片等另有 scanBinary）。
 * 但「副檔名是文字類、內容卻含 NUL（沒 BOM 的 UTF-16、被塞了空字元）」不能靜默略過：那正是閃過稽核的寫法，回報 UNREADABLE。
 */
const readSafe = p => {
  let b;
  try {
    b = fs.readFileSync(p);
  } catch {
    return null;
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const sw = Buffer.from(b.subarray(2));
    sw.swap16();
    return sw.toString("utf16le");
  }
  if (b.includes(0)) {
    if (TEXT_EXT.test(p)) hit(rel(p), 0, "UNREADABLE");
    return null;
  }
  return b.toString("utf8");
};

/* ---------- --diff ---------- */
function git(args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
}
function modeDiff(rules) {
  const base = opt("--base") || process.env.LEAK_BASE || "main";
  const changed = git(["diff", "--name-only", "--diff-filter=ACMR", base]).split("\n").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  const isNew = new Set(untracked);
  let n = 0;
  for (const f of new Set([...changed, ...untracked])) {
    if (/^(public\/cards\/|public\/og\/|public\/properties\/|src\/content\/properties\/|dist\/|node_modules\/)/.test(f)) continue;
    if (BINARY_EXT.test(f)) {
      if (IMAGE_EXT.test(f)) {
        try {
          scanBinary(f, fs.readFileSync(path.join(cwd, f)), rules);
          n++;
        } catch {
          /* 讀不到就略過 */
        }
      }
      continue;
    }
    const text = readSafe(path.join(cwd, f));
    if (text === null) continue;
    let added = null;
    if (!isNew.has(f)) {
      // 既有檔：只掃新增的行
      const d = git(["diff", "-U0", base, "--", f]);
      added = new Set();
      let cur = 0;
      for (const l of d.split("\n")) {
        const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
        if (m) {
          cur = parseInt(m[1], 10);
          const cnt = m[2] === undefined ? 1 : parseInt(m[2], 10);
          for (let k = 0; k < cnt; k++) added.add(cur + k);
        }
      }
    }
    scanText(f, text, rules, { allowT3: T3_OK.some(r => r.test(f)), addedOnly: added, deep: !/^(tests|scripts|docs)\//.test(f) });
    n++;
  }
  return n;
}

/* ---------- --dist ---------- */
/** 全站共用的檔案（sitemap、llms.txt）只取跟新頁有關的部分：既有網址與既有說明本來就會引用公司與同業名稱 */
function scopedText(p) {
  const t = readSafe(p);
  if (t === null) return null;
  const base = path.basename(p);
  if (/^sitemap.*\.xml$/i.test(base)) return (t.match(/<url>[\s\S]*?<\/url>/g) || []).filter(b => /\/find(\/|<)/.test(b)).join("\n");
  if (base === "llms.txt") return t.split(/\r?\n/).filter(l => /\/find\b|找房小幫手/.test(l)).join("\n");
  return t;
}
function distFiles(dist, { forHosts = false } = {}) {
  const out = [];
  for (const p of walk(path.join(dist, "find"))) out.push(p);
  for (const f of ["index.html", "privacy/index.html", "404.html", "llms.txt", "_headers", "_headers.txt", "_redirects", "_redirects.txt", "_routes.json"]) {
    if (fs.existsSync(path.join(dist, f))) out.push(path.join(dist, f));
  }
  for (const p of walk(dist)) if (/(^|[\\/])sitemap[^\\/]*\.xml$/i.test(p) && path.dirname(p) === dist) out.push(p);
  for (const f of [...BROWSER_JS, ...BROWSER_OTHER]) if (fs.existsSync(path.join(dist, "js", f))) out.push(path.join(dist, "js", f));
  for (const p of walk(path.join(dist, ...VENDOR_DIR))) out.push(p);
  for (const p of walk(path.join(dist, "_astro"))) {
    if (p.endsWith(".js")) { if (!forHosts) out.push(p); } // 全站共用的 JS 套件也掃禁字：新功能不該把任何字帶進去（對外主機另有既有的表單等用途，不在白名單檢查範圍）
    else if (p.endsWith(".css")) {
      const t = readSafe(p);
      if (t && /\.u2-|\.ui2/.test(t)) out.push(p);
    }
  }
  return out;
}
function modeDist(rules, dist) {
  let n = 0;
  for (const p of distFiles(dist)) {
    if (IMAGE_EXT.test(p)) continue;
    if (BINARY_EXT.test(p)) continue;
    const text = scopedText(p);
    if (text === null) continue;
    scanText(rel(p), text, rules, { allowT3: false, whitelistT2: p.endsWith(".html"), editorial: p === path.join(dist, "index.html") });
    n++;
  }
  for (const p of walk(path.join(dist, "photos", "ui2"))) if (IMAGE_EXT.test(p)) {
    scanBinary(rel(p), fs.readFileSync(p), rules);
    n++;
  }
  return n;
}

/* ---------- --bundle ---------- */
function modeBundle(rules, dir) {
  let n = 0;
  for (const p of walk(dir)) {
    if (BINARY_EXT.test(p)) continue;
    const text = readSafe(p);
    if (text === null) continue;
    scanText(rel(p), text, rules, { allowT3: true });
    n++;
  }
  return n;
}

/* ---------- --hosts ---------- */
function hostOf(u) {
  if (!u) return null;
  const s = u.trim();
  if (/^(#|\/(?!\/)|\.|data:|mailto:|tel:|javascript:|about:|blob:)/i.test(s) || !/^(https?:)?\/\//i.test(s)) return null; // 相對路徑、片段、非網路協定
  try {
    return new URL(s.startsWith("//") ? "https:" + s : s).hostname.toLowerCase();
  } catch {
    return "?";
  }
}
function modeHosts(dist) {
  let n = 0;
  const check = (file, line, u) => {
    const h = hostOf(u);
    if (h && !HOST_OK.has(h) && !(HOST_FILE_ONLY[h] && HOST_FILE_ONLY[h].test(file))) hit(file, line, "HOST");
  };
  for (const p of distFiles(dist, { forHosts: true })) {
    if (BINARY_EXT.test(p)) continue;
    const text = readSafe(p);
    if (text === null) continue;
    n++;
    const f = rel(p);
    text.split(/\r?\n/).forEach((ln, i) => {
      const L = i + 1;
      for (const [hh, okFile] of Object.entries(HOST_FILE_ONLY)) if (ln.toLowerCase().includes(hh) && !okFile.test(f)) hit(f, L, "HOST");
      if (p.endsWith(".html")) {
        // 載入型屬性：script／img／iframe／source／video／audio／form action／link 的 href（排除 preconnect、dns-prefetch 等提示）
        for (const m of ln.matchAll(/<(script|img|iframe|source|video|audio|embed|track)\b[^>]*?\b(?:src|srcset|poster)=["']([^"']+)["']/gi)) check(f, L, m[2].split(/\s+/)[0]);
        for (const m of ln.matchAll(/<form\b[^>]*?\baction=["']([^"']+)["']/gi)) check(f, L, m[1]);
        for (const m of ln.matchAll(/<link\b[^>]*>/gi)) {
          if (/rel=["'](?:preconnect|dns-prefetch|canonical|alternate|sitemap|manifest|prev|next|icon|apple-touch-icon)/i.test(m[0])) continue;
          const hm = /\bhref=["']([^"']+)["']/i.exec(m[0]);
          if (hm) check(f, L, hm[1]);
        }
      }
      for (const m of ln.matchAll(/\b(?:fetch|import|sendBeacon)\s*\(\s*["'`]([^"'`]+)["'`]/g)) check(f, L, m[1]);
      for (const m of ln.matchAll(/\.open\(\s*["'][A-Z]+["']\s*,\s*["'`]([^"'`]+)["'`]/g)) check(f, L, m[1]);
      for (const m of ln.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) check(f, L, m[1]);
      if (/\.(?:js|css)$/.test(p)) for (const m of ln.matchAll(/\.src\s*=\s*["'`]([^"'`]+)["'`]/g)) check(f, L, m[1]);
    });
  }
  return n;
}

/* ---------- --no-sourcemap ---------- */
function modeNoSourcemap(dirs) {
  let n = 0;
  for (const d of dirs) {
    for (const p of walk(path.resolve(cwd, d))) {
      n++;
      if (p.endsWith(".map")) hit(rel(p), 1, "SOURCEMAP");
      else if (/\.(?:js|mjs|css)$/.test(p) && /find|wait-game|wait-board|need-extract|ui2|handlers|[\\/]vendor[\\/]|\/_worker/i.test(p)) {   // vendor＝自架的地圖程式庫（原版帶 sourceMappingURL，要拿掉）
        const t = readSafe(p);
        if (t && /\/\/# sourceMappingURL=|\/\*# sourceMappingURL=/.test(t)) hit(rel(p), 1, "SOURCEMAP");
      }
    }
  }
  return n;
}

/* ---------- main ---------- */
const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let scanned = 0;
  if (flag("--no-sourcemap")) {
    const i = argv.indexOf("--no-sourcemap");
    const VAL_OPTS = ["--denylist", "--base", "--dist", "--bundle", "--min-files"];
    const dirs = argv.slice(i + 1).filter((a, k, arr) => !a.startsWith("--") && !VAL_OPTS.includes(arr[k - 1]));
    if (!dirs.length) fail2("--no-sourcemap 後面要接要檢查的目錄。");
    scanned += modeNoSourcemap(dirs);
  }
  if (flag("--hosts")) {
    const dist = opt("--dist");
    if (!dist) fail2("--hosts 需要 --dist <目錄>。");
    scanned += modeHosts(path.resolve(cwd, dist));
  } else if (flag("--diff") || flag("--dist") || flag("--bundle") || flag("--samples")) {
    const rules = loadDenylist();
    if (flag("--samples")) {
      const s = opt("--samples");
      if (!s) fail2("--samples 需要目錄。");
      for (const p of walk(path.resolve(cwd, s))) {
        const text = readSafe(p);
        if (text === null) continue;
        scanText(rel(p), text, rules, { allowT3: false });
        scanned++;
      }
    }
    if (flag("--diff")) scanned += modeDiff(rules);
    if (flag("--dist")) {
      const dist = opt("--dist");
      if (!dist) fail2("--dist 需要目錄。");
      scanned += modeDist(rules, path.resolve(cwd, dist));
    }
    if (flag("--bundle")) {
      const b = opt("--bundle");
      if (!b) fail2("--bundle 需要目錄。");
      scanned += modeBundle(rules, path.resolve(cwd, b));
    }
  } else if (!flag("--no-sourcemap")) {
    fail2("用法：--diff | --dist <dir> | --bundle <dir> | --samples <dir> | --hosts --dist <dir> | --no-sourcemap <dir>...（--denylist <檔>、--min-files N）");
  }

  // 掃到的檔案數太少＝路徑錯、目錄不存在、建置產物是空的：一律當失敗，不能印「乾淨」（紅隊 RT-19）
  const minFiles = parseInt(opt("--min-files") || "1", 10);
  const needsCount = flag("--dist") || flag("--bundle") || flag("--hosts") || flag("--no-sourcemap");
  if (needsCount && !(scanned >= (Number.isFinite(minFiles) && minFiles > 0 ? minFiles : 1))) {
    console.error(`[leak-audit] 只掃到 ${scanned} 個檔案／項目（至少要 ${minFiles}）：目錄不存在、路徑錯了或建置產物是空的，不能當成乾淨。`);
    process.exit(1);
  }
  if (hits.length) {
    console.error(`[leak-audit] 命中 ${hits.length} 處（只列位置與規則編號）：`);
    for (const h of hits) console.error("  " + h);
    process.exit(1);
  }
  console.log(`[leak-audit] 乾淨（掃了 ${scanned} 個檔案／項目）`);
}
