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

// 只收自家網域（正式站 + Cloudflare Pages 預覽網域）與本機 wrangler dev
const ALLOWED_ORIGIN =
  /^https:\/\/([a-z0-9-]+\.)?teddy-website-blog\.pages\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

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

// 取欄位：去頭尾空白、砍控制字元、限長
function field(payload: Payload, key: string, max: number): string {
  const raw = typeof payload[key] === "string" ? payload[key] : "";
  // 保留換行（訊息欄多行），砍其他控制字元
  const clean = raw.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").trim();
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

  // 1. honeypot — bot 中招就靜默吞掉
  if (payload._gotcha) {
    return jsonResponse({ ok: true, spam: true });
  }

  // 2. 太快 submit = bot（delta < 0 視為時鐘異常、放行）
  const loadedAt = parseInt(payload._loaded_at || "0", 10);
  if (loadedAt > 0) {
    const delta = Date.now() - loadedAt;
    if (delta >= 0 && delta < 3000) {
      return jsonResponse({ ok: true, spam: true });
    }
  }

  // 3. 必填驗證 + 長度上限
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
  const message = field(payload, "訊息", 1000);
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
      return jsonResponse({
        ok: false,
        degraded: true,
        error: "delivery_failed",
        status: tgRes.status,
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
