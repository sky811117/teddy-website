/**
 * Cloudflare Pages Function — POST /api/estimate
 *
 * 官網「密碼保護估價頁」的後端閘門 + 反向代理。
 * 估價運算不在這裡（Cloudflare 端算不了）：真正的引擎在景泰本機
 * （estimator2.py 依賴本機 CDP Chrome + 68 萬筆實登 SQLite + i智慧），
 * 這支 Function 只做兩件事：(1) 在 server 端驗密碼 (2) 過關才反代到本機。
 *
 * 資料流：
 *   瀏覽器 POST {password, addr} → 本 Function 驗 env.ESTIMATE_GATE_PASSWORD
 *   → 過關 → fetch 本機 Tailscale Funnel（帶 shared secret header）→ 回傳估價 JSON
 *
 * 所需環境變數（Cloudflare Pages → Settings → Environment variables）：
 *   - ESTIMATE_GATE_PASSWORD   官網密碼（值只設在 CF 環境變數，絕不寫進 source）。
 *                              只在此 server 端比對，不進 client bundle / 不進 public source。
 *   - ESTIMATE_UPSTREAM_URL    本機估價 API 的 Funnel 網址，例：
 *                              https://teddy-pc.tailxxxx.ts.net/api/estimate
 *   - ESTIMATE_UPSTREAM_SECRET 打本機 API 的 shared secret（= estimate_api.py 的
 *                              ESTIMATE_UPSTREAM_SECRET，兩邊要一致）
 *
 * 沒設環境變數 → 對應狀態碼 + 友善 reason，前端顯示對應訊息、不炸紅字。
 */

interface Env {
  ESTIMATE_GATE_PASSWORD?: string;
  ESTIMATE_UPSTREAM_URL?: string;
  ESTIMATE_UPSTREAM_SECRET?: string;
}

type EventContext = {
  request: Request;
  env: Env;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 內部工具，永不進搜尋引擎
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}

export const onRequestPost = async ({
  request,
  env,
}: EventContext): Promise<Response> => {
  let body: { password?: string; addr?: string; verify?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ ok: false, reason: "invalid_json" }, 400);
  }

  // 1. 密碼閘（server 端比對，瀏覽器看不到答案；密碼只活在 CF 環境變數）
  if (!env.ESTIMATE_GATE_PASSWORD) {
    return jsonResponse({ ok: false, reason: "gate_not_configured" }, 503);
  }
  const pw = (body.password || "").trim();
  if (pw !== env.ESTIMATE_GATE_PASSWORD) {
    // 密碼錯誤固定延遲 1.5s：零基建的等效 rate limit，把單線字典暴力壓到 <1 req/s。
    // （pages.dev 用不了 WAF Rate Limiting Rules；要更硬可另加 CF KV 計數或 Turnstile）
    await new Promise(r => setTimeout(r, 1500));
    return jsonResponse({ ok: false, reason: "wrong_password" }, 401);
  }

  // 2. 只驗密碼（前端「解鎖」用）→ 不打本機
  if (body.verify) {
    return jsonResponse({ ok: true, authed: true });
  }

  // 3. 估價：反代到本機 Funnel
  const addr = (body.addr || "").trim();
  if (!addr) {
    return jsonResponse({ ok: false, reason: "addr_required" }, 400);
  }
  if (!env.ESTIMATE_UPSTREAM_URL || !env.ESTIMATE_UPSTREAM_SECRET) {
    // 上游沒設好 = 等同主機離線，給前端友善訊息
    return jsonResponse({ ok: false, offline: true, reason: "upstream_not_configured" });
  }

  try {
    const u = new URL(env.ESTIMATE_UPSTREAM_URL);
    u.searchParams.set("addr", addr);
    const upstream = await fetch(u.toString(), {
      headers: { "X-Estimate-Secret": env.ESTIMATE_UPSTREAM_SECRET },
      // 非快取首次抓樂居要 30-60 秒；給足時間，逾時視同主機離線
      signal: AbortSignal.timeout(60000),
    });
    const text = await upstream.text();
    // 透傳本機回的 JSON（本機 estimate_api 已組好 {ok,text,community,...}）
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
      },
    });
  } catch {
    // 逾時 / 連不上 = 本機關機、登出、9222 掛了、Funnel 沒開
    return jsonResponse({ ok: false, offline: true, reason: "estimate_host_offline" });
  }
};

// 非 POST 一律擋掉
export const onRequest = async ({
  request,
}: EventContext): Promise<Response> => {
  if (request.method === "POST") {
    return jsonResponse({ ok: false, reason: "unexpected" }, 500);
  }
  return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405);
};
