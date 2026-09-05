# teddy-website

陳景泰（Teddy）台中房仲官網：<https://teddy-website-blog.pages.dev/>

- Astro 6 + AstroPaper v6 主題 + Tailwind 4，Cloudflare Pages 靜態部署（GitHub Actions `deploy.yml`）
- 內容：`src/content/posts`（房市文章，兩條供文管線 monthly-market-report / news-alert）、`src/content/properties`（在售物件，每晚由 `450_上架巡檢/nightly_run.py` → `properties-sync/apply_utrust.py` 自動產生，**不要手改 md**）
- 紅線閘門：`scripts/lint-seo.mjs`（文章／頁面／元件）與 `scripts/audit-properties.mjs`（物件），CI 會擋 build
- 表單後端：`functions/api/*`（設定見 `docs/CONTACT_FORM_SETUP.md`）；SEO 架構見 `docs/SEO.md`

```bash
corepack pnpm install
corepack pnpm run dev
corepack pnpm run build   # lint → audit → og-thumbs → astro check → build → pagefind → postbuild
```

本專案沿用 AstroPaper（MIT）主題，原始說明見 <https://github.com/satnaing/astro-paper>。
