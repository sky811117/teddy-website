/**
 * ogThumb — OG 大圖路徑 → 列表縮圖路徑
 *
 * `/og/foo.jpg` → `/og/thumbs/foo.webp`（由 scripts/generate-og-thumbs.mjs 產出）。
 * 非 /og/ 開頭（如 image() 匯入的 /_astro/ 路徑）原樣回傳。
 */
export function ogThumb(src: string): string {
  if (!src.startsWith("/og/")) return src;
  // 已經是縮圖路徑就不再轉
  if (src.startsWith("/og/thumbs/")) return src;
  const basename = src.split("/").pop() ?? "";
  if (!basename) return src;
  return `/og/thumbs/${basename.replace(/\.[^.]+$/, "")}.webp`;
}
