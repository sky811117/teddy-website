/**
 * 標題按詞換行（2026-11 花店風改版）：在中文標點後面切開，頁面上每段之間放 <wbr>，
 * 配合 .kw（word-break: keep-all; overflow-wrap: anywhere）——標題只在標點、空白處換行，不會把「風評」切成「風／評」。
 * WebKit 的 keep-all 只認空白、不認標點，所以一定要自己放 <wbr>（花店 docs/DEV.md 踩過的坑）。
 * overflow-wrap: anywhere 是保險：一段長到放不下時照樣斷開，不會把頁面撐寬。
 * 只切不改字：各段接回去跟原字串一模一樣（文字內容、搜尋看到的 H1 都不變）。
 */
export function wbrSegments(text: string): string[] {
  if (!text) return [];
  return text.split(/(?<=[、，。：；！？｜／）」』】・])/u).filter(s => s.length > 0);
}
