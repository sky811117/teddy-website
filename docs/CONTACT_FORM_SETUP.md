# 客戶詢價表單 — 設定指南

ContactForm.astro 上線後、要做兩件設定才會真的開始收信 + 推 TG。
都做完約 10 分鐘。

---

## 1. Formspree（Email 通知）— 必做

### 步驟

1. 到 <https://formspree.io/register> 註冊（free tier 50 submissions/月 夠用）
2. 用 `a0920118756@gmail.com` 註冊
3. 進 dashboard → 「+ New Form」
   - Form name：`teddy-website 詢價`
   - Send to：`a0920118756@gmail.com`
4. 拿到 form ID（網址形如 `https://formspree.io/f/mzzznnnn`、ID 就是 `mzzznnnn`）
5. 在 Cloudflare Pages → teddy-website-blog → Settings → Environment variables 新增：

   | 名稱 | 值 | Environment |
   |---|---|---|
   | `PUBLIC_FORMSPREE_FORM_ID` | `mzzznnnn`（你的 ID） | Production + Preview |

6. 觸發重新 deploy：`git commit --allow-empty -m "chore: trigger redeploy with formspree id" && git push`
7. 在 Formspree dashboard 認證 email（會寄一封確認信）

### 測試

- 開 <https://teddy-website-blog.pages.dev/contact>
- 填表單送出 → 應跳到 `/thank-you`
- 等 30 秒 → gmail 應該收到信
- Formspree dashboard 也會看到 submission

---

## 2. Cloudflare Pages Functions（TG 即時推播）— 選做

不設也能用、Formspree 一樣會寄 email。
但設了之後手機 TG 會即時響、比 email 快很多 — 對「比同行快」很重要。

### 步驟

1. 拿 TG bot token（建議用「泰迪的小聲音」bot — 已有 token 在 `teddy-voice-bot/.env` 的 `TELEGRAM_BOT_TOKEN`）
2. 拿你的 chat_id（個人 chat — 已有 `TELEGRAM_CHAT_ID=305627471` 之類的、看 `.env`）
3. 在 Cloudflare Pages → teddy-website-blog → Settings → Environment variables 新增：

   | 名稱 | 值 | Environment |
   |---|---|---|
   | `CONTACT_TG_TOKEN` | bot token | Production + Preview |
   | `CONTACT_TG_CHAT` | chat_id | Production + Preview |

4. 觸發重新 deploy（同上）

### 測試

- 填表單送出
- 手機 TG 應該秒收到 `🔔 新詢價｜找房 ...` 訊息

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

來源：/properties/1187665
```

---

## 3. 表單在哪些頁面

| 頁面 | 預填 |
|---|---|
| `/contact` | 無 |
| `/services` | 無（用戶自選意圖） |
| `/properties/[id]` | 物件編號 + 標題 + intent=buy |

---

## 4. spam 防護

ContactForm 內建三層：

1. **Honeypot `_gotcha` 欄位** — 隱藏、bot 才會填、填了直接吞掉
2. **Time-check** — 表單載入 < 3 秒就送出 = bot、不送
3. **必填驗證** — 姓名 + 我想 + (手機 or Email)

如果還是有 spam 浪費 Formspree 配額：
- Formspree dashboard → Settings → 開「reCAPTCHA」（free 版有）
- 但會降低 UX、目前沒必要先開

---

## 5. 配額管理

- **Formspree free**：50 submissions / 月
- 預估流量：個人網站第一年每月 < 20 submissions、安全範圍
- 達到 80% 時 Formspree 會寄信通知、升 Gold $10/月 變 1000/月
- 真要省、把 thank-you 頁加「我已收到、請等 30 分」減少重複送

---

## 6. 客戶資料保管

- Formspree dashboard 永久存 submission（可下載 CSV）
- Gmail inbox 也存（label `teddy-website-contact` 自動標）
- TG 訊息只當即時通知、不當 CRM
- **正式 CRM 還是要進 Notion 客戶 DB**（手動或之後接 Zapier）

---

## 7. 怎麼移除表單

如果某個頁面不想要表單：
- 找該 page 檔案
- 刪掉 `import ContactForm from "@/components/ContactForm.astro";`
- 刪掉 `<ContactForm ... />` 那段

ContactForm 元件本身保留、其他頁面繼續用。

---

## 8. 法規

表單收到的客戶資料受個資法保護：

- 不外流給同行
- 不存到不受控的第三方
- 客戶要求刪除時、Formspree dashboard 內手動刪
- Privacy policy 之後要補（待）
