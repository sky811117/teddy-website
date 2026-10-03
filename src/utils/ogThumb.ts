/**
 * ogThumb — OG 大圖路徑 → 縮圖路徑
 *
 * `/og/foo.jpg`        → `/og/thumbs/foo.webp`（640w，列表卡片用）
 * `/og/foo.jpg`, 960   → `/og/thumbs/foo-960.webp`（960w，文章頁 hero 桌機用）
 * 兩種都由 scripts/generate-og-thumbs.mjs 產出。
 * 非 /og/ 開頭（如 image() 匯入的 /_astro/ 路徑）原樣回傳。
 */
export function ogThumb(src: string, width: 640 | 960 = 640): string {
  if (!src.startsWith("/og/")) return src;
  // 已經是縮圖路徑就不再轉
  if (src.startsWith("/og/thumbs/")) return src;
  const basename = src.split("/").pop() ?? "";
  if (!basename) return src;
  const stem = basename.replace(/\.[^.]+$/, "");
  return width === 960
    ? `/og/thumbs/${stem}-960.webp`
    : `/og/thumbs/${stem}.webp`;
}
