/**
 * propertySiteData — 物件頁讀 properties-sync 每晚寫的 src/data 資料（台帳 X006 第二階段、F080）
 *
 * - listedAt(p)：上架時間。有 firstSeen（第一次出現在官網）就用它；舊 md 還沒被重寫、沒有 firstSeen 時
 *   退回 pubDatetime（批次同步日，會比實際晚）。
 * - priceCheckedDate(id)：src/data/properties-meta.json 的 {priceSyncedAt, codes}。委編在 codes 裡＝
 *   當晚 apply_shop_prices --live 拿店頭價格核對過（同價或已改價），回 "YYYY-MM-DD"；否則 null。
 *   檔案不存在、格式不對 → 一律 null（物件頁照舊顯示「資料更新日」），不會擋 build。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type WithDates = { data: { firstSeen?: Date; pubDatetime: Date } };

export function listedAt(p: WithDates): Date {
  return p.data.firstSeen ?? p.data.pubDatetime;
}

let metaCache: { date: string; codes: Set<string> } | null | undefined;

export function priceCheckedDate(id: string): string | null {
  if (metaCache === undefined) {
    metaCache = null;
    try {
      const file = join(process.cwd(), "src", "data", "properties-meta.json");
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
        if (typeof raw?.priceSyncedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.priceSyncedAt) && Array.isArray(raw.codes)) {
          metaCache = { date: raw.priceSyncedAt, codes: new Set(raw.codes.map(String)) };
        }
      }
    } catch {
      metaCache = null;
    }
  }
  return metaCache && metaCache.codes.has(id) ? metaCache.date : null;
}
