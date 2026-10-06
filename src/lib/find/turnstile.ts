/**
 * 人機驗證（Cloudflare Turnstile）伺服器端查驗。
 *  ok          驗證通過
 *  fail        有金鑰、查驗服務有回，但驗證沒過（或客人根本沒帶 token、或 token 是給別的網站／別的表單的）→ 呼叫端回 403
 *  unavailable 沒設金鑰，或查驗服務連不上／回怪東西 → 呼叫端一律「不轉送上游、不推 TG」（fail-closed）
 *
 * 查驗回應的 hostname／action 必須和我們預期的一致：同一把金鑰日後若被用在別的網站或別的表單，
 * 那邊拿到的 token 不能拿來通過這裡的驗證。
 *
 * 2026-10-06 紅隊修補（RT-04）：
 *  - action 改成「嚴格」：有指定預期值時，回應沒帶、帶空字串、帶別的值，一律不過（以前是「回應有帶字串才比對」，
 *    沒帶用途的別張表單的 token 反而過得了）。對應地，前端 turnstile.render 一定要帶 action:'find'，
 *    Cloudflare 才會在查驗回應裡原樣回傳它（tests 釘住前端有帶）。
 *  - 失敗時回報「為什麼」（hostname／action／被拒），呼叫端寫進泛化日誌（不含 token、金鑰、客人內容），
 *    萬一上線後真人被全擋，Functions 日誌看得到是 action 對不上，不再是「無聲失效」。
 */
export type TurnstileResult = "ok" | "fail" | "unavailable";
export type TurnstileReason = "no_token" | "rejected" | "host" | "action" | "http" | "network" | "no_secret";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_HOSTS = ["teddy-house.tw", "www.teddy-house.tw"];

export async function verifyTurnstile(opts: {
  secret: string | undefined;
  token: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  /** 預期的 action（前端 render 時帶的）；有給就嚴格比對（回應沒帶、空字串、不同都算失敗） */
  action?: string;
  /** 客人 IP（可選）：有給就一併送去查驗 */
  remoteIp?: string | null;
  /** 失敗原因回報（只給泛化代碼；呼叫端寫日誌用） */
  onReason?: (r: TurnstileReason) => void;
}): Promise<TurnstileResult> {
  const why = (r: TurnstileReason) => {
    try {
      opts.onReason?.(r);
    } catch {
      /* 日誌回呼不能影響查驗結果 */
    }
  };
  const secret = (opts.secret ?? "").trim();
  if (!secret) {
    why("no_secret");
    return "unavailable";
  }
  if (!opts.token) {
    why("no_token");
    return "fail";
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 4000);
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", opts.token);
    if (opts.remoteIp) form.set("remoteip", opts.remoteIp);
    const res = await opts.fetchImpl(VERIFY_URL, { method: "POST", body: form, signal: ctl.signal });
    if (!res.ok) {
      why("http");
      return "unavailable";
    }
    const j: unknown = await res.json();
    if (!j || typeof j !== "object" || (j as { success?: unknown }).success !== true) {
      why("rejected");
      return "fail";
    }
    const o = j as { hostname?: unknown; action?: unknown };
    if (typeof o.hostname === "string" && !TURNSTILE_HOSTS.includes(o.hostname.toLowerCase())) {
      why("host");
      return "fail";
    }
    if (opts.action && o.action !== opts.action) {
      why("action");
      return "fail";
    }
    return "ok";
  } catch {
    why("network");
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
