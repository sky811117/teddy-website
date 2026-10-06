// /go/line 的資安測試（M-20）。離線：fetch 用假的、不連任何外網。
// 執行：node --test "tests/functions/*.test.mjs"（Node 22.18+／24，原生支援直接 import .ts）
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

// 預設測「這個 worktree 的新版」；設 SEC_TEST_FUNCTIONS_DIR 可改測別的目錄（例如舊版，用來證明測試真的抓得到洞）
const FN_DIR = process.env.SEC_TEST_FUNCTIONS_DIR
  ? path.resolve(process.env.SEC_TEST_FUNCTIONS_DIR)
  : path.resolve(import.meta.dirname, "../../functions");

const LINE_URL = "https://line.me/ti/p/~sky811117";
const ENV = { CONTACT_TG_TOKEN: "fake-token-for-test", CONTACT_TG_CHAT: "123" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1";

let fresh = 0;
// 每個測試載入一份「全新」模組（模組層級的節流 Map／計數器各自獨立）
async function loadLine() {
  fresh += 1;
  return import(pathToFileURL(path.join(FN_DIR, "go", "line.ts")).href + `?fresh=${fresh}`);
}

let tgCalls = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  tgCalls = [];
  globalThis.fetch = async (url, init) => {
    tgCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response('{"ok":true}');
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// 送一個請求進 handler，等 waitUntil 的背景工作跑完，回傳 response
async function hit(mod, url, { method = "GET", headers = {}, env = ENV, cf } = {}) {
  const req = new Request(url, { method, headers: { "user-agent": UA, ...headers } });
  if (cf) Object.defineProperty(req, "cf", { value: cf });
  const pending = [];
  const res = await mod.onRequest({ request: req, env, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return res;
}

const BASE = "https://teddy-house.tw/go/line";
const ipHeader = ip => ({ "cf-connecting-ip": ip });
const lastText = () => tgCalls[tgCalls.length - 1]?.body?.text ?? "";

test("一律 302 到寫死的 LINE 網址，並帶安全標頭", async () => {
  const mod = await loadLine();
  const res = await hit(mod, `${BASE}?src=float`, { headers: ipHeader("1.1.1.1") });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), LINE_URL);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("Host 被偽造成別的網域，轉址目的地也不變", async () => {
  const mod = await loadLine();
  const res = await hit(mod, "https://evil.example/go/line?src=float&p=x", { headers: ipHeader("1.1.1.2") });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), LINE_URL);
});

test("正常的 p（文章 slug）會出現在 TG 通知", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post-end&p=sell-guide-taichung-2026`, { headers: ipHeader("2.2.2.1") });
  assert.equal(tgCalls.length, 1);
  assert.match(lastText(), /sell-guide-taichung-2026/);
  assert.match(lastText(), /文章文末 CTA/);
});

test("所有合法的站內路徑寫法都放行（含斜線、底線、減號、100 字上限）", async () => {
  const mod = await loadLine();
  const ok = ["community-liyuandao", "posts/2026-05-W07-taichung-market-pillar", "/areas/xitun/", "a_b-c/d", "a".repeat(100)];
  let n = 0;
  for (const p of ok) {
    n += 1;
    await hit(mod, `${BASE}?src=post&p=${encodeURIComponent(p)}`, { headers: ipHeader(`3.3.3.${n}`) });
    assert.ok(lastText().includes(p), `應放行：${p}`);
  }
});

// 各種「換個寫法塞東西」的 p：全部都不能進 TG 通知
const EVIL_P = [
  "<b>hi</b>",
  "<script>alert(1)</script>",
  "https://evil.example/phish",
  "evil.example/phish",
  "evil.example",
  "javascript:alert(1)",
  "tg://resolve?domain=someone",
  "a b",
  "a\tb",
  "x\nhttps://evil.example",
  "x\r\nhttps://evil.example",
  "x\u0000y",
  "@everyone",
  "ａｂｃ", // 全形英文
  "中文標籤",
  "a;b",
  "a?b=c",
  "a#b",
  "a%b",
  "..\\..\\etc",
  "a‮b", // RTL 覆寫字元
  "a​b", // 零寬空白
  "a".repeat(101), // 超過 100 字
  "a".repeat(5000),
  "%3Cb%3Ex%3C/b%3E", // 已被 URLSearchParams 解過一次的 %3C → 變成 <b>
  "%253Cb%253E", // 雙重編碼 → 解一次剩 %3Cb%3E，含 % → 拒絕
  "`code`",
  "[link](https://evil.example)",
  "{{7*7}}",
  "$(whoami)",
  "",
];

test("惡意／奇怪的 p 一律不會出現在 TG 通知（改顯示『未帶或無法辨識』）", async () => {
  let n = 0;
  for (const bad of EVIL_P) {
    n += 1;
    tgCalls = [];
    const mod = await loadLine(); // 每個案例一份全新模組，避免撞到 isolate 總量上限
    const u = new URL(BASE);
    u.searchParams.set("src", "post");
    u.searchParams.set("p", bad);
    await hit(mod, u.href, { headers: ipHeader(`4.4.${Math.floor(n / 200)}.${n % 200}`) });
    assert.equal(tgCalls.length, 1, `應照常通知一次：${JSON.stringify(bad).slice(0, 40)}`);
    const text = lastText();
    if (bad.trim()) {
      assert.ok(!text.includes(bad.trim()), `不該洩漏：${JSON.stringify(bad).slice(0, 60)}`);
    }
    assert.match(text, /未帶或無法辨識/);
    assert.ok(!/evil\.example/.test(text));
  }
});

test("p 以 URL 原始雙重編碼送進來，也進不了 TG", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post&p=%253Cscript%253E`, { headers: ipHeader("5.5.5.1") });
  assert.ok(!lastText().includes("script"));
  await hit(mod, `${BASE}?src=post&p=%2e%2e%2f%2e%2e%2fetc`, { headers: ipHeader("5.5.5.2") });
  assert.ok(!lastText().includes("etc"));
});

test("重複的 p 參數：只看第一個；第一個不合格就整個丟掉", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post&p=good-slug&p=${encodeURIComponent("<evil>")}`, { headers: ipHeader("6.6.6.1") });
  assert.match(lastText(), /good-slug/);
  assert.ok(!lastText().includes("evil"));
  await hit(mod, `${BASE}?src=post&p=${encodeURIComponent("<evil>")}&p=good-slug`, { headers: ipHeader("6.6.6.2") });
  assert.ok(!lastText().includes("evil"));
  assert.ok(!lastText().includes("good-slug"));
  assert.match(lastText(), /未帶或無法辨識/);
});

test("p[]、P（大小寫不同的參數名）都不會被當成 p", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post&p[]=sneaky&P=sneaky2`, { headers: ipHeader("6.7.7.1") });
  assert.ok(!lastText().includes("sneaky"));
});

test("Referer：合法站內路徑會用，含點／百分號／非 ASCII 的一律丟掉", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post`, { headers: { ...ipHeader("7.7.7.1"), referer: "https://teddy-house.tw/posts/abc-def/" } });
  assert.match(lastText(), /\/posts\/abc-def\//);

  const evilReferers = [
    "https://teddy-house.tw/evil.example/phish",
    "https://teddy-house.tw/%E4%B8%AD%E6%96%87",
    "https://teddy-house.tw/a%0Ab",
    "https://teddy-house.tw/<script>",
    "not a url at all https://evil.example",
    "javascript:alert(1)",
    "https://teddy-house.tw/" + "a".repeat(300),
  ];
  let n = 0;
  for (const r of evilReferers) {
    n += 1;
    await hit(mod, `${BASE}?src=post`, { headers: { ...ipHeader(`7.7.8.${n}`), referer: r } });
    assert.match(lastText(), /未帶或無法辨識/, `Referer 應被丟掉：${r.slice(0, 40)}`);
    assert.ok(!/evil\.example|phish|script/.test(lastText()));
  }
});

test("p 不合格時退回看 Referer（Referer 也要合格）", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post&p=${encodeURIComponent("<x>")}`, {
    headers: { ...ipHeader("7.9.9.1"), referer: "https://teddy-house.tw/areas/xitun/" },
  });
  assert.match(lastText(), /\/areas\/xitun\//);
});

test("src 只留英數底線減號；輸出一律 HTML 跳脫", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=${encodeURIComponent("<b>x</b>&evil")}`, { headers: ipHeader("8.8.8.1") });
  assert.ok(!lastText().includes("<b>x"));
  assert.ok(!lastText().includes("&evil"));
  await hit(mod, `${BASE}?src=float`, { headers: ipHeader("8.8.8.2"), cf: { country: "<i>JP</i>" } });
  assert.match(lastText(), /&lt;i&gt;JP&lt;\/i&gt;/);
  assert.ok(!lastText().includes("<i>JP"));
});

test("X-Forwarded-For 偽造：同一個 Cf-Connecting-Ip 換 XFF 仍然被節流", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=float`, { headers: { ...ipHeader("9.9.9.9"), "x-forwarded-for": "10.0.0.1" } });
  await hit(mod, `${BASE}?src=float`, { headers: { ...ipHeader("9.9.9.9"), "x-forwarded-for": "10.0.0.2" } });
  await hit(mod, `${BASE}?src=float`, { headers: { ...ipHeader("9.9.9.9"), "x-forwarded-for": "10.0.0.3, 10.0.0.4" } });
  assert.equal(tgCalls.length, 1);
});

test("沒有 Cf-Connecting-Ip 時輪換 X-Forwarded-For 無法繞過節流（全部歸同一桶）", async () => {
  const mod = await loadLine();
  for (let i = 0; i < 20; i++) {
    await hit(mod, `${BASE}?src=float`, { headers: { "x-forwarded-for": `10.1.0.${i}`, "x-real-ip": `10.2.0.${i}`, "true-client-ip": `10.3.0.${i}` } });
  }
  assert.equal(tgCalls.length, 1);
});

test("Cf-Connecting-Ip 內容怪怪的（不是 IP 格式）→ 當成沒有，不能拿來塞記憶體或繞過", async () => {
  const mod = await loadLine();
  for (const bad of ["<script>", "a".repeat(200), "1.2.3.4, 5.6.7.8", "not-an-ip!", ""]) {
    await hit(mod, `${BASE}?src=float`, { headers: ipHeader(bad) });
  }
  assert.equal(tgCalls.length, 1);
});

test("不同的真實 IP 各自推一次；同 IP 5 分鐘內第二次不推", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=float`, { headers: ipHeader("11.0.0.1") });
  await hit(mod, `${BASE}?src=float`, { headers: ipHeader("11.0.0.2") });
  await hit(mod, `${BASE}?src=float`, { headers: ipHeader("11.0.0.1") });
  assert.equal(tgCalls.length, 2);
});

test("IPv6 的 Cf-Connecting-Ip 正常運作", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=float`, { headers: ipHeader("2001:db8::1") });
  await hit(mod, `${BASE}?src=float`, { headers: ipHeader("2001:db8::2") });
  assert.equal(tgCalls.length, 2);
});

test("整個 isolate 每 5 分鐘最多推 GLOBAL_MAX_NOTIFY（30）則，超過的只轉址不通知", async () => {
  const mod = await loadLine();
  let redirected = 0;
  for (let i = 1; i <= 60; i++) {
    const res = await hit(mod, `${BASE}?src=float`, { headers: ipHeader(`12.0.${Math.floor(i / 250)}.${i % 250}`) });
    if (res.status === 302 && res.headers.get("location") === LINE_URL) redirected += 1;
  }
  assert.equal(redirected, 60, "每一次都要成功轉址");
  assert.equal(tgCalls.length, 30);
});

test("只有 GET 會通知：POST／HEAD／OPTIONS／DELETE 與方法覆寫標頭都只轉址", async () => {
  const mod = await loadLine();
  let n = 0;
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    n += 1;
    const res = await hit(mod, `${BASE}?src=float&p=abc`, { method, headers: ipHeader(`13.0.0.${n}`) });
    assert.equal(res.status, 302, method);
    assert.equal(res.headers.get("location"), LINE_URL, method);
  }
  for (const h of ["x-http-method-override", "x-method-override", "x-http-method"]) {
    n += 1;
    await hit(mod, `${BASE}?src=float&p=abc`, { method: "POST", headers: { ...ipHeader(`13.0.1.${n}`), [h]: "GET" } });
  }
  assert.equal(tgCalls.length, 0);
  // 反過來：GET 帶 override=POST 也照常（我們不讀這些標頭）
  await hit(mod, `${BASE}?src=float&p=abc`, { headers: { ...ipHeader("13.0.2.1"), "x-http-method-override": "POST" } });
  assert.equal(tgCalls.length, 1);
});

test("爬蟲 UA 不通知（既有行為不變）", async () => {
  const mod = await loadLine();
  const res = await hit(mod, `${BASE}?src=float`, { headers: { ...ipHeader("14.0.0.1"), "user-agent": "Googlebot/2.1" } });
  assert.equal(res.status, 302);
  assert.equal(tgCalls.length, 0);
});

test("沒設 TG 環境變數：只轉址、不打 fetch", async () => {
  const mod = await loadLine();
  const res = await hit(mod, `${BASE}?src=float`, { headers: ipHeader("15.0.0.1"), env: {} });
  assert.equal(res.status, 302);
  assert.equal(tgCalls.length, 0);
});

test("TG 掛掉（fetch 丟錯）也一定轉址", async () => {
  const mod = await loadLine();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const res = await hit(mod, `${BASE}?src=float`, { headers: ipHeader("16.0.0.1") });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), LINE_URL);
});

// ───────────────────────── 驗證者回饋併入（2026-10-06）─────────────────────────
test("src：登錄過的代碼顯示中文名稱（既有行為不變）", async () => {
  const mod = await loadLine();
  await hit(mod, `${BASE}?src=post-end`, { headers: ipHeader("20.0.0.1") });
  assert.match(lastText(), /按鈕位置：文章文末 CTA/);
  await hit(mod, `${BASE}?src=property-bar`, { headers: ipHeader("20.0.0.2") });
  assert.match(lastText(), /按鈕位置：物件頁手機底部三鍵/);
  await hit(mod, `${BASE}`, { headers: ipHeader("20.0.0.3") });
  assert.match(lastText(), /按鈕位置：未標示\n/);
});

test("src：沒登錄的代碼一律不回顯（不能再用 ?src=自選文字 在景泰的 TG 塞字，例如假電話、催促語）", async () => {
  const mod = await loadLine();
  const attacks = ["0912345678", "call-now-0912345678", "urgent_reply_fast", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "float2", "Float", "post-end-x"];
  let n = 0;
  for (const a of attacks) {
    n += 1;
    await hit(mod, `${BASE}?src=${a}`, { headers: ipHeader(`21.0.0.${n}`) });
    assert.equal(tgCalls.length, n, `仍然要通知一次：${a}`);
    assert.ok(!lastText().includes(a), `不該把攻擊者的 src 原樣放進 TG：${a}`);
    assert.match(lastText(), /按鈕位置：未標示（代碼未登錄）/);
  }
});

test("src：Object 原型鏈上的名字（constructor／__proto__／toString…）不會讓通知消失，也不會顯示成函式", async () => {
  const names = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__lookupGetter__"];
  let n = 0;
  for (const name of names) {
    n += 1;
    tgCalls = [];
    const mod = await loadLine(); // 每個案例一份全新模組（不撞節流名額）
    const res = await hit(mod, `${BASE}?src=${name}`, { headers: ipHeader(`22.0.0.${n}`) });
    assert.equal(res.status, 302, name);
    assert.equal(res.headers.get("location"), LINE_URL, name);
    assert.equal(tgCalls.length, 1, `通知不能因為 ${name} 而靜默消失`);
    assert.match(lastText(), /按鈕位置：未標示（代碼未登錄）/, name);
    assert.ok(!/function|\[object/i.test(lastText()), `不該顯示成函式或物件：${name}`);
  }
});

test("src：未登錄的代碼只寫進 Worker log（console.warn），不進 TG", async () => {
  const mod = await loadLine();
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    await hit(mod, `${BASE}?src=brand-new-button`, { headers: ipHeader("23.0.0.1") });
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warns.some(w => w.includes("brand-new-button")), "景泰要能在 Worker log 看到沒登錄的代碼");
  assert.ok(!lastText().includes("brand-new-button"));
});

test("站上實際在用的每一個 /go/line?src=代碼都已登錄（不然 src 不回顯之後，TG 會看不出按鈕來源）", async () => {
  const { readFileSync, readdirSync, statSync, existsSync } = await import("node:fs");
  const root = path.resolve(import.meta.dirname, "../..");
  const files = [];
  (function walk(rel) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isFile()) return void files.push(rel);
    for (const n of readdirSync(abs)) if (n !== "node_modules") walk(rel + "/" + n);
  })("src");
  for (const f of ["public/js"]) {
    const abs = path.join(root, f);
    if (existsSync(abs)) for (const n of readdirSync(abs)) files.push(f + "/" + n);
  }
  const used = new Map(); // 代碼 → 第一個出現的檔案
  for (const f of files) {
    if (!/\.(astro|ts|js|mjs|md|mdx|html|json)$/.test(f)) continue;
    for (const m of readFileSync(path.join(root, f), "utf-8").matchAll(/\/go\/line\?src=([A-Za-z0-9_-]+)/g)) if (!used.has(m[1])) used.set(m[1], f);
  }
  assert.ok(used.size >= 30, `掃到的代碼太少（${used.size}），掃描有問題`);
  const mod = await loadLine();
  const missing = [...used].filter(([code]) => mod.srcLabel(code) === "未標示（代碼未登錄）").map(([c, f]) => `${c}（${f}）`);
  assert.deepEqual(missing, [], "這些代碼站上有在用、但 functions/go/line.ts 的 SRC_LABEL 沒登錄，請補上：\n" + missing.join("\n"));
});

test("純函式 srcLabel：已登錄／未登錄／空／原型鏈名稱", async () => {
  const mod = await loadLine();
  assert.equal(mod.srcLabel("float"), "右下角浮動按鈕");
  assert.equal(mod.srcLabel(""), "未標示");
  assert.equal(mod.srcLabel("nope"), "未標示（代碼未登錄）");
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(mod.srcLabel(k), "未標示（代碼未登錄）", k);
  }
});

test("純函式：cleanPageParam／pageFromReferer／clientKey", async () => {
  const mod = await loadLine();
  assert.equal(mod.cleanPageParam("  abc-def  "), "abc-def");
  assert.equal(mod.cleanPageParam(null), "");
  assert.equal(mod.cleanPageParam(undefined), "");
  assert.equal(mod.cleanPageParam("a.b"), "");
  assert.equal(mod.pageFromReferer(""), "");
  assert.equal(mod.pageFromReferer("https://x.example/posts/a-b/"), "/posts/a-b/");
  assert.equal(mod.pageFromReferer("https://x.example/a.b"), "");
  assert.equal(mod.clientKey(new Headers({ "cf-connecting-ip": "1.2.3.4" })), "1.2.3.4");
  assert.equal(mod.clientKey(new Headers({ "x-forwarded-for": "1.2.3.4" })), "no-ip");
  assert.equal(mod.clientKey(new Headers()), "no-ip");
});
