/**
 * Cloudflare Pages Functions — POST /api/contact-tg
 *
 * 接 ContactForm 送來的 JSON、推 Telegram 通知到「泰迪的小聲音」。
 * 2026-09-06 起是買方表單的**主管道**（Formspree 變成可選的副管道）。
 *
 * 所需環境變數（Cloudflare Pages → Settings → Environment variables）:
 * - CONTACT_TG_TOKEN  Telegram bot token（推薦用「泰迪的小聲音」bot）
 * - CONTACT_TG_CHAT   Telegram chat_id
 *
 * 回應約定（前端 ContactForm.astro 依此決定導 thank-you 或原地備援）：
 * - 200 { ok:true }                       → 已推到 TG
 * - 200 { ok:false, degraded:true, ... }  → 沒設環境變數 / TG 送失敗；前端顯示 LINE + 複製訊息備援
 * - 400 { ok:false, error }               → 必填缺 / JSON 壞 / 跨站來源
 * 永遠不回 500：500 只會讓前端把客戶擋在外面。
 *
 * 2026-10 資安加固（M-20）：回應不再洩漏內部狀態——
 *   - 拿掉 `status`（原本會把 Telegram 的 HTTP 狀態碼回給任何呼叫者）
 *   - honeypot／太快送出的 bot 拿到跟真人一模一樣的 { ok:true }（拿掉 `spam:true`，
 *     否則等於告訴 bot「你被抓到了，換個寫法再試」）
 *   前端（ContactForm.astro）只讀 data.ok，不受影響。
 *   （驗證者回饋）honeypot／太快送出改放在欄位驗證「之後」：bot 送缺欄位的請求也拿到跟真人一樣的 400，
 *   無法再用「空請求回 200 還是 400」分辨自己有沒有被抓到；單行欄位的換行改成空白（不能在 TG 偽造多行假版面）。
 *   ⚠️ 已知殘餘：honeypot 路徑不打 TG，回應比真送出快幾百毫秒（時間差可被量到）；程式端不加人工延遲。
 *
 * 防護：honeypot + 3 秒偵測（client 自報，擋笨 bot）、Origin/Referer 白名單
 * （擋跨站 simple request 灌 TG）、欄位長度上限、body 10KB 上限。
 */

interface Env {
  CONTACT_TG_TOKEN?: string;
  CONTACT_TG_CHAT?: string;
}

type EventContext = {
  request: Request;
  env: Env;
};

type Payload = Record<string, string>;

const MAX_BODY_BYTES = 10 * 1024;

// 發送端全域上限（紅隊 RT-06）：整個 isolate 每分鐘最多推 TG_MAX_PER_MIN 則；超過的不推，只計數，
// 下一則推得出去的訊息會附一行「另有 N 則被合併」，景泰看得出被洗版而不是一堆一樣的訊息。
// ⚠️ 這個上限是「每個節點各算各的」，不是全站絕對保證；真正的防線是 Cloudflare 對正式網域的速率限制（見手動設定清單）。
const TG_WINDOW_MS = 60_000;
const TG_MAX_PER_MIN = 10;
let tgWindowStart = 0;
let tgCount = 0;
let tgSuppressed = 0;
function takeTgSlot(now: number): { ok: boolean; suppressed: number } {
  if (now - tgWindowStart >= TG_WINDOW_MS) {
    tgWindowStart = now;
    tgCount = 0;
  }
  if (tgCount >= TG_MAX_PER_MIN) {
    tgSuppressed++;
    return { ok: false, suppressed: 0 };
  }
  tgCount++;
  const s = tgSuppressed;
  tgSuppressed = 0;
  return { ok: true, suppressed: s };
}

// 只收自家正式網域（teddy-house.tw）與本機 wrangler dev。
// 2026-10-06 紅隊修補（RT-05）：舊網址 pages.dev 與預覽網址不再收——functions/_middleware.ts 已讓這支端點只服務正式網域
// （舊網址回 404，Cloudflare 對正式網域設的速率限制才有意義）；這裡再擋一次 Origin，兩層一致。
const ALLOWED_ORIGIN = /^https:\/\/(www\.)?teddy-house\.tw$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return ALLOWED_ORIGIN.test(origin);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return ALLOWED_ORIGIN.test(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  // 瀏覽器 fetch POST 一定帶 Origin；兩個都沒有的通常是 script
  return false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 取欄位：去頭尾空白、砍控制字元、限長。
// multiline=false（預設）＝單行欄位：換行（含 U+0085／U+2028／U+2029）一律換成空白，
//   不然有人能在「姓名」這類欄位塞換行，在 TG 訊息裡偽造一整段假的通知版面（驗證者發現的殘餘風險 J）。
// multiline=true 只給真的多行的欄位（訊息）。
function field(payload: Payload, key: string, max: number, multiline = false): string {
  const raw = typeof payload[key] === "string" ? payload[key] : "";
  // 砍控制字元（保留 \n，下面再決定要不要留）
  let clean = raw.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
  if (!multiline) clean = clean.replace(/[\n\u0085\u2028\u2029]+/g, " ");
  clean = clean.trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "cache-control": "no-store",
      // public/_headers 只套靜態檔，Functions 回應自己補
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

export const onRequestPost = async ({
  request,
  env,
}: EventContext): Promise<Response> => {
  if (!originAllowed(request)) {
    return jsonResponse({ ok: false, error: "Forbidden origin" }, 403);
  }

  const len = parseInt(request.headers.get("content-length") || "0", 10);
  if (len > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "Payload too large" }, 413);
  }

  let payload: Payload = {};
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "Payload too large" }, 413);
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }
    payload = parsed as Payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  // 1. 必填驗證 + 長度上限
  // ⚠️ 順序刻意：驗證在前、honeypot／太快送出在後（驗證者發現的殘餘風險 F）。
  //    以前 honeypot 在最前面，命中時連「缺必填欄位」的請求都回 200 {ok:true}，一般請求卻回 400——
  //    bot 只要送一個空請求就能分辨「我有沒有被當成 bot」。現在 bot 與真人走完全一樣的驗證、拿到一樣的錯誤，
  //    只有「通過驗證之後」才靜默吞掉（回 {ok:true}、不推 TG）。
  const name = field(payload, "姓名", 50);
  const phone = field(payload, "手機", 20);
  const email = field(payload, "Email", 120);
  const intent = field(payload, "我想", 20);
  if (!name || !intent || (!phone && !email)) {
    return jsonResponse(
      { ok: false, error: "Missing required fields" },
      400
    );
  }
  if (phone && !/^[\d\s+()-]{8,20}$/.test(phone)) {
    return jsonResponse({ ok: false, error: "Invalid phone" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, error: "Invalid email" }, 400);
  }

  // 2. honeypot — bot 中招就靜默吞掉（拿到跟真人一模一樣的 { ok:true }）
  if (payload._gotcha) {
    return jsonResponse({ ok: true });
  }

  // 3. 太快 submit = bot（delta < 0 視為時鐘異常、放行）
  const loadedAt = parseInt(payload._loaded_at || "0", 10);
  if (loadedAt > 0) {
    const delta = Date.now() - loadedAt;
    if (delta >= 0 && delta < 3000) {
      return jsonResponse({ ok: true });
    }
  }

  // 4. 環境變數檢查 — 沒設就回 degraded（前端原地備援、客戶不會看到「後端」字眼）
  const token = env.CONTACT_TG_TOKEN;
  const chatId = env.CONTACT_TG_CHAT;
  if (!token || !chatId) {
    console.warn(
      "[contact-tg] CONTACT_TG_TOKEN / CONTACT_TG_CHAT 未設定、跳過 TG 通知"
    );
    return jsonResponse({
      ok: false,
      degraded: true,
      error: "backend_not_configured",
    });
  }

  // 5. 組訊息
  const budget = field(payload, "預算", 30);
  const propId = field(payload, "物件編號", 30);
  const propTitle = field(payload, "物件標題", 120);
  const listingDesc = field(payload, "物件編號或描述", 200);
  const areas = field(payload, "區域偏好", 200);
  const message = field(payload, "訊息", 1000, true);
  const source = field(payload, "來源頁", 200);

  const lines: string[] = [
    `🔔 <b>新詢價</b>｜${escapeHtml(intent)}`,
    "",
    `<b>姓名</b>：${escapeHtml(name)}`,
  ];
  if (phone) {
    const phoneClean = phone.replace(/[^\d+]/g, "");
    lines.push(`<b>手機</b>：<a href="tel:${phoneClean}">${escapeHtml(phone)}</a>`);
  }
  if (email) {
    lines.push(`<b>Email</b>：<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  if (budget) lines.push(`<b>預算</b>：${escapeHtml(budget)}`);
  if (propId) {
    const propLine = propTitle
      ? `${propId} (${propTitle})`
      : propId;
    lines.push(`<b>物件</b>：${escapeHtml(propLine)}`);
  }
  if (listingDesc) lines.push(`<b>物件描述</b>：${escapeHtml(listingDesc)}`);
  if (areas) lines.push(`<b>區域</b>：${escapeHtml(areas)}`);
  if (message) {
    lines.push("");
    lines.push(`<b>訊息</b>：\n${escapeHtml(message)}`);
  }
  if (source) {
    lines.push("");
    lines.push(`<i>來源</i>：${escapeHtml(source)}`);
  }

  // 發送端全域上限（RT-06）：超過就不推，回 degraded（前端會顯示 LINE 與複製訊息的備援），不是靜默吞掉
  const slot = takeTgSlot(Date.now());
  if (!slot.ok) {
    console.warn("[contact-tg] tg budget exceeded");
    return jsonResponse({ ok: false, degraded: true, error: "delivery_failed" });
  }
  if (slot.suppressed > 0) lines.push("", `<i>（上一分鐘另有 ${slot.suppressed} 則因為太密集被合併，疑似洗版）</i>`);
  const text = lines.join("\n");

  // 6. 推 TG (TG no-silent push rule: disable_notification 必須 false)
  const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const tgRes = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!tgRes.ok) {
      const errText = await tgRes.text();
      console.error("[contact-tg] TG send failed:", tgRes.status, errText);
      // 不把 TG 的 HTTP 狀態碼回給 client（上面的 console.error 已經記了，看 Worker log 就有）
      return jsonResponse({
        ok: false,
        degraded: true,
        error: "delivery_failed",
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[contact-tg] TG fetch error:", err);
    return jsonResponse({ ok: false, degraded: true, error: "delivery_failed" });
  }

  return jsonResponse({ ok: true });
};

// 拒絕其他 method
export const onRequest = async ({
  request,
}: EventContext): Promise<Response> => {
  if (request.method === "POST") {
    // 應該被 onRequestPost 攔截、不會到這
    return jsonResponse({ ok: false, error: "Unexpected" }, 500);
  }
  return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
};
