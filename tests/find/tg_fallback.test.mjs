// 2026-10-07 收件送不出去（景泰實測：「目前沒能把你的需求送出去」）的修正：
//   找房專用那隻機器人（FIND_TG_*）送不出去 → 改用舊表單那隻（CONTACT_TG_*）送，線索不掉；
//   全部失敗才 saved:false，並附一個只有失敗種類的短代碼（diag），畫面小字顯示，方便查是哪一關。
// 全部離線、假 fetch、不連任何真實主機。
import test from "node:test";
import assert from "node:assert/strict";
import { bundleTs } from "./_helpers.mjs";

const H = (await bundleTs("src/lib/find/handlers.ts")).mod;

const ORIGIN = { origin: "https://teddy-house.tw" };
const BASE = { TURNSTILE_SECRET_KEY: "ts-secret", TURNSTILE_SITE_KEY: "0xTESTSITEKEY" };   // 收件模式（沒設 FIND_ENABLED）
const BOTH = { ...BASE, FIND_TG_TOKEN: "find-token", FIND_TG_CHAT: "11", CONTACT_TG_TOKEN: "contact-token", CONTACT_TG_CHAT: "22" };
const CONSENT = { contact: true, v: "2026-10-06" };

function net(tg) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("https://challenges.cloudflare.com/")) return Response.json({ success: true, hostname: "teddy-house.tw", action: "find" });
    if (u.startsWith("https://api.telegram.org/")) return tg(u, init);
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { calls, deps: { fetch: fetchImpl, now: () => 1790000000000 } };
}
const tgCalls = n => n.calls.filter(c => c.url.startsWith("https://api.telegram.org/"));
const botOf = c => c.url.slice("https://api.telegram.org/bot".length).split("/")[0];
const post = (path, body, env) => ({ request: new Request("https://teddy-house.tw" + path, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...ORIGIN }, body: JSON.stringify(body) }), env, waitUntil: () => {} });
const jsonOf = async res => JSON.parse(await res.text());
const goodSubmit = (over = {}) => ({
  v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDe", fields: { districts: ["西屯區"], types: ["elevator_building"], price_max_wan: 1500, age_max: 20 },
  context: {}, free_text: "西屯電梯大樓 1500萬以內 20年內", skip: false, contact: null, consent: null, refine_of: null, from: null, fill_ms: 41000, turnstile: "tok", hp: "", ...over,
});
const goodContact = () => ({ v: 1, jid: null, contact: { line: "teddy_test", pref: "line" }, consent: CONSENT, hp: "", turnstile: "tok" });
const tgStatus = map => u => {
  const s = map[botOf({ url: u })] ?? 200;
  return s === "throw" ? (() => { throw new Error("net"); })() : new Response(JSON.stringify({ ok: s === 200 }), { status: s });
};

test("tgTargets：兩組都有就依序 FIND → CONTACT；兩組一樣只算一次；只有一組就一組；都沒有＝空", () => {
  assert.deepEqual(H.tgTargets(BOTH), [{ token: "find-token", chat: "11" }, { token: "contact-token", chat: "22" }]);
  assert.deepEqual(H.tgTargets({ FIND_TG_TOKEN: "x", FIND_TG_CHAT: "1", CONTACT_TG_TOKEN: "x", CONTACT_TG_CHAT: "1" }), [{ token: "x", chat: "1" }]);
  assert.deepEqual(H.tgTargets({ CONTACT_TG_TOKEN: "c", CONTACT_TG_CHAT: "2" }), [{ token: "c", chat: "2" }]);
  assert.deepEqual(H.tgTargets({ FIND_TG_TOKEN: "f" }), []);
  assert.deepEqual(H.tgTargets({}), []);
});

test("tgPair：後台貼錯的常見樣子自動修正（多了 bot、整串網址、引號、兩格貼反）；挑不出來照原樣", () => {
  const T = "1234567890:test_fake_token_not_real_0123456789ab";
  assert.deepEqual(H.tgPair(T, "905627471"), { token: T, chat: "905627471" });
  assert.deepEqual(H.tgPair("bot" + T, "905627471"), { token: T, chat: "905627471" });
  assert.deepEqual(H.tgPair(`https://api.telegram.org/bot${T}/sendMessage`, "905627471"), { token: T, chat: "905627471" });
  assert.deepEqual(H.tgPair(`"${T}"`, " '905627471' "), { token: T, chat: "905627471" });
  assert.deepEqual(H.tgPair("905627471", T), { token: T, chat: "905627471" });          // 兩格貼反
  assert.deepEqual(H.tgPair("find-token", "11"), { token: "find-token", chat: "11" });   // 不像金鑰：照原樣（測試假值也走這條）
  assert.deepEqual(H.tgPair("bot12345", "11"), { token: "12345", chat: "11" });
  // tgTargets 用修正後的值比對「兩組是不是同一隻」
  assert.deepEqual(H.tgTargets({ FIND_TG_TOKEN: "bot" + T, FIND_TG_CHAT: "1", CONTACT_TG_TOKEN: T, CONTACT_TG_CHAT: "1" }), [{ token: T, chat: "1" }]);
});

test("收件：找房機器人金鑰前面多貼了 bot → 自動修正後送出成功（打的是正確的網址）", async () => {
  const T = "1234567890:test_fake_token_not_real_0123456789ab";
  const n = net(u => (u.includes("/botbot") ? new Response("{}", { status: 404 }) : Response.json({ ok: true })));
  const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), { ...BASE, FIND_TG_TOKEN: "bot" + T, FIND_TG_CHAT: "905627471" }), n.deps));
  assert.equal(j.saved, true);
  assert.deepEqual(tgCalls(n).map(c => c.url), [`https://api.telegram.org/bot${T}/sendMessage`]);
});

test("收件：找房機器人回 403（還沒按開始）→ 改用舊表單機器人送，客人看到「記下來了」，不顯示代碼", async () => {
  const n = net(tgStatus({ "find-token": 403 }));
  const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), BOTH), n.deps));
  assert.equal(j.status, "degraded");
  assert.equal(j.saved, true);
  assert.equal(j.diag, undefined);
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token", "contact-token"]);
  // 兩次送的是同一則訊息
  const [a, b] = tgCalls(n).map(c => JSON.parse(c.init.body));
  assert.equal(a.text, b.text);
  assert.equal(b.chat_id, "22");
});

test("收件：找房機器人成功就只送一次，不打擾舊機器人", async () => {
  const n = net(tgStatus({}));
  const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), BOTH), n.deps));
  assert.equal(j.saved, true);
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token"]);
});

test("收件：兩隻都失敗 → saved:false，代碼列出兩關的失敗種類（不含金鑰）", async () => {
  for (const [map, diag] of [
    [{ "find-token": 403, "contact-token": 401 }, "tg-fh403s-ch401s"],
    [{ "find-token": 400, "contact-token": "throw" }, "tg-fh400s-cnets"],
  ]) {
    const n = net(tgStatus(map));
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit(), BOTH), n.deps);
    const text = await res.clone().text();
    const j = JSON.parse(text);
    assert.equal(j.saved, false);
    assert.equal(j.diag, diag);
    assert.ok(!text.includes("find-token") && !text.includes("contact-token"), "回應不能帶金鑰");
  }
});

test("收件：完全沒設 Telegram → 代碼 tg-none；只有一組且失敗 → 只有一段代碼", async () => {
  let n = net(tgStatus({}));
  let j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), BASE), n.deps));
  assert.equal(j.saved, false);
  assert.equal(j.diag, "tg-none");
  assert.equal(tgCalls(n).length, 0);
  n = net(tgStatus({ "c": 403 }));
  j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), { ...BASE, CONTACT_TG_TOKEN: "c", CONTACT_TG_CHAT: "2" }), n.deps));
  assert.equal(j.diag, "tg-ch403s");
});

test("補留聯絡方式：一樣會改用舊機器人；都失敗時 saved:false＋代碼", async () => {
  let n = net(tgStatus({ "find-token": 403 }));
  let j = await jsonOf(await H.handleContact(post("/api/find/contact", goodContact(), BOTH), n.deps));
  assert.deepEqual(j, { ok: true, v: 1, saved: true });
  assert.deepEqual(tgCalls(n).map(botOf), ["find-token", "contact-token"]);
  n = net(tgStatus({ "find-token": 403, "contact-token": 403 }));
  j = await jsonOf(await H.handleContact(post("/api/find/contact", goodContact(), BOTH), n.deps));
  assert.deepEqual(j, { ok: true, v: 1, saved: false, diag: "tg-fh403s-ch403s" });
});

test("代碼帶「哪一隻＋金鑰長相」（不洩漏金鑰）：f／c、k 像金鑰、d 全數字、a @開頭、s 太短、o 其他；FIND 只填一格標 p", async () => {
  const T = "1234567890:test_fake_token_not_real_0123456789ab";
  assert.equal(H.tgShape(T), "k");
  assert.equal(H.tgShape("905627471"), "d");
  assert.equal(H.tgShape("@teddy_find_bot"), "a");
  assert.equal(H.tgShape("abc"), "s");
  assert.equal(H.tgShape("x".repeat(30)), "o");
  // FIND 金鑰貼成聊天編號、聊天編號也是數字（不會被當成貼反）：兩隻都 404
  let n = net(() => new Response("{}", { status: 404 }));
  let j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), { ...BASE, FIND_TG_TOKEN: "905627471", FIND_TG_CHAT: "905627471", CONTACT_TG_TOKEN: T, CONTACT_TG_CHAT: "22" }), n.deps));
  assert.equal(j.diag, "tg-fh404d-ch404k");
  assert.ok(!JSON.stringify(j).includes("test_fake_token"));
  // FIND 只填了金鑰、聊天編號空的 → 整組不算，直接用舊表單那隻；代碼前面有 p
  n = net(() => new Response("{}", { status: 404 }));
  j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), { ...BASE, FIND_TG_TOKEN: T, CONTACT_TG_TOKEN: "@old_bot", CONTACT_TG_CHAT: "22" }), n.deps));
  assert.equal(j.diag, "tg-p-ch404a");
  assert.match(j.diag, /^[a-z0-9-]{1,24}$/);   // 前端只顯示符合這個格式的代碼
});
