/**
 * 在售物件列表共用的 build-time 邏輯（2026-09-06 從 properties/index.astro 抽出）
 *
 * 用在兩個地方：
 *   - /properties/            總列表（篩選、分段載入）
 *   - /properties/{district}/ 分區靜態列表（build 期依 district 切）
 * 兩頁的類型判斷、房型分桶、推薦排序、badge 判定必須一致，所以只留這一份。
 *
 * ⚠️ 目錄以 `_` 開頭：Astro 不會把這裡的檔案當頁面路由。
 */
import type { CollectionEntry } from "astro:content";
import { isTaichung } from "@/utils/isTaichung";
import { cleanPropertyTitle } from "@/utils/cleanPropertyTitle";

export type PropertyEntry = CollectionEntry<"properties">;

// 從 title / layout 推類型（純字串 keyword 法）
const TYPE_KEYWORDS: Array<[string, string]> = [
  ["透天", "透天"],
  ["別墅", "別墅"],
  ["店面", "店面"],
  ["套房", "套房"],
  ["農地", "農地"],
  ["建地", "土地"],
  ["土地", "土地"],
  ["林地", "土地"],
  ["商辦", "商辦"],
  ["廠房", "廠房"],
  ["公寓", "公寓"],
  ["華廈", "華廈"],
  ["大樓", "大樓"],
];

export function getType(p: PropertyEntry): string {
  const t = p.data.title + " " + (p.data.layout || "");
  for (const [kw, label] of TYPE_KEYWORDS) {
    if (t.includes(kw)) return label;
  }
  // 沒命中 → 從格局推：含「房」當大樓 / 公寓
  if (/\d房/.test(p.data.layout || "")) return "大樓";
  return "其他";
}

// 從 layout 抽房數（例「3房2廳2衛」→ 3）
export function getRoomBucket(layout: string | undefined): string {
  if (!layout) return "";
  const m = layout.match(/(\d+)\s*房/);
  if (!m) return "";
  const n = parseInt(m[1], 10);
  if (n >= 5) return "5房+";
  return `${n}房`;
}
export const ROOM_ORDER = ["1房", "2房", "3房", "4房", "5房+"];

// 推薦排序（複合）：有圖優先 > 台中市優先 > featured > 最新上架。缺圖卡沉到後面。
export function sortRecommended(list: PropertyEntry[]): PropertyEntry[] {
  return list.sort((a, b) => {
    const coverDiff = (a.data.coverImage ? 0 : 1) - (b.data.coverImage ? 0 : 1);
    if (coverDiff !== 0) return coverDiff;
    const tcDiff =
      (isTaichung(a.data.district) ? 0 : 1) - (isTaichung(b.data.district) ? 0 : 1);
    if (tcDiff !== 0) return tcDiff;
    const featDiff = (a.data.featured ? 0 : 1) - (b.data.featured ? 0 : 1);
    if (featDiff !== 0) return featDiff;
    return b.data.pubDatetime.getTime() - a.data.pubDatetime.getTime();
  });
}

// 標籤判斷
export const NEW_LISTING_DAYS = 7;
export function isNewListing(p: PropertyEntry, now: number = Date.now()): boolean {
  if (!p.data.pubDatetime) return false;
  return (now - p.data.pubDatetime.getTime()) / 86400000 <= NEW_LISTING_DAYS;
}
export function priceDropPct(p: PropertyEntry): number | null {
  if (!p.data.lastPrice || p.data.lastPrice <= p.data.totalPrice) return null;
  return Math.round(
    ((p.data.lastPrice - p.data.totalPrice) / p.data.lastPrice) * 100
  );
}

// badge 防通膨：pubDatetime 是批次同步日（properties-sync 整批重寫），
// 若列表超過 30% 物件都判定為「新上架」，代表是同步日 artifact 不是真的新
// → 整批不顯示新上架 badge（含快選 chip）。
// 等 properties-sync 補 firstSeen 欄位後才能恢復精準判定。
export const NEW_BADGE_MAX_RATIO = 0.3;
export function shouldShowNewBadge(metas: PropertyCardMeta[]): boolean {
  if (metas.length === 0) return false;
  const newCount = metas.filter(m => m.newListing).length;
  return newCount / metas.length <= NEW_BADGE_MAX_RATIO;
}

export const formatPrice = (price: number): string => {
  if (price >= 10000) return `${(price / 10000).toFixed(2)} 億`;
  return `${price.toLocaleString()} 萬`;
};

export type PropertyCardMeta = {
  p: PropertyEntry;
  idx: number;
  title: string;
  community: string;
  district: string;
  type: string;
  rooms: string;
  newListing: boolean;
  dropPct: number | null;
};

export function buildCardMeta(p: PropertyEntry, idx: number, now: number = Date.now()): PropertyCardMeta {
  const district = p.data.district || "未分類";
  const community = p.data.community?.trim() || "";
  // 對外顯示標題：清誇大詞／內部用語／emoji（src/utils/cleanPropertyTitle.ts）
  const title = cleanPropertyTitle(
    p.data.title,
    [community || district, p.data.layout].filter(Boolean).join(" ")
  );
  return {
    p,
    idx,
    title,
    community,
    district,
    type: getType(p),
    rooms: getRoomBucket(p.data.layout),
    newListing: isNewListing(p, now),
    dropPct: priceDropPct(p),
  };
}
