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

### scripts/audit-properties.mjs
掃 `src/content/properties/*.md` 找：
1. 完整門牌 (HIGH)
2. 屋主隱私: 手機 / 姓名 / 身分證 (HIGH，景泰本人電話加白名單)
3. 廣告誇大 14 個絕對形容詞 (MEDIUM)
4. 證號揭露 (頁面 footer 自動 render、warn-only)
5. 預售敏感詞 (MEDIUM)

輸出 `audit/audit-{date}.md` + `.json`。

### scripts/lint-seo.mjs
掃 `src/content/posts/*.md` 找：
1. title 缺 / 太短 / 太長 / 重複
2. description 缺 / 太短 / 太長 / 開頭標點 / 重複 / 含廣告誇大
3. tags 缺 / 預設 "others"
4. pubDatetime 缺
5. ogImage 缺 (warn only)

`exit 1` if ERROR，適合 pre-commit / CI 擋 push。

### CI 整合 (.github/workflows/ci.yml)
每次 PR 自動跑 audit + lint，audit report 上傳 artifact (30 天保留)。

## 5. Sitemap 策略

`astro.config.ts` sitemap integration:
- 排除 `/thank-you` `/search` `/manifest.json` `/robots.txt` `/rss.xml`
- priority + changefreq:
  - 首頁: 1.0 daily
  - 物件詳細頁: 0.9 weekly
  - 文章: 0.8 monthly
  - 列表頁: 0.8 daily
  - 其他: 0.6 weekly

## 6. robots.txt 策略

`src/pages/robots.txt.ts`:
- Disallow `/api/` `/functions/` `/admin/` `/thank-you`
- 明確允許 Googlebot / Mediapartners-Google / Googlebot-Image
- 允許 AI bots (GPTBot / ClaudeBot / CCBot)
- 限速 AhrefsBot / SemrushBot (Crawl-delay: 5)

## 7. 待辦 / 待補強

- [ ] 物件 frontmatter 補 `geo` (lat/lng) 給 Google Map rich result
- [ ] /tools 其他工具上線後補 SoftwareApplication schema
- [ ] 文章內鏈自動化 (跨文章關鍵詞 auto-link)
- [ ] Apple touch icon 多尺寸 (180x180 / 192x192 / 512x512)
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
