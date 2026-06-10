import type { UIStrings } from "../types";

// 繁體中文 UI 字串 — site.lang = "zh-TW" 時全站自動套用（index.ts 會 glob 本檔）
export default {
  nav: {
    home: "首頁",
    posts: "房市筆記",
    tags: "分類標籤",
    about: "關於",
    archives: "歷史文章",
    search: "搜尋",
  },
  post: {
    publishedAt: "發佈於",
    updatedAt: "更新於",
    sharePostIntro: "分享這篇文章：",
    sharePostOn: "分享到 {{platform}}",
    sharePostViaEmail: "用 Email 分享這篇文章",
    tagLabel: "標籤",
    backToTop: "回到頂端",
    goBack: "回上一頁",
    editPage: "編輯此頁",
    previousPost: "上一篇",
    nextPost: "下一篇",
  },
  pagination: {
    prev: "上一頁",
    next: "下一頁",
    page: "頁",
  },
  home: {
    socialLinks: "社群連結",
    featured: "精選文章",
    recentPosts: "最新文章",
    allPosts: "全部文章",
  },
  footer: {
    copyright: "版權所有",
    allRightsReserved: "保留一切權利。",
  },
  pages: {
    tagTitle: "標籤",
    tagDesc: "包含此標籤的所有文章",

    tagsTitle: "分類標籤",
    tagsDesc: "所有文章使用過的分類標籤。",

    postsTitle: "房市筆記",
    postsDesc: "台中買房賣房實戰筆記，每週更新",

    archivesTitle: "歷史文章",
    archivesDesc: "按年月時間軸瀏覽全部文章。",

    searchTitle: "搜尋",
    searchDesc: "搜尋任何文章…",
  },
  a11y: {
    skipToContent: "跳至主要內容",
    openMenu: "開啟選單",
    closeMenu: "關閉選單",
    toggleTheme: "切換深淺色模式",
    searchPlaceholder: "搜尋文章…",
    noResults: "找不到相關結果",
    goToPreviousPage: "前往上一頁",
    goToNextPage: "前往下一頁",
  },
  notFound: {
    title: "404 找不到頁面",
    message: "這個頁面不存在",
    goHome: "回到首頁",
  },
} satisfies UIStrings;
