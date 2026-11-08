/**
 * 推薦頁代理（functions/share/[[path]].ts）注入「傳給景泰」腳本（public/js/share-pick.js）的判斷（2026-10-07）。
 * 伺服器端 /api/find/pick（pick.ts）核對推薦頁時也用這裡的「是不是景泰本人頁」與上游網址，兩邊同一套規則。
 *
 * 只注入「景泰本人的推薦頁」：推薦頁產生器在頁面腳本裡單獨一行寫 `var LIKE_NOTIFY = true;`
 * （同事白牌頁是 false，按喜歡只收藏、不推播）。qa（找房小幫手）與 qs（查詢台）等所有代號一視同仁，只看這一行。
 * 審查 R4（2026-10-07）：同事頁的客戶稱呼、找房需求、物件介紹都是別人可以控制的文字，裡面寫一句 `var LIKE_NOTIFY = true;`
 * 原本就會被誤判成本人頁。現在兩道：
 *   1. 頁面只要出現 `var LIKE_NOTIFY = false`（同事頁一定有這行，正常資料造不出反例）→ 一律不是本人頁；
 *   2. true 只認「一行的開頭」（產生器那行前面只有縮排；客戶文字經過 JSON／HTML 跳脫，不會自己變成一行的開頭）。
 * 代號放進 data-share 屬性給腳本用（腳本拿不到頁面 IIFE 裡的 SHARE_ID）；代號已過白名單（只有英數），可以直接放進屬性。
 * ?v= 是檔案內容 md5 前 10 碼（src/lib/find/pickver.ts，由 scripts/pick-stamp.mjs 寫入）：/js/* 快取一天，檔案一改就換號。
 *
 * 注入的主機（審查 R1）：正式網域、本機測試位址，以及舊網址 teddy-website-blog.pages.dev。
 * 推薦頁產生器發出去的連結到 2026-10-07 仍是舊網址（teddy-share-app 的 PAGES_BASE_URL），只在新網域注入等於客人幾乎看不到。
 * 舊網址上的頁面一樣注入，腳本改成跨網域送到 https://teddy-house.tw/api/find/pick（請求打在正式網域，WAF 照樣管得到，
 * 不違反 RT-05；pick 端點只對舊網址這一個來源回 CORS 允許）。預覽網址（<hash>.teddy-website-blog.pages.dev）不注入。
 */
import { hostAllowed } from "./origin";
import { PICK_V } from "./pickver";

/** 推薦頁上游（跟 functions/share/[[path]].ts 的 UPSTREAM／RAW_UPSTREAM 同值；tests/find/share_pick.test.mjs 有釘住兩邊一致） */
export const SHARE_UPSTREAM = "https://sky811117.github.io/teddy-shares/";
export const SHARE_RAW_UPSTREAM = "https://raw.githubusercontent.com/sky811117/teddy-shares/main/";
/**
 * 2026-11-08：teddy-shares 轉成私人 repo 之後，GitHub Pages（SHARE_UPSTREAM）會下線、raw（SHARE_RAW_UPSTREAM）也會 404。
 * 有唯讀 PAT（Cloudflare Pages secret SHARES_GH_TOKEN；fine-grained、只有 teddy-shares 的 Contents: Read）時，
 * 代理與 /api/find/pick 都改走 GitHub Contents API 讀原始檔；沒 token 時照舊走 Pages／raw（repo 還公開的過渡期不會壞）。
 * API 回應的 content-type 一律是 application/vnd.github.raw+json、Cache-Control: private：要自己依副檔名設 content-type、自己放邊緣快取。
 * 目錄清單與錯誤物件才是 application/json，讀到就當「不是檔案」。每小時 5,000 次／token，所以代理那邊一定要有邊緣快取。
 */
export const SHARE_API_UPSTREAM = "https://api.github.com/repos/sky811117/teddy-shares/contents/";
export const SHARE_API_REF = "main";
/** 只收像 PAT 的字串（fine-grained：github_pat_…；classic：ghp_…；只有英數與底線、20～255 碼），空白、換行、怪字元一律當沒設。值不會寫進任何回應或紀錄。 */
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;
export function shareToken(env: unknown): string | null {
  if (!env || typeof env !== "object") return null;
  const v = (env as { SHARES_GH_TOKEN?: unknown }).SHARES_GH_TOKEN;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return TOKEN_RE.test(t) ? t : null;
}
/** Contents API 的網址與標頭：raw 媒體型別＝直接回檔案內容；GitHub API 一定要有 User-Agent。path 已過白名單（只有英數 . _ - 與斜線）。 */
export function shareApiRequest(path: string, token: string, userAgent: string): { url: string; headers: Record<string, string> } {
  return {
    url: `${SHARE_API_UPSTREAM}${path}?ref=${SHARE_API_REF}`,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github.raw+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": userAgent,
    },
  };
}
/** 依副檔名給 content-type（API 不給）。白名單以外的副檔名回 octet-stream（代理的白名單在前面就擋掉了，這裡只是保險）。 */
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
};
export function shareContentType(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPES[ext] || "application/octet-stream";
}
/** 舊網址（2026-10-03 搬家前的正式網址；推薦頁連結還在用） */
export const OLD_HOST = "teddy-website-blog.pages.dev";
export const OLD_ORIGIN = "https://" + OLD_HOST;

/** 同事頁的標記（出現就一律不是本人頁） */
export const LIKE_NOTIFY_OFF = /\bvar\s+LIKE_NOTIFY\s*=\s*false\b/;
/** 景泰本人頁的標記（推薦頁產生器：`  var LIKE_NOTIFY = {"true" if like_notify else "false"};`），只認一行的開頭 */
export const LIKE_NOTIFY_ON = /^[ \t]*var\s+LIKE_NOTIFY\s*=\s*true\s*;/m;
const ID_RE = /^[A-Za-z0-9]{4,40}$/;

/** 是不是景泰本人的推薦頁（注入與伺服器端核對共用） */
export function isOwnerPage(html: string): boolean {
  return typeof html === "string" && !LIKE_NOTIFY_OFF.test(html) && LIKE_NOTIFY_ON.test(html);
}

/** 這個請求的主機要不要注入：正式網域、本機，或舊網址本身（不含預覽網址） */
export function pickHostOk(request: Request): boolean {
  if (hostAllowed(request)) return true;
  try {
    return new URL(request.url).hostname.toLowerCase() === OLD_HOST;
  } catch {
    return false;
  }
}

export function pickScriptTag(id: string, v: string = PICK_V): string {
  return `<script src="/js/share-pick.js?v=${v}" data-share="${id}" defer></script>`;
}

/** 符合條件就在最後一個 </body> 前放腳本（沒有 </body> 就接在最後）；不符合原樣回傳。已經有就不重複放。 */
export function injectPick(html: string, id: string, v: string = PICK_V): string {
  if (!ID_RE.test(id) || !/^[0-9a-z]{1,16}$/.test(v)) return html;
  if (!isOwnerPage(html) || html.includes("/js/share-pick.js")) return html;
  const tag = pickScriptTag(id, v);
  const i = html.lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag;
}
