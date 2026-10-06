/**
 * 找房小幫手的同源端點邏輯（functions/api/find/*.ts 只是薄包裝）。
 *
 * Function 只做五件事：驗證（同源、大小、格式、人機）→ 用白名單欄位重組 → HMAC 簽章轉送 → 把回應重新組成白名單格式
 * → 轉送失敗就降級收件（直送 TG，不丟線索）。它沒有任何跨請求的狀態（沒有 KV），限流、快取、斷路器、事件全放家用機。
 *
 * 零痕跡規則：回應只含 4.0 通則的白名單鍵；所有給客人看的字都來自 errors.ts 的固定表；
 * 不透傳上游的標頭、文字或錯誤；日誌只記泛化代碼，不記本文。
 */
import { hmacHex, ipHash, signRequest, uaKind } from "./canon";
import { DEGRADE_LOST_MSG, DEGRADE_MSG, DEGRADE_MSG_CONTACT, ERR, POLL_MS, STAGE_OF, STATUS_MSG } from "./errors";
import type { DegradeKind, ErrCode } from "./errors";
import { formatContactLead, formatLead } from "./leadfmt";
import { originAllowed, sameOriginGet } from "./origin";
import {
  CONSENT_V, DEGRADE_KINDS, HINTS, JOB_ID_RE, MISSING_CODES, QUESTION_IDS, SHARE_URL_RE, isObj, validateContactBody,
  validateEventBatch, validateFeedback, validateSubmit,
} from "./schema";
import type { SubmitClean } from "./schema";
import { verifyTurnstile } from "./turnstile";

/** 前端 render 人機驗證時帶的 action（伺服器端查驗會比對；同一把金鑰被別處重用時，別處的 token 通不過這裡） */
const TS_ACTION = "find";

export interface Env {
  FIND_ENABLED?: string;
  FIND_UPSTREAM_URL?: string;
  FIND_HMAC_SECRET?: string;
  FIND_IP_SALT?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  /** 找房線索專用的 Telegram bot／聊天室（RT-06）。兩個都有才用；沒設就沿用 CONTACT_TG_*（舊表單與 /go/line 也用的那組） */
  FIND_TG_TOKEN?: string;
  FIND_TG_CHAT?: string;
  CONTACT_TG_TOKEN?: string;
  CONTACT_TG_CHAT?: string;
}
export type FindCtx = { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void };
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}
export const realDeps = (): Deps => ({ fetch: (...a) => fetch(...a), now: () => Date.now() });

/** 4.0 通則：回應鍵白名單。任何不在表內的鍵一律不輸出。 */
export const RESPONSE_KEYS = [
  "ok", "v", "status", "stage", "msg", "kind", "jobId", "queue", "shareUrl", "count", "hint", "pollMs", "saved", "missing",
  "ask", "code", "mode", "turnstileSiteKey", "needMax", "consentV", "tplV", "retry", "evt",
  "diag",   // 2026-10-07：送不出去時的失敗種類短代碼（例如 tg-h403），只由本檔產生，不轉傳上游的任何東西
] as const;
const KEYSET = new Set<string>(RESPONSE_KEYS);

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};

export function jsonRes(body: Record<string, unknown>, status = 200): Response {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (KEYSET.has(k)) safe[k] = v;
  return new Response(JSON.stringify(safe), { status, headers: BASE_HEADERS });
}

export function errRes(code: ErrCode): Response {
  const e = ERR[code];
  if (code === "E_METHOD") return new Response(null, { status: 405, headers: { ...BASE_HEADERS, allow: "GET, POST" } });
  return jsonRes({ ok: false, v: 1, code, msg: e.msg, retry: e.retry }, e.http);
}

const methodNotAllowed = () => errRes("E_METHOD");

/** 環境變數去頭尾空白：在 Cloudflare 後台貼金鑰時常帶到換行，簽章整個對不上，公開入口會無聲地全部降級。 */
const envStr = (v: string | undefined): string => (v ?? "").trim();

/* ---------- 讀本文 ---------- */
async function readJson(request: Request, maxBytes: number): Promise<{ value?: unknown; err?: ErrCode }> {
  const len = parseInt(request.headers.get("content-length") || "0", 10);
  if (len > maxBytes) return { err: "E_TOO_LARGE" };
  let buf: ArrayBuffer;
  try {
    buf = await request.arrayBuffer();
  } catch {
    return { err: "E_BAD_REQUEST" };
  }
  if (buf.byteLength > maxBytes) return { err: "E_TOO_LARGE" };
  try {
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf)) };
  } catch {
    return { err: "E_BAD_REQUEST" };
  }
}

/* ---------- 轉送給家用機（簽章；只在伺服器端發生） ---------- */
type Forwarded =
  | { kind: "ok"; status: number; json: unknown }
  | { kind: "down"; cls: "unconfigured" | "timeout" | "network" | "bad_json" | "http_5xx" };

function upstreamBase(env: Env): URL | null {
  const raw = envStr(env.FIND_UPSTREAM_URL);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * 查詢功能「設定完成」：總開關＋上游網址＋簽章金鑰＋IP 雜湊鹽都要有。缺任何一個一律當收件模式（fail-closed）。
 * 缺鹽的後果很大：家用機會把所有人歸進同一個防灌爆桶，一個機器人就能讓所有真人收到「操作太頻繁」。
 */
export function liveReady(env: Env): boolean {
  return env.FIND_ENABLED === "1" && !!upstreamBase(env) && envStr(env.FIND_HMAC_SECRET).length >= 16 && envStr(env.FIND_IP_SALT).length >= 8;
}

async function forward(env: Env, deps: Deps, method: "GET" | "POST", pathQs: string, payload: unknown, timeoutMs: number): Promise<Forwarded> {
  const base = upstreamBase(env);
  const secret = envStr(env.FIND_HMAC_SECRET);
  if (!base || !secret) return { kind: "down", cls: "unconfigured" };
  const bodyBytes = method === "POST" ? new TextEncoder().encode(JSON.stringify(payload)) : null;
  const signed = await signRequest({ secret, method, pathQs, body: bodyBytes, now: deps.now() });
  const headers: Record<string, string> = { ...signed.headers };
  if (bodyBytes) headers["content-type"] = "application/json";
  const url = base.origin + pathQs;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await deps.fetch(url, { method, headers, body: bodyBytes as BodyInit | null, signal: ctl.signal, redirect: "manual" });
    if (res.status >= 500) return { kind: "down", cls: "http_5xx" };
    const text = await res.text();
    if (text.length > 65536) return { kind: "down", cls: "bad_json" };
    if (!text) return { kind: "ok", status: res.status, json: null };
    try {
      return { kind: "ok", status: res.status, json: JSON.parse(text) };
    } catch {
      return { kind: "down", cls: "bad_json" };
    }
  } catch (e) {
    return { kind: "down", cls: (e as { name?: string })?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

function logFail(where: string, cls: string): void {
  // 只記泛化代碼：不記本文、不記上游回應、不記網址
  console.warn(`find:${where}_fail:${cls}`);
}

/* ---------- 降級收件：直送 TG ---------- */
/** 找房線索要用哪一組 Telegram：專用的 FIND_TG_*（兩個都有才算）優先，否則沿用 CONTACT_TG_*。 */
export function tgTarget(env: Env): { token: string; chat: string } {
  const ft = envStr(env.FIND_TG_TOKEN);
  const fc = envStr(env.FIND_TG_CHAT);
  if (ft && fc) return { token: ft, chat: fc };
  return { token: envStr(env.CONTACT_TG_TOKEN), chat: envStr(env.CONTACT_TG_CHAT) };
}

/** BotFather 給的機器人金鑰長這樣：數字＋冒號＋一串英數（2026-10-07 實測 tg-h404＝金鑰格式不對）。 */
const TG_TOKEN_RE = /(\d{5,12}:[A-Za-z0-9_-]{30,60})/;

/**
 * 後台貼錯的常見樣子自動修正：前面多了 bot、整串 https://api.telegram.org/bot…/ 網址、前後引號或空白、
 * 金鑰與聊天編號兩格貼反。挑得出正確格式就用挑出來的；挑不出來就照原樣用（Telegram 會回 404，畫面顯示代碼）。
 */
export function tgPair(rawToken: string, rawChat: string): { token: string; chat: string } {
  const unq = (s: string) => s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  let t = unq(rawToken), c = unq(rawChat);
  if (!TG_TOKEN_RE.test(t) && TG_TOKEN_RE.test(c) && /^-?\d{3,20}$/.test(t)) [t, c] = [c, t];   // 兩格貼反
  const m = TG_TOKEN_RE.exec(t);
  return { token: m ? m[1] : t.replace(/^bot(?=\d)/i, ""), chat: c };
}

type TgTarget = { token: string; chat: string; who: "f" | "c" };

function tgTargetsLabeled(env: Env): TgTarget[] {
  const out: TgTarget[] = [];
  const ft = envStr(env.FIND_TG_TOKEN), fc = envStr(env.FIND_TG_CHAT);
  const ct = envStr(env.CONTACT_TG_TOKEN), cc = envStr(env.CONTACT_TG_CHAT);
  const a = ft && fc ? tgPair(ft, fc) : null;
  const b = ct && cc ? tgPair(ct, cc) : null;
  if (a) out.push({ ...a, who: "f" });
  if (b && !(a && a.token === b.token && a.chat === b.chat)) out.push({ ...b, who: "c" });
  return out;
}

/** 依序要試的 Telegram 組合：FIND_TG_*（兩個都有才算）→ CONTACT_TG_*（舊表單那隻；跟前一組不同才加） */
export function tgTargets(env: Env): { token: string; chat: string }[] {
  return tgTargetsLabeled(env).map(({ token, chat }) => ({ token, chat }));
}

/**
 * 金鑰「長相」一個字母（不洩漏金鑰本身）：k＝像機器人金鑰、d＝全是數字（多半貼成聊天編號）、a＝@開頭（貼成機器人帳號）、
 * s＝很短（<20 字）、o＝其他。2026-10-07 景泰重貼後仍 tg-h404，後台看不到值，靠這個判斷貼了什麼。
 */
export function tgShape(token: string): string {
  if (TG_TOKEN_RE.test(token)) return "k";
  if (/^\d+$/.test(token)) return "d";
  if (token.startsWith("@")) return "a";
  if (token.length < 20) return "s";
  return "o";
}

/** 只有 FIND 那組其中一格有值（另一格空的）＝整組不算，會直接改用舊表單那隻；代碼前面標 p 提醒 */
function findPartial(env: Env): boolean {
  return !!envStr(env.FIND_TG_TOKEN) !== !!envStr(env.FIND_TG_CHAT);
}

/** 失敗代碼（不含任何金鑰或內容）：none 沒設定、h401 金鑰錯、h403 機器人沒按開始或被封鎖、h400 聊天編號錯、net 連不上、to 逾時 */
export type TgResult = { ok: boolean; diag: string };

async function sendTgOne(deps: Deps, t: { token: string; chat: string }, text: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await deps.fetch(`https://api.telegram.org/bot${t.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: t.chat, text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: false }),
      signal: ctl.signal,
    });
    if (res.ok) return "ok";
    logFail("tg", `http_${res.status}`);
    return `h${res.status}`;
  } catch (e) {
    const cls = (e as { name?: string })?.name === "AbortError" ? "to" : "net";
    logFail("tg", cls === "to" ? "timeout" : "network");
    return cls;
  } finally {
    clearTimeout(timer);
  }
}

/** 找房專用那隻送不出去（例如新機器人還沒按「開始」）就改用舊表單那隻送，線索不掉；全失敗才回 ok=false＋代碼 */
async function sendTg(env: Env, deps: Deps, text: string): Promise<TgResult> {
  const targets = tgTargetsLabeled(env);
  const pre = findPartial(env) ? "tg-p" : "tg";
  if (!targets.length) {
    logFail("tg", "unconfigured");
    return { ok: false, diag: pre + "-none" };
  }
  const fails: string[] = [];
  for (const t of targets) {
    const r = await sendTgOne(deps, t, text);
    if (r === "ok") return { ok: true, diag: fails.length ? "tg-fallback" : "" };
    // 例：fh404k＝找房那隻（f）回 404、金鑰長得像金鑰（k）；cnetd＝舊表單那隻（c）連不上、金鑰全是數字（d）
    fails.push(t.who + r + tgShape(t.token));
  }
  return { ok: false, diag: pre + "-" + fails.join("-") };
}

function fakeJobId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return "a" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ---------- submit ---------- */
function degradedBody(kind: DegradeKind, jobId: string | null, saved: boolean, withContact = false, diag = ""): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ok: true,
    v: 1,
    status: "degraded",
    kind,
    jobId,
    saved,
    msg: saved ? (withContact ? DEGRADE_MSG_CONTACT : DEGRADE_MSG)[kind] : DEGRADE_LOST_MSG,
  };
  // 送不出去時附一個短代碼（只有失敗種類，沒有金鑰或內容），畫面上小字顯示，景泰截圖就知道是哪一關
  if (!saved && diag) body.diag = diag;
  return body;
}

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** 家用機 submit 回應 → 公開格式（白名單重組）。看不懂回 null（呼叫端改走降級收件）。 */
function mapSubmitResponse(j: unknown, httpStatus: number, withContact = false): { body: Record<string, unknown>; http: number } | null {
  if (!isObj(j)) return null;
  if (j.ok === false) {
    // rate＝家用機的防灌爆（同一來源太頻繁）：要告訴客人「稍等一下」，不能當成「後端沒接到」而轉成 TG 線索
    const m: Record<string, ErrCode> = { bad_request: "E_BAD_REQUEST", consent: "E_CONSENT", too_large: "E_TOO_LARGE", rate: "E_RATE" };
    const code = typeof j.code === "string" ? m[j.code] : undefined;
    return code ? { body: { ok: false, v: 1, code, msg: ERR[code].msg, retry: ERR[code].retry }, http: ERR[code].http } : null;
  }
  if (httpStatus >= 400) return null;
  if (j.status === "queued") {
    if (typeof j.jobId !== "string" || !JOB_ID_RE.test(j.jobId)) return null;
    const out: Record<string, unknown> = { ok: true, v: 1, status: "queued", jobId: j.jobId, saved: j.saved !== false, pollMs: POLL_MS.queued };
    if (isObj(j.queue)) {
      const ahead = int(j.queue.ahead, 0, 9999);
      const eta = int(j.queue.eta_s, 0, 86400);
      if (ahead !== null && eta !== null) out.queue = { ahead, eta_s: eta };
    }
    return { body: out, http: 200 };
  }
  if (j.status === "need_more") {
    const missing = Array.isArray(j.missing) ? j.missing.filter((x): x is string => typeof x === "string" && (MISSING_CODES as readonly string[]).includes(x)) : [];
    const ask = Array.isArray(j.ask) ? j.ask.filter((x): x is string => typeof x === "string" && (QUESTION_IDS as readonly string[]).includes(x)) : [];
    return { body: { ok: true, v: 1, status: "need_more", missing, ask }, http: 200 };
  }
  if (j.status === "degraded") {
    const kind = (DEGRADE_KINDS as readonly string[]).includes(String(j.kind)) ? (j.kind as DegradeKind) : "general";
    const jobId = typeof j.jobId === "string" && JOB_ID_RE.test(j.jobId) ? j.jobId : null;
    return { body: degradedBody(kind, jobId, j.saved !== false, withContact), http: 200 };
  }
  return null;
}

export async function handleSubmit(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const { request, env } = ctx;
  if (request.method !== "POST") return methodNotAllowed();
  if (!originAllowed(request)) return errRes("E_ORIGIN");
  const rd = await readJson(request, 12 * 1024);
  if (rd.err) return errRes(rd.err);
  const { out, err } = validateSubmit(rd.value);
  if (err || !out) return errRes(err ?? "E_BAD_REQUEST");
  const c: SubmitClean = out;

  // 機器人：honeypot 有填、或快到不可能是人（<0.3 秒）→ 假成功（不轉送、不回頭告訴它哪裡被擋）。
  // 2~3 秒內送出的熟手（從首頁範例標籤一路按下來、從推薦頁「調整條件」回來）是正常的，不能在這裡消失；
  // 真正擋機器人的是下面的人機驗證。
  if (c.hp !== "" || (c.fill_ms !== null && c.fill_ms < 300)) {
    return jsonRes({ ok: true, v: 1, status: "queued", jobId: fakeJobId(), queue: { ahead: 0, eta_s: 60 }, saved: true, pollMs: POLL_MS.queued });
  }

  // 人機驗證。沒設金鑰、查驗服務連不上＝fail-closed：不轉送、**不推 TG**（TG 通道沒有別的限流，驗不了就放行等於讓任何人都能洗版）。
  // 客人會看到「沒能送出，可以複製下面的內容直接傳給景泰」，需求不會被默默吞掉。
  const vr = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY, token: c.turnstile, fetchImpl: deps.fetch, action: TS_ACTION, remoteIp: request.headers.get("cf-connecting-ip"),
    onReason: r => logFail("submit", `human_${r}`),
  });
  if (vr === "fail") return errRes("E_HUMAN");
  if (vr === "unavailable") {
    logFail("submit", "human_unavailable");
    return jsonRes(degradedBody("general", null, false, false, "human"));
  }

  const dev = uaKind(request.headers.get("user-agent"));
  const ref = c.idem.slice(0, 6);
  const lead = async (why: "intake" | "upstream_down") => {
    const tg = await sendTg(
      env, deps,
      formatLead({ why, fields: c.fields, context: c.context, free_text: c.free_text, contact: c.contact, consent: c.consent, from: c.from, dev, ref }),
    );
    return jsonRes(degradedBody("general", null, tg.ok, !!(c.contact && c.consent), tg.diag));
  };

  // 收件模式（總開關沒開、或查詢功能的設定沒設完整）：不轉送上游查詢，只收件
  if (!liveReady(env)) return lead("intake");

  const ip = await ipHash(env.FIND_IP_SALT, request.headers.get("cf-connecting-ip"), deps.now());
  const payload = {
    v: 1,
    idem: c.idem,
    client: { ip_h: ip, ua: dev, turnstile: "ok", fill_ms: c.fill_ms, from: c.from },
    fields: c.fields,
    context: c.context,
    free_text: c.free_text,
    skip: c.skip,
    contact: c.contact,
    consent: c.consent,
    refine_of: c.refine_of,
  };
  let f = await forward(env, deps, "POST", "/aif/v1/submit", payload, 8000);
  if (f.kind === "down" && (f.cls === "timeout" || f.cls === "network")) {
    // 逾時不代表家用機沒收到（它可能已經寫進庫、排進佇列）：用同一個 idem（家用機 10 分鐘內回同一個工作）、新的 nonce 再送一次
    logFail("submit", f.cls);
    f = await forward(env, deps, "POST", "/aif/v1/submit", payload, 5000);
  }
  if (f.kind === "down") {
    logFail("submit", f.cls);
    return lead("upstream_down");
  }
  if (f.status === 429) return errRes("E_RATE");           // 閘門／家用機說太頻繁（空本文）：不是「後端沒接到」
  if (f.status === 401) logFail("submit", "auth");          // 兩邊金鑰對不上：仍然收件，但留一筆泛化代碼讓人查
  const mapped = mapSubmitResponse(f.json, f.status, !!(c.contact && c.consent));
  if (!mapped) {
    logFail("submit", "unexpected");
    return lead("upstream_down");
  }
  return jsonRes(mapped.body, mapped.http);
}

/* ---------- status ---------- */
const STATUSES = ["queued", "searching", "building", "done", "empty", "degraded", "expired"];

export function buildStatusView(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw) || raw.ok === false) return null;
  const j: Record<string, unknown> = raw;
  let st = typeof j.status === "string" ? j.status : "";
  if (st === "accepted") st = "queued";
  if (!STATUSES.includes(st)) return null;
  const out: Record<string, unknown> = { ok: true, v: 1 };
  if (st === "done") {
    if (typeof j.shareUrl === "string" && SHARE_URL_RE.test(j.shareUrl)) {
      Object.assign(out, { status: "done", stage: "d", msg: STATUS_MSG.done, shareUrl: j.shareUrl, count: int(j.count, 0, 99) });
      return out;
    }
    st = "degraded"; // 壞網址不外洩，改成降級
    j.kind = "general";
  }
  if (st === "degraded") {
    const kind = (DEGRADE_KINDS as readonly string[]).includes(String(j.kind)) ? (j.kind as DegradeKind) : "general";
    Object.assign(out, { status: "degraded", stage: "d", kind, msg: DEGRADE_MSG[kind] });
    return out;
  }
  if (st === "empty") {
    const hint = Array.isArray(j.hint) ? j.hint.filter((h): h is string => typeof h === "string" && (HINTS as readonly string[]).includes(h)) : [];
    Object.assign(out, { status: "empty", stage: "d", msg: STATUS_MSG.empty, count: 0, hint: hint.length ? hint : null });
    return out;
  }
  if (st === "expired") {
    Object.assign(out, { status: "expired", stage: "d", msg: STATUS_MSG.expired });
    return out;
  }
  Object.assign(out, { status: st, stage: STAGE_OF[st], msg: STATUS_MSG[st as "queued" | "searching" | "building"], pollMs: POLL_MS[st] });
  if (st === "queued" && isObj(j.queue)) {
    const ahead = int(j.queue.ahead, 0, 9999);
    const eta = int(j.queue.eta_s, 0, 86400);
    if (ahead !== null && eta !== null) out.queue = { ahead, eta_s: eta };
  }
  return out;
}

export async function handleStatus(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const { request, env } = ctx;
  if (request.method !== "GET") return methodNotAllowed();
  if (!sameOriginGet(request)) return errRes("E_ORIGIN");
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!JOB_ID_RE.test(id)) return errRes("E_BAD_REQUEST");
  const unknown = () => jsonRes({ ok: true, v: 1, status: "unknown", pollMs: 6000 });
  if (!liveReady(env)) return unknown();
  const f = await forward(env, deps, "GET", `/aif/v1/status?id=${id}`, null, 5000);
  if (f.kind === "down") {
    logFail("status", f.cls);
    return unknown();
  }
  if (f.status === 404) return errRes("E_NOT_FOUND");
  if (f.status === 429 || (isObj(f.json) && f.json.ok === false && f.json.code === "rate")) {
    return jsonRes({ ok: true, v: 1, status: "unknown", pollMs: 10000 });      // 輪詢太密：慢一點再問，不是壞掉
  }
  const view = buildStatusView(f.json);
  if (!view) {
    logFail("status", "unexpected");
    return unknown();
  }
  return jsonRes(view);
}

/* ---------- contact ---------- */
export async function handleContact(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const { request, env } = ctx;
  if (request.method !== "POST") return methodNotAllowed();
  if (!originAllowed(request)) return errRes("E_ORIGIN");
  const rd = await readJson(request, 12 * 1024);
  if (rd.err) return errRes(rd.err);
  const { out, err } = validateContactBody(rd.value);
  if (err || !out) return errRes(err ?? "E_BAD_REQUEST");
  if (out.hp !== "") return jsonRes({ ok: true, v: 1, saved: true });
  // 跟 submit 同等對待：一次性人機驗證 token。沒有 token／沒過／驗不了，一律不轉送、不推 TG
  // （這條端點能直送景泰的 TG，沒有人機驗證就是一個任何人都能洗版的口子）
  const vr = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY, token: out.turnstile, fetchImpl: deps.fetch, action: TS_ACTION, remoteIp: request.headers.get("cf-connecting-ip"),
    onReason: r => logFail("contact", `human_${r}`),
  });
  if (vr === "fail") return errRes("E_HUMAN");
  if (vr === "unavailable") {
    logFail("contact", "human_unavailable");
    return jsonRes({ ok: true, v: 1, saved: false });
  }
  if (out.jid && liveReady(env)) {
    const ip = await ipHash(env.FIND_IP_SALT, request.headers.get("cf-connecting-ip"), deps.now());
    const f = await forward(env, deps, "POST", "/aif/v1/contact", { v: 1, jid: out.jid, contact: out.contact, consent: out.consent, ip_h: ip }, 5000);
    if (f.kind === "ok") {
      if (f.status === 404 || (isObj(f.json) && f.json.code === "not_found")) return errRes("E_NOT_FOUND");   // 工作不存在／過期：不改走 TG
      if (f.status === 429 || (isObj(f.json) && f.json.code === "rate")) return errRes("E_RATE");
      if (isObj(f.json) && f.json.ok === true) return jsonRes({ ok: true, v: 1, saved: true });
      logFail("contact", "unexpected");
    } else {
      logFail("contact", f.cls);
    }
  }
  // 家用機真的連不上（或沒有工作編號、或收件模式）：直送 TG，仍然不丟
  const tg = await sendTg(env, deps, formatContactLead(out.contact, out.consent));
  return jsonRes(tg.ok ? { ok: true, v: 1, saved: true } : { ok: true, v: 1, saved: false, diag: tg.diag });
}

/* ---------- 事件憑證（紅隊 RT-12） ----------
 * /api/find/event 沒有人機驗證（失敗一律回 ok、不能因為它擋住真人），所以另外要求一張「短效憑證」：
 * 由 /api/find/config 發（HMAC，綁一個 2 小時的時間桶；收當下與前一個桶＝有效 2～4 小時），事件批次要帶回來。
 * 沒帶或對不上：事件默默丟掉（回 ok，不告訴對方為什麼）。
 * 誠實說明：這只能擋「沒先取過憑證的盲打」，擋不住會照順序打的腳本；Function 沒有跨請求狀態，
 * 真正的「每來源每日事件配額」在家用機，大量請求在 Cloudflare 的速率限制。
 */
const EVT_BUCKET_MS = 2 * 3600 * 1000;
async function evtToken(secret: string, bucket: number): Promise<string> {
  return `${bucket.toString(36)}.${(await hmacHex(secret, `EVT1|${bucket}`)).slice(0, 20)}`;
}
export async function makeEvtToken(env: Env, nowMs: number): Promise<string | null> {
  const secret = envStr(env.FIND_HMAC_SECRET);
  if (secret.length < 16) return null;
  return evtToken(secret, Math.floor(nowMs / EVT_BUCKET_MS));
}
function sameStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function checkEvtToken(env: Env, token: unknown, nowMs: number): Promise<boolean> {
  const secret = envStr(env.FIND_HMAC_SECRET);
  if (secret.length < 16 || typeof token !== "string" || token.length > 64 || !/^[0-9a-z]{1,8}\.[0-9a-f]{20}$/.test(token)) return false;
  const cur = Math.floor(nowMs / EVT_BUCKET_MS);
  for (const b of [cur, cur - 1]) if (sameStr(token, await evtToken(secret, b))) return true;
  return false;
}

/* ---------- event（匿名使用事件：只驗證、轉送，不存；失敗就丟，不影響客人） ---------- */
export async function handleEvent(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const { request, env } = ctx;
  if (request.method !== "POST") return methodNotAllowed();
  if (!originAllowed(request)) return errRes("E_ORIGIN");
  const rd = await readJson(request, 8 * 1024);
  if (rd.err) return errRes(rd.err);
  const { env: envelope } = validateEventBatch(rd.value);
  if (!envelope) return errRes("E_BAD_REQUEST");
  const et = isObj(rd.value) ? rd.value.et : undefined;
  if (envelope.events.length && liveReady(env) && (await checkEvtToken(env, et, deps.now()))) {
    const job = (async () => {
      const ip = await ipHash(env.FIND_IP_SALT, request.headers.get("cf-connecting-ip"), deps.now());
      const f = await forward(env, deps, "POST", "/aif/v1/event", { ...envelope, ip_h: ip, ua: uaKind(request.headers.get("user-agent")) }, 3000);
      if (f.kind === "down") logFail("event", f.cls);
    })();
    if (ctx.waitUntil) ctx.waitUntil(job);
    else await job;
  }
  return jsonRes({ ok: true });
}

/* ---------- feedback ---------- */
export async function handleFeedback(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const { request, env } = ctx;
  if (request.method !== "POST") return methodNotAllowed();
  if (!originAllowed(request)) return errRes("E_ORIGIN");
  const rd = await readJson(request, 12 * 1024);
  if (rd.err) return errRes(rd.err);
  const { out, err } = validateFeedback(rd.value);
  if (err || !out) return errRes(err ?? "E_BAD_REQUEST");
  if (!liveReady(env)) return jsonRes({ ok: true, v: 1 });
  const ip = await ipHash(env.FIND_IP_SALT, request.headers.get("cf-connecting-ip"), deps.now());
  const f = await forward(env, deps, "POST", "/aif/v1/feedback", { v: 1, ...out, ip_h: ip }, 5000);
  if (f.kind === "down") {
    logFail("feedback", f.cls);
    return errRes("E_FORWARD");
  }
  if (f.status === 404) return errRes("E_NOT_FOUND");
  if (f.status === 429 || (isObj(f.json) && f.json.code === "rate")) return errRes("E_RATE");
  // 家用機回 401（金鑰不符）、其他空本文或怪格式：不能告訴客人「謝謝」卻把回饋整筆吃掉
  if (!(isObj(f.json) && f.json.ok === true)) {
    logFail("feedback", f.status === 401 ? "auth" : "unexpected");
    return errRes("E_FORWARD");
  }
  return jsonRes({ ok: true, v: 1 });
}

/* ---------- config（執行期設定；Turnstile 的 site key 由這裡回傳，免去重新建置） ---------- */
let healthCache: { at: number; mode: "live" | "intake" } | null = null;
export function resetConfigCache(): void {
  healthCache = null;
}

export async function handleConfig(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const { request, env } = ctx;
  if (request.method !== "GET") return methodNotAllowed();
  if (!sameOriginGet(request)) return errRes("E_ORIGIN");
  let mode: "live" | "intake" = "intake";
  if (liveReady(env)) {
    const now = deps.now();
    if (healthCache && now - healthCache.at < 15000) mode = healthCache.mode;
    else {
      const f = await forward(env, deps, "GET", "/aif/v1/health", null, 3000);
      if (f.kind === "ok" && isObj(f.json) && f.json.ok === true) {
        mode = f.json.mode === "live" ? "live" : "intake";
        healthCache = { at: now, mode };
      } else {
        // 健康檢查逾時／出錯：沿用上一次的結果，不要把網站翻成「收件模式」又翻回來（會讓客人看到文案閃來閃去）；5 秒後再試
        logFail("health", f.kind === "down" ? f.cls : "unexpected");
        mode = healthCache ? healthCache.mode : "intake";
        healthCache = { at: now - 10000, mode };
      }
    }
  }
  const evt = liveReady(env) ? await makeEvtToken(env, deps.now()) : null;
  return jsonRes({ ok: true, v: 1, mode, turnstileSiteKey: publicSiteKey(env.TURNSTILE_SITE_KEY), needMax: 300, consentV: CONSENT_V, tplV: 1, evt });
}

/** 公開接口只准吐「長得像 Turnstile Site Key」的值（約 24 字元，例：0x4…／1x0…／2x0…／3x0…）。
 *  2026-10-06 事故：後台把 Secret Key（35 字元）貼進 TURNSTILE_SITE_KEY，公開設定接口就把它給了每位訪客。
 *  格式不符一律當成「沒設定」（回 null），寧可驗證框不出現，也不能把可能是機密的值送出去。 */
export function publicSiteKey(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[0-9]x[A-Za-z0-9_-]{8,27}$/.test(s) ? s : null;
}

