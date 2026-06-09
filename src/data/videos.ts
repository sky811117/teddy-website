// 景泰短影音作品集 — 給 /shorts 頁面用
//
// 景泰的房仲短影音跨 3 平台：YouTube (@泰迪001) / TikTok (@sky811117) / IG (@nov__817)
// 每支影片獨立 entry、頁面會自動 group by 分類、加 schema.org VideoObject 給 Google rich result
//
// 隱私邊界：跟全站一致 — ✅ 既有社區名 / 路段 / 樓層 OK，❌ 屋主資訊 / 完整門牌 / 未完工預售案名 NO

export type VideoPlatform = "youtube" | "tiktok" | "instagram" | "facebook";

export type VideoCategory =
  | "看屋開箱"
  | "政策快訊"
  | "議價心法"
  | "客戶見證"
  | "AI 工作流"
  | "其他";

/**
 * 影片作者 — teddy = 景泰本人作品；bigkanban = 房仲大看板（業界 KOL，景泰關注並推薦）
 */
export type VideoAuthor = "teddy" | "bigkanban";

export type Video = {
  /** unique slug 給內部 ID + schema */
  id: string;
  /** 預設 "teddy"，"bigkanban" = 景泰推薦的房仲大看板系列 */
  author?: VideoAuthor;
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

export const authorInfo: Record<
  VideoAuthor,
  { name: string; handle: string; isTeddy: boolean; badge: string; badgeColor: string }
> = {
  teddy: {
    name: "景泰",
    handle: "@nov__817",
    isTeddy: true,
    badge: "景泰原作",
    badgeColor: "bg-accent text-accent-foreground",
  },
  bigkanban: {
    name: "房仲大看板",
    handle: "@bigkanban",
    isTeddy: false,
    badge: "推薦・房仲大看板",
    badgeColor: "bg-indigo-600 text-white",
  },
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
// 預設上架日 — 2026-06-09 批次填入。發佈日不精確不影響站內呈現，影響 schema.org uploadDate；
// 未來 metadata 補齊時逐筆改正。featured 標旗手物件給 grid 優先位。
const SEED_DATE = new Date("2026-06-09");

export const videos: Video[] = [
  // ===== 每平台一支代表作（最新）=====
  // 7 支：景泰本人 3 支 (YT/TT/IG) + 公司品牌「房仲大看板」4 支 (FB/IG @bigkanban/IG @bigkanban.boss/TT @bigkanban2.0)
  // pubDate 在無法精準抓到實際發布日時統一 SEED_DATE；featured 全 true 因為都是該平台代表作

  // 景泰 YT — @泰迪001
  {
    id: "yt-oUb3zBoctXQ",
    author: "teddy",
    platform: "youtube",
    videoId: "oUb3zBoctXQ",
    url: "https://www.youtube.com/shorts/oUb3zBoctXQ",
    title: "南屯嶺東全新雙車透天｜3房2廳4衛｜1898萬",
    category: "看屋開箱",
    district: "南屯區",
    pubDate: SEED_DATE,
    featured: true,
  },

  // 景泰 TikTok — @sky811117
  {
    id: "tt-teddy-7644014938331024648",
    author: "teddy",
    platform: "tiktok",
    url: "https://www.tiktok.com/@sky811117/video/7644014938331024648",
    coverImage: "/photos/teddy/tt-7644014938331024648.jpg",
    title: "南屯五期機能宅｜鑫園21世紀｜2房2廳1.5衛｜1280萬",
    category: "看屋開箱",
    district: "南屯區",
    community: "鑫園21世紀",
    pubDate: SEED_DATE,
    featured: true,
  },

  // 景泰 Instagram — @nov__817
  {
    id: "ig-teddy-DZWI6GhEmSA",
    author: "teddy",
    platform: "instagram",
    url: "https://www.instagram.com/nov__817/p/DZWI6GhEmSA/",
    coverImage: "/photos/teddy/ig-DZWI6GhEmSA.jpg",
    title: "房屋稅 5 月開徵｜囤房稅 2.0 自住 / 非自住稅率差幾倍？",
    category: "政策快訊",
    pubDate: new Date("2026-06-08"),
    featured: true,
  },

  // 房仲大看板 Facebook — BigKanBan（公司主頁）
  {
    id: "fb-bigkanban-1343875191179246",
    author: "bigkanban",
    platform: "facebook",
    url: "https://www.facebook.com/BigKanBan/videos/1343875191179246/",
    coverImage: "/photos/bigkanban/1343875191179246.jpg",
    title: "台中西區｜三中名廈｜3房2廳2衛｜1388萬",
    category: "看屋開箱",
    district: "西區",
    community: "三中名廈",
    pubDate: SEED_DATE,
    featured: true,
  },

  // 房仲大看板 Instagram — @bigkanban
  {
    id: "ig-bigkanban-DZW_3q6AbES",
    author: "bigkanban",
    platform: "instagram",
    url: "https://www.instagram.com/bigkanban/reel/DZW_3q6AbES/",
    coverImage: "/photos/bigkanban/ig-DZW_3q6AbES.jpg",
    title: "台中西區｜自治街三房｜3房2廳2衛｜988萬",
    category: "看屋開箱",
    district: "西區",
    pubDate: new Date("2026-06-09"),
    featured: true,
  },

  // 房仲大看板 Instagram BOSS — @bigkanban.boss
  {
    id: "ig-bigkanbanboss-DXjPDglE2l1",
    author: "bigkanban",
    platform: "instagram",
    url: "https://www.instagram.com/bigkanban.boss/reel/DXjPDglE2l1/",
    coverImage: "/photos/bigkanban/igboss-DXjPDglE2l1.jpg",
    title: "台中北屯｜班芙春泉｜4房2廳2衛｜1698萬",
    category: "看屋開箱",
    district: "北屯區",
    community: "班芙春泉",
    pubDate: SEED_DATE,
    featured: true,
  },

  // 房仲大看板 TikTok — @bigkanban2.0
  {
    id: "tt-bigkanban-7647716276114033941",
    author: "bigkanban",
    platform: "tiktok",
    url: "https://www.tiktok.com/@bigkanban2.0/video/7647716276114033941",
    coverImage: "/photos/bigkanban/tt-7647716276114033941.jpg",
    title: "彰化溪湖｜佑彰富域全新店住別墅｜6房3廳7衛｜2950萬",
    category: "看屋開箱",
    district: "彰化縣溪湖鎮",
    community: "佑彰富域",
    pubDate: SEED_DATE,
    featured: true,
  },
];

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
  facebook: {
    name: "Facebook",
    icon: "📘",
    handle: "BigKanBan",
    url: "https://www.facebook.com/BigKanBan",
    color: "from-blue-500/20 to-blue-300/20",
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
