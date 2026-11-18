// 短影音專區的資料（2026-11-18）
// 物件片：scripts/sync-videos.mjs 產出 videos.generated.json；新聞片：scripts/sync-news-shorts.mjs 產出 news-shorts.generated.json。
// 兩份都由夜間流程更新。物件片在建置時再對一次官網在售物件，下架的不產頁面。
// ⛔ 新聞頁不放物件：同一頁提到物件或委託就變廣告，未完工建設的規定會跟著適用。
import { getCollection, type CollectionEntry } from "astro:content";
import generatedHomes from "./videos.generated.json";
import generatedNews from "./news-shorts.generated.json";
import { offlineMrtSegment, sanitizeHighlights } from "@/utils/cleanPropertyTitle";
import { cleanStreetArea } from "@/utils/cleanStreetArea";
import { publicCommunityName, stripAddressDetail } from "@/utils/propertyPhotoAlt";

type GeneratedHome = {
  videoId: string;
  url: string;
  title: string;
  district?: string;
  pubDate: string;
  listingCode?: string;
  cover?: string;
};

export type NewsShort = {
  slug: string;
  title: string;
  description: string;
  videoId: string;
  url: string;
  date: string;
  duration: number;
  category: string;
  points: string[];
  transcript: string[];
  sources: string[];
  hubSafe: boolean;
  cover?: string;
  relatedPost?: { slug: string; title: string } | null;
};

export type HomeShort = {
  code: string;
  videoId: string;
  url: string;
  pubDate: string;
  cover?: string;
  place: string;
  district: string;
  street: string;
  layout: string;
  label: string;
  sub: string;
  priceText: string;
  points: string[];
  property: CollectionEntry<"properties">;
};

export const coverSmall = (id: string, cover?: string) =>
  cover === "oar2" ? `https://i.ytimg.com/vi_webp/${id}/oar2.webp` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const coverLarge = (id: string, cover?: string) =>
  cover === "oar2" ? `https://i.ytimg.com/vi/${id}/oar2.jpg` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const embedUrl = (id: string) => `https://www.youtube.com/embed/${id}`;
// 頁面上的播放器用 nocookie 網域：還沒按播放前不寫 YouTube 的追蹤 cookie
export const playerUrl = (id: string, autoplay = false) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${autoplay ? "&autoplay=1" : ""}`;
export const isoDuration = (sec: number) => (sec > 0 ? `PT${Math.floor(sec / 60)}M${sec % 60}S` : undefined);

export const formatPrice = (price: number) =>
  price >= 10000 ? `${(price / 10000).toFixed(2)} 億` : `${price.toLocaleString("en-US")} 萬`;

const homeVideos = ((generatedHomes as { videos?: GeneratedHome[] }).videos ?? []).filter(v => v.videoId && v.listingCode);

/** 物件頁用：這間有沒有短影音（同一間多支取最新） */
export function homeShortByCode(code: string): GeneratedHome | undefined {
  return homeVideos
    .filter(v => v.listingCode === code)
    .sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1))[0];
}

// 影片重點只留講屋況和生活機能的句子：前台賣點常混著投資題材、開發利多和推銷口吻，這類整句不上影片頁
const POINT_BLOCK = new RegExp(
  [
    "未來|水湳|重劃|利多|發展|潛力|增值|保值|投報|報酬|年收|租金|收租|租客|租賃|包租|投資|置產|價值|商機|區域需求|人口穩定",
    "富人|名人|明星|頂級|尊爵|豪宅|地標|黃金|獨佔|含金量|絕佳|極速|無限視野|必買|不容錯過|不能忽略|值得|優勢|大特色",
    "誠意|降價|貸款|入主|入手|輕鬆擁有|一次擁有|比自己蓋|真正|我們|我|客群|完美|豪邸|預算",
    "\\d\\s*萬|[【】「」？?！!]",
  ].join("|")
);

function shortPoints(highlights: readonly string[] | undefined, district: string): string[] {
  return sanitizeHighlights(highlights, district)
    .map(h =>
      h
        .replace(/^\s*\d\uFE0F?\u20E3\s*/, "")
        .replace(/^\s*(?:\d{1,2}|[①-⑳])[.、．)）]\s*/, "")
        .replace(/^[●•・✔✅*▍\-–\s]+/, "")
        .replace(/[：:，,、]+$/, "")
        .trim()
    )
    .filter(h => h.length >= 8 && h.length <= 60 && !POINT_BLOCK.test(h) && !offlineMrtSegment(h, district))
    .slice(0, 3);
}

let homesCache: Promise<HomeShort[]> | undefined;

async function loadHomeShorts(): Promise<HomeShort[]> {
  const active = await getCollection("properties", ({ data }) => data.status === "active");
  const byId = new Map(active.map(p => [p.id, p]));
  const seen = new Set<string>();
  const list: HomeShort[] = [];
  for (const v of [...homeVideos].sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1))) {
    const code = v.listingCode as string;
    const property = byId.get(code);
    if (!property || seen.has(code)) continue;
    seen.add(code);
    const { data } = property;
    const street = stripAddressDetail(cleanStreetArea(data.streetArea, data.district));
    const place = publicCommunityName(data) || street || data.district;
    const layout = /\d/.test(data.layout ?? "") ? data.layout : "";
    list.push({
      code,
      videoId: v.videoId,
      url: v.url,
      pubDate: v.pubDate,
      cover: v.cover,
      place,
      district: data.district,
      street,
      layout,
      label: [place, layout].filter(Boolean).join(" "),
      sub: [data.district, layout].filter(Boolean).join("・"),
      priceText: formatPrice(data.totalPrice),
      points: shortPoints(data.highlights, data.district),
      property,
    });
  }
  return list;
}

export const getHomeShorts = () => (homesCache ??= loadHomeShorts());

export const newsShorts: NewsShort[] = (generatedNews as { items?: NewsShort[] }).items ?? [];

/** 專區首頁會跟物件放在一起：提到未完工建設的新聞片不上首頁，只留新聞分類 */
export const hubNewsShorts = newsShorts.filter(n => n.hubSafe);

/** 文章頁用：這篇有沒有同題影片 */
export const newsShortForPost = (postSlug: string) =>
  newsShorts.find(n => n.relatedPost?.slug === postSlug.replace(/^\/+|\/+$/g, ""));

export const formatDay = (date: string) => date.replace(/-/g, "/");
