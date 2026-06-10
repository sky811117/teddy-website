/**
 * generate-og-thumbs.mjs — OG 大圖產列表縮圖
 *
 * 掃 public/og/*.{jpg,png}，輸出 640px 寬 webp (q70) 到 public/og/thumbs/<原檔名>.webp。
 * 縮圖已存在且 mtime 比原圖新就跳過（增量更新）。
 *
 * 用法：node scripts/generate-og-thumbs.mjs
 * build script 會在 astro check 前自動跑一次。
 */
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OG_DIR = path.resolve("public/og");
const THUMB_DIR = path.join(OG_DIR, "thumbs");
const THUMB_WIDTH = 640;
const WEBP_QUALITY = 70;

const entries = await readdir(OG_DIR, { withFileTypes: true });
const sources = entries
  .filter(e => e.isFile() && /\.(jpe?g|png)$/i.test(e.name))
  .map(e => e.name);

await mkdir(THUMB_DIR, { recursive: true });

let generated = 0;
let skipped = 0;

for (const name of sources) {
  const srcPath = path.join(OG_DIR, name);
  const outName = name.replace(/\.(jpe?g|png)$/i, ".webp");
  const outPath = path.join(THUMB_DIR, outName);

  const srcStat = await stat(srcPath);
  try {
    const outStat = await stat(outPath);
    if (outStat.mtimeMs >= srcStat.mtimeMs) {
      skipped++;
      continue;
    }
  } catch {
    // 縮圖不存在 → 往下產
  }

  await sharp(srcPath)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outPath);
  generated++;
}

console.log(
  `[og-thumbs] 產出 ${generated} 張縮圖、跳過 ${skipped} 張（已最新）→ public/og/thumbs/`
);
