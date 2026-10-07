// 推薦頁「傳給景泰」（2026-10-07）：
//   伺服器端 /api/find/pick（src/lib/find/pick.ts）、官網代理的注入（src/lib/find/sharepick.ts＋functions/share/[[path]].ts）、
//   瀏覽器端 public/js/share-pick.js（純函式＋假 DOM 整段流程）。全部離線：fetch 用假的、不連任何真實主機。
// 2026-10-07 審查修正：R1 舊網址也注入＋跨網域送到正式網域（CORS 只開給舊網址）、R3 伺服器端核對推薦頁（代號／本人頁／slug／名稱用頁面的字）、
//   R4 同事頁內文寫到 true 那句不注入、R5 honeypot 名稱與紀錄、R6 列印不留底部空白。
// 2026-10-07 第二版：喜歡通知（kind:"like"）——客人新按下「我喜歡」就由官網推 Telegram（限流另外一桶、預覽旗標不送、載入時已喜歡不送）。
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { ROOT, bundleTs, requireClassic } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock, flush, click, submit, ev } from "./fake_dom.mjs";

const P = (await bundleTs("src/lib/find/pick.ts")).mod;
const SP = (await bundleTs("src/lib/find/sharepick.ts")).mod;
const PROXY = (await bundleTs("functions/share/[[path]].ts")).mod;
const QA = (await bundleTs("src/lib/find/shareqa.ts")).mod;
const WRAP = (await bundleTs("functions/api/find/pick.ts")).mod;
const CLIENT_SRC = fs.readFileSync(path.join(ROOT, "public/js/share-pick.js"), "utf8");
const C = requireClassic("public/js/share-pick.js");
const parse5 = await loadParse5();

const NOW = Date.UTC(2026, 9, 7, 6, 30, 0);   // 台灣時間 2026-10-07 14:30
const OLD = "https://teddy-website-blog.pages.dev";
const ORIGIN = { origin: "https://teddy-house.tw" };
const TG_ENV = { FIND_TG_TOKEN: "find-token", FIND_TG_CHAT: "11", CONTACT_TG_TOKEN: "contact-token", CONTACT_TG_CHAT: "22" };
const PAGES = "https://sky811117.github.io/teddy-shares/";
const RAW = "https://raw.githubusercontent.com/sky811117/teddy-shares/main/";

/* ---------- 推薦頁樣本（照推薦頁產生器的標記：卡片、我喜歡按鈕、單獨一行的 LIKE_NOTIFY） ---------- */
const h = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const card = (slug, title, price, area, liked = false) => `
<div class="card" data-slug="${h(slug)}" data-district="北屯區" data-community="${h(title.split(" ")[0])}">
  <div class="card-content">
    <div class="card-tagline">${h(title)}</div>
    <div class="card-price-row"><div><span class="card-price">${h(price)}</span><span class="card-price-unit">萬</span></div><div class="card-floor">10</div></div>
    <div class="card-spec"><div class="spec-item"><span class="spec-label">權狀坪數</span><span class="spec-value highlight">${h(area)} 坪</span></div><div class="spec-item"><span class="spec-label">格局</span><span class="spec-value">2房2廳1衛</span></div></div>
    <div class="card-actions"><button class="card-like card-like-full${liked ? " liked" : ""}" data-slug="${h(slug)}" data-name="${h(title)}" aria-label="我喜歡這間" type="button"><span class="card-like-icon">♡</span><span class="card-like-text">我喜歡</span></button></div>
  </div>
</div>`;
const CARDS = card("q1a2b3c4d5", "測試社區A 10樓 2房", "1,338", "37.57") + card("q9z8y7x6w5", "測試社區B 12樓 3房", "1,980", "45.2") + card("q5k5k5k5k5", "測試社區C 8樓 2房", "1,200", "30.1");
const script = (notify, clientName = "王小姐") => `<script>
(function() {
  var SHARE_ID = "qsAbCd1234";
  var CLIENT_NAME = ${JSON.stringify(clientName)};
  var LIKE_NOTIFY = ${notify ? "true" : "false"};   // 同事頁＝false：只顯示已收藏、不推播
})();
</script>`;
const SHARE_HTML = ({ withLine = true, notify = true, cards = CARDS, title = "為王小姐精選" } = {}) => `<!doctype html><html><head><title>${h(title)}</title></head><body>
<div class="grid">${cards}</div>
<footer class="footer"><a class="contact-item" href="tel:0900000000">電話</a>${withLine ? '<a class="contact-item" href="https://line.me/ti/p/~teddy_line_test" target="_blank">LINE</a>' : ""}</footer>
${script(notify)}
</body></html>`;
const OWNER_PAGE = SHARE_HTML();
const MATE_PAGE = SHARE_HTML({ notify: false });

const good = (over = {}) => ({
  share_id: "qsAbCd1234",
  items: [{ slug: "q1a2b3c4d5", name: "測試社區A 10樓 2房｜1,338 萬｜37.57 坪" }, { slug: "q9z8y7x6w5", name: "測試社區B 12樓 3房｜1,980 萬｜45.2 坪" }],
  name: "王小姐", line: "teddy_test01", note: "想約週末看第 1 間", consent: true, hp: "", ...over,
});

const htmlRes = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
/** 假網路：Telegram＋推薦頁上游（Pages／raw）。page(url) 回 Response；預設每個代號都是景泰本人頁。 */
function net({ tg = () => Response.json({ ok: true }), page = () => htmlRes(OWNER_PAGE) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("https://api.telegram.org/")) return tg(u, init);
    if (u.startsWith(PAGES) || u.startsWith(RAW)) return page(u, init);
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { calls, deps: { fetch: fetchImpl, now: () => NOW } };
}
const tgCalls = n => n.calls.filter(c => c.url.startsWith("https://api.telegram.org/"));
const pageCalls = n => n.calls.filter(c => c.url.startsWith(PAGES) || c.url.startsWith(RAW));
const botOf = c => c.url.slice("https://api.telegram.org/bot".length).split("/")[0];
const textOf = c => JSON.parse(c.init.body).text;
function req(body, { method = "POST", headers = {}, url = "https://teddy-house.tw/api/find/pick", env = TG_ENV } = {}) {
  const init = { method, headers: { "content-type": "application/json", ...ORIGIN, "cf-connecting-ip": "203.0.113.7", ...headers } };
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") init.body = typeof body === "string" ? body : JSON.stringify(body);
  return { request: new Request(url, init), env };
}
const jsonOf = async res => JSON.parse(await res.text());
/** 暫時接住 console.warn（logFail 的輸出），測試完還原 */
function withWarn(fn) {
  const con = globalThis.console;
  const real = con.warn;
  const logs = [];
  con.warn = (...a) => logs.push(a.join(" "));
  return Promise.resolve(fn(logs)).finally(() => { con.warn = real; });
}

/* ===================== 伺服器端：驗證 ===================== */
test("validatePick：合法本文重組成白名單欄位（多的鍵丟掉、重複的物件只留一次、空白縮成一個）", () => {
  const { out, err } = P.validatePick({ ...good({ name: "  王  小姐 ", extra: "x" }), items: [...good().items, good().items[0]] });
  assert.equal(err, null);
  assert.deepEqual(Object.keys(out).sort(), ["items", "line", "name", "note", "phone", "share_id"]);
  assert.equal(out.name, "王 小姐");
  assert.equal(out.items.length, 2);
  assert.equal(out.phone, "");
});

test("validatePick：各種不合格 → 對應的錯誤代碼", () => {
  const E = b => P.validatePick(b).err;
  assert.equal(E(null), "E_BAD_REQUEST");
  assert.equal(E([]), "E_BAD_REQUEST");
  for (const id of ["", "abc", "a".repeat(41), "qs-AbCd1234", "qs/../x", "ｑｓAbCd1234"]) assert.equal(E(good({ share_id: id })), "E_BAD_REQUEST", id);
  assert.equal(E(good({ items: [] })), "E_BAD_REQUEST");
  assert.equal(E(good({ items: Array.from({ length: 13 }, (_, i) => ({ slug: "s" + i, name: "x" })) })), "E_BAD_REQUEST", "超過 12 間");
  assert.equal(E(good({ items: Array.from({ length: 12 }, (_, i) => ({ slug: "s" + i, name: "x" })) })), null, "12 間剛好");
  assert.equal(E(good({ items: [{ slug: "bad slug", name: "x" }] })), "E_BAD_REQUEST");
  assert.equal(E(good({ items: [{ slug: "ok", name: "" }] })), "E_BAD_REQUEST");
  assert.equal(E(good({ items: [{ slug: "ok", name: 5 }] })), "E_BAD_REQUEST");
  assert.equal(E(good({ items: [{ slug: "ok", name: "字".repeat(60) }] })), null);
  assert.equal(E(good({ items: [{ slug: "ok", name: "字".repeat(61) }] })), "E_TOO_LARGE");
  assert.equal(E(good({ name: "字".repeat(20) })), null);
  assert.equal(E(good({ name: "字".repeat(21) })), "E_TOO_LARGE");
  assert.equal(E(good({ note: "字".repeat(200) })), null);
  assert.equal(E(good({ note: "字".repeat(201) })), "E_TOO_LARGE");
  assert.equal(E(good({ name: 123 })), "E_BAD_REQUEST");
  assert.equal(E(good({ line: "含中文" })), "E_BAD_REQUEST");
  assert.equal(E(good({ line: "", phone: "abc" })), "E_BAD_REQUEST");
  assert.equal(E(good({ line: "", phone: "1234567" })), "E_BAD_REQUEST", "電話太短");
  assert.equal(E(good({ line: "", phone: "0912345678" })), null);
  assert.equal(E(good({ line: "", phone: "" })), "E_BAD_REQUEST", "LINE、手機都沒填");
  assert.equal(E(good({ line: undefined, phone: undefined })), "E_BAD_REQUEST");
  assert.equal(E(good({ consent: false })), "E_CONSENT");
  assert.equal(E(good({ consent: "true" })), "E_CONSENT");
});

/* ===================== 伺服器端：端點 ===================== */
test("POST /api/find/pick：先核對推薦頁（讀 Pages 一次）再送找房機器人一次，回應只有白名單鍵 {ok, v, saved}", async () => {
  P.resetPickState();
  const n = net();
  const res = await P.handlePick(req(good()), n.deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), null, "同源請求不帶 CORS");
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: true });
  assert.deepEqual(pageCalls(n).map(c => c.url), [PAGES + "qsAbCd1234/"]);
  assert.equal(pageCalls(n)[0].init.redirect, "manual", "不跟上游轉址");
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token"]);
  const body = JSON.parse(tgCalls(n)[0].init.body);
  assert.equal(body.parse_mode, "HTML");
  assert.equal(body.disable_web_page_preview, true);
  assert.equal(body.chat_id, "11");
});

test("Telegram 訊息格式：標題含間數、稱呼、聯絡、每間一行（名稱取自推薦頁）、留言、推薦頁網址、台灣時間；不含 IP", async () => {
  P.resetPickState();
  const n = net();
  await P.handlePick(req(good({ phone: "0912-345-678" })), n.deps);
  const t = textOf(tgCalls(n)[0]);
  const lines = t.split("\n");
  assert.equal(lines[0], "【推薦頁｜客人選了 2 間】");
  assert.equal(lines[1], "稱呼：<code>王小姐</code>");
  assert.equal(lines[2], "聯絡：LINE <code>teddy_test01</code>｜手機 <code>0912-345-678</code>（客人已勾選同意）");
  assert.equal(lines[3], "選的物件：");
  assert.equal(lines[4], "1. <code>測試社區A 10樓 2房|1,338 萬|37.57 坪</code>");
  assert.equal(lines[5], "2. <code>測試社區B 12樓 3房|1,980 萬|45.2 坪</code>");
  assert.equal(lines[6], "留言：<code>想約週末看第 1 間</code>");
  assert.equal(lines[7], "推薦頁：https://teddy-house.tw/share/qsAbCd1234/");
  assert.equal(lines[8], "時間：2026-10-07 14:30（台灣時間）");
  assert.equal(lines.length, 9);
  assert.ok(!t.includes("203.0.113.7"), "訊息不含 IP");
});

test("R3：物件名稱一律用推薦頁上的字，客戶端送來的名稱（自己編的字）不會進 Telegram", async () => {
  P.resetPickState();
  const n = net();
  const res = await P.handlePick(req(good({ items: [{ slug: "q5k5k5k5k5", name: "免費送房 快加我 LINE xyz" }] })), n.deps);
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: true });
  const t = textOf(tgCalls(n)[0]);
  assert.ok(t.includes("1. <code>測試社區C 8樓 2房|1,200 萬|30.1 坪</code>"));
  assert.ok(!t.includes("免費送房") && !t.includes("xyz"));
});

test("R3：假代號（Pages 與原始檔都 404）→ 404、不送；剛產生 Pages 還沒發布 → 改讀原始檔，照常送", async () => {
  P.resetPickState();
  let n = net({ page: () => htmlRes("nope", 404) });
  const r = await P.handlePick(req(good()), n.deps);
  assert.equal(r.status, 404);
  assert.equal((await jsonOf(r)).code, "E_NOT_FOUND");
  assert.deepEqual(pageCalls(n).map(c => c.url), [PAGES + "qsAbCd1234/", RAW + "qsAbCd1234/index.html"]);
  assert.equal(tgCalls(n).length, 0);
  n = net({ page: u => (u.startsWith(RAW) ? new Response(OWNER_PAGE, { headers: { "content-type": "text/plain" } }) : htmlRes("nope", 404)) });
  assert.deepEqual(await jsonOf(await P.handlePick(req(good()), n.deps)), { ok: true, v: 1, saved: true });
  assert.equal(tgCalls(n).length, 1);
});

test("R3：同事頁（LIKE_NOTIFY = false）→ 404、不送；slug 不在頁面上 → 400、不送", async () => {
  P.resetPickState();
  let n = net({ page: () => htmlRes(MATE_PAGE) });
  assert.equal((await P.handlePick(req(good()), n.deps)).status, 404);
  assert.equal(tgCalls(n).length, 0);
  n = net();
  const r = await P.handlePick(req(good({ items: [{ slug: "q1a2b3c4d5", name: "x" }, { slug: "notOnPage1", name: "x" }] })), n.deps);
  assert.equal(r.status, 400);
  assert.equal((await jsonOf(r)).code, "E_BAD_REQUEST");
  assert.equal(tgCalls(n).length, 0);
});

test("R3：上游暫時抓不到（5xx／轉址／不是 HTML／連不上）→ saved:false＋pg- 代碼、不送 Telegram", async () => {
  const cases = [
    [() => htmlRes("x", 503), "pg-h503"],
    [() => new Response(null, { status: 301, headers: { location: "https://evil.example/" } }), "pg-3xx"],
    [() => new Response("{}", { headers: { "content-type": "application/json" } }), "pg-type"],
    [() => { throw new TypeError("fetch failed"); }, "pg-net"],
    [u => (u.startsWith(RAW) ? htmlRes("x", 500) : htmlRes("nope", 404)), "pg-h500"],
  ];
  for (const [page, diag] of cases) {
    P.resetPickState();
    const n = net({ page });
    const r = await P.handlePick(req(good()), n.deps);
    assert.equal(r.status, 200, diag);
    assert.deepEqual(await jsonOf(r), { ok: true, v: 1, saved: false, diag });
    assert.equal(tgCalls(n).length, 0, diag);
  }
});

test("R3：假代號灌不滿 isolate 總量（假的 65 次都 404 之後，真客人照常送得出去）", async () => {
  P.resetPickState();
  const n = net({ page: u => (u.includes("qsReal12345") ? htmlRes(OWNER_PAGE) : htmlRes("nope", 404)) });
  for (let i = 0; i < P.PICK_GLOBAL + 5; i++) {
    const s = (await P.handlePick(req(good({ share_id: "qsFake" + String(i).padStart(4, "0") }), { headers: { "cf-connecting-ip": `198.51.100.${i % 250}` } }), n.deps)).status;
    assert.equal(s, 404);
  }
  const r = await P.handlePick(req(good({ share_id: "qsReal12345" }), { headers: { "cf-connecting-ip": "192.0.2.50" } }), n.deps);
  assert.equal(r.status, 200);
  assert.equal(tgCalls(n).length, 1);
});

test("頁面與客人的文字：HTML 跳脫、網址／@帳號／電話換成 [已隱藏]、造不出新的一行；聯絡欄位照實傳", async () => {
  P.resetPickState();
  const evilCards = card("s1", "<script>alert(1)</script> evil.example 10樓 </code><a href=x>", "1,000", "20");
  const n = net({ page: () => htmlRes(SHARE_HTML({ cards: evilCards })) });
  const evil = good({
    name: "<b>假</b>\n系統",
    note: "看 https://evil.example/x 或 bit.ly/abc 加 @spam_acc 打 0911222333\n【推薦頁｜客人選了 99 間】",
    items: [{ slug: "s1", name: "隨便" }],
    line: "teddy.test@x",
  });
  const res = await P.handlePick(req(evil), n.deps);
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: true });
  const t = textOf(tgCalls(n)[0]);
  assert.equal(t.split("\n").length, 8, "客人的換行不會變成新的一行");
  assert.ok(!/<script|<b>|<\/b>|<a /.test(t), "標籤被拿掉或跳脫");
  assert.ok(!/evil\.example|bit\.ly|@spam_acc|0911222333/.test(t), "網址、帳號、電話換成 [已隱藏]");
  assert.ok(t.includes("[已隱藏]"));
  assert.equal(t.split("【推薦頁｜").length - 1, 1, "客人造不出第二個標題行");
  assert.ok(t.includes("LINE <code>teddy.test@x</code>"), "客人自己留的 LINE ID 照實傳");
  // 每一個 <code> 都有閉合（Telegram 遇到沒閉合的標籤會整則拒收）
  assert.equal((t.match(/<code>/g) || []).length, (t.match(/<\/code>/g) || []).length);
});

test("沒填稱呼、沒留言：顯示（沒填）／（沒有），只留手機也可以", async () => {
  P.resetPickState();
  const n = net();
  await P.handlePick(req(good({ name: "", note: undefined, line: "", phone: "0912345678" })), n.deps);
  const t = textOf(tgCalls(n)[0]);
  assert.ok(t.includes("稱呼：（沒填）"));
  assert.ok(t.includes("留言：（沒有）"));
  assert.ok(t.includes("聯絡：手機 <code>0912345678</code>（客人已勾選同意）"));
});

test("honeypot 有填：假成功（saved:true），不讀推薦頁、不送 Telegram、不算進限流；但記一筆 pick_fail:hp（R5）", async () => {
  P.resetPickState();
  const n = net();
  await withWarn(async logs => {
    for (const hp of ["http://spam", 1, true]) {
      const j = await jsonOf(await P.handlePick(req(good({ hp })), n.deps));
      assert.deepEqual(j, { ok: true, v: 1, saved: true });
    }
    // 連本文格式不對也一樣假成功（機器人拿不到「哪裡被擋」）
    assert.deepEqual(await jsonOf(await P.handlePick(req({ hp: "x" }), n.deps)), { ok: true, v: 1, saved: true });
    assert.equal(logs.filter(l => l === "find:pick_fail:hp").length, 4, "每一次都記（只記代碼、不記內容）");
    assert.ok(logs.every(l => !l.includes("spam")));
  });
  assert.equal(n.calls.length, 0);
  for (let i = 0; i < 5; i++) assert.equal((await P.handlePick(req(good()), n.deps)).status, 200, "honeypot 沒吃掉真人的額度");
});

test("同源、方法、大小：GET 405、別的網站 403、打在舊網址 403、預覽網址的來源 403、超過 4KB 413、壞 JSON 400；都不送", async () => {
  P.resetPickState();
  const n = net();
  assert.equal((await P.handlePick(req(null, { method: "GET" }), n.deps)).status, 405);
  assert.equal((await P.handlePick(req(good(), { headers: { origin: "https://evil.example" } }), n.deps)).status, 403);
  assert.equal((await P.handlePick(req(good(), { url: OLD + "/api/find/pick", headers: { origin: OLD } }), n.deps)).status, 403, "請求打在舊網址：不收（RT-05）");
  assert.equal((await P.handlePick(req(good(), { headers: { origin: "https://abc123.teddy-website-blog.pages.dev" } }), n.deps)).status, 403, "預覽網址不算");
  assert.equal((await P.handlePick(req(good(), { headers: { origin: OLD + ".evil.example" } }), n.deps)).status, 403);
  assert.equal((await P.handlePick(req(good(), { url: "http://localhost:4321/api/find/pick", headers: { origin: OLD } }), n.deps)).status, 403, "本機只收本機來源");
  const big = good({ note: "字".repeat(1500) });
  assert.ok(new TextEncoder().encode(JSON.stringify(big)).length > 4096);
  assert.equal((await P.handlePick(req(big), n.deps)).status, 413);
  assert.equal((await P.handlePick(req("{not json"), n.deps)).status, 400);
  assert.equal((await P.handlePick(req(good({ consent: false })), n.deps)).status, 400);
  assert.equal(n.calls.length, 0, "上面這些都不讀推薦頁、不送 Telegram");
  // 合法的最大本文（12 間 × 60 字、稱呼 20 字、留言 200 字、40 碼 slug）一定在 4KB 以內
  const max = good({
    name: "字".repeat(20), note: "字".repeat(200),
    items: Array.from({ length: 12 }, (_, i) => ({ slug: "s".repeat(38) + String(i).padStart(2, "0"), name: "字".repeat(60) })),
  });
  const size = new TextEncoder().encode(JSON.stringify(max)).length;
  assert.ok(size <= 4096, String(size));
  const bigPage = SHARE_HTML({ cards: max.items.map(it => card(it.slug, "長".repeat(80), "9,999", "99.9")).join("") });
  const n2 = net({ page: () => htmlRes(bigPage) });
  assert.equal((await P.handlePick(req(max), n2.deps)).status, 200);
  for (const line of textOf(tgCalls(n2)[0]).split("\n").slice(4, 16)) assert.ok(Array.from(line.replace(/^\d+\. <code>|<\/code>$/g, "")).length <= 60, line);
});

test("R1：舊網址的推薦頁跨網域送來——OPTIONS 預檢只對舊網址回允許；POST 成功與失敗都帶 CORS；同源不帶", async () => {
  P.resetPickState();
  const n = net();
  const pre = await P.handlePick(req(null, { method: "OPTIONS", headers: { origin: OLD, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }), n.deps);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), OLD);
  assert.equal(pre.headers.get("access-control-allow-methods"), "POST");
  assert.equal(pre.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(pre.headers.get("access-control-allow-credentials"), null, "不帶 cookie");
  assert.match(pre.headers.get("vary") || "", /Origin/);
  for (const [origin, method] of [["https://evil.example", "POST"], ["https://abc.teddy-website-blog.pages.dev", "POST"], [OLD, "PUT"], ["https://teddy-house.tw", "POST"]]) {
    const r = await P.handlePick(req(null, { method: "OPTIONS", headers: { origin, "access-control-request-method": method } }), n.deps);
    assert.equal(r.status, 405, `${origin} ${method}`);
    if (origin !== OLD) assert.equal(r.headers.get("access-control-allow-origin"), null, origin);
  }
  const ok = await P.handlePick(req(good(), { headers: { origin: OLD } }), n.deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), OLD);
  assert.deepEqual(await jsonOf(ok), { ok: true, v: 1, saved: true });
  assert.equal(tgCalls(n).length, 1);
  const bad = await P.handlePick(req(good({ consent: false }), { headers: { origin: OLD } }), n.deps);
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("access-control-allow-origin"), OLD, "錯誤也讀得到（畫面才能顯示改加 LINE）");
  assert.equal(bad.headers.get("x-content-type-options"), "nosniff", "原本的安全標頭還在");
  // Telegram 訊息裡的推薦頁網址一律正式網域
  assert.ok(textOf(tgCalls(n)[0]).includes("推薦頁：https://teddy-house.tw/share/qsAbCd1234/"));
});

test("找房小幫手推薦頁（qa）過期了：404、不讀頁面、不送；沒過期照常送", async () => {
  P.resetPickState();
  const n = net();
  const b36 = x => x.toString(36).padStart(4, "0");
  const today = QA.dayIndex(NOW);
  const qa = d => `qa${b36(d)}${"abcdefghijklmnopqrstuvwxyz".replace(/[^a-z2-7]/g, "a")}`;
  assert.equal((await P.handlePick(req(good({ share_id: qa(today - 1) })), n.deps)).status, 404);
  assert.equal((await P.handlePick(req(good({ share_id: qa(today - 1).toUpperCase() })), n.deps)).status, 404, "大寫也擋");
  assert.equal(n.calls.length, 0);
  assert.equal((await P.handlePick(req(good({ share_id: qa(today + 20) })), n.deps)).status, 200);
  assert.equal(tgCalls(n).length, 1);
});

test("限流：同一 IP 10 分鐘最多 5 次（第 6 次 429，不讀頁面、不送）；別的 IP 不受影響；10 分鐘後恢復", async () => {
  P.resetPickState();
  let now = NOW;
  const n = net();
  const deps = { ...n.deps, now: () => now };
  for (let i = 0; i < 5; i++) assert.equal((await P.handlePick(req(good()), deps)).status, 200, `第 ${i + 1} 次`);
  const before = n.calls.length;
  const r6 = await P.handlePick(req(good()), deps);
  assert.equal(r6.status, 429);
  const j6 = await jsonOf(r6);
  assert.equal(j6.code, "E_RATE");
  assert.equal(n.calls.length, before, "被擋的那次不讀推薦頁");
  assert.equal(tgCalls(n).length, 5);
  assert.equal((await P.handlePick(req(good(), { headers: { "cf-connecting-ip": "198.51.100.9" } }), deps)).status, 200);
  now += P.PICK_WINDOW_MS + 1;
  assert.equal((await P.handlePick(req(good()), deps)).status, 200);
});

test("限流：同一個 isolate 10 分鐘的總上限（核對通過的才算；洗版時換 IP 也擋）", async () => {
  P.resetPickState();
  const n = net();
  let ok = 0, rate = 0;
  for (let i = 0; i < P.PICK_GLOBAL + 5; i++) {
    const s = (await P.handlePick(req(good(), { headers: { "cf-connecting-ip": `198.51.100.${i % 250}` } }), n.deps)).status;
    if (s === 200) ok++; else if (s === 429) rate++;
  }
  assert.equal(ok, P.PICK_GLOBAL);
  assert.equal(rate, 5);
  assert.equal(tgCalls(n).length, P.PICK_GLOBAL);
});

test("Telegram：找房那隻送不出去改用舊表單那隻；兩隻都失敗 saved:false＋代碼（不含金鑰）；沒設定 tg-none", async () => {
  P.resetPickState();
  let n = net({ tg: u => (u.includes("find-token") ? new Response("{}", { status: 403 }) : Response.json({ ok: true })) });
  assert.deepEqual(await jsonOf(await P.handlePick(req(good()), n.deps)), { ok: true, v: 1, saved: true });
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token", "contact-token"]);
  n = net({ tg: () => new Response("{}", { status: 403 }) });
  const res = await P.handlePick(req(good()), n.deps);
  const text = await res.text();
  const j = JSON.parse(text);
  assert.equal(j.saved, false);
  assert.match(j.diag, /^tg-/);
  assert.ok(!text.includes("find-token") && !text.includes("contact-token"));
  assert.deepEqual(Object.keys(j).sort(), ["diag", "ok", "saved", "v"]);
  n = net();
  assert.deepEqual(await jsonOf(await P.handlePick(req(good(), { env: {} }), n.deps)), { ok: true, v: 1, saved: false, diag: "tg-none" });
  assert.equal(tgCalls(n).length, 0);
});

test("functions/api/find/pick.ts 是薄包裝：onRequest 走 handlePick（同源檢查有生效）", async () => {
  assert.equal(typeof WRAP.onRequest, "function");
  const res = await WRAP.onRequest({ request: new Request("https://teddy-house.tw/api/find/pick", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), env: {} });
  assert.equal(res.status, 403);
});

test("twTime：UTC+8、補零", () => {
  assert.equal(P.twTime(Date.UTC(2026, 0, 1, 16, 5)), "2026-01-02 00:05");
  assert.equal(P.twTime(Date.UTC(2026, 11, 31, 15, 59)), "2026-12-31 23:59");
});

test("pageCards：從推薦頁抓按鈕的 slug 與名稱（實體還原、補樓層、沒有卡片區塊就用 data-name、≤60 字）", () => {
  const m = P.pageCards(OWNER_PAGE);
  assert.deepEqual([...m.keys()], ["q1a2b3c4d5", "q9z8y7x6w5", "q5k5k5k5k5"]);
  assert.equal(m.get("q1a2b3c4d5"), "測試社區A 10樓 2房|1,338 萬|37.57 坪");
  // 標題沒有樓層 → 補 card-floor；標題有 & 與引號 → 還原
  const c2 = card("x1", `A&B "館" 2房`, "980", "25").replace('<div class="card-floor">10</div>', '<div class="card-floor">7F / 12F</div>');
  assert.equal(P.pageCards(c2).get("x1"), `A&B "館" 2房 7F / 12F|980 萬|25 坪`);
  // 只有按鈕（產生器改版、卡片標記對不上）：用 data-name
  assert.deepEqual([...P.pageCards('<button type="button" class="card-like" data-name="只有按鈕 &amp; 名稱" data-slug="b1">').entries()], [["b1", "只有按鈕 & 名稱"]]);
  // 不是「我喜歡」按鈕、slug 格式不對：不算
  assert.equal(P.pageCards('<button class="card-likes" data-slug="z1"><button class="card-like" data-slug="bad slug">').size, 0);
  // 很長：≤60 字
  assert.ok(Array.from(P.pageCards(card("L1", "長".repeat(90), "1", "1")).get("L1")).length <= 60);
  // 一次掃過（&amp;lt; 只變成 &lt;）；&#0; 與單獨的代理對字元直接丟掉
  assert.equal(P.unescapeHtml("&amp;lt;|&#x27;|&#39;|&#0;|&#xD800;"), "&lt;|'|'||");
});

/* ===================== 伺服器端：喜歡通知（kind:"like"） ===================== */
const likeBody = (over = {}) => ({ kind: "like", share_id: "qsAbCd1234", slug: "q9z8y7x6w5", ...over });
const LIKE_LINES = (name, id = "qsAbCd1234") => [
  "【推薦頁｜客人按了喜歡】",
  `物件：<code>${name}</code>`,
  `推薦頁：https://teddy-house.tw/share/${id}/`,
  "時間：2026-10-07 14:30（台灣時間）",
  "（客人還沒留聯絡方式；如果他按「傳給景泰」會另外收到一則）",
];

test("喜歡通知：正常送出一則（讀推薦頁一次、送找房機器人一次），回應只有 {ok, v, saved}；訊息格式固定、不含 IP 與 UA", async () => {
  P.resetPickState();
  const n = net();
  const res = await P.handlePick(req(likeBody(), { headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": "Mozilla/5.0 (TestUA-77)" } }), n.deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), null, "同源請求不帶 CORS");
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: true });
  assert.deepEqual(pageCalls(n).map(c => c.url), [PAGES + "qsAbCd1234/"]);
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token"]);
  const body = JSON.parse(tgCalls(n)[0].init.body);
  assert.equal(body.parse_mode, "HTML");
  assert.equal(body.disable_web_page_preview, true);
  const t = body.text;
  assert.deepEqual(t.split("\n"), LIKE_LINES("測試社區B 12樓 3房|1,980 萬|45.2 坪"));
  assert.ok(!t.includes("203.0.113.7") && !t.includes("TestUA"), "不放 IP、不放 UA");
  assert.equal(P.formatLike({ share_id: "qsAbCd1234", name: "測試社區B 12樓 3房|1,980 萬|45.2 坪" }, NOW), t);
});

test("喜歡通知：名稱一律用推薦頁上的字；本文多帶的名稱、聯絡方式、物件清單一律不看；不需要聯絡方式與同意勾選", async () => {
  P.resetPickState();
  const n = net();
  const extra = { name: "免費送房 快加我", line: "spam_line", phone: "0911222333", note: "x", consent: false, items: [{ slug: "q1a2b3c4d5", name: "亂寫" }] };
  const res = await P.handlePick(req(likeBody({ slug: "q5k5k5k5k5", ...extra })), n.deps);
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: true });
  assert.equal(tgCalls(n).length, 1);
  const t = textOf(tgCalls(n)[0]);
  assert.deepEqual(t.split("\n"), LIKE_LINES("測試社區C 8樓 2房|1,200 萬|30.1 坪"));
  assert.ok(!/免費送房|spam_line|0911222333|亂寫|測試社區A/.test(t));
  assert.deepEqual(P.validateLike(likeBody(extra)), { out: { share_id: "qsAbCd1234", slug: "q9z8y7x6w5" }, err: null }, "只留代號與 slug");
});

test("喜歡通知：格式不對 400；slug 不在頁面上 400；同事頁 404；假代號 404；qa 過期 404；上游抓不到 saved:false＋pg-；都不送 Telegram", async () => {
  // 格式
  const E = b => P.validateLike(b).err;
  assert.equal(E(likeBody()), null);
  for (const bad of [null, [], {}, likeBody({ kind: "LIKE" }), likeBody({ share_id: "abc" }), likeBody({ share_id: "qs/../x" }),
    likeBody({ slug: "" }), likeBody({ slug: "bad slug" }), likeBody({ slug: "s".repeat(41) }), likeBody({ slug: 5 }), likeBody({ slug: undefined })]) {
    assert.equal(E(bad), "E_BAD_REQUEST", JSON.stringify(bad));
  }
  P.resetPickState();
  let n = net();
  let r = await P.handlePick(req(likeBody({ slug: "bad slug" })), n.deps);
  assert.equal(r.status, 400);
  assert.equal(n.calls.length, 0, "格式不對：不讀推薦頁");
  // slug 不在頁面上
  r = await P.handlePick(req(likeBody({ slug: "notOnPage1" })), n.deps);
  assert.equal(r.status, 400);
  assert.equal((await jsonOf(r)).code, "E_BAD_REQUEST");
  assert.equal(pageCalls(n).length, 1);
  assert.equal(tgCalls(n).length, 0);
  // 同事頁
  n = net({ page: () => htmlRes(MATE_PAGE) });
  r = await P.handlePick(req(likeBody()), n.deps);
  assert.equal(r.status, 404);
  assert.equal((await jsonOf(r)).code, "E_NOT_FOUND");
  assert.equal(tgCalls(n).length, 0);
  // 假代號（Pages 與原始檔都 404）
  n = net({ page: () => htmlRes("nope", 404) });
  assert.equal((await P.handlePick(req(likeBody()), n.deps)).status, 404);
  assert.deepEqual(pageCalls(n).map(c => c.url), [PAGES + "qsAbCd1234/", RAW + "qsAbCd1234/index.html"]);
  assert.equal(tgCalls(n).length, 0);
  // qa 過期：不讀頁面
  const b36 = x => x.toString(36).padStart(4, "0");
  const qa = d => `qa${b36(d)}${"abcdefghijklmnopqrstuvwxyz".replace(/[^a-z2-7]/g, "a")}`;
  n = net();
  assert.equal((await P.handlePick(req(likeBody({ share_id: qa(QA.dayIndex(NOW) - 1) })), n.deps)).status, 404);
  assert.equal(n.calls.length, 0);
  // 上游暫時抓不到
  n = net({ page: () => htmlRes("x", 503) });
  r = await P.handlePick(req(likeBody()), n.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await jsonOf(r), { ok: true, v: 1, saved: false, diag: "pg-h503" });
  assert.equal(tgCalls(n).length, 0);
});

test("喜歡通知：kind 只認 \"like\"；「傳給景泰」的本文帶 kind 只收 \"pick\"，其他值 400（不會被當成喜歡或表單）", async () => {
  P.resetPickState();
  const n = net();
  assert.equal(P.validatePick(good({ kind: "pick" })).err, null);
  for (const k of ["weird", "Like", 1, null, true]) assert.equal(P.validatePick(good({ kind: k })).err, "E_BAD_REQUEST", String(k));
  assert.equal((await P.handlePick(req(good({ kind: "weird" })), n.deps)).status, 400);
  assert.equal((await P.handlePick(req({ kind: "weird", share_id: "qsAbCd1234", slug: "q9z8y7x6w5" }), n.deps)).status, 400);
  assert.equal(n.calls.length, 0);
  assert.equal((await P.handlePick(req(good({ kind: "pick" })), n.deps)).status, 200);
  assert.ok(textOf(tgCalls(n)[0]).startsWith("【推薦頁｜客人選了 2 間】"));
});

test("喜歡通知限流：同一 IP 10 分鐘 20 則（第 21 則 429、不讀頁面）；跟「傳給景泰」的 5 次各算各的；別的 IP 不受影響；10 分鐘後恢復", async () => {
  assert.equal(P.LIKE_PER_IP, 20);
  P.resetPickState();
  let now = NOW;
  const n = net();
  const deps = { ...n.deps, now: () => now };
  // 先把「傳給景泰」的 5 次用完
  for (let i = 0; i < P.PICK_PER_IP; i++) assert.equal((await P.handlePick(req(good()), deps)).status, 200, `傳給景泰第 ${i + 1} 次`);
  assert.equal((await P.handlePick(req(good()), deps)).status, 429, "傳給景泰第 6 次");
  // 喜歡照樣有 20 則
  for (let i = 0; i < P.LIKE_PER_IP; i++) assert.equal((await P.handlePick(req(likeBody()), deps)).status, 200, `喜歡第 ${i + 1} 則`);
  const before = n.calls.length;
  const r21 = await P.handlePick(req(likeBody()), deps);
  assert.equal(r21.status, 429);
  assert.equal((await jsonOf(r21)).code, "E_RATE");
  assert.equal(n.calls.length, before, "被擋的那則不讀推薦頁、不送");
  assert.equal(tgCalls(n).length, P.PICK_PER_IP + P.LIKE_PER_IP);
  // 反過來：喜歡先用完，「傳給景泰」照常
  P.resetPickState();
  for (let i = 0; i < P.LIKE_PER_IP; i++) await P.handlePick(req(likeBody()), deps);
  assert.equal((await P.handlePick(req(likeBody()), deps)).status, 429);
  assert.equal((await P.handlePick(req(good()), deps)).status, 200, "喜歡用完，傳給景泰不受影響");
  assert.equal((await P.handlePick(req(likeBody(), { headers: { "cf-connecting-ip": "198.51.100.9" } }), deps)).status, 200, "別的 IP 不受影響");
  now += P.PICK_WINDOW_MS + 1;
  assert.equal((await P.handlePick(req(likeBody()), deps)).status, 200, "10 分鐘後恢復");
});

test("喜歡通知限流：isolate 總量另外一桶（核對通過才算；喜歡洗滿了，「傳給景泰」照常；假代號灌不滿它）", async () => {
  P.resetPickState();
  const n = net({ page: u => (u.includes("qsFake") ? htmlRes("nope", 404) : htmlRes(OWNER_PAGE)) });
  for (let i = 0; i < 30; i++) {
    const s = (await P.handlePick(req(likeBody({ share_id: "qsFake" + String(i).padStart(4, "0") }), { headers: { "cf-connecting-ip": `192.0.2.${i}` } }), n.deps)).status;
    assert.equal(s, 404);
  }
  let ok = 0, rate = 0;
  for (let i = 0; i < P.LIKE_GLOBAL + 5; i++) {
    const s = (await P.handlePick(req(likeBody(), { headers: { "cf-connecting-ip": `198.51.100.${i % 250}` } }), n.deps)).status;
    if (s === 200) ok++; else if (s === 429) rate++;
  }
  assert.equal(ok, P.LIKE_GLOBAL);
  assert.equal(rate, 5);
  assert.equal((await P.handlePick(req(good(), { headers: { "cf-connecting-ip": "203.0.113.99" } }), n.deps)).status, 200, "傳給景泰的總量不受影響");
});

test("喜歡通知：舊網址跨網域（text/plain 簡單請求、不先預檢）→ 成功與失敗都帶 CORS；別的網站、打在舊網址都 403", async () => {
  P.resetPickState();
  const n = net();
  const ok = await P.handlePick(req(likeBody(), { headers: { origin: OLD, "content-type": "text/plain;charset=UTF-8" } }), n.deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), OLD);
  assert.deepEqual(await jsonOf(ok), { ok: true, v: 1, saved: true });
  assert.ok(textOf(tgCalls(n)[0]).includes("推薦頁：https://teddy-house.tw/share/qsAbCd1234/"), "網址一律正式網域");
  const bad = await P.handlePick(req(likeBody({ slug: "notOnPage1" }), { headers: { origin: OLD } }), n.deps);
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("access-control-allow-origin"), OLD);
  assert.equal((await P.handlePick(req(likeBody(), { headers: { origin: "https://evil.example" } }), n.deps)).status, 403);
  assert.equal((await P.handlePick(req(likeBody(), { headers: { origin: "https://abc123.teddy-website-blog.pages.dev" } }), n.deps)).status, 403);
  assert.equal((await P.handlePick(req(likeBody(), { url: OLD + "/api/find/pick", headers: { origin: OLD } }), n.deps)).status, 403, "請求打在舊網址：不收（RT-05）");
  assert.equal(tgCalls(n).length, 1);
});

test("喜歡通知：頁面上的物件文字一樣跳脫、隱藏網址；找房機器人送不出去改用舊表單那隻；兩隻都失敗 saved:false＋tg- 代碼", async () => {
  P.resetPickState();
  const evilCards = card("s1", "<script>alert(1)</script> evil.example 10樓 </code><a href=x>", "1,000", "20");
  let n = net({ page: () => htmlRes(SHARE_HTML({ cards: evilCards })) });
  assert.deepEqual(await jsonOf(await P.handlePick(req(likeBody({ slug: "s1" })), n.deps)), { ok: true, v: 1, saved: true });
  const t = textOf(tgCalls(n)[0]);
  assert.equal(t.split("\n").length, 5);
  assert.ok(!/<script|<a |evil\.example/.test(t));
  assert.equal((t.match(/<code>/g) || []).length, (t.match(/<\/code>/g) || []).length);
  n = net({ tg: u => (u.includes("find-token") ? new Response("{}", { status: 403 }) : Response.json({ ok: true })) });
  assert.deepEqual(await jsonOf(await P.handlePick(req(likeBody()), n.deps)), { ok: true, v: 1, saved: true });
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token", "contact-token"]);
  n = net({ tg: () => new Response("{}", { status: 403 }) });
  const j = await jsonOf(await P.handlePick(req(likeBody()), n.deps));
  assert.equal(j.saved, false);
  assert.match(j.diag, /^tg-/);
  assert.deepEqual(Object.keys(j).sort(), ["diag", "ok", "saved", "v"]);
});

/* ===================== 官網代理：注入 ===================== */
test("injectPick：只有本人頁才放腳本（帶代號與版本戳）；同事頁、沒有這行、已經有、壞代號都原樣", () => {
  const out = SP.injectPick(OWNER_PAGE, "qsAbCd1234");
  assert.ok(out.includes(`<script src="/js/share-pick.js?v=${SP.pickScriptTag("x").match(/v=([0-9a-z]+)/)[1]}" data-share="qsAbCd1234" defer></script></body>`));
  assert.equal(SP.injectPick(MATE_PAGE, "qsAbCd1234"), MATE_PAGE);
  assert.equal(SP.injectPick("<html><body>x</body></html>", "qsAbCd1234"), "<html><body>x</body></html>");
  assert.equal(SP.injectPick(out, "qsAbCd1234"), out, "不重複注入");
  for (const bad of ["", "ab", 'x" onload="alert(1)', "qs/../x", "a".repeat(41)]) assert.equal(SP.injectPick(OWNER_PAGE, bad), OWNER_PAGE, bad);
  assert.equal(SP.injectPick(OWNER_PAGE, "qsAbCd1234", '1"><script>'), OWNER_PAGE, "版本戳格式不對也不注入");
  // 沒有 </body>：接在最後；有兩個 </body>（例如寫在字串裡）：放在最後一個前面
  assert.ok(SP.injectPick("var LIKE_NOTIFY = true;", "qsAbCd1234").endsWith('defer></script>'));
  const two = `<body><script>var s="</body>";\n  var LIKE_NOTIFY = true;</script></body>`;
  assert.ok(SP.injectPick(two, "qsAbCd1234").startsWith('<body><script>var s="</body>";'));
  // 寫法有空白差異也認得
  assert.ok(SP.LIKE_NOTIFY_ON.test("var  LIKE_NOTIFY=true ;"));
  assert.ok(SP.LIKE_NOTIFY_ON.test("x\n\t  var LIKE_NOTIFY = true;   // 註解"));
  assert.ok(!SP.LIKE_NOTIFY_ON.test("var LIKE_NOTIFY = false;"));
  assert.ok(!SP.LIKE_NOTIFY_ON.test("var LIKE_NOTIFY = trueish;"));
});

test("R4：同事頁內文（客戶稱呼、標題、物件介紹）寫到 `var LIKE_NOTIFY = true;` 也不注入；只出現在一行中間也不算", () => {
  const evil = "var LIKE_NOTIFY = true;";
  // 推薦頁產生器的寫法：稱呼進 <title>（HTML 跳脫）與 CLIENT_NAME（JSON），真正那行是 false
  const mate = SHARE_HTML({ notify: false, title: evil }).replace(script(false), script(false, evil));
  assert.ok(mate.includes(`<title>${evil}</title>`) && mate.includes(`var CLIENT_NAME = "${evil}";`));
  assert.equal(SP.isOwnerPage(mate), false);
  assert.equal(SP.injectPick(mate, "qsAbCd1234"), mate);
  // 就算客戶文字自己成了一行的開頭（例如物件介紹換行），同事頁的 false 那行也會讓它不算
  const mate2 = mate.replace("<div class=\"grid\">", `<div class="card-intro">說明<br>\n${evil}\n</div><div class="grid">`);
  assert.equal(SP.injectPick(mate2, "qsAbCd1234"), mate2);
  // 沒有 false、true 只出現在一行中間（不是產生器那行）：不算
  const mid = `<html><body><script>(function(){ var CLIENT_NAME = "x"; ${evil} })();</script></body></html>`;
  assert.equal(SP.isOwnerPage(mid), false);
  assert.equal(SP.injectPick(mid, "qsAbCd1234"), mid);
  // 本人頁照常
  assert.equal(SP.isOwnerPage(OWNER_PAGE), true);
});

test("上游網址：sharepick.ts 與官網代理（functions/share/[[path]].ts）的 UPSTREAM／RAW_UPSTREAM 同值", () => {
  const src = fs.readFileSync(path.join(ROOT, "functions/share/[[path]].ts"), "utf8");
  assert.equal(/const UPSTREAM = "([^"]+)"/.exec(src)[1], SP.SHARE_UPSTREAM);
  assert.equal(/const RAW_UPSTREAM = "([^"]+)"/.exec(src)[1], SP.SHARE_RAW_UPSTREAM);
  assert.equal(SP.SHARE_UPSTREAM, PAGES);
  assert.equal(SP.SHARE_RAW_UPSTREAM, RAW);
});

test("pickver.ts 版本戳沒有過期（public/js/share-pick.js 的 md5 前 10 碼；過期請執行 node scripts/pick-stamp.mjs）", () => {
  const v = crypto.createHash("md5").update(fs.readFileSync(path.join(ROOT, "public/js/share-pick.js"))).digest("hex").slice(0, 10);
  const ts = fs.readFileSync(path.join(ROOT, "src/lib/find/pickver.ts"), "utf8");
  assert.match(ts, new RegExp(`PICK_V = "${v}"`), "請執行 node scripts/pick-stamp.mjs");
  assert.ok(SP.pickScriptTag("qsAbCd1234").includes(`?v=${v}"`));
});

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async url => handler(String(url));
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = real; });
}
const page = html => () => htmlRes(html);
const proxied = (id, host = "teddy-house.tw") => PROXY.onRequest({ params: {}, request: new Request(`https://${host}/share/${id}/`) }).then(r => r.text());
const INJECTED = /<script src="\/js\/share-pick\.js\?v=[0-9a-f]{10}" data-share="qsAbCd1234" defer><\/script><\/body>/;

test("代理：景泰本人頁（qs）在正式網域與舊網址 pages.dev 都注入；預覽網址、同事頁不注入；其他內容照舊", async () => {
  await withFetch(page(OWNER_PAGE), async () => {
    const html = await proxied("qsAbCd1234");
    assert.match(html, INJECTED);
    assert.ok(html.includes("想看更多好屋") && html.includes("googletagmanager"), "回官網區塊與分析照舊");
    assert.match(await proxied("qsAbCd1234", "teddy-website-blog.pages.dev"), INJECTED, "R1：推薦頁連結還是舊網址，舊網址也要有");
    assert.match(await proxied("qsAbCd1234", "www.teddy-house.tw"), INJECTED);
    assert.ok(!(await proxied("qsAbCd1234", "abc123.teddy-website-blog.pages.dev")).includes("share-pick"), "預覽網址不注入");
  });
  await withFetch(page(MATE_PAGE), async () => {
    assert.ok(!(await proxied("qsAbCd1234")).includes("share-pick"), "同事頁不注入");
    assert.ok(!(await proxied("qsAbCd1234", "teddy-website-blog.pages.dev")).includes("share-pick"), "同事頁在舊網址也不注入");
  });
  const mate = SHARE_HTML({ notify: false, title: "var LIKE_NOTIFY = true;" }).replace(script(false), script(false, "var LIKE_NOTIFY = true;"));
  await withFetch(page(mate), async () => {
    assert.ok(!(await proxied("qsAbCd1234")).includes("share-pick"), "R4：同事頁稱呼寫成 true 那句，經過真的代理也不注入");
  });
});

test("代理：找房小幫手推薦頁（qa）也注入，跟揭露區塊、個人化腳本並存", async () => {
  const today = QA.dayIndex(Date.now());
  const id = `qa${(today + 10).toString(36).padStart(4, "0")}${"abcdefghijklmnopqrstuvwxyz".replace(/[^a-z2-7]/g, "a")}`;
  await withFetch(page(OWNER_PAGE), async () => {
    const html = await proxied(id);
    assert.ok(html.includes('id="qa-notice"'));
    assert.match(html, /find-brief\.js\?v=[0-9a-z]+" defer><\/script><script src="\/js\/share-pick\.js\?v=[0-9a-f]{10}" data-share="qa[0-9a-z]+" defer><\/script><\/body>/);
  });
});

/* ===================== 瀏覽器端：純函式與靜態檢查 ===================== */
test("share-pick.js：clip／cut 的字數（送出的字不含「…」，伺服器 NFKC 後會變三個點）", () => {
  assert.equal(C.clip("字".repeat(70), 60), "字".repeat(60));
  assert.equal(C.cut("字".repeat(70), 40), "字".repeat(39) + "…");
  assert.equal(C.cut("短", 40), "短");
  assert.equal(C.clip("  a \n  b  ", 10), "a b");
  assert.equal(C.clip("ＡＢ１", 10), "AB1", "全形轉半形（跟伺服器一樣先 NFKC）");
});

test("share-pick.js：apiFor——正式網域／本機同源、舊網址送正式網域、其他主機不啟動", () => {
  for (const h0 of ["teddy-house.tw", "www.teddy-house.tw", "TEDDY-HOUSE.TW", "localhost", "127.0.0.1"]) assert.equal(C.apiFor(h0), "/api/find/pick", h0);
  assert.equal(C.apiFor("teddy-website-blog.pages.dev"), "https://teddy-house.tw/api/find/pick");
  for (const h0 of ["", undefined, "abc.teddy-website-blog.pages.dev", "evil.example", "teddy-house.tw.evil.example", "sky811117.github.io"]) assert.equal(C.apiFor(h0), "", String(h0));
});

test("share-pick.js：describe——卡片文字組成名稱；標題沒有樓層才補 card-floor（只認「數字＋F」，社區名裡的英文 f 不算）", () => {
  const fake = (o) => {
    const node = t => (t == null ? null : { textContent: t });
    const specs = (o.specs || []).map(([l, v]) => ({ querySelector: s => node(s === ".spec-label" ? l : v) }));
    const cd = {
      querySelector: s => node({ ".card-tagline": o.tag, ".card-floor": o.floor, ".card-price": o.price, ".card-price-unit": o.unit }[s]),
      querySelectorAll: () => specs,
      getAttribute: () => o.community || null,
    };
    return { closest: () => cd, getAttribute: k => (k === "data-name" ? o.dataName || null : null) };
  };
  assert.equal(C.describe(fake({ tag: "Fun City 2房", floor: "7" }), "a").title, "Fun City 2房 7 樓");
  assert.equal(C.describe(fake({ tag: "測試 7F 2房", floor: "7" }), "a").title, "測試 7F 2房");
  assert.equal(C.describe(fake({ tag: "測試 10樓 2房", floor: "10" }), "a").title, "測試 10樓 2房");
  const d = C.describe(fake({ tag: "測試社區", floor: "3/10F", price: "1,280", unit: "萬", specs: [["主+附", "15 坪"], ["權狀坪數", "30.5 坪"]] }), "s1");
  assert.deepEqual({ ...d }, { slug: "s1", title: "測試社區 3/10F", detail: "1,280 萬・30.5 坪", name: "測試社區 3/10F|1,280 萬|30.5 坪" });
  // 沒有標題：用按鈕的 data-name；都沒有：「物件」
  assert.equal(C.describe(fake({ dataName: "備用名稱" }), "a").title, "備用名稱");
  assert.equal(C.describe(fake({}), "a").title, "物件");
  // 沒有「權狀」就用第一個帶「坪」的值
  assert.equal(C.describe(fake({ tag: "x 1樓", specs: [["格局", "2房"], ["坪數", "20 坪"]] }), "a").detail, "20 坪");
  // 標題超長：畫面截成 40 字＋「…」，送出的名稱不含「…」且 ≤60 字
  const long = C.describe(fake({ tag: "長".repeat(80), price: "9,999", unit: "萬" }), "a");
  assert.equal(Array.from(long.title).length, 40);
  assert.ok(long.title.endsWith("…") && !long.name.includes("…") && Array.from(long.name).length <= 60);
});

test("share-pick.js：手機與 LINE ID 正規化", () => {
  assert.equal(C.normPhone("0912-345-678"), "0912345678");
  assert.equal(C.normPhone("+886 912 345 678"), "0912345678");
  assert.equal(C.normPhone("０９１２３４５６７８"), "0912345678");
  assert.equal(C.normPhone(""), "");
  for (const bad of ["12345", "0412345678", "09123456789", "abc"]) assert.equal(C.normPhone(bad), null, bad);
  assert.equal(C.normLine("  teddy_01 "), "teddy_01");
  assert.equal(C.normLine("@shop.tw"), "@shop.tw");
  assert.equal(C.normLine(""), "");
  for (const bad of ["含中文", "ab", "a b c", "x".repeat(41)]) assert.equal(C.normLine(bad), null, bad);
});

test("share-pick.js：validate——錯誤訊息、送出本文的形狀（最多 12 間、只有白名單欄位）", () => {
  let v = C.validate({ shareId: "qsAbCd1234", items: [], consent: false });
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.errors).sort(), ["consent", "contact"]);
  v = C.validate({ shareId: "qsAbCd1234", items: [{ slug: "a", name: "x" }], line: "含中文", phone: "123", consent: true });
  assert.deepEqual(Object.keys(v.errors).sort(), ["line", "phone"]);
  v = C.validate({ shareId: "qsAbCd1234", items: [{ slug: "a", name: "x" }], name: "字".repeat(21), line: "ok_id", consent: true });
  assert.deepEqual(Object.keys(v.errors), ["name"]);
  const items = Array.from({ length: 15 }, (_, i) => ({ slug: "s" + i, name: "n" + i, title: "t", detail: "d" }));
  v = C.validate({ shareId: "qsAbCd1234", items, name: " 王小姐 ", line: "", phone: "0912 345 678", note: " 嗨 ", consent: true, hp: "" });
  assert.equal(v.ok, true);
  assert.equal(v.body.items.length, 12);
  assert.deepEqual(Object.keys(v.body.items[0]), ["slug", "name"]);
  assert.deepEqual(v.body, { share_id: "qsAbCd1234", items: v.body.items, consent: true, hp: "", name: "王小姐", phone: "0912345678", note: "嗨" });
  // 前端組出來的本文，伺服器一定收（同一份規則）
  assert.equal(P.validatePick(v.body).err, null);
  // 極端情況（12 間名稱全是 4 位元組的字＋留言 200 個）：自動縮短物件名稱，本文仍在 4KB 內
  const fat = Array.from({ length: 12 }, (_, i) => ({ slug: "slug" + i, name: "🏠".repeat(60) }));
  v = C.validate({ shareId: "qsAbCd1234", items: fat, line: "ok_id", note: "🏠".repeat(200), consent: true });
  assert.equal(v.ok, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(v.body)).length <= 4000);
  assert.ok(v.body.items.every(it => Array.from(it.name).length >= 12));
  assert.equal(fat[0].name, "🏠".repeat(60), "不改呼叫端傳進來的物件");
});

test("share-pick.js 靜態檢查：IIFE（壓縮安全）、不寫瀏覽器儲存、不用 innerHTML、只打官網 API、字 ≥17px、honeypot 名稱沒有語意、列印不留空白", () => {
  assert.ok(/^(?:\s*\/\/[^\n]*|\s*\/\*[\s\S]*?\*\/)*\s*\(\s*function\b/.test(CLIENT_SRC), "外層是 IIFE");
  // 去掉註解再檢查（註解裡提到 localStorage 沒關係）；網址的 // 前面是冒號，不會被當成註解
  const code = CLIENT_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  assert.ok(!/localStorage\s*\.\s*setItem|sessionStorage|indexedDB|document\.cookie/.test(code), "不存聯絡資料");
  assert.ok(/localStorage\.getItem\('teddy_like_'/.test(code), "只讀頁面自己存的喜歡紀錄");
  assert.ok(/localStorage\.getItem\('teddy_admin'\) === '1'/.test(code), "預覽旗標跟頁面同一個（只讀）");
  assert.deepEqual([...code.matchAll(/localStorage\.(\w+)\(/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i), ["getItem"], "localStorage 只讀不寫");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), "不用 HTML 字串插入");
  assert.ok(!/\beval\(|new Function/.test(code));
  assert.ok(CLIENT_SRC.includes("var API = '/api/find/pick';"));
  assert.ok(CLIENT_SRC.includes("var API_PROD = 'https://teddy-house.tw/api/find/pick';"));
  assert.deepEqual([...code.matchAll(/https?:\/\/[^'"\s)]+/g)].map(m => m[0]).sort(), ["https://line.me/ti/p/~", "https://teddy-house.tw/api/find/pick"], "程式裡只出現這兩個網址");
  assert.ok(!/fetch\(\s*['"]https?:/.test(CLIENT_SRC), "不直接打寫死的外部網址");
  const sizes = [...CLIENT_SRC.matchAll(/font-size:\s*(\d+)px/g)].map(m => Number(m[1]));
  assert.ok(sizes.length > 5 && sizes.every(s => s >= 17), `字級：${sizes}`);
  for (const w of ["預計", "即將", "規劃中", "興建中", "絕版", "最強", "保證"]) assert.ok(!CLIENT_SRC.includes(w), w);
  assert.ok(CLIENT_SRC.includes("name: 'sp_x7'") && !/name: 'website'/.test(CLIENT_SRC), "R5：honeypot 名稱沒有語意");
  assert.ok(CLIENT_SRC.includes("@media print{.sp-root{display:none!important}body.sp-on{padding-bottom:0!important}}"), "R6：列印時取消底部留白");
});

test("share-pick.js 壓縮後（postbuild-minify 同一組選項）匯出與行為不變", () => {
  const mini = transformSync(CLIENT_SRC, { minify: true, loader: "js", legalComments: "none", charset: "utf8" }).code;
  assert.ok(mini.length < CLIENT_SRC.length);
  const m = { exports: {} };
  vm.runInThisContext(`(function (module, exports) {${mini}\n})`)(m, m.exports);
  assert.deepEqual(Object.keys(m.exports).sort(), Object.keys(C).sort());
  assert.equal(m.exports.normPhone("+886 912 345 678"), "0912345678");
  assert.equal(m.exports.clip("字".repeat(70), 60), "字".repeat(60));
  assert.equal(m.exports.apiFor("teddy-website-blog.pages.dev"), "https://teddy-house.tw/api/find/pick");
  assert.deepEqual(JSON.parse(m.exports.likeInit("qsAbCd1234", "s1", true).body), { kind: "like", share_id: "qsAbCd1234", slug: "s1" });
});

/* ===================== 瀏覽器端：假 DOM 整段流程 ===================== */
function bootClient({ html = SHARE_HTML(), local = {}, host = "teddy-house.tw", api = () => Response.json({ ok: true, v: 1, saved: true }) } = {}) {
  const clock = makeClock(NOW);
  const calls = [];
  const want = C.apiFor(host);
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url) !== want) throw new Error("測試不准連到：" + url);
    return api(calls.length);
  };
  const { doc, win } = makeEnv({ html, parse5, fetchImpl, clock, localData: local });
  win.location.pathname = "/share/qsAbCd1234/";
  win.location.hostname = host;
  const ctx = vm.createContext(win);
  vm.runInContext(CLIENT_SRC, ctx, { filename: "share-pick.js" });
  const $ = s => doc.querySelector(s);
  const like = async i => { const b = doc.querySelectorAll(".card-like")[i]; b.classList.add("liked"); click(b); await clock.advance(60); };
  return { clock, doc, win, calls, $, like };
}
const visible = el => !!el && !el.hidden && !(el.closest && el.closest("[hidden]"));
/** 送出的請求分兩種：喜歡通知（kind:"like"）與「傳給景泰」（沒有 kind） */
const isLikeCall = c => !!c.body && c.body.kind === "like";
const likesOf = app => app.calls.filter(isLikeCall);
const picksOf = app => app.calls.filter(c => !isLikeCall(c));

test("假 DOM：沒選不出現；按喜歡（含之前就按過的）→「已選 N 間」；同一間不重複算", { skip: !parse5 && "缺 parse5" }, async () => {
  const app = bootClient({ local: { teddy_like_qsAbCd1234_q5k5k5k5k5: "1" } });
  await flush();
  assert.ok(visible(app.$(".sp-bar")), "之前按過的（localStorage）也算");
  assert.equal(app.$(".sp-count").textContent, "已選1間");
  await app.like(0);
  assert.equal(app.$(".sp-count").textContent, "已選2間");
  await app.like(0);
  assert.equal(app.$(".sp-count").textContent, "已選2間", "同一間不重複算");
  assert.ok(app.doc.body.classList.contains("sp-on"));
  const fresh = bootClient();
  await flush();
  assert.ok(!visible(fresh.$(".sp-bar")) && !visible(fresh.$(".sp-chip")), "沒選：浮動列與膠囊都不出現");
  assert.ok(!fresh.doc.body.classList.contains("sp-on"));
});

test("假 DOM：開表單 → 列出卡片上看得到的字 → 空白送出顯示錯誤 → 填好送出 → 本文正確、成功訊息、清空表單、不寫瀏覽器儲存", { skip: !parse5 && "缺 parse5" }, async () => {
  const app = bootClient();
  await app.like(0);
  await app.like(1);
  click(app.$(".sp-send"));
  assert.ok(visible(app.$(".sp-sheet")) && visible(app.$(".sp-ov")));
  assert.equal(app.doc.activeElement, app.$("#sp-title"), "打開時焦點移到標題");
  assert.equal(app.$(".sp-sheet").getAttribute("role"), "dialog");
  assert.equal(app.$(".sp-sheet").getAttribute("aria-modal"), "true");
  const items = app.doc.querySelectorAll(".sp-list li").map(li => li.textContent);
  assert.deepEqual(items, ["1. 測試社區A 10樓 2房1,338 萬・37.57 坪", "2. 測試社區B 12樓 3房1,980 萬・45.2 坪"]);
  for (const id of ["sp-name", "sp-line", "sp-phone", "sp-note", "sp-ok"]) assert.ok(app.doc.querySelector(`label[for="${id}"]`), `${id} 有 label`);
  assert.ok(app.$(".sp-fine").textContent.startsWith("資料只用來讓景泰聯絡你"));
  assert.ok(app.doc.querySelector('input[name="sp_x7"]') && !app.doc.querySelector('input[name="website"]'), "R5：honeypot 名稱");

  submit(app.$(".sp-form"));
  await flush();
  assert.equal(picksOf(app).length, 0, "沒填完不送");
  assert.deepEqual(likesOf(app).map(c => c.body.slug), ["q1a2b3c4d5", "q9z8y7x6w5"], "按的兩間喜歡各送了一則通知（跟表單無關）");
  assert.ok(visible(app.$("#sp-contact-err")) && visible(app.$("#sp-ok-err")));
  assert.equal(app.$("#sp-line").getAttribute("aria-invalid"), "true");
  assert.equal(app.doc.activeElement, app.$("#sp-line"), "焦點移到第一個要補的欄位");

  app.$("#sp-name").value = "王小姐";
  app.$("#sp-line").value = "teddy_test01";
  app.$("#sp-note").value = "想約週末看";
  app.$("#sp-ok").checked = true;
  submit(app.$(".sp-form"));
  assert.equal(app.$(".sp-submit").disabled, true, "送出中鎖按鈕");
  await flush();
  assert.equal(picksOf(app).length, 1);
  assert.equal(likesOf(app).length, 2, "送出表單不會再多送喜歡通知");
  const c = picksOf(app)[0];
  assert.equal(c.url, "/api/find/pick", "正式網域：同源");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.credentials, "same-origin");
  assert.equal(c.init.referrerPolicy, "origin", "只帶網域，不帶 /share/<代號>/");
  assert.deepEqual(c.body, {
    share_id: "qsAbCd1234",
    // 「｜」經 NFKC 變成「|」（跟伺服器的正規化一致，送出前就先轉好，字數才不會在伺服器端變）
    items: [{ slug: "q1a2b3c4d5", name: "測試社區A 10樓 2房|1,338 萬|37.57 坪" }, { slug: "q9z8y7x6w5", name: "測試社區B 12樓 3房|1,980 萬|45.2 坪" }],
    consent: true, hp: "", name: "王小姐", line: "teddy_test01", note: "想約週末看",
  });
  assert.ok(new TextEncoder().encode(c.init.body).length <= 4096);
  assert.equal(P.validatePick(c.body).err, null, "伺服器收得下");
  // 瀏覽器組的名稱跟伺服器從同一份頁面抓的名稱一致（Telegram 用伺服器那份）
  const srv = P.pageCards(SHARE_HTML());
  for (const it of c.body.items) assert.equal(srv.get(it.slug), it.name);
  assert.ok(visible(app.$(".sp-done")) && app.$(".sp-done").textContent === "已傳給景泰，他會盡快聯絡你");
  assert.equal(app.doc.activeElement, app.$(".sp-done"));
  assert.deepEqual(["#sp-name", "#sp-line", "#sp-phone", "#sp-note"].map(s => app.$(s).value), ["", "", "", ""]);
  assert.equal(app.$("#sp-ok").checked, false);
  assert.deepEqual([...app.win.localStorage._m.keys()], [], "沒有寫任何瀏覽器儲存");
  assert.deepEqual([...app.win.sessionStorage._m.keys()], []);
  click(app.$(".sp-okbtn"));
  assert.ok(!visible(app.$(".sp-sheet")));
  assert.equal(app.doc.activeElement, app.$(".sp-send"), "關閉後焦點回到「傳給景泰」");
  assert.match(app.$(".sp-count").textContent, /已傳給景泰/);
});

test("假 DOM：舊網址 pages.dev 上的推薦頁 → 跨網域送到 https://teddy-house.tw/api/find/pick、不帶 cookie", { skip: !parse5 && "缺 parse5" }, async () => {
  const app = bootClient({ host: "teddy-website-blog.pages.dev" });
  await app.like(2);
  assert.ok(visible(app.$(".sp-bar")), "舊網址也出現浮動列");
  click(app.$(".sp-send"));
  app.$("#sp-phone").value = "0912345678";
  app.$("#sp-ok").checked = true;
  submit(app.$(".sp-form"));
  await flush();
  assert.equal(picksOf(app).length, 1);
  assert.equal(picksOf(app)[0].url, "https://teddy-house.tw/api/find/pick");
  assert.equal(picksOf(app)[0].init.credentials, "omit");
  assert.equal(picksOf(app)[0].init.mode, "cors");
  assert.ok(visible(app.$(".sp-done")));
});

test("假 DOM：Esc 關閉；收起變膠囊、膠囊展開回浮動列（aria-expanded 跟著變）", { skip: !parse5 && "缺 parse5" }, async () => {
  const app = bootClient();
  await app.like(2);
  click(app.$(".sp-send"));
  app.doc.dispatchEvent(ev("keydown", { key: "Escape" }));
  assert.ok(!visible(app.$(".sp-sheet")));
  assert.equal(app.doc.activeElement, app.$(".sp-send"));
  click(app.$(".sp-min"));
  assert.ok(!visible(app.$(".sp-bar")) && visible(app.$(".sp-chip")));
  assert.equal(app.$(".sp-min").getAttribute("aria-expanded"), "false");
  assert.equal(app.doc.activeElement, app.$(".sp-chip"));
  assert.ok(!app.doc.body.classList.contains("sp-on"), "收起時不推高頁面的浮動按鈕");
  click(app.$(".sp-chip"));
  assert.ok(visible(app.$(".sp-bar")) && !visible(app.$(".sp-chip")));
  assert.equal(app.$(".sp-min").getAttribute("aria-expanded"), "true");
});

test("假 DOM：送不出去 → 顯示頁面上的 LINE（不寫死）、表單不清空；太頻繁 → 稍後再試；頁面沒有 LINE → 只說稍後再試", { skip: !parse5 && "缺 parse5" }, async () => {
  const fill = app => { app.$("#sp-phone").value = "0912345678"; app.$("#sp-ok").checked = true; submit(app.$(".sp-form")); };
  let app = bootClient({ api: () => Response.json({ ok: true, v: 1, saved: false, diag: "tg-fh403s" }) });
  await app.like(0);
  click(app.$(".sp-send"));
  fill(app);
  await flush();
  const msg = app.$(".sp-msg");
  assert.match(msg.textContent, /^目前送不出去，可以直接加 LINE：teddy_line_test代碼：tg-fh403s$/);
  assert.equal(msg.querySelector("a").getAttribute("href"), "https://line.me/ti/p/~teddy_line_test");
  assert.equal(app.$("#sp-phone").value, "0912345678", "失敗不清空，可以直接重送");
  assert.equal(app.$(".sp-submit").disabled, false, "解鎖");
  assert.ok(!visible(app.$(".sp-done")));

  app = bootClient({ api: () => new Response(JSON.stringify({ ok: false, v: 1, code: "E_RATE" }), { status: 429 }) });
  await app.like(0);
  click(app.$(".sp-send"));
  fill(app);
  await flush();
  assert.match(app.$(".sp-msg").textContent, /^剛剛送了好幾次，請過幾分鐘再試。也可以直接加 LINE：teddy_line_test$/);

  // 伺服器核對推薦頁失敗（例如頁面剛被重做、物件不在了）：一樣給 LINE
  app = bootClient({ api: () => new Response(JSON.stringify({ ok: false, v: 1, code: "E_NOT_FOUND" }), { status: 404 }) });
  await app.like(0);
  click(app.$(".sp-send"));
  fill(app);
  await flush();
  assert.match(app.$(".sp-msg").textContent, /^目前送不出去，可以直接加 LINE：teddy_line_test$/);

  app = bootClient({ html: SHARE_HTML({ withLine: false }), api: () => { throw new TypeError("Failed to fetch"); } });
  await app.like(0);
  click(app.$(".sp-send"));
  fill(app);
  await flush();
  assert.equal(app.$(".sp-msg").textContent, "目前送不出去，請稍後再試一次。");
});

test("假 DOM：不是推薦頁（沒有我喜歡按鈕、網址不是 /share/<代號>/ 又沒帶 data-share、或不是官網／舊網址主機）→ 什麼都不做", { skip: !parse5 && "缺 parse5" }, async () => {
  const clock = makeClock(NOW);
  const none = async () => { throw new Error("不該打"); };
  const a = makeEnv({ html: "<!doctype html><html><head></head><body><p>x</p></body></html>", parse5, fetchImpl: none, clock });
  a.win.location.pathname = "/share/qsAbCd1234/";
  a.win.location.hostname = "teddy-house.tw";
  vm.runInContext(CLIENT_SRC, vm.createContext(a.win));
  assert.equal(a.doc.querySelector("#sp-root"), null);
  const b = makeEnv({ html: SHARE_HTML(), parse5, fetchImpl: none, clock });
  b.win.location.pathname = "/other/";
  b.win.location.hostname = "teddy-house.tw";
  vm.runInContext(CLIENT_SRC, vm.createContext(b.win));
  assert.equal(b.doc.querySelector("#sp-root"), null);
  const c = makeEnv({ html: SHARE_HTML(), parse5, fetchImpl: none, clock });
  c.win.location.pathname = "/share/qsAbCd1234/";
  c.win.location.hostname = "sky811117.github.io";
  vm.runInContext(CLIENT_SRC, vm.createContext(c.win));
  assert.equal(c.doc.querySelector("#sp-root"), null, "別的主機（例如直接開 GitHub Pages 原頁）不啟動");
});

/* ===================== 瀏覽器端：喜歡通知 ===================== */
test("share-pick.js：likeInit——本文只有 kind／代號／slug；text/plain（跨網域不先預檢）、keepalive、舊網址不帶 cookie；伺服器收得下", () => {
  const same = C.likeInit("qsAbCd1234", "q9z8y7x6w5", false);
  assert.deepEqual(JSON.parse(same.body), { kind: "like", share_id: "qsAbCd1234", slug: "q9z8y7x6w5" });
  assert.equal(same.method, "POST");
  assert.equal(same.headers["content-type"], "text/plain;charset=UTF-8");
  assert.equal(same.credentials, "same-origin");
  assert.equal(same.keepalive, true);
  assert.equal(same.referrerPolicy, "origin");
  assert.equal(C.likeInit("qsAbCd1234", "s1", true).credentials, "omit");
  assert.equal(P.validateLike(JSON.parse(same.body)).err, null);
});

test("假 DOM 喜歡通知：新按下送一則（同源、kind like）；同一間只送一次；失敗與成功畫面都不出聲；不寫瀏覽器儲存", { skip: !parse5 && "缺 parse5" }, async () => {
  const app = bootClient();
  await flush();
  await app.clock.advance(100);
  assert.equal(app.calls.length, 0, "載入時不送");
  await app.like(1);
  assert.equal(likesOf(app).length, 1);
  const c = likesOf(app)[0];
  assert.equal(c.url, "/api/find/pick");
  assert.deepEqual(c.body, { kind: "like", share_id: "qsAbCd1234", slug: "q9z8y7x6w5" });
  assert.equal(c.init.credentials, "same-origin");
  assert.equal(c.init.keepalive, true);
  assert.equal(P.validateLike(c.body).err, null, "伺服器收得下");
  // 再按一次（頁面上已經是喜歡，按了不會變）→ 不送
  await app.like(1);
  // 就算按鈕的 liked 被拿掉又加回（頁面本身不會這樣，保險）也不再送
  const b = app.doc.querySelectorAll(".card-like")[1];
  b.classList.remove("liked");
  click(b);
  await app.clock.advance(60);
  await app.like(1);
  assert.equal(likesOf(app).length, 1, "同一間只送一次");
  await app.like(0);
  assert.deepEqual(likesOf(app).map(x => x.body.slug), ["q9z8y7x6w5", "q1a2b3c4d5"], "別間照常送");
  assert.equal(app.$(".sp-msg").textContent, "", "不跳任何提示");
  assert.ok(!visible(app.$(".sp-sheet")), "不打開表單");
  assert.equal(app.$(".sp-count").textContent, "已選2間", "「已選 N 間」照常");
  assert.deepEqual([...app.win.localStorage._m.keys()], [], "沒有寫任何瀏覽器儲存");
  assert.deepEqual([...app.win.sessionStorage._m.keys()], []);
});

test("假 DOM 喜歡通知：送不出去（連不上／500／429）一律靜默——不跳提示、浮動列照常、之後的表單照常送", { skip: !parse5 && "缺 parse5" }, async () => {
  const fails = [
    () => { throw new TypeError("Failed to fetch"); },
    () => new Response("oops", { status: 500 }),
    () => new Response(JSON.stringify({ ok: false, v: 1, code: "E_RATE" }), { status: 429 }),
  ];
  for (const bad of fails) {
    const app = bootClient({ api: n => (n === 1 ? bad() : Response.json({ ok: true, v: 1, saved: true })) });
    await app.like(0);
    await flush();
    assert.equal(likesOf(app).length, 1);
    assert.equal(app.$(".sp-msg").textContent, "");
    assert.ok(visible(app.$(".sp-bar")));
    click(app.$(".sp-send"));
    app.$("#sp-phone").value = "0912345678";
    app.$("#sp-ok").checked = true;
    submit(app.$(".sp-form"));
    await flush();
    assert.equal(picksOf(app).length, 1);
    assert.ok(visible(app.$(".sp-done")), "表單照常送出");
  }
});

test("假 DOM 喜歡通知：景泰預覽（localStorage teddy_admin === '1'，跟頁面同一個旗標）不送；其他值照送", { skip: !parse5 && "缺 parse5" }, async () => {
  const admin = bootClient({ local: { teddy_admin: "1" } });
  await admin.like(0);
  await admin.like(1);
  assert.equal(likesOf(admin).length, 0, "預覽不推給自己");
  assert.equal(admin.$(".sp-count").textContent, "已選2間", "「已選 N 間」照常");
  for (const v of ["0", "true", ""]) {
    const app = bootClient({ local: { teddy_admin: v } });
    await app.like(0);
    assert.equal(likesOf(app).length, 1, `teddy_admin=${JSON.stringify(v)}`);
  }
});

test("假 DOM 喜歡通知：載入時就已喜歡的（按鈕 liked 或頁面 localStorage）不送、再點也不送；別的分頁按的不重複送；新按的才送", { skip: !parse5 && "缺 parse5" }, async () => {
  const cards = card("q1a2b3c4d5", "測試社區A 10樓 2房", "1,338", "37.57", true) +
    card("q9z8y7x6w5", "測試社區B 12樓 3房", "1,980", "45.2") +
    card("q5k5k5k5k5", "測試社區C 8樓 2房", "1,200", "30.1") +
    card("q7m7m7m7m7", "測試社區D 6樓 3房", "1,500", "40.2");
  const app = bootClient({ html: SHARE_HTML({ cards }), local: { teddy_like_qsAbCd1234_q5k5k5k5k5: "1" } });
  await flush();
  await app.clock.advance(100);
  assert.equal(app.calls.length, 0, "載入時不送");
  assert.equal(app.$(".sp-count").textContent, "已選2間");
  const btn = i => app.doc.querySelectorAll(".card-like")[i];
  // 已經喜歡的那間再點（頁面上不會變）→ 不送
  click(btn(0));
  await app.clock.advance(60);
  // localStorage 有、按鈕比較晚才亮（例如頁面自己的程式較晚跑）→ 也不送
  await app.like(2);
  assert.equal(likesOf(app).length, 0);
  // 別的分頁按了第 4 間（這頁收到 storage 事件、localStorage 有、這頁按鈕沒亮）→ 只記下來；之後這頁再按也不重複送
  app.win.localStorage.setItem("teddy_like_qsAbCd1234_q7m7m7m7m7", "1");
  for (const fn of app.win._l.storage || []) fn({ key: "teddy_like_qsAbCd1234_q7m7m7m7m7" });
  await app.clock.advance(60);
  await app.like(3);
  assert.equal(likesOf(app).length, 0, "別的分頁按的，那邊已經送過");
  // 新按的那間 → 送一則
  await app.like(1);
  assert.deepEqual(likesOf(app).map(x => x.body.slug), ["q9z8y7x6w5"]);
});

test("假 DOM 喜歡通知：舊網址 pages.dev → 跨網域送到 https://teddy-house.tw/api/find/pick、不帶 cookie、text/plain 不先預檢", { skip: !parse5 && "缺 parse5" }, async () => {
  const app = bootClient({ host: "teddy-website-blog.pages.dev" });
  await app.like(2);
  assert.equal(likesOf(app).length, 1);
  const c = likesOf(app)[0];
  assert.equal(c.url, "https://teddy-house.tw/api/find/pick");
  assert.deepEqual(c.body, { kind: "like", share_id: "qsAbCd1234", slug: "q5k5k5k5k5" });
  assert.equal(c.init.credentials, "omit");
  assert.equal(c.init.mode, "cors");
  assert.equal(c.init.headers["content-type"], "text/plain;charset=UTF-8");
  assert.equal(c.init.keepalive, true);
  // 伺服器那邊：舊網址來源、text/plain 本文 → 照樣收、帶 CORS
  P.resetPickState();
  const n = net();
  const r = await P.handlePick(req(c.init.body, { headers: { origin: OLD, "content-type": c.init.headers["content-type"] } }), n.deps);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), OLD);
  assert.deepEqual(textOf(tgCalls(n)[0]).split("\n"), LIKE_LINES("測試社區C 8樓 2房|1,200 萬|30.1 坪"));
});
