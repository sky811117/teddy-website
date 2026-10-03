#!/usr/bin/env node
/**
 * Postbuild：
 * 1. dist/_headers.txt → dist/_headers (Cloudflare Pages 要求無副檔名)
 *    workaround：public/_headers 會被 Vite/Rollup 試 parse JS 報錯
 * 2. dist/_redirects.txt → dist/_redirects (同上，301 轉址表)
 *    2026-08-28 實測 public/_redirects 會噴
 *    "Expected ';', '}' or <eof> ... you need plugins to import files that are
 *     not JavaScript"，跟 _headers 是同一個雷，所以比照用 .txt 規避
 * 3. cross-platform copy dist/pagefind → public/pagefind (替代 cp -r)
 * 4. 站內連結補尾斜線 —— Cloudflare Pages 一律 308 轉址到帶尾斜線的網址，
 *    沒補的話每一條內部連結都要先繞一次跳轉。2026-08-29 GSC 網址檢查回報
 *    物件頁「Google 無法辨識的網址／未偵測到任何參照網頁」，這是主因之一。
 * 5. （2026-10-03）dist/sitemap.xml：從 sitemap-0.xml 複製一份同內容的新網址給 GSC
 * 6. （2026-10-03）下架／售出物件 301 到同區列表頁，接在 dist/_redirects 檔尾
 * 7. （2026-10-03）刪掉 dist/properties 裡沒產頁的物件資料夾照片（只動 dist，不動 public/）
 * 8. （2026-10-03）掃 dist HTML 裡「本站絕對網址少尾斜線」的地方，只印 WARN
 *
 * 除了 _redirects 超過 2,000 條規則會刻意讓 build 失敗之外，5–8 任何一步出錯
 * 都只印 WARN，不擋部署。
 *
 * 測試：DIST_DIR=<假 dist 目錄> node scripts/postbuild-headers.mjs
 *   （設了 DIST_DIR 時不會把 pagefind 複製回 repo 的 public/）
 *
 * Windows + Linux 都能跑。
 */
import { rename, cp, copyFile, readdir, readFile, writeFile, rm, rmdir, stat } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST = process.env.DIST_DIR
  ? pathToFileURL(path.resolve(process.env.DIST_DIR) + path.sep)
  : new URL("../dist/", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);
const PROPERTIES_SRC = new URL("../src/content/properties/", import.meta.url);
const IS_TAICHUNG_TS = new URL("../src/utils/isTaichung.ts", import.meta.url);

const warn = msg => console.warn(`[postbuild] WARN ${msg}`);

async function maybeRename(from, to) {
  const fromUrl = new URL(from, DIST);
  const toUrl = new URL(to, DIST);
  if (!existsSync(fromUrl)) {
    console.log(`[postbuild] skip: ${from} not found`);
    return;
  }
  await rename(fromUrl, toUrl);
  console.log(`[postbuild] ${from} → ${to}`);
}

async function copyPagefind() {
  if (process.env.DIST_DIR) {
    console.log("[postbuild] skip pagefind copy: DIST_DIR 測試模式，不寫 repo 的 public/");
    return;
  }
  const srcUrl = new URL("pagefind", DIST);
  const destUrl = new URL("pagefind", PUBLIC);
  if (!existsSync(srcUrl)) {
    console.log(`[postbuild] skip pagefind: dist/pagefind not found`);
    return;
  }
  // cross-platform recursive copy (Node 16.7+)
  await cp(srcUrl, destUrl, { recursive: true, force: true });
  console.log(`[postbuild] dist/pagefind → public/pagefind (cross-platform copy)`);
}

/**
 * 把 dist 裡所有 HTML 的站內連結補上尾斜線。
 *
 * 只動 href="/..." 這種站內絕對路徑，且：
 *   - 已經有尾斜線的不動
 *   - 帶副檔名的不動（/sitemap-index.xml、/og/xxx.jpg…）
 *   - 帶 # 或 ? 的不動（錨點與查詢字串自己有規則）
 *   - 外部連結、mailto:、tel: 完全不碰（它們不是以 / 開頭）
 */
const SKIP_EXT = /\.[a-zA-Z0-9]{2,5}$/;

function addTrailingSlashes(html) {
  return html.replace(/href="(\/[^"#?]*)"/g, (m, p) => {
    if (p.endsWith("/")) return m;
    if (SKIP_EXT.test(p)) return m;
    return `href="${p}/"`;
  });
}

async function* walkHtml(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const child = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) {
      yield* walkHtml(child);
    } else if (e.name.endsWith(".html")) {
      yield child;
    }
  }
}

async function normalizeInternalLinks() {
  let files = 0;
  let fixed = 0;
  for await (const f of walkHtml(DIST)) {
    const before = await readFile(f, "utf-8");
    const after = addTrailingSlashes(before);
    files++;
    if (after !== before) {
      // 算改了幾條（用長度差推不準，直接比對出現次數）
      const b = (before.match(/href="\/[^"#?]*"/g) || []).filter(
        x => !x.endsWith('/"') && !SKIP_EXT.test(x.slice(6, -1))
      ).length;
      fixed += b;
      await writeFile(f, after, "utf-8");
    }
  }
  console.log(`[postbuild] 站內連結補尾斜線：掃 ${files} 個 HTML、修 ${fixed} 條`);
}

/** dist/sitemap-index.xml 裡所有 <loc>；讀不到回 [] */
function readSitemapIndexLocs() {
  const idx = new URL("sitemap-index.xml", DIST);
  if (!existsSync(idx)) return [];
  const xml = readFileSync(idx, "utf-8");
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, "&"));
}

// ─── 5. /sitemap.xml（F003／F048／F051）─────────────────────────────────
/**
 * GSC 對 sitemap-index.xml／sitemap-0.xml 卡在「無法擷取」，給它一個全新網址。
 * 只有 1 個子 sitemap 時複製 urlset 本體（不要複製 index —— index 裡指的還是卡住的舊網址）；
 * 哪天超過 5 萬筆分成多個子檔，才改複製 index。
 * ⛔ 不要改 @astrojs/sitemap 的檔名（indexnow-submit.mjs 與 _headers 都靠 sitemap-index.xml）。
 */
async function publishSitemapAlias() {
  const locs = readSitemapIndexLocs();
  if (locs.length === 0) {
    console.log("[postbuild] skip sitemap.xml: dist/sitemap-index.xml 不存在或沒有 <loc>");
    return;
  }
  let src;
  if (locs.length === 1) {
    const rel = decodeURIComponent(new URL(locs[0]).pathname).replace(/^\/+/, "");
    src = new URL(rel, DIST);
  } else {
    src = new URL("sitemap-index.xml", DIST);
  }
  if (!existsSync(src)) {
    console.log(`[postbuild] skip sitemap.xml: 找不到來源 ${decodeURIComponent(src.pathname)}`);
    return;
  }
  await copyFile(src, new URL("sitemap.xml", DIST));
  console.log(`[postbuild] ${src.pathname.split("/").pop()} → sitemap.xml（子 sitemap ${locs.length} 份）`);
}

// ─── 6. 下架物件轉址（X020）────────────────────────────────────────────
const REDIRECT_WARN_LINES = 1800;
const REDIRECT_MAX_LINES = 2000; // Cloudflare Pages 靜態規則上限
const WITHDRAWN_BEGIN = "# ── 下架物件自動轉址（postbuild-headers.mjs 產生，勿手改）──";
const WITHDRAWN_END = "# ── 下架物件自動轉址 結束 ──";

/**
 * 中文區名 → 分區 slug。唯一真相是 src/utils/isTaichung.ts 的 TAICHUNG_DISTRICT_SLUGS，
 * .mjs 不能直接 import .ts，所以這裡用 regex 讀那個物件字面值（不另抄一份表）。
 */
function readDistrictSlugs() {
  const map = new Map();
  try {
    const ts = readFileSync(IS_TAICHUNG_TS, "utf-8");
    const block = ts.match(/TAICHUNG_DISTRICT_SLUGS[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? "";
    for (const m of block.matchAll(/["']?([\u4e00-\u9fff]+區)["']?\s*:\s*["']([a-z0-9-]+)["']/g)) {
      map.set(m[1], m[2]);
    }
  } catch (err) {
    warn(`讀不到 isTaichung.ts（${err.message}），下架物件一律導 /properties/`);
  }
  if (map.size === 0) warn("isTaichung.ts 解析不到任何分區 slug，下架物件一律導 /properties/");
  return map;
}

/**
 * 掃 src/content/properties/*.md：status 是 withdrawn 或 sold 的物件，
 * /properties/{id}/ 與 /properties/{id} 都 301 到同區列表頁（該頁這次有產出才導，否則導 /properties/）。
 * 這是使用者體驗與廣告即時性的修補，不是排名修補（Google 常把大量導到分類頁判成 soft 404）。
 * 已知限制：md 被整批刪掉的物件不會有轉址（沒有持久帳本，見 X020 的選配做法）。
 */
async function appendWithdrawnRedirects() {
  const redirectsUrl = new URL("_redirects", DIST);
  let base = existsSync(redirectsUrl) ? await readFile(redirectsUrl, "utf-8") : "";
  // 同一份 dist 重跑時，先拿掉上次接上去的區塊，避免重複
  const bi = base.indexOf(WITHDRAWN_BEGIN);
  if (bi !== -1) {
    const ei = base.indexOf(WITHDRAWN_END, bi);
    base = base.slice(0, bi) + (ei !== -1 ? base.slice(ei + WITHDRAWN_END.length) : "");
    base = base.replace(/\n+$/, "\n");
  }

  let names = [];
  try {
    names = readdirSync(PROPERTIES_SRC).filter(n => /\.mdx?$/.test(n) && !n.startsWith("_"));
  } catch (err) {
    warn(`讀不到 src/content/properties（${err.message}），跳過下架物件轉址`);
    return;
  }
  const slugs = readDistrictSlugs();
  const lines = [];
  let toDistrict = 0;
  let toAll = 0;
  let skippedLive = 0;
  for (const name of names.sort()) {
    const id = name.replace(/\.mdx?$/, "");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue; // 有空白或怪字元的 id 寫進 _redirects 會壞格式
    let fm = "";
    try {
      fm = readFileSync(new URL(name, PROPERTIES_SRC), "utf-8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    } catch {
      continue;
    }
    const status = fm.match(/^status:\s*["']?(\w+)["']?/m)?.[1] ?? "active";
    if (status !== "withdrawn" && status !== "sold") continue;
    // 保險：這次 build 有產出這個物件頁就不轉（轉址會蓋過真的頁面）
    if (existsSync(new URL(`properties/${id}/index.html`, DIST))) {
      skippedLive++;
      continue;
    }
    const district = fm.match(/^district:\s*["']?([^"'\r\n]+)["']?/m)?.[1]?.trim();
    const slug = district ? slugs.get(district) : undefined;
    let target = "/properties/";
    if (slug && existsSync(new URL(`properties/${slug}/index.html`, DIST))) {
      target = `/properties/${slug}/`;
      toDistrict++;
    } else {
      toAll++; // 該區這次沒產分區頁、外縣市、髒值
    }
    lines.push(`/properties/${id}/ ${target} 301`, `/properties/${id} ${target} 301`);
  }

  const head = base === "" || base.endsWith("\n") ? base : `${base}\n`;
  const block = lines.length ? `\n${WITHDRAWN_BEGIN}\n${lines.join("\n")}\n${WITHDRAWN_END}\n` : "";
  const out = head + block;
  const ruleCount = out.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#")).length;
  if (ruleCount > REDIRECT_MAX_LINES) {
    console.error(
      `[postbuild] ERROR dist/_redirects 共 ${ruleCount} 條規則，超過 Cloudflare 上限 ${REDIRECT_MAX_LINES}，` +
        "超過的規則會被忽略。請清掉舊的下架物件 md 或改寫轉址策略後再部署。"
    );
    process.exit(1);
  }
  if (ruleCount > REDIRECT_WARN_LINES) {
    warn(`dist/_redirects 共 ${ruleCount} 條規則，接近上限 ${REDIRECT_MAX_LINES}`);
  }
  await writeFile(redirectsUrl, out, "utf-8");
  console.log(
    `[postbuild] 下架物件轉址：${lines.length / 2} 筆（導同區 ${toDistrict}、導總列表 ${toAll}` +
      (skippedLive ? `、頁面仍存在略過 ${skippedLive}` : "") +
      `），_redirects 共 ${ruleCount} 條規則`
  );
}

// ─── 7. 孤兒物件照片（X025）────────────────────────────────────────────
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;

async function hasHtml(dirUrl) {
  for (const e of await readdir(dirUrl, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (await hasHtml(new URL(e.name + "/", dirUrl))) return true;
    } else if (e.name.endsWith(".html")) {
      return true;
    }
  }
  return false;
}

/** 刪掉資料夾裡的照片，回傳 {files, bytes}；刪完是空的就連資料夾一起刪 */
async function prunePhotosIn(dirUrl) {
  let files = 0;
  let bytes = 0;
  for (const e of await readdir(dirUrl, { withFileTypes: true })) {
    const child = new URL(e.name + (e.isDirectory() ? "/" : ""), dirUrl);
    if (e.isDirectory()) {
      const r = await prunePhotosIn(child);
      files += r.files;
      bytes += r.bytes;
    } else if (PHOTO_EXT.test(e.name)) {
      bytes += (await stat(child)).size;
      await rm(child);
      files++;
    }
  }
  if ((await readdir(dirUrl)).length === 0) await rmdir(dirUrl);
  return { files, bytes };
}

/**
 * dist/properties/* 裡沒有 index.html 的子資料夾 = 這次沒產頁的物件（下架、售出、孤兒），
 * 照片照樣被 public/ 複製進來公開回 200。只刪 dist 裡的照片，public/ 不動
 * （物件重新上架時 repo 的照片還在，下次 build 自動恢復）。
 * 安全閥：要刪的資料夾超過總數一半 → 判定異常（例如物件頁整批沒產出），整步跳過。
 */
async function pruneOrphanPropertyPhotos() {
  const propsDir = new URL("properties/", DIST);
  if (!existsSync(propsDir)) {
    console.log("[postbuild] skip 孤兒照片：dist/properties 不存在");
    return;
  }
  const dirs = (await readdir(propsDir, { withFileTypes: true })).filter(e => e.isDirectory());
  const orphans = [];
  for (const d of dirs) {
    const u = new URL(d.name + "/", propsDir);
    if (existsSync(new URL("index.html", u))) continue;
    if (await hasHtml(u)) continue; // 底下還有頁面的資料夾不碰
    orphans.push(u);
  }
  if (orphans.length === 0) {
    console.log(`[postbuild] 孤兒照片：dist/properties 共 ${dirs.length} 個資料夾，沒有要刪的`);
    return;
  }
  if (orphans.length > dirs.length * 0.5) {
    warn(
      `孤兒照片：${orphans.length}/${dirs.length} 個資料夾沒有 index.html，超過一半，疑似物件頁整批沒產出 → 整步跳過`
    );
    return;
  }
  let files = 0;
  let bytes = 0;
  let removedDirs = 0;
  for (const u of orphans) {
    const r = await prunePhotosIn(u);
    files += r.files;
    bytes += r.bytes;
    if (!existsSync(u)) removedDirs++;
  }
  console.log(
    `[postbuild] 孤兒照片：${orphans.length} 個沒產頁的物件資料夾，刪 ${files} 個檔` +
      `（${(bytes / 1024 / 1024).toFixed(1)} MB），移除空資料夾 ${removedDirs} 個`
  );
}

// ─── 8. 本站絕對網址少尾斜線檢查（X021，只警告、不改寫）──────────────────
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\/]/g;
// 路徑遇到引號、空白、角括號、右括號、反斜線、全形標點就結束
const PATH_CHARS = String.raw`[^"'\s<>)\\，。、」）]*`;

async function checkAbsoluteSiteUrls() {
  const first = readSitemapIndexLocs()[0];
  if (!first) {
    console.log("[postbuild] skip 尾斜線檢查：讀不到 dist/sitemap-index.xml 的網域");
    return;
  }
  const origin = new URL(first).origin;
  const re = new RegExp(`${origin.replace(REGEX_SPECIALS, "\\$&")}(/${PATH_CHARS})`, "g");
  const bad = new Map(); // 網址 → 出現的檔案
  let files = 0;
  for await (const f of walkHtml(DIST)) {
    files++;
    const html = await readFile(f, "utf-8");
    for (const m of html.matchAll(re)) {
      const raw = m[1].replace(/&amp;.*$/, "");
      const p = raw.split("#")[0].split("?")[0];
      if (p.endsWith("/") || /\.[a-zA-Z0-9]{1,8}$/.test(p)) continue;
      const url = origin + raw;
      let rel = f.pathname.slice(DIST.pathname.length);
      try {
        rel = decodeURIComponent(rel);
      } catch {
        /* 保留原樣 */
      }
      if (!bad.has(url)) bad.set(url, new Set());
      bad.get(url).add(rel);
    }
  }
  if (bad.size === 0) {
    console.log(`[postbuild] 尾斜線檢查：掃 ${files} 個 HTML，本站絕對網址都帶尾斜線`);
    return;
  }
  warn(`尾斜線檢查：掃 ${files} 個 HTML，有 ${bad.size} 個本站絕對網址少尾斜線（會多繞一次 308）`);
  const SHOW = 40;
  for (const [url, where] of [...bad].slice(0, SHOW)) {
    const list = [...where];
    console.warn(`  ${url}  ← ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` 等 ${list.length} 個檔` : ""}`);
  }
  if (bad.size > SHOW) console.warn(`  …其餘 ${bad.size - SHOW} 個略`);
}

/** 新加的步驟一律包起來：出錯只警告，不讓部署停住 */
async function safeStep(name, fn) {
  try {
    await fn();
  } catch (err) {
    warn(`${name} 失敗，略過（不擋部署）：${err?.stack ?? err}`);
  }
}

async function main() {
  await maybeRename("_headers.txt", "_headers");
  await maybeRename("_redirects.txt", "_redirects");
  await safeStep("sitemap.xml", publishSitemapAlias);
  // 超過 2,000 條規則會在函式裡 process.exit(1)（刻意擋部署），其餘錯誤只警告
  await safeStep("下架物件轉址", appendWithdrawnRedirects);
  await safeStep("孤兒照片", pruneOrphanPropertyPhotos);
  await normalizeInternalLinks();
  await safeStep("尾斜線檢查", checkAbsoluteSiteUrls);
  await copyPagefind();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
