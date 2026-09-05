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
 * - 跟 src/utils/postFilter.ts 同一套「什麼算已發布」：draft:true 不算、
 *   pubDatetime − scheduledPostMargin 還沒到的排程文不算。2026-09-05 教訓：
 *   排程文（9/8）的日期被撿進 /posts/ 與首頁的 lastmod，線上 47 筆 lastmod 是未來日期，
 *   Google 明講 lastmod 不可信就整份忽略。
 * - 目錄只掃一次（collectEntries 結果 cache 在模組層），buildLastmodMap /
 *   buildSectionLastmod / buildThinTagSlugs 共用。
 */
import { readdirSync, readFileSync } from "node:fs";
import kebabcase from "lodash.kebabcase";
import slugify from "slugify";

const POSTS_DIR = new URL("../src/content/posts/", import.meta.url);
const PROPERTIES_DIR = new URL("../src/content/properties/", import.meta.url);

// 跟 astro-paper.config.ts posts.scheduledPostMargin 同值（15 分鐘）；
// astro.config.ts 會把 config 的值傳進來，這裡只是沒傳時的 fallback。
const DEFAULT_SCHEDULED_POST_MARGIN = 15 * 60 * 1000;

// tag 聚合頁掛不到這個篇數 → 視為薄內容，不進 sitemap（tag 頁模板同步輸出 noindex）
export const THIN_TAG_MIN_POSTS = 3;

function stripQuotes(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/**
 * 只取頂層 scalar 欄位（slug / pubDatetime / modDatetime / lastSeen / draft）。
 * 不處理 list / 多行 scalar — 這幾個欄位都是單行 scalar，夠用。
 */
function parseScalarFrontmatter(fm) {
  const meta = {};
  for (const line of fm.split(/\r?\n/)) {
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

/**
 * 解析 frontmatter 的 tags。同時支援三種寫法（repo 內三種都有）：
 *   tags:            tags:            tags: [a, b, "c"]
 *     - a            - a
 *     - b            - b
 * 2026-09-05 教訓：舊版只認縮排的 `  - x`，遇到不縮排的 `- x` 就 break，
 * 182 篇裡 109 篇的 tag 完全沒被計數 → thin set 算錯，把 community-review(16 篇)
 * 這種真聚合頁踢出 sitemap，反而讓 87 個只掛 1 篇的 tag 留在裡面。
 */
function parseTags(fm) {
  const lines = fm.split(/\r?\n/);
  const tags = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^tags:\s*(.*)$/);
    if (!head) continue;
    const inline = head[1].trim();
    if (inline) {
      // 行內陣列 tags: [a, b]
      const arr = inline.match(/^\[(.*)\]$/);
      if (arr) {
        for (const raw of arr[1].split(",")) {
          const t = stripQuotes(raw.trim());
          if (t) tags.push(t);
        }
      } else {
        const t = stripQuotes(inline);
        if (t) tags.push(t);
      }
      break;
    }
    // 區塊清單：接下來每一行 `- x`（縮排與否都算），遇到下一個頂層 key 就停
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j].match(/^\s*-\s+(.+?)\s*$/);
      if (item) {
        const t = stripQuotes(item[1].trim());
        if (t) tags.push(t);
        continue;
      }
      if (/^\s*$/.test(lines[j])) continue;
      break; // 下一個頂層 key（或別的結構）
    }
    break;
  }
  return tags;
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
 * 跟 src/utils/postFilter.ts 同一條規則：
 *   已發布 = !draft && now > pubDatetime − scheduledPostMargin
 */
function isPublished(meta, now, margin) {
  if (meta.draft === "true") return false;
  const pub = parseDate(meta.pubDatetime);
  if (!pub) return false;
  return now > pub.getTime() - margin;
}

/**
 * 掃一次 posts / properties 目錄，回傳已發布內容的清單。
 * 結果依 (now, margin) cache，astro.config.ts 內三個 build* 函式共用，不重複讀檔。
 *
 * @returns {{
 *   posts: {url: string, date: Date, tags: string[]}[],
 *   properties: {url: string, date: Date}[]
 * }}
 */
let cache = null;
function collectEntries(base, opts) {
  const now = opts?.now ?? Date.now();
  const margin = opts?.scheduledPostMargin ?? DEFAULT_SCHEDULED_POST_MARGIN;
  const key = `${base}|${margin}`;
  if (cache && cache.key === key) return cache.value;

  const posts = [];
  const properties = [];

  // posts：URL = base + /posts/<slug>/，lastmod = modDatetime ?? pubDatetime
  for (const name of listFirstLevelMd(POSTS_DIR)) {
    try {
      const text = readFileSync(new URL(name, POSTS_DIR), "utf-8");
      const fm = splitFrontmatter(text);
      if (fm === null) continue;
      const meta = parseScalarFrontmatter(fm);

      // 草稿 / 還沒到期的排程文：頁面不存在，日期也不能撐起列表頁的 lastmod
      if (!isPublished(meta, now, margin)) continue;

      let slug = meta.slug;
      if (!slug) slug = slugifyStr(name.replace(/\.mdx?$/, ""));

      const pub = parseDate(meta.pubDatetime);
      let mod = parseDate(meta.modDatetime);
      // modDatetime 也可能被寫成未來（手誤 / 時區），超前就退回 pubDatetime
      if (mod && mod.getTime() > now) mod = null;
      const lastmod = mod ?? pub;
      if (!lastmod) continue;

      posts.push({ url: `${base}/posts/${slug}/`, date: lastmod, tags: parseTags(fm) });
    } catch (err) {
      console.warn(`[sitemap-lastmod] 解析 post 失敗 ${name}: ${err.message}`);
    }
  }

  // properties：URL = base + /properties/<檔名去副檔名>/
  // lastmod = modDatetime ?? lastSeen ?? pubDatetime（都是過去日期；超前就 clamp）
  for (const name of listFirstLevelMd(PROPERTIES_DIR)) {
    try {
      const text = readFileSync(new URL(name, PROPERTIES_DIR), "utf-8");
      const fm = splitFrontmatter(text);
      if (fm === null) continue;
      const meta = parseScalarFrontmatter(fm);

      const id = name.replace(/\.mdx?$/, "");
      let lastmod =
        parseDate(meta.modDatetime) ??
        parseDate(meta.lastSeen) ??
        parseDate(meta.pubDatetime);
      if (!lastmod) continue;
      if (lastmod.getTime() > now) lastmod = new Date(now);

      properties.push({ url: `${base}/properties/${id}/`, date: lastmod });
    } catch (err) {
      console.warn(`[sitemap-lastmod] 解析 property 失敗 ${name}: ${err.message}`);
    }
  }

  const value = { posts, properties };
  cache = { key, value };
  return value;
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
 * @param {{scheduledPostMargin?: number, now?: number}} [opts]
 * @returns {Map<string, Date>} 個別頁 + 列表頁（首頁 / /posts/ / /properties/ / /areas/）→ lastmod
 *
 * 列表頁的 lastmod = 該 section 最新一筆「已發布」內容的日期。
 * 分頁(/posts/2/)與個別區域頁(/areas/north-tun/)無法預先枚舉，交給 astro.config.ts
 * serialize 用 buildSectionLastmod 做前綴 fallback。
 */
export function buildLastmodMap(siteUrl, opts) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const { posts, properties } = collectEntries(base, opts);
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
 * @param {{scheduledPostMargin?: number, now?: number}} [opts]
 * @returns {{posts: Date|null, properties: Date|null, all: Date|null}}
 */
export function buildSectionLastmod(siteUrl, opts) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const { posts, properties } = collectEntries(base, opts);
  const postsLatest = maxDate(posts);
  const propsLatest = maxDate(properties);
  const all = [postsLatest, propsLatest].filter(Boolean).sort((a, b) => b - a)[0] || null;
  return { posts: postsLatest, properties: propsLatest, all };
}

/**
 * 每個 tag（slug 化）掛了幾篇已發布文章。
 * @param {{scheduledPostMargin?: number, now?: number}} [opts]
 * @returns {Map<string, number>}
 */
export function buildTagCounts(opts) {
  const { posts } = collectEntries("", opts);
  const counts = new Map();
  for (const { tags } of posts) {
    // 同一篇文章同一個 slug 只算一次（「北屯」「北屯區」是不同 slug，這裡不合併）
    const seen = new Set();
    for (const tag of tags) {
      const slug = slugifyStr(tag);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      counts.set(slug, (counts.get(slug) || 0) + 1);
    }
  }
  return counts;
}

/**
 * 掛不到 THIN_TAG_MIN_POSTS 篇文章的 tag（薄內容聚合頁）— 用來把它們排除在 sitemap 之外。
 *
 * 為什麼要做：sitemap 884 筆裡有 257 筆是 tag 頁（29%），其中大多數只掛一兩篇文章，
 * 內容跟那篇文章的列表項幾乎一樣。爬取預算浪費在這裡，真正該被收錄的物件頁與
 * 文章反而排在後面。tag 頁本身保留（站內導覽還用得到），只是不主動送進 sitemap，
 * 並由 src/pages/tags/[tag]/[...page].astro 對同一批頁輸出 noindex,follow。
 *
 * 驗收：thin set 大小 ≈ 掛 1–2 篇的 tag 數（用 src/utils/getUniqueTags.ts 的 count 對）。
 *
 * @param {{scheduledPostMargin?: number, now?: number}} [opts]
 * @returns {Set<string>} slug 化後的 tag 集合，跟 /tags/<slug>/ 的網址一致。
 */
export function buildThinTagSlugs(opts) {
  const thin = new Set();
  for (const [slug, n] of buildTagCounts(opts)) {
    if (n < THIN_TAG_MIN_POSTS) thin.add(slug);
  }
  return thin;
}
