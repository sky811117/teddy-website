/**
 * Cloudflare Pages Function — GET /api/garbage-live
 *
 * 台中垃圾車／資源回收車「大約位置」代理（給 /tools/ 垃圾車查詢頁的「附近垃圾車」用）。
 *
 * 上游：臺中市政府環境保護局「臺中市垃圾清運及資源回收車動態資訊」（政府資料開放平臺 83558，
 *   政府資料開放授權條款-第1版）
 *   https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=c923ad20-2ec6-43b9-b3ab-54527e99f7bc
 *   - 官方每 10 分鐘更新一次快照；2026-09-29 實測最新一筆比下載時間早約 11 分鐘
 *     → 位置會落後 10～20 分鐘，頁面一律寫「約 N 分鐘前的位置」，不要寫「即時」
 *   - 約 663 台、110KB；上游回應要 ~10 秒（即時轉檔）
 *   - 上游沒有「垃圾車／資收車」欄位；頁面拿 /data/garbage/routes.json 的車牌去對，對得到的是垃圾車路線
 *   - 車牌是官方開放資料原文（清運點資料也公開車牌），所以照樣保留，頁面才對得上路線
 *
 * 為什麼要代理：上游 10 秒太慢，訪客多時等於每個人都去敲政府主機；這支統一抓、快取 60 秒。
 *
 * 隱私：**不收任何參數**（query string 一律忽略），訪客位置不會送到伺服器；
 *       頁面拿整份資料在瀏覽器自己算距離、篩附近的車。
 *
 * 回應 200：
 * {
 *   ok: true,
 *   snapshot: "2026-09-29T18:39:37+08:00", // 上游資料裡最新一筆回報時間（台灣時間）
 *   fetchedAt: "2026-09-29T10:51:16.000Z", // 這支最後一次成功抓上游的時間（UTC）
 *   stale: false,                          // true = 手上資料超過 3 分鐘沒更新成功（上游可能抓不到）；最舊回到 15 分鐘前抓的
 *   count: 544,
 *   cars: [[車牌, 經度, 緯度, "HH:MM", 時速, 位置描述, 比snapshot早幾分鐘], ...]
 * }
 * 只留：最新快照前 30 分鐘內有回報、座標在台中範圍內的車。
 *   「最新快照」只看時間不在未來（容許 5 分鐘）、座標在台中的列 —— GPS 時鐘錯成未來的那筆不會把其他車全濾掉。
 * 上游抓不到又沒有可用的舊資料 → 503 { ok:false, error:"upstream_unavailable", cars:[] }
 * HEAD 回跟 GET 一樣的狀態與標頭（不帶內容）；其他 method 405。
 * （頁面顯示「附近垃圾車位置暫時無法取得」，班表功能照常，不要擋住）
 *
 * 快取（Cloudflare Pages 上 CDN 不會自動快取 Function 的回應）：
 *   1. isolate 記憶體：60 秒內直接回；60 秒～15 分鐘先回舊的、背景（waitUntil）再抓一次新的
 *   2. caches.default：只在自訂網域才有作用（*.pages.dev 上是 no-op，無害），給剛啟動的 isolate 用
 *   3. 同一個 isolate 同時只會有一個背景更新；冷啟動時才會讓請求自己等上游（最多 25 秒）
 *   4. 回應帶 Cache-Control: public, max-age=60（瀏覽器端）
 */

const UPSTREAM =
  "https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=c923ad20-2ec6-43b9-b3ab-54527e99f7bc";
const FRESH_MS = 60_000; // 60 秒內直接用記憶體快取
const STALE_MAX_MS = 15 * 60_000; // 上游抓不到時，15 分鐘內的舊資料還能回（標 stale）
const STALE_FLAG_MS = 3 * 60_000; // 快取超過 3 分鐘還沒更新成功 → 標 stale:true
const KEEP_WINDOW_MIN = 30; // 只留最新快照前 30 分鐘內有回報的車（其餘是收班或 GPS 沒回，有的停在一年前）
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_UPSTREAM_BYTES = 5_000_000;
const CACHE_KEY = "https://cache.internal/api/garbage-live/v1";

type Raw = {
  lineid?: string;
  car?: string;
  time?: string; // "20260929T183937"（台灣時間）
  location?: string;
  X?: string | number;
  Y?: string | number;
  SpeedValue?: string | number;
  OverSpeed?: string;
};

// [車牌, 經度, 緯度, "HH:MM", 時速, 位置描述, 比 snapshot 早幾分鐘]
type Car = [string, number, number, string, number, string, number];

type Payload = {
  ok: boolean;
  snapshot: string | null;
  fetchedAt: string;
  stale: boolean;
  count: number;
  cars: Car[];
};

type EventContext = {
  request: Request;
  waitUntil: (p: Promise<unknown>) => void;
};

type CacheStorageWithDefault = { default?: Cache };

let memo: { at: number; body: Payload } | null = null;
let refreshStartedAt = 0; // 背景更新開始時間（0 = 沒有在跑）；卡住超過 REFRESH_GUARD_MS 就允許重來
const REFRESH_GUARD_MS = 40_000;

function edgeCache(): Cache | undefined {
  const c = (globalThis as unknown as { caches?: CacheStorageWithDefault }).caches;
  return c?.default;
}

/** "20260929T183937"（UTC+8）→ epoch ms */
function tpeTimeToMs(t: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(t || "");
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
}

function toTpeIso(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

const FUTURE_SLACK_MS = 5 * 60_000; // 回報時間比現在晚超過 5 分鐘 → GPS 時鐘錯了，不採用

function inTaichung(lng: number, lat: number): boolean {
  return lng > 120.4 && lng < 121.5 && lat > 23.95 && lat < 24.5;
}

/** 上游原始陣列 → 精簡回應（純函式；同一台車只留最新一筆） */
function slim(rows: Raw[], fetchedAt: number): Payload {
  // 只用「時間不在未來、座標在台中」的列來算最新快照時間：
  // 上游只要有一筆 GPS 時鐘錯成未來（例 2027 年），newest 就會被拉走，其他車全被 30 分鐘窗口濾掉
  const sorted = rows
    .map((r) => ({ r, ms: tpeTimeToMs(String(r.time || "")), lng: Number(r.X), lat: Number(r.Y) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms <= fetchedAt + FUTURE_SLACK_MS && inTaichung(x.lng, x.lat))
    .sort((a, b) => b.ms - a.ms); // 新的在前：同一台車若出現兩筆，只留最新那筆
  const newest = sorted.length ? sorted[0].ms : NaN;
  const cars: Car[] = [];
  const seen = new Set<string>();
  for (const { r, ms, lng, lat } of sorted) {
    if (newest - ms > KEEP_WINDOW_MIN * 60_000) continue;
    const plate = String(r.car || "").trim().slice(0, 12);
    if (!plate || seen.has(plate)) continue;
    seen.add(plate);
    const t = String(r.time).slice(9);
    cars.push([
      plate,
      Math.round(lng * 1e5) / 1e5,
      Math.round(lat * 1e5) / 1e5,
      `${t.slice(0, 2)}:${t.slice(2, 4)}`,
      Math.max(0, Math.round(Number(r.SpeedValue) || 0)),
      String(r.location || "")
        .replace(/[\u0000-\u001f]/g, "")
        .slice(0, 40),
      Math.round((newest - ms) / 60_000),
    ]);
  }
  return {
    ok: true,
    snapshot: Number.isFinite(newest) ? toTpeIso(newest) : null,
    fetchedAt: new Date(fetchedAt).toISOString(),
    stale: false,
    count: cars.length,
    cars,
  };
}

async function fetchUpstream(): Promise<Payload> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(UPSTREAM, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_UPSTREAM_BYTES) throw new Error("upstream too large");
    const rows = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("upstream empty");
    const body = slim(rows as Raw[], Date.now());
    if (body.count === 0) throw new Error("no recent cars");
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** 成功抓到就更新記憶體快取＋邊緣快取（回傳的 promise 會等 cache.put 完成） */
async function store(body: Payload): Promise<Payload> {
  memo = { at: Date.now(), body };
  const cache = edgeCache();
  if (cache) {
    await cache
      .put(
        new Request(CACHE_KEY),
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=900" },
        })
      )
      .catch(() => undefined);
  }
  return body;
}

/**
 * 背景更新：同一個 isolate 同時只跑一個。
 * 不讓別的請求 await 這個 promise —— Workers 不支援跨請求等同一個 I/O promise（可能卡住），
 * 所以其他請求只看旗標、直接回舊資料。
 */
function backgroundRefresh(ctx: EventContext): void {
  const now = Date.now();
  if (refreshStartedAt && now - refreshStartedAt < REFRESH_GUARD_MS) return;
  refreshStartedAt = now;
  ctx.waitUntil(
    fetchUpstream()
      .then(store)
      .catch(() => undefined)
      .finally(() => {
        refreshStartedAt = 0;
      })
  );
}

function jsonResponse(body: Payload | { ok: false; error: string; cars: [] }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=60" : "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

function fromMemo(now: number): Response {
  const m = memo as { at: number; body: Payload };
  return jsonResponse({ ...m.body, stale: now - m.at > STALE_FLAG_MS });
}

export const onRequestGet = async (ctx: EventContext): Promise<Response> => {
  const now = Date.now();

  // 1. 記憶體快取還新鮮
  if (memo && now - memo.at < FRESH_MS) return fromMemo(now);

  // 2. 記憶體有、但超過 60 秒：先回舊的，背景更新（上游 10 秒，別讓訪客等）
  if (memo && now - memo.at < STALE_MAX_MS) {
    backgroundRefresh(ctx);
    return fromMemo(now);
  }

  // 3. 剛啟動的 isolate：先看邊緣快取（自訂網域才有）
  if (!memo) {
    const cache = edgeCache();
    if (cache) {
      const hit = await cache.match(new Request(CACHE_KEY)).catch(() => undefined);
      if (hit) {
        try {
          const body = (await hit.json()) as Payload;
          const at = Date.parse(body.fetchedAt);
          if (body.ok && Number.isFinite(at) && now - at < STALE_MAX_MS) {
            memo = { at, body };
            if (now - at >= FRESH_MS) backgroundRefresh(ctx);
            return fromMemo(now);
          }
        } catch {
          // 壞掉的快取當沒有
        }
      }
    }
  }

  // 4. 沒有可用的快取：這個請求自己等上游（只有冷啟動或斷線超過 15 分鐘才會走到）
  try {
    return jsonResponse(await store(await fetchUpstream()));
  } catch {
    return jsonResponse({ ok: false, error: "upstream_unavailable", cars: [] }, 503);
  }
};

// HEAD：Pages Functions 不會自動把 HEAD 交給 onRequestGet → 自己接（curl -I 驗收用），回同樣的狀態與標頭、不帶內容
export const onRequestHead = async (ctx: EventContext): Promise<Response> => {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
};

// 其他 method 一律 405
export const onRequest = async (): Promise<Response> =>
  new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "GET, HEAD" },
  });
