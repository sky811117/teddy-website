// /api/contact-tg、/api/contact-sell 的回應不得洩漏內部狀態（M-20）。離線：fetch 用假的。
// 執行：node --test "tests/functions/*.test.mjs"
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const FN_DIR = process.env.SEC_TEST_FUNCTIONS_DIR
  ? path.resolve(process.env.SEC_TEST_FUNCTIONS_DIR)
  : path.resolve(import.meta.dirname, "../../functions");
const tg = await import(pathToFileURL(path.join(FN_DIR, "api", "contact-tg.ts")).href);
const sell = await import(pathToFileURL(path.join(FN_DIR, "api", "contact-sell.ts")).href);

const ORIGIN = "https://teddy-house.tw";
const ENV_TG = { CONTACT_TG_TOKEN: "fake-token-for-test", CONTACT_TG_CHAT: "123" };
const ENV_SELL = { ...ENV_TG, NOTION_API_KEY: "fake-notion-key", NOTION_SELL_DB_ID: "fake-db-id" };

// 內部狀態類欄位，任何情況都不能出現在回應裡
const FORBIDDEN_KEYS = ["status", "spam", "stored", "notified", "detail", "stack", "message", "tg", "notion"];

const realFetch = globalThis.fetch;
const realConsole = { error: console.error, warn: console.warn, log: console.log };
let routes;
let sent; // 被測程式實際送出去的外部請求（TG／Notion），給「訊息內容」類的測試看
beforeEach(() => {
  console.error = console.warn = console.log = () => {}; // 被測程式會 log，測試輸出保持乾淨
  sent = [];
  routes = { tg: () => new Response('{"ok":true}'), notion: () => new Response('{"id":"x"}') };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    sent.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    if (u.startsWith("https://api.telegram.org/")) return routes.tg();
    if (u.startsWith("https://api.notion.com/")) return routes.notion();
    throw new Error("測試不該連到：" + u);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
});

function post(handlerModule, body, env, { origin = ORIGIN } = {}) {
  const request = new Request(ORIGIN + "/api/x", {
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

const BUY = { 姓名: "王小明", 手機: "0912345678", 我想: "買房", 訊息: "測試" };
const SELL = { 姓名: "王小明", 電話: "0912345678", 物件地址: "台中市西屯區文心路四段" };

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
  // 訊息欄是真的多行欄位：換行要保留
  assert.match(text, /<b>訊息<\/b>：\n第一行\n第二行/);
});

test("J：單行欄位的換行被換成空白（賣方表單；備註仍保留多行）", async () => {
  const r = await shape(sell, { ...SELL, 姓名: "李先生\n🚨假通知", 物件地址: "西屯區文心路\n請匯款", 備註: "第一行\n第二行" }, ENV_SELL);
  assert.deepEqual(r.data, { ok: true });
  const text = sent.find(s => s.url.includes("telegram"))?.body?.text ?? "";
  assert.ok(!text.split("\n").some(l => /^🚨/.test(l) || /^請匯款/.test(l)), "姓名／地址不可偽造出新的一行");
  assert.match(text, /<b>備註<\/b>：\n第一行\n第二行/);
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
