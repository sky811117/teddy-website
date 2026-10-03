/**
 * coverThumb — 物件封面原圖路徑 → 縮圖路徑（稽核 F027／F072）
 *
 * `/properties/<id>/photo_03.jpg`        → `/properties/<id>/photo_03-card800.webp`（800×600）
 * `/properties/<id>/photo_03.jpg`, 400   → `/properties/<id>/photo_03-card400.webp`（400×300）
 * 縮圖由 scripts/generate-cover-thumbs.mjs 在 build 前產出（規格兩邊要一起改）。
 *
 * ⚠️ 保底：build 時用 node:fs 檢查縮圖檔真的在 public/ 裡，不在就原樣回傳原圖路徑。
 *    縮圖腳本失敗、照片剛同步還沒產縮圖、本機沒跑過腳本 —— 都只是退回原圖，不會破圖。
 *    srcset 也是兩張都在才輸出。
 * 不是 /properties/<id>/xxx.jpg 的路徑（image() 匯入的 /_astro/、外部網址）原樣回傳。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const COVER_RE = /^\/properties\/([A-Za-z0-9_-]+)\/([^/]+)\.(jpe?g|png)$/i;

// 模組層快取：列表頁 400 多張卡、每個物件頁的相關卡都會查，同一個檔只 stat 一次
const existsCache = new Map<string, boolean>();
function publicFileExists(urlPath: string): boolean {
  const hit = existsCache.get(urlPath);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = existsSync(join(process.cwd(), "public", urlPath));
  } catch {
    ok = false;
  }
  existsCache.set(urlPath, ok);
  return ok;
}

/** 縮圖網址（不檢查存在）；不是物件照片路徑回 null */
function thumbPath(src: string, width: 800 | 400): string | null {
  const m = src.match(COVER_RE);
  if (!m) return null;
  return `/properties/${m[1]}/${m[2]}-card${width}.webp`;
}

/** 縮圖存在就回縮圖，否則回原圖 */
export function coverThumb(src: string, width: 800 | 400 = 800): string {
  const t = thumbPath(src, width);
  return t && publicFileExists(t) ? t : src;
}

/** 400w／800w 兩張縮圖都在才回 srcset 字串，否則 undefined（<img> 就只用 src） */
export function coverSrcset(src: string): string | undefined {
  const t400 = thumbPath(src, 400);
  const t800 = thumbPath(src, 800);
  if (!t400 || !t800) return undefined;
  if (!publicFileExists(t400) || !publicFileExists(t800)) return undefined;
  return `${t400} 400w, ${t800} 800w`;
}

/** 列表卡（1／2／3 欄格線）的 sizes，<img> 與 Layout 的 LCP preload 要用同一個值 */
export const COVER_CARD_SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

/** 卡片封面原圖路徑（frontmatter coverImage 可能是字串或 image() 物件） */
export function coverSrcOf(coverImage: string | { src: string } | undefined | null): string | undefined {
  if (!coverImage) return undefined;
  return typeof coverImage === "string" ? coverImage : coverImage.src;
}
