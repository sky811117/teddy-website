#!/usr/bin/env node
/**
 * normalize-tags.mjs — 一次性統一文章 tags（台帳 F064）
 *
 * 預設只預覽（dry-run），加 --write 才寫回。
 *
 *   node scripts/normalize-tags.mjs           # 預覽
 *   node scripts/normalize-tags.mjs --write   # 寫回
 *
 * 規則：
 *   1. 9 組短寫區名 → 「X區」：梧棲、北屯、西屯、南屯、太平、大里、烏日、豐原、潭子
 *   2. 「利率」「房貸利率」→「房貸」；「成屋」→「中古屋」
 *   3. 拿掉年份標籤「2026」
 *   4. 改完同一篇出現重複 tag 就去重（保留第一次出現的位置）
 *   ⛔ 「青安3.0」和「新青安」不合併（兩個不同時期的政策）
 *
 * 只動 frontmatter 的 tags 區塊，其他行（含 modDatetime）一律不碰。
 * 保留原本寫法：縮排 `  - x`／不縮排 `- x`／行內 `[a, b]`、引號樣式、換行符（LF/CRLF）。
 * 跳過：底線開頭的檔、凍結三篇（community-city-classic、term-05-eaves、faq-09-escrow-guarantee）。
 * 寫回用 utf-8 不帶 BOM（原檔有 BOM 就保留）。
 */
import fs from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");
const POSTS_DIR = path.resolve("src/content/posts");
const FROZEN = new Set([
  "community-city-classic.md",
  "term-05-eaves.md",
  "faq-09-escrow-guarantee.md",
]);

const SHORT_DISTRICTS = ["梧棲", "北屯", "西屯", "南屯", "太平", "大里", "烏日", "豐原", "潭子"];
const MAP = new Map([
  ...SHORT_DISTRICTS.map(d => [d, `${d}區`]),
  ["利率", "房貸"],
  ["房貸利率", "房貸"],
  ["成屋", "中古屋"],
]);
const DROP = new Set(["2026"]);

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return { value: t.slice(1, -1), quote: t[0] };
  }
  return { value: t, quote: "" };
}
const requote = (value, quote) => (quote ? `${quote}${value}${quote}` : value);

/** 回傳 { tags: [{value, quote}], newTags } 的轉換結果 */
function transform(items) {
  const out = [];
  const seen = new Set();
  const changes = [];
  for (const it of items) {
    if (DROP.has(it.value)) {
      changes.push(`-${it.value}`);
      continue;
    }
    const mapped = MAP.get(it.value) ?? it.value;
    if (mapped !== it.value) changes.push(`${it.value}→${mapped}`);
    if (seen.has(mapped)) {
      changes.push(`去重:${mapped}`);
      continue;
    }
    seen.add(mapped);
    // 映射後的值沒有引號需求時沿用原引號樣式
    out.push({ value: mapped, quote: it.quote });
  }
  return { out, changes };
}

function processFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const text = hasBom ? raw.slice(1) : raw;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;

  let changesAll = [];
  for (let i = 1; i < end; i++) {
    const head = lines[i].match(/^tags:\s*(.*)$/);
    if (!head) continue;
    const inline = head[1].trim();
    if (inline.startsWith("[")) {
      const inner = inline.replace(/^\[/, "").replace(/\]\s*$/, "");
      const items = inner.split(",").map(s => s.trim()).filter(Boolean).map(unquote);
      const { out, changes } = transform(items);
      if (changes.length) {
        lines[i] = `tags: [${out.map(o => requote(o.value, o.quote)).join(", ")}]`;
        changesAll = changes;
      }
    } else {
      const start = i + 1;
      let j = start;
      const items = [];
      let indent = null;
      while (j < end) {
        const m = lines[j].match(/^(\s*)-\s+(.*)$/);
        if (!m) break;
        if (indent === null) indent = m[1];
        items.push(unquote(m[2]));
        j++;
      }
      const { out, changes } = transform(items);
      if (changes.length) {
        const newLines = out.map(o => `${indent ?? ""}- ${requote(o.value, o.quote)}`);
        lines.splice(start, j - start, ...newLines);
        changesAll = changes;
      }
    }
    break;
  }
  if (!changesAll.length) return null;
  const next = (hasBom ? "﻿" : "") + lines.join(eol);
  return { next, changes: changesAll };
}

const files = fs
  .readdirSync(POSTS_DIR)
  .filter(f => f.endsWith(".md") && !f.startsWith("_") && !FROZEN.has(f))
  .sort();

let changed = 0;
for (const f of files) {
  const full = path.join(POSTS_DIR, f);
  const res = processFile(full);
  if (!res) continue;
  changed++;
  console.log(`${WRITE ? "✏️ " : "👀"} ${f}: ${res.changes.join("、")}`);
  if (WRITE) fs.writeFileSync(full, res.next, "utf8");
}
console.log(`\n${WRITE ? "已寫回" : "預覽（加 --write 才寫回）"}：${changed} 篇`);
