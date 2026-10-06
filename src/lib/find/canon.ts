/**
 * 官網 Function → 家用機：HMAC 簽章（Web Crypto，無依賴）。
 *
 * 簽章字串（\n 分隔、無結尾換行、UTF-8）：
 *   AIF1 / METHOD 大寫 / PATH（含查詢字串，原樣）/ X-Aif-Ts / X-Aif-Nonce / sha256(本文位元組) 小寫十六進位
 * X-Aif-Sig = hex(HMAC-SHA256(secret_utf8, 簽章字串_utf8))；X-Aif-Kid = sha256(secret) 前 8 字元。
 * 簽的是「實際送出的位元組」，所以本文只序列化一次。
 */
const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message) as BufferSource));
}

export function canonString(method: string, pathQs: string, ts: string, nonce: string, bodyHashHex: string): string {
  return ["AIF1", method.toUpperCase(), pathQs, ts, nonce, bodyHashHex].join("\n");
}

export async function keyId(secret: string): Promise<string> {
  return (await sha256Hex(secret)).slice(0, 8);
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

export type SignInput = {
  secret: string;
  method: string;
  pathQs: string;
  body: Uint8Array | null;
  ts?: string;
  nonce?: string;
  now?: number;
};

export async function signRequest(i: SignInput): Promise<{ headers: Record<string, string>; sig: string; canon: string }> {
  const ts = i.ts ?? String(Math.floor((i.now ?? Date.now()) / 1000));
  const nonce = i.nonce ?? randomHex(16);
  const bodyHash = await sha256Hex(i.body ?? new Uint8Array(0));
  const canon = canonString(i.method, i.pathQs, ts, nonce, bodyHash);
  const sig = await hmacHex(i.secret, canon);
  return {
    sig,
    canon,
    headers: {
      "X-Aif-Ts": ts,
      "X-Aif-Nonce": nonce,
      "X-Aif-Kid": await keyId(i.secret),
      "X-Aif-Sig": sig,
    },
  };
}

/**
 * 把 IP 收斂成「限流單位」：IPv4 原樣；IPv6 只留前 64 位元（/64）。
 * 一個使用者通常拿到整段 /64，可以任意換後面的位址；不收斂的話，每次換位址都是新的來源，防灌爆限流等於沒有。
 * IPv4-mapped（::ffff:a.b.c.d）當成 IPv4。看不懂的格式原樣回傳（寧可嚴格分桶，不要放行）。
 */
export function maskIp(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];
  if (!raw.includes(":")) return raw;
  let head = raw;
  let tail = "";
  const dbl = raw.indexOf("::");
  if (dbl >= 0) {
    head = raw.slice(0, dbl);
    tail = raw.slice(dbl + 2);
  }
  const h = head === "" ? [] : head.split(":");
  const t = tail === "" ? [] : tail.split(":");
  if (dbl < 0 && h.length !== 8) return raw;
  if (dbl >= 0 && h.length + t.length > 7) return raw;
  const full = dbl >= 0 ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (full.length !== 8 || full.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return raw;
  return full.slice(0, 4).map(x => x.padStart(4, "0")).join(":") + "::/64";
}

/**
 * 客人 IP 的每日輪替雜湊：HMAC(salt, "ip:YYYYMMDD(UTC):" + 收斂後的 IP) 前 16 字元。
 * 沒有鹽或沒有 IP 就不給（寧可沒有也不用弱雜湊）；呼叫端缺鹽時要把整個查詢功能當成「沒設定完成」（fail-closed）。
 */
export async function ipHash(salt: string | undefined, ip: string | null, nowMs: number): Promise<string | null> {
  const s = (salt ?? "").trim();
  if (!s || !ip) return null;
  const d = new Date(nowMs);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return (await hmacHex(s, `ip:${ymd}:${maskIp(ip)}`)).slice(0, 16);
}

export function uaKind(ua: string | null): "m" | "d" | "t" | "b" {
  if (!ua) return "b";
  if (/bot|crawl|spider|slurp|curl|wget|python|httpclient|headless|scrapy|node-fetch|axios|go-http/i.test(ua)) return "b";
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "t";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "m";
  return "d";
}
