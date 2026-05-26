import type { APIRoute } from "astro";

/**
 * robots.txt：
 * - 全部允許爬
 * - 明確擋掉 /admin / /api / /functions (Cloudflare Function endpoints) 不需要被 index
 * - 擋 RSS 跟 sitemap 變體（避免重複 index）
 * - 加 sitemap location
 *
 * 對特定爬蟲（GPTBot / CCBot 等 AI 訓練 bot）：景泰允許爬 (content 本來就公開)
 */
const getRobotsTxt = (sitemapURL: URL) => `
User-agent: *
Allow: /
Disallow: /api/
Disallow: /functions/
Disallow: /admin/
Disallow: /thank-you

# 給 Google AdSense / Mobile (預設允許)
User-agent: Mediapartners-Google
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Googlebot-Image
Allow: /

# AI training bots：景泰允許 (對外公開 content)
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: CCBot
Allow: /

# 慢爬蟲限速 (避免 server burden)
User-agent: AhrefsBot
Crawl-delay: 5

User-agent: SemrushBot
Crawl-delay: 5

Sitemap: ${sitemapURL.href}
`;

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL("sitemap-index.xml", site);
  return new Response(getRobotsTxt(sitemapURL));
};
