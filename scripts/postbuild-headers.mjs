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
 *
 * Windows + Linux 都能跑。
 */
import { rename, cp, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIST = new URL("../dist/", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);

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

async function main() {
  await maybeRename("_headers.txt", "_headers");
  await maybeRename("_redirects.txt", "_redirects");
  await normalizeInternalLinks();
  await copyPagefind();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
