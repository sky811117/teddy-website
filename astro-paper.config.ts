import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://teddy-website.pages.dev/",
    title: "陳景泰｜房仲 × AI 工程",
    description: "台中房仲，把業務全部自動化的過程公開出來。",
    author: "陳景泰",
    profile: "https://teddy-website.pages.dev/",
    ogImage: "default-og.jpg",
    lang: "zh-tw",
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
      url: "",
    },
    search: "pagefind",
  },
  socials: [
    { name: "github", url: "https://github.com/sky811117" },
    { name: "mail",   url: "mailto:a0920118756@gmail.com" },
  ],
  shareLinks: [
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});