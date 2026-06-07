/**
 * sitemap-lastmod — build-time helper：手刻 regex 解析 posts / properties
 * frontmatter，產出 sitemap <lastmod> 用的「完整 URL → Date」對照表。
 *
 * 沿用 lint-seo.mjs 的 frontmatter 解析套路（不引額外依賴）。
 * 由 astro.config.ts 在 defineConfig 之前呼叫，serialize(item) 時查表塞 lastmod。
 *
 * 設計原則：
 * - 零新依賴（slugify / lodash.kebabcase 已是 repo 既有 deps，跟 utils/slugify.ts 同來源）。
 * - 單檔解析失敗只 console.warn 跳過，絕不讓 build 掛掉。
 */
import { readdirSync, readFileSync } from "node:fs";
import kebabcase from "lodash.kebabcase";
import slugify from "slugify";

const POSTS_DIR = new URL("../src/content/posts/", import.meta.url);
const PROPERTIES_DIR = new URL("../src/content/properties/", import.meta.url);

function stripQuotes(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

/**
 * 只取頂層 scalar 欄位（slug / pubDatetime / modDatetime / lastSeen）。
 * 不處理 list / 多行 scalar — 這幾個欄位都是單行 scalar，夠用。
 */
function parseScalarFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    // 只認頂層（無縮排）的 key: value，跳過 list item 與縮排續行
    const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!km) continue;
    const key = km[1];
    const v = km[2].trim();
    if (v === "") continue; // 後續是 list / 縮排 scalar，這裡用不到
    meta[key] = stripQuotes(v);
  }
  return meta;
}

// 與 src/utils/slugify.ts 的 hybrid 邏輯一致
const hasNonLatin = str => /[^\x00-\x7F]/.test(str);
function slugifyStr(str) {
  if (hasNonLatin(str)) return kebabcase(str);
  return slugify(str, { lower: true });
}

/**
 * 用 JS Date 建構子解析日期字串。
 * posts 可能是空格分隔（"2026-05-22 08:08:54"）或 T 分隔（"2026-06-04T09:00:00+08:00"），
 * properties 是 T 分隔；兩種 Date 都能正確解析。
 * 無效值回 null。
 */
function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function listFirstLevelMd(dirUrl) {
  let entries;
  try {
    entries = readdirSync(dirUrl, { withFileTypes: true });
  } catch (err) {
    console.warn(`[sitemap-lastmod] 讀目錄失敗 ${dirUrl.pathname}: ${err.message}`);
    return [];
  }
  return entries
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => /\.mdx?$/.test(name) && !name.startsWith("_"));
}

/**
 * @param {string} siteUrl config.site.url（自帶尾斜線）
 * @returns {Map<string, Date>} 完整 URL（含尾斜線）→ lastmod Date
 */
export function buildLastmodMap(siteUrl) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const map = new Map();

  // posts：URL = base + /posts/<slug>/，lastmod = modDatetime ?? pubDatetime
  for (const name of listFirstLevelMd(POSTS_DIR)) {
    try {
      const text = readFileSync(new URL(name, POSTS_DIR), "utf-8");
      const meta = parseScalarFrontmatter(text);
      if (!meta) continue;

      let slug = meta.slug;
      if (!slug) {
        const fileBase = name.replace(/\.mdx?$/, "");
        slug = slugifyStr(fileBase);
      }

      const lastmod = parseDate(meta.modDatetime) ?? parseDate(meta.pubDatetime);
      if (!lastmod) continue;

      map.set(`${base}/posts/${slug}/`, lastmod);
    } catch (err) {
      console.warn(`[sitemap-lastmod] 解析 post 失敗 ${name}: ${err.message}`);
    }
  }

  // properties：URL = base + /properties/<檔名去副檔名>/
  // lastmod = modDatetime ?? lastSeen ?? pubDatetime
  for (const name of listFirstLevelMd(PROPERTIES_DIR)) {
    try {
      const text = readFileSync(new URL(name, PROPERTIES_DIR), "utf-8");
      const meta = parseScalarFrontmatter(text);
      if (!meta) continue;

      const id = name.replace(/\.mdx?$/, "");
      const lastmod =
        parseDate(meta.modDatetime) ??
        parseDate(meta.lastSeen) ??
        parseDate(meta.pubDatetime);
      if (!lastmod) continue;

      map.set(`${base}/properties/${id}/`, lastmod);
    } catch (err) {
      console.warn(`[sitemap-lastmod] 解析 property 失敗 ${name}: ${err.message}`);
    }
  }

  return map;
}
