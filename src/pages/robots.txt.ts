/**
 * robots.txt — 用 endpoint 產生（2026-10-03 取代 public/robots.txt）
 *
 * 為什麼不再放 public/：裡面的 Sitemap 網址寫死 teddy-website-blog.pages.dev，
 * 換網域（teddy-house.tw）時很容易漏改。改成從 astro-paper.config.ts 的 site.url 組，
 * 網域一換，這裡跟 sitemap 一起跟著走。
 *
 * ⚠️ public/robots.txt 不可以再放回去：同一個路徑兩個來源會衝突。
 * ⛔ 不要加 AI 爬蟲分組（F110 已駁回），也不要 Disallow /go/ 或 /api/（X023 已駁回）。
 *
 * Sitemap 兩行：
 * - sitemap.xml：postbuild-headers.mjs 從 sitemap-0.xml 複製出來的同內容檔（給 GSC 一個新網址）
 * - sitemap-index.xml：@astrojs/sitemap 原本的入口，Bing 與 IndexNow 腳本都靠它，不能拿掉
 * sitemap 的 filter 已排除 /robots.txt/，這支不會被列進 sitemap。
 */
import type { APIRoute } from "astro";
import config from "@/config";

export const GET: APIRoute = () => {
  const body = [
    "# 景泰（陳景泰）房仲個人官網 - 有巢氏房屋台中世界之心店",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${new URL("sitemap.xml", config.site.url).href}`,
    `Sitemap: ${new URL("sitemap-index.xml", config.site.url).href}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
