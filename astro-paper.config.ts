import { defineAstroPaperConfig } from "./src/types/config";

/**
 * 景泰本人 YouTube 頻道的「頻道 ID 網址」。
 * 2026-09-29 handle 改成 @陳景泰房仲大看板，舊 handle 只保留 14 天（10/13 前全站要換完）；
 * 頻道 ID 網址以後再換 handle 也不會變，全站（Layout sameAs、首頁、關於、媒體、
 * videos.ts、llms.txt）都引用這個常數，不要各檔再寫一份字串。
 */
export const YT_CHANNEL_URL = "https://www.youtube.com/channel/UCRghtbrj0YEsXq34dGrRpjQ";
/** 畫面上顯示用的 YouTube handle（href 一律用 YT_CHANNEL_URL） */
export const YT_HANDLE = "@陳景泰房仲大看板";

export default defineAstroPaperConfig({
  site: {
    url: "https://teddy-house.tw/",
    title: "陳景泰｜台中房仲",
    description: "台中買房賣房找陳景泰（泰迪）：社區評價、實價登錄、青安 3.0 試算、稅費一次算清楚，在售物件每天更新。有巢氏房屋台中世界之心加盟店，LINE：sky811117。",
    author: "陳景泰",
    profile: "https://teddy-house.tw/",
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
    { name: "threads",   url: "https://www.threads.com/@nov__817",                       linkTitle: "Threads @nov__817" },
    { name: "youtube",   url: YT_CHANNEL_URL,                                            linkTitle: "YouTube 陳景泰 泰迪｜房仲大看板" },
    { name: "tiktok",    url: "https://www.tiktok.com/@sky811117",                       linkTitle: "TikTok @sky811117" },
    { name: "facebook",  url: "https://www.facebook.com/profile.php?id=61575492127872",  linkTitle: "Facebook 泰迪 房仲大看板（陳景泰）" },
    { name: "mail",      url: "mailto:a0920118756@gmail.com",                            linkTitle: "Email 陳景泰" },
  ],
  shareLinks: [
    { name: "line",     url: "https://social-plugins.line.me/lineit/share?url=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});