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

export default defineConfig({
  site: config.site.url,
  integrations: [
    mdx(),
    sitemap({
      filter: page => {
        // 排除 thank-you / search (noindex 頁不該進 sitemap)
        if (page.includes("/thank-you")) return false;
        if (page.includes("/search")) return false;
        if (page.endsWith("/manifest.json/")) return false;
        if (page.endsWith("/robots.txt/")) return false;
        if (page.endsWith("/rss.xml/")) return false;
        if (config.features?.showArchives === false && page.endsWith("/archives/")) return false;
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
        return item;
      },
    }),
  ],
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
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
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      provider: fontProviders.google(),
      fallbacks: ["monospace"],
      weights: [300, 400, 500, 600, 700],
      styles: ["normal", "italic"],
      formats: ["woff", "ttf"],
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
