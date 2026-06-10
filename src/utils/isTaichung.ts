/**
 * 判斷 district 是否屬於台中市
 * frontmatter 沒有 city/county 欄位 → 用行政區清單比對，
 * dirty data 帶「台中/臺中」prefix 也算台中。
 * （properties/index.astro 內有同邏輯的本地版，後續可收斂成只用這份）
 */
const TAICHUNG_DISTRICTS = new Set([
  "北屯區",
  "西屯區",
  "南屯區",
  "北區",
  "南區",
  "東區",
  "西區",
  "中區",
  "太平區",
  "大里區",
  "霧峰區",
  "烏日區",
  "大肚區",
  "沙鹿區",
  "梧棲區",
  "清水區",
  "大甲區",
  "外埔區",
  "大安區",
  "龍井區",
  "潭子區",
  "大雅區",
  "神岡區",
  "豐原區",
  "后里區",
  "東勢區",
  "和平區",
  "新社區",
  "石岡區",
]);

export function isTaichung(district: string | undefined): boolean {
  if (!district) return false;
  return (
    TAICHUNG_DISTRICTS.has(district) ||
    district.startsWith("台中") ||
    district.startsWith("臺中")
  );
}
