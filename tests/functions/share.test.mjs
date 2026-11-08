// /share/* 代理的資安測試（M-23）。離線：fetch 用假的、不連任何外網。
// 執行：node --test "tests/functions/*.test.mjs"
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// [[path]].ts 會 import "../../astro-paper.config"（Astro 的設定檔，Node 直接讀不了）。
// 這裡只在「測試行程內」把它換成一個只有 site.url 的假模組；不改原始碼、不影響建置。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/astro-paper\.config$/.test(specifier)) {
      return {
        url: 'data:text/javascript,export default {site:{url:"https://teddy-house.tw"}};',
        format: "module",
        shortCircuit: true,
      };
    }
    // functions/share/[[path]].ts 現在也 import src/lib/find/shareqa（沒有副檔名，打包器看得懂、Node 直接讀看不懂）：補 .ts
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

// 預設測「這個 worktree 的新版」；設 SEC_TEST_FUNCTIONS_DIR 可改測別的目錄（例如舊版，用來證明測試真的抓得到洞）
const FN_DIR = process.env.SEC_TEST_FUNCTIONS_DIR
  ? path.resolve(process.env.SEC_TEST_FUNCTIONS_DIR)
  : path.resolve(import.meta.dirname, "../../functions");
const mod = await import(pathToFileURL(path.join(FN_DIR, "share", "[[path]].ts")).href);
const { onRequest } = mod;
const HAS_RESOLVER = typeof mod.resolveSharePath === "function";

const UPSTREAM = "https://teddy-shares.pages.dev/";
const SITE = "https://teddy-house.tw";
// 三邊約定的 id 範例（字元集 A-Za-z0-9；A3 用 ascii_letters＋digits 隨機產生）
const A3_NEW_22 = "Ab3dEf6hJk8mNp2qRs4tUv"; // 22 碼
const A3_QS_24 = "qs" + A3_NEW_22; // 24 碼
// 找房小幫手代號的到期日（qa 後 4 碼，base36 天數，從 2026-01-01 起算）：原本寫死 008k＝2026-11-05，過了那天整支 handler 回 410、測試就紅。
// 改成「今天＋30 天」動態算；QA_PAST 是「昨天」（過期的對照組）。亂數段 26 碼只准 a-z 與 2-7（shareqa.ts 的 QA_RE）。
const QA_EPOCH_S = 1767225600; // 2026-01-01T00:00:00Z（跟 src/lib/find/shareqa.ts 的 QA_EPOCH_S 同值）
const qaDay = offsetDays => (Math.floor((Date.now() / 1000 - QA_EPOCH_S) / 86400) + offsetDays).toString(36).padStart(4, "0");
const QA_RAND_26 = "mn3x7q2pzrtavb5ncdetwoxy4k";
const AIF_QA_32 = "qa" + qaDay(30) + QA_RAND_26; // 32 碼（09 號設計文件的格式），30 天後才到期
const QA_PAST = "qa" + qaDay(-1) + QA_RAND_26; // 昨天到期
const PAGE_HTML = "<!doctype html><html><head><title>t</title></head><body><h1>推薦頁</h1></body></html>";
// 2026-11-08：teddy-shares 轉私人 repo 後代理改走 GitHub Contents API（唯讀 PAT 放 Cloudflare Pages secret SHARES_GH_TOKEN）
const API = "https://api.github.com/repos/sky811117/teddy-shares/contents/";
const RAW = "https://raw.githubusercontent.com/sky811117/teddy-shares/main/";
const TOKEN = "github_pat_TESTONLY00000000000000_" + "a".repeat(59); // 格式照 fine-grained PAT；假的
const ENV = { SHARES_GH_TOKEN: TOKEN };

let fetchCalls = [];
let fetchInits = [];
let upstreamImpl;
const realFetch = globalThis.fetch;

function htmlResponse(html = PAGE_HTML, status = 200, finalUrl = "") {
  const res = new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (finalUrl) Object.defineProperty(res, "url", { value: finalUrl });
  return res;
}

beforeEach(() => {
  fetchCalls = [];
  fetchInits = [];
  upstreamImpl = async () => htmlResponse();
  globalThis.fetch = async (url, init) => {
    fetchCalls.push(String(url));
    fetchInits.push(init || {});
    return upstreamImpl(String(url), init);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.caches;
});

// env／waitUntil 是 2026-11-08 起 handler 會看的（Cloudflare Pages 的環境變數與 waitUntil）；沒給＝沒 token，照舊走 Pages
async function get(urlOrPath, { method = "GET", headers = {}, env, waitUntil } = {}) {
  const url = urlOrPath.startsWith("http") ? urlOrPath : SITE + urlOrPath;
  const request = new Request(url, { method, headers });
  // 新版只看 request.url 的 pathname；params 是給「舊版」對照測試用的（舊版吃 params.path）。
  // 這裡用最壞情況：假設 Cloudflare 已把每一段 decode 過。
  const m = /^\/share(?:\/(.*))?$/i.exec(new URL(request.url).pathname);
  const rest = m && m[1] ? m[1] : "";
  let segs = rest ? rest.split("/") : [];
  try {
    segs = segs.map(s => decodeURIComponent(s));
  } catch {
    /* 無法 decode 就維持原樣 */
  }
  return onRequest({ request, params: { path: segs }, env, waitUntil });
}

function assertBaseHeaders(res, label = "") {
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `nosniff 缺：${label}`);
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN", `x-frame-options 缺：${label}`);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", `referrer-policy 缺：${label}`);
  assert.match(res.headers.get("x-robots-tag") || "", /noindex/, `x-robots-tag 缺：${label}`);
}

// ───────────────────────── 純函式：路徑解析 ─────────────────────────
const VALID = [
  ["/share/abc12345", "abc12345/"],
  ["/share/abc12345/", "abc12345/"],
  ["/share/AbC12345/", "AbC12345/"],
  ["/share/qsAbCd1234/", "qsAbCd1234/"],
  ["/share/abcd/", "abcd/"], // 4 碼下限
  ["/share/" + "a".repeat(40), "a".repeat(40) + "/"], // 40 碼上限
  // ── 三邊約定的 id 規格（A3 推薦頁服務／A4／找房小幫手）。上限若又改回 16，這幾條會立刻失敗 ──
  ["/share/" + A3_NEW_22 + "/", A3_NEW_22 + "/"], // A3 新頁：22 碼英數
  ["/share/" + A3_QS_24 + "/", A3_QS_24 + "/"], // A3 查詢台新路徑：qs＋22 碼 = 24 碼
  ["/share/" + AIF_QA_32 + "/", AIF_QA_32 + "/"], // 找房小幫手：qa＋4＋26 = 32 碼（全小寫）
  ["/share/" + A3_NEW_22 + "/index.html", A3_NEW_22 + "/"], // 2026-11-08：Cloudflare Pages 會把 /index.html 轉到目錄，白名單階段就正規化
  ["/share/abc12345/index.html", "abc12345/"],
  ["/share/abc12345/photo-1_a.JPG", "abc12345/photo-1_a.JPG"],
  ["/SHARE/abc12345/", "abc12345/"], // 路由不分大小寫時
  ["/Share/abc12345", "abc12345/"],
  ["/share/constructor", "constructor/"], // 只是一個合法 id 字元組合
];

const INVALID = [
  // 雙斜線／空段
  "/share//abc12345",
  "/share/abc12345//",
  "/share/abc12345//index.html",
  "/share///",
  "/share//",
  // 百分號編碼（任何形式）
  "/share/%2e%2e/etc/passwd",
  "/share/%2E%2E/",
  "/share/abc12345/%2e%2e/x",
  "/share/abc12345%2f..%2f",
  "/share/abc12345%2F",
  "/share/abc12345/%2e%2e%2fsecret",
  "/share/abc%2012345",
  "/share/%61bc12345",
  "/share/abc12345%5c..%5c",
  "/share/abc12345%00",
  "/share/abc12345%0d%0a",
  "/share/%252e%252e/",
  "/share/abc12345/index.html%00.png",
  "/share/abc12345/..%252f",
  "/share/%EF%BC%8E%EF%BC%8E/", // 全形句點編碼
  // 字面的點段／反斜線（正常 URL 解析會先處理掉，但函式本身也要擋）
  "/share/./abc12345",
  "/share/../abc12345",
  "/share/abc12345/..",
  "/share/abc12345/../x",
  "/share/abc12345/./index.html",
  "/share/abc12345\\..\\x",
  "/share\\abc12345",
  // 隱藏檔
  "/share/abc12345/.env",
  "/share/abc12345/.git",
  "/share/abc12345/.htaccess",
  // id 不合
  "/share/ab", // 太短
  "/share/abc", // 3 碼
  "/share/" + "a".repeat(41), // 太長（上限 40）
  "/share/" + AIF_QA_32 + "abcdefghi", // 41 碼
  "/share/abc-1234",
  "/share/abc_1234",
  "/share/" + A3_NEW_22.slice(0, 10) + "-" + A3_NEW_22.slice(11), // 長 id 夾一個減號：字元集仍然只有英數
  "/share/" + AIF_QA_32.slice(0, 10) + "_" + AIF_QA_32.slice(11),
  "/share/__proto__",
  "/share/abc12345.",
  "/share/abc.12345",
  "/share/中文id1234",
  "/share/ａｂｃ１２３４５", // 全形英數
  "/share/abc 12345",
  "/share/abc12345;x",
  "/share/abc12345:80",
  "/share/abc12345@evil.example",
  // 檔名不合
  "/share/abc12345/a/b.html", // 子目錄
  "/share/abc12345/assets", // 沒副檔名
  "/share/abc12345/x.php",
  "/share/abc12345/x.exe",
  "/share/abc12345/x.html.php",
  "/share/abc12345/x.php.png.php",
  "/share/abc12345/index.html/", // 檔名後面再加斜線
  "/share/abc12345/a..b.html",
  "/share/abc12345/index.html;.png",
  "/share/abc12345/index.html:stream",
  "/share/abc12345/ｉndex.html",
  "/share/abc12345/index.html ",
  "/share/abc12345/" + "a".repeat(70) + ".html",
  "/share/abc12345/x.",
  "/share/abc12345/.html",
  // 前綴不對
  "/shared/abc12345",
  "/sharex",
  "/xshare/abc12345",
  "/",
  "",
  // 太長
  "/share/" + "a".repeat(200),
];

test("resolveSharePath：合法路徑對應到正確的上游路徑", { skip: !HAS_RESOLVER && "舊版沒有這個函式" }, () => {
  for (const [input, upstreamPath] of VALID) {
    const r = mod.resolveSharePath(input);
    assert.equal(r.kind, "page", `應放行：${input}（${JSON.stringify(r)}）`);
    assert.equal(r.upstreamPath, upstreamPath, input);
  }
});

test("resolveSharePath：/share 與 /share/ 是 index（導去在售物件頁）", { skip: !HAS_RESOLVER && "舊版沒有這個函式" }, () => {
  assert.equal(mod.resolveSharePath("/share").kind, "index");
  assert.equal(mod.resolveSharePath("/share/").kind, "index");
  assert.equal(mod.resolveSharePath("/SHARE/").kind, "index");
});

test("resolveSharePath：各種繞過寫法一律 reject", { skip: !HAS_RESOLVER && "舊版沒有這個函式" }, () => {
  for (const input of INVALID) {
    const r = mod.resolveSharePath(input);
    assert.equal(r.kind, "reject", `應拒絕：${JSON.stringify(input)} → ${JSON.stringify(r)}`);
  }
});

test("resolveSharePath：非字串輸入也不會炸", { skip: !HAS_RESOLVER && "舊版沒有這個函式" }, () => {
  for (const bad of [undefined, null, 123, {}, []]) {
    assert.equal(mod.resolveSharePath(bad).kind, "reject");
  }
});

// ───────────────────────── 整支 handler ─────────────────────────
test("合法推薦頁：只打上游一次、網址完全是白名單組出來的", async () => {
  const res = await get("/share/abc12345/");
  assert.equal(res.status, 200);
  assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/"]);
  const html = await res.text();
  assert.match(html, /推薦頁/);
  assert.match(html, /noindex/); // 注入的 meta
  assert.match(html, /想看更多好屋/); // 注入的回官網區塊
  assert.match(html, /G-WMQCYK4L88/); // GA4
  assertBaseHeaders(res, "html");
  assert.match(res.headers.get("content-type"), /text\/html/);
});

test("沒有尾斜線也一樣（/share/{id}）", async () => {
  await get("/share/abc12345");
  assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/"]);
});

test("/share、/share/ → 302 相對路徑 /properties/，不吃 Host 標頭，也不打上游", async () => {
  for (const u of ["/share", "/share/", "https://evil.example/share/", "https://evil.example/share"]) {
    const res = await get(u);
    assert.equal(res.status, 302, u);
    assert.equal(res.headers.get("location"), "/properties/", u);
    assertBaseHeaders(res, "redirect");
  }
  assert.equal(fetchCalls.length, 0);
});

test("不合白名單的路徑 → 404，而且完全不打上游", async () => {
  // 這些是『真的會被送進 handler 的 URL』（先經過 URL 解析，再經過白名單）
  const urls = [
    "/share//abc12345",
    "/share/abc12345//",
    "/share/abc12345//index.html",
    "/share/abc12345%2f..%2f..%2fother-repo%2f",
    "/share/abc12345/%2e%2e%2f%2e%2e%2fsecrets",
    "/share/abc12345%5c..%5c..%5cx",
    "/share/abc12345/%252e%252e/",
    "/share/abc12345/..%2f..%2f",
    "/share/abc%00",
    "/share/abc12345/%00.html",
    "/share/abc12345/.env",
    "/share/abc12345/.git/config",
    "/share/abc12345/sub/dir/x.html",
    "/share/abc12345/x.php",
    "/share/ab",
    "/share/abc-12345",
    "/share/abc12345;jsessionid=1",
    "/share/" + "a".repeat(200),
    "/share/%E4%B8%AD%E6%96%87/",
  ];
  for (const u of urls) {
    const res = await get(u);
    assert.equal(res.status, 404, `應 404：${u}`);
    assertBaseHeaders(res, u);
  }
  assert.equal(fetchCalls.length, 0, `不該打上游：${fetchCalls.join(",")}`);
});

test("..、%2e%2e、反斜線在 URL 解析階段就被收掉：若跑出 /share 之外就不是這支 Function 的事，跑在 /share 之內也只會是合法 id", async () => {
  // URL 解析後 pathname 會變成：/other、/share/zzzz9999/ 等。確認「不管變成什麼」都只會打上游的白名單網址。
  const tries = [
    "https://teddy-house.tw/share/abc12345/../../other",
    "https://teddy-house.tw/share/abc12345/%2e%2e/%2e%2e/other",
    "https://teddy-house.tw/share/abc12345\\..\\..\\other",
    "https://teddy-house.tw/share/abc12345/../zzzz9999/",
    "https://teddy-house.tw/share/./abc12345/",
  ];
  for (const u of tries) {
    fetchCalls = [];
    const res = await get(u);
    assert.ok([200, 404].includes(res.status), `${u} → ${res.status}`);
    for (const c of fetchCalls) {
      assert.match(c, /^https:\/\/(?:teddy-shares\.pages\.dev|raw\.githubusercontent\.com\/sky811117\/teddy-shares\/main)\/[A-Za-z0-9]{4,40}\/(index\.html)?$/, c);
    }
  }
});

test("標頭偽造（X-Original-URL／X-Rewrite-URL／X-Forwarded-Host／X-Forwarded-Prefix／Host 類）不影響上游網址", async () => {
  const res = await get("/share/abc12345/", {
    headers: {
      "x-original-url": "/share/zzzz9999/../../other",
      "x-rewrite-url": "/other-repo/",
      "x-forwarded-host": "evil.example",
      "x-forwarded-prefix": "/..",
      "x-forwarded-for": "6.6.6.6",
      "x-http-method-override": "DELETE",
      forwarded: "host=evil.example",
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/"]);
});

test("query string 不會被轉送到上游", async () => {
  await get("/share/abc12345/?next=https://evil.example&x=1#frag");
  assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/"]);
});

test("只收 GET／HEAD；其他方法（含方法覆寫標頭）→ 405，不打上游", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const res = await get("/share/abc12345/", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD", method);
    assertBaseHeaders(res, method);
  }
  const ov = await get("/share/abc12345/", { method: "POST", headers: { "x-http-method-override": "GET" } });
  assert.equal(ov.status, 405);
  assert.equal(fetchCalls.length, 0);
  const head = await get("/share/abc12345/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(fetchCalls.length, 1);
});

test("非 HTML（圖片／CSS）：content-type 照傳，帶 nosniff 與 CSP sandbox", async () => {
  upstreamImpl = async () => new Response("PNGDATA", { status: 200, headers: { "content-type": "image/png" } });
  const res = await get("/share/abc12345/cover.png");
  assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/cover.png"]);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assertBaseHeaders(res, "png");
  assert.match(res.headers.get("content-security-policy") || "", /sandbox/);
  assert.equal(await res.text(), "PNGDATA");

  upstreamImpl = async () => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } });
  const svg = await get("/share/abc12345/icon.svg");
  assertBaseHeaders(svg, "svg");
  assert.match(svg.headers.get("content-security-policy") || "", /default-src 'none'/);

  upstreamImpl = async () => new Response("x", { status: 200 });
  const noct = await get("/share/abc12345/data.json");
  assertBaseHeaders(noct, "no content-type");
});

test("上游被導去別的主機／別的 repo（最終網址不在 teddy-shares 底下）→ 502", async () => {
  const bad = [
    "https://evil.example/x",
    "https://other-project.pages.dev/abc12345/",
    "https://teddy-shares-evil.pages.dev/abc12345/",
    "https://teddy-shares.pages.dev.evil.example/abc12345/",
    "http://teddy-shares.pages.dev/abc12345/",
    "https://sky811117.github.io/teddy-shares/abc12345/",
    "not a url",
  ];
  for (const finalUrl of bad) {
    upstreamImpl = async () => htmlResponse(PAGE_HTML, 200, finalUrl);
    const res = await get("/share/abc12345/");
    assert.equal(res.status, 502, finalUrl);
    assertBaseHeaders(res, "502 " + finalUrl);
    assert.ok(!(await res.text()).includes("推薦頁"));
  }
  upstreamImpl = async () => htmlResponse(PAGE_HTML, 200, UPSTREAM + "abc12345/");
  assert.equal((await get("/share/abc12345/")).status, 200);
});

test("上游連線失敗 → 502 且仍帶 nosniff 等標頭", async () => {
  upstreamImpl = async () => {
    throw new Error("boom");
  };
  const res = await get("/share/abc12345/");
  assert.equal(res.status, 502);
  assertBaseHeaders(res, "502");
});

test("上游 404 的 HTML 照舊處理（狀態碼照傳）", async () => {
  upstreamImpl = async () => htmlResponse("<html><head></head><body>nope</body></html>", 404);
  const res = await get("/share/abc12345/");
  assert.equal(res.status, 404);
  assertBaseHeaders(res, "upstream 404");
});

test("白牌頁面（x-share-promo=off）不注入『認識景泰』區塊（既有行為不變）", async () => {
  upstreamImpl = async () =>
    htmlResponse('<html><head><meta name="x-share-promo" content="off"></head><body>x</body></html>');
  const res = await get("/share/abc12345/");
  const html = await res.text();
  assert.ok(!html.includes("想看更多好屋"));
});

test("每一種回應都帶四個基本安全標頭（彙總）", async () => {
  const cases = [
    ["/share/abc12345/", {}],
    ["/share/", {}],
    ["/share/abc12345//", {}],
    ["/share/abc12345/", { method: "POST" }],
  ];
  for (const [u, opts] of cases) assertBaseHeaders(await get(u, opts), u);
});

// ───────────────────────── 驗證者回饋併入（2026-10-06）─────────────────────────
test("id 規格（與 A3、找房小幫手約定）：22／24／32 碼新頁 id 整支 handler 都要 200，不可被擋成 404", async () => {
  for (const id of [A3_NEW_22, A3_QS_24, AIF_QA_32, "q2uGHkWF", "qsAbCd1234", "a".repeat(40)]) {
    fetchCalls = [];
    const res = await get("/share/" + id + "/");
    assert.equal(res.status, 200, `id=${id}（${id.length} 碼）被擋成 ${res.status}`);
    assert.deepEqual(fetchCalls, [UPSTREAM + id + "/"], id);
  }
});

test("id 規格：41 碼、含減號／底線／點的 id 一律 404 且不打上游（放寬上限沒有放寬字元集）", async () => {
  for (const id of ["a".repeat(41), A3_NEW_22 + "-x", A3_NEW_22 + "_x", A3_NEW_22 + ".x", "ab-" + A3_NEW_22]) {
    const res = await get("/share/" + id + "/");
    assert.equal(res.status, 404, id);
  }
  assert.equal(fetchCalls.length, 0);
});

test("SHARE_ID_RE 就是三邊約定的那一條（^[A-Za-z0-9]{4,40}$）", { skip: !mod.SHARE_ID_RE && "舊版沒有匯出" }, () => {
  assert.equal(mod.SHARE_ID_RE.source, "^[A-Za-z0-9]{4,40}$");
});

test("resolveSharePath：含 % 的路徑被『百分號那一關』擋下（雙保險，不只靠後面的字元檢查）", { skip: !HAS_RESOLVER && "舊版沒有這個函式" }, () => {
  for (const input of ["/share/abc12345%2f", "/share/abc12345/%2e%2e", "/share/abc%2012345", "/share/%61bc12345/index.html"]) {
    const r = mod.resolveSharePath(input);
    assert.equal(r.kind, "reject", input);
    assert.equal(r.reason, "percent-encoding", `${input} 應由 percent-encoding 這一關擋掉（reason=${r.reason}）`);
  }
});

test("不跟隨上游轉址：fetch 帶 redirect:'manual'", async () => {
  let seenInit;
  upstreamImpl = async (_url, init) => {
    seenInit = init;
    return htmlResponse();
  };
  await get("/share/abc12345/");
  assert.equal(seenInit?.redirect, "manual", "必須 redirect:'manual'，不然上游 url 為空字串時最終網址檢查會放行");
});

test("上游回 301／302／303／307／308 → 502，不跟過去、不轉出去（就算 Location 指向官網自己）", async () => {
  for (const code of [301, 302, 303, 307, 308]) {
    fetchCalls = [];
    upstreamImpl = async () => {
      const r = new Response("moved", { status: code, headers: { location: "https://evil.example/phish", "content-type": "text/html" } });
      Object.defineProperty(r, "url", { value: "" }); // 驗證者的情境：url 為空字串
      return r;
    };
    const res = await get("/share/abc12345/");
    assert.equal(res.status, 502, String(code));
    assert.equal(res.headers.get("location"), null, `不可帶 Location：${code}`);
    assertBaseHeaders(res, "redirect " + code);
    assert.equal(fetchCalls.length, 1, "只打一次上游，不跟過去");
    assert.ok(!(await res.text()).includes("moved"));
  }
});

test("opaqueredirect 型別的回應（瀏覽器式 manual）也是 502", async () => {
  upstreamImpl = async () => {
    const r = new Response(null, { status: 200 });
    Object.defineProperty(r, "type", { value: "opaqueredirect" });
    return r;
  };
  assert.equal((await get("/share/abc12345/")).status, 502);
});

test("上游 url 為空字串、但狀態是正常 200 → 仍可正常使用（不能因為 fail-closed 把整站推薦頁弄壞）", async () => {
  upstreamImpl = async () => {
    const r = new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(r, "url", { value: "" });
    return r;
  };
  assert.equal((await get("/share/abc12345/")).status, 200);
});

test("上游 404／500／503 不被當成轉址：照原狀態碼回（既有行為不變）", async () => {
  for (const code of [404, 500, 503]) {
    upstreamImpl = async () => htmlResponse("<html><head></head><body>x</body></html>", code);
    assert.equal((await get("/share/abc12345/")).status, code);
  }
});

// ───────────────────────── 2026-11-08：teddy-shares 轉私人 repo，改走 GitHub Contents API ─────────────────────────
// 沒有 token 的所有測試（上面整支檔）必須完全不受影響：repo 還公開的過渡期、或 secret 沒設時，照舊走 Pages／raw。
const rawResponse = (body, extra = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      // 實測 GitHub 的回應：content-type 一律這個、Cache-Control private、ETag 是 blob 雜湊、另帶 Vary: Authorization
      "content-type": "application/vnd.github.raw+json; charset=utf-8",
      "cache-control": "private, max-age=60, s-maxage=60",
      vary: "Accept, Authorization, Cookie, X-GitHub-OTP",
      etag: '"6e9d60ab5a0951fa3c2bda666963531c9dfa77ee"',
      ...extra,
    },
  });
const apiJson = (status, body = '{"message":"Not Found"}') => new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });
const noTokenAnywhere = async res => {
  for (const [, v] of res.headers) assert.ok(!v.includes(TOKEN), "標頭不可含 token");
  const text = await res.clone().text();
  assert.ok(!text.includes(TOKEN) && !text.includes("github_pat_"), "本文不可含 token");
};

test("有 token：頁面本體只打 Contents API（{id}/index.html?ref=main）、帶 Bearer／raw 媒體型別／UA、不帶 cf 快取、不碰 github.io；回應照常注入、快取 5 分鐘、x-share-source=api", async () => {
  upstreamImpl = async url => (url.startsWith(API) ? rawResponse(PAGE_HTML) : htmlResponse("<html><body>不該走到 Pages</body></html>"));
  for (const p of ["/share/abc12345/", "/share/abc12345", "/share/" + A3_NEW_22 + "/", "/share/" + A3_QS_24, "/share/" + AIF_QA_32 + "/"]) {
    fetchCalls = [];
    fetchInits = [];
    const res = await get(p, { env: ENV });
    assert.equal(res.status, 200, p);
    const id = p.split("/")[2];
    assert.deepEqual(fetchCalls, [API + id + "/index.html?ref=main"], p);
    const h = fetchInits[0].headers;
    assert.equal(h.authorization, "Bearer " + TOKEN);
    assert.equal(h.accept, "application/vnd.github.raw+json");
    assert.equal(h["x-github-api-version"], "2022-11-28");
    assert.ok(h["user-agent"], "GitHub API 一定要有 User-Agent");
    assert.equal(fetchInits[0].redirect, "manual");
    assert.ok(!("cf" in fetchInits[0]), "帶 Authorization 的請求不用 cf 快取（Cloudflare 不會快取、也不該快取）");
    const html = await res.clone().text();
    assert.match(html, /推薦頁/);
    assert.match(html, /noindex/);
    assert.match(html, /想看更多好屋/);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(res.headers.get("x-share-source"), "api");
    assert.equal(res.headers.get("content-security-policy"), mod.SHARE_HTML_CSP);
    assert.equal(res.headers.get("etag"), null, "HTML 本文有注入、跟上游不同，不給 ETag");
    assertBaseHeaders(res, "api html " + p);
    await noTokenAnywhere(res);
    if (p.includes(AIF_QA_32)) {
      assert.equal(res.headers.get("cache-control"), "private, max-age=0, no-store", "qa 頁照舊不快取");
      assert.ok(!html.includes("G-WMQCYK4L88"), "qa 頁照舊不注入分析");
    } else {
      assert.equal(res.headers.get("cache-control"), "public, max-age=300", "API 路線快取 5 分鐘");
      assert.match(html, /G-WMQCYK4L88/);
    }
  }
  // 上游的 private／Vary 標頭不轉出去
  const res = await get("/share/abc12345/", { env: ENV });
  assert.equal(res.headers.get("vary"), null);
  assert.ok(!/private/.test(res.headers.get("cache-control")));
});

test("有 token：資源檔的 content-type 依副檔名自己設（API 給的一律是 application/vnd.github.raw+json）、ETag 照傳、快取 5 分鐘、沙箱 CSP", async () => {
  upstreamImpl = async () => rawResponse("PNGDATA", { etag: '"blob-sha-1"' });
  const res = await get("/share/abc12345/cover.png", { env: ENV });
  assert.deepEqual(fetchCalls, [API + "abc12345/cover.png?ref=main"]);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("etag"), '"blob-sha-1"');
  assert.equal(res.headers.get("cache-control"), "public, max-age=300");
  assert.match(res.headers.get("content-security-policy") || "", /sandbox/);
  assert.equal(res.headers.get("x-share-source"), "api");
  assertBaseHeaders(res, "api png");
  assert.equal(await res.text(), "PNGDATA");
  const cases = [
    ["a.jpg", "image/jpeg"], ["a.JPG", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.webp", "image/webp"], ["a.gif", "image/gif"], ["a.svg", "image/svg+xml"], ["a.ico", "image/x-icon"],
    ["a.css", "text/css; charset=utf-8"], ["a.js", "text/javascript; charset=utf-8"], ["a.json", "application/json; charset=utf-8"], ["a.txt", "text/plain; charset=utf-8"],
    ["a.woff", "font/woff"], ["a.woff2", "font/woff2"],
  ];
  for (const [file, ct] of cases) {
    const r = await get("/share/abc12345/" + file, { env: ENV });
    assert.equal(r.status, 200, file);
    assert.equal(r.headers.get("content-type"), ct, file);
    assertBaseHeaders(r, file);
  }
});

test("有 token：If-None-Match 對得上 ETag（含 W/ 弱標記、多個值）→ 304 不帶本文；對不上 → 200", async () => {
  upstreamImpl = async () => rawResponse("PNGDATA", { etag: '"blob-sha-1"' });
  const r304 = await get("/share/abc12345/cover.png", { env: ENV, headers: { "if-none-match": '"blob-sha-1"' } });
  assert.equal(r304.status, 304);
  assert.equal(await r304.text(), "");
  assert.equal(r304.headers.get("etag"), '"blob-sha-1"');
  assert.equal(r304.headers.get("cache-control"), "public, max-age=300");
  assertBaseHeaders(r304, "304");
  assert.equal((await get("/share/abc12345/cover.png", { env: ENV, headers: { "if-none-match": 'W/"blob-sha-1", "other"' } })).status, 304);
  assert.equal((await get("/share/abc12345/cover.png", { env: ENV, headers: { "if-none-match": "*" } })).status, 304);
  assert.equal((await get("/share/abc12345/cover.png", { env: ENV, headers: { "if-none-match": '"different"' } })).status, 200);
  // 純函式
  assert.equal(mod.etagMatches('"a"', '"a"'), true);
  assert.equal(mod.etagMatches('W/"a"', '"a"'), true);
  assert.equal(mod.etagMatches('"b", "a"', '"a"'), true);
  assert.equal(mod.etagMatches('"b"', '"a"'), false);
  assert.equal(mod.etagMatches(null, '"a"'), false);
  assert.equal(mod.etagMatches('"a"', ""), false);
});

test("有 token：API 404 → 再試 Pages／raw（token 權限沒設對時 GitHub 也回 404；repo 還公開的過渡期頁面不能壞）；三邊都 404 → 404", async () => {
  upstreamImpl = async url => (url.startsWith(API) ? apiJson(404) : htmlResponse());
  let res = await get("/share/abc12345/", { env: ENV });
  assert.equal(res.status, 200);
  assert.deepEqual(fetchCalls, [API + "abc12345/index.html?ref=main", UPSTREAM + "abc12345/"]);
  assert.equal(res.headers.get("x-share-source"), "pages");
  assert.equal(res.headers.get("cache-control"), "public, max-age=30", "舊路維持 30 秒");
  assert.match(await res.text(), /推薦頁/);
  // Pages 404 → raw 200
  fetchCalls = [];
  upstreamImpl = async url => (url.startsWith(API) ? apiJson(404) : url.startsWith(RAW) ? new Response(PAGE_HTML, { headers: { "content-type": "text/plain" } }) : htmlResponse("nope", 404));
  res = await get("/share/abc12345/", { env: ENV });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-share-source"), "raw");
  assert.deepEqual(fetchCalls, [API + "abc12345/index.html?ref=main", UPSTREAM + "abc12345/", RAW + "abc12345/index.html"]);
  // 全部 404
  fetchCalls = [];
  upstreamImpl = async url => (url.startsWith(API) ? apiJson(404) : htmlResponse("<html><head></head><body>nope</body></html>", 404));
  res = await get("/share/abc12345/", { env: ENV });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "private, max-age=0, no-store");
  assert.deepEqual(fetchCalls, [API + "abc12345/index.html?ref=main", UPSTREAM + "abc12345/", RAW + "abc12345/index.html"]);
  assertBaseHeaders(res, "all 404");
  // 資源檔：API 404 → Pages 404 就 404（不試 raw）
  fetchCalls = [];
  upstreamImpl = async url => (url.startsWith(API) ? apiJson(404) : new Response("nope", { status: 404, headers: { "content-type": "text/plain" } }));
  res = await get("/share/abc12345/cover.png", { env: ENV });
  assert.equal(res.status, 404);
  assert.deepEqual(fetchCalls, [API + "abc12345/cover.png?ref=main", UPSTREAM + "abc12345/cover.png"]);
});

test("有 token：API 出錯（403 限流／401／5xx／3xx／連不上／回目錄清單／太大）→ 走舊路；舊路 200 就用，舊路拿不到 → 502（不說成 404）", async () => {
  const errors = [
    ["403 限流", () => apiJson(403, '{"message":"API rate limit exceeded"}')],
    ["401", () => apiJson(401, '{"message":"Bad credentials"}')],
    ["502", () => new Response("", { status: 502 })],
    ["301", () => new Response("", { status: 301, headers: { location: "https://evil.example/" } })],
    ["連不上", () => { throw new Error("boom"); }],
    ["目錄清單", () => new Response("[]", { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })],
    ["太大", () => rawResponse("x", { "content-length": "99999999999" })],
  ];
  for (const [label, apiImpl] of errors) {
    fetchCalls = [];
    upstreamImpl = async url => (url.startsWith(API) ? apiImpl() : htmlResponse());
    const ok = await get("/share/abc12345/", { env: ENV });
    assert.equal(ok.status, 200, `${label}：舊路 200 要照用`);
    assert.equal(ok.headers.get("x-share-source"), "pages", label);
    assert.deepEqual(fetchCalls, [API + "abc12345/index.html?ref=main", UPSTREAM + "abc12345/"], label);
    fetchCalls = [];
    upstreamImpl = async url => (url.startsWith(API) ? apiImpl() : htmlResponse("<html><head></head><body>nope</body></html>", 404));
    const bad = await get("/share/abc12345/", { env: ENV });
    assert.equal(bad.status, 502, `${label}：舊路 404 → 502`);
    assertBaseHeaders(bad, "502 " + label);
    await noTokenAnywhere(bad);
    assert.ok(!(await bad.text()).includes("nope"));
  }
  // 舊路本身失敗（連不上／轉址）照舊 502
  upstreamImpl = async url => (url.startsWith(API) ? apiJson(500) : new Response("moved", { status: 302, headers: { location: "https://evil.example/" } }));
  assert.equal((await get("/share/abc12345/", { env: ENV })).status, 502);
});

test("token 不像 PAT（空白、含換行、太短、有怪字元、不是字串）→ 當沒設：只走舊路、不打 API；前後空白會修掉", async () => {
  for (const bad of ["", "   ", "ghp_short", "github_pat_abc\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "Bearer github_pat_" + "a".repeat(40), "github_pat_" + "a".repeat(40) + "; evil", "github_pat_" + "a".repeat(300), 12345, null, { v: 1 }]) {
    fetchCalls = [];
    const res = await get("/share/abc12345/", { env: { SHARES_GH_TOKEN: bad } });
    assert.equal(res.status, 200, JSON.stringify(bad));
    assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/"], JSON.stringify(bad));
    assert.equal(res.headers.get("x-share-source"), "pages");
  }
  for (const env of [undefined, null, {}, { OTHER: TOKEN }, "string"]) {
    fetchCalls = [];
    assert.equal((await get("/share/abc12345/", { env })).status, 200);
    assert.deepEqual(fetchCalls, [UPSTREAM + "abc12345/"], JSON.stringify(env));
  }
  upstreamImpl = async () => rawResponse(PAGE_HTML);
  fetchCalls = [];
  fetchInits = [];
  await get("/share/abc12345/", { env: { SHARES_GH_TOKEN: "  " + TOKEN + "\n" } });
  assert.deepEqual(fetchCalls, [API + "abc12345/index.html?ref=main"]);
  assert.equal(fetchInits[0].headers.authorization, "Bearer " + TOKEN);
});

test("有 token：邊緣快取（Cache API）——第一次讀 API 後存 5 分鐘、第二次直接命中不打 API（x-share-source=api-cache）；存的回應 content-type 已改好、Cache-Control 改成 public；快取壞掉不影響回應", async () => {
  const store = new Map();
  const fake = {
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { assert.equal(req.method, "GET"); store.set(req.url, res); },
  };
  globalThis.caches = { default: fake };
  upstreamImpl = async () => rawResponse("PNGDATA", { etag: '"e1"' });
  const waited = [];
  const a = await get("/share/abc12345/cover.png", { env: ENV, waitUntil: p => waited.push(p) });
  await Promise.all(waited);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("x-share-source"), "api");
  assert.equal(await a.text(), "PNGDATA");
  assert.equal(store.size, 1);
  const [key, stored] = [...store.entries()][0];
  assert.equal(key, "https://teddy-house.tw/__share-upstream/abc12345/cover.png", "鍵＝本站 origin＋/__share-upstream/＋白名單路徑");
  assert.equal(stored.headers.get("cache-control"), "public, max-age=300", "GitHub 給的 private 要改成 public 才存得進去");
  assert.equal(stored.headers.get("content-type"), "image/png");
  assert.equal(stored.headers.get("etag"), '"e1"');
  assert.equal(stored.headers.get("vary"), null);
  fetchCalls = [];
  const b = await get("/share/abc12345/cover.png", { env: ENV });
  assert.equal(b.status, 200);
  assert.equal(fetchCalls.length, 0, "命中快取不打 API");
  assert.equal(b.headers.get("x-share-source"), "api-cache");
  assert.equal(b.headers.get("content-type"), "image/png");
  assert.equal(b.headers.get("etag"), '"e1"');
  assert.equal(b.headers.get("cache-control"), "public, max-age=300");
  assert.equal(await b.text(), "PNGDATA");
  assert.equal((await get("/share/abc12345/cover.png", { env: ENV, headers: { "if-none-match": '"e1"' } })).status, 304, "命中快取也能 304");
  // HTML 也會快取（存的是上游原始檔，注入每次做）；沒給 waitUntil 時直接等存完
  upstreamImpl = async () => rawResponse(PAGE_HTML);
  fetchCalls = [];
  const c1 = await get("/share/qsAbCd1234/", { env: ENV });
  assert.equal(fetchCalls.length, 1);
  assert.match(await c1.text(), /想看更多好屋/);
  fetchCalls = [];
  const c2 = await get("/share/qsAbCd1234/", { env: ENV });
  assert.equal(fetchCalls.length, 0);
  assert.equal(c2.headers.get("x-share-source"), "api-cache");
  const html = await c2.text();
  assert.match(html, /推薦頁/);
  assert.match(html, /想看更多好屋/);
  assert.match(html, /G-WMQCYK4L88/);
  assert.equal(store.size, 2);
  // 快取不會跨代號／跨檔案
  fetchCalls = [];
  await get("/share/zzzz9999/", { env: ENV });
  assert.equal(fetchCalls.length, 1);
  // 快取壞掉（match／put 丟錯）不影響回應
  globalThis.caches = { default: { async match() { throw new Error("cache down"); }, async put() { throw new Error("cache down"); } } };
  fetchCalls = [];
  const d = await get("/share/abc12345/cover.png", { env: ENV });
  assert.equal(d.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(d.headers.get("x-share-source"), "api");
  // 沒有 token 時不碰快取
  globalThis.caches = { default: { async match() { throw new Error("不該碰快取"); }, async put() { throw new Error("不該碰快取"); } } };
  upstreamImpl = async () => htmlResponse();
  assert.equal((await get("/share/abc12345/")).status, 200);
});

test("子目錄只放行圖片（推薦頁產生器把物件照片放在 {id}/img/{雜湊}/{n}.jpg）；HTML／腳本／字型／隱藏目錄／帶點的目錄／超過兩層一律拒絕", { skip: !HAS_RESOLVER && "舊版沒有這個函式" }, () => {
  const ok = [
    ["/share/FgZmEHPH/img/x09193392e0/1.jpg", "FgZmEHPH/img/x09193392e0/1.jpg"],
    ["/share/FgZmEHPH/img/x09193392e0/cover.jpg", "FgZmEHPH/img/x09193392e0/cover.jpg"],
    ["/share/abc12345/img/a.png", "abc12345/img/a.png"],
    ["/share/abc12345/a-b_c/d_e-f/g.webp", "abc12345/a-b_c/d_e-f/g.webp"],
    ["/share/abc12345/IMG/X/A.JPEG", "abc12345/IMG/X/A.JPEG"],
  ];
  for (const [input, up] of ok) {
    const r = mod.resolveSharePath(input);
    assert.equal(r.kind, "page", `應放行：${input}（${JSON.stringify(r)}）`);
    assert.equal(r.upstreamPath, up, input);
    assert.equal(r.id, input.split("/")[2], input);
    assert.equal(r.file, input.split("/").pop(), input);
  }
  const bad = [
    "/share/abc12345/img/x/y/z.jpg", // 三層目錄
    "/share/abc12345/img/a.html", "/share/abc12345/img/x/a.html", "/share/abc12345/img/x/a.js", "/share/abc12345/img/x/a.css",
    "/share/abc12345/img/x/a.svg", "/share/abc12345/img/x/a.ico", "/share/abc12345/img/x/a.woff2", "/share/abc12345/img/x/a.json", "/share/abc12345/img/x/a.txt",
    "/share/abc12345/.img/a.png", "/share/abc12345/img/.x/a.png", "/share/abc12345/im.g/a.png", "/share/abc12345/img/x./a.png", "/share/abc12345/img/../a.png",
    "/share/abc12345/img/x/a.png/", "/share/abc12345/img//a.png", "/share/abc12345//img/a.png",
    "/share/abc12345/img/x/.a.png", "/share/abc12345/img/x/a", "/share/abc12345/" + "d".repeat(70) + "/a.png", "/share/abc12345/img/x/a..png", "/share/abc12345/img/x/a.php",
    "/share/abc12345/img/x/a.png.php", "/share/abc12345/img/x/a%2epng", "/share/abc12345/img/中文/a.png", "/share/abc12345/img x/a.png", "/share/abc12345/img;x/a.png",
  ];
  for (const input of bad) assert.equal(mod.resolveSharePath(input).kind, "reject", `應拒絕：${input}`);
});

test("子目錄圖片整支 handler：舊路網址＝白名單組出來的；有 token 時 API 路徑一樣；RT-18 的第一段檢查照常；子目錄 HTML 完全不打上游", async () => {
  upstreamImpl = async () => new Response("JPG", { status: 200, headers: { "content-type": "image/jpeg" } });
  const res = await get("/share/FgZmEHPH/img/x09193392e0/1.jpg");
  assert.equal(res.status, 200);
  assert.deepEqual(fetchCalls, [UPSTREAM + "FgZmEHPH/img/x09193392e0/1.jpg"]);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.match(res.headers.get("content-security-policy") || "", /sandbox/);
  assertBaseHeaders(res, "nested jpg");
  fetchCalls = [];
  upstreamImpl = async () => rawResponse("JPG");
  const api = await get("/share/FgZmEHPH/img/x09193392e0/1.jpg", { env: ENV });
  assert.equal(api.status, 200);
  assert.deepEqual(fetchCalls, [API + "FgZmEHPH/img/x09193392e0/1.jpg?ref=main"]);
  assert.equal(api.headers.get("content-type"), "image/jpeg");
  assert.equal(mod.resolveUpstreamUrl("FgZmEHPH/img/x09193392e0/1.jpg").first, "FgZmEHPH");
  // 過期 qa 代號的子目錄圖片也是 410、不打上游
  fetchCalls = [];
  assert.equal((await get("/share/" + QA_PAST + "/img/x/a.jpg", { env: ENV })).status, 410);
  for (const u of ["/share/abc12345/img/x/a.html", "/share/abc12345/img/x/y/z.jpg", "/share/abc12345/.git/objects/a.png"]) {
    assert.equal((await get(u, { env: ENV })).status, 404, u);
  }
  assert.equal(fetchCalls.length, 0);
});

test("有 token：過期的 qa 頁仍然 410，既不打 API 也不打舊路；HEAD 也走 API", async () => {
  upstreamImpl = async () => rawResponse(PAGE_HTML);
  const res = await get("/share/" + QA_PAST + "/", { env: ENV });
  assert.equal(res.status, 410);
  assert.equal(fetchCalls.length, 0);
  assert.equal((await get("/share/" + QA_PAST.toUpperCase() + "/", { env: ENV })).status, 410);
  assert.equal(fetchCalls.length, 0);
  const head = await get("/share/abc12345/", { env: ENV, method: "HEAD" });
  assert.equal(head.status, 200);
  assert.deepEqual(fetchCalls, [API + "abc12345/index.html?ref=main"]);
  // 方法不對照樣 405、不打任何上游
  assert.equal((await get("/share/abc12345/", { env: ENV, method: "POST" })).status, 405);
  assert.equal(fetchCalls.length, 1);
});
