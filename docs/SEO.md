# teddy-website SEO 架構文件

整理 2026-05-26 大優化後的 SEO 全貌。給未來的我自己 / 接手的開發者參考。

## 1. 全站 SEO 基礎建設

### Layout.astro 共用 props
所有頁面透過 `Layout` 接 4 個 SEO props：
- `title?` — page title (預設用 site.title)
- `description?` — meta description (預設用 site.description)
- `ogImage?` — OG image URL (預設用 resolveDefaultOgImagePath)
- `canonicalURL?` — canonical URL (預設用 Astro.url.pathname)
- `noindex?` — 加 `<meta name="robots" content="noindex, follow">`
- `prevURL?` / `nextURL?` — pagination rel=prev/next

### 全站 schema.org @graph (Layout.astro)
SSR 階段在 `<head>` 內注入 3 個 entity 用 `@graph` 連結：
1. `RealEstateAgent` (景泰本人) — `@id: ${site.url}#realestateagent`
2. `RealEstateAgent` (公司：有巢氏世界之心) — `@id: ${site.url}#organization`
3. `WebSite` (站本身、含 SearchAction) — `@id: ${site.url}#website`

各頁 schema 可用 `@id` 引用這 3 個 entity 不重複定義。

### safeJsonLd helper
`src/utils/safeJsonLd.ts` 處理 `set:html` JSON-LD 的 XSS 防護：
- escape `</script` → `<\/script`
- escape `</style` → `<\/style`
- escape `<!--` → `<\!--`

**全站 set:html JSON.stringify pattern 都改為 safeJsonLd。** 任何包含 user-controlled 字串的 schema (frontmatter title/description/etc) 必須走這個 helper。

## 2. 各頁 schema 配置

| 頁面 | Schema | @id |
|------|--------|-----|
| `/` (首頁) | WebPage + SiteNavigationElement | `#webpage` |
| `/about` | ProfilePage + Breadcrumb | `#profilepage` |
| `/services` | 4 Service + OfferCatalog + Breadcrumb | `services#${slug}` |
| `/contact` | ContactPage + CommunicateAction × 2 + Breadcrumb | `#contactpage` |
| `/tools` | WebApplication + Breadcrumb | - |
| `/media` | CollectionPage + Breadcrumb | `#collectionpage` |
| `/faq` | FAQPage + Breadcrumb | - |
| `/areas` | ItemList + Breadcrumb | - |
| `/areas/{slug}` | Breadcrumb + RealEstateAgent(local) + FAQPage | - |
| `/properties` | ItemList + Breadcrumb | `#listing` |
| `/properties/{id}` | Product + Apartment/SingleFamilyResidence/etc + Breadcrumb | - |
| `/posts/{slug}` | BlogPosting + Breadcrumb (@graph) | `#article` |

## 3. 性能策略

### Cloudflare _headers (public/_headers.txt → postbuild rename)
- `/og/*` `/properties/*` `/cards/*` 圖片：1 個月 cache + SWR
- `/_astro/*` (hashed)：1 年 immutable
- `/pagefind/*`：1 天 + SWR 1 小時
- HTML：不指定 Cache-Control (Cloudflare default)
- 全站 Security headers: nosniff / SAMEORIGIN / strict-origin / Permissions-Policy

### Preconnect / DNS-prefetch (Layout.astro)
- preconnect: googletagmanager (TLS 提前)
- dns-prefetch: google-analytics / fonts.googleapis / line.me

### Core Web Vitals → GA4 (Analytics.astro)
PerformanceObserver 自動 track LCP / CLS / FID 進 GA4，附 rating (good/needs-improvement/poor)。

## 4. 法規 / 內容檢查

### scripts/audit-properties.mjs（2026-09-06 起是 deploy 閘門）
掃 `src/content/properties/*.md` 的 title / streetArea / community / description / highlights / body：
- **ERROR（exit 1，擋 build）**：完整門牌、非白名單手機（白名單 0920-118-756 / 04-2312-0888）、
  「經紀人：」後面不是黃永隆、誇大詞（絕版 / 最強 / 社區最低 / 稀有 / 賠售…）、
  漲跌預測（增值潛力 / 翻倍 / 看漲 / 保值…）、內部用語（專任 / 委編 / UG…）、屋主稱謂 / 身分證
- **WARN**：第三人聯絡引導（LINE ID： / 洽詢 / 聯絡人）、預售敏感詞、議價用語、body 缺證號
- 詞表跟物件頁渲染層過濾、properties-sync 產生腳本三處要一致
- body 結尾固定的 `> 委編：XXX` footer 暫時豁免（產生腳本改成「物件編號」後拿掉豁免）

輸出 `audit/audit-{date}.md` + `.json`（audit/ 已 gitignore，CI 用 artifact 收）。
本機只看報告：`node scripts/audit-properties.mjs --warn-only`。
物件 md 是每晚自動產生的，**不要手改 md**，要改 `~/.claude/skills/properties-sync/scripts/apply_utrust.py` 的清洗規則。

### scripts/lint-seo.mjs
掃 `src/content/posts/*.md` 找：
1. title 缺 / 太短 / 太長 / 重複
2. description 缺 / 太短 / 太長 / 開頭標點 / 重複 / 含廣告誇大
3. tags 缺 / 預設 "others"
4. pubDatetime 缺
5. ogImage 缺 (warn only)

`exit 1` if ERROR，適合 pre-commit / CI 擋 push。

### CI 整合
- `.github/workflows/deploy.yml`（push main / 排程 / 手動）：lint-seo → audit-properties → og-thumbs → astro check →
  astro build → pagefind → postbuild → 驗 dist → wrangler deploy。跟 `package.json build` 同一組步驟，兩邊一起改。
  有 `concurrency: cf-pages-deploy`（同時只跑一條、後到排隊）；cron 改非整點兩班 `23 2 * * *`、`41 4 * * *`（UTC）。
- `.github/workflows/ci.yml`（PR / 非 main 分支 push / 手動）：只跑 lint-seo + audit-properties + astro check，
  audit report 上傳 artifact (30 天)。不跑 eslint / prettier（規則對 CLI/Worker 的 console 全判錯，先修 eslint.config.js）。
- pnpm 版本一律吃 `package.json` 的 `packageManager`（corepack），workflow 內不寫死 version。

## 5. Sitemap 策略

`astro.config.ts` sitemap integration:
- 排除 `/thank-you` `/search` `/manifest.json` `/robots.txt` `/rss.xml`
- priority + changefreq:
  - 首頁: 1.0 daily
  - 物件詳細頁: 0.9 weekly
  - 文章: 0.8 monthly
  - 列表頁: 0.8 daily
  - 其他: 0.6 weekly

### 5.1 lastmod / 薄 tag（2026-09-06 修正）

`scripts/sitemap-lastmod.mjs` 只算「已發布」內容：`draft: true` 與 pubDatetime − 15 分鐘還沒到的排程文
不進 lastmod 對照表（之前 47 筆 lastmod 是未來日期 2026-09-08，Google 會整份不信 lastmod）；
`astro.config.ts` serialize 再 clamp 一次 `lastmod ≤ build 時間`。
tag 聚合頁：掛不到 3 篇的 tag（`THIN_TAG_MIN_POSTS`，`src/utils/getUniqueTags.ts` 與 sitemap 腳本同值）
不進 sitemap、頁面輸出 `noindex,follow`；tag 分頁 `/tags/x/2/` 一律不進 sitemap 且 noindex；
分頁 title 帶「（第 N 頁）」。`/tags/` 索引依篇數排序、顯示 (n)、<3 篇收進「更多主題」摺疊。
tags 解析同時支援縮排 / 不縮排 / 行內陣列三種 YAML 寫法（舊版只認縮排，109 篇沒被計數）。

## 6. robots.txt 策略

⚠️ 線上生效的是 `public/robots.txt`（public/ 檔案優先，build log 會印 "Skipping src/pages/robots.txt.ts"），
`src/pages/robots.txt.ts` 是被蓋掉的死碼、內容跟線上不一致（仍 Disallow /thank-you）。改 robots 只改 public/ 那份。

`src/pages/robots.txt.ts`（死碼，僅供參考）:
- Disallow `/api/` `/functions/` `/admin/` `/thank-you`
- 明確允許 Googlebot / Mediapartners-Google / Googlebot-Image
- 允許 AI bots (GPTBot / ClaudeBot / CCBot)
- 限速 AhrefsBot / SemrushBot (Crawl-delay: 5)

## 7. 待辦 / 待補強

- [ ] 物件 frontmatter 補 `geo` (lat/lng) 給 Google Map rich result
- [ ] /tools 其他工具上線後補 SoftwareApplication schema
- [ ] 文章內鏈自動化 (跨文章關鍵詞 auto-link)
- [x] Apple touch icon 多尺寸 (180x180 / 192x192 / 512x512) — 2026-09-06 由 favicon.svg 疊站底色轉出
      `public/apple-touch-icon.png`、`icon-192.png`、`icon-512.png`，manifest.json.ts 已引用。
      favicon 本身仍是 AstroPaper 的 Astro logo，換 logo 時三張 PNG 要一起重產。
- [ ] 加 Last-Modified HTTP header per page (Cloudflare worker)
- [ ] 監控 Google Search Console rich result errors

## 維護 SOP

1. **加新文章** → frontmatter 補齊 title/description/tags/pubDatetime/ogImage
2. **加新物件** → 跑 `node scripts/audit-properties.mjs` 確認沒違規
3. **發佈前** → `pnpm build` 觀察 0 error + Lighthouse 跑一次
4. **每月** → 看 audit report + GA4 Core Web Vitals 報表 + GSC rich result 報告

## Schema 修改原則

- **改 schema 前必跑 build 驗證 JSON-LD 寫入 dist HTML**
- **動態欄位 (frontmatter) → 必走 safeJsonLd**
- **靜態欄位 (寫死 string) → 也走 safeJsonLd 保持一致**
- **跨頁複用 entity (e.g. RealEstateAgent)** → 用 `@id` 引用、不重複定義
- **Schema 變動後到 Google Rich Results Test 驗證**: <https://search.google.com/test/rich-results>

## 2026-09-06 系統層改動摘要（B5）

- **字型**：`astro.config.ts` Noto Sans TC 拆兩個 entry — 網頁用 `--font-noto-sans-tc`（不指定 formats → woff2、
  Google 回 unicode-range 切片，weights 只留 700/900）；OG 圖用 `--font-noto-sans-tc-og`（formats ttf、400/700，
  只給 og.png.ts / index.png.ts 的 satori 讀，Layout 不 render）。之前 formats woff/ttf 讓每頁下載 4.2–8.3MB 整包字檔。
  Google Sans Code 只留 400/700 normal。
  驗收：`curl -s https://teddy-website-blog.pages.dev/ | grep -c unicode-range` 應 > 0；dist/_astro/fonts 不該再有 4MB 的 .woff。
- **快取**：`public/_headers.txt` 物件照改單 splat `/properties/*.jpg`（雙 splat 整條無效，線上 2,982 張照片 max-age=0），
  且改 1 天 + stale-while-revalidate 7 天（照片是同路徑覆寫，鎖 30 天會黏舊圖）。
  驗收：`curl -I https://teddy-website-blog.pages.dev/properties/<id>/photo_01.jpg` 看 `max-age=86400`。
- **content collection**：三個 loader pattern 改 `["**/[^_]*.{md,mdx}", "!**/_*/**"]`，底線資料夾也排除；
  已刪 `src/content/posts/_color-schemes/`。GSC 要提交移除 `/posts/predefined-color-schemes/` 與 `/tags/color-schemes/`。
- **閘門**：見「4. 法規 / 內容檢查」與「CI 整合」。
- **死重量**：Tag.astro / Card.astro 的 `transition:name` 已刪（沒開 ClientRouter，只會替每個元素灌一段 `<style>`，/tags/ 曾 857KB）。
- **相關文章**：RelatedPosts 改計分制 — 同行政區 +3（從 tags「X區」/ frontmatter community 對 `src/data/areas.ts` /
  檔名拼音推）、同系列 +1、每個重合 tag +1，社區文推同區社區文再 +2。
- **LINE 綠**：`theme.css --color-line` #06c755 → #0c8540（白字對比 2.26 → 4.72，過 WCAG AA 小字）。
- **head**：空 `theme-color` 已刪；apple-touch-icon 指向 180 PNG；manifest 補 192/512 PNG、theme_color 改 --accent。
- **分頁**：Pagination.astro 加頁碼（1 … 當前±2 … 末頁）。
