---
title: "Week 03：BigKanBan 留言監控 — 4 scraper 跨平台技術細節"
author: 陳景泰
pubDatetime: 2026-05-21T22:30:00.000+08:00
slug: week-03-bigkanban-monitor
draft: true
tags:
  - bigkanban
  - scraping
  - telegram-bot
  - weekly-recap
description: "FB 用 /reels + base64 comment_id、TikTok anonymous + headless=False 攔 JSON、IG 強制 /p/{shortcode}/ 處理 collab owner regex —— 上週把房仲業 KOL 留言搬到 Telegram 的 4 個 scraper 全部上線。核心策略「比同行快」。"
timezone: "Asia/Taipei"
---

在台灣房仲圈，有一個叫「房仲大看板」(BigKanBan) 的帳號系列，IG / TikTok / Facebook 都有公開帳號，貼文流量很大。留言區常常出現兩種人：

第一種是**客人**——「請問這間還在嗎」「方便看屋嗎」「想了解一下價格」。

第二種是**同行房仲業務**——其他公司業務跑來留客戶名片，「您好我是 OO 房屋 OOO 業務，方便加 LINE 介紹...」

如果我是客人，誰先回覆我，我大概就跟誰聊。但 BigKanBan 不是我的帳號，我看不到留言通知，等我滑到那則貼文，同行已經回到第 8 樓了。

所以上週做了這件事：4 個帳號的留言區，新留言出現馬上推到我自己的 Telegram bot，30 分鐘一輪，不停。

---

## 整體架構

四個帳號分屬三個平台：FB / IG（兩個）/ TikTok。每個平台反爬機制不一樣，scraper 要分開寫。共用一個 SQLite 去重，共用一個 TG 推播 helper。

```
410_Boss留言監控/
├── .env                  # bot token + chat_id + 排程參數
├── ignore_handles.txt    # 同行業務黑名單
├── db.py                 # SQLite (comments + posts + runs)
├── notify.py             # TG 推播 helper
├── run.py                # 主協調
└── scrapers/
    ├── fb.py
    ├── ig.py
    ├── tt.py
    └── _win32_hide.py    # 給 TT 用的視窗隱藏 hack
```

演算法很單純：30 分鐘一輪，每輪先掃 4 個 profile 拿最新 50 篇貼文的 `comment_count`，跟資料庫對比，只有 `comment_count` 變多的才 `page.goto` 進去抓留言。新留言過黑名單過濾後逐條推 TG。一輪大概 7-15 個 request，很節制。

但這四個 scraper 要寫得能跑，每一個都有自己的坑。

---

## FB：用 /reels 一次抓 50-80 個

FB 是最先寫的，邏輯比較直觀。

入口 `https://www.facebook.com/BigKanBan/reels` 是粉專所有 reel 的列表，進去後是一個 grid，每個 reel 都有自己的 ID。第一個小驚喜：FB 會自己幫你把 `/videos/{id}/` redirect 成 `/watch/?v={id}`，所以你不用管自己進的是 reel 還是普通影片，留言區 DOM 結構一樣。

DOM 解析這段比較囉嗦。每一則留言是一個 `role="article"`，aria-label 寫成「{author}的留言{posted_at}」這種結構。innerText 用 pipe (`|`) 切，可以拆出 author、text、time。

但 `comment_id` 怎麼拿？FB 沒在 DOM 上暴露純的 ID。後來在留言旁邊「回覆」按鈕的 href 看到 `?comment_id=base64...`，那串 base64 解開就是真實的 comment_id。

session 持久化在 `.fb-userdata/`，desktop UA + persistent context。FB 沒擋過 headless，這個 scraper 最省力。Baseline 跑下來抓到 96 條歷史留言全部入 db，之後 real mode 都是 0 new——下次有客人留言再推。

---

## TT：anonymous 有效，但 headless 一定被擋

接著寫 TikTok，這個就麻煩多了。

我一開始以為要登入。寫到一半發現：anonymous 狀態下，TT profile 照樣 render，照樣會打 `/api/post/item_list/` 拿影片清單，這個 endpoint 也照樣回完整 JSON。所以**不用登入 TT 帳號**。

但 `headless=True` 必被擋。一切回 200，但 `itemList` 是空陣列。改成 `headless=False` 就正常。

OK 那我要寫 Windows Task 排程怎麼辦？每 30 分鐘跳一個視窗出來嚴重影響工作。

試過幾個方案都不行：

- 加 stealth init script（`navigator.webdriver=undefined` 那種偽裝）：反而觸發反爬，回 `itemList=[]`
- `--window-position=-2400,-2400` 把視窗丟到螢幕外：off-screen 也是反爬訊號
- puppeteer-extra-plugin-stealth 那套：同樣被擋

最後寫了一個叫 `_win32_hide.py` 的東西。思路是：既然 TT 不接受 headless 但又只看「能不能渲染」，那我就讓 Chromium 正常 launch、開視窗，然後用 OS 層 API 把這個 Chromium 視窗藏起來。

實作：

1. `chromium.launch_persistent_context()` 完後開一個 background thread
2. 用 `psutil` 列出 chrome.exe 過濾 `--user-data-dir` 符合的 PID
3. 用 `EnumWindows` 列出所有 top-level window
4. `GetWindowThreadProcessId` 比對 PID 找到對應的 hwnd
5. `ShowWindow(hwnd, SW_HIDE)`

實測 TT **不偵測** `document.visibilityState=hidden`。視窗藏起來，scraper 一切正常。Production 跑的時候我完全看不到，跟 headless 一樣安靜，但能繞過反爬。

留言這段就直接走 API：影片頁 click `[data-e2e="comment-icon"]` 開 modal，攔截 `/api/comment/list/?aweme_id=...` JSON。`cid`、`text`、`user.unique_id`、`create_time` 全部從 JSON 拿。author 一定要用 `unique_id` 不是 `nickname`——後者是顯示名稱會被改，跟 `ignore_handles.txt` 對不上。

---

## IG：強制走 /p/{shortcode}/，不要走 /reel/

IG 是最後寫的，理論上跟 FB 一樣是 Meta 體系，照理應該很像。

實際上完全不像。

IG 最特別的點：**profile grid 上的 anchor 是 `/reel/{shortcode}/`，但你直接訪問那個 URL，會進入全屏 viewer，留言區不會展開，要點留言 icon 才會開**。

對 scraper 來說「點 icon 才看得到留言」這個延遲、不穩定、容易壞掉。

但有一個解法：把 `/reel/{shortcode}/` 改寫成 `/p/{shortcode}/`，IG 會把 reel 當成 post 渲染，留言區直接展開。同一個 shortcode、同樣的留言、不用點任何 button。

第二個坑：登入態下 anchor 不是純 `/reel/{shortcode}/`。對於合作（collab）的 reel，URL 會變成 `/{collab_owner}/reel/{shortcode}/`。如果 regex 只認沒 owner prefix 的格式，這些 collab reel 全部會漏。

最後的 regex 長這樣：

```javascript
/^\/(?:([A-Za-z0-9._]+)\/)?(p|reel)\/([A-Za-z0-9_-]+)/
```

optional owner prefix + `p|reel` + shortcode。

第三個坑：留言 row 在 DOM 上沒有 stable class 可以選。IG 的 class 名稱是 hash 過的，每次 deploy 都換。

我發現一個 pattern：**每個留言 row 都會有一個「回覆」按鈕**。所以用「含恰好 1 個『回覆』字眼的祖先 div」當 selector。為什麼是「恰好 1 個」？因為：

- 0 個 → 是 collab tag 區
- 多於 1 個 → 是被包到留言區父容器
- 恰好 1 個 → 一個獨立的留言 row

另外要排除「和 另外N人」「品牌合作」「原始音訊」這些 caption 區雜訊。

留言內容用 innerText pipe-split，結構是 `{handle} | (空) | {time} | {text} | 回覆`。

第四個坑：IG DOM 沒暴露 `comment_id`（要打 GraphQL 才有）。我用 `shortcode|handle|datetime|text 前 40 字` 算 hash 當去重 key。沒辦法跨 session 拿到同一個留言的真實 ID，但 `UNIQUE(platform, comment_id)` 在 db 層去重就好。

Baseline：`bigkanban` 26 條 + `bigkanban.boss` 109 條入 db。

---

## 為什麼要獨立第二隻 TG bot

整個系統的出口是 Telegram。但我已經有一隻 bot 叫「泰迪的小聲音」，每天推早晨日報、降價速報、上架通知、復盤對話——已經夠忙了。

如果再把 BigKanBan 留言塞進去會發生什麼？每 30 分鐘 4 個帳號的新留言，活躍時段一輪 5-10 條，一天下來幾十條。**這些會把客戶的真正訊息蓋掉**。我會錯過該回的訊息。

所以開了第二隻：`@bigkanban_boss_bot`，顯示名「Boss 留言通知」。chat_id 905627471，token 在 `.env` 已 gitignore。完全跟泰迪小聲音分流。

推播格式：

```
💬 IG @bigkanban
👤 留言者：@xxx_user
📝 「請問這間還在嗎方便看屋嗎」
🔗 https://www.instagram.com/p/ABC123/?c=789456
🕐 5/16 21:34
```

最重要的是那個 🔗 連結——點下去直接跳到那則留言的錨點。我看到 → 點 → IG DM 過去聯絡。整個流程在手機上 10 秒內完成。

---

## 黑名單最低摩擦做法

戰略動機是「比同行快」。但這之中有一個關鍵變數：**同行業務的留名片留言會洗版**。

每天看 TG 推播全是「您好我是 OO 房屋」這種制式留言，真的客人留言會被埋掉，就跟原本沒監控一樣糟。

解法是 `ignore_handles.txt`，一行一個 handle，命中就跳過不推。

我維護這個檔案的方式：**跟任何 Claude session 講「忽略 @xxx」**。AI 直接 append 一行進去。下次 30 分鐘排程跑就自動跳過。

這設計刻意做到最低摩擦。不需要打開檔案、不需要記語法、不需要重啟服務——隨手一句話搞定。預估累積 1-2 週後可以過濾掉 70%+ 的同行噪音。

---

## 一些零碎心得

- **每 30 分鐘已經夠快**。客人留完言後平均搶先同行 15 分鐘。一開始想做 5 分鐘一輪，後來想想沒必要，IG/TT 反爬被觸發的代價遠大於早 10 分鐘看到。
- **只進有變的貼文**。profile 一刷拿 50 篇 `comment_count`，跟 db 對比，只有 count 變多的才 `page.goto` 進去抓留言。一次 7-15 個 request，很安全。
- **半夜不靜音**。早期版本有 `NOTIFY_QUIET_START=23 / NOTIFY_QUIET_END=6`，後來改成空值停用。客人也會半夜留言，不可漏接。
- **零月費**。Apify 之類的 service 監控四個帳號一個月要 $50-100 USD。這套全跑在我的工作站，Playwright + Chromium + Windows Task Scheduler，零成本。

---

## 寫完才意識到的事

`BossCommentMonitor` Windows Task 跑起來後，4 個 scraper 在背景每 30 分鐘 sweep 一次。Baseline 加起來抓了 241 條歷史留言（FB 96 + TT 10 + IG bigkanban 26 + IG bigkanban.boss 109），之後就是 real mode 等新留言。

寫到一半我才意識到一件事：**這個專案本質上是「用工程繞過資訊不對稱」**。

BigKanBan 是業界 KOL，流量集中，所以那邊的留言區是潛在客人的入口。但 IG / TT / FB 都不提供「監聽別人帳號」的官方 API，這個資訊不對稱會自然偏向**有人力盯著的同行**。

寫一套 scraper 把這件事自動化，這個不對稱就消失了。

---

*下一篇預計寫：5168 廣告演算法逆向——4.5MB 後台 SPA、9 sort × 4 頁實測廣告佔比、為什麼 price-desc 排序豪宅可以免費進。*
