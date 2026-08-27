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
 *
 * 用法：<a href="/go/line?src=float">  ← src 標明按鈕位置
 *       實際是哪一頁按的，從 Referer 讀，不必寫死在每個連結裡。
 *
 * 環境變數（Cloudflare Pages → Settings → Environment variables）：
 *   CONTACT_TG_TOKEN / CONTACT_TG_CHAT — 沒設就只轉址、不記錄（silent）。
 */

const LINE_URL = "https://line.me/ti/p/sky811117";

// 按鈕位置代碼 → 看得懂的名稱
const SRC_LABEL: Record<string, string> = {
  float: "右下角浮動按鈕",
  footer: "頁尾",
  contact: "聯絡頁",
  "contact-form": "買方詢問表單",
  "sell-form": "賣方委託表單",
  about: "關於景泰",
  buy: "我要買房頁",
  sell: "我要賣房頁",
  areas: "台中各區總覽",
  area: "區域頁",
  property: "物件詳細頁",
  "404": "找不到頁面",
  post: "文章內",
  home: "首頁",
  faq: "常見問題",
  media: "媒體頁",
  tools: "客戶工具",
  services: "服務項目",
  shorts: "短影音頁",
  properties: "在售物件列表",
  projects: "專案頁",
  thankyou: "送出表單後的感謝頁",
  "home-social": "首頁社群卡片",
  "media-social": "媒體頁社群卡片",
  socials: "頁尾社群 icon",
};

// 爬蟲不記錄（避免把 bot 點擊當成真人線索）
const BOT = /bot|crawler|spider|crawling|preview|facebookexternalhit|slurp|bingpreview|headless|curl|wget|python-requests/i;

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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notify(env: Env, src: string, referer: string, country: string) {
  if (!env.CONTACT_TG_TOKEN || !env.CONTACT_TG_CHAT) return;

  const where = SRC_LABEL[src] || src || "未標示";
  let page = "";
  try {
    page = referer ? decodeURIComponent(new URL(referer).pathname) : "";
  } catch {
    page = referer;
  }

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
  // 轉址先算好 —— 不論下面發生什麼事，一定回得了 LINE
  const redirect = Response.redirect(LINE_URL, 302);

  try {
    const { request, env, waitUntil } = ctx;
    const ua = request.headers.get("user-agent") || "";
    if (BOT.test(ua)) return redirect;

    const src = new URL(request.url).searchParams.get("src") || "";
    const referer = request.headers.get("referer") || "";
    const country =
      (request as Request & { cf?: { country?: string } }).cf?.country || "";

    // 非阻塞：記錄失敗不影響使用者
    waitUntil(notify(env, src, referer, country).catch(() => {}));
  } catch {
    // 任何意外都吞掉，使用者照樣進得了 LINE
  }

  return redirect;
};
