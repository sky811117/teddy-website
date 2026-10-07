/**
 * 等待小遊戲「蓋大樓」排行榜：官網 Function 這一側的驗證、回應白名單與簡單限流（2026-10-07）。
 *
 * 分工：暱稱的完整過濾（8 字、電話／網址／LINE／髒話／政治／品牌字…→「訪客」＋雜湊）、合理性檢查、只收有效工作、
 * 同一工作只留最高分、同一工作 1 分鐘 6 次 —— 全部在家用機（mp_aif_scores.py）。
 * 這裡只做：結構檢查（格式不對就 400，不轉送）、暱稱粗剪（normText、最多 16 字，最後一關在家用機）、
 * 家用機回來的排行再過一次白名單（名次、層數範圍、暱稱長度與「不像連結」），以及每 IP 每分鐘的記憶體限流。
 */
import { JOB_ID_RE, hideLinks, isObj, normText } from "./schema";

export const SCORE_MAX_BYTES = 2 * 1024;
export const FLOORS_MAX = 300;
export const MS_SCHEMA_MAX = 86400000;
/** 官網端只做粗剪（家用機再剪到 8 字並過濾）；太長的直接截斷，不報錯 */
export const NAME_IN_MAX = 16;
export const NAME_OUT_MAX = 8;
export const TOP_N = 10;
export const GUEST = "訪客";

export type ScoreClean = { jid: string; floors: number; ms: number; perfect: number | null; name: string };
export type TopRow = { rank: number; name: string; floors: number };
export type TopMe = { rank: number; floors: number; weekRank: number | null };
export type TopView = { week: TopRow[]; all: TopRow[]; me: TopMe | null };

const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/**
 * 瀏覽器送來的成績 {jobId, floors, ms, perfect?, name?, v?}。
 * 必要欄位不合法（jobId 格式、floors 0～300 整數、ms 0～86400000 整數、v 有帶但不是 1）→ null（呼叫端回 400）；
 * 可選欄位不合法只丟那一個（perfect→null、name→""）。合理性（每層 0.6 秒、30 分鐘、perfect≤floors）不在這裡判斷。
 */
export function validateScore(b: unknown): ScoreClean | null {
  if (!isObj(b)) return null;
  if (b.v !== undefined && b.v !== 1) return null;
  const jid = b.jobId;
  if (typeof jid !== "string" || !JOB_ID_RE.test(jid)) return null;
  const floors = intIn(b.floors, 0, FLOORS_MAX);
  const ms = intIn(b.ms, 0, MS_SCHEMA_MAX);
  if (floors === null || ms === null) return null;
  const perfect = intIn(b.perfect, 0, FLOORS_MAX);
  const name = typeof b.name === "string" ? Array.from(normText(b.name).trim()).slice(0, NAME_IN_MAX).join("") : "";
  return { jid, floors, ms, perfect, name };
}

/**
 * 家用機輸出的暱稱只會有這些字：英數、中文、注音、常見中文標點（全形，跟家用機 _KEEP_PUNCT 同一張表）。
 * 不能用 normText 比對——NFKC 會把家用機刻意保留的全形！？，…變回半形。
 * 2026-10-07 審查 SCORE-L1：「·」「・」拿掉了（看起來像點，abc·tw 會變成看得懂的網址），兩邊同步。
 */
const NAME_OUT_RE = /^[A-Za-z0-9一-鿿㐀-䶿ㄅ-ㄯ！？，。、～…「」『』（）：；—_-]+$/u;

/** 家用機回來的暱稱再保險一次：只准上面那些字、最多 8 字、沒有 6 位以上連續數字（沒有 @ # / : . 就組不出網址或 Email）；不合格一律「訪客」。 */
export function safeName(v: unknown): string {
  if (typeof v !== "string" || !NAME_OUT_RE.test(v) || Array.from(v).length > NAME_OUT_MAX) return GUEST;
  if (/[0-9]{6,}/.test(v) || hideLinks(v) !== normText(v).replace(/\s+/g, " ").trim()) return GUEST;
  return v;
}

function rows(v: unknown): TopRow[] | null {
  if (!Array.isArray(v)) return null;
  const out: TopRow[] = [];
  for (const r of v.slice(0, TOP_N)) {
    if (!isObj(r)) continue;
    const floors = intIn(r.floors, 1, FLOORS_MAX);
    if (floors === null) continue;
    out.push({ rank: out.length + 1, name: safeName(r.name), floors });
  }
  return out;
}

/** 家用機 /aif/v1/top 的回應 → 白名單格式。看不懂回 null（呼叫端改回快取或空榜）。 */
export function sanitizeTop(j: unknown): TopView | null {
  if (!isObj(j) || j.ok !== true) return null;
  const week = rows(j.week);
  const all = rows(j.all);
  if (!week || !all) return null;
  let me: TopMe | null = null;
  if (isObj(j.me)) {
    const rank = intIn(j.me.rank, 1, 1000000);
    const floors = intIn(j.me.floors, 1, FLOORS_MAX);
    const wr = j.me.weekRank === null || j.me.weekRank === undefined ? null : intIn(j.me.weekRank, 1, 1000000);
    if (rank !== null && floors !== null) me = { rank, floors, weekRank: wr };
  }
  return { week, all, me };
}

/**
 * 每個 isolate 自己的記憶體滑動視窗（Function 沒有 KV／跨請求狀態）。
 * ⚠️ 限制：Cloudflare 會開很多個 isolate、冷啟動就清空，所以這只是「同一台邊緣節點上的粗略上限」，不是全域限流；
 * 真正的保護是家用機的「同一工作 1 分鐘 6 次」與 Cloudflare 後台的 WAF 速率限制。鍵太多就整個清掉（寧可放過也不吃光記憶體）。
 */
export class MemWindow {
  private m = new Map<string, number[]>();
  private lastSweep = 0;
  private readonly cap: number;
  constructor(cap = 5000) {
    this.cap = cap;
  }
  hit(key: string, limit: number, windowMs: number, now: number): boolean {
    if (now - this.lastSweep >= windowMs || this.m.size > this.cap) this.sweep(now, windowMs);
    const arr = (this.m.get(key) ?? []).filter(t => now - t < windowMs);
    if (arr.length >= limit) {
      this.m.set(key, arr);
      return false;
    }
    arr.push(now);
    this.m.set(key, arr);
    return true;
  }
  sweep(now: number, windowMs: number): void {
    for (const [k, a] of this.m) {
      const b = a.filter(t => now - t < windowMs);
      if (b.length) this.m.set(k, b);
      else this.m.delete(k);
    }
    if (this.m.size > this.cap) this.m.clear();
    this.lastSweep = now;
  }
  clear(): void {
    this.m.clear();
    this.lastSweep = 0;
  }
  get size(): number {
    return this.m.size;
  }
}
