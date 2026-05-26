/**
 * Cloudflare Pages Functions — POST /api/contact-sell
 *
 * 接 SellForm 送來的賣房客戶 JSON：
 *  1. 寫入 Notion DB「賣房客戶名單」(NOTION_SELL_DB_ID)
 *  2. 推 TG 通知到「泰迪的小聲音」(reuse CONTACT_TG_TOKEN / CONTACT_TG_CHAT)
 *
 * 跟既有 /api/contact-tg 分開，因為買方 vs 賣方寫入的 DB / 欄位不一樣。
 *
 * 所需環境變數（Cloudflare Pages → Settings → Environment variables）:
 *  - NOTION_API_KEY       Notion integration secret (secret_xxx 開頭)
 *  - NOTION_SELL_DB_ID    賣房客戶名單 DB ID (385edd7c-9dc3-438b-9452-8327d4166255)
 *  - CONTACT_TG_TOKEN     Telegram bot token（reuse contact-tg）
 *  - CONTACT_TG_CHAT      Telegram chat_id
 *
 * 任一環境變數缺失時：對應 side effect 跳過、不擋表單成功回應。
 *  - Notion 失敗：回 500（這是主要儲存、不能掉資料）
 *  - TG 失敗：log + 繼續（次要通知、不擋）
 */

interface Env {
  NOTION_API_KEY?: string;
  NOTION_SELL_DB_ID?: string;
  CONTACT_TG_TOKEN?: string;
  CONTACT_TG_CHAT?: string;
}

type EventContext = {
  request: Request;
  env: Env;
};

type Payload = Record<string, string>;

const NOTION_VERSION = "2022-06-28";
const RICH_TEXT_MAX = 2000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function richText(content: string) {
  const trimmed = content.length > RICH_TEXT_MAX
    ? content.slice(0, RICH_TEXT_MAX - 1) + "…"
    : content;
  return [{ type: "text", text: { content: trimmed } }];
}

async function writeToNotion(
  payload: Payload,
  apiKey: string,
  dbId: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const name = (payload["姓名"] || "").trim();
  const phone = (payload["電話"] || "").trim();
  const email = (payload["Email"] || "").trim();
  const address = (payload["物件地址"] || "").trim();
  const pingRaw = (payload["坪數"] || "").trim();
  const priceRaw = (payload["期望總價(萬)"] || "").trim();
  const note = (payload["備註"] || "").trim();
  const source = (payload["來源頁"] || "").trim();

  const ping = parseFloat(pingRaw);
  const price = parseFloat(priceRaw);

  const properties: Record<string, unknown> = {
    "姓名": { title: richText(name) },
    "電話": { phone_number: phone },
    "物件地址": { rich_text: richText(address) },
    "坪數": { number: isNaN(ping) ? null : ping },
    "期望總價(萬)": { number: isNaN(price) ? null : price },
    "狀態": { select: { name: "新進" } },
  };
  if (email) properties["Email"] = { email };
  if (note) properties["備註"] = { rich_text: richText(note) };
  if (source) properties["來源頁"] = { rich_text: richText(source) };

  const body = {
    parent: { database_id: dbId },
    properties,
  };

  // 5 秒 timeout 避免卡到 Cloudflare worker 10 秒上限
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[contact-sell] Notion write failed:", res.status, errText);
      return { ok: false, status: res.status, error: errText.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[contact-sell] Notion fetch error:", err);
    return { ok: false, error: String(err) };
  }
}

async function pushTG(
  payload: Payload,
  token: string,
  chatId: string,
  timeoutMs = 3000
): Promise<void> {
  const name = (payload["姓名"] || "").trim();
  const phone = (payload["電話"] || "").trim();
  const email = (payload["Email"] || "").trim();
  const address = (payload["物件地址"] || "").trim();
  const ping = (payload["坪數"] || "").trim();
  const price = (payload["期望總價(萬)"] || "").trim();
  const note = (payload["備註"] || "").trim();
  const source = (payload["來源頁"] || "").trim();

  const lines: string[] = [
    `🏡 <b>新賣房委託詢價</b>`,
    "",
    `<b>姓名</b>：${escapeHtml(name)}`,
  ];
  if (phone) {
    const phoneClean = phone.replace(/[^\d+]/g, "");
    lines.push(`<b>電話</b>：<a href="tel:${phoneClean}">${escapeHtml(phone)}</a>`);
  }
  if (email) {
    lines.push(`<b>Email</b>：<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  lines.push(`<b>地址</b>：${escapeHtml(address)}`);
  lines.push(`<b>坪數</b>：${escapeHtml(ping)} 坪`);
  lines.push(`<b>期望</b>：${escapeHtml(price)} 萬`);
  if (note) {
    lines.push("");
    lines.push(`<b>備註</b>：\n${escapeHtml(note)}`);
  }
  if (source) {
    lines.push("");
    lines.push(`<i>來源</i>：${escapeHtml(source)}`);
  }
  lines.push("");
  lines.push("📝 已寫入 Notion「賣房客戶名單」");

  const text = lines.join("\n");
  const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(tgUrl, {
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
    if (!res.ok) {
      const errText = await res.text();
      console.error("[contact-sell] TG send failed:", res.status, errText);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[contact-sell] TG fetch error:", err);
  }
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

  // honeypot
  if (payload._gotcha) {
    return jsonResponse({ ok: true, spam: true });
  }

  // 3 秒 bot 偵測：delta 必須在 [0, 3000) 才算 spam
  // 若 delta < 0 (客戶端時鐘超前 server)，視為時鐘異常但放行，不誤判為 spam
  const loadedAt = parseInt(payload._loaded_at || "0", 10);
  if (loadedAt > 0) {
    const delta = Date.now() - loadedAt;
    if (delta >= 0 && delta < 3000) {
      return jsonResponse({ ok: true, spam: true });
    }
  }

  // 必填驗證
  const name = (payload["姓名"] || "").trim();
  const phone = (payload["電話"] || "").trim();
  const address = (payload["物件地址"] || "").trim();
  const pingRaw = (payload["坪數"] || "").trim();
  const priceRaw = (payload["期望總價(萬)"] || "").trim();

  if (!name || !phone || !address || !pingRaw || !priceRaw) {
    return jsonResponse(
      { ok: false, error: "Missing required fields" },
      400
    );
  }

  // Notion 必設
  const notionKey = env.NOTION_API_KEY;
  const notionDb = env.NOTION_SELL_DB_ID;
  if (!notionKey || !notionDb) {
    console.error("[contact-sell] NOTION_API_KEY / NOTION_SELL_DB_ID 未設定");
    return jsonResponse(
      { ok: false, error: "Backend not configured" },
      500
    );
  }

  const notionResult = await writeToNotion(payload, notionKey, notionDb);
  if (!notionResult.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Notion write failed",
        status: notionResult.status,
      },
      500
    );
  }

  // TG 推播：失敗不影響主流程
  const tgToken = env.CONTACT_TG_TOKEN;
  const tgChat = env.CONTACT_TG_CHAT;
  if (tgToken && tgChat) {
    await pushTG(payload, tgToken, tgChat);
  } else {
    console.warn(
      "[contact-sell] CONTACT_TG_TOKEN / CONTACT_TG_CHAT 未設定、跳過 TG 通知"
    );
  }

  return jsonResponse({ ok: true });
};

// 非 POST 方法 fallback (POST 走 onRequestPost — Cloudflare Pages Functions 規範)
export const onRequest = async (): Promise<Response> => {
  return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
};
