/**
 * Cloudflare Pages Function — /tools/buyer-fee/*
 *
 * 買方自備款試算（青安 3.0 vs 一般房貸）。
 * 本體放在 teddy-share-app（Vercel）的 /buyer-fee2/ —— 同事白牌設定、舊連結都靠那一份，
 * 這裡只做轉接，讓工具算在 teddy-house.tw 底下：
 *   - 對官網 SEO 有幫助（2026-08-28 嫌惡設施地圖搬進站內也是同一個理由）
 *   - 同事在這個網址產生的客戶連結，自動是 teddy-house.tw 開頭
 *
 * ⚠️ 不轉送網址參數：?wl=（白牌名片）跟 #c=（試算數字，雜湊本來就不會送到伺服器）
 *    都在瀏覽器端讀，Vercel 用不到，也不該進它的存取紀錄。
 * ⚠️ 上游資料夾是平的（index.html、logo、icon、manifest、service-worker），
 *    只放行單層、安全字元的檔名，其餘一律 404。
 */

const UPSTREAM = "https://teddy-share-app.vercel.app/buyer-fee2/";
const BASE_PATH = "/tools/buyer-fee/";
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type EventContext = {
  params: { path?: string | string[] };
  request: Request;
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export const onRequest = async ({
  params,
  request,
}: EventContext): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);

  // /tools/buyer-fee（沒尾斜線）→ 補斜線，頁面裡的相對路徑（logo、manifest、SW）才對得到
  if (!url.pathname.endsWith("/") && !url.pathname.slice(BASE_PATH.length).includes(".")) {
    return Response.redirect(`${url.origin}${BASE_PATH}${url.search}`, 301);
  }

  let parts: string[] = [];
  const raw = params.path;
  if (Array.isArray(raw)) parts = raw;
  else if (typeof raw === "string" && raw) parts = [raw];
  parts = parts.filter(p => p !== "");

  if (parts.length > 1 || (parts.length === 1 && !SAFE_FILE.test(parts[0]))) {
    return new Response("Not Found", { status: 404, headers: SECURITY_HEADERS });
  }
  const file = parts[0] || "index.html";
  const isHtml = file.endsWith(".html");
  const isSw = file === "service-worker.js";

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + file, {
      headers: { "User-Agent": "teddy-website-tools-proxy" },
      // 邊快取：頁面 60 秒（改版上線最多慢一分鐘）、圖檔一小時；SW 不快取，改版才換得掉
      // cf 是 Workers 執行期欄位，標準 RequestInit 型別沒有 → 斷言避開 TS2353/2769
      cf: isSw ? { cacheTtl: 0 } : { cacheTtl: isHtml ? 60 : 3600, cacheEverything: true },
    } as RequestInit);
  } catch {
    return new Response("試算工具暫時無法載入，請稍後再試。", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS },
    });
  }

  if (!upstream.ok) {
    return new Response("Not Found", { status: upstream.status === 404 ? 404 : 502, headers: SECURITY_HEADERS });
  }

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": ct,
      "cache-control": isSw ? "no-cache" : isHtml ? "public, max-age=60" : "public, max-age=3600",
      ...SECURITY_HEADERS,
    },
  });
};
