import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";
import config from "@/config";

export async function GET() {
  const posts = await getCollection("posts");
  const sortedPosts = getSortedPosts(posts);

  return rss({
    title: config.site.title,
    description: config.site.description,
    site: config.site.url,
    // RSS feed 強化：限 50 篇最新 (避免 feed 太大)、加 categories (tags) + author
    items: sortedPosts.slice(0, 50).map(({ data, id, filePath }) => ({
      link: getPostUrl(id, filePath, config.site.lang),
      title: data.title,
      description: data.description,
      pubDate: new Date(data.pubDatetime),
      categories: data.tags ?? [],
      author: data.author ?? config.site.author,
      // 若有 modDatetime 加 dc:date 標明 (RSS spec 沒原生支援、但 readers 可解析)
      customData: data.modDatetime
        ? `<dc:date>${new Date(data.modDatetime).toISOString()}</dc:date>`
        : undefined,
    })),
    // RSS namespace 加 dc 給 customData
    xmlns: {
      dc: "http://purl.org/dc/elements/1.1/",
    },
    // RSS channel 加 language + lastBuildDate
    customData: `<language>zh-TW</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate><copyright>陳景泰 / 一品不動產 有巢氏房屋 台中世界之心加盟店</copyright>`,
  });
}
