// 小遊戲排行榜端點（/api/find/score、/api/find/top；src/lib/find/handlers.ts＋score.ts）合約測試：全部離線，fetch 用假的。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, bundleTs } from "./_helpers.mjs";

const H = (await bundleTs("src/lib/find/handlers.ts")).mod;
const SC = (await bundleTs("src/lib/find/score.ts")).mod;
const C = (await bundleTs("src/lib/find/canon.ts")).mod;

const POISON = "ZZPOISON_B2";
const UP = "https://home.invalid:8443";
const ENV = {
  FIND_ENABLED: "1",
  FIND_UPSTREAM_URL: UP,
  FIND_HMAC_SECRET: "test-secret-do-not-use",
  FIND_IP_SALT: "test-salt",
  TURNSTILE_SECRET_KEY: "ts-secret",
  CONTACT_TG_TOKEN: "tg-token",
  CONTACT_TG_CHAT: "99",
};
const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const ORIGIN = { origin: "https://teddy-house.tw" };
const NOW = 1790000000000;
const TOP_OK = {
  ok: true, v: 1,
  week: [{ rank: 1, name: "小王！", floors: 30 }],
  all: [{ rank: 1, name: "小王！", floors: 30 }, { rank: 2, name: "訪客3F2A", floors: 12 }],
  me: null,
};

/** 假網路：只認家用機的兩條路由；記錄每一次呼叫。clock.t 可以手動往前撥。 */
function net(over = {}) {
  const calls = [];
  const clock = { t: NOW };
  const routes = {
    score: () => Response.json({ ok: true, v: 1, saved: true }),
    top: () => Response.json(TOP_OK),
    ...over,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(UP + "/aif/v1/score")) return routes.score(u, init);
    if (u.startsWith(UP + "/aif/v1/top")) return routes.top(u, init);
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { calls, clock, deps: { fetch: fetchImpl, now: () => clock.t } };
}
const upCalls = n => n.calls.filter(c => c.url.startsWith(UP));

function post(pathname, body, { headers = ORIGIN, env = ENV, base = "https://teddy-house.tw", ip = "203.0.113.9" } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const h = { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...headers };
  if (ip) h["cf-connecting-ip"] = ip;
  return { request: new Request(base + pathname, { method: "POST", headers: h, body: raw }), env, waitUntil() {} };
}
function get(pathname, { headers = {}, env = ENV, base = "https://teddy-house.tw", ip = "203.0.113.9" } = {}) {
  const h = { ...headers };
  if (ip) h["cf-connecting-ip"] = ip;
  return { request: new Request(base + pathname, { method: "GET", headers: h }), env };
}
const good = (over = {}) => ({ jobId: JOB, floors: 23, ms: 41000, perfect: 4, name: "小王", ...over });
async function jsonOf(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}
function assertNoPoison(res, text) {
  assert.ok(!text.includes(POISON), "回應本文含毒標記");
  for (const [k, v] of res.headers) assert.ok(!(k + v).includes(POISON), `標頭含毒標記 ${k}`);
}

/* ---------- score ---------- */
test("score：正常送出→簽章轉送白名單欄位（不含 IP）→回 {ok,v,saved:true}", async () => {
  H.resetScoreState();
  const n = net();
  const res = await H.handleScore(post("/api/find/score", good({ name: "  ＡＢ小王​超長的暱稱一二三四五六七八九十 ", extra: POISON })), n.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: true });
  const up = upCalls(n);
  assert.equal(up.length, 1);
  assert.equal(up[0].url, UP + "/aif/v1/score");
  assert.equal(up[0].init.method, "POST");
  const h = up[0].init.headers;
  const bodyBytes = up[0].init.body;
  const sig = await C.hmacHex(ENV.FIND_HMAC_SECRET, C.canonString("POST", "/aif/v1/score", h["X-Aif-Ts"], h["X-Aif-Nonce"], await C.sha256Hex(bodyBytes)));
  assert.equal(h["X-Aif-Sig"], sig);
  assert.equal(h["content-type"], "application/json");
  const sent = JSON.parse(new TextDecoder().decode(bodyBytes));
  assert.deepEqual(Object.keys(sent).sort(), ["floors", "jid", "ms", "name", "perfect", "v"]);
  assert.deepEqual({ ...sent, name: undefined }, { v: 1, jid: JOB, floors: 23, ms: 41000, perfect: 4, name: undefined });
  assert.equal(sent.name, "AB小王超長的暱稱一二三四五六七", "NFKC、去隱形字元、去頭尾空白、最多 16 字（最後 8 字與過濾在家用機）");
  assert.equal(Array.from(sent.name).length, 16);
  assert.ok(!new TextDecoder().decode(bodyBytes).includes("203.0.113"));
});

test("score：格式不對→400、過大→413、壞 JSON→400；可選欄位不合法只丟那個；都不轉送", async () => {
  H.resetScoreState();
  const n = net();
  for (const b of [
    good({ jobId: "bad" }), good({ jobId: JOB + "x" }), good({ jobId: undefined }), good({ floors: 301 }), good({ floors: -1 }),
    good({ floors: 2.5 }), good({ floors: "3" }), good({ floors: true }), good({ ms: -1 }), good({ ms: 86400001 }), good({ ms: null }),
    good({ v: 2 }), [], null, "x",
  ]) {
    const res = await H.handleScore(post("/api/find/score", b), n.deps);
    assert.equal(res.status, 400, JSON.stringify(b));
    assert.equal((await jsonOf(res)).code, "E_BAD_REQUEST");
  }
  assert.equal((await H.handleScore(post("/api/find/score", "{nope"), n.deps)).status, 400);
  assert.equal((await H.handleScore(post("/api/find/score", good({ name: "x".repeat(2100) })), n.deps)).status, 413);
  assert.equal(upCalls(n).length, 0);
  const ok = await H.handleScore(post("/api/find/score", good({ perfect: "x", name: 5, v: 1 })), n.deps);
  assert.equal(ok.status, 200);
  const sent = JSON.parse(new TextDecoder().decode(upCalls(n)[0].init.body));
  assert.equal(sent.perfect, null);
  assert.equal(sent.name, "");
  const zero = SC.validateScore({ jobId: JOB, floors: 0, ms: 0 });
  assert.deepEqual(zero, { jid: JOB, floors: 0, ms: 0, perfect: null, name: "" }, "0 層、沒帶可選欄位也是合法格式（合理性在家用機）");
});

test("score：同源檢查（缺 Origin、別的網站、舊 pages.dev 主機）→403；方法不對→405；都不轉送", async () => {
  H.resetScoreState();
  const n = net();
  for (const headers of [{}, { origin: "https://evil.example" }, { origin: "null" }]) {
    const res = await H.handleScore(post("/api/find/score", good(), { headers }), n.deps);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal((await jsonOf(res)).code, "E_ORIGIN");
  }
  const old = await H.handleScore(post("/api/find/score", good(), { base: "https://teddy-website-blog.pages.dev" }), n.deps);
  assert.equal(old.status, 403);
  const m = await H.handleScore(get("/api/find/score"), n.deps);
  assert.equal(m.status, 405);
  assert.equal(await m.text(), "");
  assert.equal(n.calls.length, 0);
});

test("score：官網設定沒齊（收件模式）→ {ok:true, saved:false}，不轉送", async () => {
  for (const env of [{ ...ENV, FIND_ENABLED: "0" }, { ...ENV, FIND_IP_SALT: undefined }, { ...ENV, FIND_HMAC_SECRET: "short" }, { ...ENV, FIND_UPSTREAM_URL: "http://evil.example" }]) {
    H.resetScoreState();
    const n = net();
    const res = await H.handleScore(post("/api/find/score", good(), { env }), n.deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonOf(res), { ok: true, v: 1, saved: false });
    assert.equal(n.calls.length, 0);
  }
});

test("score：家用機連不上／5xx／401／怪回應→ {ok:true, saved:false}，不報錯、不含毒標記", async () => {
  const cases = {
    timeout: () => { const e = new Error("t"); e.name = "AbortError"; throw e; },
    network: () => { throw new TypeError(POISON); },
    "5xx": () => new Response(POISON, { status: 502, headers: { "x-poison": POISON } }),
    "401": () => new Response("", { status: 401 }),
    "404": () => new Response("", { status: 404 }),
    "非 JSON": () => new Response(`<html>${POISON}</html>`),
    "ok:false": () => Response.json({ ok: false, code: "bad_request", msg: POISON }),
    "怪形狀": () => Response.json({ weird: POISON }),
  };
  for (const [name, fn] of Object.entries(cases)) {
    H.resetScoreState();
    const res = await H.handleScore(post("/api/find/score", good()), net({ score: fn }).deps);
    const text = await res.clone().text();
    assertNoPoison(res, text);
    assert.equal(res.status, 200, name);
    assert.deepEqual(JSON.parse(text), { ok: true, v: 1, saved: false }, name);
  }
});

test("score：每 IP 每分鐘 30 次（記憶體視窗）→第 31 次 429 E_RATE；別的 IP 不受影響；過一分鐘恢復", async () => {
  H.resetScoreState();
  const n = net();
  for (let i = 0; i < H.SCORE_PER_IP_MIN; i++) {
    assert.equal((await H.handleScore(post("/api/find/score", good()), n.deps)).status, 200, String(i));
  }
  const over = await H.handleScore(post("/api/find/score", good()), n.deps);
  assert.equal(over.status, 429);
  assert.equal((await jsonOf(over)).code, "E_RATE");
  assert.equal(upCalls(n).length, H.SCORE_PER_IP_MIN, "超過上限的不轉送");
  assert.equal((await H.handleScore(post("/api/find/score", good(), { ip: "198.51.100.7" }), n.deps)).status, 200);
  n.clock.t += 60000;
  assert.equal((await H.handleScore(post("/api/find/score", good()), n.deps)).status, 200);
});

/* ---------- top ---------- */
test("top：轉送簽章 GET、回白名單格式；沒帶 id 時 me 一律 null；30 秒內走快取", async () => {
  H.resetScoreState();
  const n = net({ top: () => Response.json({ ...TOP_OK, me: { rank: 1, floors: 30, weekRank: 1 }, jobId: JOB, finder: POISON, ts: 1 }) });
  const res = await H.handleTop(get("/api/find/top"), n.deps);
  const text = await res.clone().text();
  assertNoPoison(res, text);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true, v: 1, week: TOP_OK.week, all: TOP_OK.all, me: null });
  assert.ok(!text.includes(JOB));
  assert.equal(upCalls(n)[0].url, UP + "/aif/v1/top");
  assert.equal(upCalls(n)[0].init.method, "GET");
  const h = upCalls(n)[0].init.headers;
  const sig = await C.hmacHex(ENV.FIND_HMAC_SECRET, C.canonString("GET", "/aif/v1/top", h["X-Aif-Ts"], h["X-Aif-Nonce"], await C.sha256Hex(new Uint8Array(0))));
  assert.equal(h["X-Aif-Sig"], sig);
  n.clock.t += 29000;
  assert.deepEqual(await jsonOf(await H.handleTop(get("/api/find/top"), n.deps)), { ok: true, v: 1, week: TOP_OK.week, all: TOP_OK.all, me: null });
  assert.equal(upCalls(n).length, 1, "30 秒內不再問家用機");
  n.clock.t += 2000;
  await H.handleTop(get("/api/find/top"), n.deps);
  assert.equal(upCalls(n).length, 2, "過了 30 秒重新問");
});

test("top：帶 ?id= 每次都問家用機（算自己的名次），回 me；id 格式不對→400", async () => {
  H.resetScoreState();
  const n = net({ top: () => Response.json({ ...TOP_OK, me: { rank: 57, floors: 9, weekRank: null } }) });
  await H.handleTop(get("/api/find/top"), n.deps);                                 // 先把快取填好
  const j = await jsonOf(await H.handleTop(get("/api/find/top?id=" + JOB), n.deps));
  assert.deepEqual(j.me, { rank: 57, floors: 9, weekRank: null });
  assert.equal(upCalls(n).length, 2);
  assert.equal(upCalls(n)[1].url, `${UP}/aif/v1/top?id=${JOB}`);
  for (const id of ["", "abc", JOB + "x", "b" + JOB.slice(1), "../../x", JOB.replace("X", "$")]) {
    const res = await H.handleTop(get("/api/find/top?id=" + encodeURIComponent(id)), n.deps);
    assert.equal(res.status, 400, id);
  }
  assert.equal(upCalls(n).length, 2);
});

test("top：家用機回來的內容逐欄重組——暱稱不合格變「訪客」、名次重新編、層數超出範圍丟掉、最多 10 筆、me 欄位檢查", async () => {
  H.resetScoreState();
  const rows = [
    { rank: 9, name: "小王！…", floors: 40, jobId: JOB, ts: 123 },
    { rank: 1, name: "www.evil.com", floors: 30 },
    { rank: 1, name: "a@b", floors: 29 },
    { rank: 1, name: "0912345678", floors: 28 },
    { rank: 1, name: "九個字的暱稱好長喔", floors: 27 },
    { rank: 1, name: "小​王", floors: 26 },
    { rank: 1, name: 12345, floors: 25 },
    { rank: 1, name: "<b>x</b>", floors: 24 },
    { rank: 1, name: "ok", floors: 999 },
    { rank: 1, name: "ok", floors: "5" },
    POISON,
    { rank: 1, name: "「阿明」", floors: 3 },
    ...Array.from({ length: 12 }, (_, i) => ({ rank: i, name: "多" + i, floors: 2 })),
  ];
  const n = net({ top: () => Response.json({ ok: true, v: 1, week: rows, all: rows.slice(0, 3), me: { rank: 0, floors: 3 } }) });
  const j = await jsonOf(await H.handleTop(get("/api/find/top?id=" + JOB), n.deps));
  assert.deepEqual(j.week.map(r => r.rank), j.week.map((_, i) => i + 1));
  assert.deepEqual(j.week.map(r => r.name), ["小王！…", "訪客", "訪客", "訪客", "訪客", "訪客", "訪客", "訪客"], "只看前 10 筆；壞層數的丟掉");
  for (const r of [...j.week, ...j.all]) assert.deepEqual(Object.keys(r).sort(), ["floors", "name", "rank"]);
  assert.equal(j.all.length, 3);
  assert.equal(j.me, null, "me 的名次不合法就不給");
  assert.ok(!JSON.stringify(j).includes(JOB));
  assert.equal(SC.safeName("「阿明」"), "「阿明」");
  assert.equal(SC.safeName("訪客3F2A"), "訪客3F2A");
  assert.equal(SC.safeName("Amy_Lin8"), "Amy_Lin8");
  assert.equal(SC.safeName("AmyLin_88"), "訪客", "9 個字超過上限");
  for (const bad of ["", " ", "a b", "x.tw", "t.me/x", "#tag", "a:b", "123456", "‮小王", "小王\n", null, undefined, {}]) {
    assert.equal(SC.safeName(bad), "訪客", String(bad));
  }
});

test("safeName（審查 SCORE-L1）：「·」「・」這類像點的字不再放行（abc·tw 組不出網址）", () => {
  for (const bad of ["abc·tw", "bit·ly", "t·me", "abc・com", "小王·阿明", "Amy・Lin", "a‧tw", "a•tw"]) {
    assert.equal(SC.safeName(bad), "訪客", bad);
  }
  assert.equal(SC.safeName("AmyLin"), "AmyLin");
  assert.equal(SC.safeName("小王—阿明"), "小王—阿明");
});

test("top：家用機連不上→空榜（有 30 秒內的快取就給快取，me 一律 null）；設定沒齊→空榜且不轉送；同源與方法", async () => {
  H.resetScoreState();
  const down = net({ top: () => { throw new Error(POISON); } });
  for (const p of ["/api/find/top", "/api/find/top?id=" + JOB]) {
    const res = await H.handleTop(get(p), down.deps);
    const text = await res.clone().text();
    assertNoPoison(res, text);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), { ok: true, v: 1, week: [], all: [], me: null }, p);
  }
  for (const fn of [() => new Response("", { status: 401 }), () => new Response(POISON, { status: 500 }), () => new Response(POISON), () => Response.json({ ok: false, code: "bad_request" }), () => Response.json({ ok: true, week: "x", all: [] })]) {
    H.resetScoreState();
    const res = await H.handleTop(get("/api/find/top?id=" + JOB), net({ top: fn }).deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonOf(res), { ok: true, v: 1, week: [], all: [], me: null });
  }
  // 先成功一次（填快取），接著家用機掛掉：30 秒內給快取
  H.resetScoreState();
  let up = true;
  const flaky = net({ top: () => { if (up) return Response.json(TOP_OK); throw new Error("down"); } });
  await H.handleTop(get("/api/find/top"), flaky.deps);
  up = false;
  flaky.clock.t += 5000;
  assert.deepEqual(await jsonOf(await H.handleTop(get("/api/find/top?id=" + JOB), flaky.deps)), { ok: true, v: 1, week: TOP_OK.week, all: TOP_OK.all, me: null });
  flaky.clock.t += 30000;
  assert.deepEqual(await jsonOf(await H.handleTop(get("/api/find/top?id=" + JOB), flaky.deps)), { ok: true, v: 1, week: [], all: [], me: null });
  // 設定沒齊
  H.resetScoreState();
  const n = net();
  assert.deepEqual(await jsonOf(await H.handleTop(get("/api/find/top", { env: { ...ENV, FIND_ENABLED: undefined } }), n.deps)), { ok: true, v: 1, week: [], all: [], me: null });
  assert.equal(n.calls.length, 0);
  // 同源、主機、方法
  assert.equal((await H.handleTop(get("/api/find/top", { headers: { "sec-fetch-site": "cross-site" } }), n.deps)).status, 403);
  assert.equal((await H.handleTop(get("/api/find/top", { base: "https://teddy-website-blog.pages.dev" }), n.deps)).status, 403);
  const m = await H.handleTop(post("/api/find/top", {}), n.deps);
  assert.equal(m.status, 405);
  for (const hd of [{}, { "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }]) {
    assert.equal((await H.handleTop(get("/api/find/top", { headers: hd }), n.deps)).status, 200);
  }
});

test("top：同一 IP 帶 id 太頻繁（每分鐘 60 次）→不再問家用機，給快取（me null），不報錯", async () => {
  H.resetScoreState();
  const n = net({ top: () => Response.json({ ...TOP_OK, me: { rank: 2, floors: 12, weekRank: 2 } }) });
  for (let i = 0; i < H.TOP_PER_IP_MIN; i++) await H.handleTop(get("/api/find/top?id=" + JOB), n.deps);
  assert.equal(upCalls(n).length, H.TOP_PER_IP_MIN);
  const res = await H.handleTop(get("/api/find/top?id=" + JOB), n.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await jsonOf(res), { ok: true, v: 1, week: TOP_OK.week, all: TOP_OK.all, me: null });
  assert.equal(upCalls(n).length, H.TOP_PER_IP_MIN);
});

test("score 成功後同一個 isolate 的排行快取作廢", async () => {
  H.resetScoreState();
  const n = net();
  await H.handleTop(get("/api/find/top"), n.deps);
  await H.handleTop(get("/api/find/top"), n.deps);
  assert.equal(upCalls(n).filter(c => c.url.includes("/top")).length, 1);
  await H.handleScore(post("/api/find/score", good()), n.deps);
  await H.handleTop(get("/api/find/top"), n.deps);
  assert.equal(upCalls(n).filter(c => c.url.includes("/top")).length, 2);
});

/* ---------- 共通：白名單、標頭、永不 5xx、日誌、薄包裝 ---------- */
test("排行榜回應：鍵在白名單內（week／all／me 已加入）、固定標頭、沒有 CORS；永不回 5xx", async () => {
  H.resetScoreState();
  for (const k of ["week", "all", "me", "saved"]) assert.ok(H.RESPONSE_KEYS.includes(k), k);
  const n = net();
  const boom = net({ score: () => { throw new Error(POISON); }, top: () => { throw new Error(POISON); } });
  const rs = [
    await H.handleScore(post("/api/find/score", good()), n.deps),
    await H.handleScore(post("/api/find/score", good({ jobId: "x" })), n.deps),
    await H.handleTop(get("/api/find/top?id=" + JOB), n.deps),
    await H.handleTop(get("/api/find/top"), n.deps),
    await H.handleScore(post("/api/find/score", good()), boom.deps),
    await H.handleTop(get("/api/find/top?id=" + JOB), boom.deps),
  ];
  const allowed = new Set(H.RESPONSE_KEYS);
  for (const r of rs) {
    assert.ok(r.status < 500);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    for (const [k] of r.headers) assert.ok(!k.startsWith("access-control-"), k);
    for (const k of Object.keys(await r.json())) assert.ok(allowed.has(k), `鍵 ${k} 不在白名單`);
  }
});

test("排行榜日誌：只記泛化代碼，不含暱稱、工作編號、上游回應、網址、金鑰", async () => {
  const logs = [];
  const orig = console.warn;
  console.warn = (...a) => logs.push(a.join(" "));
  try {
    H.resetScoreState();
    const n = net({ score: () => new Response(POISON, { status: 502 }), top: () => Response.json({ weird: POISON }) });
    await H.handleScore(post("/api/find/score", good({ name: "秘密暱稱" })), n.deps);
    await H.handleTop(get("/api/find/top?id=" + JOB), n.deps);
    await H.handleTop(get("/api/find/top"), net({ top: () => new Response("", { status: 401 }) }).deps);
  } finally {
    console.warn = orig;
  }
  assert.ok(logs.length >= 3);
  for (const l of logs) {
    assert.match(l, /^find:[a-z]+_fail:[a-z0-9_]+$/);
    for (const bad of ["秘密", JOB, POISON, "home.invalid", "test-secret", "203.0.113"]) assert.ok(!l.includes(bad), l);
  }
});

test("functions/api/find/score.ts、top.ts：薄包裝，打包後有 onRequest、走對的處理函式", async () => {
  for (const [file, fn] of [["score", "handleScore"], ["top", "handleTop"]]) {
    const src = fs.readFileSync(path.join(ROOT, "functions", "api", "find", file + ".ts"), "utf8");
    assert.match(src, new RegExp(`import \\{ ${fn} \\} from "\\.\\./\\.\\./\\.\\./src/lib/find/handlers"`));
    assert.match(src, new RegExp(`onRequest = \\(ctx: FindCtx\\): Promise<Response> => ${fn}\\(ctx\\)`));
    const { mod } = await bundleTs(`functions/api/find/${file}.ts`);
    assert.equal(typeof mod.onRequest, "function");
  }
  // 透過真的 onRequest 打一次（沒設定＝不會連網）：GET top 回空榜、POST score 回 saved:false
  const top = (await bundleTs("functions/api/find/top.ts")).mod;
  const r = await top.onRequest(get("/api/find/top", { env: {} }));
  assert.deepEqual(await r.json(), { ok: true, v: 1, week: [], all: [], me: null });
  const sc = (await bundleTs("functions/api/find/score.ts")).mod;
  const r2 = await sc.onRequest(post("/api/find/score", good(), { env: {} }));
  assert.deepEqual(await r2.json(), { ok: true, v: 1, saved: false });
});

/* ---------- 本機預覽（scripts/find-preview.mjs）也接得上兩條新端點：只連 127.0.0.1；沒有 dist 就略過 ---------- */
const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HAVE_DIST = fs.existsSync(path.join(DIST, "find", "index.html"));
test("預覽：/api/find/score 與 /api/find/top 走真正的處理函式＋本機假榜", { skip: !HAVE_DIST, timeout: 60000 }, async () => {
  const { spawn } = await import("node:child_process");
  const port = 44000 + Math.floor(Math.random() * 400);
  const p = spawn(process.execPath, [path.join(ROOT, "scripts/find-preview.mjs"), "--port", String(port), "--dist", DIST, "--mode", "fast"], { cwd: ROOT });
  try {
    await new Promise((resolve, reject) => {
      let out = "";
      const t = setTimeout(() => reject(new Error("預覽伺服器沒起來：" + out.slice(0, 200))), 20000);
      p.stdout.on("data", d => { out += d; if (out.includes("推薦頁（過期）")) { clearTimeout(t); resolve(); } });
      p.stderr.on("data", d => { out += d; });
      p.on("exit", c => { if (c) { clearTimeout(t); reject(new Error("預覽伺服器結束 " + c)); } });
    });
    const base = `http://127.0.0.1:${port}`;
    const hd = { origin: base, "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const sub = await (await fetch(base + "/api/find/submit", { method: "POST", headers: hd, body: JSON.stringify({ v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDf", fields: { districts: ["北屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000 }, context: {}, free_text: "", skip: false, contact: null, consent: null, refine_of: null, from: "line", fill_ms: 41000, turnstile: "preview-token", hp: "" }) })).json();
    const sc = await (await fetch(base + "/api/find/score", { method: "POST", headers: hd, body: JSON.stringify({ jobId: sub.jobId, floors: 12, ms: 20000, perfect: 2, name: "小王" }) })).json();
    assert.deepEqual(sc, { ok: true, v: 1, saved: true });
    const top = await (await fetch(`${base}/api/find/top?id=${sub.jobId}`, { headers: { "sec-fetch-site": "same-origin" } })).json();
    assert.deepEqual(top, { ok: true, v: 1, week: [{ rank: 1, name: "小王", floors: 12 }], all: [{ rank: 1, name: "小王", floors: 12 }], me: { rank: 1, floors: 12, weekRank: 1 } });
  } finally {
    p.kill();
  }
});

test("MemWindow：視窗、過期、鍵太多整個清掉", () => {
  const w = new SC.MemWindow(3);
  assert.equal(w.hit("a", 2, 1000, 0), true);
  assert.equal(w.hit("a", 2, 1000, 10), true);
  assert.equal(w.hit("a", 2, 1000, 20), false);
  assert.equal(w.hit("a", 2, 1000, 1000), true, "第一筆過期後又有名額");
  for (const k of ["b", "c", "d", "e"]) w.hit(k, 5, 1000, 1001);
  w.hit("f", 5, 1000, 1002);
  assert.ok(w.size <= 4, "超過上限會被整個清掉，不會無限長大");
  w.clear();
  assert.equal(w.size, 0);
});
