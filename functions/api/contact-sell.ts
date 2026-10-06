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
 * 2026-09-06：坪數 / 期望總價改選填（前端同步）；加 Origin/Referer 白名單、欄位長度上限、
 * body 10KB 上限、escapeHtml 補雙引號。
 *
 * 容錯收件策略（避免賣方 lead 遺失）：
 *  - Notion + TG 是兩條獨立送達管道，不論 Notion 成敗都會試 TG。
 *  - 只要任一條成功 → 回 200 { ok:true }。
 *    （2026-10 資安加固 M-20：不再回 stored／notified——那會讓外人探出「Notion 有沒有寫成功、
 *    TG 有沒有推成功」這種內部狀態；前端也沒在讀。哪條成功只留在 Worker log。）
 *  - 兩條都失敗 → 回 200 { ok:false, degraded:true }，前端引導客戶改 LINE / 電話。
 *  - 永遠不回 500（500 會讓前端把客戶擋在外面、lead 直接掉）。
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  return false;
}

// 欄位長度上限（超過就截斷，不拒收 — 賣方 lead 寧可截也不要掉）
const FIELD_MAX: Record<string, number> = {
  "姓名": 50,
  "電話": 20,
  "Email": 120,
  "物件地址": 200,
  "坪數": 12,
  "期望總價(萬)": 12,
  "備註": 1000,
  "來源頁": 200,
};

// 真的多行的欄位（textarea）：只有「備註」。其他都是單行 input——換行會被換成空白，
// 不然有人能在「姓名」「地址」塞換行，在 TG 訊息裡偽造一整段假的通知版面（驗證者發現的殘餘風險 J）。
const MULTILINE_FIELDS = new Set(["備註"]);

// 砍控制字元、單行欄位的換行改空白、去頭尾空白、限長；非字串一律當空
function sanitize(payload: Payload): Payload {
  const out: Payload = {};
  for (const key of Object.keys(FIELD_MAX)) {
    const raw = typeof payload[key] === "string" ? payload[key] : "";
    let clean = raw.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
    if (!MULTILINE_FIELDS.has(key)) clean = clean.replace(/[\n\u0085\u2028\u2029]+/g, " ");
    clean = clean.trim();
    const max = FIELD_MAX[key];
    out[key] = clean.length > max ? clean.slice(0, max) + "…" : clean;
  }
  if (typeof payload._gotcha === "string") out._gotcha = payload._gotcha;
  if (typeof payload._loaded_at === "string") out._loaded_at = payload._loaded_at;
  return out;
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
): Promise<boolean> {
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
  lines.push(`<b>坪數</b>：${ping ? `${escapeHtml(ping)} 坪` : "未填（先聽行情評估）"}`);
  lines.push(`<b>期望</b>：${price ? `${escapeHtml(price)} 萬` : "未填（先聽行情評估）"}`);
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

  // 發送端全域上限（RT-06）：超過就不推 TG（Notion 已另外寫入，賣方線索不會因此遺失）
  const slot = takeTgSlot(Date.now());
  if (!slot.ok) {
    console.warn("[contact-sell] tg budget exceeded");
    return false;
  }
  if (slot.suppressed > 0) lines.push("", `<i>（上一分鐘另有 ${slot.suppressed} 則因為太密集被合併，疑似洗版）</i>`);
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
      return false;
    }
    return true;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[contact-sell] TG fetch error:", err);
    return false;
  }
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
    payload = sanitize(parsed as Payload);
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  // 必填驗證：只留姓名 / 電話 / 地址。坪數、期望總價選填（不確定的屋主先聽行情評估）
  // ⚠️ 順序刻意：驗證在前、honeypot／太快送出在後（驗證者發現的殘餘風險 F）——
  //    bot 送缺欄位的請求拿到跟真人一樣的 400，不能再靠「空請求回 200 還是 400」分辨自己有沒有被抓到。
  const name = (payload["姓名"] || "").trim();
  const phone = (payload["電話"] || "").trim();
  const address = (payload["物件地址"] || "").trim();

  if (!name || !phone || !address) {
    return jsonResponse(
      { ok: false, error: "Missing required fields" },
      400
    );
  }
  if (!/^[\d\s+()-]{8,20}$/.test(phone)) {
    return jsonResponse({ ok: false, error: "Invalid phone" }, 400);
  }
  const email = (payload["Email"] || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, error: "Invalid email" }, 400);
  }

  // honeypot — bot 中招就靜默吞掉（拿到跟真人一模一樣的 { ok:true }）
  if (payload._gotcha) {
    return jsonResponse({ ok: true });
  }

  // 3 秒 bot 偵測：delta 必須在 [0, 3000) 才算 spam
  // 若 delta < 0 (客戶端時鐘超前 server)，視為時鐘異常但放行，不誤判為 spam
  const loadedAt = parseInt(payload._loaded_at || "0", 10);
  if (loadedAt > 0) {
    const delta = Date.now() - loadedAt;
    if (delta >= 0 && delta < 3000) {
      return jsonResponse({ ok: true });
    }
  }

  // === 容錯收件：Notion + TG 兩條送達管道，只要一條成功就算收到 lead ===
  // 設計目標：缺 NOTION env 或 Notion 失敗時，絕不能在 TG 推播前 return，
  // 否則賣方整筆 lead 遺失。所以不論 Notion 成敗都試 TG。

  // 1. 先試 Notion（僅在有 NOTION_API_KEY + NOTION_SELL_DB_ID 才試）
  const notionKey = env.NOTION_API_KEY;
  const notionDb = env.NOTION_SELL_DB_ID;
  let notionAttempted = false;
  let notionOk = false;
  if (notionKey && notionDb) {
    notionAttempted = true;
    const notionResult = await writeToNotion(payload, notionKey, notionDb);
    notionOk = notionResult.ok;
  } else {
    console.error("[contact-sell] NOTION_API_KEY / NOTION_SELL_DB_ID 未設定");
  }

  // 2. 不論 Notion 成敗都試 TG（僅在有 CONTACT_TG_TOKEN + CONTACT_TG_CHAT 才推）
  const tgToken = env.CONTACT_TG_TOKEN;
  const tgChat = env.CONTACT_TG_CHAT;
  let tgOk = false;
  if (tgToken && tgChat) {
    tgOk = await pushTG(payload, tgToken, tgChat);
  } else {
    console.warn(
      "[contact-sell] CONTACT_TG_TOKEN / CONTACT_TG_CHAT 未設定、跳過 TG 通知"
    );
  }

  // 3. 任一管道成功就算收到 lead
  if (notionOk || tgOk) {
    console.log(`[contact-sell] delivered notion=${notionOk} tg=${tgOk}`);
    return jsonResponse({ ok: true });
  }

  // 4. 兩條都失敗：回 200 + degraded，讓前端引導客戶改 LINE / 電話（不漏 lead）
  return jsonResponse({
    ok: false,
    degraded: true,
    error: notionAttempted ? "delivery_failed" : "backend_not_configured",
  });
};

// 非 POST 方法 fallback (POST 走 onRequestPost — Cloudflare Pages Functions 規範)
export const onRequest = async (): Promise<Response> => {
  return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
};
