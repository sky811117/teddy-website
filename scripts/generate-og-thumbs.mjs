/**
 * generate-og-thumbs.mjs — OG 大圖產縮圖
 *
 * 掃 public/og/*.{jpg,png}，每張輸出兩個 webp 到 public/og/thumbs/：
 *   <原檔名>.webp      640w q70 — 列表卡片、相關文章、手機版文章頁 hero
 *   <原檔名>-960.webp  960w q75 — 桌機版文章頁 hero（<picture> srcset）
 *
 * 跳過條件（2026-10-03 改）：兩個輸出都在、而且原圖內容雜湊跟上次記錄一樣才跳過。
 * 以前用 mtime 比對，但 CI 是 fresh checkout，所有檔案 mtime 都是 checkout 時間，
 * jpg 換了內容、舊 webp 又已經 commit 時會被誤判成「已最新」。
 * 雜湊記在 public/og/thumbs/.hashes.json（{ "<原檔名>": "<sha1>" }），要跟縮圖一起 commit。
 *
 * ⚠ 文章頁 hero 用 <picture>，webp 缺檔瀏覽器不會自動退回 jpg（會破圖），
 *   所以每張原圖兩種尺寸都必須產齊；本腳本最後會檢查並在缺檔時以非 0 結束。
 *
 * 原圖的 XMP（含 AI 生成標記 Iptc4xmpExt:DigitalSourceType）會保留到 webp（keepXmp）。
 * 已經產過、雜湊沒變的縮圖不會重產；原圖補寫 XMP 後雜湊會變，下次跑就會帶著標記重產。
 *
 * 用法：node scripts/generate-og-thumbs.mjs
 * build script 與 deploy.yml 會在 astro check 前自動跑一次。
 */
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OG_DIR = path.resolve("public/og");
const THUMB_DIR = path.join(OG_DIR, "thumbs");
const HASH_FILE = path.join(THUMB_DIR, ".hashes.json");

const VARIANTS = [
  { suffix: "", width: 640, quality: 70 },
  { suffix: "-960", width: 960, quality: 75 },
];

const exists = async p => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

const entries = await readdir(OG_DIR, { withFileTypes: true });
const sources = entries
  .filter(e => e.isFile() && /\.(jpe?g|png)$/i.test(e.name))
  .map(e => e.name)
  .sort();

await mkdir(THUMB_DIR, { recursive: true });

let hashes = {};
try {
  hashes = JSON.parse(await readFile(HASH_FILE, "utf8"));
} catch {
  // 第一次跑或檔案壞掉 → 全部重產
  hashes = {};
}

const nextHashes = {};
let generated = 0;
let skipped = 0;
const missing = [];

for (const name of sources) {
  const srcPath = path.join(OG_DIR, name);
  const stem = name.replace(/\.(jpe?g|png)$/i, "");
  const buf = await readFile(srcPath);
  const hash = createHash("sha1").update(buf).digest("hex");
  nextHashes[name] = hash;

  const outPaths = VARIANTS.map(v =>
    path.join(THUMB_DIR, `${stem}${v.suffix}.webp`)
  );
  const allExist = (await Promise.all(outPaths.map(exists))).every(Boolean);

  if (allExist && hashes[name] === hash) {
    skipped++;
    continue;
  }

  for (const [i, v] of VARIANTS.entries()) {
    await sharp(buf)
      .resize({ width: v.width, withoutEnlargement: true })
      // 保留原圖 XMP：AI 封面的「AI 生成」標記（IPTC DigitalSourceType）要跟著縮圖走，
      // sharp 預設會把 metadata 全丟掉（台帳 X028）。只留 XMP，不帶 EXIF/ICC，縮圖不會變胖
      .keepXmp()
      .webp({ quality: v.quality })
      .toFile(outPaths[i]);
  }
  generated++;
}

await writeFile(HASH_FILE, JSON.stringify(nextHashes, null, 2) + "\n", "utf8");

// 產完再驗一次：<picture> 不會退回 jpg，缺一張就是破圖
for (const name of sources) {
  const stem = name.replace(/\.(jpe?g|png)$/i, "");
  for (const v of VARIANTS) {
    const p = path.join(THUMB_DIR, `${stem}${v.suffix}.webp`);
    if (!(await exists(p))) missing.push(path.basename(p));
  }
}

console.log(
  `[og-thumbs] ${sources.length} 張原圖：產出 ${generated} 張（各 640w＋960w）、跳過 ${skipped} 張（雜湊未變）→ public/og/thumbs/`
);

if (missing.length > 0) {
  console.error(`[og-thumbs] ✗ 缺 ${missing.length} 張縮圖：${missing.slice(0, 10).join(", ")}`);
  process.exit(1);
}
