// 2026-10-06 審查修正的回歸測試（官網端點）。全部離線、假 fetch、不連任何真實主機。
//   防洗版：contact 端點要人機驗證；沒設 Turnstile 金鑰 fail-closed（不推 TG）；rate 對映成 E_RATE（不轉成 TG 線索）
//   防灌爆：IPv6 只看 /64；缺 IP 雜湊鹽＝查詢功能沒設定完成
//   不吞資料：feedback 在家用機 401／空本文時不能回「謝謝」；contact 在工作不存在時不改走 TG
//   其他：金鑰去空白、submit 逾時用同一個 idem 重送一次、健康檢查逾時不把網站翻成收件模式、Turnstile 的 hostname／action
import test from "node:test";
import assert from "node:assert/strict";
import { bundleTs } from "./_helpers.mjs";

const H = (await bundleTs("src/lib/find/handlers.ts")).mod;
const C = (await bundleTs("src/lib/find/canon.ts")).mod;
const T = (await bundleTs("src/lib/find/turnstile.ts")).mod;

const UP = "https://home.invalid:8443";
const ENV = {
  FIND_ENABLED: "1", FIND_UPSTREAM_URL: UP, FIND_HMAC_SECRET: "test-secret-do-not-use", FIND_IP_SALT: "test-salt",
  TURNSTILE_SECRET_KEY: "ts-secret", TURNSTILE_SITE_KEY: "0xTESTSITEKEY", CONTACT_TG_TOKEN: "tg-token", CONTACT_TG_CHAT: "99",
};
const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const ORIGIN = { origin: "https://teddy-house.tw" };
const CONSENT = { contact: true, v: "2026-10-06" };

function net(over = {}) {
  const calls = [];
  const routes = {
    turnstile: () => Response.json({ success: true, hostname: "teddy-house.tw", action: "find" }),
    tg: () => Response.json({ ok: true }),
    submit: () => Response.json({ ok: true, v: 1, status: "queued", jobId: JOB, queue: { ahead: 0, eta_s: 60 }, saved: true }),
    status: () => Response.json({ ok: true, v: 1, status: "searching" }),
    contact: () => Response.json({ ok: true, saved: true }),
    event: () => Response.json({ ok: true, n: 1 }),
    feedback: () => Response.json({ ok: true }),
    health: () => Response.json({ ok: true, v: 1, mode: "live", queue: { len: 0, eta_s: 0 } }),
    ...over,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("https://challenges.cloudflare.com/")) return routes.turnstile(u, init);
    if (u.startsWith("https://api.telegram.org/")) return routes.tg(u, init);
    for (const k of ["submit", "status", "contact", "event", "feedback", "health"]) if (u.startsWith(`${UP}/aif/v1/${k}`)) return routes[k](u, init);
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { calls, deps: { fetch: fetchImpl, now: () => 1790000000000 } };
}
const upCalls = n => n.calls.filter(c => c.url.startsWith(UP));
const tgCalls = n => n.calls.filter(c => c.url.startsWith("https://api.telegram.org/"));
const post = (path, body, { headers = ORIGIN, env = ENV } = {}) => ({
  ctx: { request: new Request("https://teddy-house.tw" + path, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...headers }, body: JSON.stringify(body) }), env, waitUntil: () => {} },
});
const get = (path, { env = ENV } = {}) => ({ ctx: { request: new Request("https://teddy-house.tw" + path, { method: "GET" }), env } });
const jsonOf = async res => JSON.parse(await res.text());
const goodSubmit = (over = {}) => ({
  v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDe", fields: { districts: ["北屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000 },
  context: {}, free_text: "北屯三房", skip: false, contact: null, consent: null, refine_of: null, from: "line", fill_ms: 41000, turnstile: "tok", hp: "", ...over,
});
const goodContact = (over = {}) => ({ v: 1, jid: JOB, contact: { line: "spam_1234", pref: "line" }, consent: CONSENT, hp: "", turnstile: "tok", ...over });

/* ---------- 防洗版 ---------- */
test("contact：沒有人機驗證 token→403，500 次都不會推 TG（原本只靠可偽造的 Origin）", async () => {
  const n = net();
  for (let i = 0; i < 500; i++) {
    const res = await H.handleContact(post("/api/find/contact", goodContact({ jid: null, turnstile: "", contact: { line: "spam_" + i } })).ctx, n.deps);
    assert.equal(res.status, 403);
    assert.equal((await jsonOf(res)).code, "E_HUMAN");
  }
  assert.equal(tgCalls(n).length, 0);
  assert.equal(upCalls(n).length, 0);
  assert.equal(n.calls.length, 0, "沒 token 連 siteverify 都不用打");
});

test("contact：人機驗證沒過→403；驗證服務連不上／沒設金鑰→saved:false 且不推 TG、不轉送", async () => {
  let n = net({ turnstile: () => Response.json({ success: false }) });
  assert.equal((await H.handleContact(post("/api/find/contact", goodContact()).ctx, n.deps)).status, 403);
  assert.equal(tgCalls(n).length + upCalls(n).length, 0);
  for (const [name, n2, env] of [["連不上", net({ turnstile: () => { throw new Error("x"); } }), ENV], ["沒設金鑰", net(), { ...ENV, TURNSTILE_SECRET_KEY: undefined }]]) {
    const j = await jsonOf(await H.handleContact(post("/api/find/contact", goodContact({ jid: null }), { env }).ctx, n2.deps));
    assert.deepEqual(j, { ok: true, v: 1, saved: false }, name);
    assert.equal(tgCalls(n2).length + upCalls(n2).length, 0, name);
  }
});

test("contact：驗證通過後才轉送；家用機說工作不存在→E_NOT_FOUND，不改走 TG；說太頻繁→E_RATE", async () => {
  let n = net({ contact: () => new Response(JSON.stringify({ ok: false, code: "not_found" }), { status: 404 }) });
  let res = await H.handleContact(post("/api/find/contact", goodContact()).ctx, n.deps);
  assert.equal(res.status, 404);
  assert.equal((await jsonOf(res)).code, "E_NOT_FOUND");
  assert.equal(tgCalls(n).length, 0);
  n = net({ contact: () => new Response("", { status: 429 }) });
  res = await H.handleContact(post("/api/find/contact", goodContact()).ctx, n.deps);
  assert.equal((await jsonOf(res)).code, "E_RATE");
  assert.equal(tgCalls(n).length, 0);
  // 家用機真的連不上才直送 TG（線索仍然不丟）
  n = net({ contact: () => { throw new Error("down"); } });
  assert.equal((await jsonOf(await H.handleContact(post("/api/find/contact", goodContact()).ctx, n.deps))).saved, true);
  assert.equal(tgCalls(n).length, 1);
});

test("submit：沒設 Turnstile 金鑰（建議的「先收件」上線姿勢）→200 次空 token 提交，TG 呼叫 0 次", async () => {
  const env = { ...ENV, TURNSTILE_SECRET_KEY: undefined };
  const n = net();
  for (let i = 0; i < 200; i++) {
    const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit({ turnstile: "" }), { env }).ctx, n.deps));
    assert.equal(j.status, "degraded");
    assert.equal(j.saved, false);
  }
  assert.equal(tgCalls(n).length, 0);
  assert.equal(upCalls(n).length, 0);
});

test("submit：家用機回 {ok:false,code:'rate'}→429 E_RATE，100 次連送 TG 0 則（原本每筆都變成一則 TG 線索）", async () => {
  const n = net({ submit: () => Response.json({ ok: false, v: 1, code: "rate" }) });
  for (let i = 0; i < 100; i++) {
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps);
    assert.equal(res.status, 429);
    const j = await jsonOf(res);
    assert.equal(j.code, "E_RATE");
    assert.equal(j.retry, true);
    assert.ok(!("jobId" in j));
  }
  assert.equal(tgCalls(n).length, 0);
  // 空本文的 429 也一樣
  const n2 = net({ submit: () => new Response("", { status: 429 }) });
  const res2 = await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n2.deps);
  assert.equal(res2.status, 429);
  assert.equal(tgCalls(n2).length, 0);
});

test("status：家用機說 rate（輪詢太密）→status:unknown 並放慢，不是壞掉", async () => {
  for (const fn of [() => Response.json({ ok: false, v: 1, code: "rate" }), () => new Response("", { status: 429 })]) {
    const j = await jsonOf(await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, net({ status: fn }).deps));
    assert.deepEqual(j, { ok: true, v: 1, status: "unknown", pollMs: 10000 });
  }
});

/* ---------- 不吞資料 ---------- */
test("feedback：家用機回 401／空本文／怪形狀→E_FORWARD（不能回「謝謝」卻把回饋吃掉）", async () => {
  const body = { v: 1, jid: JOB, rating: 1, tags: ["just_right"], text: "", fatigue: null };
  for (const fn of [() => new Response("", { status: 401 }), () => new Response("", { status: 200 }), () => Response.json({ weird: 1 })]) {
    const res = await H.handleFeedback(post("/api/find/feedback", body).ctx, net({ feedback: fn }).deps);
    assert.equal((await jsonOf(res)).code, "E_FORWARD");
  }
  const rate = await H.handleFeedback(post("/api/find/feedback", body).ctx, net({ feedback: () => new Response("", { status: 429 }) }).deps);
  assert.equal((await jsonOf(rate)).code, "E_RATE");
  assert.deepEqual(await jsonOf(await H.handleFeedback(post("/api/find/feedback", body).ctx, net().deps)), { ok: true, v: 1 });
});

/* ---------- 設定 ---------- */
test("liveReady：缺 IP 雜湊鹽／簽章金鑰太短／沒開總開關＝收件模式（fail-closed），config 也回 intake", async () => {
  assert.equal(H.liveReady(ENV), true);
  for (const bad of [{ FIND_IP_SALT: undefined }, { FIND_IP_SALT: "  \n" }, { FIND_IP_SALT: "x" }, { FIND_HMAC_SECRET: undefined }, { FIND_HMAC_SECRET: "short" }, { FIND_ENABLED: "0" }, { FIND_UPSTREAM_URL: "http://example.com" }]) {
    assert.equal(H.liveReady({ ...ENV, ...bad }), false, JSON.stringify(bad));
  }
  H.resetConfigCache();
  const n = net();
  const j = await jsonOf(await H.handleConfig(get("/api/find/config", { env: { ...ENV, FIND_IP_SALT: undefined } }).ctx, n.deps));
  assert.equal(j.mode, "intake");
  assert.equal(upCalls(n).length, 0);
  // submit 也不轉送（缺鹽時所有人會共用一個防灌爆桶）；收件（TG）照常
  const n2 = net();
  const s = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), { env: { ...ENV, FIND_IP_SALT: undefined } }).ctx, n2.deps));
  assert.equal(s.status, "degraded");
  assert.equal(upCalls(n2).length, 0);
  assert.equal(tgCalls(n2).length, 1);
});

test("金鑰與鹽帶了換行／空白也能運作（簽章用去空白後的金鑰）", async () => {
  const env = { ...ENV, FIND_HMAC_SECRET: ENV.FIND_HMAC_SECRET + "\n", FIND_IP_SALT: " " + ENV.FIND_IP_SALT + "\r\n", FIND_UPSTREAM_URL: UP + " \n" };
  const n = net();
  await H.handleSubmit(post("/api/find/submit", goodSubmit(), { env }).ctx, n.deps);
  const up = upCalls(n)[0];
  assert.ok(up, "有轉送");
  const h = up.init.headers;
  const bodyHash = await C.sha256Hex(up.init.body);
  const want = await C.hmacHex(ENV.FIND_HMAC_SECRET, C.canonString("POST", "/aif/v1/submit", h["X-Aif-Ts"], h["X-Aif-Nonce"], bodyHash));
  assert.equal(h["X-Aif-Sig"], want);
  assert.equal(h["X-Aif-Kid"], await C.keyId(ENV.FIND_HMAC_SECRET));
});

test("config：健康檢查逾時時沿用上一次的結果（不會 live→intake→live 來回閃）；第一次就逾時才是 intake", async () => {
  H.resetConfigCache();
  let t = 1790000000000;
  const good = net();
  good.deps.now = () => t;
  assert.equal((await jsonOf(await H.handleConfig(get("/api/find/config").ctx, good.deps))).mode, "live");
  t += 20000;
  const bad = net({ health: () => { throw new Error("slow"); } });
  bad.deps.now = () => t;
  assert.equal((await jsonOf(await H.handleConfig(get("/api/find/config").ctx, bad.deps))).mode, "live");
  H.resetConfigCache();
  const first = net({ health: () => { throw new Error("slow"); } });
  assert.equal((await jsonOf(await H.handleConfig(get("/api/find/config").ctx, first.deps))).mode, "intake");
});

/* ---------- 重送與對帳 ---------- */
test("submit：逾時→用同一個 idem、新的 nonce 再送一次；第二次成功就不降級、不推 TG", async () => {
  let k = 0;
  const n = net({ submit: () => { k++; if (k === 1) { const e = new Error("t"); e.name = "AbortError"; throw e; } return Response.json({ ok: true, v: 1, status: "queued", jobId: JOB, saved: true }); } });
  const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps));
  assert.equal(j.status, "queued");
  assert.equal(j.jobId, JOB);
  const up = upCalls(n);
  assert.equal(up.length, 2);
  const [a, b] = up.map(c => ({ body: new TextDecoder().decode(c.init.body), nonce: c.init.headers["X-Aif-Nonce"] }));
  assert.equal(a.body, b.body, "同一個 idem、同一份本文");
  assert.notEqual(a.nonce, b.nonce, "nonce 不能重用（家用機 5 分鐘內拒絕重複 nonce）");
  assert.equal(tgCalls(n).length, 0);
  // 兩次都逾時才降級收件，TG 線索帶對帳碼
  const n2 = net({ submit: () => { const e = new Error("t"); e.name = "AbortError"; throw e; } });
  const j2 = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n2.deps));
  assert.equal(j2.status, "degraded");
  assert.equal(upCalls(n2).length, 2);
  assert.ok(JSON.parse(tgCalls(n2)[0].init.body).text.includes("對帳碼：<code>Qw3kT9</code>"));
});

/* ---------- IP 收斂 ---------- */
test("maskIp／ipHash：IPv6 只看 /64；同一個 /64 不管怎麼換後面都是同一個來源；IPv4-mapped 等同 IPv4", async () => {
  assert.equal(C.maskIp("203.0.113.9"), "203.0.113.9");
  assert.equal(C.maskIp("::ffff:203.0.113.9"), "203.0.113.9");
  const a = "2001:db8:1234:5678:aaaa:bbbb:cccc:dddd";
  const b = "2001:0db8:1234:5678::1";
  const c = "2001:db8:1234:5679::1";
  assert.equal(C.maskIp(a), "2001:0db8:1234:5678::/64");
  assert.equal(C.maskIp(b), C.maskIp(a));
  assert.notEqual(C.maskIp(c), C.maskIp(a));
  assert.equal(C.maskIp("[2001:db8:1234:5678::1]"), C.maskIp(a));
  const now = 1790000000000;
  const h1 = await C.ipHash("test-salt", a, now);
  assert.equal(await C.ipHash("test-salt", b, now), h1);
  assert.equal(await C.ipHash("test-salt  \n", "2001:db8:1234:5678:1:2:3:4", now), h1);
  assert.notEqual(await C.ipHash("test-salt", c, now), h1);
  assert.equal(await C.ipHash("test-salt", "::ffff:203.0.113.9", now), await C.ipHash("test-salt", "203.0.113.9", now));
  assert.equal(await C.ipHash("", a, now), null);
  assert.equal(await C.ipHash("   ", a, now), null);
  // 看不懂的格式不放行成「同一桶」：原樣進雜湊
  assert.equal(C.maskIp("not-an-ip:zz"), "not-an-ip:zz");
});

/* ---------- Turnstile 的 hostname／action ---------- */
test("Turnstile：回應的 hostname 不是官網、或 action 不符→fail（別處的 token 不能拿來通過這裡）", async () => {
  const mk = body => async () => Response.json(body);
  const run = body => T.verifyTurnstile({ secret: "s", token: "t", fetchImpl: mk(body), action: "find" });
  // 紅隊 RT-04：action 改成嚴格——有預期值時，回應沒帶、帶空字串、帶別的值一律不過
  assert.equal(await run({ success: true }), "fail", "沒帶 action 的回應（別張表單的 token）不能通過");
  assert.equal(await run({ success: true, hostname: "teddy-house.tw", action: "" }), "fail", "空字串 action（前端沒寫用途時 Cloudflare 的回應）不能通過");
  assert.equal(await run({ success: true, hostname: "teddy-house.tw", action: "find" }), "ok");
  assert.equal(await run({ success: true, hostname: "www.teddy-house.tw", action: "find" }), "ok");
  assert.equal(await run({ success: true, hostname: "evil.example", action: "find" }), "fail");
  assert.equal(await run({ success: true, hostname: "teddy-house.tw", action: "other-form" }), "fail");
  assert.equal(await run({ success: false }), "fail");
  assert.equal(await T.verifyTurnstile({ secret: "  ", token: "t", fetchImpl: mk({ success: true }) }), "unavailable");
  // 沒指定預期 action 的呼叫端（目前沒有）不比對 action
  assert.equal(await T.verifyTurnstile({ secret: "s", token: "t", fetchImpl: mk({ success: true }) }), "ok");
  const seen = [];
  await T.verifyTurnstile({ secret: "s", token: "t", remoteIp: "203.0.113.9", fetchImpl: async (u, init) => { seen.push(String(init.body)); return Response.json({ success: true }); } });
  assert.match(seen[0], /remoteip=203\.0\.113\.9/);
});
