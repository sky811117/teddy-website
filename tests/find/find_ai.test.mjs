// 那句話先交給 AI 讀（2026-10-29 景泰「AI在輸入需求那邊就要介入了 第一手就要介入了」）——find-app.js 的首載掛勾＋find-ai.js（延遲載入）。
// 用建置好的 /find/ 標記（dist/find/index.html）＋假 DOM＋假網路＋假時鐘＋假人機驗證；延遲載入的 script 由測試自己「載入」（在同一個 vm 裡執行，再叫 onload）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { transformSync } from "esbuild";
import { ROOT, loadClassic } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock, flush, click, submit, type } from "./fake_dom.mjs";

const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HTML_PATH = path.join(DIST, "find", "index.html");
const parse5 = await loadParse5();
const SKIP = !fs.existsSync(HTML_PATH) || !parse5 ? "需要先建置（dist/find/index.html）且 node_modules 內有 parse5" : false;
const NEED_SRC = fs.readFileSync(path.join(ROOT, "public/js/need-extract.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-app.js"), "utf8");
const AI_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-ai.js"), "utf8");
const PAGE_SRC = fs.readFileSync(path.join(ROOT, "src/pages/find.astro"), "utf8");
const HTML = SKIP ? "" : fs.readFileSync(HTML_PATH, "utf8");

const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const CONFIG = { ok: true, v: 1, mode: "live", turnstileSiteKey: "0xTESTSITEKEY", needMax: 300, consentV: "2026-10-06", tplV: 1, caps: ["ai"] };
const SAY = "西屯、南屯各10間，2到3房，1200萬以內，10年內，有車位";
const AI_FIELDS = { districts: ["西屯區", "南屯區"], rooms_min: 2, rooms_max: 3, price_max_wan: 1200, age_max: 10, parking: "any", per_district: 10 };
const plain = x => JSON.parse(JSON.stringify(x));

function fakeNet(over = {}) {
  const calls = [];
  const routes = {
    config: () => CONFIG,
    understand: () => ({ ok: true, v: 1, fields: AI_FIELDS, src: "ai" }),
    submit: () => ({ ok: true, v: 1, status: "queued", jobId: JOB, queue: { ahead: 0, eta_s: 30 }, saved: true }),
    status: () => ({ ok: true, v: 1, status: "searching" }),
    event: () => ({ ok: true }),
    ...over,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    const key = u.replace("/api/find/", "").split("?")[0];
    if (!(key in routes)) throw new Error("測試不准連到：" + u);
    const out = await routes[key]();
    return out instanceof Response ? out : Response.json(out);
  };
  return { calls, fetchImpl, by: k => calls.filter(c => c.url.includes("/api/find/" + k)) };
}

/** 假人機驗證：render 當下就給 token；每次 reset 之後再給一個新的（跟真的一樣：用掉一個、重設、下一個自動來） */
function fakeTs(log) {
  return w => {
    let n = 0, cb = null;
    w.turnstile = {
      render: (el, o) => { log.push(["render", el.id, o.action]); cb = o.callback; cb("TOK" + ++n); return 1; },
      reset: () => { log.push(["reset"]); if (cb) cb("TOK" + ++n); },
    };
  };
}

async function boot({ net = fakeNet(), ts = [] } = {}) {
  const clock = makeClock();
  const { doc, win } = makeEnv({ html: HTML, parse5, fetchImpl: net.fetchImpl, clock });
  fakeTs(ts)(win);
  const ctx = vm.createContext(win);
  vm.runInContext(NEED_SRC, ctx, { filename: "need-extract.js" });
  vm.runInContext(APP_SRC, ctx, { filename: "find-app.js" });
  await flush();
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => doc.querySelectorAll(sel);
  const state = () => ($$(".u2-state").find(d => !d.hidden) || {}).getAttribute?.("data-s");
  const text = sel => ($(sel) || { textContent: "" }).textContent;
  const scripts = re => doc.head.childNodes.filter(n => n.localName === "script" && re.test(n.src || ""));
  /** 把還沒載入的 find-ai.js「載入」 */
  const loadAi = async () => {
    const s = scripts(/find-ai\.js/).filter(x => !x.__done);
    assert.equal(s.length, 1, "應該要有一個 find-ai.js 的 script 在等");
    for (const x of s) { x.__done = true; vm.runInContext(AI_SRC, ctx, { filename: "find-ai.js" }); x.onload(); }
    await flush();
  };
  return { clock, doc, win, net, $, $$, state, text, scripts, loadAi };
}
globalThis.Blob = class extends Blob { constructor(parts, opt) { super(parts, opt); this.__text = parts.join(""); } };

const tags = app => app.$$("#s2-chat .u2-tag").map(t => t.textContent);
async function say(app, t) {
  submit(app.$("#free-form"));
  await flush();
}

/* ===================== 流程 ===================== */
test("家用機回報 ai：開始打字就載入 find-ai.js 並先準備人機驗證；送出時先問 AI，「我聽到的」照 AI 讀的（含各 10 間）", { skip: SKIP }, async () => {
  const ts = [];
  const app = await boot({ ts });
  assert.equal(app.scripts(/find-ai\.js/).length, 0, "還沒打字：不載");
  type(app.$("#free-text"), SAY);
  assert.equal(app.scripts(/find-ai\.js/).length, 1, "開始打字：載入");
  assert.match(app.scripts(/find-ai\.js/)[0].src, /^\/js\/find-ai\.js\?v=[0-9a-f]{10}$/);
  await app.loadAi();
  assert.deepEqual(ts[0], ["render", "ts-box", "find"], "載好就先準備人機驗證（action 一樣是 find）");
  await say(app, SAY);
  const u = app.net.by("understand");
  assert.equal(u.length, 1);
  assert.deepEqual(u[0].body, { v: 1, text: SAY, turnstile: "TOK1" });
  assert.ok(ts.some(x => x[0] === "reset"), "token 用完就重設（送出需求時要用新的）");
  assert.equal(app.state(), "s2");
  assert.deepEqual(tags(app), ["西屯區、南屯區", "2～3 房", "1200 萬以內", "10 年內", "有車位", "各 10 間"]);
  assert.equal(app.$("#ai-wait").hidden, true, "讀完就收起「正在讀」");
  // 需求單有「間數」一列、沒有「改」；送出時條件帶著 per_district
  click(app.$('[data-act="go-now"]'));
  await flush();
  const row = app.$$("#sheet-rows .u2-sheet__row").find(r => r.querySelector("dt").textContent === "間數");
  assert.ok(row, "需求單要有間數");
  assert.equal(row.querySelector("dd").textContent, "各 10 間");
  assert.equal(row.querySelector("button"), null, "間數沒有可改的題目");
  await app.clock.advance(6000);
  click(app.$("#go-btn"));
  await flush();
  const sub = app.net.by("submit")[0].body;
  assert.equal(sub.fields.per_district, 10);
  assert.equal(sub.free_text, SAY);
  assert.equal(sub.turnstile, "TOK2", "送出需求用的是新的 token");
});

test("只選一區＋間數：標籤寫「N 間」（不是「各」）", { skip: SKIP }, async () => {
  const app = await boot({ net: fakeNet({ understand: () => ({ ok: true, v: 1, fields: { districts: ["北屯區"], per_district: 5, rooms_min: 3, rooms_max: 3 }, src: "ai" }) }) });
  type(app.$("#free-text"), "北屯三房給我5間就好");
  await app.loadAi();
  await say(app);
  assert.deepEqual(tags(app), ["北屯區", "3 房", "5 間"]);
});

test("AI 讀不到（家用機說沒開、人機驗證沒過、伺服器錯誤、回來的不是物件）：照瀏覽器規則讀，客人感覺不到", { skip: SKIP }, async () => {
  const bads = [
    () => ({ ok: false, v: 1, code: "E_FORWARD" }),
    () => ({ ok: false, v: 1, code: "E_HUMAN" }),
    () => new Response("boom", { status: 502 }),
    () => ({ ok: true, v: 1, fields: ["西屯區"], src: "ai" }),
    () => { throw new Error("network"); },
  ];
  for (const bad of bads) {
    const app = await boot({ net: fakeNet({ understand: bad }) });
    type(app.$("#free-text"), "北屯三房，兩千萬內");
    await app.loadAi();
    await say(app);
    await flush();
    assert.equal(app.state(), "s2", String(bad));
    assert.deepEqual(tags(app), ["北屯區", "3 房", "2000 萬以內"], String(bad));
    assert.equal(app.$("#ai-wait").hidden, true);
  }
});

test("AI 太慢：9 秒還沒回就照瀏覽器規則讀；之後才到的結果不會蓋掉畫面", { skip: SKIP }, async () => {
  let release;
  const late = new Promise(r => { release = r; });
  const app = await boot({ net: fakeNet({ understand: () => late }) });
  type(app.$("#free-text"), "北屯三房，兩千萬內");
  await app.loadAi();
  await say(app);
  assert.equal(app.state(), "s0", "等 AI 的時候還在開場");
  assert.equal(app.$("#ai-wait").hidden, false, "顯示「正在讀」");
  submit(app.$("#free-form"));                       // 等的時候又按一次：不重送
  await flush();
  assert.equal(app.net.by("understand").length, 1);
  await app.clock.advance(9000);
  await flush();
  assert.equal(app.state(), "s2");
  assert.deepEqual(tags(app), ["北屯區", "3 房", "2000 萬以內"]);
  release({ ok: true, v: 1, fields: AI_FIELDS, src: "ai" });
  await flush();
  assert.deepEqual(tags(app), ["北屯區", "3 房", "2000 萬以內"], "太晚到的不算");
});

test("家用機沒回報 ai、沒有人機驗證 site key、或 find-ai.js 還沒載好：不問 AI，直接照瀏覽器規則讀", { skip: SKIP }, async () => {
  let app = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: [] }) }) });
  type(app.$("#free-text"), "北屯三房，兩千萬內");
  assert.equal(app.scripts(/find-ai\.js/).length, 0, "沒有 ai：不載");
  await say(app);
  assert.equal(app.net.by("understand").length, 0);
  assert.equal(app.state(), "s2");

  app = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, turnstileSiteKey: null }) }) });
  type(app.$("#free-text"), "北屯三房，兩千萬內");
  await app.loadAi();
  await say(app);
  assert.equal(app.net.by("understand").length, 0, "沒有 site key：問不了");
  assert.equal(app.state(), "s2");

  app = await boot();
  type(app.$("#free-text"), "北屯三房，兩千萬內");   // script 已經掛上，但還沒載好
  await say(app);
  assert.equal(app.net.by("understand").length, 0);
  assert.deepEqual(tags(app), ["北屯區", "3 房", "2000 萬以內"]);
});

test("外縣市：不問 AI（照原本說只找台中）", { skip: SKIP }, async () => {
  const app = await boot();
  type(app.$("#free-text"), "台北大安區三房");
  await app.loadAi();
  await say(app);
  assert.equal(app.net.by("understand").length, 0);
  assert.match(app.text("#s2-chat"), /目前我只幫忙找台中的物件/);
});

test("家用機回的條件再過一次白名單：不認得的欄位、超出範圍的間數都丟掉", { skip: SKIP }, async () => {
  const app = await boot({ net: fakeNet({ understand: () => ({ ok: true, v: 1, fields: { districts: ["北屯區"], per_district: 99, evil: "<b>x</b>", rooms_min: 3 }, src: "ai" }) }) });
  type(app.$("#free-text"), "北屯三房");
  await app.loadAi();
  await say(app);
  assert.deepEqual(tags(app), ["北屯區", "3 房以上"]);
});

/* ===================== 欄位與片段 ===================== */
test("need-extract：per_district 只收 1～30 的整數；#k= 片段帶得走（pd）", () => {
  const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
  for (const [v, ok] of [[1, true], [10, true], [30, true], [0, false], [31, false], ["10", false], [2.5, false]]) {
    const r = NE.normalizeFields({ districts: ["北屯區"], per_district: v });
    assert.equal("per_district" in r.fields, ok, String(v));
    if (!ok) assert.ok(r.issues.includes("per_district:invalid"), String(v));
  }
  const tok = NE.fragEncode({ districts: ["西屯區", "南屯區"], per_district: 10, rooms_min: 2 }, {});
  assert.equal(plain(NE.fragDecode(tok).f).per_district, 10);
  assert.equal(NE.extract("西屯南屯各10間").fields.per_district, undefined, "規則式不抽間數（只有 AI 讀得出來）");
});

/* ===================== 靜態 ===================== */
test("find-ai.js 靜態：IIFE、不用 innerHTML、沒有動態執行、沒有寫死的網址與路徑、沒有儲存；體積小", () => {
  const code = AI_SRC;
  assert.match(code, /^\/\*! find-ai\.js/);
  assert.match(code, /\(function \(root\) \{\r?\n'use strict';/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(code));
  assert.ok(!/https?:\/\//.test(code), "沒有外部網址");
  assert.ok(!/\/api\//.test(code), "路徑由 find-app 的 api() 拼（只有 API 常數一處寫了路徑）");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code));
  assert.ok(!/\bfetch\s*\(/.test(code), "請求只透過 find-app 給的 api()");
  const min = transformSync(code, { minify: true, loader: "js", charset: "utf8", legalComments: "none" }).code;
  assert.ok(zlib.brotliCompressSync(min).length <= 1500, "延遲載入，但還是要小");
});

test("頁面：#s0-live 帶 find-ai.js 的版本網址、#ai-wait 預設藏著；題目與說明在 #qcopy（對話區外面）", () => {
  assert.match(PAGE_SRC, /<div id="s0-live" data-src=\{`\/js\/find-ai\.js\?v=\$\{vAi\}`\}>/);
  assert.match(PAGE_SRC, /const vAi = fileVer\("public\/js\/find-ai\.js"\);/);
  assert.match(PAGE_SRC, /<p class="u2-small" id="ai-wait" role="status" hidden>/);
  const stage = PAGE_SRC.slice(PAGE_SRC.indexOf('id="stage"'), PAGE_SRC.indexOf('<aside class="u2-find__aside"'));
  assert.ok(!stage.includes('id="qcopy"'), "題目表不在對話區裡（藏著的字也不算對話內容）");
  for (const q of ["q_district", "q_budget", "q_rooms", "q_concerns", "q_parking", "q_age", "q_stage", "q_timeline"]) {
    assert.match(PAGE_SRC, new RegExp(`<p data-q="${q}" data-h="[^"]+">[^<]+</p>`), q);
  }
});
