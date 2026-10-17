// /api/contact-tg、/api/contact-sell 的回應不得洩漏內部狀態（M-20）。離線：fetch 用假的。
// 執行：node --test "tests/functions/*.test.mjs"
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// 2026-10-17：兩支端點現在 import src/lib/find/*（沒有副檔名，打包器看得懂、Node 直接讀看不懂）：補 .ts（同 share.test.mjs）
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier + ".ts", context);
      } catch {
        /* 不是 .ts 檔就照原樣解析 */
      }
    }
    return nextResolve(specifier, context);
  },
});

const FN_DIR = process.env.SEC_TEST_FUNCTIONS_DIR
  ? path.resolve(process.env.SEC_TEST_FUNCTIONS_DIR)
  : path.resolve(import.meta.dirname, "../../functions");
const tg = await import(pathToFileURL(path.join(FN_DIR, "api", "contact-tg.ts")).href);
const sell = await import(pathToFileURL(path.join(FN_DIR, "api", "contact-sell.ts")).href);

const ORIGIN = "https://teddy-house.tw";
// 2026-10-17：兩支都接了 Turnstile（fail-closed），測試環境一律帶假的 secret；真人的 payload 帶「對的用途」的假 token
const ENV_TG = { CONTACT_TG_TOKEN: "fake-token-for-test", CONTACT_TG_CHAT: "123", TURNSTILE_SECRET_KEY: "ts-secret-for-test" };
const ENV_SELL = { ...ENV_TG, NOTION_API_KEY: "fake-notion-key", NOTION_SELL_DB_ID: "fake-db-id" };
const TS_URL = "https://challenges.cloudflare.com/";

// 內部狀態類欄位，任何情況都不能出現在回應裡
const FORBIDDEN_KEYS = ["status", "spam", "stored", "notified", "detail", "stack", "message", "tg", "notion"];

const realFetch = globalThis.fetch;
const realConsole = { error: console.error, warn: console.warn, log: console.log };
let routes;
let sent; // 被測程式實際送出去的外部請求（TG／Notion），給「訊息內容」類的測試看（Turnstile 查驗另外記在 tsCalls）
let tsCalls;
// 兩支端點都有「每個節點每分鐘最多 10 則 TG」的發送端上限（RT-06，模組內狀態）：每個測試前把時鐘往後撥 61 秒，
// 測試之間不互相吃掉額度（測試變多之後，不撥時鐘會在第 11 則開始拿到 degraded）
const realNow = Date.now;
let clock = realNow();
beforeEach(() => {
  console.error = console.warn = console.log = () => {}; // 被測程式會 log，測試輸出保持乾淨
  clock += 61_000;
  Date.now = () => clock;
  sent = [];
  tsCalls = [];
  routes = {
    tg: () => new Response('{"ok":true}'),
    notion: () => new Response('{"id":"x"}'),
    // 假的 siteverify：token 寫成「tok:<用途>」就回成功＋那個用途；其他一律 success:false
    turnstile: tok => {
      const m = /^tok:([a-z-]+)$/.exec(tok || "");
      return m
        ? Response.json({ success: true, hostname: "teddy-house.tw", action: m[1] })
        : Response.json({ success: false });
    },
  };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith(TS_URL)) {
      const tok = new URLSearchParams(String(init?.body ?? "")).get("response");
      tsCalls.push(tok);
      return routes.turnstile(tok);
    }
    sent.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    if (u.startsWith("https://api.telegram.org/")) return routes.tg();
    if (u.startsWith("https://api.notion.com/")) return routes.notion();
    throw new Error("測試不該連到：" + u);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  Object.assign(console, realConsole);
});

function post(handlerModule, body, env, { origin = ORIGIN, base = ORIGIN } = {}) {
  const request = new Request(base + "/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return handlerModule.onRequestPost({ request, env });
}

async function json(res) {
  const text = await res.text();
  return { text, data: JSON.parse(text) };
}

function assertNoLeak(data, text, extraNeedles = []) {
  for (const k of FORBIDDEN_KEYS) assert.ok(!(k in data), `回應不該有欄位 ${k}：${text}`);
  for (const n of extraNeedles) assert.ok(!text.includes(n), `回應不該含 ${n}：${text}`);
}

const BUY = { 姓名: "王小明", 手機: "0912345678", 我想: "買房", 訊息: "測試", turnstile: "tok:contact-buy" };
const SELL = { 姓名: "王小明", 電話: "0912345678", 物件地址: "台中市西屯區文心路四段", turnstile: "tok:contact-sell" };

// ───────────── contact-tg ─────────────
test("contact-tg：TG 回 429／500／401，回應不含 status、也不含 TG 的狀態碼或錯誤內文", async () => {
  for (const code of [429, 500, 401, 400, 403]) {
    routes.tg = () => new Response(`{"ok":false,"description":"secret detail ${code}"}`, { status: code });
    const res = await post(tg, BUY, ENV_TG);
    const { data, text } = await json(res);
    assert.equal(res.status, 200);
    assert.deepEqual(data, { ok: false, degraded: true, error: "delivery_failed" });
    assertNoLeak(data, text, [String(code), "secret detail"]);
  }
});

test("contact-tg：TG 連線丟錯 → delivery_failed，無內部細節", async () => {
  routes.tg = () => {
    throw new Error("socket hang up at 10.0.0.1");
  };
  const { data, text } = await json(await post(tg, BUY, ENV_TG));
  assert.deepEqual(data, { ok: false, degraded: true, error: "delivery_failed" });
  assertNoLeak(data, text, ["socket", "10.0.0.1"]);
});

test("contact-tg：成功 → 只有 { ok:true }", async () => {
  const { data } = await json(await post(tg, BUY, ENV_TG));
  assert.deepEqual(data, { ok: true });
});

test("contact-tg：honeypot 與『太快送出』拿到跟真人一樣的 { ok:true }（沒有 spam 欄位）", async () => {
  const hp = await json(await post(tg, { ...BUY, _gotcha: "bot" }, ENV_TG));
  assert.deepEqual(hp.data, { ok: true });
  const fast = await json(await post(tg, { ...BUY, _loaded_at: String(Date.now()) }, ENV_TG));
  assert.deepEqual(fast.data, { ok: true });
  // 且兩者都不該真的去打 TG
});

test("contact-tg：honeypot／太快送出不會真的推 TG", async () => {
  let called = 0;
  routes.tg = () => {
    called += 1;
    return new Response("{}");
  };
  await post(tg, { ...BUY, _gotcha: "x" }, ENV_TG);
  await post(tg, { ...BUY, _loaded_at: String(Date.now()) }, ENV_TG);
  assert.equal(called, 0);
});

test("contact-tg：沒設環境變數 → 既有的 backend_not_configured（給景泰除錯用，行為不變）", async () => {
  const { data } = await json(await post(tg, BUY, {}));
  assert.deepEqual(data, { ok: false, degraded: true, error: "backend_not_configured" });
});

test("contact-tg：錯誤路徑的回應都沒有內部欄位", async () => {
  const cases = [
    [post(tg, "{not json", ENV_TG), 400],
    [post(tg, BUY, ENV_TG, { origin: "https://evil.example" }), 403],
    [post(tg, { 姓名: "x" }, ENV_TG), 400],
    [post(tg, { ...BUY, 手機: "abc" }, ENV_TG), 400],
  ];
  for (const [p, status] of cases) {
    const res = await p;
    assert.equal(res.status, status);
    const { data, text } = await json(res);
    assert.equal(data.ok, false);
    assertNoLeak(data, text);
  }
});

// ───────────── contact-sell ─────────────
test("contact-sell：Notion、TG 都成功 → 只有 { ok:true }（不再回 stored／notified）", async () => {
  const { data, text } = await json(await post(sell, SELL, ENV_SELL));
  assert.deepEqual(data, { ok: true });
  assertNoLeak(data, text);
});

test("contact-sell：只有一條管道成功也只回 { ok:true }，看不出哪條成功", async () => {
  routes.notion = () => new Response('{"message":"unauthorized"}', { status: 401 });
  const a = await json(await post(sell, SELL, ENV_SELL));
  assert.deepEqual(a.data, { ok: true });
  routes.notion = () => new Response('{"id":"x"}');
  routes.tg = () => new Response("{}", { status: 500 });
  const b = await json(await post(sell, SELL, ENV_SELL));
  assert.deepEqual(b.data, { ok: true });
});

test("contact-sell：兩條都失敗 → degraded，不含狀態碼與錯誤內文", async () => {
  routes.notion = () => new Response('{"message":"secret notion detail"}', { status: 401 });
  routes.tg = () => new Response('{"description":"secret tg detail"}', { status: 429 });
  const { data, text } = await json(await post(sell, SELL, ENV_SELL));
  assert.deepEqual(data, { ok: false, degraded: true, error: "delivery_failed" });
  assertNoLeak(data, text, ["401", "429", "secret"]);
});

test("contact-sell：沒設環境變數 → 既有的 backend_not_configured（行為不變）", async () => {
  const { data } = await json(await post(sell, SELL, {}));
  assert.deepEqual(data, { ok: false, degraded: true, error: "backend_not_configured" });
});

test("contact-sell：honeypot／太快送出 → { ok:true }，沒有 spam 欄位", async () => {
  const hp = await json(await post(sell, { ...SELL, _gotcha: "bot" }, ENV_SELL));
  assert.deepEqual(hp.data, { ok: true });
  const fast = await json(await post(sell, { ...SELL, _loaded_at: String(Date.now()) }, ENV_SELL));
  assert.deepEqual(fast.data, { ok: true });
});

test("contact-sell：錯誤路徑的回應都沒有內部欄位", async () => {
  const cases = [
    [post(sell, "{bad", ENV_SELL), 400],
    [post(sell, SELL, ENV_SELL, { origin: "https://evil.example" }), 403],
    [post(sell, { 姓名: "x" }, ENV_SELL), 400],
  ];
  for (const [p, status] of cases) {
    const res = await p;
    assert.equal(res.status, status);
    const { data, text } = await json(res);
    assertNoLeak(data, text);
  }
});

// ───────────────────────── 驗證者回饋併入（2026-10-06）─────────────────────────
// 殘餘風險 F：honeypot／太快送出，不能再讓 bot 靠「缺欄位的請求回 200 還是 400」分辨自己有沒有被抓到。
async function shape(handler, body, env) {
  const res = await post(handler, body, env);
  const { data } = await json(res);
  return { status: res.status, data };
}

test("F：honeypot／太快送出的 bot，送『缺必填欄位』的請求，拿到的回應跟一般人完全一樣（400 Missing required fields）", async () => {
  for (const [h, env, good] of [[tg, ENV_TG, BUY], [sell, ENV_SELL, SELL]]) {
    const plain = await shape(h, { 姓名: "x" }, env);
    assert.equal(plain.status, 400);
    for (const bot of [{ 姓名: "x", _gotcha: "bot" }, { _gotcha: "bot" }, { 姓名: "x", _loaded_at: String(Date.now()) }, { _loaded_at: String(Date.now()) }]) {
      const r = await shape(h, bot, env);
      assert.deepEqual(r, plain, `bot 與真人的回應必須一樣：${JSON.stringify(bot)}`);
    }
    // 欄位格式錯誤也一樣
    const badPhone = await shape(h, { ...good, [h === tg ? "手機" : "電話"]: "abc" }, env);
    const badPhoneBot = await shape(h, { ...good, [h === tg ? "手機" : "電話"]: "abc", _gotcha: "bot" }, env);
    assert.deepEqual(badPhoneBot, badPhone);
    assert.equal(badPhone.status, 400);
  }
});

test("F：驗證通過的 bot 才被靜默吞掉（回 {ok:true}、不推 TG、不寫 Notion）；真人照常送達", async () => {
  for (const [h, env, good] of [[tg, ENV_TG, BUY], [sell, ENV_SELL, SELL]]) {
    sent = [];
    assert.deepEqual((await shape(h, { ...good, _gotcha: "bot" }, env)).data, { ok: true });
    assert.deepEqual((await shape(h, { ...good, _loaded_at: String(Date.now()) }, env)).data, { ok: true });
    assert.equal(sent.length, 0, "bot 不該觸發任何外部請求");
    assert.deepEqual((await shape(h, good, env)).data, { ok: true });
    assert.ok(sent.length >= 1, "真人要真的送出去");
  }
});

test("F：時鐘超前（_loaded_at 在未來）視為異常但放行，不當成 bot（既有行為不變）", async () => {
  sent = [];
  const r = await shape(tg, { ...BUY, _loaded_at: String(Date.now() + 60_000) }, ENV_TG);
  assert.deepEqual(r.data, { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(tsCalls.length, 1, "真人照常走人機驗證");
});

test("J：單行欄位的換行被換成空白，不能在 TG 偽造多行假通知（買方表單）", async () => {
  const evil = "王小明\n\n🚨 <b>系統通知</b>\n請立刻回電 0900000000\u2028第二行\u0085第三行";
  const r = await shape(tg, { ...BUY, 姓名: evil, 我想: "買房\n假欄位：x", 預算: "1000\n萬", 區域偏好: "西屯\n北屯", 來源頁: "/a\n/b", 訊息: "第一行\n第二行" }, ENV_TG);
  assert.deepEqual(r.data, { ok: true });
  const text = sent.find(s => s.url.includes("telegram"))?.body?.text ?? "";
  const nameLine = text.split("\n").find(l => l.startsWith("<b>姓名</b>")) ?? "";
  assert.ok(nameLine.includes("系統通知"), "姓名內容還在（只是換行變空白）");
  assert.ok(!text.split("\n").some(l => /^🚨/.test(l)), "不可出現由姓名偽造出來的獨立一行");
  assert.ok(!/\u2028|\u0085/.test(text));
  for (const label of ["預算", "區域", "來源"]) {
    const l = text.split("\n").find(x => x.includes(`${label}</`)) ?? "";
    assert.ok(l && !l.endsWith("：") , `${label} 欄位要在同一行`);
  }
  // 訊息欄是真的多行欄位：換行要保留（2026-10-17 起整段包在 <code> 裡）
  assert.match(text, /<b>訊息<\/b>：\n<code>第一行\n第二行<\/code>/);
});

test("J：單行欄位的換行被換成空白（賣方表單；備註仍保留多行）", async () => {
  const r = await shape(sell, { ...SELL, 姓名: "李先生\n🚨假通知", 物件地址: "西屯區文心路\n請匯款", 備註: "第一行\n第二行" }, ENV_SELL);
  assert.deepEqual(r.data, { ok: true });
  const text = sent.find(s => s.url.includes("telegram"))?.body?.text ?? "";
  assert.ok(!text.split("\n").some(l => /^🚨/.test(l) || /^請匯款/.test(l)), "姓名／地址不可偽造出新的一行");
  assert.match(text, /<b>備註<\/b>：\n<code>第一行\n第二行<\/code>/);
  const notion = sent.find(s => s.url.includes("notion"))?.body;
  assert.ok(notion, "Notion 也要寫入");
  assert.ok(!JSON.stringify(notion.properties["姓名"]).includes("\\n"), "Notion 姓名也不含換行");
  assert.match(JSON.stringify(notion.properties["備註"]), /第一行\\n第二行/);
});

test("前端相容：ContactForm／SellForm 只讀 data.ok（不依賴被移除的欄位）", async () => {
  const { readFileSync } = await import("node:fs");
  const root = path.resolve(FN_DIR, "..");
  for (const f of ["src/components/ContactForm.astro", "src/components/SellForm.astro"]) {
    const src = readFileSync(path.join(root, f), "utf-8");
    assert.ok(!/\.(stored|notified|spam)\b/.test(src), `${f} 不應讀 stored／notified／spam`);
    assert.ok(!/data\.status\b/.test(src), `${f} 不應讀 data.status`);
  }
});

// ───────────────────────── 2026-10-17 資安自查（security_20261017/code_review.md）─────────────────────────
// 第 1 項：人機驗證（Turnstile，fail-closed）。第 2 項：主機名鎖定。第 3 項：TG 訊息裡的連結去活化。第 11 項：Notion 狀態行。
const outbound = () => sent.filter(s => s.url.startsWith("https://api.telegram.org/") || s.url.startsWith("https://api.notion.com/"));

test("Turnstile：沒帶 token、token 驗不過、用途不對（拿賣方表單的 token 打買方）→ 403，不推 TG、不寫 Notion", async () => {
  for (const [h, env, good, other] of [[tg, ENV_TG, BUY, "tok:contact-sell"], [sell, ENV_SELL, SELL, "tok:contact-buy"]]) {
    for (const token of [undefined, "", "bad-token", other, "tok:find"]) {
      sent = [];
      const body = { ...good };
      if (token === undefined) delete body.turnstile;
      else body.turnstile = token;
      const res = await post(h, body, env);
      assert.equal(res.status, 403, `token=${token}`);
      const { data, text } = await json(res);
      assert.equal(data.ok, false);
      assertNoLeak(data, text, ["action", "hostname", "no_token", "rejected"]);
      assert.equal(outbound().length, 0, `token=${token} 不能推 TG／寫 Notion`);
    }
  }
});

test("Turnstile：沒設 TURNSTILE_SECRET_KEY、或查驗服務連不上／回 500 → fail-closed：degraded，不推 TG、不寫 Notion", async () => {
  const okRoute = routes.turnstile;
  for (const [h, env, good] of [[tg, ENV_TG, BUY], [sell, ENV_SELL, SELL]]) {
    sent = [];
    const noSecret = { ...env };
    delete noSecret.TURNSTILE_SECRET_KEY;
    assert.deepEqual((await json(await post(h, good, noSecret))).data, { ok: false, degraded: true, error: "delivery_failed" });
    routes.turnstile = () => new Response("oops", { status: 500 });
    assert.deepEqual((await json(await post(h, good, env))).data, { ok: false, degraded: true, error: "delivery_failed" });
    routes.turnstile = () => {
      throw new Error("network down");
    };
    assert.deepEqual((await json(await post(h, good, env))).data, { ok: false, degraded: true, error: "delivery_failed" });
    assert.equal(outbound().length, 0);
    routes.turnstile = okRoute;
  }
});

test("Turnstile：查驗回應沒帶 hostname、或 hostname 不是官網 → 403（turnstile.ts 改嚴格）", async () => {
  for (const hostname of [undefined, "evil.example", "teddy-website-blog.pages.dev"]) {
    sent = [];
    routes.turnstile = () => Response.json({ success: true, action: "contact-buy", ...(hostname ? { hostname } : {}) });
    const res = await post(tg, BUY, ENV_TG);
    assert.equal(res.status, 403, String(hostname));
    assert.equal(outbound().length, 0);
  }
});

test("Turnstile：token 有送去 siteverify（含客人 IP），真人照常送達；token 不寫進 Notion／TG", async () => {
  let seenBody = "";
  routes.turnstile = () => Response.json({ success: true, hostname: "www.teddy-house.tw", action: "contact-sell" });
  const mockFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(TS_URL)) seenBody = String(init.body);
    return mockFetch(url, init);
  };
  const request = new Request(ORIGIN + "/api/contact-sell", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ ...SELL, turnstile: "secret-looking-token-123" }),
  });
  const { data } = await json(await sell.onRequestPost({ request, env: ENV_SELL }));
  assert.deepEqual(data, { ok: true });
  assert.match(seenBody, /response=secret-looking-token-123/);
  assert.match(seenBody, /remoteip=203\.0\.113\.7/);
  assert.ok(!JSON.stringify(sent).includes("secret-looking-token-123"), "token 不能出現在 Notion／TG");
});

test("主機名：打在舊 pages.dev／預覽網址（就算偽造官網 Origin）→ 404，不查驗、不推 TG；正式網域 www 照常", async () => {
  for (const [h, env, good] of [[tg, ENV_TG, BUY], [sell, ENV_SELL, SELL]]) {
    for (const base of ["https://teddy-website-blog.pages.dev", "https://abc123.teddy-website-blog.pages.dev", "https://evil.example"]) {
      sent = [];
      tsCalls = [];
      const res = await post(h, good, env, { base });
      assert.equal(res.status, 404, base);
      assert.equal(sent.length + tsCalls.length, 0, `${base} 不能有任何對外呼叫`);
      const g = await h.onRequestGet({ request: new Request(base + "/api/x"), env: { TURNSTILE_SITE_KEY: "0x4AAAAAAATESTKEY1234567" } });
      assert.equal(g.status, 404);
      const other = await h.onRequest({ request: new Request(base + "/api/x", { method: "PUT" }), env });
      assert.equal(other.status, 404);
    }
    const www = await post(h, good, env, { base: "https://www.teddy-house.tw", origin: "https://www.teddy-house.tw" });
    assert.deepEqual((await json(www)).data, { ok: true });
    // 正式網域只收正式網域的 Origin（不收 http://localhost）
    assert.equal((await post(h, good, env, { origin: "http://localhost:8788" })).status, 403);
  }
});

test("GET 取 site key：回 { ok:true, turnstileSiteKey }；後台誤貼 Secret（格式不像 site key）回 null；跨站 403", async () => {
  for (const h of [tg, sell]) {
    const mk = (headers = {}) => new Request(ORIGIN + "/api/x", { headers });
    const ok = await json(await h.onRequestGet({ request: mk({ "sec-fetch-site": "same-origin" }), env: { TURNSTILE_SITE_KEY: " 0x4AAAAAAATESTKEY1234567 " } }));
    assert.deepEqual(ok.data, { ok: true, turnstileSiteKey: "0x4AAAAAAATESTKEY1234567" });
    const secretLike = await json(await h.onRequestGet({ request: mk(), env: { TURNSTILE_SITE_KEY: "0x4AAAAAAATESTSECRETKEY-abcdefghijk" } }));
    assert.deepEqual(secretLike.data, { ok: true, turnstileSiteKey: null });
    const none = await json(await h.onRequestGet({ request: mk(), env: {} }));
    assert.deepEqual(none.data, { ok: true, turnstileSiteKey: null });
    const cross = await h.onRequestGet({ request: mk({ "sec-fetch-site": "cross-site" }), env: { TURNSTILE_SITE_KEY: "0x4AAAAAAATESTKEY1234567" } });
    assert.equal(cross.status, 403);
  }
});

test("TG 訊息：客人打的網址去活化成 hxxp://、全部包在 <code> 裡、電話與 @帳號保留；系統的 tel 連結照常", async () => {
  const evil = "請點 http://evil.example/login?x=1 或 bit.ly/3AbCdEf，加 @evil_admin";
  const r1 = await shape(tg, { ...BUY, 姓名: "王 t.me/evil_bot", 物件編號或描述: "看 www.evil.example", 區域偏好: "西屯 goo.gl/abc", 來源頁: "https://evil.example/x", 訊息: evil + "\n第二行 evil.example/y" }, ENV_TG);
  assert.deepEqual(r1.data, { ok: true });
  const r2 = await shape(sell, { ...SELL, 姓名: "李 bit.ly/x1", 物件地址: "西屯區 www.evil.example", 備註: evil }, ENV_SELL);
  assert.deepEqual(r2.data, { ok: true });
  const texts = sent.filter(s => s.url.includes("telegram")).map(s => s.body.text);
  assert.equal(texts.length, 2);
  for (const text of texts) {
    for (const needle of ["http://", "https://evil"]) {
      assert.ok(!text.includes(needle), `TG 訊息不該含可點的 ${needle}：${text}`);
    }
    assert.ok(text.includes("hxxp://evil.example"), `網址應去活化成 hxxp://：${text}`);
    assert.ok(text.includes("@evil_admin"), "客人打的 @帳號要保留（可能是 LINE ID）");
    // 客人文字一律在 <code> 裡：把 <code>…</code> 拿掉之後，剩下的只有系統標籤與 tel 連結
    const outside = text.replace(/<code>[\s\S]*?<\/code>/g, "");
    assert.ok(!/王|李|西屯|請點|第二行/.test(outside), `客人文字跑到 <code> 外面了：${outside}`);
    assert.match(text, /<a href="tel:0912345678">0912345678<\/a>/);
  }
});

test("TG 訊息：Email 格式規矩才做成 mailto 連結；寬鬆驗證放進來的怪 Email 只當文字放 <code>", async () => {
  await shape(tg, { ...BUY, Email: "wang.xm@example.com" }, ENV_TG);
  await shape(tg, { ...BUY, Email: "請點https://evil.example/x@a.b" }, ENV_TG);
  const [good, odd] = sent.filter(s => s.url.includes("telegram")).map(s => s.body.text);
  assert.match(good, /<a href="mailto:wang\.xm@example\.com">wang\.xm@example\.com<\/a>/);
  assert.ok(!/mailto:/.test(odd), odd);
  assert.match(odd, /<b>Email<\/b>：<code>[^<]*<\/code>/);
});

test("賣方 TG 訊息的 Notion 狀態行照實際結果：寫成→已寫入；Notion 失敗或沒設→⚠️ Notion 寫入失敗", async () => {
  await shape(sell, SELL, ENV_SELL);
  routes.notion = () => new Response('{"message":"x"}', { status: 500 });
  await shape(sell, SELL, ENV_SELL);
  const noNotion = { ...ENV_SELL };
  delete noNotion.NOTION_API_KEY;
  await shape(sell, SELL, noNotion);
  const [ok, failed, missing] = sent.filter(s => s.url.includes("telegram")).map(s => s.body.text);
  assert.match(ok, /📝 已寫入 Notion「賣房客戶名單」/);
  assert.ok(!/寫入失敗/.test(ok));
  for (const t of [failed, missing]) {
    assert.match(t, /⚠️ Notion 寫入失敗/);
    assert.ok(!/📝 已寫入/.test(t));
  }
});
