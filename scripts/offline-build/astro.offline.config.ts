/**
 * 離線建置用設定（只給本機驗證用，不是正式部署設定）。
 *
 * 為什麼需要：正式設定的網頁字型走 Google 字型供應商，Astro 在建置一開始一定會連網取字型清單，
 * 沒網路（或要確保建置不連外）就會失敗。這份設定只把兩個字型來源換成「本機已快取的檔」，
 * 其餘設定（整合、sitemap、環境變數…）原樣沿用正式的 astro.config.ts。
 * 兩個字型的字面效果與正式站不同（只有一個字塊），所以只能拿來比對「結構」，不能拿來看字型外觀。
 *
 * 用法（從專案根目錄）：
 *   node node_modules/astro/bin/astro.mjs build --config scripts/offline-build/astro.offline.config.ts
 * 建議同時設 ASTRO_TELEMETRY_DISABLED=1，並把代理指到不通的位址確保真的沒有連外（見交付說明）。
 */
import { fontProviders } from "astro/config";
import base from "../../astro.config";

const cache = "./node_modules/.astro/fonts/";

export default {
  ...base,
  fonts: [
    {
      name: "Noto Sans TC",
      cssVariable: "--font-noto-sans-tc",
      provider: fontProviders.local(),
      fallbacks: ["PingFang TC", "Heiti TC", "Microsoft JhengHei", "sans-serif"],
      options: {
        variants: [
          { weight: 700, style: "normal", src: [`${cache}13e1bb67c734d848.woff2`] },
        ],
      },
    },
    {
      // OG 圖專用（satori 要整檔 ttf）。這裡只求建置能過，兩個字重各借一份已快取的整檔。
      name: "Noto Sans TC",
      cssVariable: "--font-noto-sans-tc-og",
      provider: fontProviders.local(),
      fallbacks: ["sans-serif"],
      options: {
        variants: [
          { weight: 400, style: "normal", src: [`${cache}02bb315afd9daa93.ttf`] },
          { weight: 700, style: "normal", src: [`${cache}63e2a9705ca4d137.ttf`] },
        ],
      },
    },
  ],
};
