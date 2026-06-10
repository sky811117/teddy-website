/**
 * 位置去重 — properties-sync 寫進 frontmatter 的 streetArea 常帶行政區前綴
 * （例「西屯區市政北七路」），跟卡片上已單獨顯示的 district 重複。
 * streetArea 以 district 開頭時去掉前綴，並順手清掉殘留的分隔符。
 * 列表卡、詳情頁、sticky bar 三處共用。
 */
export function cleanStreetArea(
  streetArea: string | undefined,
  district: string | undefined
): string {
  if (!streetArea) return "";
  let cleaned = streetArea;
  if (district && cleaned.startsWith(district)) {
    cleaned = cleaned.slice(district.length);
  }
  return cleaned.replace(/^[\s・·、，,]+/, "");
}
