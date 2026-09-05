import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://teddy-website-blog.pages.dev/",
    title: "陳景泰｜台中房仲",
    description: "台中買房賣房找陳景泰（泰迪）：社區評價、實價登錄、青安 3.0 試算、稅費一次算清楚，在售物件每天更新。一品不動產有巢氏世界之心店，LINE：sky811117。",
    author: "陳景泰",
    profile: "https://teddy-website-blog.pages.dev/",
    ogImage: "default-og.jpg",
    lang: "zh-TW",
    timezone: "Asia/Taipei",
    dir: "ltr",
  },
  posts: {
    perPage: 12,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    { name: "line",      url: "/go/line?src=socials",                                    linkTitle: "LINE 私訊景泰 sky811117" },
    { name: "instagram", url: "https://www.instagram.com/nov__817/",                     linkTitle: "@nov__817 Instagram" },
    { name: "youtube",   url: "https://www.youtube.com/@%E6%B3%B0%E8%BF%AA001",         linkTitle: "YouTube @泰迪001" },
    { name: "tiktok",    url: "https://www.tiktok.com/@sky811117",                       linkTitle: "TikTok @sky811117" },
    { name: "facebook",  url: "https://www.facebook.com/profile.php?id=61575492127872",  linkTitle: "Facebook 陳景泰" },
    { name: "mail",      url: "mailto:a0920118756@gmail.com",                            linkTitle: "Email 陳景泰" },
  ],
  shareLinks: [
    { name: "line",     url: "https://social-plugins.line.me/lineit/share?url=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});