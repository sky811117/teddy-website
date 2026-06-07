/**
 * Cloudflare Pages Functions — POST /api/contact-tg
 *
 * 接 ContactForm 送來的 JSON、推 Telegram 通知到「泰迪的小聲音」。
 * 跟 Formspree 並行 (表單 JS 同時 POST 兩個 endpoint)、互不依賴。
 *
 * 所需環境變數（Cloudflare Pages → Settings → Environment variables）:
 * - CONTACT_TG_TOKEN  Telegram bot token（推薦用「泰迪的小聲音」bot）
 * - CONTACT_TG_CHAT   Telegram chat_id（景泰個人 = 305627471 之類）
 *
 * 沒設環境變數時 endpoint 會 silent-fail（回 200 ok:false）、不會影響 Formspree 的 email 送達。
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestPost = async ({
  request,
  env,
}: EventContext): Promise<Response> => {
  let payload: Payload = {};
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  // 1. honeypot — bot 中招就靜默吞掉
  if (payload._gotcha) {
    return jsonResponse({ ok: true, spam: true });
  }

  // 2. 太快 submit = bot
  const loadedAt = parseInt(payload._loaded_at || "0", 10);
  if (loadedAt && Date.now() - loadedAt < 3000) {
    return jsonResponse({ ok: true, spam: true });
  }

  // 3. 必填驗證
  const name = (payload["姓名"] || "").trim();
  const phone = (payload["手機"] || "").trim();
  const email = (payload["Email"] || "").trim();
  const intent = (payload["我想"] || "").trim();
  if (!name || !intent || (!phone && !email)) {
    return jsonResponse(
      { ok: false, error: "Missing required fields" },
      400
    );
  }

  // 4. 環境變數檢查 — 沒設就 silent-fail
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
  const budget = (payload["預算"] || "").trim();
  const propId = (payload["物件編號"] || "").trim();
  const propTitle = (payload["物件標題"] || "").trim();
  const listingDesc = (payload["物件編號或描述"] || "").trim();
  const areas = (payload["區域偏好"] || "").trim();
  const message = (payload["訊息"] || "").trim();
  const source = (payload["來源頁"] || "").trim();

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
    });
    if (!tgRes.ok) {
      const errText = await tgRes.text();
      console.error("[contact-tg] TG send failed:", tgRes.status, errText);
      return jsonResponse(
        { ok: false, error: "TG send failed", status: tgRes.status },
        500
      );
    }
  } catch (err) {
    console.error("[contact-tg] TG fetch error:", err);
    return jsonResponse({ ok: false, error: "TG fetch error" }, 500);
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
