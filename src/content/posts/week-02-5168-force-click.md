---
title: Week 02：5168「完成」按鈕灰掉，但後端其實接受
author: 陳景泰
pubDatetime: 2026-05-21T23:30:00.000+08:00
slug: week-02-5168-force-click
ogImage: /og/week-02-5168-force-click.jpg
featured: false
draft: true
tags:
  - weekly-recap
  - "5168"
  - 自動化
  - Playwright
description: "想做一鍵改價，卡在「完成」按鈕灰掉兩小時。最後硬把 disabled attribute 拔掉去點，後端居然接受、價格真的改了，而且沒扣額度。"
timezone: "Asia/Taipei"
---
5/2 那天晚上想做的事其實很單純：**一鍵改價**。

屋主常常打電話來說「啊那個 320 改 319 啦」「再降 5 萬看看」。每次我都要進 5168 後台、點開物件、滑到價格欄位、改數字、按完成。一次三分鐘，一週改個五六次就快半小時沒了。

我想：這應該是 dashboard 上一個 input + 一個按鈕的事。

所以那天晚上開了 Playwright，準備把它端到端跑通。

---

## 直覺打法：先試最笨的

流程其實很單純：

1. 拿到物件 sid（從列表頁 `a[href*="inventory-edit"]` 解出來）
2. 進 `https://007.houseprice.tw/inventory/buy/inventory-edit/{sid}`
3. 在價格欄位 fill 新數字
4. 按「完成」

前三步沒事。**第四步出事了。**

我截圖看，那顆「完成」按鈕是灰的。Disabled。點下去沒反應。

---

## 卡了兩小時的事

合理懷疑是「我改完還沒讓 form 知道」之類的 UX 規則沒滿足。所以我把所有能想到的事都試了：

- 不用 `fill()`，改用 `keyboard.type()` 真的一個一個字打進去
- 打完 Tab 出去，讓欄位 blur，觸發 onChange
- 把「公設比 / 萬坪自動計算」那兩個 checkbox 勾起來，看是不是它在擋
- 把 `.van-overlay` 那層遮罩 JS 移除

按鈕還是灰的。

那一刻我心裡有點毛——是不是 5168 後端真的有什麼條件我沒滿足？是不是這顆按鈕灰掉是有原因的、強按下去會出事？（最怕的是按下去結果跳「使用 1 個刊登額度」的扣費 modal）

---

## 然後我做了一件「應該不會 work」的事

我心想，灰掉就灰掉嘛，我手動把 attribute 拔掉再點看看，反正最壞就是後端打回來一個 error 我就知道是哪裡卡。

```js
const finish = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim() === '完成' && b.offsetHeight > 0);
finish.disabled = false;
finish.removeAttribute('disabled');
finish.click();
```

然後我盯著螢幕。

URL 跳了。

跳到 `/inventory/buy/edit-finish?sid=33403527&publishStatus=Public&isSaveDraft=false`。

我衝去 5168 前台 reload 物件——**價格真的變了。** 從 320 變 319。

---

## 等等，這代表什麼

冷靜下來看那個 URL：

- `publishStatus=Public` — 還是公開上架狀態
- `isSaveDraft=false` — 不是存草稿

最關鍵的是這個 URL 跟我之前看過的「真·新上架」flow 完全不一樣。新上架會跳一個 modal 寫「確定使用 1 個額度刊登」，這次完全沒跳。

也就是說：**5168 把「改價」當成「編輯既有物件」處理，不走 publish flow，不扣額度。**

那顆「完成」按鈕灰掉是純前端 UX 限制（它可能在想「使用者沒做什麼大改動，沒必要送出」），但只要你硬把 disabled 拔掉、強送請求，**後端是接受的**。

為了確認不是巧合，我又跑了一次 319 → 320。一樣 work。價格又恢復原狀。沒扣到額度。

---

## 為什麼這件事讓我有感

我在房仲業看過太多「規則」其實只是擺著好看的。

帶看時間「9:00–21:00」，但屋主說 7:30 能配合就 7:30。
廣告價「不能修改超過 N 次」，但跟業務說一聲就改了。
「契約一定要紙本」，但疫情那段時間電子簽全都過。

**前端的禁止不一定是後端的禁止**，這句話放在 5168 上是這樣，放在生活裡也是這樣。

我不是要鼓勵硬幹。我是想說：當你卡在「按鈕灰掉」的時候，先別急著繞遠路，先問一句「這禁止是 client side 還是 server side」。很多時候答案是前者。

---

## 後續

那天的 PoC 完成後，我把它包成 `execute_5168_change_price(sid, new_wan)` 塞進 dashboard。現在改價是這樣：

1. 在 dashboard 物件清單點「改價」icon
2. 跳 dialog 輸入新價
3. 按確認

end-to-end 不到 5 秒。原本三分鐘的事壓到五秒，週省 30 分鐘。

順手做了三個安全機制：

- 讀舊價先 check
- 新舊價差超過 50% 自動 abort（防止 320 誤填 32000 變 3.2 億的災難）
- dry-run 模式（只 fill 不送出，看回讀對不對）

---

下週繼續寫。

---

*下一篇預計寫：用 20 分鐘把 5168 後台 7 大主分類 25 個子頁全部摸過一輪——把整個平台拆乾淨的故事。*
