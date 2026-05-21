---
title: Week 01：今晚從 0 把個人網站架起來了
author: 陳景泰
pubDatetime: 2026-05-21T23:00:00.000+08:00
slug: week-01-launch
featured: false
draft: true
tags:
  - weekly-recap
  - Astro
  - Cloudflare
  - 工具
description: "從挑模板、本地跑起來、踩到 rm -rf 被擋、改走刪 .git 重來，到最後推上 GitHub 連 Cloudflare Pages 部署成功——今晚一個半小時之內做完的事。"
timezone: "Asia/Taipei"
---

今晚花了大概一個半小時，把這個網站從零架起來、推上 GitHub、連好 Cloudflare Pages，然後就真的活了。

這篇就把過程記下來，主要是給自己留存。但如果你也在考慮弄一個「房仲 × 技術」混搭的個人網站，說不定可以省你一些時間。

---

## 為什麼想弄個人網站

說來有點慚愧。我在做 AI 自動化這件事已經不短了——幫 591 上架寫 skill、逆向 5168 廣告演算法、把攝影到刊登的流程全部塞進 Claude Code——但這些東西全部活在我自己的工作站裡，沒有對外說過一個字。

想法很簡單：**把「把業務自動化的過程」公開出來**。不是教學，是公開記錄。我自己做了什麼、踩了什麼坑、目前跑得順不順，就這樣。

---

## 挑模板這段最快

我沒有要從頭刻，直接找現成的。條件只有兩個：SSG（靜態網站生成）、樣式不要太花。最後選了 [AstroPaper v6](https://github.com/satnaing/astro-paper)，Astro 框架、TailwindCSS、支援 MDX、預設就有深色模式和搜尋，對於「寫文章」這個需求來說剛剛好。

Clone 下來，`npm install`，`npm run dev`——本地開起來，大概五分鐘。

---

## 改成中文這段多花了一點時間

模板預設是英文，網站名稱、About 頁面、社群連結全部要換。我把 `astro-paper.config.ts` 改成：

```ts
title: "陳景泰｜房仲 × AI 工程",
description: "台中房仲，把業務全部自動化的過程公開出來。",
author: "陳景泰",
lang: "zh-tw",
timezone: "Asia/Taipei",
```

About 頁面改成自我介紹，社群連結只留 GitHub 和 Email。

這一段我請 Claude Code 幫我做，它直接幫我改好 config、清掉原版範例文章、把 About 頁面重寫。我只要改幾個地方確認一下內容對不對。

---

## 然後踩到了第一個坑

改完之後我想把本地的 git 記錄清乾淨，重新 commit 成「我的第一個 commit」。當時腦子一轉，覺得直接下 `rm -rf .git` 最快。

結果 Claude Code 擋了。

它說：

> 「`rm -rf` 是破壞性操作，執行前我需要確認。你是要刪除 `.git` 資料夾來重設 git 記錄嗎？如果是，我建議先確認工作目錄狀態，以免誤刪。」

我當下有點愣——我自己電腦，為什麼要擋我？

但靜下來想了一秒，還是感謝它。因為如果我指令打錯成 `rm -rf *`，整個 src 就沒了。

它幫我走的路是：刪掉 `.git` 資料夾（透過它的工具，不是直接 bash），然後 `git init` 重新初始化、`git add`、`git commit -m "init"`。結果一樣，但過程安全多了。

---

## 推 GitHub

本地跑好、commit 好，接下來推 GitHub。

在 GitHub 開一個新的空白 repo，然後：

```bash
git remote add origin https://github.com/sky811117/teddy-website.git
git push -u origin main
```

這一段沒什麼意外，一次成功。

---

## Cloudflare Pages 這段最爽

打開 Cloudflare，進 Workers & Pages，點「Create application → Pages → Connect to Git」，選 GitHub、選 repo，Framework preset 直接選 Astro，Build command 是 `npm run build`，Output directory 是 `dist`。

點 Save and Deploy，等了大概兩分鐘——

**第一次就成功了。**

網址是 `teddy-website.pages.dev`，直接開得起來。

說真的，我做過不少部署，Cloudflare Pages 這個流程是我用過最順的。它幫你把 CI/CD 全部接好，之後每次 push main，網站自動更新，完全不用管。

---

## 最後長什麼樣

現在這個網站：

- **框架**：Astro v5 + TailwindCSS
- **部署**：Cloudflare Pages（自動 CI/CD）
- **功能**：文章列表、標籤、全文搜尋、深色模式、動態 OG 圖
- **域名**：目前先用 `teddy-website.pages.dev`，之後再掛自訂域名

---

## 心得

整個過程最讓我有感的是 Claude Code 擋住我那一下。不是說它擋得有多聰明，是它讓我意識到：**當我想做的事情有點衝動，有個東西問你「你確定嗎？」其實是好事**。

我平常給客戶的建議也是這樣——衝動的決定不一定是壞決定，但停一秒想清楚之後再動，通常結果都會比較好。

下週繼續寫。

---

*下一篇預計寫：用 Claude Code 把 591 上架從 2 小時壓到 15 分鐘的過程。*
