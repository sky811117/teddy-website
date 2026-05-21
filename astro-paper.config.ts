import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://teddy-website-blog.pages.dev/",
    title: "陳景泰｜台中房仲 × AI 自動化",
    description: "台中房仲陳景泰（短影音叫泰迪 / Teddy，房仲大看板 BigKanBan 團隊）。用 AI 工具幫客戶買房賣房：新青安試算、嫌惡設施查詢、議價心法、定價分析、多平台曝光。LINE：sky811117。",
    author: "陳景泰",
    profile: "https://teddy-website-blog.pages.dev/",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "Asia/Taipei",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
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
    { name: "mail",   url: "mailto:a0920118756@gmail.com" },
  ],
  shareLinks: [
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});