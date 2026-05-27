// 景泰短影音作品集 — 給 /shorts 頁面用
//
// 景泰的房仲短影音跨 3 平台：YouTube (@泰迪001) / TikTok (@sky811117) / IG (@nov__817)
// 每支影片獨立 entry、頁面會自動 group by 分類、加 schema.org VideoObject 給 Google rich result
//
// 隱私邊界：跟全站一致 — ✅ 既有社區名 / 路段 / 樓層 OK，❌ 屋主資訊 / 完整門牌 / 未完工預售案名 NO

export type VideoPlatform = "youtube" | "tiktok" | "instagram";

export type VideoCategory =
  | "看屋開箱"
  | "政策快訊"
  | "議價心法"
  | "客戶見證"
  | "AI 工作流"
  | "其他";

export type Video = {
  /** unique slug 給內部 ID + schema */
  id: string;
  platform: VideoPlatform;
  /** 跳原平台 URL（點擊 card 開新 tab） */
  url: string;
  /** YouTube embed ID（讓未來頁面內 iframe 播放用） */
  videoId?: string;
  title: string;
  description?: string;
  category: VideoCategory;
  /** 自訂封面圖路徑（/photos/...）。YouTube 沒填 → 自動用 i.ytimg.com/vi/{videoId}/hqdefault.jpg */
  coverImage?: string;
  pubDate: Date;
  /** 顯示用 "0:45" / "1:23" */
  duration?: string;
  /** ISO 8601 duration 給 schema 用（"PT45S" / "PT1M23S"） */
  durationIso?: string;
  /** 首頁精選 + grid 優先排序 */
  featured?: boolean;
  /** 看屋影片可帶區段 */
  district?: string;
  /** 社區名（既有社區 OK，預售案絕對不公開） */
  community?: string;
};

/**
 * 景泰填影片清單到這裡 — 範例格式：
 *
 * {
 *   id: "yt-northtun-zongtai-2026-05",
 *   platform: "youtube",
 *   videoId: "abc123xyz",
 *   url: "https://www.youtube.com/watch?v=abc123xyz",
 *   title: "北屯總太心之所向開箱 | 3房中庸樓層、近捷運綠線",
 *   description: "1100 萬內找得到的北屯捷運宅，3 房中庸樓層、生活機能完整。",
 *   category: "看屋開箱",
 *   district: "北屯區",
 *   community: "總太心之所向",
 *   pubDate: new Date("2026-05-20"),
 *   duration: "3:42",
 *   durationIso: "PT3M42S",
 *   featured: true,
 * },
 */
export const videos: Video[] = [];

export const platformInfo: Record<
  VideoPlatform,
  { name: string; icon: string; handle: string; url: string; color: string }
> = {
  youtube: {
    name: "YouTube",
    icon: "📺",
    handle: "@泰迪001",
    url: "https://www.youtube.com/@%E6%B3%B0%E8%BF%AA001",
    color: "from-red-500/20 to-red-300/20",
  },
  tiktok: {
    name: "TikTok",
    icon: "🎬",
    handle: "@sky811117",
    url: "https://www.tiktok.com/@sky811117",
    color: "from-pink-500/20 to-purple-500/20",
  },
  instagram: {
    name: "Instagram",
    icon: "📷",
    handle: "@nov__817",
    url: "https://www.instagram.com/nov__817/",
    color: "from-amber-500/20 to-pink-500/20",
  },
};

export const categoryInfo: Record<
  VideoCategory,
  { icon: string; tagline: string }
> = {
  看屋開箱: {
    icon: "🏠",
    tagline: "走進屋裡、用 1 分鐘看完一間房",
  },
  政策快訊: {
    icon: "📰",
    tagline: "新青安、央行管制、房地合一 — 政策一變就拍",
  },
  議價心法: {
    icon: "💰",
    tagline: "我幫客戶議過的案例、能說的都講",
  },
  客戶見證: {
    icon: "🤝",
    tagline: "成交後、客戶自己想說的話",
  },
  "AI 工作流": {
    icon: "🤖",
    tagline: "房仲怎麼用 AI 自動化 — 對同行也對客戶",
  },
  其他: {
    icon: "🎬",
    tagline: "雜記、生活、廚師轉房仲的故事",
  },
};

export const categories: VideoCategory[] = [
  "看屋開箱",
  "政策快訊",
  "議價心法",
  "客戶見證",
  "AI 工作流",
  "其他",
];

/**
 * 從 video 取 cover 圖 URL — YouTube 沒填 coverImage 走 hqdefault
 */
export function getVideoCover(v: Video): string | null {
  if (v.coverImage) return v.coverImage;
  if (v.platform === "youtube" && v.videoId) {
    return `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
  }
  return null;
}
