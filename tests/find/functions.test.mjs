// 同源端點（src/lib/find/handlers.ts）合約測試：全部離線，fetch 用假的；不連任何真實主機。
import test from "node:test";
import assert from "node:assert/strict";
import { bundleTs, readFixture } from "./_helpers.mjs";

const H = (await bundleTs("src/lib/find/handlers.ts")).mod;
const C = (await bundleTs("src/lib/find/canon.ts")).mod;
const E = (await bundleTs("src/lib/find/errors.ts")).mod;
const S = (await bundleTs("src/lib/find/schema.ts")).mod;

const POISON = "ZZPOISON_A1";
const UP = "https://home.invalid:8443";
const ENV = {
  FIND_ENABLED: "1",
  FIND_UPSTREAM_URL: UP,
  FIND_HMAC_SECRET: "test-secret-do-not-use",
  FIND_IP_SALT: "test-salt",
  TURNSTILE_SECRET_KEY: "ts-secret",
  TURNSTILE_SITE_KEY: "0xTESTSITEKEY",
  CONTACT_TG_TOKEN: "tg-token",
  CONTACT_TG_CHAT: "99",
};
const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const SHARE = "https://teddy-house.tw/share/qa008kmn3x7q2pzrtavb5ncdetwoxy4k/";
const ORIGIN = { origin: "https://teddy-house.tw" };

/** 假網路：依網址前綴回應；記錄每一次呼叫。 */
function net(over = {}) {
  const calls = [];
  const routes = {
    turnstile: () => Response.json({ success: true, hostname: "teddy-house.tw", action: "find" }),
    tg: () => Response.json({ ok: true }),
    submit: () => Response.json({ ok: true, v: 1, status: "queued", jobId: JOB, queue: { ahead: 1, eta_s: 150 }, saved: true }),
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
    if (u.startsWith(UP + "/aif/v1/submit")) return routes.submit(u, init);
    if (u.startsWith(UP + "/aif/v1/status")) return routes.status(u, init);
    if (u.startsWith(UP + "/aif/v1/contact")) return routes.contact(u, init);
    if (u.startsWith(UP + "/aif/v1/event")) return routes.event(u, init);
    if (u.startsWith(UP + "/aif/v1/feedback")) return routes.feedback(u, init);
    if (u.startsWith(UP + "/aif/v1/health")) return routes.health(u, init);
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { calls, fetchImpl, deps: { fetch: fetchImpl, now: () => 1790000000000 } };
}
const upCalls = n => n.calls.filter(c => c.url.startsWith(UP));
const tgCalls = n => n.calls.filter(c => c.url.startsWith("https://api.telegram.org/"));

function post(path, body, { headers = ORIGIN, env = ENV } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request("https://teddy-house.tw" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...headers },
    body: raw,
  });
  const pending = [];
  return { ctx: { request, env, waitUntil: p => pending.push(p) }, pending };
}
function get(path, { headers = {}, env = ENV } = {}) {
  return { ctx: { request: new Request("https://teddy-house.tw" + path, { method: "GET", headers }), env } };
}

const goodSubmit = (over = {}) => ({
  v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDe",
  fields: { districts: ["北屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000, parking: "flat", exclude_top: true },
  context: { stage: "first", concerns: ["loan"] },
  free_text: "北屯三房，兩千萬內", skip: false, contact: null, consent: null, refine_of: null,
  from: "line", fill_ms: 41000, turnstile: "tok", hp: "", ...over,
});

async function jsonOf(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}
function assertNoPoison(res, text) {
  assert.ok(!text.includes(POISON), "回應本文含毒標記");
  for (const [k, v] of res.headers) assert.ok(!(k + v).includes(POISON), `標頭含毒標記 ${k}`);
}

/* ---------- ① 正常流程 ---------- */
test("submit：正常提交→簽章轉送→回白名單格式", async () => {
  const n = net();
  const { ctx } = post("/api/find/submit", goodSubmit());
  const res = await H.handleSubmit(ctx, n.deps);
  assert.equal(res.status, 200);
  const j = await jsonOf(res);
  assert.deepEqual(j, { ok: true, v: 1, status: "queued", jobId: JOB, saved: true, pollMs: 6000, queue: { ahead: 1, eta_s: 150 } });
  const up = upCalls(n);
  assert.equal(up.length, 1);
  assert.equal(up[0].url, UP + "/aif/v1/submit");
  // 簽章驗得過：重算一次
  const h = up[0].init.headers;
  const bodyBytes = up[0].init.body;
  const bodyHash = await C.sha256Hex(bodyBytes);
  const sig = await C.hmacHex(ENV.FIND_HMAC_SECRET, C.canonString("POST", "/aif/v1/submit", h["X-Aif-Ts"], h["X-Aif-Nonce"], bodyHash));
  assert.equal(h["X-Aif-Sig"], sig);
  assert.equal(h["X-Aif-Kid"], await C.keyId(ENV.FIND_HMAC_SECRET));
  assert.match(h["X-Aif-Nonce"], /^[0-9a-f]{32}$/);
  // 送給家用機的內容只有白名單欄位；ip 只有雜湊
  const sent = JSON.parse(new TextDecoder().decode(bodyBytes));
  assert.deepEqual(Object.keys(sent).sort(), ["client", "consent", "contact", "context", "fields", "free_text", "idem", "refine_of", "skip", "v"]);
  assert.deepEqual(Object.keys(sent.client).sort(), ["fill_ms", "from", "ip_h", "turnstile", "ua"]);
  assert.equal(sent.client.ua, "m");
  assert.equal(sent.client.turnstile, "ok");
});

test("submit：每天換鹽的 IP 雜湊——同一天同 IP 相同、換天或換 IP 不同、不含原 IP", async () => {
  const n = net();
  const mk = ip => post("/api/find/submit", goodSubmit(), { headers: { ...ORIGIN, "cf-connecting-ip": ip } });
  await H.handleSubmit(mk("203.0.113.9").ctx, n.deps);
  await H.handleSubmit(mk("203.0.113.9").ctx, n.deps);
  await H.handleSubmit(mk("203.0.113.10").ctx, n.deps);
  const ips = upCalls(n).map(c => JSON.parse(new TextDecoder().decode(c.init.body)).client.ip_h);
  assert.equal(ips[0], ips[1]);
  assert.notEqual(ips[0], ips[2]);
  assert.match(ips[0], /^[0-9a-f]{16}$/);
  const d2 = await C.ipHash("test-salt", "203.0.113.9", 1790000000000 + 86400000);
  assert.notEqual(d2, ips[0]);
  for (const c of upCalls(n)) assert.ok(!new TextDecoder().decode(c.init.body).includes("203.0.113"));
});

test("submit：need_more（條件太模糊）直接轉成白名單格式", async () => {
  const n = net({ submit: () => Response.json({ ok: true, v: 1, status: "need_more", missing: ["price", "rooms", POISON], ask: ["q_budget", "q_rooms", "q_evil"] }) });
  const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps));
  assert.deepEqual(j, { ok: true, v: 1, status: "need_more", missing: ["price", "rooms"], ask: ["q_budget", "q_rooms"] });
});

test("submit：家用機回降級（busy／night／亂寫的 kind）→ 固定訊息", async () => {
  for (const [kind, msg] of [["busy", "現在比較多人，需求先記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來看看。"], ["night", "現在是深夜，需求先記下來了。想明天收到回覆，請留 LINE 或電話。"], [POISON, "需求記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來這頁看看。"]]) {
    const n = net({ submit: () => Response.json({ ok: true, v: 1, status: "degraded", jobId: JOB, kind, saved: true, msg: POISON }) });
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps);
    const text = await res.clone().text();
    assertNoPoison(res, text);
    const j = JSON.parse(text);
    assert.equal(j.status, "degraded");
    assert.equal(j.msg, msg);
    assert.equal(j.jobId, JOB);
    assert.equal(tgCalls(n).length, 0, "家用機已降級收件，Function 不重複推 TG");
  }
});

test("status：轉送簽章 GET，回白名單格式；排隊資訊與階段", async () => {
  const n = net({ status: () => Response.json({ ok: true, v: 1, status: "queued", queue: { ahead: 2, eta_s: 240 }, msg: POISON, finder: POISON }) });
  const res = await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, n.deps);
  const text = await res.clone().text();
  assertNoPoison(res, text);
  assert.deepEqual(JSON.parse(text), { ok: true, v: 1, status: "queued", stage: "q", msg: "收到了，正在排隊…", pollMs: 6000, queue: { ahead: 2, eta_s: 240 } });
  assert.equal(upCalls(n)[0].url, `${UP}/aif/v1/status?id=${JOB}`);
  assert.equal(upCalls(n)[0].init.method, "GET");
});

test("status：done 的 shareUrl 必須是官網 /share/qa…/ 格式，否則改成降級", async () => {
  const ok = net({ status: () => Response.json({ ok: true, v: 1, status: "done", count: 7, shareUrl: SHARE }) });
  const j1 = await jsonOf(await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, ok.deps));
  assert.deepEqual(j1, { ok: true, v: 1, status: "done", stage: "d", msg: "整理好了。", shareUrl: SHARE, count: 7 });
  for (const bad of ["https://evil.example/share/qa008kmn3x7q2pzrtavb5ncdetwoxy4k/", "https://teddy-house.tw/share/abc/", SHARE + "x", "http://teddy-house.tw/share/qa008kmn3x7q2pzrtavb5ncdetwoxy4k/", "javascript:alert(1)", null, 5]) {
    const n = net({ status: () => Response.json({ ok: true, v: 1, status: "done", count: 7, shareUrl: bad }) });
    const j = await jsonOf(await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, n.deps));
    assert.equal(j.status, "degraded", String(bad));
    assert.ok(!("shareUrl" in j));
  }
});

test("status：empty 的 hint 只留列舉值；expired；找不到→404 E_NOT_FOUND", async () => {
  let n = net({ status: () => Response.json({ ok: true, status: "empty", hint: ["loosen_price", POISON, "drop_floor"] }) });
  let j = await jsonOf(await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, n.deps));
  assert.deepEqual(j, { ok: true, v: 1, status: "empty", stage: "d", msg: "這次沒有找到完全符合的。", count: 0, hint: ["loosen_price", "drop_floor"] });
  n = net({ status: () => new Response("", { status: 404 }) });
  const res = await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, n.deps);
  assert.equal(res.status, 404);
  assert.equal((await jsonOf(res)).code, "E_NOT_FOUND");
});

test("status：jobId 格式不符→400；非同源→403", async () => {
  const n = net();
  for (const id of ["", "abc", JOB + "x", "b" + JOB.slice(1), "../../etc/passwd", JOB.replace("X", "$")]) {
    const res = await H.handleStatus(get("/api/find/status?id=" + encodeURIComponent(id)).ctx, n.deps);
    assert.equal(res.status, 400, id);
  }
  const res = await H.handleStatus(get("/api/find/status?id=" + JOB, { headers: { "sec-fetch-site": "cross-site" } }).ctx, n.deps);
  assert.equal(res.status, 403);
  assert.equal(upCalls(n).length, 0);
  // 沒帶 Sec-Fetch-Site（部分內建瀏覽器）放行；same-origin／none 放行
  for (const h of [{}, { "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }]) {
    const r = await H.handleStatus(get("/api/find/status?id=" + JOB, { headers: h }).ctx, n.deps);
    assert.equal(r.status, 200);
  }
});

test("contact：有同意才收；轉送家用機；沒有工作編號就直送 TG", async () => {
  const body = { v: 1, jid: JOB, contact: { line: "wang_1234", pref: "line" }, consent: { contact: true, v: "2026-10-06" }, hp: "", turnstile: "tok" };
  let n = net();
  let j = await jsonOf(await H.handleContact(post("/api/find/contact", body).ctx, n.deps));
  assert.deepEqual(j, { ok: true, v: 1, saved: true });
  assert.equal(upCalls(n)[0].url, UP + "/aif/v1/contact");
  assert.equal(tgCalls(n).length, 0);
  n = net();
  j = await jsonOf(await H.handleContact(post("/api/find/contact", { ...body, jid: null }).ctx, n.deps));
  assert.deepEqual(j, { ok: true, v: 1, saved: true });
  assert.equal(upCalls(n).length, 0);
  assert.equal(tgCalls(n).length, 1);
  assert.match(JSON.parse(tgCalls(n)[0].init.body).text, /wang_1234/);
});

test("contact：沒勾同意→400 E_CONSENT；家用機不通→改走 TG；TG 也不通→saved:false", async () => {
  const body = { v: 1, jid: JOB, contact: { line: "wang_1234" }, hp: "", turnstile: "tok" };
  let res = await H.handleContact(post("/api/find/contact", body).ctx, net().deps);
  assert.equal(res.status, 400);
  assert.equal((await jsonOf(res)).code, "E_CONSENT");
  const withConsent = { ...body, consent: { contact: true, v: "2026-10-06" } };
  let n = net({ contact: () => { throw new Error("down"); } });
  let j = await jsonOf(await H.handleContact(post("/api/find/contact", withConsent).ctx, n.deps));
  assert.equal(j.saved, true);
  assert.equal(tgCalls(n).length, 1);
  n = net({ contact: () => { throw new Error("down"); }, tg: () => new Response("x", { status: 500 }) });
  j = await jsonOf(await H.handleContact(post("/api/find/contact", withConsent).ctx, n.deps));
  assert.equal(j.saved, false);
});

test("event：驗證後在背景轉送、永遠回 {ok:true}；只留白名單鍵", async () => {
  const n = net();
  const et = await H.makeEvtToken(ENV, 1790000000000);
  const batch = { v: 1, sid: "Qw3kT9xLm2PzR8aVb5NcDe", jid: null, rid: null, et, events: [{ e: "view", t: 0, src: "line", dev: "m", phone: "0912345678", name: "王小明" }, { e: "hack" }] };
  const { ctx, pending } = post("/api/find/event", batch);
  const res = await H.handleEvent(ctx, n.deps);
  assert.deepEqual(await jsonOf(res), { ok: true });
  await Promise.all(pending);
  const sent = JSON.parse(new TextDecoder().decode(upCalls(n)[0].init.body));
  assert.deepEqual(sent.events, [{ e: "view", t: 0, src: "line", dev: "m" }]);
  assert.ok(!JSON.stringify(sent).includes("0912"));
  // 家用機掛了也不影響客人
  const n2 = net({ event: () => { throw new Error("down"); } });
  const r2 = post("/api/find/event", batch);
  assert.deepEqual(await jsonOf(await H.handleEvent(r2.ctx, n2.deps)), { ok: true });
  await Promise.all(r2.pending);
  // 格式錯→400；過大→413
  assert.equal((await H.handleEvent(post("/api/find/event", { v: 2, sid: "x", events: [] }).ctx, n.deps)).status, 400);
  assert.equal((await H.handleEvent(post("/api/find/event", "x".repeat(9000)).ctx, n.deps)).status, 413);
});

test("feedback：驗證、轉送；一句話先去個資；家用機不通→E_FORWARD（200）", async () => {
  const n = net();
  const body = { v: 1, jid: JOB, rating: -1, tags: ["too_few", "bogus"], text: "請打 0912345678 給我，太少了", fatigue: "ok" };
  const res = await H.handleFeedback(post("/api/find/feedback", body).ctx, n.deps);
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1 });
  const sent = JSON.parse(new TextDecoder().decode(upCalls(n)[0].init.body));
  assert.deepEqual(sent.tags, []);
  assert.ok(!sent.text.includes("0912"));
  const n2 = net({ feedback: () => new Response("", { status: 503 }) });
  const j2 = await jsonOf(await H.handleFeedback(post("/api/find/feedback", { ...body, tags: ["too_few"] }).ctx, n2.deps));
  assert.equal(j2.code, "E_FORWARD");
  assert.equal((await H.handleFeedback(post("/api/find/feedback", { v: 1, jid: "bad" }).ctx, n.deps)).status, 400);
});

test("config：公開接口只吐「長得像 Site Key」的值；貼錯成 Secret Key（35 字元）／網址／空白一律回 null，不外流", async () => {
  const REAL_LIKE = "0x4AAAAAAAxxxxxxxxxxxxxx";                       // 24 字元，Site Key 的樣子（假值）
  const SECRET_LIKE = "0x4AAAAAAAyyyyyyyyyyyyyy-zzzzzzzzzzzzzz";    // 35+ 字元、含 -，Secret Key 的樣子（假值）
  assert.equal(H.publicSiteKey(REAL_LIKE), REAL_LIKE);
  assert.equal(H.publicSiteKey("  " + REAL_LIKE + " "), REAL_LIKE, "前後空白會修掉");
  assert.equal(H.publicSiteKey("1x00000000000000000000AA"), "1x00000000000000000000AA", "Cloudflare 官方測試用 key 格式");
  for (const bad of [SECRET_LIKE, "https://dash.cloudflare.com/xxxxxxxx", "", "   ", null, undefined, 123, "0x", "0xshort"]) {
    assert.equal(H.publicSiteKey(bad), null, String(bad));
  }
  H.resetConfigCache();
  const n = net();
  const ctx = get("/api/find/config").ctx;
  const raw = await H.handleConfig({ ...ctx, env: { ...ctx.env, TURNSTILE_SITE_KEY: SECRET_LIKE } }, n.deps);
  const txt = await raw.text();
  assert.ok(!txt.includes(SECRET_LIKE), "回應本文不得含貼錯的機密值");
  assert.equal(JSON.parse(txt).turnstileSiteKey, null);
});

test("config：回 site key；家用機健康→live；15 秒內快取；沒開總開關→intake", async () => {
  H.resetConfigCache();
  const n = net();
  let j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, n.deps));
  const { evt, ...rest } = j;
  assert.deepEqual(rest, { ok: true, v: 1, mode: "live", turnstileSiteKey: "0xTESTSITEKEY", needMax: 300, consentV: "2026-10-06", tplV: 1, caps: [] });
  assert.match(evt, /^[0-9a-z]+\.[0-9a-f]{20}$/, "config 會發事件憑證（紅隊 RT-12）");
  await H.handleConfig(get("/api/find/config").ctx, n.deps);
  assert.equal(upCalls(n).filter(c => c.url.includes("/health")).length, 1, "15 秒內只查一次");
  H.resetConfigCache();
  const n2 = net({ health: () => { throw new Error("down"); } });
  j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, n2.deps));
  assert.equal(j.mode, "intake");
  H.resetConfigCache();
  j = await jsonOf(await H.handleConfig(get("/api/find/config", { env: { ...ENV, FIND_ENABLED: undefined, TURNSTILE_SITE_KEY: undefined } }).ctx, net().deps));
  assert.equal(j.mode, "intake");
  assert.equal(j.turnstileSiteKey, null);
});

/* ---------- ② 錯誤碼與固定訊息 ---------- */
test("錯誤碼表：每個碼的 HTTP 狀態與固定訊息（4.8）", async () => {
  const table = {
    E_BAD_REQUEST: [400, "資料格式不正確，請重新整理頁面後再試一次。"],
    E_CONSENT: [400, "留聯絡方式需要先勾選同意。"],
    E_ORIGIN: [403, "請從網站頁面使用。"],
    E_HUMAN: [403, "沒能完成人機驗證，請按下面的「再試一次」。"],
    E_TOO_LARGE: [413, "內容太長了，請縮短一點再送出。"],
    E_RATE: [429, "操作太頻繁，請稍等一下再試。"],
    E_NOT_FOUND: [404, "找不到這筆需求，可能已經過期了。"],
    E_FORWARD: [200, "暫時送不出去，請稍後再試一次。"],
  };
  for (const [code, [http, msg]] of Object.entries(table)) {
    const res = H.errRes(code);
    assert.equal(res.status, http, code);
    const j = await jsonOf(res);
    assert.equal(j.msg, msg, code);
    assert.equal(j.code, code);
    assert.equal(j.ok, false);
  }
  const m = H.errRes("E_METHOD");
  assert.equal(m.status, 405);
  assert.equal(await m.text(), "");
  for (const k of ["次數", "用完", "超過上限"]) {
    for (const v of [...Object.values(E.ERR), ...Object.values(E.DEGRADE_MSG), ...Object.values(E.STATUS_MSG)]) assert.ok(!(v.msg ?? v).includes(k));
  }
});

test("提交的錯誤路徑：過大 413、壞 JSON 400、格式錯 400、沒同意 400", async () => {
  const n = net();
  assert.equal((await H.handleSubmit(post("/api/find/submit", "x".repeat(13000)).ctx, n.deps)).status, 413);
  assert.equal((await H.handleSubmit(post("/api/find/submit", "{not json").ctx, n.deps)).status, 400);
  assert.equal((await H.handleSubmit(post("/api/find/submit", { v: 2 }).ctx, n.deps)).status, 400);
  const res = await H.handleSubmit(post("/api/find/submit", goodSubmit({ contact: { line: "wang_1234" } })).ctx, n.deps);
  assert.equal(res.status, 400);
  assert.equal((await jsonOf(res)).code, "E_CONSENT");
  assert.equal(upCalls(n).length, 0);
  assert.equal(n.calls.length, 0, "驗證失敗前不該有任何對外呼叫（含人機驗證）");
});

test("方法不對→405 空本文", async () => {
  const n = net();
  for (const h of [H.handleSubmit, H.handleContact, H.handleEvent, H.handleFeedback]) {
    const res = await h({ request: new Request("https://teddy-house.tw/x", { method: "GET" }), env: ENV }, n.deps);
    assert.equal(res.status, 405);
    assert.equal(await res.text(), "");
  }
  for (const h of [H.handleStatus, H.handleConfig]) {
    const res = await h({ request: new Request("https://teddy-house.tw/x", { method: "POST", body: "{}" }), env: ENV }, n.deps);
    assert.equal(res.status, 405);
  }
});

/* ---------- ③ 上游異常 ---------- */
test("上游逾時／5xx／非 JSON／毒標記：submit 降級收件（直送 TG），回應不含毒標記", async () => {
  const cases = {
    timeout: () => { const e = new Error("t"); e.name = "AbortError"; throw e; },
    "5xx": () => new Response(POISON, { status: 502, headers: { "x-poison": POISON } }),
    "非 JSON": () => new Response(`<html>${POISON}</html>`, { status: 200, headers: { "content-type": "text/html", server: POISON } }),
    "怪形狀": () => Response.json({ ok: true, status: "weird", msg: POISON }),
    "網路錯誤": () => { throw new TypeError(POISON); },
  };
  for (const [name, fn] of Object.entries(cases)) {
    const n = net({ submit: fn });
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps);
    const text = await res.clone().text();
    assertNoPoison(res, text);
    assert.equal(res.status, 200, name);
    const j = JSON.parse(text);
    assert.equal(j.status, "degraded", name);
    assert.equal(j.jobId, null);
    assert.equal(j.saved, true);
    assert.equal(j.msg, "需求記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來這頁看看。");
    assert.equal(tgCalls(n).length, 1, name);
  }
});

test("降級收件的 TG 也失敗→saved:false 與固定訊息（最壞情況）", async () => {
  const n = net({ submit: () => { throw new Error("x"); }, tg: () => { throw new Error("y"); } });
  const j = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps));
  assert.equal(j.saved, false);
  assert.equal(j.msg, "目前沒能把你的需求送出去，你可以複製下面的內容，直接傳給景泰。");
  const n2 = net({ submit: () => { throw new Error("x"); } });
  const env2 = { ...ENV, CONTACT_TG_TOKEN: undefined, CONTACT_TG_CHAT: undefined };
  const j2 = await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit(), { env: env2 }).ctx, n2.deps));
  assert.equal(j2.saved, false);
});

test("status：上游異常→status:unknown（客人端自己退避），不回 5xx", async () => {
  for (const fn of [() => { throw new Error("x"); }, () => new Response(POISON, { status: 500 }), () => new Response(POISON), () => Response.json({ weird: POISON })]) {
    const res = await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, net({ status: fn }).deps);
    const text = await res.clone().text();
    assertNoPoison(res, text);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(text).status, "unknown");
  }
});

test("Function 永不回 5xx", async () => {
  const boom = () => { throw new Error(POISON); };
  const n = net({ submit: boom, status: boom, contact: boom, event: boom, feedback: boom, health: boom, tg: boom, turnstile: boom });
  H.resetConfigCache();
  const rs = [
    await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps),
    await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, n.deps),
    await H.handleContact(post("/api/find/contact", { v: 1, jid: JOB, contact: { line: "wang_1234" }, consent: { contact: true, v: "2026-10-06" } }).ctx, n.deps),
    await H.handleFeedback(post("/api/find/feedback", { v: 1, jid: JOB, rating: 1 }).ctx, n.deps),
    await H.handleConfig(get("/api/find/config").ctx, n.deps),
  ];
  for (const r of rs) assert.ok(r.status < 500);
});

/* ---------- ④ Origin ---------- */
test("Origin 缺失或不合→403 E_ORIGIN，且不做任何對外呼叫；本機測試位址放行", async () => {
  const n = net();
  for (const headers of [{}, { origin: "https://evil.example" }, { origin: "https://teddy-house.tw.evil.example" }, { origin: "https://teddy-website-blog.pages.dev" }, { origin: "null" }]) {
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { headers }).ctx, n.deps);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal((await jsonOf(res)).code, "E_ORIGIN");
  }
  assert.equal(n.calls.length, 0);
  for (const o of ["https://teddy-house.tw", "https://www.teddy-house.tw"]) {
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { headers: { origin: o } }).ctx, net().deps);
    assert.equal(res.status, 200, o);
  }
  // 本機測試位址：請求本身打在本機、Origin 也是本機才放行（紅隊 RT-05／RT-20：正式網域不再收 http://localhost 的 Origin）
  for (const base of ["http://localhost:8788", "http://127.0.0.1:8788"]) {
    const request = new Request(base + "/api/find/submit", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(goodSubmit()) });
    const res = await H.handleSubmit({ request, env: ENV, waitUntil() {} }, net().deps);
    assert.equal(res.status, 200, base);
  }
  const cross = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { headers: { origin: "http://localhost:8788" } }).ctx, n.deps);
  assert.equal(cross.status, 403, "打在正式網域的請求不收 localhost 的 Origin");
  // 沒有 Origin 但 Referer 是自家 → 放行
  const r = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { headers: { referer: "https://teddy-house.tw/find/" } }).ctx, net().deps);
  assert.equal(r.status, 200);
});

/* ---------- ⑤ 人機驗證 ---------- */
test("Turnstile：驗證沒過→403 E_HUMAN；沒帶 token→403；都不轉送上游", async () => {
  let n = net({ turnstile: () => Response.json({ success: false, "error-codes": [POISON] }) });
  let res = await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps);
  assert.equal(res.status, 403);
  const text = await res.text();
  assert.ok(!text.includes(POISON));
  assert.equal(JSON.parse(text).code, "E_HUMAN");
  assert.equal(upCalls(n).length, 0);
  n = net();
  res = await H.handleSubmit(post("/api/find/submit", goodSubmit({ turnstile: "" })).ctx, n.deps);
  assert.equal(res.status, 403);
  assert.equal(n.calls.length, 0);
});

test("Turnstile 查驗服務連不上／沒設金鑰→fail-closed：不轉送上游、不推 TG，客人看到「複製下面的內容傳給景泰」", async () => {
  for (const [name, n, env] of [
    ["連不上", net({ turnstile: () => { throw new Error("down"); } }), ENV],
    ["回壞東西", net({ turnstile: () => new Response("x", { status: 503 }) }), ENV],
    ["沒設金鑰", net(), { ...ENV, TURNSTILE_SECRET_KEY: undefined }],
  ]) {
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { env }).ctx, n.deps);
    const j = await jsonOf(res);
    assert.equal(j.status, "degraded", name);
    assert.equal(j.saved, false, name);
    assert.equal(j.msg, "目前沒能把你的需求送出去，你可以複製下面的內容，直接傳給景泰。");
    assert.equal(upCalls(n).length, 0, name);
    assert.equal(tgCalls(n).length, 0, `${name}：驗不了就不能推 TG（否則任何人都能洗版）`);
  }
});

test("總開關沒開（收件模式）：不轉送、不查人機以外的任何上游，只收件", async () => {
  const n = net();
  const res = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { env: { ...ENV, FIND_ENABLED: "0" } }).ctx, n.deps);
  assert.equal((await jsonOf(res)).status, "degraded");
  assert.equal(upCalls(n).length, 0);
  assert.equal(tgCalls(n).length, 1);
  const r2 = await H.handleSubmit(post("/api/find/submit", goodSubmit(), { env: { ...ENV, FIND_ENABLED: undefined } }).ctx, net().deps);
  assert.equal((await jsonOf(r2)).status, "degraded");
});

/* ---------- ⑥ 機器人 ---------- */
test("honeypot 有填、或快到不可能是人（<0.3 秒）→假成功，不轉送、不推 TG、不查人機", async () => {
  for (const over of [{ hp: "http://spam" }, { fill_ms: 100 }, { fill_ms: 0 }]) {
    const n = net();
    const res = await H.handleSubmit(post("/api/find/submit", goodSubmit(over)).ctx, n.deps);
    const j = await jsonOf(res);
    assert.equal(res.status, 200);
    assert.equal(j.status, "queued");
    assert.match(j.jobId, /^a[A-Za-z0-9_-]{22}$/);
    assert.equal(n.calls.length, 0);
  }
  // 熟手 0.8 秒、2.5 秒、沒量到（null）都是正常的：只要人機驗證通過就照常處理（真人不能消失）
  for (const fm of [800, 2500, null]) {
    const n = net();
    assert.equal((await jsonOf(await H.handleSubmit(post("/api/find/submit", goodSubmit({ fill_ms: fm })).ctx, n.deps))).jobId, JOB, String(fm));
  }
});

/* ---------- ⑦ TG 降級內容 ---------- */
test("降級收件的 TG 訊息：只含條件、客人同意的聯絡方式；原話去個資；HTML 跳脫", async () => {
  const n = net({ submit: () => { throw new Error("x"); } });
  const body = goodSubmit({
    free_text: "我姓王 電話0912-345-678 想找<b>北屯</b>三房",
    contact: { line: "wang_1234", name: "小王" }, consent: { contact: true, v: "2026-10-06" },
    context: { stage: "first", timeline: "6m", special: ["school"], concerns: ["loan", "no_chase"] },
  });
  await H.handleSubmit(post("/api/find/submit", body).ctx, n.deps);
  const sent = JSON.parse(tgCalls(n)[0].init.body);
  assert.equal(sent.disable_notification, false);
  assert.equal(sent.parse_mode, "HTML");
  assert.match(sent.text, /北屯區｜3 房｜2000 萬以內｜平面車位｜不含頂樓/);
  assert.ok(sent.text.includes("LINE <code>wang_1234</code>"), "客人留的 LINE ID 放在 <code> 內（不會變成可點連結）");
  assert.match(sent.text, /注意：客人明確不想被追問/);
  assert.ok(!sent.text.includes("0912"), "原話裡的電話要被清掉");
  assert.ok(!sent.text.includes("<b>"), "HTML 要跳脫");
  // 沒同意就不放聯絡方式
  const n2 = net({ submit: () => { throw new Error("x"); } });
  await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n2.deps);
  assert.match(JSON.parse(tgCalls(n2)[0].init.body).text, /未留聯絡方式/);
});

/* ---------- ⑧ 回應鍵白名單、固定標頭、無 CORS ---------- */
test("所有回應：鍵在白名單內、固定標頭、沒有 CORS 標頭", async () => {
  H.resetConfigCache();
  const n = net();
  const rs = [
    await H.handleSubmit(post("/api/find/submit", goodSubmit()).ctx, n.deps),
    await H.handleSubmit(post("/api/find/submit", { v: 2 }).ctx, n.deps),
    await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, n.deps),
    await H.handleConfig(get("/api/find/config").ctx, n.deps),
    await H.handleEvent(post("/api/find/event", { v: 1, sid: "Qw3kT9xLm2PzR8aVb5NcDe", events: [] }).ctx, n.deps),
    H.errRes("E_RATE"),
  ];
  const allowed = new Set(H.RESPONSE_KEYS);
  for (const r of rs) {
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("referrer-policy"), "same-origin");
    for (const [k] of r.headers) assert.ok(!k.startsWith("access-control-"), k);
    for (const k of Object.keys(await r.json())) assert.ok(allowed.has(k), `鍵 ${k} 不在白名單`);
  }
  // 就算程式不小心多塞鍵，輸出時也會被濾掉
  const sneaky = H.jsonRes({ ok: true, finder: POISON, reason: POISON });
  assert.deepEqual(await sneaky.json(), { ok: true });
});

/* ---------- ⑩ 簽章字串與測試向量 ---------- */
test("簽章：與兩側共用的 sign_vectors.json 完全相同", async () => {
  const sv = readFixture("sign_vectors.json");
  assert.equal(await C.keyId(sv.secret), sv.kid);
  for (const v of sv.vectors) {
    const body = v.body === "" ? null : new TextEncoder().encode(v.body);
    const r = await C.signRequest({ secret: sv.secret, method: v.method, pathQs: v.path, body, ts: v.ts, nonce: v.nonce });
    assert.equal(await C.sha256Hex(body ?? new Uint8Array(0)), v.body_sha256, v.id);
    assert.equal(r.sig, v.sig, v.id);
    assert.equal(r.headers["X-Aif-Kid"], sv.kid);
    assert.equal(r.canon.split("\n").length, 6);
    assert.ok(!r.canon.endsWith("\n"));
  }
});

/* ---------- ⑪ 不記錄本文 ---------- */
test("日誌：失敗只記泛化代碼，不含本文、聯絡方式、上游回應、網址、金鑰", async () => {
  const logs = [];
  const orig = console.warn;
  console.warn = (...a) => logs.push(a.join(" "));
  try {
    const n = net({ submit: () => new Response(POISON, { status: 502 }), tg: () => new Response(POISON, { status: 500 }) });
    await H.handleSubmit(post("/api/find/submit", goodSubmit({ contact: { line: "wang_1234" }, consent: { contact: true, v: "2026-10-06" }, free_text: "我的秘密需求" })).ctx, n.deps);
    await H.handleStatus(get("/api/find/status?id=" + JOB).ctx, net({ status: () => new Response("", { status: 500 }) }).deps);
  } finally {
    console.warn = orig;
  }
  assert.ok(logs.length > 0);
  for (const l of logs) {
    assert.match(l, /^find:[a-z]+_fail:[a-z0-9_]+$/);
    for (const bad of ["wang_1234", "秘密", POISON, "home.invalid", "test-secret", "tg-token", "ts-secret"]) assert.ok(!l.includes(bad), l);
  }
});

/* ---------- 2026-10-09 範圍找法：config 的 caps、submit 轉送三個新欄位、status 放行新提示碼 ---------- */
test("config：caps＝家用機 health 回報支援的範圍找法（白名單過濾、去重、固定順序）；收件模式空陣列；health 失敗沿用上一次", async () => {
  H.resetConfigCache();
  let n = net({ health: () => Response.json({ ok: true, v: 1, mode: "live", queue: {}, caps: ["geo", "evil", "community", "geo", 3, "zone"] }) });
  let j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, n.deps));
  assert.deepEqual(j.caps, ["community", "zone", "geo"]);
  // 15 秒內快取（caps 一起）；之後 health 掛了 → 沿用上一次的 mode 與 caps，不閃成收件、入口也不會消失
  j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, n.deps));
  assert.deepEqual(j.caps, ["community", "zone", "geo"]);
  const later = { fetch: net({ health: () => { throw new Error("down"); } }).fetchImpl, now: () => 1790000000000 + 20000 };
  j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, later));
  assert.equal(j.mode, "live");
  assert.deepEqual(j.caps, ["community", "zone", "geo"]);
  // 家用機說收件模式：不開任何範圍入口
  H.resetConfigCache();
  n = net({ health: () => Response.json({ ok: true, v: 1, mode: "intake", caps: ["community"] }) });
  j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, n.deps));
  assert.deepEqual([j.mode, j.caps], ["intake", []]);
  // 舊家用機（沒有 caps）、caps 不是陣列、官網沒開總開關 → 空陣列
  for (const caps of [undefined, "community", { community: 1 }, null]) {
    H.resetConfigCache();
    j = await jsonOf(await H.handleConfig(get("/api/find/config").ctx, net({ health: () => Response.json({ ok: true, v: 1, mode: "live", caps }) }).deps));
    assert.deepEqual(j.caps, [], String(caps));
  }
  H.resetConfigCache();
  j = await jsonOf(await H.handleConfig(get("/api/find/config", { env: { ...ENV, FIND_ENABLED: undefined } }).ctx, net().deps));
  assert.deepEqual([j.mode, j.caps], ["intake", []]);
  H.resetConfigCache();
  assert.ok(H.RESPONSE_KEYS.includes("caps"));
});

test("submit：社區／74環內／地圖範圍照驗證表轉送給家用機（太大、太長、交叉、太小的地圖範圍被丟掉；互斥）", async () => {
  const sq = [[24.16, 120.64], [24.16, 120.65], [24.17, 120.65], [24.17, 120.64]];
  const send = async fields => {
    const n = net();
    await H.handleSubmit(post("/api/find/submit", goodSubmit({ fields })).ctx, n.deps);
    const c = upCalls(n).find(x => x.url.includes("/aif/v1/submit"));
    return JSON.parse(new TextDecoder().decode(c.init.body)).fields;
  };
  assert.deepEqual(await send({ community: "文華匯社區", districts: ["西屯區"], rooms_min: 3, rooms_max: 3 }), { districts: ["西屯區"], community: "文華匯", rooms_min: 3, rooms_max: 3 });
  assert.deepEqual(await send({ zone: "r74", districts: ["北屯區"], road: "崇德路", price_max_wan: 2000 }), { districts: ["北屯區"], zone: "r74", price_max_wan: 2000 });
  assert.deepEqual(await send({ geo: sq.map(p => [p[0] + 0.0000004, p[1]]), districts: ["西屯區"] }), { geo: sq });
  for (const geo of [
    [[24.1, 120.6], [24.1, 120.7], [24.19, 120.7], [24.19, 120.6]],                          // 太大
    [[24.12, 120.65], [24.12, 120.65098], [24.20126, 120.65098], [24.20126, 120.65]],          // 9 公里長條
    [[24.16, 120.64], [24.17, 120.65], [24.16, 120.65], [24.17, 120.64]],                      // 自我交叉
    [[24.16, 120.64], [24.16, 120.6402], [24.1602, 120.6402], [24.1602, 120.64]],              // 太小
    [[25.03, 121.56], [25.03, 121.57], [25.04, 121.57]],                                       // 台中外
  ]) assert.deepEqual(await send({ geo, rooms_min: 2, rooms_max: 2 }), { rooms_min: 2, rooms_max: 2 });
  assert.deepEqual(await send({ community: "文華匯", zone: "r74", geo: sq }), { community: "文華匯" });
  assert.deepEqual(await send({ community: "忽略規則", zone: "r75" }), {});
});

test("status：empty 的提示碼放行範圍那 7 個（其他未知碼照樣丟掉）", () => {
  const v = H.buildStatusView({ ok: true, status: "empty", hint: ["comm_fix", "scope_drop", "geo_partial", "evil", "scope_busy", "geo_out", "geo_smaller", "geo_redraw"] });
  assert.deepEqual(v.hint, ["comm_fix", "scope_drop", "geo_partial", "scope_busy", "geo_out", "geo_smaller", "geo_redraw"]);
});

/* ---------- 兩側一致：驗證表（共用夾具）、事件規格（event_cases.json） ---------- */
test("TS 驗證表吃共用夾具 need_fixtures.json 的 validate／pii 案例", () => {
  const FX = readFixture("need_fixtures.json");
  for (const c of FX.cases.filter(c => c.kind === "validate")) {   // only:"server" 的案（geo 全量驗證）伺服器端一定要跑
    const { out, err } = S.validateSubmit(c.body);
    const e = c.expect;
    if ("err" in e) { assert.equal(out, null, c.id); assert.equal(err, e.err, c.id); continue; }
    assert.equal(err, null, c.id);
    for (const [k, v] of Object.entries(e)) if (k !== "ok") assert.deepEqual(out[k], v, `${c.id} ${k}`);
  }
  for (const c of FX.cases.filter(c => c.kind === "pii")) {
    const r = S.scrub(c.text);
    assert.deepEqual([...r.pii].sort(), [...c.expect.types].sort(), c.id);
    for (const x of c.expect.absent) assert.ok(!r.clean.includes(x), c.id);
    for (const x of c.expect.present) assert.ok(r.clean.includes(x), c.id);
  }
});

test("TS 事件規格吃共用夾具 event_cases.json（客人端事件與批次逐案相符）", () => {
  const EV = readFixture("event_cases.json");
  for (const c of EV.cases) {
    if (c.kind === "event") {
      if (c.server) continue; // 伺服器端事件由家用機自記，官網 Function 不收
      const got = S.validateEvent(c.input);
      assert.deepEqual(got, c.expect, c.id);
    } else {
      const { env, dropped } = S.validateEventBatch(c.input);
      const e = c.expect;
      if (!e.ok) { assert.equal(env, null, c.id); continue; }
      assert.ok(env, c.id);
      assert.equal(env.events.length, e.n, c.id);
      assert.equal(dropped, e.dropped, c.id);
      if ("jid" in e) assert.equal(env.jid, e.jid, c.id);
      if ("rid" in e) assert.equal(env.rid, e.rid, c.id);
    }
  }
});

test("事件去識別化：任何字串值都必須是列舉或 ^[A-Za-z0-9_.:\\-]{1,40}$", () => {
  const tok = /^[A-Za-z0-9_.:-]{1,40}$/;
  const EV = readFixture("event_cases.json");
  for (const c of EV.cases.filter(c => c.kind === "event" && !c.server)) {
    const got = S.validateEvent(c.input);
    if (!got) continue;
    const walk = x => { if (typeof x === "string") assert.match(x, tok); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); };
    walk(got);
  }
});
