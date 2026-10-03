#!/usr/bin/env node
/**
 * fix-cjk-punct.mjs — 中文旁邊的半形標點換全形（台帳 F112）
 *
 * 預設只預覽（dry-run），加 --write 才寫回。
 *
 *   node scripts/fix-cjk-punct.mjs                 # 預覽（每篇列前 3 處）
 *   node scripts/fix-cjk-punct.mjs --verbose       # 預覽（列全部）
 *   node scripts/fix-cjk-punct.mjs --write         # 寫回
 *   node scripts/fix-cjk-punct.mjs --skip a.md,b.md  # 額外跳過的檔（整篇）
 *   node scripts/fix-cjk-punct.mjs --keep-head a.md  # 這些檔只改內文與 faqSchema，不動 title/description
 *
 * 換法（只換「前後至少一邊緊貼中文」的）：
 *   ? → ？   , → ，（不是「、」）   : → ：   ; → ；
 *   一對半形括號 ( ) 只要裡面有中文、或前後緊貼中文 → （ ）
 *   換成全形後，後面緊接的半形空白一併拿掉（行尾空白保留，避免吃掉 markdown 換行）
 * 不動：千分位（1,500）、英數之間的標點、時間 10:30、程式碼區塊、行內 code、
 *       網址、markdown 連結目標 ](...)、HTML 標籤／註解／實體（&nbsp;）。
 *
 * 範圍：src/content/posts/*.md
 *   - frontmatter 只處理 title、description，以及 faqSchema 裡的 name（問題）與 text（答案）
 *   - 其餘 frontmatter 欄位（含 modDatetime）一律不碰
 *   - markdown 內文
 * 跳過：底線開頭的檔、凍結三篇（community-city-classic、term-05-eaves、faq-09-escrow-guarantee）。
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const VERBOSE = args.includes("--verbose");
const listArg = name => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1].split(",").map(s => s.trim()).filter(Boolean) : [];
};
const EXTRA_SKIP = new Set(listArg("--skip"));
const KEEP_HEAD = new Set(listArg("--keep-head"));

const POSTS_DIR = path.resolve("src/content/posts");
const FROZEN = new Set([
  "community-city-classic.md",
  "term-05-eaves.md",
  "faq-09-escrow-guarantee.md",
]);

// 中日韓文字＋中文標點＋全形字元
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
const isCjk = ch => !!ch && CJK.test(ch);
const FULL = { "?": "？", ",": "，", ":": "：", ";": "；" };

// ---- 遮罩：把不能動的片段換成私用區佔位符 ----
function mask(line, store) {
  const put = s => {
    store.push(s);
    return `${store.length - 1}`;
  };
  return line
    .replace(/<!--[\s\S]*?-->/g, put) // HTML 註解
    .replace(/`+[^`]*`+/g, put) // 行內 code
    .replace(/<\/?[a-zA-Z][^>]*>/g, put) // HTML 標籤（含屬性）
    .replace(/<https?:\/\/[^>]+>/g, put) // autolink
    .replace(/\]\([^)]*\)/g, put) // markdown 連結／圖片目標
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/g, put) // 參考式連結定義
    .replace(/https?:\/\/[\x21-\x7e]+/g, put) // 裸網址（只吃 ASCII）
    .replace(/&[a-zA-Z0-9#]+;/g, put); // HTML 實體
}
const unmask = (line, store) => line.replace(/(\d+)/g, (_, i) => store[Number(i)]);

/** 換一行（已遮罩前的原文），回傳 { out, hits[] } */
/** 換到穩定為止（巢狀括號、換完冒號後才緊貼中文的括號，要多跑一輪） */
function fixLine(line) {
  let cur = line;
  const hitsAll = [];
  for (let k = 0; k < 4; k++) {
    const { out, hits } = fixLineOnce(cur);
    if (!hits.length) break;
    cur = out;
    hitsAll.push(...hits);
  }
  return { out: cur, hits: hitsAll };
}

function fixLineOnce(line) {
  // 證號／經紀業名稱那幾行整行不動（台帳 X004／X005 等景泰確認寫法後另外處理）
  if (/登字第|彰縣字|證號/.test(line)) return { out: line, hits: [] };
  const store = [];
  let s = mask(line, store);
  const hits = [];

  // 1) 括號：同一行、不巢狀的一對
  s = s.replace(/\(([^()\n]*)\)/g, (m, inner, off, all) => {
    if (!inner.trim()) return m;
    const prev = all[off - 1];
    const next = all[off + m.length];
    const innerVisible = inner.replace(/\d+/g, "");
    // 算式括號（裡面沒中文、有運算符）不動，避免「(1,380 − 190) ÷ (42 − 8)」換一半
    const isFormula = !CJK.test(innerVisible) && /[+−×÷=]|\s-\s/.test(innerVisible);
    if (isFormula) return m;
    if (CJK.test(innerVisible) || isCjk(prev) || isCjk(next)) {
      hits.push(m);
      return `（${inner}）`;
    }
    return m;
  });

  // 1b) 一半全形一半半形的括號：（…) → （…）、(…） → （…）
  s = s.replace(/（([^（）()\n]*)\)/g, (m, inner) => {
    hits.push(m);
    return `（${inner}）`;
  });
  s = s.replace(/\(([^（）()\n]*)）/g, (m, inner) => {
    hits.push(m);
    return `（${inner}）`;
  });
  // 1c) 全形括號旁的半形空白：中文 （ → 中文（、） 中文 → ）中文（只動這次換過的，靠 hits 判斷有沒有換）
  if (hits.length) {
    s = s.replace(/([㐀-䶿一-鿿豈-﫿]) +（/g, "$1（");
    s = s.replace(/） +(?=[^\s|])/g, "）");
  }

  // 2) ? , : ;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (FULL[ch]) {
      // 跳過 markdown 強調符號再判斷：「**重點**:」的冒號也算緊貼中文
      let p = i - 1;
      while (p >= 0 && /[*_~]/.test(s[p])) p--;
      let n = i + 1;
      while (n < s.length && /[*_~]/.test(s[n])) n++;
      const prev = s[p];
      const next = s[n];
      // 千分位與英數之間：前後都不是中文就不動（1,500、10:30、a,b）
      if (isCjk(prev) || isCjk(next)) {
        out += FULL[ch];
        hits.push(`${prev ?? ""}${ch}${next ?? ""}`);
        // 後面緊接的半形空白拿掉（但行尾空白保留）
        let j = i + 1;
        while (s[j] === " " || s[j] === "\t") j++;
        if (j > i + 1 && j < s.length) i = j - 1;
        continue;
      }
    }
    out += ch;
  }
  return { out: unmask(out, store), hits };
}

const HEAD_KEYS = /^(title|description):(\s*)(.*)$/;

function processFile(file, name) {
  const raw = fs.readFileSync(file, "utf8");
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const text = hasBom ? raw.slice(1) : raw;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;

  const keepHead = KEEP_HEAD.has(name);
  const hitsAll = [];
  const apply = idx => {
    const { out, hits } = fixLine(lines[idx]);
    if (hits.length) {
      lines[idx] = out;
      hitsAll.push(...hits);
    }
  };
  const indentOf = l => l.match(/^(\s*)/)[1].length;

  // ---- frontmatter ----
  let inFaq = false;
  for (let i = 1; i < end; i++) {
    const l = lines[i];
    if (/^faqSchema:/.test(l)) {
      inFaq = true;
      continue;
    }
    if (inFaq && /^\S/.test(l)) inFaq = false;

    let targetIndent = -1;
    let valueStart = -1;
    const head = l.match(HEAD_KEYS);
    if (head && !keepHead) {
      targetIndent = 0;
      valueStart = head[1].length + 1 + head[2].length;
    } else if (inFaq) {
      const m = l.match(/^(\s*(?:-\s+)?)(name|text):(\s*)(.*)$/);
      if (m) {
        targetIndent = indentOf(l.replace(/-/, " "));
        valueStart = m[1].length + m[2].length + 1 + m[3].length;
      }
    }
    if (valueStart < 0) continue;

    // 只換「值」的部分，key 不碰
    const keyPart = l.slice(0, valueStart);
    const valPart = l.slice(valueStart);
    if (!/^[>|][-+]?\d*\s*$/.test(valPart)) {
      const { out, hits } = fixLine(valPart);
      if (hits.length) {
        lines[i] = keyPart + out;
        hitsAll.push(...hits);
      }
    }
    // 續行（block scalar 或 plain 多行）：縮排比 key 深、且不是新的 key / list item
    let j = i + 1;
    while (j < end) {
      const c = lines[j];
      if (!c.trim()) {
        j++;
        continue;
      }
      if (indentOf(c) <= targetIndent) break;
      if (/^\s*(-\s|[\w@'"][\w@'" -]*:\s|[\w@'"][\w@'" -]*:$)/.test(c)) break;
      apply(j);
      j++;
    }
    i = j - 1;
  }

  // ---- 內文 ----
  let fence = null;
  let rawBlock = null;
  for (let i = end + 1; i < lines.length; i++) {
    const l = lines[i];
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    if (rawBlock) {
      if (new RegExp(`</${rawBlock}>`, "i").test(l)) rawBlock = null;
      continue;
    }
    const rb = l.match(/<(script|style|pre)\b/i);
    if (rb && !new RegExp(`</${rb[1]}>`, "i").test(l)) {
      rawBlock = rb[1];
      continue;
    }
    apply(i);
  }

  if (!hitsAll.length) return null;
  return { next: (hasBom ? "﻿" : "") + lines.join(eol), hits: hitsAll };
}

const files = fs
  .readdirSync(POSTS_DIR)
  .filter(f => f.endsWith(".md") && !f.startsWith("_") && !FROZEN.has(f) && !EXTRA_SKIP.has(f))
  .sort();

let changedFiles = 0;
let total = 0;
for (const f of files) {
  const res = processFile(path.join(POSTS_DIR, f), f);
  if (!res) continue;
  changedFiles++;
  total += res.hits.length;
  const sample = VERBOSE ? res.hits : res.hits.slice(0, 3);
  console.log(`${WRITE ? "✏️ " : "👀"} ${f}  (${res.hits.length} 處)  ${sample.join(" ｜ ")}`);
  if (WRITE) fs.writeFileSync(path.join(POSTS_DIR, f), res.next, "utf8");
}
console.log(`\n${WRITE ? "已寫回" : "預覽（加 --write 才寫回）"}：${changedFiles} 篇、${total} 處`);
