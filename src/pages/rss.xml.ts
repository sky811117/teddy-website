import fs from "node:fs";
import path from "node:path";
import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";
import config from "@/config";

// RSS 2.0 的 <author> 規格要求是 email（"信箱 (名字)"），放純名字會被 W3C Feed Validator 報錯
// → 改用 dc:creator 放作者名（2026-10-03 F134）。
const escapeXml = (str: string) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 封面圖 enclosure：只處理 public/ 底下真的存在的 "/xxx.jpg" 字串；
// image() 物件或找不到檔就略過，不自己用 slug 拼路徑。
function getEnclosure(ogImage: unknown) {
  if (typeof ogImage !== "string" || !ogImage.startsWith("/")) return undefined;
  const filePath = path.join(process.cwd(), "public", ogImage);
  try {
    const { size } = fs.statSync(filePath);
    const ext = path.extname(ogImage).toLowerCase();
    const type =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : undefined;
    if (!type) return undefined;
    return { url: new URL(ogImage, config.site.url).href, length: size, type };
  } catch {
    return undefined;
  }
}

export async function GET() {
  const posts = await getCollection("posts");
  const sortedPosts = getSortedPosts(posts);
  const selfHref = new URL("rss.xml", config.site.url).href;

  return rss({
    title: config.site.title,
    description: config.site.description,
    site: config.site.url,
    // RSS feed 強化：限 50 篇最新 (避免 feed 太大)、加 categories (tags) + dc:creator + 封面 enclosure
    items: sortedPosts.slice(0, 50).map(({ data, id, filePath }) => {
      const creator = `<dc:creator>${escapeXml(data.author ?? config.site.author)}</dc:creator>`;
      // 若有 modDatetime 加 dc:date 標明 (RSS spec 沒原生支援、但 readers 可解析)
      const modDate = data.modDatetime
        ? `<dc:date>${new Date(data.modDatetime).toISOString()}</dc:date>`
        : "";
      const enclosure = getEnclosure(data.ogImage);
      return {
        link: getPostUrl(id, filePath, config.site.lang),
        title: data.title,
        description: data.description,
        pubDate: new Date(data.pubDatetime),
        categories: data.tags ?? [],
        customData: creator + modDate,
        ...(enclosure && { enclosure }),
      };
    }),
    // RSS namespace：dc 給 dc:creator / dc:date，atom 給 atom:link rel="self"
    xmlns: {
      dc: "http://purl.org/dc/elements/1.1/",
      atom: "http://www.w3.org/2005/Atom",
    },
    // RSS channel 加 atom:link self + language + lastBuildDate
    customData: `<atom:link href="${selfHref}" rel="self" type="application/rss+xml"/><language>zh-TW</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate><copyright>陳景泰 / 一品不動產 有巢氏房屋 台中世界之心加盟店</copyright>`,
  });
}
