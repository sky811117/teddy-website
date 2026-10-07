#!/usr/bin/env node
/**
 * find-preview.mjs — 在自己的電腦上預覽「找房小幫手」整條流程（不連任何外部主機）。
 *
 * 做什麼：
 *   1. 在 127.0.0.1 開一個小伺服器，提供 dist/（要先 build）的靜態檔。
 *   2. /api/find/* 用真正的 Function 程式碼（src/lib/find/handlers.ts）處理，上游換成「本機假的小幫手」，
 *      人機驗證換成假的（頁面會自動拿到假 token，不載入任何外部腳本）。
 *   3. /share/qa… 回一頁本機假的推薦頁（內容明顯是示範用），並套用真正的注入區塊（揭露、個人化重點、回官網）。
 *
 * 用法：
 *   node scripts/find-preview.mjs [--port 4321] [--dist dist] [--mode done|fast|slow|empty|degraded|down|intake]
 *   模式：done 約 40 秒做完（預設）｜fast 約 6 秒｜slow 130 秒才做完（看「比平常久」）｜empty 找不到符合的｜
 *         degraded 系統忙（改由景泰親自回覆）｜down 後端連不上（降級收件）｜intake 後端關閉（只收件）
 *
 * 安全：只綁 127.0.0.1；沒有任何對外連線（假上游、假驗證、假 TG 都在記憶體裡）；不寫任何檔案（暫存打包放系統暫存夾）。
 * 終端機只印事件名稱與計數，不印你在頁面上輸入的任何內容。
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = parseInt(opt("--port", "4321"), 10);
const DIST = path.resolve(ROOT, opt("--dist", "dist"));
const MODE = opt("--mode", "done");
const MODES = ["done", "fast", "slow", "empty", "degraded", "down", "intake"];
if (!MODES.includes(MODE)) { console.error("--mode 只能是：" + MODES.join("｜")); process.exit(2); }
if (!fs.existsSync(path.join(DIST, "find", "index.html"))) { console.error("找不到 " + path.join(DIST, "find/index.html") + "：請先建置（見交接文件的『怎麼預覽』）。"); process.exit(2); }

/* ---------- 把 Function 程式碼打包後載入（記憶體內的假環境，不連網） ---------- */
function load(rel) {
  const out = buildSync({ entryPoints: [path.join(ROOT, rel)], bundle: true, format: "esm", platform: "neutral", target: "es2022", write: false, logLevel: "silent" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-preview-"));
  const file = path.join(dir, path.basename(rel).replace(/\.ts$/, ".mjs"));
  fs.writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
const H = await load("src/lib/find/handlers.ts");
const SH = await load("src/lib/find/shareqa.ts");

const ORIGIN = `http://127.0.0.1:${PORT}`;
const UP = "https://upstream.invalid";
const ENV = {
  FIND_ENABLED: MODE === "intake" ? "0" : "1",
  FIND_UPSTREAM_URL: UP,
  FIND_HMAC_SECRET: "preview-secret-not-real",
  FIND_IP_SALT: "preview-salt",
  TURNSTILE_SECRET_KEY: "preview-ts-secret",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",   // Cloudflare 官方「永遠通過」測試用 Site Key（格式要合 publicSiteKey 的檢查；預覽不載入外部腳本，只是個字串）
  CONTACT_TG_TOKEN: "preview-tg-token",
  CONTACT_TG_CHAT: "1",
};

/* ---------- 推薦頁代號（本機產生，格式與正式相同） ---------- */
function mkQaId(daysFromNow) {
  const day = SH.dayIndex(Date.now()) + daysFromNow;
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  const rnd = crypto.randomBytes(26);
  let tail = "";
  for (let i = 0; i < 26; i++) tail += A[rnd[i] % 32];
  return "qa" + day.toString(36).padStart(4, "0") + tail;
}
const LIVE_ID = mkQaId(30);
const EXPIRED_ID = mkQaId(-1);

/* ---------- 假上游 ---------- */
const jobs = new Map();
const rid = () => "a" + crypto.randomBytes(16).toString("base64url").slice(0, 22);
const logEv = s => console.log("  " + s);

function statusFor(job) {
  const t = (Date.now() - job.t0) / 1000;
  const doneUrl = `https://teddy-house.tw/share/${LIVE_ID}/`;
  if (MODE === "fast") return t < 2 ? { status: "queued", queue: { ahead: 0, eta_s: 5 } } : t < 4 ? { status: "searching" } : t < 6 ? { status: "building" } : { status: "done", shareUrl: doneUrl, count: 3 };
  if (MODE === "slow") return t < 130 ? { status: "searching" } : { status: "done", shareUrl: doneUrl, count: 3 };
  if (MODE === "empty") return t < 4 ? { status: "queued", queue: { ahead: 0, eta_s: 10 } } : t < 12 ? { status: "searching" } : { status: "empty", hint: ["loosen_price", "loosen_district"] };
  if (MODE === "degraded") return t < 4 ? { status: "queued", queue: { ahead: 3, eta_s: 200 } } : { status: "degraded", kind: "busy" };
  return t < 6 ? { status: "queued", queue: { ahead: 1, eta_s: 40 } } : t < 28 ? { status: "searching" } : t < 40 ? { status: "building" } : { status: "done", shareUrl: doneUrl, count: 3 };
}

async function fakeFetch(url, init = {}) {
  const u = String(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://challenges.cloudflare.com/")) return json({ success: true, hostname: "teddy-house.tw", action: "find" });
  if (u.startsWith("https://api.telegram.org/")) {
    let n = 0;
    try { n = JSON.parse(String(init.body)).text.length; } catch { /* ignore */ }
    logEv(`[收件] 這一筆會推到景泰的 TG（本機預覽沒有真的送；文字長度 ${n}）`);
    return json({ ok: true });
  }
  if (!u.startsWith(UP + "/aif/v1/")) throw new Error("預覽不連外部：" + u.slice(0, 30));
  if (MODE === "down") throw new TypeError("preview: upstream down");
  const p = u.slice((UP + "/aif/v1/").length).split("?")[0];
  if (p === "health") return json({ ok: true, v: 1, mode: "live", queue: { len: 0, eta_s: 0 } });
  if (p === "submit") {
    const id = rid();
    jobs.set(id, { t0: Date.now() });
    logEv(`[送出] 工作編號已建立（模式 ${MODE}）`);
    return json({ ok: true, v: 1, status: "queued", jobId: id, queue: { ahead: 1, eta_s: 40 }, saved: true });
  }
  if (p === "status") {
    const id = new URL(u).searchParams.get("id") || "";
    const job = jobs.get(id);
    if (!job) return json({ ok: false, code: "E_NOT_FOUND" }, 404);
    return json({ ok: true, v: 1, ...statusFor(job) });
  }
  if (p === "contact") { logEv("[留言] 收到聯絡方式（內容不顯示）"); return json({ ok: true, saved: true }); }
  if (p === "feedback") {
    try { const b = JSON.parse(String(init.body)); logEv(`[回饋] 評分 ${b.rating}｜標籤 ${(b.tags || []).join(",") || "無"}｜${b.text ? "有一句話" : "沒有留話"}`); } catch { /* ignore */ }
    return json({ ok: true });
  }
  if (p === "event") {
    try { const b = JSON.parse(String(init.body)); logEv(`[事件] ${(b.events || []).map(e => e.e + (e.s ? "@" + e.s : "")).join(" ")}`); } catch { /* ignore */ }
    return json({ ok: true, n: 1 });
  }
  // 小遊戲排行榜（本機假榜：只記在記憶體；真正的暱稱過濾與合理性檢查在家用機，這裡只做最簡單的「同工作留最高」）
  // 暱稱：去掉空白、剪 8 字；含「官方」「客服」或 6 位以上連續數字就換成「訪客XXXX」（模擬沒通過過濾，看前端的「沒通過檢查」提示）
  if (p === "score") {
    try {
      const raw = typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body);   // forward() 送的是位元組
      const b = JSON.parse(raw);
      const old = board.get(b.jid);
      if (b.floors > 0 && (!old || b.floors > old.floors)) board.set(b.jid, { floors: b.floors, name: fakeName(b.name, b.jid) || (old && old.name) || guestOf(b.jid), t: Date.now() });
      else if (old && b.floors === old.floors && b.name) old.name = fakeName(b.name, b.jid) || old.name;   // 合約：同一工作同層數再送一次＝更新暱稱
      logEv(`[排行] 收到成績 ${b.floors} 層`);
    } catch { /* ignore */ }
    return json({ ok: true, v: 1, saved: true });
  }
  if (p === "top") {
    const id = new URL(u).searchParams.get("id");
    const all = [...board.entries()].sort((a, b) => b[1].floors - a[1].floors || a[1].t - b[1].t);
    const list = all.slice(0, 10).map(([, r], i) => ({ rank: i + 1, name: r.name, floors: r.floors }));
    const idx = id ? all.findIndex(([k]) => k === id) : -1;
    const me = idx >= 0 ? { rank: idx + 1, floors: all[idx][1].floors, weekRank: idx + 1 } : null;
    return json({ ok: true, v: 1, week: list, all: list, me });
  }
  return json({ ok: false }, 404);
}
const board = new Map();
const guestOf = jid => "訪客" + jid.slice(1, 5).toUpperCase();
function fakeName(n, jid) {
  const t = Array.from(String(n || "").normalize("NFKC").replace(/\s+/g, "")).slice(0, 8).join("");
  if (!t) return "";
  return /官方|客服|[0-9]{6,}/.test(t) ? guestOf(jid) : t;
}
const deps = { fetch: fakeFetch, now: () => Date.now() };

/* ---------- 靜態檔 ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
// 假驗證：頁面會呼叫 window.turnstile.render，這裡直接給一個假 token，不載入外部腳本
const TS_SHIM = `<script>window.turnstile={render:function(el,o){setTimeout(function(){try{o.callback&&o.callback('preview-token')}catch(e){}},60);return 1},reset:function(){}};</script>`;

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.includes("\0")) { res.writeHead(400).end(); return; }
  let p = path.normalize(path.join(DIST, rel));
  if (!p.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) {
    const nf = path.join(DIST, "404.html");
    res.writeHead(404, { "content-type": MIME[".html"] }).end(fs.existsSync(nf) ? fs.readFileSync(nf) : "not found");
    return;
  }
  const ext = path.extname(p).toLowerCase();
  let body = fs.readFileSync(p);
  const headers = { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" };
  if (ext === ".html" && /[\\/]find[\\/]index\.html$/.test(p)) body = Buffer.from(body.toString("utf8").replace("<head>", "<head>" + TS_SHIM));
  res.writeHead(200, headers).end(body);
}

/* ---------- 假推薦頁 ---------- */
function fakeSharePage() {
  const card = (t, d) => `<section style="max-width:720px;margin:14px auto;padding:16px;border:1px solid #d6c3a2;border-radius:12px;background:#fffdf8"><h2 style="margin:0 0 6px;font-size:19px">${t}</h2><p style="margin:0;color:#5a4d44">${d}</p></section>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>推薦頁（本機預覽用的假頁面）</title></head><body style="margin:0;background:#f5f1eb;font:17px/1.75 -apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;color:#2c2522"><h1 style="max-width:720px;margin:24px auto 8px;padding:0 16px;font-size:24px">示範推薦頁</h1>${card("示範物件 A", "這是本機預覽用的假內容，不是真的物件。")}${card("示範物件 B", "真正的推薦頁由推薦頁產生器做出來。")}${card("示範物件 C", "這裡只是讓你看揭露區塊、重點整理與回官網區塊長怎樣。")}</body></html>`;
}
async function serveShare(urlPath, res) {
  const id = urlPath.split("?")[0].split("/").filter(Boolean)[1];
  const qa = SH.parseQa(id);
  if (qa && SH.isQaExpired(qa.expDay, Date.now())) {
    const r = SH.expiredResponse();
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text());
    return;
  }
  if (!qa) { res.writeHead(404, { "content-type": MIME[".html"] }).end("not found"); return; }
  const html = SH.injectQaBlocks(fakeSharePage(), ORIGIN);
  // 正式環境由 functions/share/[[path]].ts 補 x-robots-tag 與 meta noindex；這裡只模擬標頭
  res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "private, max-age=0", "x-robots-tag": "noindex, nofollow" }).end(html);
}

/* ---------- 主迴圈 ---------- */
async function readBody(req, max = 64 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > max) break; chunks.push(c); }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    if (url.pathname.startsWith("/api/find/")) {
      const name = url.pathname.slice("/api/find/".length);
      const fn = { config: H.handleConfig, submit: H.handleSubmit, status: H.handleStatus, contact: H.handleContact, event: H.handleEvent, feedback: H.handleFeedback, score: H.handleScore, top: H.handleTop }[name];
      if (!fn) { res.writeHead(404).end(); return; }
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const request = new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, body });
      const pending = [];
      const r = await fn({ request, env: ENV, waitUntil: p => pending.push(p) }, deps);
      let text = await r.text();
      text = text.split("https://teddy-house.tw/share/").join(ORIGIN + "/share/"); // 預覽專用：推薦頁連到本機這份假頁面
      res.writeHead(r.status, Object.fromEntries(r.headers)).end(text);
      await Promise.allSettled(pending);
      return;
    }
    if (url.pathname.startsWith("/share/")) { await serveShare(url.pathname, res); return; }
    serveStatic(url.pathname, res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("預覽伺服器內部錯誤：" + String(e && e.message).slice(0, 80));
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`找房小幫手本機預覽（模式：${MODE}）— 只綁 127.0.0.1，沒有任何對外連線。按 Ctrl+C 結束。`);
  console.log(`  首頁            ${ORIGIN}/`);
  console.log(`  找房小幫手      ${ORIGIN}/find/    （來源標記試試 ${ORIGIN}/find/?from=line ）`);
  console.log(`  推薦頁（有效）  ${ORIGIN}/share/${LIVE_ID}/`);
  console.log(`  推薦頁（過期）  ${ORIGIN}/share/${EXPIRED_ID}/`);
  console.log(`  隱私權政策      ${ORIGIN}/privacy/`);
});
