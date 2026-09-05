/**
 * normalize-property-photos.mjs — 物件照片正規化（原地覆寫、保留檔名）
 *
 * 掃 public/properties/<id>/photo_*.jpg：
 *   - 長邊 > MAX_EDGE(1600px) 或檔案 > MAX_BYTES(400KB) 才處理
 *     （已 ≤1600px 的只在 > SOFT_MAX_BYTES(600KB) 時重壓，避免重跑時反覆重壓）
 *   - 處理：自動依 EXIF 轉正 → 長邊縮到 1600（不放大）→ JPEG q80 mozjpeg → 原地覆寫
 *   - 已合格的跳過；不產生新檔、不刪檔、不動 md / coverImage 路徑
 *   - 只處理 src/content/properties/<id>.md 存在且 status: active 的目錄；
 *     withdrawn / sold 跳過；沒有 md 對應的「孤兒目錄」只列出，不處理
 *
 * 用法：
 *   node scripts/normalize-property-photos.mjs             # 真跑
 *   node scripts/normalize-property-photos.mjs --dry-run   # 只列清單不寫檔
 *   node scripts/normalize-property-photos.mjs --only 0391467
 *   node scripts/normalize-property-photos.mjs --all-status  # 連 sold/withdrawn 也處理
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(process.cwd());
const PHOTO_DIR = path.join(ROOT, "public/properties");
const CONTENT_DIR = path.join(ROOT, "src/content/properties");
const MAX_EDGE = 1600;
const MAX_BYTES = 400 * 1024;
// 已經 ≤1600px 但仍 >400KB 的高細節照，重壓 q80 只省 5-10% 又會累積世代損失；
// 超過 SOFT_MAX 才重壓，讓重跑時保持 idempotent
const SOFT_MAX_BYTES = 600 * 1024;
const JPEG_QUALITY = 80;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allStatus = args.includes("--all-status");
const onlyIdx = args.indexOf("--only");
const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
if (onlyIdx >= 0 && !onlyId) {
  console.error("--only 需要接物件 id");
  process.exit(1);
}

const mb = n => (n / 1024 / 1024).toFixed(2);

// 讀 md 的 status
async function loadStatusMap() {
  const map = new Map();
  const files = await readdir(CONTENT_DIR);
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const id = f.replace(/\.md$/, "");
    const text = await readFile(path.join(CONTENT_DIR, f), "utf8");
    const m = text.match(/^status:\s*["']?([\w-]+)["']?\s*$/m);
    map.set(id, m ? m[1] : "unknown");
  }
  return map;
}

const statusMap = await loadStatusMap();
const dirs = (await readdir(PHOTO_DIR, { withFileTypes: true }))
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

const orphans = [];
const skippedStatus = [];
const candidates = []; // { id, file, bytes, width, height }
let scanned = 0;
let totalBefore = 0;

for (const id of dirs) {
  if (onlyId && id !== onlyId) continue;
  const status = statusMap.get(id);
  if (status === undefined) {
    orphans.push(id);
    continue;
  }
  if (!allStatus && status !== "active") {
    skippedStatus.push(`${id}(${status})`);
    continue;
  }
  const dir = path.join(PHOTO_DIR, id);
  const files = (await readdir(dir)).filter(f => /^photo_\d+\.jpe?g$/i.test(f)).sort();
  for (const f of files) {
    const fp = path.join(dir, f);
    const st = await stat(fp);
    scanned++;
    totalBefore += st.size;
    let meta;
    try {
      // 用 buffer 餵 sharp：libvips 直接開檔會 mmap 鎖住檔案，Windows 上之後覆寫會失敗
      meta = await sharp(await readFile(fp)).metadata();
    } catch (err) {
      console.warn(`⚠ 無法讀取 ${id}/${f}: ${err.message}`);
      continue;
    }
    // EXIF 轉向 5-8 時寬高對調，長邊判斷不受影響
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const needsResize = longEdge > MAX_EDGE;
    const needsRecompress = st.size > (needsResize ? MAX_BYTES : SOFT_MAX_BYTES);
    if (needsResize || needsRecompress) {
      candidates.push({ id, file: f, path: fp, bytes: st.size, width: meta.width, height: meta.height });
    }
  }
}

console.log(`掃描 ${scanned} 張（active 物件），總量 ${mb(totalBefore)} MB`);
console.log(`需處理 ${candidates.length} 張${dryRun ? "（dry-run，不寫檔）" : ""}`);
if (skippedStatus.length) console.log(`跳過非 active 目錄 ${skippedStatus.length} 個：${skippedStatus.join(", ")}`);
if (orphans.length) console.log(`孤兒目錄（無 md 對應，未處理）${orphans.length} 個：${orphans.join(", ")}`);

let saved = 0;
let processed = 0;
const results = [];
for (const c of candidates) {
  const label = `${c.id}/${c.file} ${c.width}x${c.height} ${mb(c.bytes)}MB`;
  if (dryRun) {
    console.log(`  [dry] ${label}`);
    continue;
  }
  try {
    const src = await readFile(c.path);
    const buf = await sharp(src)
      .rotate() // 依 EXIF 轉正後再縮，輸出不帶 EXIF 也不會倒
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    // 若壓完反而更大（極少見），保留原檔
    if (buf.length >= c.bytes) {
      console.log(`  [keep] ${label} → 壓後不變小，保留原檔`);
      continue;
    }
    await writeFile(c.path, buf);
    const delta = c.bytes - buf.length;
    saved += delta;
    processed++;
    results.push({ ...c, after: buf.length });
    console.log(`  [ok] ${label} → ${mb(buf.length)}MB（省 ${mb(delta)}MB）`);
  } catch (err) {
    console.error(`  [fail] ${label}: ${err.message}`);
  }
}

if (!dryRun) {
  console.log(`\n完成：處理 ${processed} 張，省下 ${mb(saved)} MB；總量 ${mb(totalBefore)} → ${mb(totalBefore - saved)} MB`);
  const top = results.sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  if (top.length) {
    console.log("最大的幾張：");
    for (const r of top) console.log(`  ${r.id}/${r.file} ${r.width}x${r.height} ${mb(r.bytes)} → ${mb(r.after)} MB`);
  }
}
