/**
 * generate-cover-thumbs.mjs — 物件封面縮圖（稽核 F027／F072）
 *
 * 為什麼：/properties/ 每張卡都載 1600px 長邊的原圖當封面（單頁圖片 1.2MB），
 * 行動版 LCP 拖到 9 秒。這支在 build 期把每個「在售」物件的封面縮成兩張 webp：
 *   public/properties/<id>/<封面檔名>-card800.webp  800×600 q70 — 列表卡、首頁卡
 *   public/properties/<id>/<封面檔名>-card400.webp  400×300 q70 — 物件頁相關卡、srcset 小圖
 * 檔名帶封面原檔名（photo_03 → photo_03-card800.webp），封面換張時舊縮圖不會被誤用。
 *
 * 封面來源 = 物件 md frontmatter 的 coverImage（模板顯示的就是它；有 193 夾封面不是 photo_01，
 * 不能用「排序第一張」猜）。只讀 md，不改 md、不改 Python 產線、不改 content schema。
 *
 * 失敗處理：任何錯誤只印 WARN、永遠 exit 0，不擋部署。模板端（src/utils/coverThumb.ts）
 * 在 build 時檢查縮圖檔在不在，不在就退回原圖 —— 縮圖缺檔不會破圖。
 *
 * 跳過條件（本機）：兩張縮圖都在、而且 mtime 不比原圖舊。CI 是 fresh checkout，每次全產
 * （約 430 個在售物件 × 2 張，sharp 幾十秒）。
 * ⚠️ 產物不進 git：.gitignore 要加一行「public/properties/ 底下任一夾的 *-card*.webp」
 *    （寫法：public/properties/<星號>/<星號>-card<星號>.webp），否則每晚 properties-sync
 *    的 `git add -A public/properties/` 會把它們一起 commit 進 repo。
 *
 * 用法：node scripts/generate-cover-thumbs.mjs
 *   package.json build 與 .github/workflows/deploy.yml 都在 generate-og-thumbs 之後、astro check 之前跑。
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const PROPS_MD = path.join(ROOT, "src", "content", "properties");
const PUBLIC = path.join(ROOT, "public");

/** 跟 src/utils/coverThumb.ts 同一份規格，兩邊要一起改 */
export const COVER_VARIANTS = [
  { suffix: "-card800", width: 800, height: 600, quality: 70 },
  { suffix: "-card400", width: 400, height: 300, quality: 70 },
];
const COVER_RE = /^\/properties\/([A-Za-z0-9_-]+)\/([^/]+)\.(jpe?g|png)$/i;
const THUMB_RE = /-card(800|400)\.webp$/i;

const warn = msg => console.warn(`[cover-thumbs] WARN ${msg}`);

function readFrontmatter(file) {
  const txt = readFileSync(file, "utf8");
  return txt.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
}

/** 在售物件的封面清單：[{ id, dir, stem, src }] */
function collectCovers() {
  const out = [];
  let names = [];
  try {
    names = readdirSync(PROPS_MD).filter(n => /\.mdx?$/.test(n) && !n.startsWith("_"));
  } catch (err) {
    warn(`讀不到 src/content/properties（${err.message}），不產縮圖`);
    return out;
  }
  for (const name of names.sort()) {
    let fm = "";
    try {
      fm = readFrontmatter(path.join(PROPS_MD, name));
    } catch {
      continue;
    }
    const status = fm.match(/^status:\s*["']?(\w+)["']?/m)?.[1] ?? "active";
    if (status !== "active") continue; // 下架物件不產頁，縮圖用不到
    const cover = fm.match(/^coverImage:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1]?.trim();
    if (!cover) continue;
    const m = cover.match(COVER_RE);
    if (!m) continue; // image() 匯入或外部網址：不歸這支管
    const src = path.join(PUBLIC, "properties", m[1], `${m[2]}.${m[3]}`);
    if (!existsSync(src)) continue; // 照片缺檔：模板本來就顯示原路徑，不在這裡處理
    out.push({ id: m[1], dir: path.dirname(src), stem: m[2], src });
  }
  return out;
}

function isFresh(src, outs) {
  try {
    const srcTime = statSync(src).mtimeMs;
    return outs.every(o => existsSync(o) && statSync(o).mtimeMs >= srcTime);
  } catch {
    return false;
  }
}

/** 同一夾裡不是現在封面的舊縮圖刪掉（封面換張後留下的） */
function removeStaleThumbs(dir, stem) {
  let removed = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!THUMB_RE.test(f)) continue;
      if (f.startsWith(`${stem}-card`)) continue;
      unlinkSync(path.join(dir, f));
      removed++;
    }
  } catch {
    /* 清不掉不影響本次結果 */
  }
  return removed;
}

let sharp; // main() 裡動態載入：載入失敗也只 WARN，不讓 build 停住

async function makeThumbs(item) {
  const outs = COVER_VARIANTS.map(v => path.join(item.dir, `${item.stem}${v.suffix}.webp`));
  if (isFresh(item.src, outs)) return "skipped";
  try {
    const buf = readFileSync(item.src);
    for (const [i, v] of COVER_VARIANTS.entries()) {
      await sharp(buf)
        .rotate() // 照 EXIF 方向轉正（原圖若帶方向旗標，縮圖才不會躺著）
        .resize(v.width, v.height, { fit: "cover", position: "attention" })
        .webp({ quality: v.quality })
        .toFile(outs[i]);
    }
    return "generated";
  } catch (err) {
    // 寫一半的檔刪掉，模板才會乾淨地退回原圖
    for (const o of outs) {
      try {
        if (existsSync(o)) unlinkSync(o);
      } catch {
        /* ignore */
      }
    }
    warn(`${item.id} 封面縮圖失敗（模板會退回原圖）：${err?.message ?? err}`);
    return "failed";
  }
}

async function main() {
  const t0 = Date.now();
  sharp = (await import("sharp")).default;
  const covers = collectCovers();
  const counts = { generated: 0, skipped: 0, failed: 0 };
  let stale = 0;
  for (const c of covers) stale += removeStaleThumbs(c.dir, c.stem);

  // sharp 本身多執行緒；同時跑幾張就好，CI 2 核心不要開太多
  const pool = Math.max(1, Math.min(4, os.cpus()?.length ?? 2));
  let next = 0;
  await Promise.all(
    Array.from({ length: pool }, async () => {
      while (next < covers.length) {
        const item = covers[next++];
        counts[await makeThumbs(item)]++;
      }
    })
  );

  let bytes = 0;
  for (const c of covers) {
    for (const v of COVER_VARIANTS) {
      const o = path.join(c.dir, `${c.stem}${v.suffix}.webp`);
      try {
        if (existsSync(o)) bytes += statSync(o).size;
      } catch {
        /* ignore */
      }
    }
  }
  console.log(
    `[cover-thumbs] 在售物件封面 ${covers.length} 張：產出 ${counts.generated}、跳過 ${counts.skipped}（已最新）` +
      (counts.failed ? `、失敗 ${counts.failed}（退回原圖）` : "") +
      (stale ? `、清掉舊縮圖 ${stale}` : "") +
      `；縮圖合計 ${(bytes / 1024 / 1024).toFixed(1)} MB，${((Date.now() - t0) / 1000).toFixed(1)} 秒`
  );
}

main().catch(err => {
  warn(`整步失敗，略過（不擋部署，模板會退回原圖）：${err?.stack ?? err}`);
});
