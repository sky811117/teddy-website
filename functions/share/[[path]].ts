/**
 * Cloudflare Pages Function — /share/*
 *
 * Reverse-proxy 客戶分享頁（猜你喜歡 + 客戶推薦）。
 * 內容實際存在 sky811117.github.io/teddy-shares/{id}/index.html，
 * 但客戶看到的網址掛在個人網站 /share/{id}/ 下：
 *   - 流量算進個人網站（Cloudflare Analytics + 注入 GA4）
 *   - 客戶有機會點 footer CTA 逛進在售物件頁
 *   - 網址漂亮、藏掉 sky811117.github.io
 *
 * 路由：functions/share/[[path]].ts → 接 /share/、/share/{id}、/share/{id}/xxx
 * 兩種頁面都落在 teddy-shares/{share_id}/index.html，一條規則全 cover。
 *
 * 2026-10 資安加固（M-23）：
 *   - 路徑白名單：第一段必須是推薦頁 id（^[A-Za-z0-9]{4,40}$，id 規格見下方 SHARE_ID_RE），第二段（可省略）只能是
 *     單層、安全字元、白名單副檔名的檔名。任何 .. / %2e / %2f / %5c / // / 子目錄 / 隱藏檔 / 非 ASCII
 *     一律 404，而且「不會」去打上游。
 *   - 只收 GET／HEAD（其他方法 405；也不讀任何 X-HTTP-Method-Override 之類的標頭）。
 *   - 所有回應（含 404／405／502／302／圖片）都帶 x-content-type-options: nosniff。
 *   - 302 轉址的 Location 用相對路徑，不吃 Host 標頭。
 *   - 不跟隨上游轉址（redirect: "manual"）：上游回 301／302／303／307／308 一律 502（我們組出來的網址都是
 *     「有尾斜線的目錄」或「明確檔名」，GitHub Pages 不需要轉址；有轉址＝上游被改過）。
 *     另外保留「最終網址必須仍在 sky811117.github.io/teddy-shares/ 底下」的第二道檢查，否則 502。
 *   - 找房小幫手推薦頁（代號 qa＋到期日 4 碼＋26 碼亂數）：過期回 410（固定頁面、不去抓上游）、不注入 GA、
 *     注入揭露／個人化／回官網三塊（見 src/lib/find/shareqa.ts）。非 qa 代號的頁面內容與修改前相同。
 *
 * 2026-10-06 紅隊修補（RT-18）：
 *   - 到期檢查與「實際抓的路徑」綁在同一個變數：id 只從白名單解析出來的 route.id 取，組出上游網址後再用 new URL()
 *     解析一次，取「解析後的第一段」重新做代號格式與到期檢查，兩者不一致就 404（不打上游）。
 *   - 到期判斷用小寫化的代號（QA…也當成 qa 看，不因大小寫繞過）。
 *   - qa 頁另外帶一個保守的內容安全政策（防嵌框、禁 object／base 改寫）；script-src 白名單要先盤點推薦頁產生器實際用到的外部來源，
 *     不能憑空鎖（會把頁面弄壞），列在待辦。
 */

import config from "../../astro-paper.config";
import { expiredResponse, injectQaBlocks, isQaExpired, parseQa, qaBackToSite } from "../../src/lib/find/shareqa";

const UPSTREAM = "https://sky811117.github.io/teddy-shares/";
const GA4_ID = "G-WMQCYK4L88";
// 官網網址從設定組（astro-paper.config.ts 的 site.url），換網域不用改這裡；去掉尾斜線再接路徑
const SITE = config.site.url.replace(/\/+$/, "");

// 「回官網」區塊 — proxy 層注入，讓每個分享頁（新舊全部）底部都能逛回官網。
// 自帶 inline style，不依賴頁面既有 CSS；guard 認標題字串避免重複注入。
const BACK_TO_SITE = `
<div style="max-width:1100px;margin:32px auto 48px;padding:0 16px;font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;">
  <div style="background:#fff;border:1px solid rgba(212,185,150,.5);border-radius:16px;padding:26px 20px;text-align:center;box-shadow:0 2px 12px rgba(60,45,20,.08);">
    <div style="font-size:18px;font-weight:700;color:#6b5b3a;margin-bottom:16px;line-height:1.6;">🏡 想看更多好屋？歡迎逛逛我的房仲官網</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;">
      <a href="${SITE}/properties/" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:24px;font-size:16px;font-weight:700;background:#6B8E23;color:#fff;text-decoration:none;">在售物件</a>
      <a href="${SITE}/about/" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:24px;font-size:16px;font-weight:700;background:#fff;color:#6B8E23;border:1.5px solid #6B8E23;text-decoration:none;">認識景泰</a>
      <a href="${SITE}/" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:24px;font-size:16px;font-weight:700;background:#fff;color:#6B8E23;border:1.5px solid #6B8E23;text-decoration:none;">房仲官網</a>
    </div>
    <div style="margin-top:14px;font-size:12px;line-height:1.6;color:#9a8f7a;">
      本頁會記錄不含 cookie、無法識別個人的匿名瀏覽數（Google Analytics），用來了解哪些物件比較多人看。
    </div>
  </div>
</div>`;

type EventContext = {
  params?: { path?: string | string[] };
  request: Request;
};

// ===== 路徑白名單（M-23）=====
// 推薦頁 id 規格（A3 推薦頁服務、A4 本檔、找房小幫手 三邊共同約定；改任何一邊都要三邊一起看）：
//   - 字元集：只有 A-Z a-z 0-9（A3 的產生器用 ascii_letters＋digits；不收 - _ .，歷史上也沒出現過）
//   - 舊頁：8 碼；查詢台舊路徑 qs＋8 碼（10 碼）
//   - A3 新頁：22 碼；查詢台新路徑 qs＋22 碼（24 碼）
//   - 找房小幫手（09 號設計文件 4.7）：qa＋到期日 4 碼＋26 碼＝32 碼（全小寫英數）
//   - 本檔上限 40 碼 = 最長的 32 碼再留 8 碼餘裕；下限 4 碼維持原狀。
// ⚠️ 上限若改回 16，A3／找房小幫手的新頁會全部 404（客戶連結直接失效）。tests/functions/share.test.mjs 有釘住這件事。
export const SHARE_ID_RE = /^[A-Za-z0-9]{4,40}$/;
// 檔名：單層、第一碼英數、其餘英數 . _ -；再用白名單副檔名擋掉怪東西。
const SHARE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHARE_FILE_EXT = new Set([
  "html", "css", "js", "json", "txt",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico",
  "woff", "woff2",
]);
const MAX_PATHNAME_LENGTH = 160;
// qa 推薦頁的內容安全政策（保守版）。不含 script-src：推薦頁產生器有行內腳本與外部地圖／圖片，沒盤點前鎖了會弄壞頁面。
const QA_CSP = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'";
// 上游若回這些狀態碼＝要我們去別的地方，一律不跟、當 502（redirect: "manual" 之下不會自動跟）
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type ShareRoute =
  | { kind: "index" } // /share 或 /share/ → 導去在售物件頁
  | { kind: "page"; id: string; file: string | null; upstreamPath: string }
  | { kind: "reject"; reason: string };

/**
 * 把「請求的 pathname」解析成要打上游的路徑；不合白名單就回 reject。
 * 純函式（不碰 fetch／env），測試直接餵字串。
 *
 * 為什麼用 pathname 而不是 params.path：路由比對可能不分大小寫（/SHARE/x 也可能進來；我們一律照處理），
 * 而且 params 是否已 decode 要看執行環境；直接吃原始 pathname、一律「有 % 就拒絕」最不會有歧義。
 * 注意 WHATWG URL 解析時就會先把 `..`、`%2e%2e`、反斜線（變成斜線）處理掉，
 * 所以這裡看到的 `%` 一定是其他編碼（%2f、%5c、%00、雙重編碼…），合法的 id／檔名都不會有。
 */
export function resolveSharePath(pathname: string): ShareRoute {
  if (typeof pathname !== "string" || pathname.length > MAX_PATHNAME_LENGTH) {
    return { kind: "reject", reason: "too-long" };
  }
  const m = /^\/share(\/.*)?$/i.exec(pathname);
  if (!m) return { kind: "reject", reason: "bad-prefix" };
  const rest = m[1] ?? "";
  if (rest === "" || rest === "/") return { kind: "index" };
  if (rest.includes("%")) return { kind: "reject", reason: "percent-encoding" };

  const segs = rest.slice(1).split("/");
  // 允許「單一」尾斜線（/share/{id}/）；其他空段（雙斜線 //）一律拒絕
  let trailingSlash = false;
  if (segs.length > 1 && segs[segs.length - 1] === "") {
    segs.pop();
    trailingSlash = true;
  }
  if (segs.some(seg => seg === "")) return { kind: "reject", reason: "empty-segment" };
  if (segs.length > 2) return { kind: "reject", reason: "too-deep" };

  const id = segs[0];
  if (!SHARE_ID_RE.test(id)) return { kind: "reject", reason: "bad-id" };
  if (segs.length === 1) {
    // 目錄 → 補尾斜線讓 GitHub Pages 回 index.html
    return { kind: "page", id, file: null, upstreamPath: `${id}/` };
  }

  const file = segs[1];
  if (trailingSlash) return { kind: "reject", reason: "slash-after-file" };
  if (!SHARE_FILE_RE.test(file) || file.includes("..")) {
    return { kind: "reject", reason: "bad-file" };
  }
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  if (!SHARE_FILE_EXT.has(ext)) return { kind: "reject", reason: "bad-ext" };
  return { kind: "page", id, file, upstreamPath: `${id}/${file}` };
}

/**
 * 把白名單解析出的 upstreamPath 接到 UPSTREAM 後面，用 URL 解析，回傳最終網址與「UPSTREAM 底下的第一段」。
 * 解析後若跑出 UPSTREAM 目錄之外、或第一段不是合法代號，回 null。純函式。
 */
export function resolveUpstreamUrl(upstreamPath: string): { href: string; first: string } | null {
  try {
    const base = new URL(UPSTREAM);
    const u = new URL(UPSTREAM + upstreamPath);
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return null;
    const first = u.pathname.slice(base.pathname.length).split("/")[0];
    if (!SHARE_ID_RE.test(first)) return null;
    return { href: u.href, first };
  } catch {
    return null;
  }
}

// 上游跟完轉址後的最終網址，必須還在 UPSTREAM 底下（同主機、同目錄）。
// 取不到 url（空字串）就不判斷：我們自己組的網址已經過白名單，而且 fetch 帶 redirect:"manual"、
// 上游的任何 3xx 在呼叫這個函式「之前」就已經被擋成 502，所以不會有「url 為空 → 被導去別處卻放行」的情況。
export function upstreamUrlOk(finalUrl: string): boolean {
  if (!finalUrl) return true;
  try {
    const u = new URL(finalUrl);
    const base = new URL(UPSTREAM);
    return u.origin === base.origin && u.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
}

// public/_headers 只套靜態檔，Functions 回應要自己補。每一種回應都要帶。
export const SHARE_BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "no-referrer",
  // 雙保險：客戶頁不進搜尋引擎（HTML 另有 meta noindex）
  "x-robots-tag": "noindex, nofollow",
};

function plainResponse(
  status: number,
  body: string,
  extra: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...SHARE_BASE_HEADERS,
      ...extra,
    },
  });
}

export const onRequest = async ({
  request,
}: EventContext): Promise<Response> => {
  // 只有 GET／HEAD 有意義（瀏覽器開頁、LINE 預覽）。其他方法不打上游。
  if (request.method !== "GET" && request.method !== "HEAD") {
    return plainResponse(405, "Method Not Allowed", { allow: "GET, HEAD" });
  }

  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return plainResponse(404, "Not Found");
  }
  const route = resolveSharePath(pathname);

  // 沒帶 id → 導去在售物件頁（自然引流，不留死頁）
  if (route.kind === "index") {
    // Location 用相對路徑（不吃 Host 標頭）；直接給帶尾斜線的網址，不然會變成 302 再 308 的兩段轉址
    return new Response(null, {
      status: 302,
      headers: { location: "/properties/", "cache-control": "no-store", ...SHARE_BASE_HEADERS },
    });
  }
  // 不合白名單 → 404，而且不去打上游
  if (route.kind === "reject") return plainResponse(404, "Not Found");

  // 找房小幫手推薦頁（qa＋到期日＋亂數）：過期就回 410，不去抓上游；其他代號完全不走這裡。
  // 到期判斷「寬鬆」：QA…（大寫）也當成 qa 看，所以不能靠大小寫逃過；頁面行為（不注入 GA、揭露區塊）只對標準小寫代號生效。
  const qa = parseQa(route.id);
  const qaLoose = parseQa(route.id.toLowerCase());
  if (qaLoose && isQaExpired(qaLoose.expDay, Date.now())) return expiredResponse();

  // 第二層（RT-18）：把要抓的上游網址組出來、用 URL 解析一次，取解析後的第一段，必須還是同一個代號。
  // 白名單已經擋掉 . .. %2e %2f ; 反斜線，這裡是「就算上面哪天放寬了也不會讓到期檢查與實際抓取的路徑分家」的保險。
  const upstreamUrl = resolveUpstreamUrl(route.upstreamPath);
  if (!upstreamUrl || upstreamUrl.first !== route.id) return plainResponse(404, "Not Found");
  const qaResolved = parseQa(upstreamUrl.first.toLowerCase());
  if (qaResolved && isQaExpired(qaResolved.expDay, Date.now())) return expiredResponse();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.href, {
      headers: { "User-Agent": "teddy-website-share-proxy" },
      // 不跟隨轉址：上游回 3xx 就當異常（見下方 502）。這樣不必依賴 upstream.url 這個欄位有沒有值
      // （驗證者發現：url 為空字串時下面那道「最終網址」檢查會放行）。
      redirect: "manual",
      // 邊快取 30s：加速客戶載入、減 GitHub Pages 壓力；regen 同 id 最多延遲 30s
      // cf 是 Workers 執行期欄位，標準 RequestInit 型別沒有 → 斷言避開 TS2353/2769
      cf: { cacheTtl: 30, cacheEverything: true },
    } as RequestInit);
  } catch {
    return plainResponse(502, "分享頁暫時無法載入，請稍後再試。");
  }

  // 上游回轉址（或瀏覽器式的 opaqueredirect）＝被改寫或被汙染的跡象，不轉出去、也不跟過去
  if (REDIRECT_STATUS.has(upstream.status) || upstream.type === "opaqueredirect") {
    return plainResponse(502, "分享頁暫時無法載入，請稍後再試。");
  }
  // 第二道：最終網址若不在 teddy-shares 底下（例如 manual 沒生效的環境）也不轉出去
  if (!upstreamUrlOk(upstream.url)) {
    return plainResponse(502, "分享頁暫時無法載入，請稍後再試。");
  }

  const ct = upstream.headers.get("content-type") || "";

  // 非 HTML（圖片 / 其他資源）原樣回傳；nosniff 讓瀏覽器照 content-type 處理、不自己猜成 HTML／JS。
  // CSP sandbox：萬一有人直接開這個資源網址（例如惡意 svg），裡面的腳本跑不起來；當成 <img>／<link> 子資源載入時不受影響。
  if (!ct.includes("text/html")) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": ct || "application/octet-stream",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ...SHARE_BASE_HEADERS,
      },
    });
  }

  let html = await upstream.text();

  // 注入 noindex / no-referrer（雙保險，2026-09-06）：
  //   - 上游 sky811117.github.io 是公開 repo、頁面標題含客戶稱謂與找房需求，
  //     proxy 回應的 x-robots-tag 只保護 /share/ 路徑；這裡再往 <head> 補一顆 meta，
  //     頁面被複製 / 轉存到別處也帶著 noindex。
  //   - 客戶頁內有大量外連（永慶物件頁、LINE），no-referrer 讓 /share/{id}/ 網址不進對方 log。
  if (html.includes("<head>")) {
    let inject = "";
    if (!/<meta[^>]+name=["']robots["']/i.test(html)) {
      inject += '<meta name="robots" content="noindex,nofollow">';
    }
    if (!/<meta[^>]+name=["']referrer["']/i.test(html)) {
      inject += '<meta name="referrer" content="no-referrer">';
    }
    if (inject) html = html.replace("<head>", "<head>" + inject);
  }

  // 注入 GA4 — 讓個人網站 GA 也算到這次造訪（頁面本身原本沒有 gtag）。找房小幫手推薦頁不注入。
  if (!qa && !html.includes(GA4_ID) && html.includes("</head>")) {
    // ⚠️ 2026-08-27 修：原本這裡是無 consent、無告知直接注入 gtag，
    //   客戶從 LINE 點進推薦頁就開始寫 cookie，頁面上沒有任何隱私說明。
    //   改成 Consent Mode v2 預設 denied → 只送不含識別碼的匿名瀏覽數、
    //   不寫 cookie；頁尾另有一行告知（見 BACK_TO_SITE）。
    const ga =
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
      `gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',` +
      `ad_user_data:'denied',ad_personalization:'denied'});` +
      `gtag('js',new Date());gtag('config','${GA4_ID}');</script>`;
    html = html.replace("</head>", ga + "</head>");
  }

  // 注入「回官網」區塊 — 新舊頁面只要走 proxy 都會有底部引流區塊。
  // guard 一：頁面已含此區塊（後端新版也會 bake）就不重複注入。
  // guard 二：白牌頁面不注入。查詢台開放給同事之後（2026-08-14），同事分享出去的
  //   客戶頁掛的是他自己的姓名/電話/LINE/證號，這裡再注入「認識景泰／房仲官網」
  //   等於把景泰塞回別人的客戶頁。share app 會在 <head> 蓋一個
  //   <meta name="x-share-promo" content="off">，看到就跳過。
  //   ⚠️ 兩邊要一起改才有用 —— 只改 share app 那邊，這個 proxy 還是會把景泰加回去。
  const promoOff = /<meta[^>]+name=["']x-share-promo["'][^>]+content=["']off["']/i.test(html);
  if (qa) {
    // 找房小幫手推薦頁：揭露區塊放 <body> 開頭、個人化腳本與（木色版）回官網區塊放頁尾
    const back = !promoOff && !html.includes("想看更多好屋") ? qaBackToSite(SITE) : "";
    html = injectQaBlocks(html, back);
  } else if (!promoOff && !html.includes("想看更多好屋") && html.includes("</body>")) {
    html = html.replace("</body>", BACK_TO_SITE + "</body>");
  }

  return new Response(html, {
    status: upstream.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // qa 推薦頁不放邊緣快取，避免過期頁被快取住
      "cache-control": qa ? "private, max-age=0" : "public, max-age=30",
      // nosniff／X-Frame-Options／no-referrer／noindex（雙保險，頁面 meta 也有 noindex）
      ...SHARE_BASE_HEADERS,
      // qa 頁與主站同源：先把「不准被嵌框、不准改 base、不准 object／外部表單」鎖上（RT-18）
      ...(qa ? { "content-security-policy": QA_CSP } : {}),
    },
  });
};
