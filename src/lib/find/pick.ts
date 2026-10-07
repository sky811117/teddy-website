/**
 * 推薦頁「傳給景泰」（2026-10-07）：客人在景泰本人的推薦頁按了「我喜歡」之後，可以把選的物件連同聯絡方式一次傳給景泰。
 * 端點 POST /api/find/pick（functions/api/find/pick.ts 只是薄包裝），前端是官網代理注入的 public/js/share-pick.js。
 *
 * 跟頁面原本的「我喜歡」是兩條路：原本按喜歡會由推薦頁自己送到推薦頁服務（Vercel 的 /api/track），再由那邊推 Telegram
 * 「泰迪的小聲音」；那條路本來就存在，景泰反映「按喜歡收不到」要另外查 Vercel 那邊（見交付說明），這裡不碰它。
 * 這條補的是「客人沒有地方留聯絡方式、一次把選好的物件交給景泰」。
 *
 * 流程：同源（或舊網址的推薦頁跨網域）→ 本文大小（4KB）→ honeypot（有填就假成功、不送，但記一筆）→ 格式驗證
 *   → qa 頁過期就不收 → 每 IP 限流 → 伺服器端核對推薦頁（審查 R3，見下）→ isolate 總量限流 → 組 Telegram 訊息 → 送出。
 * Telegram 沿用找房小幫手那隻（FIND_TG_*，送不出去改用 CONTACT_TG_*；同一個 sendTg、同樣 12 秒逾時）。
 * 回應只有白名單鍵：{ ok:true, v:1, saved:true|false }（送不出去時另帶 diag 失敗種類短代碼）；格式不對走 errors.ts 的固定錯誤表。
 *
 * 伺服器端核對推薦頁（審查 R3）：用跟官網代理同一個上游抓 <代號>/（GitHub Pages 還沒發布回 404 時改讀 repo 原始檔，同代理的備援），
 *   頁面必須是景泰本人頁（sharepick.ts 的 isOwnerPage，同事頁不收），客人送來的每個 slug 都要是頁面上「我喜歡」按鈕的 data-slug，
 *   而且物件名稱一律改用頁面上的字（按鈕的 data-name／卡片標題、價格、坪數、樓層），客戶端送的名稱只驗格式、不進 Telegram。
 *   所以要送得進來，得先拿到景泰真的推薦頁代號（22 碼亂數），Telegram 裡也不會出現別人編的物件文字。
 *   代號不存在、不是本人頁 → 404；slug 不在頁面上 → 400；上游暫時抓不到 → saved:false＋pg-代碼（客人畫面顯示改加 LINE）。
 *   上游讀取跟代理一樣只快取 2xx 30 秒（cacheTtlByStatus），逾時 6 秒。
 *
 * 舊網址（審查 R1）：推薦頁產生器發出去的連結仍是 teddy-website-blog.pages.dev/share/…，代理在那裡也注入腳本，
 *   腳本跨網域送到 https://teddy-house.tw/api/find/pick。這裡只對 Origin 剛好是 https://teddy-website-blog.pages.dev 的請求
 *   回 CORS 允許（含 OPTIONS 預檢）；請求本身仍必須打在正式網域（舊網址上的 /api/find/* 由 _middleware.ts 一律 404，RT-05 不變）。
 *
 * 客人打的字一律當不可信輸入（跟 leadfmt.ts 同一套）：normText 正規化（造不出新的一行）、稱呼／留言／物件名稱再過 hideLinks
 * （網址、Email、@帳號、#標籤、電話、身分證字號換成 [已隱藏]），每一段都包在 <code> 裡並且 HTML 跳脫。
 * 推薦頁上的物件文字也一樣處理（物件介紹來自外部刊登，同樣不可信）。
 * 聯絡欄位（LINE ID、手機）是客人勾選同意後要給景泰的，照實傳（格式先驗過，一樣放 <code>）。訊息不含 IP。
 *
 * ⚠️ 限流的限制：Function 沒有跨請求狀態，這裡是每個 isolate 自己的記憶體滑動視窗（score.ts 的 MemWindow）：
 *    同一 IP 10 分鐘最多 5 次（核對推薦頁之前就算）、同一個 isolate 10 分鐘最多 60 則（核對通過才算，假代號灌不滿它）。
 *    Cloudflare 開很多個 isolate、冷啟動就清空，所以這不是全域限流；上線前一定要在 Cloudflare 後台對 /api/find/pick
 *    設 WAF 速率限制（同一 IP 10 分鐘 3～5 次），沒設不要上（見交付說明的手動設定清單）。
 *    這條端點沒有人機驗證（推薦頁沒有載入驗證元件），這是刻意的取捨：只送給景泰自己的 TG、要有真的推薦頁代號、而且有上面兩層上限。
 */
import type { ErrCode } from "./errors";
import { errRes, jsonRes, logFail, readJson, realDeps, sendTg } from "./handlers";
import type { Deps, FindCtx } from "./handlers";
import { hostAllowed, originAllowed } from "./origin";
import { hideLinks, isObj, normText } from "./schema";
import { MemWindow } from "./score";
import { isQaExpired, parseQa } from "./shareqa";
import { OLD_ORIGIN, SHARE_RAW_UPSTREAM, SHARE_UPSTREAM, isOwnerPage } from "./sharepick";

export const PICK_MAX_BYTES = 4 * 1024;
export const PICK_ITEMS_MAX = 12;
export const PICK_ITEM_NAME_MAX = 60;
export const PICK_NAME_MAX = 20;
export const PICK_NOTE_MAX = 200;
export const PICK_PER_IP = 5;
export const PICK_GLOBAL = 60;
export const PICK_WINDOW_MS = 10 * 60 * 1000;
/** 核對推薦頁：每次讀取的逾時、頁面大小上限（跟代理的 raw 備援同一個上限）、最多看幾張卡片 */
export const PICK_PAGE_TIMEOUT_MS = 6000;
export const PICK_PAGE_MAX = 2_000_000;
export const PICK_CARDS_MAX = 500;
/** 訊息裡的推薦頁網址固定用正式網域（客人可能從舊網址或本機測試送進來，景泰點的一定要是正式頁） */
export const PICK_SITE = "https://teddy-house.tw";

/** 推薦頁代號：跟 functions/share/[[path]].ts 的 SHARE_ID_RE 同一條（三邊約定） */
export const PICK_SHARE_ID_RE = /^[A-Za-z0-9]{4,40}$/;
/** 卡片的 data-slug（推薦頁產生器給的短代號） */
export const PICK_SLUG_RE = /^[A-Za-z0-9_-]{1,40}$/;
// 下面兩條跟 schema.ts 的 LINE_ID_RE／PHONE_RE 同等（那兩條沒有匯出，這裡照抄，不改 schema.ts）
const LINE_ID_RE = /^[A-Za-z0-9._@-]{1,40}$/;
const PHONE_RE = /^[0-9+() -]{8,16}$/;
const PROD_HOST = /^(?:www\.)?teddy-house\.tw$/i;

const cpLen = (s: string) => Array.from(s).length;
const cpClip = (s: string, n: number) => Array.from(s).slice(0, n).join("").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 客人文字：正規化、跳脫、框起來（不含換行） */
const code = (s: string) => `<code>${esc(normText(s))}</code>`;
/** 正規化＋去頭尾＋多個空白縮成一個 */
const clean = (v: unknown) => normText(v).replace(/\s+/g, " ").trim();

export type PickItem = { slug: string; name: string };
export type PickClean = {
  share_id: string;
  items: PickItem[];
  name: string;
  line: string;
  phone: string;
  note: string;
};

/**
 * 驗證並重組本文。必要欄位不合法回錯誤代碼；可選欄位空字串視為沒填。
 * 太長（稱呼 >20、留言 >200、物件名稱 >60）回 E_TOO_LARGE；同意沒勾回 E_CONSENT；其他格式問題回 E_BAD_REQUEST。
 * 這裡的物件名稱只驗格式；真正進 Telegram 的名稱在 handlePick 換成推薦頁上的字。
 */
export function validatePick(b: unknown): { out: PickClean | null; err: ErrCode | null } {
  const bad = (err: ErrCode = "E_BAD_REQUEST") => ({ out: null, err });
  if (!isObj(b)) return bad();
  if (typeof b.share_id !== "string" || !PICK_SHARE_ID_RE.test(b.share_id)) return bad();
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > PICK_ITEMS_MAX) return bad();
  const items: PickItem[] = [];
  const seen = new Set<string>();
  for (const it of b.items) {
    if (!isObj(it) || typeof it.slug !== "string" || !PICK_SLUG_RE.test(it.slug) || typeof it.name !== "string") return bad();
    const name = clean(it.name);
    if (!name) return bad();
    if (cpLen(name) > PICK_ITEM_NAME_MAX) return bad("E_TOO_LARGE");
    if (seen.has(it.slug)) continue;
    seen.add(it.slug);
    items.push({ slug: it.slug, name });
  }
  const opt = (k: string): string | null => {
    const v = b[k];
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") return null;
    return clean(v);
  };
  const name = opt("name");
  const line = opt("line");
  const phone = opt("phone");
  const note = opt("note");
  if (name === null || line === null || phone === null || note === null) return bad();
  if (cpLen(name) > PICK_NAME_MAX || cpLen(note) > PICK_NOTE_MAX) return bad("E_TOO_LARGE");
  if (line && !LINE_ID_RE.test(line)) return bad();
  if (phone) {
    const digits = phone.replace(/\D/g, "").length;
    if (!PHONE_RE.test(phone) || digits < 8 || digits > 12) return bad();
  }
  if (!line && !phone) return bad();
  if (b.consent !== true) return bad("E_CONSENT");
  return { out: { share_id: b.share_id, items, name, line, phone, note }, err: null };
}

/** honeypot：字串照收；非字串但有值（機器人亂塞）當成有填 */
export function honeypot(b: unknown): string {
  if (!isObj(b)) return "";
  const hp = b.hp;
  return typeof hp === "string" ? hp : hp ? "x" : "";
}

/** 台灣時間（UTC+8，沒有日光節約）YYYY-MM-DD HH:mm */
export function twTime(nowMs: number): string {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Telegram 訊息（HTML 模式）。每一行都是「已跳脫的 HTML」：系統固定文字用 esc，客人／頁面文字用 code。 */
export function formatPick(c: PickClean, nowMs: number): string {
  const lines: string[] = [esc(`【推薦頁｜客人選了 ${c.items.length} 間】`)];
  const nm = c.name ? hideLinks(c.name) : "";
  lines.push(esc("稱呼：") + (nm ? code(nm) : esc("（沒填）")));
  const ct: string[] = [];
  if (c.line) ct.push(esc("LINE ") + code(c.line));
  if (c.phone) ct.push(esc("手機 ") + code(c.phone));
  lines.push(esc("聯絡：") + ct.join(esc("｜")) + esc("（客人已勾選同意）"));
  lines.push(esc("選的物件："));
  c.items.forEach((it, i) => lines.push(esc(`${i + 1}. `) + code(hideLinks(it.name) || "（名稱無法顯示）")));
  const note = c.note ? hideLinks(c.note) : "";
  lines.push(esc("留言：") + (note ? code(note) : esc("（沒有）")));
  // 代號已過白名單（只有英數），網址是系統組的，可以讓 Telegram 變成可點的連結
  lines.push(esc(`推薦頁：${PICK_SITE}/share/${c.share_id}/`));
  lines.push(esc(`時間：${twTime(nowMs)}（台灣時間）`));
  return lines.join("\n");
}

/* ---------- 推薦頁核對（審查 R3） ---------- */
/** HTML 實體還原（推薦頁產生器用 Python html.escape：&amp; &lt; &gt; &quot; &#x27;）。一次掃過，&amp;lt; 只會變成 &lt;。 */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (k in named) return named[k];
    const cp = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
  });
}
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeHtml(m[1]) : null;
};
const textIn = (block: string, re: RegExp): string => {
  const m = re.exec(block);
  return m ? clean(unescapeHtml(m[1])) : "";
};
const HAS_FLOOR = /樓|\d\s*F\b/i;

/**
 * 從推薦頁 HTML 抓「我喜歡」按鈕：slug → 要給景泰看的物件名稱（≤60 字）。
 * 必要條件只有按鈕本身（class 含 card-like、有 data-slug）——跟 share-pick.js 依賴的一樣；
 * 卡片上的標題、價格、坪數、樓層抓得到就補（組法跟 share-pick.js 的 describe 相同），抓不到就只用按鈕的 data-name。
 */
export function pageCards(html: string): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof html !== "string") return out;
  // 卡片區塊：<div class="card" data-slug="…" …> 到下一張卡片開頭
  const blocks = new Map<string, { block: string; community: string }>();
  const starts: { slug: string; at: number; tag: string }[] = [];
  const cardRe = /<div class="card" data-slug="([^"]*)"[^>]*>/g;
  for (let m: RegExpExecArray | null; (m = cardRe.exec(html)) && starts.length < PICK_CARDS_MAX;) {
    starts.push({ slug: unescapeHtml(m[1]), at: m.index, tag: m[0] });
  }
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : Math.min(html.length, s.at + 200_000);
    if (!blocks.has(s.slug)) blocks.set(s.slug, { block: html.slice(s.at, end), community: attrOf(s.tag, "data-community") || "" });
  });
  const btnRe = /<button\b[^>]*>/gi;
  let n = 0;
  for (let m: RegExpExecArray | null; (m = btnRe.exec(html)) && n < PICK_CARDS_MAX;) {
    const tag = m[0];
    const cls = attrOf(tag, "class") || "";
    if (!/(?:^|\s)card-like(?:\s|$)/.test(cls)) continue;
    const slug = attrOf(tag, "data-slug") || "";
    if (!PICK_SLUG_RE.test(slug) || out.has(slug)) continue;
    n++;
    const b = blocks.get(slug);
    const blk = b ? b.block : "";
    const title = textIn(blk, /<div class="card-tagline">([^<]*)<\/div>/) || clean(attrOf(tag, "data-name") || "") || clean(b ? b.community : "") || "物件";
    let floor = "";
    if (!HAS_FLOOR.test(title)) {
      const f = textIn(blk, /<div class="card-floor">([^<]*)<\/div>/);
      if (f) floor = HAS_FLOOR.test(f) ? f : f + " 樓";
    }
    let price = textIn(blk, /<span class="card-price">([^<]*)<\/span>/);
    if (price) {
      const unit = textIn(blk, /<span class="card-price-unit">([^<]*)<\/span>/);
      price = price + (unit ? " " + unit : "");
    }
    let area = "", firstPing = "";
    const specRe = /<span class="spec-label">([^<]*)<\/span>\s*<span class="spec-value[^"]*">([^<]*)<\/span>/g;
    for (let s: RegExpExecArray | null; (s = specRe.exec(blk));) {
      const lab = clean(unescapeHtml(s[1])), val = clean(unescapeHtml(s[2]));
      if (!val) continue;
      if (/權狀/.test(lab)) { area = val; break; }
      if (!firstPing && /坪/.test(lab + val)) firstPing = val;
    }
    if (!area) area = firstPing;
    const head = cpClip(title + (floor ? " " + floor : ""), 40);
    const name = cpClip([head, cpClip(price, 16), cpClip(area, 16)].filter(Boolean).join("｜"), PICK_ITEM_NAME_MAX);
    out.set(slug, clean(name) || "物件");
  }
  return out;
}

export type SharePage = { kind: "ok"; html: string } | { kind: "missing" } | { kind: "down"; cls: string };

async function getPage(deps: Deps, url: string): Promise<{ status: number; html: string | null } | { err: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PICK_PAGE_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {
      headers: { "User-Agent": "teddy-website-pick-check" },
      redirect: "manual",
      signal: ctl.signal,
      // 跟代理同一套：只快取 2xx 30 秒（剛產生、還沒發布的 404 不快取）。cf 是 Workers 執行期欄位
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 30, "300-599": 0 } },
    } as RequestInit);
    if (res.status !== 200) {
      try { await res.body?.cancel(); } catch { /* 不需要本文 */ }
      return { status: res.status, html: null };
    }
    return { status: 200, html: await res.text() };
  } catch (e) {
    return { err: (e as { name?: string })?.name === "AbortError" ? "to" : "net" };
  } finally {
    clearTimeout(timer);
  }
}
const looksHtml = (h: string | null): h is string => typeof h === "string" && h.length <= PICK_PAGE_MAX && /<html[\s>]/i.test(h);
const httpCls = (st: number) => (st >= 300 && st < 400 ? "3xx" : "h" + st);

/** 讀推薦頁：Pages 回 200 就用；回 404 改讀 repo 原始檔（代理的同一個備援）；兩邊都 404 ＝ 沒有這個代號。代號已過白名單（只有英數）。 */
export async function fetchSharePage(deps: Deps, id: string): Promise<SharePage> {
  if (!PICK_SHARE_ID_RE.test(id)) return { kind: "missing" };
  const a = await getPage(deps, `${SHARE_UPSTREAM}${id}/`);
  if ("err" in a) return { kind: "down", cls: a.err };
  if (a.status === 200) return looksHtml(a.html) ? { kind: "ok", html: a.html } : { kind: "down", cls: "type" };
  if (a.status !== 404) return { kind: "down", cls: httpCls(a.status) };
  const b = await getPage(deps, `${SHARE_RAW_UPSTREAM}${id}/index.html`);
  if ("err" in b) return { kind: "down", cls: b.err };
  if (b.status === 200) return looksHtml(b.html) ? { kind: "ok", html: b.html } : { kind: "down", cls: "type" };
  if (b.status === 404) return { kind: "missing" };
  return { kind: "down", cls: httpCls(b.status) };
}

/* ---------- 來源與 CORS（審查 R1） ---------- */
/** "same"＝官網自己的頁面（同源）；"old"＝舊網址上的推薦頁跨網域送來（請求本身打在正式網域）；null＝不收 */
export function pickOrigin(request: Request): "same" | "old" | null {
  if (originAllowed(request)) return "same";
  if (!hostAllowed(request)) return null;
  try {
    if (!PROD_HOST.test(new URL(request.url).hostname)) return null;
  } catch {
    return null;
  }
  return request.headers.get("origin") === OLD_ORIGIN ? "old" : null;
}
const CORS_OLD: Record<string, string> = { "access-control-allow-origin": OLD_ORIGIN, vary: "Origin" };
function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_OLD)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/* ---------- 限流（每個 isolate 自己的記憶體視窗；限制見檔頭） ---------- */
const ipWin = new MemWindow();
const allWin = new MemWindow();

/** 測試用：清掉限流視窗 */
export function resetPickState(): void {
  ipWin.clear();
  allWin.clear();
}

/** IP 不直接當鍵：取 SHA-256 前 16 碼（記憶體裡也不留原始 IP）。沒有 IP 標頭（本機測試）一律 "-"。 */
async function ipKey(ip: string | null): Promise<string> {
  if (!ip) return "-";
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pick|" + ip));
    return Array.from(new Uint8Array(d).slice(0, 8), x => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return "-";
  }
}

async function handle(ctx: FindCtx, deps: Deps, src: "same" | "old" | null): Promise<Response> {
  const { request, env } = ctx;
  // 舊網址的推薦頁送 JSON 會先發 OPTIONS 預檢：只對舊網址這一個來源、只准 POST＋content-type
  if (request.method === "OPTIONS") {
    const want = (request.headers.get("access-control-request-method") || "").toUpperCase();
    if (src !== "old" || want !== "POST") return errRes("E_METHOD");
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method !== "POST") return errRes("E_METHOD");
  if (!src) return errRes("E_ORIGIN");
  const rd = await readJson(request, PICK_MAX_BYTES);
  if (rd.err) return errRes(rd.err);
  // 機器人：honeypot 有填 → 假成功（不驗證、不送、不算進限流，也不告訴它哪裡被擋）。
  // 審查 R5：萬一是真人的瀏覽器自動填入填到它，客人看到成功、景泰卻沒收到——記一筆，事後查得到。
  if (honeypot(rd.value) !== "") {
    logFail("pick", "hp");
    return jsonRes({ ok: true, v: 1, saved: true });
  }
  const { out, err } = validatePick(rd.value);
  if (err || !out) return errRes(err ?? "E_BAD_REQUEST");
  // 找房小幫手推薦頁（qa 代號）過期了：頁面本身已經打不開，不收
  const qa = parseQa(out.share_id.toLowerCase());
  const now = deps.now();
  if (qa && isQaExpired(qa.expDay, now)) return errRes("E_NOT_FOUND");
  const key = await ipKey(request.headers.get("cf-connecting-ip"));
  if (!ipWin.hit(key, PICK_PER_IP, PICK_WINDOW_MS, now)) {
    logFail("pick", "rate");
    return errRes("E_RATE");
  }
  // 核對推薦頁（審查 R3）
  const page = await fetchSharePage(deps, out.share_id);
  if (page.kind === "missing") {
    logFail("pick", "page_missing");
    return errRes("E_NOT_FOUND");
  }
  if (page.kind === "down") {
    logFail("pick", "page_" + page.cls);
    return jsonRes({ ok: true, v: 1, saved: false, diag: "pg-" + page.cls });
  }
  if (!isOwnerPage(page.html)) {
    logFail("pick", "not_owner");
    return errRes("E_NOT_FOUND");
  }
  const cards = pageCards(page.html);
  const items: PickItem[] = [];
  for (const it of out.items) {
    const nm = cards.get(it.slug);
    if (nm === undefined) {
      logFail("pick", "slug");
      return errRes("E_BAD_REQUEST");
    }
    items.push({ slug: it.slug, name: nm });
  }
  // isolate 總量：核對通過才算（假代號灌不滿它，真客人不會被別人的洗版擋住）
  if (!allWin.hit("*", PICK_GLOBAL, PICK_WINDOW_MS, now)) {
    logFail("pick", "rate_all");
    return errRes("E_RATE");
  }
  const tg = await sendTg(env, deps, formatPick({ ...out, items }, now));
  return jsonRes(tg.ok ? { ok: true, v: 1, saved: true } : { ok: true, v: 1, saved: false, diag: tg.diag });
}

export async function handlePick(ctx: FindCtx, deps: Deps = realDeps()): Promise<Response> {
  const src = pickOrigin(ctx.request);
  const res = await handle(ctx, deps, src);
  return src === "old" ? withCors(res) : res;
}
