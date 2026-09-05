import {
  defineConfig,
  envField,
  fontProviders,
  svgoOptimizer,
} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { transformerFileName } from "./src/utils/transformers/fileName";
import config from "./astro-paper.config";
import {
  buildLastmodMap,
  buildSectionLastmod,
  buildThinTagSlugs,
} from "./scripts/sitemap-lastmod.mjs";

// 排程文（pubDatetime 還沒到）與草稿不能算進 lastmod，門檻跟 src/utils/postFilter.ts 同一個值
const sitemapOpts = {
  scheduledPostMargin: config.posts?.scheduledPostMargin ?? 15 * 60 * 1000,
};
const lastmodMap = buildLastmodMap(config.site.url, sitemapOpts);
const sectionLastmod = buildSectionLastmod(config.site.url, sitemapOpts);
// 掛不到 3 篇文章的 tag 聚合頁（薄內容）— 不送進 sitemap，見該函式的說明
const thinTagSlugs = buildThinTagSlugs(sitemapOpts);
// build 當下時間：lastmod 絕不能晚於它（Google 看到未來日期會整份不信 lastmod）
const buildNow = new Date();

export default defineConfig({
  site: config.site.url,
  integrations: [
    mdx(),
    sitemap({
      filter: page => {
        // 排除 thank-you / search / projects（內容空 / noindex 頁不該進 sitemap）
        if (page.includes("/thank-you")) return false;
        if (page.includes("/search")) return false;
        if (page.includes("/projects")) return false;
        if (page.endsWith("/manifest.json/")) return false;
        if (page.endsWith("/robots.txt/")) return false;
        if (page.endsWith("/rss.xml/")) return false;
        if (config.features?.showArchives === false && page.endsWith("/archives/")) return false;
        // 薄 tag 頁（掛不到 3 篇文章）不送進 sitemap。頁面本身照樣存在、照樣可爬，
        // 只是不主動把爬取預算花在跟單篇文章幾乎重複的聚合頁上。
        // tag 分頁 /tags/<slug>/2/ 一律不進 sitemap（第 1 頁已代表整個聚合頁）。
        const tagMatch = page.match(/\/tags\/([^/]+)\/?(\d+\/?)?$/);
        if (tagMatch) {
          if (tagMatch[2]) return false;
          if (thinTagSlugs.has(decodeURIComponent(tagMatch[1]))) return false;
        }
        return true;
      },
      // 物件頁、文章頁優先級高、列表頁次之
      serialize(item) {
        if (item.url.includes("/properties/") && !item.url.endsWith("/properties/")) {
          item.priority = 0.9; // 物件詳細頁
          item.changefreq = "weekly" as never;
        } else if (item.url.includes("/posts/") && !item.url.endsWith("/posts/")) {
          item.priority = 0.8; // 文章
          item.changefreq = "monthly" as never;
        } else if (item.url === config.site.url || item.url === `${config.site.url}/`) {
          item.priority = 1.0; // 首頁
          item.changefreq = "daily" as never;
        } else if (item.url.includes("/properties") || item.url.includes("/posts") || item.url.includes("/areas")) {
          item.priority = 0.8; // 列表頁
          item.changefreq = "daily" as never;
        } else {
          item.priority = 0.6;
          item.changefreq = "weekly" as never;
        }
        let lm = lastmodMap.get(item.url);
        if (!lm) {
          // 分頁(/posts/2/)、個別區域頁(/areas/north-tun/) 等沒進精確表的，
          // 用該 section 最新日期 fallback；靜態頁(about/contact)無前綴匹配 → 維持無 lastmod
          if (item.url.includes("/posts")) lm = sectionLastmod.posts ?? undefined;
          else if (item.url.includes("/properties") || item.url.includes("/areas"))
            lm = sectionLastmod.properties ?? undefined;
        }
        // 保險：任何 lastmod 都不得晚於 build 時間（排程文、時區誤差都可能超前）
        if (lm && lm > buildNow) lm = buildNow;
        if (lm) item.lastmod = lm.toISOString();
        return item;
      },
    }),
  ],
  i18n: {
    locales: ["zh-TW"],
    defaultLocale: "zh-TW",
    routing: {
      prefixDefaultLocale: false,
    },
  },
  markdown: {
    remarkPlugins: [remarkToc, [remarkCollapse, { test: "Table of contents" }]],
    shikiConfig: {
      themes: { light: "min-light", dark: "night-owl" },
      defaultColor: false,
      wrap: false,
      transformers: [
        transformerFileName({ style: "v2", hideDot: false }),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationDiff({ matchAlgorithm: "v3" }),
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: [
    {
      // 等寬字：只給程式碼區塊用。只留 400/700 normal（之前 5 weights × 2 styles
      // × 2 formats = 20 個檔宣告、線上實際只抓 1 個），不指定 formats → 預設 woff2。
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      provider: fontProviders.google(),
      fallbacks: ["monospace"],
      weights: [400, 700],
      styles: ["normal"],
    },
    {
      // 網頁標題層中文字體（theme.css --font-heading），內文走系統字。
      // ⚠️ 不要加 formats：Astro 預設 woff2 → unifont 用 Chrome UA 向 Google 要 CSS，
      // Google 才會回 unicode-range 切片（每片 10–30KB、只抓標題用到的字塊）。
      // 2026-09 教訓：之前寫 formats: ["woff","ttf"]（為了 satori）害 Google 回單一
      // 整檔（每個 weight 4.1–4.2MB、無 unicode-range），首頁光字型就下載 4.2MB。
      // typography.css：h1/h2 寫 900、h3/h4 700，但只留 700 一個 weight（每個 weight 約 100 個切片 @font-face 會內嵌進每頁 HTML）。
      name: "Noto Sans TC",
      cssVariable: "--font-noto-sans-tc",
      provider: fontProviders.google(),
      fallbacks: [
        "PingFang TC",
        "Heiti TC",
        "Microsoft JhengHei",
        "sans-serif",
      ],
      weights: [700], // 只留 700：每個字重約 100 個 unicode-range 切片 @font-face 會內嵌進每一頁 HTML（約 30KB gzip/字重），h1/h2 的 900 由瀏覽器用 700 字面渲染
      styles: ["normal"],
    },
    {
      // OG 圖專用（satori 只吃 ttf/otf/woff，不吃 woff2）。
      // 只給 src/pages/og.png.ts、src/pages/posts/[...slug]/index.png.ts 透過
      // fontData["--font-noto-sans-tc-og"] 讀；Layout.astro 絕對不要 render 這個 <Font>，
      // 否則整檔 ttf 又會被送到瀏覽器。
      name: "Noto Sans TC",
      cssVariable: "--font-noto-sans-tc-og",
      provider: fontProviders.google(),
      fallbacks: ["sans-serif"],
      weights: [400, 700],
      styles: ["normal"],
      formats: ["ttf"],
    },
  ],
  env: {
    schema: {
      PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
      PUBLIC_GA4_MEASUREMENT_ID: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
      PUBLIC_FORMSPREE_FORM_ID: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
      PUBLIC_CUSDIS_APP_ID: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
      PUBLIC_CUSDIS_HOST: envField.string({
        access: "public",
        context: "client",
        optional: true,
        default: "https://cusdis.com",
      }),
    },
  },
  experimental: {
    svgOptimizer: svgoOptimizer(),
  },
});
