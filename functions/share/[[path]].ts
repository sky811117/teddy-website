/**
 * Cloudflare Pages Function — /share/*
 *
 * Reverse-proxy 客戶分享頁（猜你喜歡 + 客戶推薦）。
 * 內容實際存在 GitHub repo sky811117/teddy-shares 的 {id}/index.html（2026-11-08 起 repo 是私人的，見下方），
 * 但客戶看到的網址掛在個人網站 /share/{id}/ 下：
 *   - 流量算進個人網站（Cloudflare Analytics + 注入 GA4）
 *   - 客戶有機會點 footer CTA 逛進在售物件頁
 *   - 網址漂亮、藏掉 GitHub
 *
 * 路由：functions/share/[[path]].ts → 接 /share/、/share/{id}、/share/{id}/xxx
 * 兩種頁面都落在 teddy-shares/{share_id}/index.html，一條規則全 cover。
 *
 * 2026-10 資安加固（M-23）：
 *   - 路徑白名單：第一段必須是推薦頁 id（^[A-Za-z0-9]{4,40}$，id 規格見下方 SHARE_ID_RE），第二段（可省略）只能是
 *     單層、安全字元、白名單副檔名的檔名。任何 .. / %2e / %2f / %5c / // / 隱藏檔 / 非 ASCII
 *     一律 404，而且「不會」去打上游。（2026-11-08 起多放行「子目錄裡的圖片」，見 SHARE_DIR_RE。）
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
 *     不能憑空鎖（會把頁面弄壞），列在待辦。2026-10-17 起這組 CSP（見 SHARE_HTML_CSP）擴到所有代號的 HTML 回應。
 *
 * 2026-11-08 teddy-shares 轉私人 repo（資安 S003：公開 repo 列得出 375 份客戶推薦頁、標題含客戶姓氏）：
 *   - repo 一轉私人，GitHub Pages（UPSTREAM）就下線、raw（RAW_UPSTREAM）也 404。改走 GitHub Contents API 讀原始檔，
 *     token 是 Cloudflare Pages 的 secret SHARES_GH_TOKEN（fine-grained PAT、只有 teddy-shares 的 Contents: Read；
 *     值只在這支檔案內用、不進任何回應／紀錄／commit；改了 secret 要重新部署才生效）。
 *   - 沒有 token（或 token 讀不到）時照舊走 Pages → raw：repo 還公開的過渡期不會壞；API 回 404 也會再試舊路
 *     （GitHub 對沒權限的私人資源同樣回 404——token 權限沒設對時，至少 repo 還公開的期間頁面不會壞）。
 *     API 其他錯誤（限流、401、5xx、3xx、連不上）而且舊路也拿不到正常頁 → 502，不把「暫時讀不到」說成「沒有這一頁」。
 *   - API 回的 content-type 一律是 application/vnd.github.raw+json、Cache-Control: private、Vary 含 Authorization：
 *     自己依副檔名設 content-type（src/lib/find/sharepick.ts 的 shareContentType），自己用 Cache API 在邊緣快取 5 分鐘
 *     （SHARE_API_CACHE_TTL；存的是上游原始檔，注入每次做；Cache-Control 改成 public 才存得進去），
 *     不然每個請求都打 API（上限每小時 5,000 次／token）。ETag（GitHub 給的 blob 雜湊）照傳給瀏覽器，
 *     資源檔帶 If-None-Match 對得上就回 304；HTML 本文有注入、跟上游不同，不給 ETag。
 *   - 回應多一個診斷標頭 x-share-source（api／api-cache／pages／raw），不含任何秘密；轉私人前後靠它確認走的是哪條路。
 *   - 子目錄：推薦頁產生器曾把物件照片放在 {id}/img/{雜湊}/{n}.jpg（FgZmEHPH 那份，92 張），以前被「超過 2 段一律拒絕」擋成 404。
 *     現在放行「最多兩層目錄、目錄名英數 _ -（不收點）、檔名只能是圖片」；HTML／腳本／字型仍只准放在代號目錄底下。
 */

import config from "../../astro-paper.config";
import { expiredResponse, injectQaBlocks, isQaExpired, parseQa, qaBackToSite } from "../../src/lib/find/shareqa";
import { injectPick, pickHostOk, shareApiRequest, shareContentType, shareToken } from "../../src/lib/find/sharepick";

const UPSTREAM = "https://sky811117.github.io/teddy-shares/";
// 2026-10-07：推薦頁產生器 commit 進 teddy-shares（公開 repo、main 分支）後，GitHub Pages（legacy 建置）要 1～3 分鐘以上才發布
// （實測 186 秒），客人拿到連結先看到 404。原始檔在 commit 當下就讀得到：Pages 回 404 時，頁面本體（index.html）改從這裡讀。
// 只用在「白名單解析出的同一個代號的 index.html」，內容一樣走下面的注入與標頭，不轉出 raw 的任何標頭。
const RAW_UPSTREAM = "https://raw.githubusercontent.com/sky811117/teddy-shares/main/";
const UA = "teddy-website-share-proxy";
/** Contents API 讀到的檔案在邊緣快取幾秒（瀏覽器也給同樣的 max-age）；regen 同一個代號最多延遲這麼久 */
export const SHARE_API_CACHE_TTL = 300;
/** 單一檔案上限（HTML 約 100 KB、照片約 250 KB；超過就當異常，不讀進記憶體） */
const SHARE_API_MAX_BYTES = 10_000_000;
/** 診斷標頭：這次回應的內容從哪裡來（api／api-cache／pages／raw）。只有來源種類，沒有任何秘密。 */
export const SHARE_SOURCE_HEADER = "x-share-source";
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
  /** Cloudflare Pages 的執行期環境變數。這裡只讀 SHARES_GH_TOKEN（見 sharepick.ts 的 shareToken），值不會進任何回應 */
  env?: unknown;
  /** 回應送出後還要做的事（把上游原始檔放進邊緣快取）。是 context 的方法，要透過 ctx 呼叫 */
  waitUntil?: (p: Promise<unknown>) => void;
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
// 子目錄（2026-11-08）：目錄名第一碼英數、其餘英數 _ -（不收點，所以不會有 . 與 ..、也不會有隱藏目錄）；最多兩層；檔名只能是圖片。
const SHARE_DIR_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHARE_NESTED_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MAX_SEGMENTS = 4; // id ＋ 最多兩層目錄 ＋ 檔名
const MAX_PATHNAME_LENGTH = 160;
// 推薦頁 HTML 的內容安全政策（保守版）。不含 script-src：推薦頁產生器有行內腳本與外部地圖／圖片，沒盤點前鎖了會弄壞頁面。
// 2026-10-17 資安自查第 4 項：從「只有 qa 頁」擴到所有代號的 HTML 回應（含上游 404 頁、qa 過期頁）；
// 站內沒有任何地方用 iframe 嵌推薦頁，frame-ancestors 收緊成 'none'。
// （已查推薦頁產生器 teddy-share-app/api/index.py：輸出沒有 <base>／<form>／<object>／<embed>，這組不會弄壞頁面。）
export const SHARE_HTML_CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";
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
  if (segs.length > MAX_SEGMENTS) return { kind: "reject", reason: "too-deep" };

  const id = segs[0];
  if (!SHARE_ID_RE.test(id)) return { kind: "reject", reason: "bad-id" };
  if (segs.length === 1) {
    // 目錄 → 補尾斜線讓 GitHub Pages 回 index.html
    return { kind: "page", id, file: null, upstreamPath: `${id}/` };
  }

  const file = segs[segs.length - 1];
  const dirs = segs.slice(1, -1);
  if (trailingSlash) return { kind: "reject", reason: "slash-after-file" };
  if (!SHARE_FILE_RE.test(file) || file.includes("..")) {
    return { kind: "reject", reason: "bad-file" };
  }
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  if (dirs.length === 0) {
    if (!SHARE_FILE_EXT.has(ext)) return { kind: "reject", reason: "bad-ext" };
    return { kind: "page", id, file, upstreamPath: `${id}/${file}` };
  }
  // 子目錄裡只放行圖片（2026-11-08）
  if (dirs.some(d => !SHARE_DIR_RE.test(d))) return { kind: "reject", reason: "bad-dir" };
  if (!SHARE_NESTED_EXT.has(ext)) return { kind: "reject", reason: "bad-ext" };
  return { kind: "page", id, file, upstreamPath: `${id}/${dirs.join("/")}/${file}` };
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

/** If-None-Match 比對：逗號分隔的清單裡任何一個（去掉 W/ 弱標記）等於我們的 ETag，或是 *，就算命中 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch || !etag) return false;
  const norm = (s: string) => s.trim().replace(/^W\//, "");
  const mine = norm(etag);
  return ifNoneMatch.split(",").some(t => t.trim() === "*" || norm(t) === mine);
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

// ===== 讀上游 =====
type ShareSource = "api" | "api-cache" | "pages" | "raw";
/** 從上游拿到的一份內容：狀態碼、content-type、本文（串流／位元組／字串）、ETag、來源 */
type Fetched = {
  status: number;
  ct: string;
  body: ReadableStream<Uint8Array> | ArrayBuffer | string | null;
  etag: string | null;
  src: ShareSource;
};
type ApiResult = { kind: "ok"; got: Fetched } | { kind: "notfound" } | { kind: "error" };
type LegacyResult = { kind: "ok"; got: Fetched } | { kind: "fail" };

/** Workers 的邊緣快取（caches.default）；本機測試沒有這個全域就回 null（不快取） */
function edgeCache(): Cache | null {
  try {
    const cs = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return cs && cs.default ? cs.default : null;
  } catch {
    return null;
  }
}

async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* 不需要本文 */
  }
}

/**
 * 用唯讀 PAT 走 GitHub Contents API 讀 repo 原始檔（apiPath 已過白名單；頁面本體是 {id}/index.html）。
 * 先看邊緣快取（鍵＝本站 origin ＋ /__share-upstream/ ＋ 路徑，不會跟真正的網址撞），沒有才打 API；
 * 讀到就依副檔名設好 content-type、Cache-Control 改成 public 存 5 分鐘（存的是原始檔，注入每次做）。
 * 404 回 notfound（呼叫端會再走舊路）；其他狀態、3xx、連不上、目錄清單（application/json）、太大 → error。
 */
async function fetchViaApi(token: string, apiPath: string, request: Request, wait?: (p: Promise<unknown>) => void): Promise<ApiResult> {
  const ct = shareContentType(apiPath);
  const cache = edgeCache();
  let key: Request | null = null;
  if (cache) {
    try {
      key = new Request(`${new URL(request.url).origin}/__share-upstream/${apiPath}`, { method: "GET" });
      const hit = await cache.match(key);
      if (hit && hit.status === 200) {
        return { kind: "ok", got: { status: 200, ct: hit.headers.get("content-type") || ct, body: await hit.arrayBuffer(), etag: hit.headers.get("etag"), src: "api-cache" } };
      }
    } catch {
      key = null; // 快取出問題就當沒有快取，照樣去讀 API
    }
  }
  let res: Response;
  try {
    const req = shareApiRequest(apiPath, token, UA);
    // 不帶 cf 快取選項：請求有 Authorization，Cloudflare 本來就不會快取、也不該快取；快取由上面的 Cache API 自己做
    res = await fetch(req.url, { headers: req.headers, redirect: "manual" });
  } catch {
    return { kind: "error" };
  }
  if (res.status !== 200) {
    await drain(res);
    return res.status === 404 ? { kind: "notfound" } : { kind: "error" };
  }
  // 檔案內容的 content-type 是 application/vnd.github.raw+json；application/json 是目錄清單或錯誤物件，都不是我們要的檔
  const apiCt = (res.headers.get("content-type") || "").toLowerCase();
  const len = Number(res.headers.get("content-length") || 0);
  if (apiCt.startsWith("application/json") || len > SHARE_API_MAX_BYTES) {
    await drain(res);
    return { kind: "error" };
  }
  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return { kind: "error" };
  }
  if (buf.byteLength > SHARE_API_MAX_BYTES) return { kind: "error" };
  const etag = res.headers.get("etag");
  if (cache && key) {
    try {
      const headers: Record<string, string> = { "content-type": ct, "cache-control": `public, max-age=${SHARE_API_CACHE_TTL}` };
      if (etag) headers.etag = etag;
      const put = cache.put(key, new Response(buf.slice(0), { status: 200, headers })).catch(() => {
        /* 放不進快取不影響回應 */
      });
      if (wait) wait(put);
      else await put;
    } catch {
      /* 同上 */
    }
  }
  return { kind: "ok", got: { status: 200, ct, body: buf, etag, src: "api" } };
}

/**
 * 舊路（repo 還公開時唯一的路；轉私人後會 404）：GitHub Pages → 404 時頁面本體改讀 raw 原始檔。
 * 跟 2026-11-08 之前的行為完全一樣：3xx／opaqueredirect／最終網址跑掉 → fail（呼叫端回 502）；其他狀態碼照傳。
 */
async function fetchLegacy(href: string, first: string, isIndex: boolean): Promise<LegacyResult> {
  let upstream: Response;
  try {
    upstream = await fetch(href, {
      headers: { "User-Agent": UA },
      // 不跟隨轉址：上游回 3xx 就當異常（見下方 502）。這樣不必依賴 upstream.url 這個欄位有沒有值
      // （驗證者發現：url 為空字串時下面那道「最終網址」檢查會放行）。
      redirect: "manual",
      // 邊快取 30s：加速客戶載入、減 GitHub Pages 壓力；regen 同 id 最多延遲 30s
      // 2026-10-07：只快取 2xx。原本 cacheTtl 連 404 也快取 30 秒——推薦頁剛產生、GitHub Pages 還沒發布時被查一次，
      // 之後 30 秒內所有人（含家用機的「等網址生效」輪詢與客人）都拿到快取的 404，景泰實測拿到 404 連結。
      // cf 是 Workers 執行期欄位，標準 RequestInit 型別沒有 → 斷言避開 TS2353/2769
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 30, "300-599": 0 } },
    } as RequestInit);
  } catch {
    return { kind: "fail" };
  }

  // 上游回轉址（或瀏覽器式的 opaqueredirect）＝被改寫或被汙染的跡象，不轉出去、也不跟過去
  if (REDIRECT_STATUS.has(upstream.status) || upstream.type === "opaqueredirect") return { kind: "fail" };
  // 第二道：最終網址若不在 teddy-shares 底下（例如 manual 沒生效的環境）也不轉出去
  if (!upstreamUrlOk(upstream.url)) return { kind: "fail" };

  let ct = upstream.headers.get("content-type") || "";
  let status = upstream.status;
  let body: Fetched["body"] = upstream.body;
  let src: ShareSource = "pages";

  // 頁面本體剛產生、Pages 還沒發布（404）：改讀 repo 原始檔（只限 index.html，同一個代號）
  if (status === 404 && isIndex) {
    try {
      const raw = await fetch(`${RAW_UPSTREAM}${first}/index.html`, {
        headers: { "User-Agent": UA },
        redirect: "manual",
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 30, "300-599": 0 } },
      } as RequestInit);
      if (raw.status === 200) {
        const text = await raw.text();
        if (text.length <= 2_000_000 && /<html[\s>]/i.test(text)) {
          body = text;
          status = 200;
          ct = "text/html; charset=utf-8";
          src = "raw";
        }
      }
    } catch {
      /* 讀不到原始檔就照原本回 404 */
    }
  }
  return { kind: "ok", got: { status, ct, body, etag: null, src } };
}

export const onRequest = async (ctx: EventContext): Promise<Response> => {
  const { request } = ctx;
  // waitUntil 是 context 的方法，要透過 ctx 叫（拆出來叫會失去 this）；本機測試沒有這個方法就直接等
  const wait = ctx.waitUntil ? (p: Promise<unknown>) => void ctx.waitUntil?.(p) : undefined;
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
  if (qaLoose && isQaExpired(qaLoose.expDay, Date.now())) return expiredWithCsp();

  // 第二層（RT-18）：把要抓的上游網址組出來、用 URL 解析一次，取解析後的第一段，必須還是同一個代號。
  // 白名單已經擋掉 . .. %2e %2f ; 反斜線，這裡是「就算上面哪天放寬了也不會讓到期檢查與實際抓取的路徑分家」的保險。
  const upstreamUrl = resolveUpstreamUrl(route.upstreamPath);
  if (!upstreamUrl || upstreamUrl.first !== route.id) return plainResponse(404, "Not Found");
  const qaResolved = parseQa(upstreamUrl.first.toLowerCase());
  if (qaResolved && isQaExpired(qaResolved.expDay, Date.now())) return expiredWithCsp();

  // ===== 讀上游（2026-11-08 起兩條路，見檔頭）=====
  // 1) 有唯讀 PAT：GitHub Contents API 讀 repo 原始檔（repo 轉私人後唯一讀得到的路；commit 後立刻讀得到、不用等 Pages 發布）。
  //    API 路徑用 RT-18 解析出來的第一段組（跟到期檢查同一個代號）。
  // 2) 沒有 PAT、或 API 讀不到：照舊走 GitHub Pages → raw。
  const token = shareToken(ctx.env);
  const isIndex = route.file === null;
  let got: Fetched | null = null;
  let apiError = false;
  if (token) {
    const api = await fetchViaApi(token, isIndex ? `${upstreamUrl.first}/index.html` : route.upstreamPath, request, wait);
    if (api.kind === "ok") got = api.got;
    else apiError = api.kind === "error";
  }
  if (!got) {
    const legacy = await fetchLegacy(upstreamUrl.href, upstreamUrl.first, isIndex);
    if (legacy.kind === "fail") return plainResponse(502, "分享頁暫時無法載入，請稍後再試。");
    // API 出錯（限流、401、5xx、連不上）而且舊路也拿不到正常頁：回 502，不把「暫時讀不到」說成「沒有這一頁」
    if (apiError && legacy.got.status !== 200) return plainResponse(502, "分享頁暫時無法載入，請稍後再試。");
    got = legacy.got;
  }

  const { ct, body, etag, src } = got;
  const status = got.status;
  const viaApi = src === "api" || src === "api-cache";
  const srcHeader = { [SHARE_SOURCE_HEADER]: src };

  // 非 HTML（圖片 / 其他資源）原樣回傳；nosniff 讓瀏覽器照 content-type 處理、不自己猜成 HTML／JS。
  // CSP sandbox：萬一有人直接開這個資源網址（例如惡意 svg），裡面的腳本跑不起來；當成 <img>／<link> 子資源載入時不受影響。
  if (!ct.includes("text/html")) {
    const headers: Record<string, string> = {
      "content-type": ct || "application/octet-stream",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      ...SHARE_BASE_HEADERS,
      ...srcHeader,
    };
    if (viaApi) {
      // API 路線的資源：邊緣已快取 5 分鐘，瀏覽器也給同樣的 max-age；ETag（GitHub 給的 blob 雜湊）照傳，帶 If-None-Match 對得上就回 304 省流量
      headers["cache-control"] = `public, max-age=${SHARE_API_CACHE_TTL}`;
      if (etag) {
        headers.etag = etag;
        if (etagMatches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
      }
    }
    return new Response(body, { status, headers });
  }

  let html = typeof body === "string" ? body : await new Response(body).text();

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

  // 推薦頁「傳給景泰」（2026-10-07）：只在景泰本人的頁（頁面單獨一行寫 var LIKE_NOTIFY = true;，同事頁是 false）注入 /js/share-pick.js，
  // qa、qs 等所有代號都一樣。正式網域、本機，以及舊網址 teddy-website-blog.pages.dev 都注入：推薦頁產生器發出去的連結還是舊網址；
  // 舊網址上的腳本會跨網域送到 https://teddy-house.tw/api/find/pick（請求打在正式網域，WAF 照樣管得到）。
  // 預覽網址不注入。其他頁面輸出不變（見 src/lib/find/sharepick.ts）。
  if (pickHostOk(request)) html = injectPick(html, route.id);

  // 瀏覽器快取：API 路線跟邊緣快取同樣 5 分鐘；舊路維持 30 秒
  const ttl = viaApi ? SHARE_API_CACHE_TTL : 30;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // qa 推薦頁不放邊緣快取，避免過期頁被快取住；非 2xx（例如剛產生、還沒發布的 404）一律不快取，重新整理就拿得到新頁
      "cache-control": qa || status < 200 || status > 299 ? "private, max-age=0, no-store" : `public, max-age=${ttl}`,
      // nosniff／X-Frame-Options／no-referrer／noindex（雙保險，頁面 meta 也有 noindex）
      ...SHARE_BASE_HEADERS,
      ...srcHeader,
      // 推薦頁與主站同源：「不准被嵌框、不准改 base、不准 object／外部表單」（RT-18 起 qa 頁有；2026-10-17 起所有代號都有）
      "content-security-policy": SHARE_HTML_CSP,
    },
  });
};

// qa 過期頁（固定 HTML，shareqa.ts 產生）也補上同一組 CSP；其他標頭不變
function expiredWithCsp(): Response {
  const r = expiredResponse();
  r.headers.set("content-security-policy", SHARE_HTML_CSP);
  return r;
}
