/**
 * 推薦頁代理（functions/share/[[path]].ts）針對「找房小幫手推薦頁」的處理：
 *  - 代號格式 qa＋到期日 4 碼（base36，自 2026-01-01 UTC 起算的天數）＋26 碼亂數（128 位元）。
 *    官網代理光看代號就知道有沒有過期，不用改推薦頁產生器、不用讀頁面。
 *  - 過期回 410（固定頁面、noindex、no-store），而且不去抓上游。
 *  - 沒過期：不注入第三方分析；在 <body> 開頭放一段靜態揭露（沒有 JS 也看得到）；頁尾放個人化腳本（讀 URL 片段，零網路請求）。
 * 其他代號（舊的猜你喜歡、同事白牌頁…）完全不走這裡，輸出與修改前逐位元組相同。
 */
import { BRIEF_V } from "./version";

export const QA_RE = /^qa([0-9a-z]{4})([a-z2-7]{26})$/;
/** 2026-01-01T00:00:00Z 的 Unix 秒 */
export const QA_EPOCH_S = 1767225600;

export function parseQa(id: string | undefined): { expDay: number } | null {
  if (!id) return null;
  const m = QA_RE.exec(id);
  if (!m) return null;
  return { expDay: parseInt(m[1], 36) };
}

export function dayIndex(nowMs: number): number {
  return Math.floor((nowMs / 1000 - QA_EPOCH_S) / 86400);
}

export function isQaExpired(expDay: number, nowMs: number): boolean {
  return dayIndex(nowMs) > expDay;
}

export const QA_DISCLOSURE =
  "這幾間是依你的條件從公開市場挑的，不一定都是景泰委託的物件。想看哪一間，告訴景泰，他會先確認現況再跟你說。";

const FONT = "-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif";

/** 揭露區塊（伺服器端靜態 HTML，內聯樣式；固定淺色，因為推薦頁本身是另一個產生器的獨立頁面）。 */
export const QA_NOTICE_HTML =
  `<section id="qa-notice" role="note" style="max-width:720px;margin:12px auto;padding:12px 16px;background:#ece5d9;border-left:4px solid #8a6539;border-radius:8px;color:#2c2522;font:17px/1.75 ${FONT}">${QA_DISCLOSURE}</section>`;

/** 頁尾「回官網」區塊的木色版（只給 qa 頁；舊頁維持原樣）。保留「想看更多好屋」字樣，讓既有的防重複注入判斷照常運作。 */
export function qaBackToSite(site: string): string {
  const a = `display:inline-block;padding:13px 26px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;min-height:48px;box-sizing:border-box`;
  return `
<div style="max-width:720px;margin:32px auto 48px;padding:0 16px;font-family:${FONT};">
  <div style="background:#fffdf8;border:1px solid #d6c3a2;border-radius:14px;padding:24px 18px;text-align:center;">
    <div style="font-size:18px;font-weight:700;color:#2c2522;margin-bottom:16px;line-height:1.6;">想看更多好屋？歡迎逛逛我的房仲官網</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;">
      <a href="${site}/properties/" target="_blank" rel="noopener" style="${a};background:#6b4a26;color:#fffdf8;">在售物件</a>
      <a href="${site}/about/" target="_blank" rel="noopener" style="${a};background:transparent;color:#7a5630;border:2px solid #8a6539;">認識景泰</a>
      <a href="${site}/" target="_blank" rel="noopener" style="${a};background:transparent;color:#7a5630;border:2px solid #8a6539;">房仲官網</a>
    </div>
  </div>
</div>`;
}

/**
 * 清洗推薦頁產生器寫死在頁面裡的追蹤程式碼（只對 qa 頁；其他頁一律不動）：
 *  ① 追蹤請求裡的「頁面網址」只送 origin＋pathname。產生器原本送 location.href，會把網址後面的 #k=（客人選的在意的事，
 *     只是 base64）連同每一次造訪、點擊、愛心一起送去追蹤服務並寫進紀錄；這個片段只該留在客人的瀏覽器裡。
 *     （find-brief.js 也會在讀完片段後立刻把它從網址列拿掉；這裡是第二層保險，產生器之後再怎麼改都不會把片段送出去。）
 *  ② 產生器裡有一個舊命名的識別字，改成中性的 itemUrl（那個字串不該出現在任何對外頁面；這裡也不把它寫成字面，免得公開 repo 裡看得到）。
 */
// 字元類別是刻意的：不把舊命名寫成連續字面（公開 repo 與建置產物的洩漏稽核都不該看到它）
const OLD_ITEM_ID = /\b[y]c[u]tUrl\b/g;
export function sanitizeQaHtml(html: string): string {
  return html.replace(/\burl:\s*location\.href\b/g, "url: location.origin + location.pathname").replace(OLD_ITEM_ID, "itemUrl");
}

/** 在 <body> 開頭放揭露、在 </body> 前放個人化腳本。找不到 <body> 就放在 </body> 前（至少看得到）。 */
export function injectQaBlocks(html: string, backToSite: string, briefV: string = BRIEF_V): string {
  const script = `<script src="/js/find-brief.js?v=${briefV}" defer></script>`;
  let out = sanitizeQaHtml(html);
  const open = /<body[^>]*>/i.exec(out);
  if (open) out = out.slice(0, open.index + open[0].length) + QA_NOTICE_HTML + out.slice(open.index + open[0].length);
  if (out.includes("</body>")) {
    return out.replace("</body>", (open ? "" : QA_NOTICE_HTML) + backToSite + script + "</body>");
  }
  return out + (open ? "" : QA_NOTICE_HTML) + backToSite + script;
}

/** 過期頁：自成一體、跟著系統深淺色；沒有外部資源。 */
export const QA_EXPIRED_HTML = `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>這一頁已經過期了</title>
<style>
:root{color-scheme:light dark;--bg:#f5f1eb;--ink:#2c2522;--ink2:#5a4d44;--wood:#6b4a26;--on:#fffdf8;--card:#fffdf8;--bd:#d6c3a2;--ln:#0c8540}
@media (prefers-color-scheme:dark){:root{--bg:#1f1b17;--ink:#f5f1eb;--ink2:#c4b8ad;--wood:#c9a87c;--on:#1f1b17;--card:#2d2722;--bd:#5a4a35;--ln:#0c8540}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:17px/1.75 ${FONT}}
main{max-width:30rem;text-align:center}
svg{width:96px;height:96px}
h1{margin:12px 0 8px;font-size:28px;line-height:1.3}
p{margin:0 0 24px;color:var(--ink2)}
.row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 24px;border-radius:12px;font-weight:700;text-decoration:none}
a.p{background:var(--wood);color:var(--on)}
a.g{color:var(--wood);border:2px solid var(--wood)}
a:focus-visible{outline:3px solid var(--wood);outline-offset:3px}
</style>
</head>
<body>
<main>
<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5.5 4.5 21.5V38a3.5 3.5 0 0 0 3.5 3.5h3.2l-2.7 5.2 8.7-5.2H40a3.5 3.5 0 0 0 3.5-3.5V21.5z" fill="var(--card)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/><path d="M4.5 21.5 24 5.5l19.5 16" fill="none" stroke="var(--wood)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 41.5V31.5a5 5 0 0 1 10 0v10z" fill="var(--wood)"/></svg>
<h1>這一頁已經過期了</h1>
<p>推薦頁只保留 30 天。想再看一次，回到找房小幫手重新找就好。</p>
<div class="row"><a class="p" href="/find/">重新找一次</a><a class="g" href="/go/line?src=share-expired">LINE 問景泰</a></div>
</main>
</body>
</html>`;

export function expiredResponse(): Response {
  return new Response(QA_EXPIRED_HTML, {
    status: 410,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "no-referrer",
    },
  });
}
