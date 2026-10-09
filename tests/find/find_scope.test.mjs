// 範圍找法（2026-10-09：指定社區／74環內／地圖）——find-app.js 的首載掛勾＋find-scope.js（延遲載入）整段流程。
// 用建置好的 /find/ 標記（dist/find/index.html）＋假 DOM＋假網路＋假時鐘；延遲載入的 script 由測試自己「載入」（在同一個 vm 裡執行，再叫 onload）。
// 地圖模組 find-map.js 由 WEB-MAP 做：這裡用假的 window.FindMap 測掛勾（open 的參數、onDone／onCancel／onFail）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { transformSync } from "esbuild";
import { ROOT, bundleTs, loadClassic } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock, flush, click, submit, type } from "./fake_dom.mjs";

const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HTML_PATH = path.join(DIST, "find", "index.html");
const parse5 = await loadParse5();
const SKIP = !fs.existsSync(HTML_PATH) || !parse5 ? "需要先建置（dist/find/index.html）且 node_modules 內有 parse5" : false;
const S = (await bundleTs("src/lib/find/schema.ts")).mod;
const NEED_SRC = fs.readFileSync(path.join(ROOT, "public/js/need-extract.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-app.js"), "utf8");
const SCOPE_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-scope.js"), "utf8");
const PAGE_SRC = fs.readFileSync(path.join(ROOT, "src/pages/find.astro"), "utf8");
const CSS_SRC = fs.readFileSync(path.join(ROOT, "src/styles/ui2-find.css"), "utf8");
const HTML = SKIP ? "" : fs.readFileSync(HTML_PATH, "utf8");

const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const SHARE = "https://teddy-house.tw/share/qa008kmn3x7q2pzrtavb5ncdetwoxy4k/";
const ALL = ["community", "zone", "geo"];
const CONFIG = { ok: true, v: 1, mode: "live", turnstileSiteKey: null, needMax: 300, consentV: "2026-10-06", tplV: 1, caps: ALL };
const SQ = [[24.16, 120.64], [24.16, 120.65], [24.17, 120.65], [24.17, 120.64]];
const plain = x => JSON.parse(JSON.stringify(x));
const loadClassicNE = () => loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;

function fakeNet(over = {}) {
  const calls = [];
  const routes = {
    config: () => CONFIG,
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
    return Response.json(await routes[key]());
  };
  return { calls, fetchImpl, by: k => calls.filter(c => c.url.includes("/api/find/" + k)) };
}

async function boot({ net = fakeNet(), session = {}, pre = null, preloadScope = false } = {}) {
  const clock = makeClock();
  const { doc, win } = makeEnv({ html: HTML, parse5, fetchImpl: net.fetchImpl, clock, sessionData: session });
  if (pre) pre(win);
  const ctx = vm.createContext(win);
  vm.runInContext(NEED_SRC, ctx, { filename: "need-extract.js" });
  if (preloadScope) vm.runInContext(SCOPE_SRC, ctx, { filename: "find-scope.js" });
  vm.runInContext(APP_SRC, ctx, { filename: "find-app.js" });
  await flush();
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => doc.querySelectorAll(sel);
  const state = () => ($$(".u2-state").find(d => !d.hidden) || {}).getAttribute?.("data-s");
  const text = sel => ($(sel) || { textContent: "" }).textContent;
  const scripts = re => doc.head.childNodes.filter(n => n.localName === "script" && re.test(n.src || ""));
  /** 把還沒載入的 find-scope.js「載入」：在同一個 vm 裡執行，再叫 onload */
  const loadScope = async () => {
    const s = scripts(/find-scope\.js/).filter(x => !x.__done);
    assert.ok(s.length, "應該要有一個 find-scope.js 的 script 在等");
    for (const x of s) { x.__done = true; if (!win.FindScope) vm.runInContext(SCOPE_SRC, ctx, { filename: "find-scope.js" }); x.onload(); }
    await flush();
  };
  const events = () => {
    const out = [];
    net.by("event").forEach(c => { if (c.body && c.body.events) out.push(...c.body.events); });
    win.__beacons.forEach(b => { try { out.push(...JSON.parse(b.blob.__text).events); } catch { /* ignore */ } });
    return out;
  };
  return { clock, doc, win, ctx, net, $, $$, state, text, scripts, loadScope, events };
}
globalThis.Blob = class extends Blob { constructor(parts, opt) { super(parts, opt); this.__text = parts.join(""); } };

async function say(app, t) {
  type(app.$("#free-text"), t);
  submit(app.$("#free-form"));
  await flush();
}
const act = (app, a) => click(app.$(`[data-act="${a}"]`));
const sc = (app, a) => click(app.$(`[data-sc="${a}"]`));
const entry = (app, k) => app.$(`#scope-entry [data-scope="${k}"]`);
const rows = app => app.$$("#sheet-rows .u2-sheet__row").map(r => r.textContent.replace(/改.*$/, ""));
const hintTexts = app => app.$$("#hint-list li").map(li => li.textContent.trim());
async function goSubmit(app) {
  await app.clock.advance(6000);
  click(app.$("#go-btn"));
  await flush();
}
/** 送出後讓輪詢回 status（第一次輪詢在 2 秒後） */
async function toStatus(app) {
  await app.clock.advance(2100);
  await flush();
}
/** 直接帶著條件到 s4（從網址 #k= 片段）：用來測 s7／s8 的範圍說法 */
const viaFrag = (f, over = {}) => boot({ session: { "find.hash": "#k=" + Buffer.from(JSON.stringify({ v: 1, f })).toString("base64url") }, ...over });

/* ===================== 入口與 caps ===================== */
test("入口：家用機回報支援才出現；只開有列的那幾顆；收件模式、舊家用機（沒有 caps）全藏", { skip: SKIP }, async () => {
  let app = await boot();
  assert.equal(app.$("#scope-entry").hidden, false);
  for (const k of ALL) assert.equal(entry(app, k).hidden, false, k);
  app = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: ["community"] }) }) });
  assert.equal(app.$("#scope-entry").hidden, false);
  assert.deepEqual(ALL.map(k => entry(app, k).hidden), [false, true, true]);
  for (const cfg of [{ ...CONFIG, caps: [] }, { ...CONFIG, caps: undefined }, { ...CONFIG, mode: "intake" }, { ...CONFIG, caps: ["evil"] }]) {
    app = await boot({ net: fakeNet({ config: () => cfg }) });
    assert.equal(app.$("#scope-entry").hidden, true, JSON.stringify(cfg));
  }
  app = await boot({ net: fakeNet({ config: () => { throw new Error("down"); } }) });
  assert.equal(app.$("#scope-entry").hidden, true, "設定抓不到：入口不開");
});

test("文華匯社區待售物件：s2 標籤「文華匯社區」、不問硬題、可以直接開始找；需求單第一列「範圍｜文華匯社區」；送出本文帶 community", { skip: SKIP }, async () => {
  const app = await boot();
  await say(app, "文華匯社區待售物件");
  assert.equal(app.state(), "s2");
  assert.deepEqual(app.$$("#s2-chat .u2-tag").map(t => t.textContent), ["文華匯社區"]);
  assert.match(app.text("#s2-chat"), /條件夠了。還有幾題選填的/);
  assert.equal(app.scripts(/find-scope/).length, 0, "聽得懂就不用載入範圍模組");
  act(app, "go-now");
  assert.equal(app.state(), "s4");
  assert.deepEqual(rows(app), ["範圍文華匯社區", "預算不限", "房數不限"]);
  await goSubmit(app);
  const body = app.net.by("submit")[0].body;
  assert.deepEqual(body.fields, { community: "文華匯" });
  assert.equal(S.validateSubmit(body).err, null);
  assert.deepEqual(plain(S.validateSubmit(body).out.fields), { community: "文華匯" });
  // 帶區的說法：區留著送出（家用機挑同名社區），需求單不寫區
  const a2 = await boot();
  await say(a2, "西屯區文華匯社區 3房");
  assert.deepEqual(a2.$$("#s2-chat .u2-tag").map(t => t.textContent), ["文華匯社區", "3 房"]);
  act(a2, "go-now");
  assert.deepEqual(rows(a2).slice(0, 1), ["範圍文華匯社區"]);
  await goSubmit(a2);
  assert.deepEqual(a2.net.by("submit")[0].body.fields, { districts: ["西屯區"], community: "文華匯", rooms_min: 3, rooms_max: 3 });
  await a2.clock.advance(7000);
  const evs = a2.events();
  for (const e of evs) assert.deepEqual(S.validateEvent(e), e, JSON.stringify(e));
  assert.deepEqual(evs.find(e => e.e === "free_submit").got, ["district", "scope", "rooms"]);
  assert.ok(!JSON.stringify(evs).includes("文華匯"), "事件不含社區名");
});

test("74環內三房2000萬內：s2 標籤；需求單「範圍｜74環內」；送出本文帶 zone", { skip: SKIP }, async () => {
  const app = await boot();
  await say(app, "74環內三房2000萬內");
  assert.deepEqual(app.$$("#s2-chat .u2-tag").map(t => t.textContent), ["74環內", "3 房", "2000 萬以內"]);
  act(app, "go-now");
  assert.deepEqual(rows(app), ["範圍74環內", "預算2000 萬以內", "房數3 房"]);
  await goSubmit(app);
  assert.deepEqual(app.net.by("submit")[0].body.fields, { zone: "r74", price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
  const a2 = await boot();
  await say(a2, "北屯區74環內 3房 2000萬");
  act(a2, "go-now");
  assert.deepEqual(rows(a2).slice(0, 1), ["範圍74環內（北屯區）"]);
});

test("capGate：家用機沒說支援 → 抽到的範圍拿掉、重算等級；s2 照「沒聽出條件」再加一條說明（範圍模組載得到時）", { skip: SKIP }, async () => {
  const app = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: [] }) }) });
  await say(app, "文華匯社區待售物件");
  assert.match(app.text("#s2-chat"), /這句話我沒聽出條件/);
  assert.equal(app.scripts(/find-scope/).length, 1, "要說明：載入範圍模組");
  await app.loadScope();
  assert.match(app.text("#s2-chat"), /你說的這種找法（社區、74環內或地圖）現在暫時不能用，這次先照其他條件找。/);
  const ban = app.$$("#s2-chat [role='note']").pop();
  assert.equal(ban.querySelector("p").className, "u2-scope-ban", "17px 的字（不是 u2-small）");
  // 其他條件照常；送出前也剝
  const a2 = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: ["community"] }) }) });
  await say(a2, "74環內三房2000萬內");
  assert.deepEqual(a2.$$("#s2-chat .u2-tag").map(t => t.textContent), ["3 房", "2000 萬以內"]);
  const fs2 = a2.win.FindCore;
  assert.deepEqual(plain(fs2.capGate({ zone: "r74", rooms_min: 3 }, { cfgOk: true, mode: "live", caps: ["community"] })), { rooms_min: 3 });
  assert.deepEqual(plain(fs2.capGate({ zone: "r74" }, { cfgOk: false, mode: "live", caps: [] })), { zone: "r74" }, "設定還沒載入：不剝");
  assert.deepEqual(plain(fs2.capGate({ zone: "r74" }, { cfgOk: true, mode: "intake", caps: [] })), { zone: "r74" }, "收件模式：不剝");
});

test("設定還沒回來就打社區句：照樣認得（不剝）；「重新開始」後再打一次照樣認得、入口還在", { skip: SKIP }, async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const app = await boot({ net: fakeNet({ config: () => gate.then(() => CONFIG) }) });
  await say(app, "文華匯社區待售物件");
  assert.deepEqual(app.$$("#s2-chat .u2-tag").map(t => t.textContent), ["文華匯社區"]);
  release();
  await flush();
  assert.equal(app.$("#scope-entry").hidden, false);
  click(app.$("#clear-btn"));
  assert.equal(app.state(), "s0");
  assert.equal(app.$("#scope-entry").hidden, false, "重新開始後入口還在");
  await say(app, "文華匯社區待售物件");
  assert.deepEqual(app.$$("#s2-chat .u2-tag").map(t => t.textContent), ["文華匯社區"]);
});

test("入口按下：按鈕 aria-busy＋「開啟中…」；載不到 → 按鈕恢復、#scope-entry-err 出現、再按一次會重試；10 秒沒好也一樣", { skip: SKIP }, async () => {
  const app = await boot();
  const b = entry(app, "community");
  click(b);
  assert.equal(b.getAttribute("aria-busy"), "true");
  assert.equal(b.textContent, "開啟中…");
  click(b);
  assert.equal(app.scripts(/find-scope/).length, 1, "載入中再按不會重複載");
  app.scripts(/find-scope/)[0].onerror();
  assert.equal(b.getAttribute("aria-busy"), null);
  assert.equal(b.textContent, "找某個社區");
  assert.equal(app.$("#scope-entry-err").hidden, false);
  assert.match(app.text("#scope-entry-err"), /這個功能暫時打不開。可以直接打一句話/);
  assert.equal(app.state(), "s0");
  click(b);
  assert.equal(app.scripts(/find-scope/).length, 2, "可以再按一次（重試）");
  assert.equal(app.$("#scope-entry-err").hidden, true);
  await app.clock.advance(10000);
  assert.equal(b.textContent, "找某個社區", "10 秒沒好：恢復");
  assert.equal(app.$("#scope-entry-err").hidden, false);
  app.scripts(/find-scope/)[1].onload();   // 逾時之後才到的那一份：不執行
  await flush();
  assert.equal(app.state(), "s0");
  click(b);
  await app.loadScope();
  assert.equal(app.state(), "s1");
  assert.equal(app.$("#scope-entry-err").hidden, true);
  assert.equal(app.text("#scope-h"), "找某個社區");
});

/* ===================== s1：社區表單 ===================== */
test("找某個社區：s1 表單；不像社區名有提示；合法 → 直接到確認畫面（不問硬題）；回上一步回到原步驟；改用選區域清掉範圍", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true });
  click(entry(app, "community"));
  assert.equal(app.state(), "s1");
  assert.equal(app.$("#scope-comm").hidden, false);
  assert.equal(app.$("#scope-zone").hidden, true);
  assert.equal(app.$("#scope-map").hidden, true);
  assert.equal(app.doc.activeElement && app.doc.activeElement.id, "scope-h", "讀屏先念目前在哪一個畫面");
  assert.deepEqual(app.$$("#scope-tabs [data-sc]").map(t => [t.hidden, t.getAttribute("aria-pressed")]), [[false, "true"], [false, "false"], [false, "false"]]);
  type(app.$("#scope-comm-in"), "七期");
  submit(app.$("#scope-comm"));
  assert.equal(app.state(), "s1");
  assert.equal(app.$("#scope-comm-err").hidden, false);
  assert.equal(app.text("#scope-comm-err"), "這個名稱看起來不像社區名。只打社區的名字就好，不用打其他的字。");
  assert.equal(app.$("#scope-comm-in").getAttribute("aria-invalid"), "true");
  type(app.$("#scope-comm-in"), "惠宇 樂觀社區");
  submit(app.$("#scope-comm"));
  assert.equal(app.state(), "s4");
  assert.deepEqual(rows(app), ["範圍惠宇 樂觀社區", "預算不限", "房數不限"]);
  // 從確認畫面「範圍｜改」回到表單（帶目前的名字），回上一步＝回確認畫面
  click(app.$('[data-edit="scope"]'));
  assert.equal(app.state(), "s1");
  assert.equal(app.$("#scope-comm-in").value, "惠宇 樂觀");
  sc(app, "back");
  assert.equal(app.state(), "s4");
  // 回上一步（從開場進來）＝回開場；改用選區域＝清掉範圍、走選區域
  const a2 = await boot({ preloadScope: true });
  click(entry(a2, "community"));
  click(a2.$('#scope-comm [data-sc="back"]'));
  assert.equal(a2.state(), "s0");
  click(entry(a2, "community"));
  type(a2.$("#scope-comm-in"), "文華匯");
  submit(a2.$("#scope-comm"));
  click(a2.$('[data-edit="scope"]'));
  click(a2.$('#scope-comm [data-sc="pick"]'));
  assert.equal(a2.state(), "s3");
  assert.equal(a2.text(".u2-tray__q"), "想找哪一區？");
  assert.equal(JSON.parse(a2.win.sessionStorage.getItem("find.v1")).fields.community, undefined, "範圍拿掉了");
  await a2.clock.advance(7000);
  assert.ok(a2.events().some(e => e.e === "start" && e.how === "comm"));
  assert.ok(a2.events().some(e => e.e === "edit" && e.k === "scope"));
});

test("換一種找法：分頁依 caps 顯示、目前那一個 aria-pressed；標題跟著換", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true, net: fakeNet({ config: () => ({ ...CONFIG, caps: ["community", "zone"] }) }) });
  click(entry(app, "zone"));
  assert.equal(app.text("#scope-h"), "74環內");
  assert.deepEqual(app.$$("#scope-tabs [data-sc]").map(t => [t.hidden, t.getAttribute("aria-pressed")]), [[false, "false"], [false, "true"], [true, "false"]]);
  sc(app, "to-community");
  assert.equal(app.text("#scope-h"), "找某個社區");
  assert.equal(app.$("#scope-comm").hidden, false);
  assert.equal(app.$("#scope-zone").hidden, true);
});

/* ===================== s1：74環內 ===================== */
test("74環內：說明（太平、大里…）→ 就找 74環內 → 只問硬題（預算、房數…）；路段與環外的區拿掉；從確認畫面進來回確認畫面", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true });
  click(entry(app, "zone"));
  assert.equal(app.state(), "s1");
  assert.match(app.text("#scope-zone"), /大里、烏日、霧峰不算在內/);
  assert.match(app.text("#scope-zone"), /© OpenStreetMap 貢獻者/);
  sc(app, "zone-go");
  assert.equal(app.state(), "s3");
  assert.equal(app.text(".u2-tray__q"), "預算上限大概多少？");
  assert.match(app.text("#s3-chat"), /我聽到的是：74環內。/);
  assert.deepEqual(app.$$(".u2-tray__q").map(q => q.textContent), ["預算上限大概多少？"]);
  assert.match(app.text(".u2-tray__meta"), /第 1 題，最多 4 題/, "只問硬題（預算、房數、車位、屋齡），不問區域與選填題");
});

test("74環內：條件已經齊了（有預算、有房數）→ 直接到確認畫面；從確認畫面進來一律回確認畫面", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true });
  await say(app, "北屯崇德路三房兩千萬");
  act(app, "go-now");
  assert.equal(app.state(), "s4");
  click(entry(app, "zone"));   // 開場的入口按鈕一直在頁面上：按了＝從目前這一步（s4）進來
  sc(app, "zone-go");
  assert.equal(app.state(), "s4");
  assert.deepEqual(rows(app).slice(0, 3), ["範圍74環內（北屯區）", "預算2000 萬以內", "房數3 房"]);
  await goSubmit(app);
  assert.deepEqual(app.net.by("submit")[0].body.fields, { districts: ["北屯區"], zone: "r74", price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }, "路段拿掉");
  const a2 = await boot({ preloadScope: true });
  await say(a2, "大里兩房");
  act(a2, "go-now");
  click(entry(a2, "community"));
  assert.equal(a2.text("#scope-h"), "找某個社區");
  sc(a2, "to-zone");
  sc(a2, "zone-go");
  assert.equal(a2.state(), "s4", "從確認畫面進來：回確認畫面");
  assert.deepEqual(rows(a2)[0], "範圍74環內", "環外的區（大里）拿掉");
});

/* ===================== s1：地圖（假 FindMap） ===================== */
function fakeMap(win) {
  const log = [];
  win.FindMap = {
    open(mount, opts) { log.push(["open", mount.id, opts.poly]); win.__mapOpts = opts; },
    close() { log.push(["close"]); },
    check() { return { ok: true }; },
  };
  return log;
}
test("在地圖上圈範圍：先顯示 s1 再載 find-map.js；open 的參數；onDone 寫入 geo、拿掉區與路段；onCancel 回上一步；onFail 顯示提示", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true });
  click(entry(app, "geo"));
  assert.equal(app.state(), "s1");
  assert.equal(app.$("#scope-map").hidden, false);
  assert.equal(app.text("#scope-h"), "在地圖上圈範圍");
  assert.match(app.text("#scope-map-mount"), /地圖載入中…/);
  const s = app.scripts(/find-map\.js/);
  assert.equal(s.length, 1);
  assert.match(s[0].src, /^\/js\/find-map\.js\?v=/);
  assert.equal(s[0].src, app.$("#scope-map").getAttribute("data-src"), "網址從頁面拿");
  const log = fakeMap(app.win);
  s[0].onload();
  assert.deepEqual(log.filter(x => x[0] === "open"), [["open", "scope-map-mount", null]]);
  const opts = app.win.__mapOpts;
  opts.track("area", { a: "open", m: "view" });
  opts.track("free_submit", { lvl: "ok" });   // 只轉送 area
  opts.onDone(SQ);
  assert.ok(log.some(x => x[0] === "close"), "完成就關地圖");
  assert.equal(app.state(), "s3");
  assert.equal(app.text(".u2-tray__q"), "預算上限大概多少？");
  assert.match(app.text("#s3-chat"), /地圖上選的範圍/);
  await app.clock.advance(7000);
  const evs = app.events();
  assert.ok(evs.some(e => e.e === "area" && e.a === "open"));
  assert.ok(!evs.some(e => e.e === "free_submit"));
  assert.ok(evs.some(e => e.e === "start" && e.how === "map"));
  // 帶著原範圍再開；onCancel＝回上一步；onFail＝提示＋改用選區域
  const a2 = await boot({ preloadScope: true });
  await say(a2, "西屯崇德路三房兩千萬");
  act(a2, "go-now");
  const l2 = fakeMap(a2.win);
  click(entry(a2, "geo"));
  assert.equal(l2.filter(x => x[0] === "open").length, 1, "已經載過：直接開");
  a2.win.__mapOpts.onDone(SQ);
  assert.equal(a2.state(), "s4");
  assert.deepEqual(rows(a2).slice(0, 3), ["範圍地圖上選的範圍", "預算2000 萬以內", "房數3 房"]);
  click(a2.$('[data-edit="scope"]'));
  assert.deepEqual(plain(l2.filter(x => x[0] === "open").pop()[2]), SQ, "編輯時帶目前的範圍");
  a2.win.__mapOpts.onCancel();
  assert.equal(a2.state(), "s4");
  click(entry(a2, "geo"));
  const closes = l2.filter(x => x[0] === "close").length;
  a2.win.__mapOpts.onFail("tiles");
  assert.equal(a2.$("#scope-map-mount").hidden, true, "圖片載不到：地圖收起來");
  assert.ok(l2.filter(x => x[0] === "close").length > closes, "也關掉地圖");
  assert.equal(a2.$("#scope-map-fail").hidden, false);
  assert.match(a2.text("#scope-map-fail"), /地圖沒有載入成功/);
  sc(a2, "back");
  assert.equal(a2.state(), "s4");
  await goSubmit(a2);
  assert.deepEqual(a2.net.by("submit")[0].body.fields, { geo: SQ, price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
});

test("地圖模組載不到（onerror／15 秒）：#scope-map-fail＋改用選區域；換到別的分頁會關地圖", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true });
  click(entry(app, "geo"));
  app.scripts(/find-map\.js/)[0].onerror();
  assert.equal(app.$("#scope-map-fail").hidden, false);
  sc(app, "to-community");
  sc(app, "to-geo");
  assert.equal(app.$("#scope-map-fail").hidden, true, "再試一次先把提示收起來");
  assert.equal(app.$("#scope-map-mount").hidden, false, "地圖區（載入中…）放回來");
  assert.equal(app.scripts(/find-map\.js/).length, 2);
  await app.clock.advance(15000);
  assert.equal(app.$("#scope-map-fail").hidden, false);
  const log = fakeMap(app.win);
  sc(app, "to-community");
  assert.ok(log.some(x => x[0] === "close"));
  click(app.$('#scope-comm [data-sc="pick"]'));
  assert.equal(app.state(), "s3");
});

/* ===================== s2：是社區的名字嗎？ ===================== */
test("s2：只打社區名（文華匯／文華匯三房／文華匯 3房 2000萬…）→「你說的『文華匯』是社區的名字嗎？」；是 → 確認畫面；不是 → 拿掉問題", { skip: SKIP }, async () => {
  for (const t of ["文華匯", "文華匯三房", "文華匯 3房 2000萬", "文華匯的物件", "想看文華匯", "文華匯有嗎"]) {
    const app = await boot();
    await say(app, t);
    await app.loadScope();
    assert.match(app.text("#s2-chat"), /你說的『文華匯』是社區的名字嗎？/, t);
  }
  const app = await boot();
  await say(app, "文華匯");
  await app.loadScope();
  const orig = app.$$("#s2-chat .u2-msg--bot")[0];
  assert.equal(orig.hidden, true, "沒聽出條件那一句先收起來");
  assert.deepEqual(app.$$("#s2-actions [data-act]").map(b => b.getAttribute("data-act")), ["restart", "pick"], "原本的「再打一次」「用選的就好」還在");
  sc(app, "guess-no");
  assert.equal(app.$("#scope-ask"), null);
  assert.equal(orig.hidden, false);
  assert.match(app.text("#s2-chat"), /這句話我沒聽出條件/);
  const a2 = await boot();
  await say(a2, "文華匯三房");
  await a2.loadScope();
  assert.deepEqual(a2.$$("#s2-chat span.u2-tag").map(t => t.textContent), ["3 房"]);
  assert.match(a2.text("#s2-chat"), /你說的『文華匯』是社區的名字嗎？/, "有其他條件：問題加在條件下面");
  sc(a2, "guess-yes");
  assert.equal(a2.state(), "s4");
  assert.deepEqual(rows(a2).slice(0, 3), ["範圍文華匯社區", "預算不限", "房數3 房"]);
  await goSubmit(a2);
  assert.deepEqual(a2.net.by("submit")[0].body.fields, { community: "文華匯", rooms_min: 3, rooms_max: 3 });
  assert.equal(a2.net.by("submit")[0].body.free_text, "文華匯三房");
});

test("s2：不像社區名、已經有地點、家用機不支援社區 → 不問（範圍模組也不用載）", { skip: SKIP }, async () => {
  for (const t of ["採光好三房", "北屯三房", "七期有在賣嗎", "安靜一點的兩房"]) {
    const app = await boot();
    await say(app, t);
    for (const s of app.scripts(/find-scope/)) { if (!app.win.FindScope) vm.runInContext(SCOPE_SRC, app.ctx); s.onload(); }
    await flush();
    assert.doesNotMatch(app.text("#s2-chat"), /是社區的名字嗎/, t);
  }
  const app = await boot();
  await say(app, "北屯三房");
  assert.equal(app.scripts(/find-scope/).length, 0, "有區：不載範圍模組");
  const a2 = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: ["zone", "geo"] }) }) });
  await say(a2, "文華匯");
  assert.equal(a2.scripts(/find-scope/).length, 0, "家用機不支援社區：不問");
});

/* ===================== s7、s8 ===================== */
test("s7：社區模式那一句換成「這是你指定的社區這次找到…」；之後一般結果換回原句", { skip: SKIP }, async () => {
  let n = 0;
  const net = fakeNet({ status: () => (++n, { ok: true, v: 1, status: "done", count: 5, shareUrl: SHARE }) });
  const app = await boot({ net });
  await say(app, "文華匯社區待售物件");
  act(app, "go-now");
  await goSubmit(app);
  assert.equal(app.state(), "s6");
  assert.equal(app.scripts(/find-scope/).length, 1, "等待時就預載");
  await app.loadScope();
  await toStatus(app);
  assert.equal(app.state(), "s7");
  assert.equal(app.$("#s7-comm").hidden, false);
  assert.equal(app.$("#s7-first").hidden, true);
  assert.match(app.text("#s7-comm"), /這是你指定的社區這次找到、符合條件的物件。想看全部，或請景泰幫你留意新的，可以 LINE 問景泰。/);
  assert.deepEqual(app.$$("#res-tags .u2-tag").map(t => t.textContent), ["文華匯社區"]);
  click(app.$("#clear-btn"));
  await say(app, "北屯三房，兩千萬內");
  act(app, "go-now");
  await goSubmit(app);
  await toStatus(app);
  assert.equal(app.state(), "s7");
  assert.equal(app.$("#s7-comm").hidden, true);
  assert.equal(app.$("#s7-first").hidden, false);
});

async function emptyWith(f, hint, caps = ALL, loadScope = true) {
  const app = await viaFrag(f, { net: fakeNet({ config: () => ({ ...CONFIG, caps }), status: () => ({ ok: true, v: 1, status: "empty", hint }) }) });
  assert.equal(app.state(), "s4");
  await goSubmit(app);
  if (loadScope) await app.loadScope();
  await toStatus(app);
  assert.equal(app.state(), "s8");
  return app;
}
test("s8：社區名冊找不到 → 換個寫法／在地圖上圈（caps 有 geo）／改用區域找；換個寫法開表單、回上一步回 s8", { skip: SKIP }, async () => {
  const app = await emptyWith({ cm: "文化匯" }, ["comm_fix", "scope_drop"]);
  assert.equal(app.text("#s8-title"), "社區名冊裡找不到「文化匯」。可能是字打錯，或是很新的社區。如果你說的是一個地方（像七期、逢甲），可以改用地圖或選區域。也可以直接 LINE 問景泰。");
  assert.deepEqual(hintTexts(app), ["換個寫法找這個社區", "在地圖上圈範圍", "改用區域找"]);
  assert.equal(app.$("#s8-scope-fb").hidden, true);
  assert.equal(app.$$("#hint-list small").length, 0, "新提示按鈕只有一行字");
  click(app.$('[data-hint="sc-comm"]'));
  assert.equal(app.state(), "s1");
  assert.equal(app.$("#scope-comm-in").value, "文化匯");
  sc(app, "back");
  assert.equal(app.state(), "s8");
  const a2 = await emptyWith({ cm: "文化匯" }, ["comm_fix", "scope_drop"], ["community"]);
  assert.deepEqual(hintTexts(a2), ["換個寫法找這個社區", "改用區域找"], "caps 沒有 geo：不給地圖");
  assert.equal(a2.text("#s8-title"), "社區名冊裡找不到「文化匯」。可能是字打錯，或是很新的社區。如果你說的是一個地方（像七期、逢甲），可以改用選區域。也可以直接 LINE 問景泰。", "caps 沒有 geo：說法也不提地圖（審查 W8）");
  click(a2.$('[data-hint="sc-pick"]'));
  assert.equal(a2.state(), "s3");
  assert.equal(a2.text(".u2-tray__q"), "想找哪一區？");
});

test("s8：只有社區、這次沒有 → LINE 問景泰排第一、找別的社區、改用區域找；說法是「這次沒有找到」", { skip: SKIP }, async () => {
  const app = await emptyWith({ cm: "文華匯", d: ["西屯區"] }, ["scope_drop"]);
  assert.equal(app.text("#s8-title"), "這次沒有找到文華匯社區在賣的物件。想請景泰幫你留意，可以按下面的「LINE 問景泰」。");
  assert.deepEqual(hintTexts(app), ["LINE 問景泰", "找別的社區", "改用區域找"]);
  const line = app.$("#hint-list a[data-lineq]");
  assert.equal(line.getAttribute("href"), "/go/line?src=find-empty");
  const row = app.$$('[data-s="s8"] a[data-lineq]').pop().parentNode;
  assert.equal(row.hidden, true, "下面那一顆 LINE 收起來（移到第一個）");
  click(app.$('[data-hint="sc-comm-new"]'));
  assert.equal(app.$("#scope-comm-in").value, "", "找別的社區：輸入框清空");
});

test("s8：社區＋其他條件有放寬 → 原有放寬＋改用區域找、標題接「放寬一點再試試？」；74環內；地圖的四種；用的人多", { skip: SKIP }, async () => {
  let app = await emptyWith({ cm: "文華匯", r: [3, 3] }, ["loosen_rooms", "scope_drop"]);
  assert.equal(app.text("#s8-title"), "這次沒有找到文華匯社區符合條件的物件。放寬一點再試試？想請景泰幫你留意這個社區有沒有新的，可以按下面的「LINE 問景泰」。");
  assert.equal(hintTexts(app)[0].startsWith("房數不限"), true);
  assert.equal(hintTexts(app)[1], "改用區域找");
  app = await emptyWith({ z: "r74", r: [3, 3] }, ["scope_drop"]);
  assert.equal(app.text("#s8-title"), "74環內這次沒有找到符合條件的物件。", "沒有放寬按鈕：不接「放寬一點」");
  assert.deepEqual(hintTexts(app), ["改用區域找"]);
  app = await emptyWith({ z: "r74", pmax: 2000 }, ["loosen_price", "scope_drop"]);
  assert.equal(app.text("#s8-title"), "74環內這次沒有找到符合條件的物件。放寬一點再試試？");
  app = await emptyWith({ z: "r74" }, ["scope_busy"]);
  assert.equal(app.text("#s8-title"), "這種找法現在用的人比較多，這次先沒有找。可以改用區域找，或晚一點再試。");
  assert.deepEqual(hintTexts(app), ["改用區域找"]);
});

test("s8（地圖）：跨太多區／不在台中／這一塊沒看到／只看了一部分（不說「沒有在賣」）", { skip: SKIP }, async () => {
  // 地圖範圍不進 #k 片段：先用片段帶條件，再用範圍模組把範圍放進去
  async function geoEmpty(hint) {
    const app = await boot({ net: fakeNet({ status: () => ({ ok: true, v: 1, status: "empty", hint }) }), preloadScope: true });
    const log = fakeMap(app.win);
    click(entry(app, "geo"));
    app.win.__mapOpts.onDone(SQ);
    click(app.$('[data-act="go-now"]') || app.$("#s3-direct [data-act]"));
    if (app.state() === "s3") act(app, "nudge-no");
    assert.equal(app.state(), "s4");
    await goSubmit(app);
    await toStatus(app);
    void log;
    return app;
  }
  let app = await geoEmpty(["geo_smaller"]);
  assert.equal(app.text("#s8-title"), "這個範圍跨了太多區，一次找不完。範圍小一點再試試？");
  assert.deepEqual(hintTexts(app), ["把範圍縮小一點"]);
  click(app.$('[data-hint="sc-shrink"]'));
  assert.equal(app.state(), "s1");
  assert.deepEqual(plain(app.win.__mapOpts.poly), SQ, "帶原範圍");
  app = await geoEmpty(["geo_out"]);
  assert.equal(app.text("#s8-title"), "這個範圍不在台中市。換到台中市內再試試？");
  assert.deepEqual(hintTexts(app), ["重新選一個範圍"]);
  app = await geoEmpty(["geo_redraw", "scope_drop"]);
  assert.equal(app.text("#s8-title"), "地圖上這一塊，這次沒看到在賣的物件。換個地方，或範圍大一點？");
  assert.deepEqual(hintTexts(app), ["重新選一個範圍", "改用區域找"]);
  app = await geoEmpty(["geo_partial", "scope_drop"]);
  assert.equal(app.text("#s8-title"), "這一塊在賣的不少，但這次只看了最新上架的一部分，裡面沒有符合條件的。加預算或房數條件，或改用選區域，會比較準。");
  assert.deepEqual(hintTexts(app), ["改用區域找", "重新選一個範圍"]);
});

test("s8：有範圍、範圍模組載不到、提示碼一個都不認得 → 只有「這次沒有找到…改用選區域」＋LINE，沒有舊的三顆放寬", { skip: SKIP }, async () => {
  const app = await viaFrag({ cm: "文華匯" }, { net: fakeNet({ status: () => ({ ok: true, v: 1, status: "empty", hint: ["comm_fix", "scope_drop"] }) }) });
  await goSubmit(app);
  app.scripts(/find-scope/)[0].onerror();   // 等待時預載就失敗
  await toStatus(app);
  assert.equal(app.state(), "s8");
  assert.equal(app.$("#s8-scope-fb").hidden, false);
  assert.match(app.text("#s8-scope-fb"), /^\s*可以改用區域找，或 LINE 問景泰。/);
  // 審查 W7：標題的「放寬一點再試試？」與副標「點一下就會改條件」由 CSS（:has）在退路出現時收起來
  assert.equal(app.text("#s8-title"), "這次沒有找到完全符合的。放寬一點再試試？");
  assert.equal(app.$("#s8-title .u2-s8-more").textContent, "放寬一點再試試？");
  assert.ok(CSS_SRC.includes('[data-s="s8"]:has(#s8-scope-fb:not([hidden])) :is(.u2-s8-more, #s8-title + .u2-small) { display: none; }'));
  assert.equal(app.$$("#hint-list li").length, 0, "不用舊的退回清單");
  assert.ok(app.$('[data-s="s8"] a[data-lineq]'));
  click(app.$('#s8-scope-fb [data-act="pick"]'));
  assert.equal(app.state(), "s3");
  // 一般（沒有範圍）的空結果完全照舊
  const a2 = await boot({ net: fakeNet({ status: () => ({ ok: true, v: 1, status: "empty", hint: null }) }) });
  await say(a2, "北屯三房，兩千萬內");
  act(a2, "go-now");
  await goSubmit(a2);
  await toStatus(a2);
  assert.deepEqual(a2.$$("#hint-list [data-hint]").map(b => b.getAttribute("data-hint")), ["loosen_price", "loosen_district", "drop_floor"]);
  assert.equal(a2.$("#s8-scope-fb").hidden, true);
  assert.equal(a2.scripts(/find-scope/).length, 0);
});

test("s8：範圍的說法用過之後，下一次一般的空結果換回原本的標題、說明與 LINE 那一列", { skip: SKIP }, async () => {
  let n = 0;
  const hints = [["scope_drop"], ["loosen_price"]];
  const app = await viaFrag({ cm: "文華匯" }, { net: fakeNet({ status: () => ({ ok: true, v: 1, status: "empty", hint: hints[Math.min(1, n++)] }) }) });
  await goSubmit(app);
  await app.loadScope();
  await toStatus(app);
  assert.match(app.text("#s8-title"), /這次沒有找到文華匯社區在賣的物件/);
  click(app.$("#clear-btn"));
  await say(app, "北屯三房，兩千萬內");
  act(app, "go-now");
  await goSubmit(app);
  await toStatus(app);
  assert.equal(app.state(), "s8");
  assert.equal(app.text("#s8-title"), "這次沒有找到完全符合的。放寬一點再試試？");
  assert.equal(app.$('[data-s="s8"] .u2-bubble .u2-small').hidden, false);
  assert.equal(app.$$('[data-s="s8"] a[data-lineq]').length, 1);
  assert.equal(app.$$('[data-s="s8"] a[data-lineq]')[0].parentNode.hidden, false);
  assert.deepEqual(app.$$("#hint-list [data-hint]").map(b => b.getAttribute("data-hint")), ["loosen_price"]);
});

/* ===================== 其他掛勾 ===================== */
test("用選的就好：先拿掉社區／74環內／地圖；重新整理時 s1 存成進來前那一步", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true });
  await say(app, "文華匯社區三房");
  act(app, "go-now");
  click(app.$('[data-edit="scope"]'));
  assert.equal(app.state(), "s1");
  assert.equal(JSON.parse(app.win.sessionStorage.getItem("find.v1")).step, "s4", "s1 存成 s4");
  click(app.$('#scope-comm [data-sc="pick"]'));
  assert.equal(app.state(), "s3");
  assert.deepEqual(Object.keys(JSON.parse(app.win.sessionStorage.getItem("find.v1")).fields), ["rooms_min", "rooms_max"]);
  // 存檔回來：s4 的條件還在
  const saved = { sid: "Qw3kT9xLm2PzR8aVb5NcDe", step: "s4", fields: { community: "文華匯", rooms_min: 3, rooms_max: 3 }, context: {} };
  const a2 = await boot({ session: { "find.v1": JSON.stringify(saved) } });
  assert.equal(a2.state(), "s4");
  assert.deepEqual(rows(a2).slice(0, 1), ["範圍文華匯社區"]);
});

test("用選的就好：選區域那一題下面有「也可以：」範圍入口（按鈕照 caps）；其他題目沒有；按了從 s3 進範圍畫面、回上一步回到那一題", { skip: SKIP }, async () => {
  const app = await boot({ preloadScope: true, net: fakeNet({ config: () => ({ ...CONFIG, caps: ["community", "geo"] }) }) });
  click(app.$("#pick-btn"));
  assert.equal(app.text(".u2-tray__q"), "想找哪一區？");
  assert.equal(app.$("#s3-alt").hidden, false);
  assert.equal(app.text("#s3-alt .u2-scope-entry__t"), "也可以：");
  assert.deepEqual(app.$$("#s3-alt [data-scope]").map(b => b.hidden), [false, true, false]);
  click(app.$('#s3-alt [data-scope="community"]'));
  assert.equal(app.state(), "s1");
  sc(app, "back");
  assert.equal(app.state(), "s3");
  assert.equal(app.text(".u2-tray__q"), "想找哪一區？", "回到原本那一題");
  click(app.$('[data-act="q-skip"]'));
  assert.notEqual(app.text(".u2-tray__q"), "想找哪一區？");
  assert.equal(app.$("#s3-alt").hidden, true, "其他題目不放");
  // 家用機不支援：選區域也不放
  const a2 = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: [] }) }) });
  click(a2.$("#pick-btn"));
  assert.equal(a2.$("#s3-alt").hidden, true);
});

/* ===================== 靜態稽核 ===================== */
test("find-scope.js 靜態：IIFE、不用 innerHTML、沒有動態執行、沒有任何外部網址與網路請求、沒有儲存；體積在預算內（LF 量測）", () => {
  const code = SCOPE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");
  assert.match(SCOPE_SRC, /^\/\*![\s\S]*?\*\/\s*\(function \(root\) \{/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"]/.test(code));
  assert.ok(!/https?:|\/\/[a-z0-9-]+\.[a-z]{2,}/i.test(code.split("http://www.w3.org/2000/svg").join("")), "沒有外部網址（SVG 命名空間字串除外）");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|document\.cookie|importScripts/.test(code));
  assert.ok(!/\/api\/find\//.test(code), "不直接打 API：條件與畫面都走 find-app 給的 api");
  assert.ok(!/wmts|nlsc/i.test(code), "地圖圖片網址只在 find-map.js");
  const raw = Buffer.byteLength(SCOPE_SRC.replace(/\r\n/g, "\n"));
  const min = transformSync(SCOPE_SRC, { minify: true, loader: "js", charset: "utf8", legalComments: "none" }).code;
  assert.ok(raw <= 18 * 1024, `原始檔 ${raw}`);
  assert.ok(zlib.gzipSync(min).length <= 6 * 1024, `gzip ${zlib.gzipSync(min).length}`);
});

test("find-app.js 接線：範圍模組網址從頁面拿（不寫死檔名）；不知道地圖的存在；api 只給規格那幾個", () => {
  const code = APP_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");
  assert.ok(!code.includes("find-scope.js") && !code.includes("find-map") && !/FindMap|leaflet/i.test(code));
  assert.match(APP_SRC, /var p = \$\('\[data-s="s1"\]'\)/);
  assert.match(APP_SRC, /s\.src = p\.getAttribute\('data-src'\);/);
  assert.match(APP_SRC, /var SCOPE_API = \{ S: function \(\) \{ return S; \}, show: show, track: track, startedHow: startedHow, toConfirm: toConfirm, enterQuestions: enterQuestions, pickMode: pickMode, persist: persist \};/);
  assert.match(APP_SRC, /FOCUS = \{ s1: '#scope-h'/);
});

test("find.astro：s1 骨架、入口（預設藏起來）、#s7-comm、#s8-scope-fb、版本號、檔頭說明；新文字都在頁面上（find-app 只切換）", () => {
  for (const v of ["vScope", "vMap", "vMapCss"]) assert.match(PAGE_SRC, new RegExp(`const ${v} = fileVer\\("public/js/find-(?:scope|map)\\.(?:js|css)"\\);`));
  assert.match(PAGE_SRC, /<div class="u2-state" data-s="s1" tabindex="-1" hidden data-src=\{`\/js\/find-scope\.js\?v=\$\{vScope\}`\}>/);
  assert.match(PAGE_SRC, /id="scope-map" class="u2-scope" hidden data-src=\{`\/js\/find-map\.js\?v=\$\{vMap\}`\} data-lib="\/js\/vendor\/leaflet\/1\.9\.4\/leaflet\.js" data-css="\/js\/vendor\/leaflet\/1\.9\.4\/leaflet\.css" data-mcss=\{`\/js\/find-map\.css\?v=\$\{vMapCss\}`\}>/);
  assert.match(PAGE_SRC, /<div class="u2-scope-entry" id="scope-entry" hidden>/);
  assert.match(PAGE_SRC, /<div class="u2-scope-entry" id="s3-alt" hidden>\s*<p class="u2-scope-entry__t">也可以：<\/p>/);
  for (const k of ["community", "zone", "geo"]) assert.match(PAGE_SRC, new RegExp(`data-scope="${k}" data-busy="開啟中…" hidden>`));
  assert.match(PAGE_SRC, /id="scope-entry-err" role="alert" hidden>這個功能暫時打不開。/);
  assert.match(PAGE_SRC, /<p class="u2-scope__note" id="s7-comm" hidden>/);
  assert.match(PAGE_SRC, /id="s8-scope-fb" hidden>/);
  assert.match(PAGE_SRC, /不得出現搜尋來源的任何痕跡；地圖圖片服務例外/);
  assert.ok(!/<script[^>]*find-(?:scope|map)/.test(PAGE_SRC), "不在首載");
  // s1 在 s0 與 s2 之間
  assert.ok(PAGE_SRC.indexOf('data-s="s0"') < PAGE_SRC.indexOf('data-s="s1"') && PAGE_SRC.indexOf('data-s="s1"') < PAGE_SRC.indexOf('data-s="s2"'));
});

test("範圍的樣式：字一律 ≥17px（不用 fs-0／fs-1）、只用設計系統色彩 token；新元件不用 u2-small／u2-cap", () => {
  const css = CSS_SRC.slice(CSS_SRC.indexOf("/* ---------- 其他找法"));
  assert.ok(css.length > 300);
  assert.ok(!/--u2-fs-[01]\b/.test(css));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(css));
  assert.match(css, /@media \(max-width: 359px\)/);
  const s1 = PAGE_SRC.slice(PAGE_SRC.indexOf('data-s="s1"'), PAGE_SRC.indexOf('data-s="s2"'));
  assert.ok(!/u2-small|u2-cap/.test(s1));
  const entryHtml = PAGE_SRC.slice(PAGE_SRC.indexOf('id="scope-entry"'), PAGE_SRC.indexOf('id="scope-entry-err"'));
  assert.ok(!/u2-small|u2-cap/.test(entryHtml));
  assert.ok(!/u2-small|u2-cap/.test(SCOPE_SRC.replace(/'\.u2-small'/g, "")), "find-scope 不產生小字（只讀取 s8 原本那一句來切換）");
});

/* ===================== 2026-10-09 審查修正（W1～W8）的回歸測試 ===================== */
test("審查 W1：#k 帶社區、家用機這次不支援（caps 空）→ 按開始找不送、先拿掉範圍並在確認畫面說明；再按一次才問區域（不送空條件）", { skip: SKIP }, async () => {
  const app = await viaFrag({ cm: "文華匯" }, { net: fakeNet({ config: () => ({ ...CONFIG, caps: [] }) }) });
  assert.equal(app.state(), "s4");
  assert.deepEqual(rows(app)[0], "範圍文華匯社區", "設定可能晚到：先照片段畫");
  assert.equal(app.$("#s4-scope-gone").hidden, true);
  await goSubmit(app);
  assert.equal(app.net.by("submit").length, 0, "不能靜靜拿掉就送出（原本送出的是空條件）");
  assert.equal(app.state(), "s4");
  assert.equal(rows(app)[0], "區域不限");
  assert.equal(app.$("#s4-scope-gone").hidden, false);
  assert.equal(app.text("#s4-scope-gone"), "你選的這種找法（社區、74環內或地圖）現在暫時不能用，已經先拿掉了。可以改選區域，再按一次「開始找」。");
  assert.equal(app.$("#s4-scope-gone").getAttribute("role"), "alert");
  click(app.$("#go-btn"));
  await flush();
  assert.equal(app.net.by("submit").length, 0, "一個條件都沒有：照舊不送");
  assert.equal(app.state(), "s3");
  assert.match(app.text("#s3-chat"), /至少要有一個條件/);
});

test("審查 W1：重新開始後 caps 照樣生效（cfgOk 不重設）：caps 只有社區時「74環內三房，北屯區」→ s2／確認畫面／送出中／送出的條件都沒有 74環內", { skip: SKIP }, async () => {
  const app = await boot({ net: fakeNet({ config: () => ({ ...CONFIG, caps: ["community"] }) }) });
  click(app.$("#clear-btn"));
  assert.equal(app.state(), "s0");
  await say(app, "74環內三房，北屯區");
  const tags = app.$$("#s2-chat .u2-tag").map(t => t.textContent);
  assert.deepEqual(tags, ["北屯區", "3 房"]);
  assert.equal(app.scripts(/find-scope/).length, 1, "s2 要說明：載入範圍模組");
  await app.loadScope();
  assert.match(app.text("#s2-chat"), /你說的這種找法（社區、74環內或地圖）現在暫時不能用/);
  act(app, "go-now");
  assert.equal(app.state(), "s4");
  assert.equal(rows(app)[0], "區域北屯區");
  assert.equal(app.$("#s4-scope-gone").hidden, false, "確認畫面也說一句");
  await goSubmit(app);
  const body = app.net.by("submit")[0].body;
  assert.deepEqual(body.fields, { districts: ["北屯區"], rooms_min: 3, rooms_max: 3 });
  assert.doesNotMatch(app.text("#s5-tags"), /74環內/);
  // 之後改用有支援的社區：說明收起來（不會跟需求單上的「範圍」打架）
  click(app.$("#clear-btn"));
  await say(app, "74環內三房");
  act(app, "go-now");
  assert.equal(app.$("#s4-scope-gone").hidden, false);
  click(app.$("#sheet-rows [data-edit='district']"));
  assert.equal(app.state(), "s3");
  click(app.$('#s3-alt [data-scope="community"]'));
  type(app.$("#scope-comm-in"), "文華匯");
  submit(app.$("#scope-comm"));
  assert.equal(app.state(), "s4");
  assert.equal(rows(app)[0], "範圍文華匯社區");
  assert.equal(app.$("#s4-scope-gone").hidden, true);
  // 再重新開始：說明收起來
  click(app.$("#clear-btn"));
  await say(app, "西屯兩房");
  act(app, "go-now");
  assert.equal(app.$("#s4-scope-gone").hidden, true);
});

test("審查 W2：範圍模組比結果晚到 → 載好後 s7 照樣換成社區那一句、s8 照樣換成名冊找不到的說法與按鈕", { skip: SKIP }, async () => {
  const app = await viaFrag({ cm: "文華匯" }, { net: fakeNet({ status: () => ({ ok: true, v: 1, status: "done", count: 5, shareUrl: SHARE }) }) });
  await goSubmit(app);
  assert.equal(app.scripts(/find-scope/).length, 1, "等待時預載");
  await toStatus(app);
  assert.equal(app.state(), "s7");
  await app.loadScope();
  assert.equal(app.$("#s7-comm").hidden, false);
  assert.equal(app.$("#s7-first").hidden, true);
  const a2 = await viaFrag({ cm: "文化匯" }, { net: fakeNet({ status: () => ({ ok: true, v: 1, status: "empty", hint: ["comm_fix", "scope_drop"] }) }) });
  await goSubmit(a2);
  await toStatus(a2);
  assert.equal(a2.state(), "s8");
  assert.equal(a2.$("#s8-scope-fb").hidden, false, "模組還沒到：先顯示退路");
  assert.equal(a2.scripts(/find-scope/).length, 1, "不重複載");
  await a2.loadScope();
  assert.match(a2.text("#s8-title"), /^社區名冊裡找不到「文化匯」/);
  assert.deepEqual(hintTexts(a2), ["換個寫法找這個社區", "在地圖上圈範圍", "改用區域找"]);
  assert.equal(a2.$("#s8-scope-fb").hidden, true);
});

test("審查 W2：背景載入（s2 掛勾）還沒好就按入口 → 不會被丟掉，載好就開那個面板", { skip: SKIP }, async () => {
  const app = await boot();
  await say(app, "文華匯");
  assert.equal(app.scripts(/find-scope/).length, 1, "s2 掛勾在背景載入");
  click(app.$("#s2-actions [data-act='pick']"));
  assert.equal(app.state(), "s3");
  click(app.$('#s3-alt [data-scope="zone"]'));
  assert.equal(app.scripts(/find-scope/).length, 1, "不重複載");
  await app.loadScope();
  assert.equal(app.state(), "s1");
  assert.equal(app.text("#scope-h"), "74環內");
});

test("審查 W5：確認畫面「範圍｜改」載入前後，按鈕的子節點都不變（不換成空白、讀屏字不被攤平）", { skip: SKIP }, async () => {
  const app = await viaFrag({ cm: "文華匯" });
  const btn = app.$('#sheet-rows [data-edit="scope"]');
  const shape = () => btn.childNodes.map(n => (n.localName || "#text") + ":" + n.textContent + ":" + (n.className || ""));
  const before = shape();
  assert.deepEqual(before, ["#text:改:", "span:範圍:u2-sr"]);
  click(btn);
  assert.deepEqual(shape(), before, "載入中");
  assert.equal(btn.getAttribute("aria-busy"), null);
  await app.loadScope();
  assert.equal(app.state(), "s1");
  sc(app, "back");
  assert.equal(app.state(), "s4");
  assert.deepEqual(shape(), before, "回來之後");
});

test("審查 W6：s3 的入口載不到 → 錯誤字出在 s3 那一塊；背景載入失敗不開任何錯誤字；重新開始沒有殘留", { skip: SKIP }, async () => {
  const app = await boot();
  click(app.$("#pick-btn"));
  assert.equal(app.state(), "s3");
  const b = app.$('#s3-alt [data-scope="zone"]');
  click(b);
  assert.equal(b.textContent, "開啟中…");
  app.scripts(/find-scope/)[0].onerror();
  assert.equal(b.textContent, "74環內（舊市區）");
  assert.equal(app.$("#s3-alt-err").hidden, false);
  assert.equal(app.$("#s3-alt-err").getAttribute("role"), "alert");
  assert.equal(app.text("#s3-alt-err"), "這個功能暫時打不開。可以直接在上面選區域。");
  assert.equal(app.$("#scope-entry-err").hidden, true, "不是開場那一塊");
  const a2 = await viaFrag({ cm: "文華匯" });
  await goSubmit(a2);
  a2.scripts(/find-scope/)[0].onerror();   // 等待時的預載失敗
  assert.equal(a2.$("#scope-entry-err").hidden, true);
  assert.equal(a2.$("#s3-alt-err").hidden, true);
  click(a2.$("#clear-btn"));
  assert.equal(a2.state(), "s0");
  assert.equal(a2.$("#scope-entry-err").hidden, true, "重新開始：沒有「這個功能暫時打不開」殘留");
  // s2 掛勾載不到：也不開
  const a3 = await boot();
  await say(a3, "文華匯");
  a3.scripts(/find-scope/)[0].onerror();
  assert.equal(a3.$("#scope-entry-err").hidden, true);
});

test("審查 W3：打招呼、測試字、聊天字不問「是社區的名字嗎？」；只打社區名照樣問", () => {
  const FSC = (() => { const m = { exports: {} }; vm.runInThisContext(`(function(module){${SCOPE_SRC}\n})`)(m); return m.exports; })();
  const NEx = loadClassicNE();
  const g = t => FSC.guess(NEx.extract(t).rest, NEx.normalizeFields);
  for (const t of ["謝謝", "謝啦", "測試", "測試一下", "hello", "Hello", "hi", "HI", "hey", "test", "TEST", "ok", "OK", "asdf", "qwe", "隨便", "不知道", "不確定", "早安", "午安", "晚安",
    "我想問一下", "請教一下", "小資", "新婚", "換屋", "哈囉", "哈哈", "嗨", "安安", "你好"]) assert.equal(g(t), null, t);
  for (const [t, want] of [["文華匯", "文華匯"], ["文華匯三房", "文華匯"], ["文華匯 3房 2000萬", "文華匯"], ["文華匯的物件", "文華匯"], ["想看文華匯", "文華匯"], ["文華匯有嗎", "文華匯"],
    ["惠宇樂觀", "惠宇樂觀"], ["VVS1", "VVS1"]]) assert.equal(g(t), want, t);
});

test("審查 W8：名冊找不到的說法跟按鈕一致（沒有地圖就不提地圖）；不接「留意有沒有新的」；引號一律「」", () => {
  const FSC = (() => { const m = { exports: {} }; vm.runInThisContext(`(function(module){${SCOPE_SRC}\n})`)(m); return m.exports; })();
  const p1 = FSC.emptyPlan({ community: "文化匯" }, ["comm_fix", "scope_drop"], 0, ["community"]);
  assert.equal(p1.t, "社區名冊裡找不到「文化匯」。可能是字打錯，或是很新的社區。如果你說的是一個地方（像七期、逢甲），可以改用選區域。也可以直接 LINE 問景泰。");
  assert.deepEqual(p1.b, ["sc-comm", "sc-pick"]);
  const p2 = FSC.emptyPlan({ community: "文化匯" }, ["comm_fix"], 0, ["community", "geo"]);
  assert.match(p2.t, /可以改用地圖或選區域。也可以直接 LINE 問景泰。$/);
  assert.deepEqual(p2.b, ["sc-comm", "sc-map", "sc-pick"]);
  assert.ok(!/留意這個社區有沒有新的/.test(p1.t + p2.t));
  assert.ok(!/[『』]LINE/.test(JSON.stringify(FSC.T)), "LINE 問景泰的引號統一用「」");
});
