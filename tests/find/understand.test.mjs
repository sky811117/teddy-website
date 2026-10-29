// /api/find/understand（2026-10-29：客人那句話先交給家用機的 AI 讀）合約測試：全部離線，fetch 用假的；不連任何真實主機。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, bundleTs } from "./_helpers.mjs";

const H = (await bundleTs("src/lib/find/handlers.ts")).mod;
const C = (await bundleTs("src/lib/find/canon.ts")).mod;
const S = (await bundleTs("src/lib/find/schema.ts")).mod;

const POISON = "ZZPOISON_U1";
const UP = "https://home.invalid:8443";
const ENV = {
  FIND_ENABLED: "1",
  FIND_UPSTREAM_URL: UP,
  FIND_HMAC_SECRET: "test-secret-do-not-use",
  FIND_IP_SALT: "test-salt",
  TURNSTILE_SECRET_KEY: "ts-secret",
  TURNSTILE_SITE_KEY: "0xTESTSITEKEY",
};
const ORIGIN = { origin: "https://teddy-house.tw" };
const SAY = "西屯、南屯各10間，2到3房，1200萬以內";
const HOME_OK = {
  ok: true, v: 1, src: "ai", msg: POISON, raw: POISON,
  fields: { districts: ["西屯區", "南屯區"], rooms_min: 2, rooms_max: 3, price_max_wan: 1200, per_district: 10, note: POISON, road: POISON },
};

function net(over = {}) {
  const calls = [];
  const routes = {
    turnstile: () => Response.json({ success: true, hostname: "teddy-house.tw", action: "find" }),
    understand: () => Response.json(HOME_OK),
    ...over,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("https://challenges.cloudflare.com/")) return routes.turnstile(u, init);
    if (u.startsWith(UP + "/aif/v1/understand")) return routes.understand(u, init);
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { calls, deps: { fetch: fetchImpl, now: () => 1790000000000 } };
}
const upCalls = n => n.calls.filter(c => c.url.startsWith(UP));
const tsCalls = n => n.calls.filter(c => c.url.startsWith("https://challenges.cloudflare.com/"));

function post(body, { headers = ORIGIN, env = ENV } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request("https://teddy-house.tw/api/find/understand", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw,
  });
  return { request, env };
}
const good = (over = {}) => ({ v: 1, text: SAY, turnstile: "tok", ...over });
async function run(body, n = net(), opt = {}) {
  const res = await H.handleUnderstand(post(body, opt), n.deps);
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = text; }
  return { res, text, j, n };
}

test("understand：驗過人機驗證→簽章轉送（只送白名單）→條件再過一次白名單，只回 fields 與 src", async () => {
  const { res, text, j, n } = await run(good(), net(), { headers: { ...ORIGIN, "cf-connecting-ip": "203.0.113.9" } });
  assert.equal(res.status, 200);
  assert.deepEqual(j, { ok: true, v: 1, fields: { districts: ["西屯區", "南屯區"], price_max_wan: 1200, rooms_min: 2, rooms_max: 3, per_district: 10 }, src: "ai" });
  assert.ok(!text.includes(POISON), "上游的任何其他文字都不能轉回去");
  assert.equal(tsCalls(n).length, 1);
  const up = upCalls(n);
  assert.equal(up.length, 1);
  assert.equal(up[0].url, UP + "/aif/v1/understand");
  assert.equal(up[0].init.method, "POST");
  const h = up[0].init.headers;
  const bodyBytes = up[0].init.body;
  const sig = await C.hmacHex(ENV.FIND_HMAC_SECRET, C.canonString("POST", "/aif/v1/understand", h["X-Aif-Ts"], h["X-Aif-Nonce"], await C.sha256Hex(bodyBytes)));
  assert.equal(h["X-Aif-Sig"], sig, "簽章驗得過");
  const sent = JSON.parse(new TextDecoder().decode(bodyBytes));
  assert.deepEqual(Object.keys(sent).sort(), ["client", "text", "v"]);
  assert.deepEqual(Object.keys(sent.client).sort(), ["ip_h", "turnstile"]);
  assert.equal(sent.text, S.normText(SAY).trim(), "跟 submit 的 free_text 同一套正規化（NFKC）");
  assert.equal(sent.client.turnstile, "ok");
  assert.match(sent.client.ip_h, /^[0-9a-f]{16}$/, "IP 只送雜湊");
});

test("understand：src 只有 ai／rules 兩種；家用機回 rules 或怪值都當 rules", async () => {
  for (const [src, want] of [["rules", "rules"], ["claude", "rules"], [undefined, "rules"], ["ai", "ai"]]) {
    const { j } = await run(good(), net({ understand: () => Response.json({ ...HOME_OK, src }) }));
    assert.equal(j.src, want, String(src));
  }
});

test("understand：人機驗證沒過、沒帶 token、驗不了 → ok:false，不轉送", async () => {
  for (const [label, n, body, env] of [
    ["沒過", net({ turnstile: () => Response.json({ success: false }) }), good(), ENV],
    ["別的 action", net({ turnstile: () => Response.json({ success: true, hostname: "teddy-house.tw", action: "contact" }) }), good(), ENV],
    ["沒帶 token", net(), good({ turnstile: "" }), ENV],
    ["沒設金鑰", net(), good(), { ...ENV, TURNSTILE_SECRET_KEY: "" }],
  ]) {
    const { res, j } = await run(body, n, { env });
    assert.equal(res.status, 200, label);
    assert.deepEqual(j, { ok: false, v: 1, code: "E_HUMAN" }, label);
    assert.equal(upCalls(n).length, 0, label);
  }
});

test("understand：查詢功能沒設定完整（收件模式）→ ok:false，連人機驗證都不打", async () => {
  for (const env of [{ ...ENV, FIND_ENABLED: "0" }, { ...ENV, FIND_HMAC_SECRET: "" }, { ...ENV, FIND_IP_SALT: "" }, { ...ENV, FIND_UPSTREAM_URL: "http://evil.example" }]) {
    const { j, n } = await run(good(), net(), { env });
    assert.deepEqual(j, { ok: false, v: 1, code: "E_FORWARD" });
    assert.equal(n.calls.length, 0);
  }
});

test("understand：家用機連不上／5xx／怪格式／沒開／太頻繁 → ok:false（前端照瀏覽器規則讀）", async () => {
  const cases = [
    [() => { throw new TypeError("network"); }, "E_FORWARD"],
    [() => new Response("x", { status: 502 }), "E_FORWARD"],
    [() => new Response("not json", { status: 200 }), "E_FORWARD"],
    [() => new Response(null, { status: 401 }), "E_FORWARD"],
    [() => Response.json({ ok: false, v: 1, code: "off" }), "E_FORWARD"],
    [() => Response.json({ ok: true, v: 1, fields: ["西屯區"], src: "ai" }), "E_FORWARD"],
    [() => Response.json({ ok: true, v: 1, src: "ai" }), "E_FORWARD"],
    [() => new Response(null, { status: 429 }), "E_RATE"],
    [() => Response.json({ ok: false, v: 1, code: "rate" }), "E_RATE"],
  ];
  for (const [fn, code] of cases) {
    const { res, j, text } = await run(good(), net({ understand: fn }));
    assert.equal(res.status, 200, String(fn));
    assert.deepEqual(j, { ok: false, v: 1, code }, String(fn));
    assert.ok(!text.includes(POISON));
  }
});

test("understand：方法、來源、本文檢查（不打人機驗證、不轉送）", async () => {
  const n = net();
  let res = await H.handleUnderstand({ request: new Request("https://teddy-house.tw/api/find/understand", { method: "GET" }), env: ENV }, n.deps);
  assert.equal(res.status, 405);
  ({ res } = await run(good(), n, { headers: {} }));
  assert.equal(res.status, 403);
  for (const bad of [good({ v: 2 }), good({ text: "" }), good({ text: "   " }), good({ text: 123 }), good({ text: "字".repeat(301) }), "{not json", [1, 2]]) {
    ({ res } = await run(bad, n));
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 40));
  }
  ({ res } = await run(good({ text: "字".repeat(300) }), net()));
  assert.equal(res.status, 200, "剛好 300 字可以");
  ({ res } = await run(good({ pad: "x".repeat(7000) }), n));
  assert.equal(res.status, 413);
  assert.equal(n.calls.length, 0);
});

test("schema：per_district 只收 1～30 的整數；validateUnderstand 去頭尾空白、300 字上限", () => {
  for (const [v, ok] of [[1, true], [10, true], [30, true], [0, false], [31, false], ["10", false], [2.5, false], [null, false]]) {
    const r = S.normalizeFields({ districts: ["北屯區"], per_district: v });
    assert.equal("per_district" in r.fields, ok, String(v));
    if (!ok && v !== null) assert.ok(r.issues.includes("per_district:invalid"), String(v));
  }
  assert.deepEqual(S.validateUnderstand({ v: 1, text: "  北屯三房  ", turnstile: "t" }), { text: "北屯三房", turnstile: "t" });
  assert.equal(S.validateUnderstand({ v: 1, text: "北屯三房", turnstile: "x".repeat(2049) }).turnstile, "");
  assert.equal(S.validateUnderstand({ v: 1, text: "字".repeat(301) }), null);
  assert.equal(S.validateUnderstand(null), null);
});

test("config：家用機回報 ai 才轉給前端（caps 白名單多了 ai，其他怪值照樣丟掉）", async () => {
  assert.deepEqual(H.capsOf(["community", "ai", "evil", "geo"]), ["community", "geo", "ai"]);
  assert.deepEqual(H.capsOf("ai"), []);
  H.resetConfigCache();
  const fetchImpl = async url => {
    if (String(url).startsWith(UP + "/aif/v1/health")) return Response.json({ ok: true, v: 1, mode: "live", caps: ["zone", "ai"] });
    throw new Error("測試不准連到其他網址：" + url);
  };
  const res = await H.handleConfig({ request: new Request("https://teddy-house.tw/api/find/config", { method: "GET", headers: { "sec-fetch-site": "same-origin" } }), env: ENV }, { fetch: fetchImpl, now: () => 1790000000000 });
  const j = await res.json();
  assert.deepEqual(j.caps, ["zone", "ai"]);
  H.resetConfigCache();
});

test("回應白名單多了 fields、src；Function 薄包裝存在並交給 handleUnderstand", () => {
  for (const k of ["fields", "src"]) assert.ok(H.RESPONSE_KEYS.includes(k), k);
  const fn = fs.readFileSync(path.join(ROOT, "functions/api/find/understand.ts"), "utf8");
  assert.match(fn, /import \{ handleUnderstand \} from "\.\.\/\.\.\/\.\.\/src\/lib\/find\/handlers";/);
  assert.match(fn, /export const onRequest = \(ctx: FindCtx\): Promise<Response> => handleUnderstand\(ctx\);/);
});
