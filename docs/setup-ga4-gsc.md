# GA4 + Google Search Console 設定手冊

Code 已接好，你只需要走以下步驟拿 ID → 貼到 Cloudflare Pages → redeploy 生效。

---

## A. 申請 Google Analytics 4（約 5 分鐘）

1. 開 <https://analytics.google.com/>，登入 `a0920118756@gmail.com`
2. 左側選**「管理」**（齒輪圖示）→ 點「**建立帳戶**」
3. 帳戶名稱：`陳景泰個人` → 下一步
4. 建立資源：
   - 資源名稱：`teddy-website-blog`
   - 報表時區：`台灣`
   - 幣別：`新台幣 (TWD)`
5. 商家詳情 → 行業：`Real Estate`、規模：`小型（1-10 名員工）`
6. 商家目標 → 勾選「**產生潛在客戶**」→ 建立
7. 平台選「**網站**」：
   - 網站網址：`teddy-website-blog.pages.dev`
   - 串流名稱：`個人網站`
8. 建立完成後會顯示**評估 ID**，格式：`G-XXXXXXXXXX`
   - **複製這組 ID，下面要用**

---

## B. 申請 Google Search Console + 提交 Sitemap（約 5 分鐘）

1. 開 <https://search.google.com/search-console/>，登入同帳號
2. 點「**新增資源**」→ 選「**網址前置字元**」
3. 輸入：`https://teddy-website-blog.pages.dev/` → 繼續
4. 驗證方式選「**HTML 標記**」：
   - 會看到一段 `<meta name="google-site-verification" content="XXXXX...">`
   - **只複製 `content="..."` 裡面那段文字**（不含引號，例如 `abc123XYZ...`）
5. 先不要點「驗證」，等部署好再回來驗

### 提交 Sitemap（GSC 驗證通過後才做）

1. GSC 左側選**「Sitemap」**
2. 在「新增 Sitemap」欄位輸入：`sitemap-index.xml`
3. 點「**提交**」
4. 狀態出現「成功」即完成

---

## C. 貼到 Cloudflare Pages 環境變數

1. 開 <https://dash.cloudflare.com/> → 左側「**Workers & Pages**」
2. 點 `teddy-website-blog` → 右上「**Settings**」→ 左側「**Variables and Secrets**」
3. **Production** 環境加兩個變數（Preview 也要加，點右上切換）：

| Variable name | Value |
|---------------|-------|
| `PUBLIC_GA4_MEASUREMENT_ID` | `G-XXXXXXXXXX`（你的 GA4 評估 ID） |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | `abc123...`（GSC content 字串） |

4. 按「**Save**」
5. 回到「**Deployments**」→ 點最新部署右邊的「**…**」→「**Retry deployment**」
6. 等 1-2 分鐘部署完成

---

## D. 回 GSC 完成驗證

1. 部署完成後，回 Search Console 點「**驗證**」
2. 顯示「擁有權已驗證」即成功

---

## E. 驗證 GA4 有收到資料

1. 開網站 `https://teddy-website-blog.pages.dev/`
2. 左下角出現「接受 / 拒絕」cookie banner → 點**「接受」**
3. 開 DevTools（F12）→ 「Network」tab → 搜尋 `g/collect`
4. 應該看到 2-3 個 hit（consent update + page_view）
5. GA4 後台 → 左側「報表」→「即時」→ 看到「1 個使用者」✅

### 測試三個自訂事件

| 要做什麼 | 期待在 Network 看到 |
|----------|-------------------|
| 點任何 LINE 按鈕 | `en=click_line` |
| `/properties/` 點物件卡片 | `en=click_property` |
| 在文章頁停留 30 秒 | `en=dwell_30` |
| 在文章頁停留 60 秒 | `en=dwell_60` |
| 在文章頁停留 120 秒 | `en=dwell_120` |

GA4 後台 → 「報表」→「參與」→「事件」→ 24 小時後會看到事件出現（即時報表可馬上看）。

---

## 備忘：GA4 在 GA4 後台建議開啟的設定

- 「資源」→「資料收集和修改」→「Google 信號」→ 啟動（跨裝置追蹤）
- 「資源」→「資料收集和修改」→「資料保留」→ 改為 **14 個月**（預設 2 個月）
- 「資源」→「資源詳情」→ 確認幣別 TWD、時區台北
