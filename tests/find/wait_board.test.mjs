// 等待小遊戲「蓋大樓」排行榜：public/js/wait-board.js ＋ find-app.js 的接線（2026-10-07）。
// 用建置好的 /find/ 標記（dist/find/index.html）＋假 DOM＋假網路＋假時鐘，檢查：
//   送分數的時機與欄位、沒有工作編號不送、暱稱只用 textContent、分頁切換、留暱稱再送一次、失敗靜默、不擋結果頁、事件只記計數。
// 需要先建置（astro build）；dist 沒有 #wait-board（建置太舊）或找不到 parse5 就跳過畫面測試（靜態檢查照跑）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { transformSync } from "esbuild";
import { ROOT, bundleTs, requireClassic } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock, flush, click, submit, type } from "./fake_dom.mjs";

const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HTML_PATH = path.join(DIST, "find", "index.html");
const parse5 = await loadParse5();
const HTML = fs.existsSync(HTML_PATH) ? fs.readFileSync(HTML_PATH, "utf8") : "";
const SKIP = !HTML || !parse5 ? "需要先建置（dist/find/index.html）且 node_modules 內有 parse5"
  : !HTML.includes('id="wait-board"') ? "dist 是舊的建置（沒有 #wait-board），請重新建置" : false;
const NEED_SRC = fs.readFileSync(path.join(ROOT, "public/js/need-extract.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-app.js"), "utf8");
const BOARD_SRC = fs.readFileSync(path.join(ROOT, "public/js/wait-board.js"), "utf8");
const PAGE_SRC = fs.readFileSync(path.join(ROOT, "src/pages/find.astro"), "utf8");
const CSS_SRC = fs.readFileSync(path.join(ROOT, "src/styles/ui2-find.css"), "utf8");
const S = (await bundleTs("src/lib/find/schema.ts")).mod;
const SC = (await bundleTs("src/lib/find/score.ts")).mod;
const WB = requireClassic("public/js/wait-board.js");

const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const JOB2 = "aQ7wE4rT1yU6iO9pA2sD5fG";
const SHARE = "https://teddy-house.tw/share/qa008kmn3x7q2pzrtavb5ncdetwoxy4k/";
const CONFIG = { ok: true, v: 1, mode: "live", turnstileSiteKey: null, needMax: 300, consentV: "2026-10-06", tplV: 1 };
const OTHERS = [{ name: "阿明", floors: 30 }, { name: "小華", floors: 20 }, { name: "訪客A1B2", floors: 8 }];

/* 假網路：score／top 照合約回（同一筆需求只留最高、同層再送可改暱稱）；over 可以整個換掉某個端點（第三個參數拿得到預設的 base）；
   端點可以回 Promise（測「送出中」）。filter＝伺服器的暱稱過濾（預設照收；回「訪客XXXX」＝沒通過） */
function lbNet(over = {}, filter = n => n) {
  const calls = [];
  const mine = new Map();
  let jobs = 0;
  function topView(id) {
    const all = [...OTHERS.map(o => ({ ...o, jid: null })), ...[...mine].map(([jid, r]) => ({ ...r, jid }))]
      .sort((a, b) => b.floors - a.floors);
    const list = all.slice(0, 10).map((r, i) => ({ rank: i + 1, name: r.name || "訪客", floors: r.floors }));
    const idx = id ? all.findIndex(r => r.jid === id) : -1;
    return { ok: true, v: 1, week: list, all: list, me: idx >= 0 ? { rank: idx + 1, floors: all[idx].floors, weekRank: idx + 1 } : null };
  }
  const base = {
    config: () => CONFIG,
    submit: () => ({ ok: true, v: 1, status: "queued", jobId: ++jobs === 1 ? JOB : JOB2, queue: { ahead: 0, eta_s: 60 }, saved: true, pollMs: 4000 }),
    status: () => ({ ok: true, v: 1, status: "searching" }),
    contact: () => ({ ok: true, v: 1, saved: true }),
    event: () => ({ ok: true }),
    feedback: () => ({ ok: true, v: 1 }),
    score: b => {
      if (b.floors > 0) {
        const o = mine.get(b.jobId);
        const nm = b.name ? filter(b.name) : "";
        if (!o || b.floors > o.floors) mine.set(b.jobId, { floors: b.floors, name: nm || (o && o.name) || "" });
        else if (b.floors === o.floors && nm) o.name = nm;
      }
      return { ok: true, v: 1, saved: true };
    },
    top: (b, url) => topView(new URL(url, "https://x.invalid").searchParams.get("id")),
  };
  const routes = { ...base, ...over };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: init.method || "GET", body });
    const key = u.replace("/api/find/", "").split("?")[0];
    if (!(key in routes)) throw new Error("測試不准連到：" + u);
    const out = await routes[key](body, u, base);
    if (out instanceof Error) throw out;
    if (out instanceof Response) return out;
    return Response.json(out);
  };
  return { calls, fetchImpl, mine, by: k => calls.filter(c => c.url.includes("/api/find/" + k)) };
}

/* 假的遊戲：記下 find-app 給的 onEvent，測試自己決定什麼時候「結束一局」 */
function fakeGame(state = {}) {
  const g = { opts: null, state: { status: "over", perfects: 0, ...state }, destroyed: false, mounted: 0 };
  g.mount = (el, o) => { g.opts = o; g.mounted++; return { getState: () => ({ ...g.state }), skip() {}, destroy() { g.destroyed = true; } }; };
  g.over = (score, ms = 30000) => g.opts.onEvent({ type: "over", score, points: score * 10, plays: 1, durationMs: ms });
  return g;
}

async function boot({ net = lbNet(), game = fakeGame(), preload = true, session = {}, config } = {}) {
  if (config) net = lbNet({ config: () => config });
  const clock = makeClock();
  const { doc, win } = makeEnv({ html: HTML, parse5, fetchImpl: net.fetchImpl, clock, sessionData: session });
  win.mountWaitGame = game.mount;
  win.WaitGameCore = { scoreBucket: () => 1 };
  const ctx = vm.createContext(win);
  if (preload) vm.runInContext(BOARD_SRC, ctx, { filename: "wait-board.js" });
  vm.runInContext(NEED_SRC, ctx, { filename: "need-extract.js" });
  vm.runInContext(APP_SRC, ctx, { filename: "find-app.js" });
  await flush();
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => doc.querySelectorAll(sel);
  const state = () => ($$(".u2-state").find(d => !d.hidden) || {}).getAttribute?.("data-s");
  const text = sel => ($(sel) || { textContent: "" }).textContent;
  const events = () => {
    const out = [];
    net.by("event").forEach(c => { if (c.body && c.body.events) out.push(...c.body.events); });
    win.__beacons.forEach(b => { try { out.push(...JSON.parse(b.blob.__text).events); } catch { /* ignore */ } });
    return out;
  };
  const rows = () => $$("#lb-list li").map(li => ({
    rank: li.querySelector(".u2-lb__rk").textContent, name: li.querySelector(".u2-lb__nm").textContent,
    floors: li.querySelector(".u2-lb__fl").textContent, me: li.className.includes("is-me"), you: !!li.querySelector(".u2-lb__you"),
  }));
  return { clock, doc, win, ctx, net, game, $, $$, state, text, events, rows };
}
globalThis.Blob = class extends Blob { constructor(parts, opt) { super(parts, opt); this.__text = parts.join(""); } };
const settle = async () => { await flush(); await flush(); };

/* 走到等待畫面（s6）：一句話→直接開始→送出 */
async function toWaiting(app) {
  type(app.$("#free-text"), "南屯兩房，1800萬以內");
  submit(app.$("#free-form"));
  await flush();
  click(app.$('[data-act="go-now"]'));
  await app.clock.advance(6000);
  click(app.$("#go-btn"));
  await settle();
  assert.equal(app.state(), "s6");
}

/* ===================== 送分數的時機與欄位 ===================== */
test("玩完一局才送：欄位照合約（jobId／floors／ms／perfect），沒暱稱就不帶 name；送完拿自己的名次並顯示排行榜", { skip: SKIP }, async () => {
  const app = await boot();
  await toWaiting(app);
  assert.equal(app.$("#wait-board").hidden, true, "還沒玩完一局：排行榜不出現");
  assert.equal(app.net.by("score").length + app.net.by("top").length, 0, "還沒玩完一局：不連排行榜");
  app.game.state.perfects = 3;
  app.game.over(12, 34567);
  await settle();
  const sc = app.net.by("score");
  assert.equal(sc.length, 1);
  assert.equal(sc[0].method, "POST");
  assert.deepEqual(sc[0].body, { jobId: JOB, floors: 12, ms: 34567, perfect: 3 });
  const top = app.net.by("top");
  assert.equal(top.length, 1);
  assert.equal(top[0].url, "/api/find/top?id=" + JOB);
  assert.equal(app.$("#wait-board").hidden, false);
  assert.deepEqual(app.rows().map(r => [r.rank, r.name, r.floors, r.me, r.you]), [
    ["1", "阿明", "30 層", false, false], ["2", "小華", "20 層", false, false], ["3", "訪客", "12 層", true, true], ["4", "訪客A1B2", "8 層", false, false],
  ]);
  assert.equal(app.$("#lb-empty").hidden, true);
  assert.equal(app.$("#lb-me").hidden, true, "自己在榜上：不用另外一行");
  assert.equal(app.$("#lb-form").hidden, false, "破紀錄而且送到了：問要不要留暱稱");
  assert.equal(app.text("#lb-live"), "排行榜更新了：你在本週第 3 名。");
  assert.equal(app.state(), "s6", "排行榜不影響等待");
});

test("同一筆需求：沒破自己的紀錄不重送（30 秒內也不重拿榜）；破紀錄才再送；0 層不送", { skip: SKIP }, async () => {
  const app = await boot();
  await toWaiting(app);
  app.game.over(0, 4000);
  await settle();
  assert.equal(app.net.by("score").length, 0, "0 層不上榜、不送");
  assert.equal(app.net.by("top").length, 1, "第一次玩完還是給他看榜");
  assert.equal(app.$("#wait-board").hidden, false);
  assert.equal(app.$("#lb-form").hidden, true, "沒有成績不問暱稱");
  app.game.over(9, 20000);
  await settle();
  app.game.over(5, 15000);
  await settle();
  assert.deepEqual(app.net.by("score").map(c => c.body.floors), [9], "5 層沒破 9 層：不送");
  assert.equal(app.net.by("top").length, 2, "沒破紀錄、30 秒內：沿用剛剛的榜");
  await app.clock.advance(31000);
  app.game.over(3, 9000);
  await settle();
  assert.equal(app.net.by("top").length, 3, "超過 30 秒：重新拿一次榜");
  app.game.over(14, 40000);
  await settle();
  assert.deepEqual(app.net.by("score").map(c => c.body.floors), [9, 14]);
});

test("數值夾在合約範圍內：層數 ≤300、毫秒 ≥0、完美次數不超過層數", { skip: SKIP }, async () => {
  const app = await boot({ game: fakeGame({ perfects: 999 }) });
  await toWaiting(app);
  app.game.over(500, -5);
  await settle();
  assert.deepEqual(app.net.by("score")[0].body, { jobId: JOB, floors: 300, ms: 0, perfect: 300 });
});

/* ===================== 沒有工作編號不送 ===================== */
test("沒有工作編號：收件／降級模式沒有遊戲、不連排行榜；重新開始後舊遊戲的結束事件也不送", { skip: SKIP }, async () => {
  // 降級（沒有 jobId）：沒有等待畫面、沒有遊戲
  const net = lbNet({ submit: () => ({ ok: true, v: 1, status: "degraded", kind: "general", saved: true }) });
  const app = await boot({ net });
  type(app.$("#free-text"), "南屯兩房，1800萬以內");
  submit(app.$("#free-form"));
  await flush();
  click(app.$('[data-act="go-now"]'));
  await app.clock.advance(6000);
  click(app.$("#go-btn"));
  await settle();
  assert.equal(app.state(), "s9");
  assert.equal(app.game.mounted, 0);
  assert.equal(app.$("#wait-board").hidden, true);
  assert.equal(app.net.by("score").length + app.net.by("top").length, 0);

  // 收件模式（設定說 intake）：同樣沒有遊戲
  const app2 = await boot({ config: { ...CONFIG, mode: "intake" } });
  type(app2.$("#free-text"), "南屯兩房，1800萬以內");
  submit(app2.$("#free-form"));
  await flush();
  click(app2.$('[data-act="go-now"]'));
  await app2.clock.advance(6000);
  click(app2.$("#go-btn"));
  await settle();
  assert.equal(app2.game.mounted, 0);
  assert.equal(app2.net.by("score").length + app2.net.by("top").length, 0);

  // 等待中按「重新開始」：工作編號清掉，舊遊戲之後才傳來的結束事件不送
  const app3 = await boot();
  await toWaiting(app3);
  click(app3.$("#clear-btn"));
  await flush();
  assert.equal(app3.state(), "s0");
  app3.game.over(12, 30000);
  await settle();
  assert.equal(app3.net.by("score").length + app3.net.by("top").length, 0);
});

test("WaitBoard.over 自己也擋：工作編號不合格式就不顯示、不連線", { skip: SKIP }, async () => {
  const app = await boot();
  for (const bad of [null, undefined, "", "abc", "a" + "x".repeat(21), "b" + "x".repeat(22), JOB + "!"]) app.win.WaitBoard.over(bad, { score: 10, durationMs: 1000 }, {}, () => {});
  await settle();
  assert.equal(app.$("#wait-board").hidden, true);
  assert.equal(app.net.by("score").length + app.net.by("top").length, 0);
});

/* ===================== 暱稱只用 textContent ===================== */
test("暱稱只用 textContent：伺服器回什麼字都只當文字，不會變成標籤", { skip: SKIP }, async () => {
  const evil = ["<img onerror=1>", "<b>粗</b>", "&lt;script&gt;", "一二三四五六七八九十一二三四五六七八"];
  const net = lbNet({ top: () => ({ ok: true, v: 1, week: evil.map((n, i) => ({ rank: i + 1, name: n, floors: 20 - i })), all: [], me: null }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(3, 5000);
  await settle();
  const r = app.rows();
  assert.deepEqual(r.map(x => x.name), [evil[0], evil[1], evil[2], "一二三四五六七八九十一二三四五六"], "原字照印（太長的只留 16 字）");
  for (const li of app.$$("#lb-list li")) {
    const nm = li.querySelector(".u2-lb__nm");
    assert.ok(nm.childNodes.every(c => c.nodeType === 3), "暱稱底下只有文字節點");
  }
  assert.equal(app.$$("#lb-list img, #lb-list b, #lb-list script").length, 0);
});

/* ===================== 分頁切換 ===================== */
test("分頁：本週／近 30 天切換（aria-pressed）、自己那列高亮顯示「你」、不在前 10 名另外一行；切分頁不連線、不唸", { skip: SKIP }, async () => {
  const week = [{ rank: 1, name: "阿明", floors: 30 }, { rank: 2, name: "小華", floors: 20 }, { rank: 3, name: "訪客", floors: 12 }];
  const all = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: "老手" + (i + 1), floors: 60 - i }));
  const net = lbNet({ top: () => ({ ok: true, v: 1, week, all, me: { rank: 12, floors: 12, weekRank: 3 } }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  const wk = app.$('[data-lb="week"]'), al = app.$('[data-lb="all"]');
  assert.equal(wk.getAttribute("aria-pressed"), "true");
  assert.equal(al.getAttribute("aria-pressed"), "false");
  assert.deepEqual(app.rows().filter(r => r.me).map(r => [r.rank, r.you]), [["3", true]]);
  const live = app.text("#lb-live"), topN = app.net.by("top").length;
  click(al);
  assert.equal(wk.getAttribute("aria-pressed"), "false");
  assert.equal(al.getAttribute("aria-pressed"), "true");
  assert.equal(app.rows().length, 10);
  assert.equal(app.rows()[0].name, "老手1");
  assert.ok(app.rows().every(r => !r.me && !r.you));
  assert.equal(app.$("#lb-me").hidden, false);
  assert.equal(app.text("#lb-me"), "你目前第 12 名，蓋到 12 層。");
  click(wk);
  assert.equal(wk.getAttribute("aria-pressed"), "true");
  assert.equal(app.rows().length, 3);
  assert.equal(app.$("#lb-me").hidden, true);
  assert.equal(app.net.by("top").length, topN, "切分頁只是換畫面");
  assert.equal(app.text("#lb-live"), live, "切分頁不更新讀屏提示");
  assert.equal(app.$("#lb-live").getAttribute("aria-live"), "polite");
});

test("本週還沒人、近 30 天有：本週分頁說「切到近 30 天看看」", { skip: SKIP }, async () => {
  const net = lbNet({ top: () => ({ ok: true, v: 1, week: [], all: [{ rank: 1, name: "阿明", floors: 30 }], me: null }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(0, 3000);
  await settle();
  assert.equal(app.text("#lb-empty"), "這週還沒有人上榜，可以切到「近 30 天」看看。");
  assert.equal(app.$("#lb-list").hidden, true);
  click(app.$('[data-lb="all"]'));
  assert.equal(app.$("#lb-empty").hidden, true);
  assert.equal(app.rows().length, 1);
});

/* ===================== 留暱稱再送 ===================== */
test("留暱稱：同一筆、同層數再送一次並帶 name；成功後收起表單、重拿榜；之後破紀錄也帶著暱稱；事件只記計數不記內容", { skip: SKIP }, async () => {
  const app = await boot();
  await toWaiting(app);
  app.game.state.perfects = 2;
  app.game.over(12, 34567);
  await settle();
  assert.equal(app.$("#lb-form").hidden, false);
  const lbl = app.$('label[for="lb-name"]');
  assert.equal(lbl.textContent, "留個暱稱上榜（最多 8 個字，選填）");
  type(app.$("#lb-name"), "  小明  ");
  submit(app.$("#lb-form"));
  await settle();
  const sc = app.net.by("score");
  assert.equal(sc.length, 2);
  assert.deepEqual(sc[1].body, { jobId: JOB, floors: 12, ms: 34567, perfect: 2, name: "小明" });
  assert.equal(app.net.by("top").length, 2, "留完暱稱重拿一次榜");
  assert.equal(app.$("#lb-form").hidden, true);
  assert.equal(app.text("#lb-note"), "暱稱送出了。");
  assert.ok(app.rows().some(r => r.me && r.name === "小明"));
  assert.equal(app.win.sessionStorage.getItem("find.lbn"), JSON.stringify({ j: JOB, n: "小明" }), "同分頁重整後還記得（之後破紀錄一起帶）");
  app.game.over(20, 50000);
  await settle();
  assert.equal(app.net.by("score")[2].body.name, "小明", "破紀錄送分數：帶著已留的暱稱，不會被改回訪客");
  assert.equal(app.$("#lb-form").hidden, true, "留過就不再問");
  await app.clock.advance(7000);
  const ev = app.events().filter(e => e.e === "lb");
  assert.deepEqual(ev.map(e => e.a), ["send", "name", "send"]);
  assert.ok(ev.every(e => Object.keys(e).sort().join() === "a,e,s,t" && e.s === "s6"), "lb 事件只有 e／t／s／a");
  assert.ok(!JSON.stringify(app.events()).includes("小明"), "事件裡沒有暱稱");
});

test("暱稱：超過 8 個字只送前 8 個；不填直接按送出＝訪客（不連線、收起表單）", { skip: SKIP }, async () => {
  const app = await boot();
  await toWaiting(app);
  app.game.over(7, 9000);
  await settle();
  assert.equal(app.$("#lb-name").getAttribute("maxlength"), "8");
  type(app.$("#lb-name"), "一二三四五六七八九十");
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.net.by("score")[1].body.name, "一二三四五六七八");

  const app2 = await boot();
  await toWaiting(app2);
  app2.game.over(7, 9000);
  await settle();
  type(app2.$("#lb-name"), "   ");
  submit(app2.$("#lb-form"));
  await settle();
  assert.equal(app2.net.by("score").length, 1, "不填就不再送");
  assert.equal(app2.$("#lb-form").hidden, true);
  assert.equal(app2.text("#lb-note"), "好，排行榜上會顯示「訪客」。");
  assert.equal(app2.doc.activeElement, app2.$("#lb-note"), "表單收起來：焦點移到那句話（不掉回頁首）");
});

test("同一分頁重整後接著等：留過的暱稱還記得，破紀錄時一起帶、不再問", { skip: SKIP }, async () => {
  const session = {
    "find.v1": JSON.stringify({ sid: "Qw3kT9xLm2PzR8aVb5NcDe", idem: "x", jobId: JOB, step: "s6", fields: { districts: ["南屯區"], rooms_min: 2, rooms_max: 2 }, context: {}, freeText: "", waitStart: 1790000000000 }),
    "find.lbn": JSON.stringify({ j: JOB, n: "小明" }),
  };
  const app = await boot({ session });
  assert.equal(app.state(), "s6");
  app.game.over(9, 9000);
  await settle();
  assert.equal(app.net.by("score")[0].body.name, "小明");
  assert.equal(app.$("#lb-form").hidden, true);
});

/* ===================== 失敗靜默 ===================== */
test("失敗靜默：送分數與拿榜都連不上 → 只顯示「排行榜暫時看不到」，不問暱稱；等待與結果照原本流程", { skip: SKIP }, async () => {
  let done = false;
  const net = lbNet({
    score: () => new Error("network"),
    top: () => new Error("network"),
    status: () => (done ? { ok: true, v: 1, status: "done", count: 3, shareUrl: SHARE } : { ok: true, v: 1, status: "searching" }),
  });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  assert.equal(app.$("#wait-board").hidden, false);
  assert.equal(app.text("#lb-empty"), "排行榜暫時看不到，等一下再看看。");
  assert.equal(app.$("#lb-list").hidden, true);
  assert.equal(app.$("#lb-form").hidden, true);
  assert.equal(app.text("#lb-live"), "排行榜暫時看不到，等一下再看看。", "讀屏唸的跟畫面一樣（不是「排行榜更新了」）");
  assert.equal(app.state(), "s6");
  done = true;
  await app.clock.advance(7000);
  assert.equal(app.state(), "s7", "結果照樣出現");
  await app.clock.advance(7000);
  assert.ok(!app.events().some(e => e.e === "lb"), "沒送到就不記「有送出」");
});

test("失敗靜默：家用機連不上回空榜、回來的格式看不懂 → 「暫時看不到」；之前拿到的榜在網路錯時先留著", { skip: SKIP }, async () => {
  let mode = "empty";
  const net = lbNet({
    top: () => mode === "empty" ? { ok: true, v: 1, week: [], all: [], me: null }
      : mode === "junk" ? new Response("<html>", { status: 502 })
      : mode === "ok" ? { ok: true, v: 1, week: [{ rank: 1, name: "阿明", floors: 30 }], all: [{ rank: 1, name: "阿明", floors: 30 }], me: null }
      : new Error("network"),
    score: () => ({ ok: true, v: 1, saved: false }),
  });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(5, 5000);
  await settle();
  assert.equal(app.text("#lb-empty"), "排行榜暫時看不到，等一下再看看。");
  assert.equal(app.$("#lb-form").hidden, true, "saved:false：成績沒送到就不問暱稱");
  mode = "junk";
  app.game.over(6, 5000);
  await settle();
  assert.equal(app.text("#lb-empty"), "排行榜暫時看不到，等一下再看看。");
  mode = "ok";
  app.game.over(7, 5000);
  await settle();
  assert.equal(app.rows().length, 1);
  mode = "down";
  app.game.over(8, 5000);
  await settle();
  assert.equal(app.rows().length, 1, "網路錯：剛剛的榜先留著");
});

test("失敗靜默：留暱稱送不出去（限流 429）→ 一句白話、按鈕恢復，可以再按；不記「有留暱稱」", { skip: SKIP }, async () => {
  let n = 0;
  const net = lbNet({ score: () => (++n === 1 ? { ok: true, v: 1, saved: true } : new Response(JSON.stringify({ ok: false, code: "E_RATE" }), { status: 429, headers: { "content-type": "application/json" } })) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  type(app.$("#lb-name"), "小明");
  app.$("#lb-name").focus();
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.text("#lb-note"), "暱稱暫時沒送出去，等一下可以再按一次。");
  assert.equal(app.text("#lb-live"), "暱稱暫時沒送出去，等一下可以再按一次。", "失敗也要唸出來（#lb-note 不是 live 區）");
  assert.equal(app.doc.activeElement, app.$("#lb-name"), "表單還在：焦點留在原地");
  assert.equal(app.$("#lb-send").disabled, false);
  assert.equal(app.$("#lb-send").hasAttribute("aria-disabled"), false);
  assert.ok(!app.$("#lb-send").classList.contains("is-busy"));
  assert.equal(app.$("#lb-form").hidden, false, "還可以再按一次");
  await app.clock.advance(7000);
  assert.deepEqual(app.events().filter(e => e.e === "lb").map(e => e.a), ["send"]);
});

test("排行榜檔案載不到：遊戲與等待照常、結果照常出現（不重試成無限迴圈）", { skip: SKIP }, async () => {
  let done = false;
  const net = lbNet({ status: () => (done ? { ok: true, v: 1, status: "done", count: 3, shareUrl: SHARE } : { ok: true, v: 1, status: "searching" }) });
  const app = await boot({ net, preload: false });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  const scripts = app.doc.head.childNodes.filter(n => n.localName === "script" && /wait-board/.test(n.src || ""));
  assert.equal(scripts.length, 1);
  scripts[0].onload();            // 載入了但沒有定義 WaitBoard（壞檔）：不再載一次
  await settle();
  assert.equal(app.doc.head.childNodes.filter(n => n.localName === "script" && /wait-board/.test(n.src || "")).length, 1);
  app.game.over(15, 30000);       // 再玩一局：只試載一次，不每局重插 script（2026-10-07 審查 LB-L1）
  app.game.over(16, 30000);
  await settle();
  assert.equal(app.doc.head.childNodes.filter(n => n.localName === "script" && /wait-board/.test(n.src || "")).length, 1);
  assert.equal(app.net.by("score").length, 0);
  done = true;
  await app.clock.advance(7000);
  assert.equal(app.state(), "s7");
});

test("延遲載入：玩完一局才插入 /js/wait-board.js?v=<版本>（網址來自頁面 #wait-board 的 data-src），載入後送出這一局", { skip: SKIP }, async () => {
  const app = await boot({ preload: false });
  const before = app.doc.head.childNodes.filter(n => n.localName === "script").length;
  await toWaiting(app);
  assert.equal(app.doc.head.childNodes.filter(n => n.localName === "script").length, before, "等待開始時還不載入排行榜");
  app.game.state.perfects = 4;
  app.game.over(11, 22222);
  const s = app.doc.head.childNodes.filter(n => n.localName === "script" && /wait-board/.test(n.src || ""));
  assert.equal(s.length, 1);
  assert.match(s[0].src, /^\/js\/wait-board\.js\?v=[0-9a-f]{10}$/);
  assert.equal(s[0].src, app.$("#wait-board").getAttribute("data-src"));
  vm.runInContext(BOARD_SRC, app.ctx, { filename: "wait-board.js" });
  s[0].onload();
  await settle();
  assert.deepEqual(app.net.by("score").map(c => c.body), [{ jobId: JOB, floors: 11, ms: 22222, perfect: 4 }]);
  assert.equal(app.$("#wait-board").hidden, false);
});

/* ===================== 不擋結果 ===================== */
test("不擋結果：排行榜開著、遊戲已結束 → 結果好了直接切結果頁（跟原本一樣），遊戲收掉", { skip: SKIP }, async () => {
  let done = false;
  const net = lbNet({ status: () => (done ? { ok: true, v: 1, status: "done", count: 5, shareUrl: SHARE } : { ok: true, v: 1, status: "searching" }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  assert.equal(app.$("#lb-form").hidden, false);
  done = true;
  await app.clock.advance(7000);
  assert.equal(app.state(), "s7");
  assert.equal(app.$("#ready-banner").hidden, true);
  assert.equal(app.game.destroyed, true);
});

test("正在打暱稱（輸入框有焦點或有字）時結果好了：先出「結果好了」橫幅，不切掉打到一半的字；按查看就去結果頁", { skip: SKIP }, async () => {
  let done = false;
  const net = lbNet({ status: () => (done ? { ok: true, v: 1, status: "done", count: 5, shareUrl: SHARE } : { ok: true, v: 1, status: "searching" }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  app.$("#lb-name").focus();
  done = true;
  await app.clock.advance(7000);
  assert.equal(app.state(), "s6");
  assert.equal(app.$("#ready-banner").hidden, false);
  click(app.$("#ready-btn"));
  assert.equal(app.state(), "s7");
});

test("換一筆需求（補條件再找）：等待開始時先把上一筆的排行榜收起來；新的一局用新的工作編號重新算", { skip: SKIP }, async () => {
  let done = false;
  const net = lbNet({ status: () => (done ? { ok: true, v: 1, status: "done", count: 5, shareUrl: SHARE } : { ok: true, v: 1, status: "searching" }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  type(app.$("#lb-name"), "小明");
  submit(app.$("#lb-form"));
  await settle();
  done = true;
  await app.clock.advance(7000);
  assert.equal(app.state(), "s7");
  done = false;
  click(app.$('[data-act="refine"]'));
  click(app.$("#go-btn"));
  await settle();
  assert.equal(app.state(), "s6");
  assert.equal(app.$("#wait-board").hidden, true, "新的等待：先不顯示上一筆的榜");
  app.game.over(4, 8000);
  await settle();
  const last = app.net.by("score").at(-1).body;
  assert.deepEqual(last, { jobId: JOB2, floors: 4, ms: 8000, perfect: 0 }, "新的一筆：從 0 算、沒有帶上一筆的暱稱");
  assert.equal(app.$("#lb-form").hidden, false);
  assert.equal(app.text("#lb-note"), "");
});

/* ===================== 2026-10-07 審查修正（LB-N1／A1／A2／S1／R1） ===================== */
test("LB-N1 暱稱整理照伺服器規則：去掉所有空白、半形標點換全形、全形英數換半形；不收的字、沒有中英數、6 位以上連續數字 → null", () => {
  assert.equal(WB.tidy("小明 媽"), "小明媽");
  assert.equal(WB.tidy("  小明  "), "小明");
  assert.equal(WB.tidy("ＡＢＣ１２"), "ABC12");
  assert.equal(WB.tidy("小明!"), "小明！");
  assert.equal(WB.tidy("蓋樓...王"), "蓋樓…王");
  assert.equal(WB.tidy("一二三四五六七八九十"), "一二三四五六七八");
  assert.equal(WB.tidy("   "), "");
  assert.equal(WB.tidy(""), "");
  for (const bad of ["鍵盤 測試<b>", "小明😀", "abc.tw", "a@b", "0912345678", "09 1234 5678", "！！！", "小明·tw", "a/b"]) assert.equal(WB.tidy(bad), null, bad);
  // 前端放行的，官網輸出那一關（score.ts safeName）也要原樣放行：兩邊的字表不能各走各的
  for (const raw of ["小明 媽", "ＡＢＣ１２", "小明!", "蓋樓...王", "「阿明」", "ㄅㄆㄇ", "Ken_01", "a-b", "蓋樓高手", "一二三四五六七八九十"]) {
    const t = WB.tidy(raw);
    assert.ok(t, raw);
    assert.equal(SC.safeName(t), t, raw);
  }
});

test("LB-N1 暱稱有不收的字：不送出、表單留著、說明寫在表單下面並由 lb-live 唸；空白會先拿掉再送", { skip: SKIP }, async () => {
  const app = await boot();
  await toWaiting(app);
  app.game.over(7, 9000);
  await settle();
  type(app.$("#lb-name"), "鍵盤 測試<b>");
  app.$("#lb-name").focus();
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.net.by("score").length, 1, "字不行：不送");
  assert.equal(app.text("#lb-note"), "暱稱只能用中文、英文或數字，也不要放電話號碼，換一個試試。");
  assert.equal(app.$("#lb-note").hidden, false);
  assert.equal(app.text("#lb-live"), "暱稱只能用中文、英文或數字，也不要放電話號碼，換一個試試。");
  assert.equal(app.$("#lb-form").hidden, false);
  assert.equal(app.doc.activeElement, app.$("#lb-name"), "焦點留在輸入框，直接改");
  type(app.$("#lb-name"), "小明 媽");
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.net.by("score")[1].body.name, "小明媽");
  assert.equal(app.text("#lb-note"), "暱稱送出了。");
  assert.ok(app.rows().some(r => r.me && r.name === "小明媽"));
});

test("LB-N1 伺服器把暱稱換成「訪客…」：重拿榜後說一聲、表單再打開、不記住那個暱稱；換一個再送就好", { skip: SKIP }, async () => {
  const net = lbNet({}, n => (n.includes("官方") ? "訪客X3KT" : n));
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  type(app.$("#lb-name"), "官方小明");
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.net.by("score")[1].body.name, "官方小明");
  const said = "這個暱稱沒通過檢查，先用「訪客」顯示，可以換一個再送。";
  assert.equal(app.text("#lb-note"), said);
  assert.equal(app.text("#lb-live"), said);
  assert.equal(app.$("#lb-form").hidden, false, "表單再打開");
  assert.ok(app.rows().some(r => r.me && r.you && r.name === "訪客X3KT"));
  assert.equal(JSON.parse(app.win.sessionStorage.getItem("find.lbn")).n, "", "沒過的暱稱不留，之後破紀錄也不會再帶");
  type(app.$("#lb-name"), "小明");
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.text("#lb-note"), "暱稱送出了。");
  assert.equal(app.$("#lb-form").hidden, true);
  assert.ok(app.rows().some(r => r.me && r.name === "小明"));
  app.game.over(20, 50000);
  await settle();
  assert.equal(app.net.by("score").at(-1).body.name, "小明");
  await app.clock.advance(7000);
  assert.deepEqual(app.events().filter(e => e.e === "lb").map(e => e.a), ["send", "name", "name", "send"]);
});

test("LB-N1 留完暱稱重拿榜失敗：不拿舊榜亂猜「沒通過」，維持「暱稱送出了」", { skip: SKIP }, async () => {
  let n = 0;
  const net = lbNet({ top: (b, u, base) => (++n === 1 ? base.top(b, u) : new Error("network")) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  type(app.$("#lb-name"), "小明");
  submit(app.$("#lb-form"));
  await settle();
  assert.equal(app.net.by("top").length, 2);
  assert.equal(app.text("#lb-note"), "暱稱送出了。");
  assert.equal(app.$("#lb-form").hidden, true);
  assert.ok(app.rows().some(r => r.me && r.name === "訪客"), "舊榜先留著");
});

test("LB-A1 送出中用 aria-disabled（不用 disabled，焦點不掉）、再按不重送；成功後焦點移到「暱稱送出了」", { skip: SKIP }, async () => {
  let release = null, n = 0;
  const net = lbNet({ score: (b, u, base) => (++n === 1 ? base.score(b) : new Promise(r => { release = () => r(base.score(b)); })) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  const btn = app.$("#lb-send"), note = app.$("#lb-note");
  type(app.$("#lb-name"), "小明");
  btn.focus();
  submit(app.$("#lb-form"));
  await flush();
  assert.equal(btn.getAttribute("aria-disabled"), "true");
  assert.ok(btn.classList.contains("is-busy"));
  assert.equal(btn.disabled, false);
  assert.equal(app.doc.activeElement, btn);
  submit(app.$("#lb-form"));
  await flush();
  assert.equal(app.net.by("score").length, 2, "送出中再按：不重送");
  release();
  await settle();
  assert.equal(btn.hasAttribute("aria-disabled"), false);
  assert.ok(!btn.classList.contains("is-busy"));
  assert.equal(app.$("#lb-form").hidden, true);
  assert.equal(note.getAttribute("tabindex"), "-1");
  assert.equal(app.doc.activeElement, note, "表單收起來：焦點移到結果那句，不掉回頁首");
  assert.equal(app.text("#lb-live"), "排行榜更新了：你在本週第 3 名。");
});

test("LB-S1 換一筆需求：新成績還在路上時，上一筆的清單、表單、分頁（近 30 天）都先收掉，顯示「載入中」", { skip: SKIP }, async () => {
  let done = false, hold = false, release = null;
  const net = lbNet({
    status: () => (done ? { ok: true, v: 1, status: "done", count: 5, shareUrl: SHARE } : { ok: true, v: 1, status: "searching" }),
    score: (b, u, base) => (hold ? new Promise(r => { release = () => r(base.score(b)); }) : base.score(b)),
  });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  click(app.$('[data-lb="all"]'));
  assert.equal(app.$("#lb-form").hidden, false);
  assert.equal(app.$("#lb-list").hidden, false);
  done = true;
  await app.clock.advance(7000);
  assert.equal(app.state(), "s7");
  done = false;
  click(app.$('[data-act="refine"]'));
  click(app.$("#go-btn"));
  await settle();
  assert.equal(app.state(), "s6");
  hold = true;
  app.game.over(4, 8000);
  await flush();
  assert.equal(app.$("#wait-board").hidden, false);
  assert.equal(app.$("#lb-list").hidden, true, "上一筆的清單不留");
  assert.equal(app.$$("#lb-list li").length, 0);
  assert.equal(app.text("#lb-empty"), "排行榜載入中…");
  assert.equal(app.$("#lb-form").hidden, true, "上一筆的暱稱表單不留");
  assert.equal(app.$('[data-lb="week"]').getAttribute("aria-pressed"), "true", "分頁回到本週");
  assert.equal(app.$('[data-lb="all"]').getAttribute("aria-pressed"), "false");
  release();
  await settle();
  assert.equal(app.net.by("score").at(-1).body.jobId, JOB2);
  assert.equal(app.$("#lb-list").hidden, false);
  assert.equal(app.$("#lb-form").hidden, false);
});

test("LB-R1 「你」要名次和層數都對上：伺服器的名次跟清單位置不一致時，不把別人那列標成你", { skip: SKIP }, async () => {
  const week = [{ rank: 1, name: "阿明", floors: 30 }, { rank: 2, name: "小華", floors: 20 }, { rank: 3, name: "阿珍", floors: 18 }];
  const net = lbNet({ top: () => ({ ok: true, v: 1, week, all: week, me: { rank: 3, floors: 12, weekRank: 3 } }) });
  const app = await boot({ net });
  await toWaiting(app);
  app.game.over(12, 30000);
  await settle();
  assert.ok(app.rows().every(r => !r.me && !r.you), "第 3 名是 18 層的阿珍，不是你");
  assert.equal(app.text("#lb-me"), "你目前第 3 名，蓋到 12 層。");
  assert.equal(app.text("#lb-live"), "排行榜更新了。");
});

/* ===================== 事件規格 ===================== */
test("事件規格：lb 只收 a=send／name，其他鍵（例如暱稱）一律丟掉", () => {
  assert.deepEqual(S.validateEvent({ e: "lb", t: 5, s: "s6", a: "send" }), { e: "lb", t: 5, s: "s6", a: "send" });
  assert.deepEqual(S.validateEvent({ e: "lb", t: 5, a: "name", name: "小明", n: 3 }), { e: "lb", t: 5, a: "name" });
  assert.deepEqual(S.validateEvent({ e: "lb", t: 5, a: "小明" }), { e: "lb", t: 5 });
});

/* ===================== 靜態稽核 ===================== */
test("wait-board.js 靜態：不用 innerHTML 類寫法、沒有動態執行、只連同源的 score／top、沒有外部網址；體積小", () => {
  const code = BOARD_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), "不用 innerHTML 類寫法");
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"]/.test(code));
  assert.ok(!/https?:|\/\/[a-z0-9-]+\.[a-z]{2,}/i.test(code), "沒有外部網址");
  assert.ok(!/localStorage|document\.cookie|XMLHttpRequest|WebSocket|sendBeacon|importScripts/.test(code));
  assert.deepEqual([...code.matchAll(/['"]\/api\/find\/[^'"]*['"]/g)].map(m => m[0]), ["'/api/find/'"]);
  assert.deepEqual([...code.matchAll(/API \+ '([a-z]+)/g)].map(m => m[1]).sort(), ["score", "top"]);
  assert.ok(/\.textContent = /.test(code));
  const raw = Buffer.byteLength(BOARD_SRC.replace(/\r\n/g, "\n"));   // 以 repo 內的 LF 版本計（Windows 簽出會變 CRLF）
  const min = transformSync(BOARD_SRC, { minify: true, loader: "js", charset: "utf8", legalComments: "none" }).code;
  assert.ok(raw <= 12 * 1024, `原始檔 ${raw}`);
  assert.ok(zlib.gzipSync(min).length <= 3.5 * 1024, `gzip ${zlib.gzipSync(min).length}`);
  assert.equal(typeof WB.over, "function");
  assert.equal(typeof WB.busy, "function");
  assert.equal(WB.busy(), false, "沒有畫面時不會出錯");
});

test("find-app.js 接線：只在 over 而且有工作編號時叫排行榜；排行榜網址從頁面拿（find-app 不寫死第二個路徑）", () => {
  assert.match(APP_SRC, /if \(e\.type === 'over' && S\.jobId\) board\(S\.jobId, e, game\.getState\(\)\);/);
  assert.match(APP_SRC, /s\.src = b\.getAttribute\('data-src'\);/);
  assert.match(APP_SRC, /s\.onload = function \(\) \{ if \(root\.WaitBoard\) board\(j, e, g\); \};/);
  assert.match(APP_SRC, /if \(!b \|\| b\.lbTry\) return;\s+b\.lbTry = s = doc\.createElement\('script'\);/, "只試載一次");
  const code = APP_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");
  assert.ok(!code.includes("wait-board.js"), "find-app 不寫死排行榜檔名（註解除外）");
  assert.match(APP_SRC, /'\.u2-ready, #ready-banner, #wait-board'/, "新的等待開始時收起上一筆的排行榜");
});

test("find.astro：排行榜容器、固定文案、無障礙標記（label、分頁 aria-pressed、aria-live）、延遲載入網址帶 ?v=", () => {
  assert.match(PAGE_SRC, /const vBoard = fileVer\("public\/js\/wait-board\.js"\);/);
  assert.match(PAGE_SRC, /<section class="u2-lb" id="wait-board" aria-labelledby="lb-h" data-src=\{`\/js\/wait-board\.js\?v=\$\{vBoard\}`\} hidden>/);
  assert.match(PAGE_SRC, /<label for="lb-name">留個暱稱上榜<span class="u2-lb__nb">（最多 8 個字，選填）<\/span><\/label>/);
  assert.match(PAGE_SRC, /data-lb="week" aria-pressed="true">本週</);
  assert.match(PAGE_SRC, /data-lb="all" aria-pressed="false">近 30 天</);
  assert.match(PAGE_SRC, /id="lb-live" aria-live="polite"/);
  // 結果句：表單收起來時焦點移過去（tabindex=-1）；讀屏提示只走 #lb-live，所以這裡不掛 role=status（免得唸兩次）
  assert.match(PAGE_SRC, /<p class="u2-lb__msg" id="lb-note" tabindex="-1" hidden><\/p>/);
  assert.ok(!/id="lb-note"[^>]*role=/.test(PAGE_SRC));
  assert.match(PAGE_SRC, /id="lb-help">暱稱會公開在排行榜上，不填就顯示「訪客」。請不要寫真實姓名或電話。</);
  assert.ok(!/<script[^>]*wait-board/.test(PAGE_SRC), "排行榜不在首載：頁面不直接放 script");
  // 排行榜在等待區（s6）裡、遊戲下方
  const s6 = PAGE_SRC.slice(PAGE_SRC.indexOf('data-s="s6"'), PAGE_SRC.indexOf('data-s="s7"'));
  assert.ok(s6.indexOf('id="game-wrap"') >= 0 && s6.indexOf('id="game-wrap"') < s6.indexOf('id="wait-board"'));
});

test("排行榜樣式：字一律 ≥17px（不用 fs-0／fs-1）、只用設計系統色彩 token（深淺色自動換）", () => {
  const css = CSS_SRC.slice(CSS_SRC.indexOf(".u2-lb {"));
  assert.ok(css.length > 200);
  assert.ok(!/--u2-fs-[01]\b/.test(css), "排行榜不用小於 17px 的字級");
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(css), "不寫死顏色");
  assert.match(css, /\.u2-lb__row\.is-me/);
  assert.match(css, /\.u2-lb__nm \{[^}]*overflow-wrap: anywhere/, "窄螢幕：暱稱自己換行");
});

test("建置後的 /find/：排行榜容器與 data-src（版本號）都在", { skip: SKIP }, () => {
  assert.match(HTML, /id="wait-board"[^>]*data-src="\/js\/wait-board\.js\?v=[0-9a-f]{10}"|data-src="\/js\/wait-board\.js\?v=[0-9a-f]{10}"[^>]*id="wait-board"/);
});
