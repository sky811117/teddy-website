/**
 * 買方（ContactForm → /api/contact-tg）／賣方（SellForm → /api/contact-sell）聯絡表單的人機驗證（Cloudflare Turnstile）。
 * 2026-10-17 資安自查第 1 項：兩支後端改成 fail-closed 查驗 Turnstile，沒有 token 一律不推 TG、不寫 Notion。
 *
 * 照 /find/ 的做法（public/js/find-app.js 的 ensureTurnstile）：
 *  - site key 在執行期向後端取：GET 表單自己的端點 → { turnstileSiteKey }（跟 /api/find/config 同一個 TURNSTILE_SITE_KEY，
 *    同一道 publicSiteKey 格式過濾；不必重新建置）
 *  - script 一樣是 https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit，只在客人開始填表時才載入（不拖慢頁面）
 *  - appearance: 'interaction-only'（平常看不到；Cloudflare 覺得要確認時才在送出鈕上方出現勾選框）
 *  - token 用 JSON 的 `turnstile` 欄位送出（跟 /api/find/* 同名）；一個 token 只能用一次，每次送出後 reset()
 *  - 'response-field': false：不讓 Turnstile 自己往表單塞 cf-turnstile-response 隱藏欄位（不然會混進 FormData、跟著送去 Formspree）
 * 載不到（擋廣告外掛擋掉、網路斷、後台沒設 site key）時 getToken 回 { token: "", fail }，由表單顯示明確提示＋備援面板，不靜默失敗。
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  reset: (id?: string) => void;
};

export type TurnstileFail =
  | "no_site_key" // 後端沒給 site key（後台沒設、或格式不對）
  | "load_failed" // 取 site key 或載入 Cloudflare 驗證程式失敗（網路、擋廣告外掛）
  | "widget_error" // 驗證框本身回報錯誤
  | "timeout"; // 等太久還沒拿到 token

export type TokenResult = {
  token: string;
  fail: TurnstileFail | null;
  /** 驗證框正在等客人動手（勾選框已經出現） */
  needsClick: boolean;
};

export interface ContactTurnstile {
  /** 開始準備（取 site key → 載 script → render）。重複呼叫無害；上次載入失敗會重試 */
  prepare(): void;
  /** 等 token，最多 ms 毫秒 */
  getToken(ms: number): Promise<TokenResult>;
  /** token 送出過一次就作廢：每次送出後呼叫，重置驗證框拿新的 */
  reset(): void;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY_RE = /^[0-9A-Za-z_-]{6,80}$/;

function api(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

// 同一頁兩張表單（/contact/ 同時輸出買方與賣方表單）共用同一支 script
let scriptPromise: Promise<TurnstileApi> | null = null;
function loadScript(): Promise<TurnstileApi> {
  const ready = api();
  if (ready) return Promise.resolve(ready);
  if (scriptPromise) return scriptPromise;
  const p = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      const t = api();
      if (t) resolve(t);
      else reject(new Error("turnstile api missing"));
    };
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  });
  scriptPromise = p;
  p.catch(() => {
    if (scriptPromise === p) scriptPromise = null; // 下次 prepare() 再試
  });
  return p;
}

async function fetchSiteKey(endpoint: string): Promise<string | null> {
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("site key http " + res.status);
  const j = (await res.json()) as { turnstileSiteKey?: unknown };
  const k = j.turnstileSiteKey;
  return typeof k === "string" && SITE_KEY_RE.test(k) ? k : null;
}

export function setupContactTurnstile(opts: {
  /** 放驗證框的容器（表單裡、送出鈕上方） */
  box: HTMLElement;
  /** 表單的後端端點（同時提供 GET 取 site key） */
  endpoint: string;
  /** 跟後端 TS_ACTION 一致：contact-buy／contact-sell */
  action: string;
}): ContactTurnstile {
  const { box, endpoint, action } = opts;
  let state: "idle" | "loading" | "ready" | "failed" = "idle";
  let fail: TurnstileFail | null = null;
  let token = "";
  let widgetId: string | null = null;
  let needsClick = false;
  const waiters = new Set<() => void>();
  const notify = () => waiters.forEach(w => w());

  function hardFail(f: TurnstileFail) {
    state = "failed";
    fail = f;
    token = "";
    notify();
  }

  function resetWidget() {
    token = "";
    const t = api();
    if (t && widgetId !== null) {
      try {
        t.reset(widgetId);
      } catch {
        /* ignore */
      }
    }
  }

  function render(t: TurnstileApi, siteKey: string) {
    try {
      const id = t.render(box, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        "response-field": false,
        callback: (tok: string) => {
          token = typeof tok === "string" ? tok : "";
          fail = null;
          needsClick = false;
          notify();
        },
        "error-callback": () => {
          // 驗證框自己會照 retry:auto 重試；先記下來，等太久還是沒 token 時用來說明原因
          token = "";
          fail = "widget_error";
          notify();
          return true;
        },
        "expired-callback": () => resetWidget(),
        "timeout-callback": () => resetWidget(),
        "before-interactive-callback": () => {
          needsClick = true;
          box.classList.add("mb-4");
          notify();
        },
        "after-interactive-callback": () => {
          needsClick = false;
        },
        // 瀏覽器太舊、Turnstile 不支援：直接當載入失敗（表單改顯示備援）
        "unsupported-callback": () => hardFail("widget_error"),
      });
      widgetId = typeof id === "string" ? id : null;
      if (widgetId === null) {
        hardFail("widget_error");
        return;
      }
      state = "ready";
      notify();
    } catch {
      hardFail("widget_error");
    }
  }

  function prepare() {
    if (state === "loading" || state === "ready") return;
    if (state === "failed" && fail === "no_site_key") return; // 後端明說沒有 site key：重試也一樣
    state = "loading";
    fail = null;
    fetchSiteKey(endpoint)
      .then(siteKey => {
        if (!siteKey) {
          hardFail("no_site_key");
          return;
        }
        return loadScript().then(
          t => render(t, siteKey),
          () => hardFail("load_failed")
        );
      })
      .catch(() => hardFail("load_failed"));
  }

  function getToken(ms: number): Promise<TokenResult> {
    prepare();
    return new Promise(resolve => {
      const done = (r: TokenResult) => {
        clearTimeout(timer);
        waiters.delete(check);
        resolve(r);
      };
      const check = () => {
        if (token) done({ token, fail: null, needsClick: false });
        else if (state === "failed") done({ token: "", fail, needsClick: false });
      };
      const timer = setTimeout(
        () => done({ token: "", fail: fail ?? "timeout", needsClick }),
        ms
      );
      waiters.add(check);
      check();
    });
  }

  return {
    prepare,
    getToken,
    reset: resetWidget,
  };
}

/** 給客人看的提示（拿不到 token 時）。needsClick＝驗證框在等客人勾選；其他＝載入失敗，要搭配備援面板 */
export function turnstileHint(r: TokenResult): string {
  if (r.needsClick) return "請先完成送出鈕上方的安全驗證（勾一下），再按一次送出。";
  return "安全驗證沒有載入成功（可能是網路不穩，或瀏覽器的擋廣告外掛擋掉了 Cloudflare 驗證），所以訊息還沒送出。請重新整理再試一次，或用下面的「複製訊息」直接傳 LINE 給景泰。";
}
