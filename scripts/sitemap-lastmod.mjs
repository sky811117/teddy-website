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
 * 收集個別 posts / properties 頁的「URL → Date」（buildLastmodMap 與
 * buildSectionLastmod 共用底層，避免掃兩次目錄）。
 * @param {string} base 不含尾斜線的站點 URL
 * @returns {{posts: {url: string, date: Date}[], properties: {url: string, date: Date}[]}}
 */
function collectEntries(base) {
  const posts = [];
  const properties = [];

  // posts：URL = base + /posts/<slug>/，lastmod = modDatetime ?? pubDatetime
  for (const name of listFirstLevelMd(POSTS_DIR)) {
    try {
      const text = readFileSync(new URL(name, POSTS_DIR), "utf-8");
      const meta = parseScalarFrontmatter(text);
      if (!meta) continue;

      let slug = meta.slug;
      if (!slug) slug = slugifyStr(name.replace(/\.mdx?$/, ""));

      const lastmod = parseDate(meta.modDatetime) ?? parseDate(meta.pubDatetime);
      if (!lastmod) continue;

      posts.push({ url: `${base}/posts/${slug}/`, date: lastmod });
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

      properties.push({ url: `${base}/properties/${id}/`, date: lastmod });
    } catch (err) {
      console.warn(`[sitemap-lastmod] 解析 property 失敗 ${name}: ${err.message}`);
    }
  }

  return { posts, properties };
}

function maxDate(arr) {
  let m = null;
  for (const { date } of arr) {
    if (!m || date > m) m = date;
  }
  return m;
}

/**
 * @param {string} siteUrl config.site.url（自帶尾斜線）
 * @returns {Map<string, Date>} 個別頁 + 列表頁（首頁 / /posts/ / /properties/ / /areas/）→ lastmod
 *
 * 列表頁的 lastmod = 該 section 最新一筆內容的日期（清單頁在最新內容發布時即更新）。
 * 分頁(/posts/2/)與個別區域頁(/areas/north-tun/)無法預先枚舉，交給 astro.config.ts
 * serialize 用 buildSectionLastmod 做前綴 fallback。
 */
export function buildLastmodMap(siteUrl) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const { posts, properties } = collectEntries(base);
  const map = new Map();

  for (const { url, date } of posts) map.set(url, date);
  for (const { url, date } of properties) map.set(url, date);

  // 列表頁（精確 URL）
  const postsLatest = maxDate(posts);
  const propsLatest = maxDate(properties);
  const allLatest = [postsLatest, propsLatest].filter(Boolean).sort((a, b) => b - a)[0] || null;
  if (postsLatest) map.set(`${base}/posts/`, postsLatest);
  if (propsLatest) {
    map.set(`${base}/properties/`, propsLatest);
    map.set(`${base}/areas/`, propsLatest); // 區域列表頁列的是物件
  }
  if (allLatest) map.set(`${base}/`, allLatest); // 首頁取全站最新

  return map;
}

/**
 * 給 serialize 對「分頁 / 個別區域頁」做前綴 fallback 用的各 section 最新日期。
 * @param {string} siteUrl
 * @returns {{posts: Date|null, properties: Date|null, all: Date|null}}
 */
export function buildSectionLastmod(siteUrl) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const { posts, properties } = collectEntries(base);
  const postsLatest = maxDate(posts);
  const propsLatest = maxDate(properties);
  const all = [postsLatest, propsLatest].filter(Boolean).sort((a, b) => b - a)[0] || null;
  return { posts: postsLatest, properties: propsLatest, all };
}

/**
 * 只掛 1 篇文章的 tag（薄內容聚合頁）— 用來把它們排除在 sitemap 之外。
 *
 * 為什麼要做：sitemap 959 筆裡有 360 筆是 tag 頁（38%），其中大多數只掛一篇文章，
 * 內容跟那篇文章的列表項幾乎一樣。爬取預算浪費在這裡，真正該被收錄的物件頁與
 * 文章反而排在後面。tag 頁本身保留（站內導覽還用得到），只是不主動送進 sitemap。
 *
 * 回傳 slug 化後的 tag 集合，跟 /tags/<slug>/ 的網址一致。
 */
export function buildThinTagSlugs() {
  const counts = new Map();

  for (const name of listFirstLevelMd(POSTS_DIR)) {
    let text;
    try {
      text = readFileSync(new URL(name, POSTS_DIR), "utf-8");
    } catch {
      continue;
    }
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) continue;
    const fm = m[1];

    // draft 不算 —— 沒公開的文章不該撐起一個聚合頁
    if (/^draft:\s*true\s*$/m.test(fm)) continue;

    // tags: 底下的 "- xxx" 清單，遇到下一個頂層 key 就停
    const lines = fm.split(/\r?\n/);
    let inTags = false;
    for (const line of lines) {
      if (/^tags:\s*$/.test(line)) {
        inTags = true;
        continue;
      }
      if (!inTags) continue;
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item) {
        const tag = item[1].replace(/^["']|["']$/g, "").trim();
        if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
        continue;
      }
      if (/^\S/.test(line)) break; // 下一個頂層 key
    }
  }

  const thin = new Set();
  for (const [tag, n] of counts) {
    if (n <= 1) thin.add(slugifyStr(tag));
  }
  return thin;
}
