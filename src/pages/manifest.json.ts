/**
 * Web App Manifest — 給 mobile browsers + PWA-capable clients
 * 用 endpoint 動態生成、避免在 public/ 放靜態 .json (跟 Cloudflare _headers cache 衝突)
 *
 * 用途：
 * - Android Chrome 「加到主畫面」時的 app metadata
 * - Edge / Safari 認得是 web app
 * - 給 SEO/Lighthouse 加分
 */
import type { APIRoute } from "astro";
import config from "@/config";

export const GET: APIRoute = ({ site }) => {
  const origin = site?.href ?? "/";
  const manifest = {
    name: config.site.title,
    short_name: "景泰房仲",
    description: config.site.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0066cc",
    lang: "zh-TW",
    dir: "ltr",
    orientation: "portrait-primary",
    categories: ["business", "lifestyle", "real_estate"],
    icons: [
      {
        src: new URL("favicon.svg", origin).href,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: "在售物件",
        url: "/properties",
        description: "看景泰所有在售物件",
      },
      {
        name: "LINE 諮詢",
        url: "https://line.me/ti/p/sky811117",
        description: "30 秒內聯絡景泰",
      },
      {
        name: "房市筆記",
        url: "/posts",
        description: "100+ 篇實戰文章",
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
