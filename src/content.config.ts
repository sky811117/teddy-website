import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import config from "@/config";

export const BLOG_PATH = "src/content/posts";

const posts = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: `./${BLOG_PATH}` }),
  schema: ({ image }) =>
    z.object({
      author: z.string().default(config.site.author),
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),
      title: z.string(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).default(["others"]),
      ogImage: image().or(z.string()).optional(),
      description: z.string(),
      canonicalURL: z.string().optional(),
      hideEditPost: z.boolean().optional(),
      timezone: z.string().optional(),
    }),
});

const pages = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
    canonicalURL: z.string().optional(),
  }),
});

// 在售物件 collection
// 法規注意：欄位設計成 optional，景泰每筆物件自己決定公開到哪個程度
// 屋主資訊、建案案名、門牌號 → 絕對不放
const properties = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.{md,mdx}",
    base: "./src/content/properties",
  }),
  schema: ({ image }) =>
    z.object({
      // 基本識別
      title: z.string(), // 廣告標題 例「北屯輕屋齡，屋況最優」
      district: z.string(), // 區域 例「北屯區」「西屯區」
      community: z.string().optional(), // 社區名（可選擇性公開）
      streetArea: z.string().optional(), // 路段（不含門牌）例「文心路四段」

      // 價格
      totalPrice: z.number(), // 總價（單位：萬）
      pricePerPing: z.number().optional(), // 單坪

      // 規格
      area: z.number(), // 權狀坪數
      indoorArea: z.number().optional(), // 主建物 + 附屬
      layout: z.string(), // 例「3房2廳2衛」
      age: z.number().optional(), // 屋齡
      floor: z.string().optional(), // 例「8/15F」
      parking: z.string().optional(), // 車位 例「平面式 x1」

      // 媒體
      coverImage: image().or(z.string()).optional(),
      photos: z.array(z.string()).default([]),

      // 行銷內容
      highlights: z.array(z.string()).default([]), // 賣點條列
      description: z.string(), // 廣告文案

      // 跨平台連結
      listingCode: z.string().optional(), // 委編 例 UG1195643
      ycutUrl: z.string().url().optional(), // 公司前台
      rakuyaUrl: z.string().url().optional(), // 樂屋
      url591: z.string().url().optional(),
      url5168: z.string().url().optional(),

      // 狀態
      status: z
        .enum(["active", "pending", "sold", "withdrawn"])
        .default("active"),
      featured: z.boolean().optional(), // 首頁精選
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),

      // 法規揭露（廣告必載）
      brokerLicense: z.string().default("黃永隆 113彰縣字324"),
      agentLicense: z.string().default("陳景泰 114登字488296"),
    }),
});

export const collections = { posts, pages, properties };
