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
import { TAICHUNG_DISTRICT_SLUGS } from "./src/utils/isTaichung";
import {
  buildCanonicalizedUrls,
  buildDistrictLastmod,
  buildLastmodMap,
  buildSectionLastmod,
  buildStaticLastmod,
  buildThinTagSlugs,
} from "./scripts/sitemap-lastmod.mjs";

// 排程文（pubDatetime 還沒到）與草稿不能算進 lastmod，門檻跟 src/utils/postFilter.ts 同一個值
const sitemapOpts = {
  scheduledPostMargin: config.posts?.scheduledPostMargin ?? 15 * 60 * 1000,
};
const lastmodMap = buildLastmodMap(config.site.url, sitemapOpts);
const sectionLastmod = buildSectionLastmod(config.site.url, sitemapOpts);
// 靜態頁（about／contact／tools…）＝原始檔最後一次 git commit 時間（F091）。
// 淺層 clone 時回空表（不給 lastmod），所以 deploy.yml 的 checkout 必須 fetch-depth: 0。
const staticLastmod = buildStaticLastmod(config.site.url);
// 掛不到 3 篇文章的 tag 聚合頁（薄內容）— 不送進 sitemap，見該函式的說明
const thinTagSlugs = buildThinTagSlugs(sitemapOpts);
// canonicalURL 指向別頁的文章（青安系列 7 篇 → new-housing-loan-3-2026）不送進 sitemap（F049）。
// 頁面、rel=canonical、RSS、列表頁都不動；主文本身照常列在 sitemap。
const canonicalizedUrls = buildCanonicalizedUrls(config.site.url, sitemapOpts);
const safeDecodeURI = (u: string) => {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
};
// 各行政區自己的最新物件日期（F136／F129）。以前分區頁一律套全站最新日，
// IndexNow 比對模式每次都把所有分區頁當成「有變」一起推。
// ⚠️ 已知限制：物件下架不會讓該區日期前進（只算在售物件的日期）。
const districtLastmod = buildDistrictLastmod(sitemapOpts);
const districtBySlug = new Map(
  Object.entries(TAICHUNG_DISTRICT_SLUGS).map(([district, slug]) => [slug, district])
);
// /properties/{區 slug}/ 分區靜態列表頁（2026-09-06 新增）— 是列表頁不是物件明細頁
const districtSlugs = new Set(Object.values(TAICHUNG_DISTRICT_SLUGS));
// 分區頁在售 <3 筆的區（頁面本身輸出 noindex）不進 sitemap，避免「列在 sitemap 又 noindex」的矛盾
import { readdirSync, readFileSync } from "node:fs";
const thinDistrictSlugs = (() => {
  const counts = new Map<string, number>();
  try {
    for (const f of readdirSync("./src/content/properties")) {
      if (!/\.mdx?$/.test(f) || f.startsWith("_")) continue;
      const txt = readFileSync(`./src/content/properties/${f}`, "utf8");
      const fm = txt.split(/^---\s*$/m)[1] ?? "";
      const status = /^status:\s*"?(\w+)"?/m.exec(fm)?.[1] ?? "active";
      if (status !== "active") continue;
      const district = /^district:\s*"?([^"\n]+)"?/m.exec(fm)?.[1]?.trim();
      if (!district) continue;
      counts.set(district, (counts.get(district) ?? 0) + 1);
    }
  } catch {
    /* 讀不到就不排除 */
  }
  const thin = new Set<string>();
  for (const [district, slug] of Object.entries(TAICHUNG_DISTRICT_SLUGS)) {
    if ((counts.get(district) ?? 0) < 3) thin.add(slug);
  }
  return thin;
})();

const isDistrictListPage = (url: string) => {
  const m = url.match(/\/properties\/([a-z0-9-]+)\/$/);
  return Boolean(m && districtSlugs.has(m[1]));
};
// build 當下時間：lastmod 絕不能晚於它（Google 看到未來日期會整份不信 lastmod）
const buildNow = new Date();

export default defineConfig({
  site: config.site.url,
  integrations: [
    mdx(),
    sitemap({
      filter: page => {
        if (canonicalizedUrls.has(page) || canonicalizedUrls.has(safeDecodeURI(page))) return false;
        // 排除 thank-you / search / projects（內容空 / noindex 頁不該進 sitemap）
        if (page.includes("/thank-you")) return false;
        if (page.includes("/search")) return false;
        if (page.includes("/projects")) return false;
        if (page.endsWith("/manifest.json/")) return false;
        // robots.txt 現在是 src/pages/robots.txt.ts endpoint；有沒有尾斜線都排除
        if (page.endsWith("/robots.txt/") || page.endsWith("/robots.txt")) return false;
        if (page.endsWith("/rss.xml/")) return false;
        if (config.features?.showArchives === false && page.endsWith("/archives/")) return false;
        // 薄 tag 頁（掛不到 3 篇文章）不送進 sitemap。頁面本身照樣存在、照樣可爬，
        // 只是不主動把爬取預算花在跟單篇文章幾乎重複的聚合頁上。
        // tag 分頁 /tags/<slug>/2/ 一律不進 sitemap（第 1 頁已代表整個聚合頁）。
        const dm = page.match(/\/properties\/([a-z0-9-]+)\/$/);
        if (dm && thinDistrictSlugs.has(dm[1])) return false;
        const tagMatch = page.match(/\/tags\/([^/]+)\/?(\d+\/?)?$/);
        if (tagMatch) {
          if (tagMatch[2]) return false;
          if (thinTagSlugs.has(decodeURIComponent(tagMatch[1]))) return false;
        }
        return true;
      },
      // 物件頁、文章頁優先級高、列表頁次之
      serialize(item) {
        if (isDistrictListPage(item.url)) {
          item.priority = 0.8; // 分區列表頁
          item.changefreq = "daily" as never;
        } else if (item.url.includes("/properties/") && !item.url.endsWith("/properties/")) {
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
        let lm = lastmodMap.get(item.url) ?? staticLastmod.get(item.url);
        if (!lm && isDistrictListPage(item.url)) {
          // 分區列表頁：用該區自己的最新日期；查不到才落到下面的 section fallback。
          // /areas/* 維持 section fallback（不從這裡 import src/data/areas.ts，那支會帶圖片 import）。
          const slug = item.url.match(/\/properties\/([a-z0-9-]+)\/$/)?.[1];
          const district = slug ? districtBySlug.get(slug) : undefined;
          if (district) lm = districtLastmod.get(district);
        }
        if (!lm) {
          // 分頁(/posts/2/)、個別區域頁(/areas/north-tun/) 等沒進精確表的，
          // 用該 section 最新日期 fallback；靜態頁查不到 git 日期（淺層 clone）→ 維持無 lastmod
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
    // 2026-10-04 拿掉 Google Sans Code（等寬字）：全站 0 glyph 使用，Layout 的 <Font> 與
    // theme.css 的 --font-app 先前已拿掉；程式碼區塊走 ui-monospace／Consolas 系統字。
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
