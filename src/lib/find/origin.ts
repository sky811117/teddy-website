/**
 * 同源檢查。瀏覽器只會從官網自家頁面呼叫 /api/find/*，所以：
 *  - 請求本身必須打在「正式網域」（teddy-house.tw、www.teddy-house.tw）或本機測試位址；舊網址 pages.dev 與預覽網址一律拒絕
 *    （RT-05：同一套 Functions 也掛在舊網址上，Cloudflare 後台對正式網域設的速率限制管不到它，攻擊者換舊網址就繞過；
 *    現在舊網址上的 /api/find/*、/api/contact-* 直接回 404，攻擊者只剩正式網域這一條路，防護才有意義）
 *  - POST 必須帶 Origin（或退而求其次看 Referer），而且只收「跟這個請求同一類」的來源：
 *    打在正式網域的請求只收正式網域的 Origin（不收 http://localhost——它不是任何瀏覽器會從官網頁面送出的來源），
 *    打在本機測試位址的請求只收本機位址
 *  - GET（沒有 Origin）看 Sec-Fetch-Site：缺標頭（部分內建瀏覽器）放行，
 *    有就必須是 same-origin 或 none（直接輸入網址）；cross-site／same-site 一律擋
 * ⚠️ Origin／Referer／Sec-Fetch-Site 都不是認證：curl 想填什麼都可以。這一層只擋「別的網站的瀏覽器頁面」；
 *    真正擋非瀏覽器大量請求靠 Cloudflare WAF 速率限制（見手動設定清單）與人機驗證。
 */
const PROD_HOST = /^(?:www\.)?teddy-house\.tw$/i;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1)$/i;
const PROD_ORIGIN = /^https:\/\/(?:www\.)?teddy-house\.tw$/i;
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

function hostnameOf(request: Request): string | null {
  try {
    return new URL(request.url).hostname;
  } catch {
    return null;
  }
}

/** 請求是不是打在正式網域或本機測試位址（舊的 pages.dev、預覽網址、其他主機名一律不是） */
export function hostAllowed(request: Request): boolean {
  const h = hostnameOf(request);
  return !!h && (PROD_HOST.test(h) || LOCAL_HOST.test(h));
}

function originOk(request: Request, origin: string): boolean {
  const h = hostnameOf(request);
  if (!h) return false;
  if (PROD_HOST.test(h)) return PROD_ORIGIN.test(origin);
  if (LOCAL_HOST.test(h)) return LOCAL_ORIGIN.test(origin);
  return false;
}

export function originAllowed(request: Request): boolean {
  if (!hostAllowed(request)) return false;
  const origin = request.headers.get("origin");
  if (origin) return originOk(request, origin);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return originOk(request, new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

export function sameOriginGet(request: Request): boolean {
  if (!hostAllowed(request)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (!site) return true;
  return site === "same-origin" || site === "none";
}
