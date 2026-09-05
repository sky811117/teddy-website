/**
 * Internal resolved configuration used throughout the codebase.
 *
 * Prefer editing `astro-paper.config.ts` instead of this file. This module exists to
 * apply defaults and expose a fully-resolved config shape (`ResolvedAstroPaperConfig`).
 */
import userConfig from "@/astro-paper.config";
import type { ResolvedAstroPaperConfig } from "./types/config";
import { PUBLIC_GOOGLE_SITE_VERIFICATION } from "astro:env/client";

const DEFAULT_OG_IMAGE = "default-og.jpg";

const config: ResolvedAstroPaperConfig = {
  site: {
    ...userConfig.site,
    ogImage: userConfig.site.ogImage ?? DEFAULT_OG_IMAGE,
    lang: userConfig.site.lang ?? "en",
    timezone: userConfig.site.timezone ?? "UTC",
    dir: userConfig.site.dir ?? "ltr",
    googleVerification:
      userConfig.site.googleVerification || PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
  posts: {
    perPage: userConfig.posts?.perPage ?? 4,
    perIndex: userConfig.posts?.perIndex ?? 4,
    scheduledPostMargin:
      userConfig.posts?.scheduledPostMargin ?? 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: userConfig.features?.lightAndDarkMode ?? true,
    dynamicOgImage: userConfig.features?.dynamicOgImage ?? true,
    showArchives: userConfig.features?.showArchives ?? true,
    showBackButton: userConfig.features?.showBackButton ?? true,
    editPost: userConfig.features?.editPost ?? { enabled: false },
    search: userConfig.features?.search ?? "pagefind",
  },
  socials: userConfig.socials ?? [],
  shareLinks: userConfig.shareLinks ?? [],
};

/**
 * 房貸試算共用參數（物件頁「月付試算」與 /tools 共用，改這裡就好）。
 *
 * rate 是「參考利率」：2.306% 沿用 2026-08-28 物件頁寫死的值，尚未對到央行
 * 「五大銀行新承做購屋貸款利率」的正式公告，所以頁面一律標「參考利率，依銀行
 * 公告為準」。每月底更新時改 rate + asOf 兩個欄位。
 * 只對住宅型物件（大樓／華廈／公寓／透天／別墅／套房）套用；土地／店面／廠房／
 * 商辦／農舍的成數與年限依銀行鑑價而定，不顯示試算。
 */
export const loan = {
  rate: 0.02306, // 年利率（小數）
  ratio: 0.8, // 貸款成數
  years: 30, // 年限
  asOf: "2026-08", // 最後更新月份（yyyy-mm）
  note: "參考利率，依銀行公告為準",
} as const;

export default config;
