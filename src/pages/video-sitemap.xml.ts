/**
 * 影片網站地圖（2026-11-18）：列出每支短影音的單支頁，給 Google 影片索引用。
 * robots.txt 有列這個網址；一般 sitemap 的 filter 已排除這支 endpoint。
 */
import type { APIRoute } from "astro";
import config from "@/config";
import { coverLarge, embedUrl, getHomeShorts, newsShorts } from "@/data/shorts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

type Entry = { loc: string; thumb: string; title: string; desc: string; player: string; date: string; duration?: number };

const entryXml = (e: Entry) =>
  [
    "<url>",
    `<loc>${esc(e.loc)}</loc>`,
    "<video:video>",
    `<video:thumbnail_loc>${esc(e.thumb)}</video:thumbnail_loc>`,
    `<video:title>${esc(e.title.slice(0, 100))}</video:title>`,
    `<video:description>${esc(e.desc.slice(0, 2048))}</video:description>`,
    `<video:player_loc>${esc(e.player)}</video:player_loc>`,
    e.duration ? `<video:duration>${e.duration}</video:duration>` : "",
    `<video:publication_date>${e.date}T12:00:00+08:00</video:publication_date>`,
    "</video:video>",
    "</url>",
  ]
    .filter(Boolean)
    .join("");

export const GET: APIRoute = async () => {
  const homes = await getHomeShorts();
  const entries: Entry[] = [
    ...homes.map(h => ({
      loc: new URL(`/shorts/homes/${h.code}/`, config.site.url).href,
      thumb: coverLarge(h.videoId, h.cover),
      title: `${h.label} ${h.priceText}｜${h.district}看屋短影音`,
      desc: `${[h.place, h.district, h.layout].filter(Boolean).join("，")}，總價 ${h.priceText}。先看影片了解屋況，再決定要不要約看。`,
      player: embedUrl(h.videoId),
      date: h.pubDate,
    })),
    ...newsShorts.map(n => ({
      loc: new URL(`/shorts/news/${n.slug}/`, config.site.url).href,
      thumb: coverLarge(n.videoId, n.cover),
      title: n.title,
      desc: n.description || n.points[0] || n.title,
      player: embedUrl(n.videoId),
      date: n.date,
      duration: n.duration,
    })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${entries.map(entryXml).join("")}</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
