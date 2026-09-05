import type { FontData } from "astro:assets";

/**
 * 從 astro:assets 的 fontData[cssVariable] 挑出指定 weight / style / format 的檔案路徑。
 * 預設 format 是 "truetype"（satori 用）→ 只能餵 astro.config.ts 裡 formats: ["ttf"] 的
 * `--font-noto-sans-tc-og` entry；網頁用的 `--font-noto-sans-tc` 是 woff2 切片，這裡會回 undefined。
 */
export function getFontPathByWeight(
  fonts: FontData[],
  weight: number,
  options?: {
    style?: "normal" | "italic";
    format?: string;
  }
): string | undefined {
  const style = options?.style ?? "normal";
  const format = options?.format ?? "truetype";

  return fonts
    .find(font => font.weight === String(weight) && font.style === style)
    ?.src.find(file => file.format === format)?.url;
}
