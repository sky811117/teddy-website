# 客戶詢價表單 — 設定指南（2026-09-06 版）

站上兩張表單：
- **ContactForm**（買方 / 一般詢價）：`/contact/`、`/buy/`、`/services/`、`/faq/`、每一個 `/properties/{id}/`
- **SellForm**（賣房行情評估）：`/sell/`、`/contact/?type=sell`

兩張表單的主管道都是 **Cloudflare Pages Functions → Telegram**。
Formspree（Email）是 ContactForm 的**選配副管道**。

> ⚠️ 2026-09-05 查證：從 2026-05-23 上線到現在，兩個後端變數都**沒設過**，
> 而且 Formspree 的 ID 放錯地方（放 Cloudflare 後台、但 build 跑在 GitHub Actions 吃不到）。
> 表單 3.5 個月來沒送出過任何一筆。下面是修正後的正確流程。

---

## 0. 先搞懂：哪個變數要放哪裡

這個站的架構是 **GitHub Actions 跑 `astro build` → wrangler 把 dist 直接上傳 Cloudflare Pages**。
Cloudflare Pages 完全不參與 build，所以：

| 變數 | 誰用 | 要放哪裡 | 放錯的下場 |
|---|---|---|---|
| `PUBLIC_FORMSPREE_FORM_ID` | `astro build` 烘進前端 HTML | **GitHub repo → Settings → Secrets and variables → Actions → Variables** | 放 Cloudflare 後台 = 前端永遠拿到空字串 |
| `CONTACT_TG_TOKEN` | Pages Functions（執行期） | **Cloudflare Pages → teddy-website-blog → Settings → Environment variables** | 放 GitHub = Functions 讀不到 |
| `CONTACT_TG_CHAT` | 同上 | 同上 | 同上 |
| `NOTION_API_KEY` / `NOTION_SELL_DB_ID` | Pages Functions（賣方表單寫 Notion） | Cloudflare Pages 環境變數 | 沒設只是不寫 Notion，TG 照推 |

`PUBLIC_*` 開頭的是 `astro:env/client` 變數，**build 時就決定值**，之後改 Cloudflare 後台沒用，要重新跑 GitHub Actions。

---

## 1. Telegram 推播（必做 — 這是主管道）

### 步驟

1. 拿 TG bot token（建議用「泰迪的小聲音」bot — token 在 `teddy-voice-bot/.env` 的 `TELEGRAM_BOT_TOKEN`）
2. 拿 chat_id（同一個 `.env` 的 `TELEGRAM_CHAT_ID`）
3. Cloudflare Dashboard → Workers & Pages → **teddy-website-blog** → Settings → Environment variables → Add：

   | 名稱 | 值 | Environment |
   |---|---|---|
   | `CONTACT_TG_TOKEN` | bot token（勾 Encrypt） | Production + Preview |
   | `CONTACT_TG_CHAT` | chat_id | Production + Preview |

4. **Functions 的環境變數要重新部署才生效**：GitHub → Actions → 「Deploy to Cloudflare Pages」→ Run workflow（或推一個空 commit）。

### 驗證（不用真的填表單）

```bash
curl -s -X POST https://teddy-website-blog.pages.dev/api/contact-tg \
  -H "Origin: https://teddy-website-blog.pages.dev" \
  -H "Content-Type: application/json" \
  -d '{"姓名":"設定測試","手機":"0912345678","我想":"一般諮詢","_loaded_at":"1"}'
```

- 回 `{"ok":true}` + 手機 TG 響 → 設好了
- 回 `{"ok":false,"degraded":true,"error":"backend_not_configured"}` → 變數沒設或沒重新部署
- 回 `{"ok":false,"error":"Forbidden origin"}` → 少帶 `Origin` header（API 只收自家網域）

同樣方式打 `/api/contact-sell`（欄位：`姓名` / `電話` / `物件地址` 必填，`坪數` / `期望總價(萬)` 選填）。

### TG 訊息範本

```
🔔 新詢價｜找房

姓名：王小姐
手機：0912-345-678
Email：xxx@gmail.com
預算：1000-1500萬
物件：UG1187665 (北屯區3房...)
區域：北屯區、西屯區

訊息：
想看週六、可以嗎？

來源：/properties/1187665/
```

---

## 2. Formspree（Email 副管道）— 選做

不設也能用：TG 是主管道。設了之後多一份 Email 存底（Formspree dashboard 可下載 CSV）。

### 步驟

1. 到 <https://formspree.io/register> 註冊（free tier 50 submissions/月）— **這步要景泰本人做，AI 不代建帳號**
2. 用 `a0920118756@gmail.com` 註冊，New Form → Send to 同一個信箱
3. 拿到 form ID（網址 `https://formspree.io/f/mzzznnnn`、ID 就是 `mzzznnnn`）
4. **GitHub** → sky811117/teddy-website → Settings → Secrets and variables → Actions → **Variables** tab → New repository variable：

   | Name | Value |
   |---|---|
   | `PUBLIC_FORMSPREE_FORM_ID` | `mzzznnnn` |

5. `.github/workflows/deploy.yml` 的 Build step `env:` 加一行（目前還沒有）：

   ```yaml
   PUBLIC_FORMSPREE_FORM_ID: ${{ vars.PUBLIC_FORMSPREE_FORM_ID }}
   ```

6. 推上 main 觸發 deploy；build 完後 `curl -s https://teddy-website-blog.pages.dev/contact/ | grep -o 'data-formspree-id="[^"]*"'` 應該看到 ID 而不是空字串
7. Formspree 會寄一封確認信到 gmail，點了才開始收件

---

## 3. 表單行為（前端）

- ContactForm 一律 POST `/api/contact-tg`；有 Formspree ID 才並行 POST Formspree
- **任一條回 ok** → 導 `/thank-you/?form=contact&intent=找房`
- **兩條都沒收到**（變數沒設 / TG 掛了 / 斷網）→ 表單**原地**顯示備援面板：
  「已經把你的需求整理好了」+ 📋 複製訊息（把姓名 / 需求 / 物件編號組成一段文字進剪貼簿）+ LINE 鈕（`/go/line?src=form-fallback`）+ 撥電話鈕。
  客戶永遠不會看到「後端沒設定」這類字。
- SellForm 同樣邏輯（`/api/contact-sell`、備援 src=`sell-form-fallback`）
- GA4 事件：表單送出 `lead_submit`（`status: ok|degraded`, `form: contact|sell`）；感謝頁 `generate_lead`（建議在 GA4 標成轉換）

---

## 4. 防護（Functions 端）

- Honeypot `_gotcha` + `_loaded_at` 3 秒偵測（client 自報、擋笨 bot）
- **Origin / Referer 白名單**：只收 `https://teddy-website-blog.pages.dev`、`https://*.teddy-website-blog.pages.dev`（預覽）、`http://localhost:*`；其他回 403
- 欄位長度上限（姓名 50 / 電話 20 / Email 120 / 地址 200 / 訊息 1000 …），body > 10KB 回 413
- `/go/line` 同一 IP 5 分鐘只推一則 TG（in-memory）
- 還沒做：Cloudflare Turnstile。若之後 spam 變多再加（要 fail-open：驗證服務掛了也要放行，不能把客戶擋在外面）

---

## 5. 客戶資料保管

- TG 訊息只當即時通知
- 賣方 lead 進 Notion「賣房客戶名單」（`NOTION_SELL_DB_ID`）
- 買方 lead 目前只有 TG（+ Formspree 若有設）；正式 CRM 要手動進 Notion 客戶 DB
- 客戶要求刪除：Formspree dashboard 手動刪、Notion 手動刪
- 隱私權政策頁還沒有（待）；表單文案已改成「資料只用來回覆你，存在景泰自己的客戶名單與手機通知裡，不轉賣、不做行銷名單」

---

## 6. 怎麼移除表單

找該 page 檔案，刪掉 `import ContactForm ...` 與 `<ContactForm ... />` 那段。元件本身保留。
