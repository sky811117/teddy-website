/**
 * Cloudflare Pages Function — /go/line
 *
 * 官網所有 LINE 按鈕的中繼站。
 *
 * 為什麼要有這支：站上每一個 LINE 按鈕原本都直接指向 line.me/ti/p/~sky811117，
 * 跟 IG bio、名片、591 廣告用的是同一個連結 —— 客戶加了 LINE 進來，完全無法
 * 分辨他是從哪裡來的。2026-08-27 有人用 LINE 來問「麗園道」，就是因為這樣查不出來源。
 *
 * 行為：
 *   1. **一定** 302 轉到 LINE（這是轉換路徑，絕不能因為記錄失敗而壞掉）
 *   2. 記錄用 waitUntil 非阻塞送 TG，失敗也不影響轉址
 *   3. 同一 IP 5 分鐘內只推一次 TG（in-memory、每個 isolate 各自計，夠擋手滑連點與簡單洗版）
 *   4. （2026-10 資安加固 M-20）整個 isolate 每 5 分鐘最多推 GLOBAL_MAX_NOTIFY 則；
 *      只認 Cf-Connecting-Ip（Cloudflare 邊緣會覆寫它，client 偽造不了），不再信任可偽造的 X-Forwarded-For；
 *      只有 GET 才會推 TG（POST／方法覆寫標頭一律只轉址不通知）
 *      ⚠️ 已知限制：這個上限是「每個 isolate 各算各的」，不是全站絕對保證；而且有人用 30 個不同 IP 就能把名額
 *      燒光，之後真人點 LINE 只轉址、不通知。程式內無法根治，要靠 Cloudflare 後台的 WAF 速率限制（行動清單 B19）。
 *   5. （驗證者回饋）src 只認 SRC_LABEL 登錄過的代碼，未登錄的不回顯到 TG（見 srcLabel）
 *
 * 用法：<a href="/go/line?src=post-end&p=community-liyuandao">
 *   src — 按鈕位置代碼，規範 `<page>-<placement>`（見 SRC_LABEL）
 *   p   — 所在頁面 / 文章 slug，優先於 Referer（文章頁的 rel=noreferrer 曾讓 Referer 全空）
 *         （2026-10 資安加固 M-20）只收 ^[\w/-]{1,100}$：文章 slug 全是 [A-Za-z0-9_-]，
 *         不合格的值整個丟掉，不會被塞進 TG（避免有人用 curl 把任意文字／連結塞進景泰的 TG）
 *
 * 環境變數（Cloudflare Pages → Settings → Environment variables）：
 *   CONTACT_TG_TOKEN / CONTACT_TG_CHAT — 沒設就只轉址、不記錄（silent）。
 */

// ⚠️ LINE ID 加好友一定要帶「~」。2026-09-29 前寫成 ti/p/sky811117（沒有 ~），
// LINE 會把它當成加密代碼、加不到好友；景泰手機實測只有 ~sky811117 能開。
const LINE_URL = "https://line.me/ti/p/~sky811117";

// 按鈕位置代碼 → 看得懂的名稱。命名規範：<page>-<placement>
const SRC_LABEL: Record<string, string> = {
  // 全站共用
  float: "右下角浮動按鈕",
  header: "頁首 LINE 圓鈕",
  footer: "頁尾",
  socials: "頁尾社群 icon",
  "form-fallback": "買方表單備援面板（後端沒收到件）",
  "sell-form-fallback": "賣方表單備援面板（後端沒收到件）",
  "contact-form": "買方詢問表單旁",
  "sell-form": "賣方委託表單旁",
  // 頁面
  contact: "聯絡頁",
  about: "關於景泰",
  buy: "我要買房頁",
  sell: "我要賣房頁",
  areas: "台中各區總覽",
  area: "區域頁",
  "404": "找不到頁面",
  home: "首頁",
  "home-hero": "首頁 hero",
  "home-hero-text": "首頁 hero 的文字連結（2026-10 改版後；改版前的實心鈕是 home-hero）",
  "find-result": "找房小幫手：結果好了之後",
  "find-degraded": "找房小幫手：系統忙、改收件的畫面",
  "find-empty": "找房小幫手：沒找到符合的物件",
  "find-error": "找房小幫手：出錯畫面",
  "find-oos": "找房小幫手：不在服務範圍",
  "find-noscript": "找房小幫手：沒開 JavaScript 的備援",
  "share-expired": "推薦頁過期的提示",
  "share-ai": "推薦頁頁尾：問景泰（個人化區塊）",
  "home-bottom": "首頁底部",
  "tools-top": "工具頁上方",
  "tools-bottom": "工具頁底部",
  "home-social": "首頁社群卡片",
  faq: "常見問題",
  media: "影音頁",
  "media-social": "影音頁社群卡片",
  tools: "客戶工具",
  services: "服務項目",
  shorts: "短影音頁",
  properties: "在售物件列表",
  "properties-district": "分區在售物件列表",
  projects: "專案頁",
  thankyou: "送出表單後的感謝頁",
  // 工具頁（站上實際在用、原本沒登錄；2026-10 併入驗證者回饋時補上，不然 src 不回顯後 TG 會看不出來源）
  "school-district": "學區查詢工具",
  "tools-seller-net": "賣方實拿試算工具",
  "undesirable-facilities": "嫌惡設施地圖",
  "garbage-truck": "垃圾車查詢工具",
  "about-page": "關於景泰（內文連結）",
  // 文章
  post: "文章內（舊代碼）",
  "post-end": "文章文末 CTA",
  "post-author": "文章作者卡",
  "post-body": "文章內文",
  "post-body-community": "社區文章內文",
  "post-community": "文章社區在售區塊",
  // 物件詳細頁
  property: "物件詳細頁（舊代碼）",
  "property-sticky": "物件頁桌機底部價格列",
  "property-bar": "物件頁手機底部三鍵",
  "property-nophoto": "物件頁無照片佔位",
  "property-bottom": "物件頁頁底表單旁",
};

// 查「按鈕位置代碼」的顯示名稱。（驗證者發現的兩個洞，這裡一次補上）
//  1. 只認 SRC_LABEL 自己的 key（hasOwnProperty）：constructor／__proto__／toString／hasOwnProperty 這類
//     原型鏈上的名字，以前會查到「函式」，丟 TypeError → 通知靜默消失、卻照樣耗掉節流名額。
//  2. 不在清單內的代碼「一律不回顯」：攻擊者用 curl 帶 ?src=自選的40個英數字，以前會原樣出現在 TG 的
//     「按鈕位置」（可以長得像電話號碼、催促文字）。現在只顯示「未標示（代碼未登錄）」。
//     新增按鈕代碼時請同步加進 SRC_LABEL；沒加的話景泰在 Cloudflare Worker log 看得到（console.warn）。
function isKnownSrc(src: string): boolean {
  return !!src && Object.prototype.hasOwnProperty.call(SRC_LABEL, src);
}

export function srcLabel(src: string): string {
  if (!src) return "未標示";
  return isKnownSrc(src) ? SRC_LABEL[src] : "未標示（代碼未登錄）";
}

// 爬蟲不記錄（避免把 bot 點擊當成真人線索）
const BOT = /bot|crawler|spider|crawling|preview|facebookexternalhit|slurp|bingpreview|headless|curl|wget|python-requests/i;

// 同 IP 節流：5 分鐘內只推一次。Map 只活在單一 isolate 記憶體，不假設有 KV。
const NOTIFY_WINDOW_MS = 5 * 60 * 1000;
const MAX_TRACKED_IPS = 2000;
// 整個 isolate 的總量上限（資安加固 M-20）：就算有人輪換大量 IP，一個 isolate 每 5 分鐘也最多推這麼多則。
// 只影響「TG 通知」，不影響轉址；真人點 LINE 的量遠低於此。要放寬就改這個數字。
const GLOBAL_MAX_NOTIFY = 30;
const lastNotified = new Map<string, number>();
let globalWindowStart = 0;
let globalCount = 0;

// 取得「節流用的 key」。只信 Cf-Connecting-Ip：這個標頭由 Cloudflare 邊緣覆寫，client 送的會被蓋掉。
// X-Forwarded-For 是 client 可自帶的（輪換它就能繞過節流），所以完全不看。
// 沒有 Cf-Connecting-Ip（本機 wrangler dev 或異常）→ 全部歸同一桶 "no-ip"，寧可少推也不要被洗版。
export function clientKey(headers: Headers): string {
  const ip = (headers.get("cf-connecting-ip") || "").trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "no-ip";
}

function takeGlobalSlot(now: number): boolean {
  if (now - globalWindowStart >= NOTIFY_WINDOW_MS) {
    globalWindowStart = now;
    globalCount = 0;
  }
  if (globalCount >= GLOBAL_MAX_NOTIFY) return false;
  globalCount++;
  return true;
}

export function shouldNotify(key: string, now: number): boolean {
  const last = lastNotified.get(key) || 0;
  if (now - last < NOTIFY_WINDOW_MS) return false;
  if (!takeGlobalSlot(now)) return false;
  if (lastNotified.size >= MAX_TRACKED_IPS) {
    // 清掉過期的；還是太多就整個重來（寧可多推一則，也不要記憶體無限長）
    for (const [k, t] of lastNotified) {
      if (now - t >= NOTIFY_WINDOW_MS) lastNotified.delete(k);
    }
    if (lastNotified.size >= MAX_TRACKED_IPS) lastNotified.clear();
  }
  lastNotified.set(key, now);
  return true;
}

// 「所在頁面」白名單（M-20）：只收英數、底線、減號、斜線，最長 100。
// 站上文章 slug 全是 [A-Za-z0-9_-]（最長 69 字），區域頁／物件頁路徑也都落在這個字元集內。
// 不收 . : % 空白 < > @ 與非 ASCII → 網址（evil.com/x）、HTML、換行、@提及 全進不來。
const PAGE_RE = /^[\w/-]{1,100}$/;

export function cleanPageParam(raw: string | null | undefined): string {
  const p = (raw ?? "").trim();
  return PAGE_RE.test(p) ? p : "";
}

// Referer 一樣是 client 自報的（curl 可以亂填），所以套同一份白名單。
// 不做 decodeURIComponent：含 % 的（中文標籤頁等）一律視為「無法辨識」，寧可不顯示也不放行。
export function pageFromReferer(referer: string): string {
  if (!referer) return "";
  try {
    const path = new URL(referer).pathname;
    return PAGE_RE.test(path) ? path : "";
  } catch {
    return "";
  }
}

type Env = {
  CONTACT_TG_TOKEN?: string;
  CONTACT_TG_CHAT?: string;
};

type EventContext = {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function notify(
  env: Env,
  src: string,
  page: string,
  country: string
) {
  if (!env.CONTACT_TG_TOKEN || !env.CONTACT_TG_CHAT) return;

  const where = srcLabel(src);
  // 未登錄的代碼只寫進 Worker log（只有景泰看得到），不放進 TG 訊息。src 已被限制成 [A-Za-z0-9_-]{0,40}。
  if (src && !isKnownSrc(src)) console.warn("[go/line] unregistered src code:", src);

  const lines = [
    "💬 <b>有人從官網點了 LINE</b>",
    `按鈕位置：${esc(where)}`,
    page ? `所在頁面：${esc(page)}` : "所在頁面：（未帶或無法辨識）",
    country && country !== "TW" ? `來源地區：${esc(country)}` : "",
  ].filter(Boolean);

  await fetch(`https://api.telegram.org/bot${env.CONTACT_TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.CONTACT_TG_CHAT,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

export const onRequest = async (ctx: EventContext): Promise<Response> => {
  // 轉址先算好 —— 不論下面發生什麼事，一定回得了 LINE。目的地寫死，不吃任何參數。
  // 不用 Response.redirect()：它的 headers 是 immutable、補不了安全標頭
  // （public/_headers 只套靜態檔、不套 Functions 回應）。
  const redirect = new Response(null, {
    status: 302,
    headers: {
      location: LINE_URL,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });

  try {
    const { request, env, waitUntil } = ctx;
    // 只有 GET 才記錄。POST／HEAD／OPTIONS 以及 X-HTTP-Method-Override 之類的覆寫標頭都不會觸發 TG
    // （這裡只看 request.method，從不讀任何方法覆寫標頭）；它們照樣拿到轉址。
    if (request.method !== "GET") return redirect;

    const ua = request.headers.get("user-agent") || "";
    if (BOT.test(ua)) return redirect;

    const url = new URL(request.url);
    const src = clip(
      (url.searchParams.get("src") || "").replace(/[^\w-]/g, ""),
      40
    );

    // 所在頁面：p 參數優先（文章 slug），沒有（或不合白名單）才看 Referer；
    // 兩者都要過同一份白名單，過不了就留空，TG 上顯示「未帶或無法辨識」。
    const page =
      cleanPageParam(url.searchParams.get("p")) ||
      pageFromReferer(request.headers.get("referer") || "");

    const country =
      (request as Request & { cf?: { country?: string } }).cf?.country || "";

    if (shouldNotify(clientKey(request.headers), Date.now())) {
      // 非阻塞：記錄失敗不影響使用者
      waitUntil(notify(env, src, page, country).catch(() => {}));
    }
  } catch {
    // 任何意外都吞掉，使用者照樣進得了 LINE
  }

  return redirect;
};
