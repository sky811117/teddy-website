#!/usr/bin/env node
/**
 * Postbuild：
 * 1. dist/_headers.txt → dist/_headers (Cloudflare Pages 要求無副檔名)
 *    workaround：public/_headers 會被 Vite/Rollup 試 parse JS 報錯
 * 2. cross-platform copy dist/pagefind → public/pagefind (替代 cp -r)
 *
 * Windows + Linux 都能跑。
 */
import { rename, cp } from "node:fs/promises";
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

async function main() {
  await maybeRename("_headers.txt", "_headers");
  await copyPagefind();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
