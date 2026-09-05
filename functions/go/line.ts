/**
 * Cloudflare Pages Function — /go/line
 *
 * 官網所有 LINE 按鈕的中繼站。
 *
 * 為什麼要有這支：站上每一個 LINE 按鈕原本都直接指向 line.me/ti/p/sky811117，
 * 跟 IG bio、名片、591 廣告用的是同一個連結 —— 客戶加了 LINE 進來，完全無法
 * 分辨他是從哪裡來的。2026-08-27 有人用 LINE 來問「麗園道」，就是因為這樣查不出來源。
 *
 * 行為：
 *   1. **一定** 302 轉到 LINE（這是轉換路徑，絕不能因為記錄失敗而壞掉）
 *   2. 記錄用 waitUntil 非阻塞送 TG，失敗也不影響轉址
 *   3. 同一 IP 5 分鐘內只推一次 TG（in-memory、每個 isolate 各自計，夠擋手滑連點與簡單洗版）
 *
 * 用法：<a href="/go/line?src=post-end&p=community-liyuandao">
 *   src — 按鈕位置代碼，規範 `<page>-<placement>`（見 SRC_LABEL）
 *   p   — 所在頁面 / 文章 slug，優先於 Referer（文章頁的 rel=noreferrer 曾讓 Referer 全空）
 *
 * 環境變數（Cloudflare Pages → Settings → Environment variables）：
 *   CONTACT_TG_TOKEN / CONTACT_TG_CHAT — 沒設就只轉址、不記錄（silent）。
 */

const LINE_URL = "https://line.me/ti/p/sky811117";

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
  projects: "專案頁",
  thankyou: "送出表單後的感謝頁",
  // 文章
  post: "文章內（舊代碼）",
  "post-end": "文章文末 CTA",
  "post-body": "文章內文",
  "post-community": "文章社區在售區塊",
  // 物件詳細頁
  property: "物件詳細頁（舊代碼）",
  "property-sticky": "物件頁桌機底部價格列",
  "property-bar": "物件頁手機底部三鍵",
  "property-nophoto": "物件頁無照片佔位",
  "property-bottom": "物件頁頁底表單旁",
};

// 爬蟲不記錄（避免把 bot 點擊當成真人線索）
const BOT = /bot|crawler|spider|crawling|preview|facebookexternalhit|slurp|bingpreview|headless|curl|wget|python-requests/i;

// 同 IP 節流：5 分鐘內只推一次。Map 只活在單一 isolate 記憶體，不假設有 KV。
const NOTIFY_WINDOW_MS = 5 * 60 * 1000;
const MAX_TRACKED_IPS = 2000;
const lastNotified = new Map<string, number>();

function shouldNotify(ip: string, now: number): boolean {
  if (!ip) return true;
  const last = lastNotified.get(ip) || 0;
  if (now - last < NOTIFY_WINDOW_MS) return false;
  if (lastNotified.size >= MAX_TRACKED_IPS) {
    // 清掉過期的；還是太多就整個重來（寧可多推一則，也不要記憶體無限長）
    for (const [k, t] of lastNotified) {
      if (now - t >= NOTIFY_WINDOW_MS) lastNotified.delete(k);
    }
    if (lastNotified.size >= MAX_TRACKED_IPS) lastNotified.clear();
  }
  lastNotified.set(ip, now);
  return true;
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

  const where = src
    ? SRC_LABEL[src] || `未標示：${src}`
    : "未標示";

  const lines = [
    "💬 <b>有人從官網點了 LINE</b>",
    `按鈕位置：${esc(where)}`,
    page ? `所在頁面：${esc(page)}` : "所在頁面：（未帶 referrer）",
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
    const ua = request.headers.get("user-agent") || "";
    if (BOT.test(ua)) return redirect;

    const url = new URL(request.url);
    const src = clip(
      (url.searchParams.get("src") || "").replace(/[^\w-]/g, ""),
      40
    );

    // 所在頁面：p 參數優先（文章 slug），沒有才看 Referer
    let page = "";
    const p = (url.searchParams.get("p") || "").trim();
    if (p) {
      page = clip(p.replace(/[\x00-\x1f\x7f]/g, ""), 200);
    } else {
      const referer = request.headers.get("referer") || "";
      try {
        page = referer ? decodeURIComponent(new URL(referer).pathname) : "";
      } catch {
        page = clip(referer, 200);
      }
    }

    const country =
      (request as Request & { cf?: { country?: string } }).cf?.country || "";
    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for") ||
      "";

    if (shouldNotify(ip, Date.now())) {
      // 非阻塞：記錄失敗不影響使用者
      waitUntil(notify(env, src, page, country).catch(() => {}));
    }
  } catch {
    // 任何意外都吞掉，使用者照樣進得了 LINE
  }

  return redirect;
};
