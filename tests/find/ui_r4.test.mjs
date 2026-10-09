// 2026-10-06 R4（find-app.js）兩件事的測試：
//   (1) 「不確定的更正」：抽取器回報 inferred 含 correction_unsure（客人自己更正了、但不確定最後要哪個，兩個值都留著）時，
//       「我聽到的」與需求單對受影響的欄位標「請確認」並問一句白話；沒有標記時完全不出現；不影響送出內容。
//   (2) 路名延遲驗證：JS 抽取器沒有路名字典，抽到路名才在背景載入官網原有的門牌索引（/data/tc-addr/index.json），
//       台中市沒有這條路就從條件與畫面拿掉；逾時 1.5 秒或任何失敗都維持現狀、不報錯。判斷與伺服器端 knownRoad 一致。
// 全部離線：假 DOM、假網路、假時鐘（見 fake_dom.mjs）。DOM 的測試需要先建置（dist/find/index.html），沒有就跳過。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT, bundleTs, loadClassic, requireClassic } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock, flush, click, submit, type, setChecked } from "./fake_dom.mjs";

const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HTML_PATH = path.join(DIST, "find", "index.html");
const parse5 = await loadParse5();
const SKIP = !fs.existsSync(HTML_PATH) || !parse5 ? "需要先建置（dist/find/index.html）且 node_modules 內有 parse5" : false;
const HTML = SKIP ? "" : fs.readFileSync(HTML_PATH, "utf8");
const NEED_SRC = fs.readFileSync(path.join(ROOT, "public/js/need-extract.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-app.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "src/styles/ui2-find.css"), "utf8");
const SCH = (await bundleTs("src/lib/find/schema.ts")).mod;
const ROADS = (await bundleTs("src/lib/find/roads_tc.ts")).mod.ROADS_BY_DISTRICT;
const IDX_RAW = fs.readFileSync(path.join(ROOT, "public/data/tc-addr/index.json"), "utf8");
const IDX = JSON.parse(IDX_RAW);
const IDX_URL = "/data/tc-addr/index.json";

// 純邏輯：用同一份抽取器的真實輸出，不手寫 inferred
const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const FC = requireClassic("public/js/find-app.js");

const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const CONFIG = { ok: true, v: 1, mode: "live", turnstileSiteKey: null, needMax: 300, consentV: "2026-10-06", tplV: 1 };
const idxOk = () => new Response(IDX_RAW, { headers: { "content-type": "application/json" } });

/** 假網路：/api/find/* 走固定回應；/data/tc-addr/* 走各測試自己決定的 idx（預設回真的索引） */
function mkNet({ idx = idxOk, over = {} } = {}) {
  const calls = [];
  const routes = {
    config: () => CONFIG,
    submit: () => ({ ok: true, v: 1, status: "queued", jobId: JOB, queue: { ahead: 1, eta_s: 150 }, saved: true, pollMs: 4000 }),
    status: () => ({ ok: true, v: 1, status: "searching", stage: "s", msg: "x", pollMs: 4000 }),
    event: () => ({ ok: true }), contact: () => ({ ok: true, v: 1, saved: true }), feedback: () => ({ ok: true, v: 1 }),
    ...over,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (u.startsWith("/data/")) return idx(u, init);
    const key = u.replace("/api/find/", "").split("?")[0];
    if (!(key in routes)) throw new Error("測試不准連到：" + u);
    return Response.json(routes[key]());
  };
  return { calls, fetchImpl, by: k => calls.filter(c => c.url.includes("/api/find/" + k)), idx: () => calls.filter(c => c.url.startsWith("/data/")) };
}

async function boot({ net = mkNet(), session = {}, width = 390 } = {}) {
  const clock = makeClock();
  const { doc, win } = makeEnv({ html: HTML, parse5, fetchImpl: net.fetchImpl, clock, sessionData: session, innerWidth: width });
  const ctx = vm.createContext(win);
  vm.runInContext(NEED_SRC, ctx, { filename: "need-extract.js" });
  vm.runInContext(APP_SRC, ctx, { filename: "find-app.js" });
  await flush();
  const $ = sel => doc.querySelector(sel), $$ = sel => doc.querySelectorAll(sel);
  const events = () => {
    const out = [];
    net.by("event").forEach(c => { if (c.body && c.body.events) out.push(...c.body.events); });
    win.__beacons.forEach(b => { try { out.push(...JSON.parse(b.blob.__text).events); } catch { /* ignore */ } });
    return out;
  };
  return { clock, doc, win, net, $, $$, events, state: () => ($$(".u2-state").find(d => !d.hidden) || {}).getAttribute?.("data-s"), text: sel => ($(sel) || { textContent: "" }).textContent };
}
globalThis.Blob = class extends Blob { constructor(parts, opt) { super(parts, opt); this.__text = parts.join(""); } };

const say = async (app, t) => { type(app.$("#free-text"), t); submit(app.$("#free-form")); await flush(); };
const act = (app, a) => click(app.$(`[data-act="${a}"]`));
const rows = app => app.$$("#sheet-rows .u2-sheet__row");
const rowTxt = r => r.querySelector("dt").textContent + r.querySelector("dd").textContent;   // 不含最右邊的「改」按鈕
const heardTags = app => app.$$("#s2-chat .u2-tag").map(x => x.textContent);
const chooseOpt = (app, label) => {
  const l = app.$$(".u2-tray .u2-opt").find(x => x.textContent.trim() === label);
  assert.ok(l, `找不到選項「${label}」`);
  setChecked(l.querySelector("input"), true);
};
/** 這支測試不准有沒接住的 Promise 例外（失敗要安靜維持現狀） */
function watchRejections() {
  const seen = [];
  const h = e => seen.push(String(e));
  process.on("unhandledRejection", h);
  return { seen, stop: () => process.off("unhandledRejection", h) };
}

const T_DIST = "預算兩千萬以內，北屯三房，如果不行再改成西屯";   // 兩個區都留
const T_ROOMS = "北屯 三房 兩千萬，不然改成四房也可以";           // 房數變成 3～4 房
const T_PRICE = "北屯 預算兩千萬，如果不行改成兩千二百萬";        // 價格只留第一個
const T_NONE = ["想找北屯或西屯 三房 兩千萬以內", "北屯三房，預算兩千萬。等一下，我改一下：預算改成兩千二百萬", "北屯 三房 兩千萬左右", "我想找北屯三房 不用改成西屯 兩千萬", "北屯 三到四房 預算兩千萬"];

/* ===================== (1) 不確定的更正 ===================== */
test("R4-1 unsureKeys：兩個區＝區域；房數範圍＝房數；只剩預算＝預算；沒有 correction_unsure 一律不標", () => {
  const uk = t => { const r = NE.extract(t); return FC.unsureKeys(r.fields, r.inferred); };
  assert.deepEqual(uk(T_DIST), ["district"]);
  assert.deepEqual(uk("原本想找北屯，改成西屯也可以 三房 兩千萬"), ["district"]);
  assert.deepEqual(uk(T_ROOMS), ["rooms"]);
  assert.deepEqual(uk(T_PRICE), ["price"]);
  for (const t of T_NONE) assert.deepEqual(uk(t), [], t);
  // 其他 inferred（價格是大概、方向是猜的…）不會觸發；沒有 inferred、猜不到是哪一欄都不標（寧可漏標）
  assert.deepEqual(FC.unsureKeys({ districts: ["北屯區", "西屯區"] }, ["price_approx", "price_dir"]), []);
  assert.deepEqual(FC.unsureKeys({ districts: ["北屯區", "西屯區"] }, undefined), []);
  assert.deepEqual(FC.unsureKeys({}, ["correction_unsure"]), []);
  assert.deepEqual(FC.unsureKeys({ districts: ["北屯區"] }, ["correction_unsure"]), []);
  // 價格是合法的範圍＋兩個區：只標區域，不會連預算一起亂標
  assert.deepEqual(FC.unsureKeys({ districts: ["北屯區", "西屯區"], price_min_wan: 1500, price_max_wan: 2000 }, ["correction_unsure"]), ["district"]);
});

test("R4-1 condTags：只有被標的那一項加（請確認）；沒標的輸出與改寫前一模一樣；空欄位不會只剩一個（請確認）", () => {
  const f = { districts: ["北屯區", "西屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000 };
  assert.deepEqual(FC.condTags(f), ["北屯區、西屯區", "3 房", "2000 萬以內"]);
  assert.deepEqual(FC.condTags(f, ["district"]), ["北屯區、西屯區（請確認）", "3 房", "2000 萬以內"]);
  assert.deepEqual(FC.condTags(f, ["rooms", "price"]), ["北屯區、西屯區", "3 房（請確認）", "2000 萬以內（請確認）"]);
  assert.deepEqual(FC.condTags({ rooms_min: 3 }, ["district"]), ["3 房以上"]);
  const full = { districts: ["北屯區"], road: "崇德路", rooms_min: 2, rooms_max: 3, types: ["elevator_building", "mid_rise"], price_min_wan: 1500, price_max_wan: 2000, age_max: 20, parking: "flat", exclude_top: true, floor_exclude: [1], floor_min: 3, area_min_ping: 30, area_max_ping: 40 };
  assert.deepEqual(FC.condTags(full), ["北屯區崇德路", "2～3 房", "電梯大樓、華廈", "1500～2000 萬", "20 年內", "平面車位", "不要 1 樓、不含頂樓、3 樓以上", "30～40 坪"]);
  assert.deepEqual(FC.condTags({}), []);
});

test("R4-1 「我聽到的」：更正過、不確定的那一欄標請確認並問一句；沒有更正的句子完全不出現", { skip: SKIP }, async () => {
  for (const [t, tag, label] of [[T_DIST, "北屯區、西屯區（請確認）", "區域"], [T_ROOMS, "3～4 房（請確認）", "房數"], [T_PRICE, "2000 萬以內（請確認）", "預算"]]) {
    const app = await boot();
    await say(app, t);
    assert.equal(app.state(), "s2", t);
    const tags = heardTags(app);
    assert.ok(tags.includes(tag), `${t} → ${tags}`);
    assert.equal(tags.filter(x => /請確認/.test(x)).length, 1, "只標受影響的那一欄");
    const asks = app.$$("#s2-chat .u2-banner").map(b => b.textContent).filter(x => /更正過/.test(x));
    assert.deepEqual(asks, [label + FC.UNSURE_ASK], t);
  }
  for (const t of T_NONE) {
    const app = await boot();
    await say(app, t);
    assert.equal(app.state(), "s2", t);
    assert.ok(!/請確認|更正過/.test(app.text("#s2-chat").replace(t, "")), `不該出現：${t}`);   // 客人自己打的原話（me 氣泡）不算
  }
});

test("R4-1 白話提示的語氣：用「你」當主詞、不責備、不嚇人，沒有第三方平台或未完工建設字眼", () => {
  const all = FC.UNSURE_ASK + Object.values(FC.UNSURE).join("");
  assert.match(FC.UNSURE_ASK, /^你好像更正過/);
  assert.ok(Array.from(FC.UNSURE_ASK).length <= 30, "一句話");
  assert.ok(!/錯|不對|無效|警告|注意|失敗|必須|請勿|嚴重/.test(all), "不責備、不嚇人");
  assert.ok(!/捷運|藍線|重劃|規劃|預計|即將|未來/.test(all), "不碰未完工的公共建設");
  assert.ok(!/[A-Za-z0-9]{3,}/.test(all) && !/https?:/i.test(all), "沒有任何網址、平台代號或英數字串");
  assert.deepEqual(Object.keys(FC.UNSURE).sort(), ["district", "price", "rooms"]);
});

test("R4-1 需求單：受影響那一列有請確認小標與問句；其他列沒有；改過那一欄就消失；追問畫面的「我聽到的」也有標", { skip: SKIP }, async () => {
  const app = await boot();
  await say(app, T_DIST);
  act(app, "continue");
  assert.equal(app.state(), "s3");
  assert.match(app.text("#s3-chat [data-heard]"), /^我聽到的是：北屯區、西屯區（請確認）、3 房、2000 萬以內。$/);
  click(app.$("#s3-direct [data-act='go-now']"));
  assert.equal(app.state(), "s4");
  const flagged = () => rows(app).filter(r => r.querySelector(".u2-tag--check"));
  assert.equal(flagged().length, 1);
  assert.match(rowTxt(flagged()[0]), /^區域北屯區、西屯區請確認你好像更正過/);
  assert.equal(flagged()[0].querySelector(".u2-tag--check").textContent, "請確認");
  assert.equal(flagged()[0].querySelector(".u2-sheet__note").textContent, FC.UNSURE_ASK);
  assert.ok(rows(app).filter(r => !r.querySelector(".u2-tag--check")).every(r => !/請確認|更正過/.test(rowTxt(r))));
  assert.equal(app.$$("#sheet-rows .u2-sheet__note").length, 1, "整張需求單只問一次");
  // 改預算（不是被標的那一欄）：標記還在
  click(app.$("[data-edit='price']"));
  chooseOpt(app, "2500 萬以內");
  click(app.$("#q-ok"));
  assert.equal(app.state(), "s4");
  assert.equal(flagged().length, 1, "答別題不會把這一欄當成確認過");
  // 改區域（被標的那一欄）：選一個區 → 標記消失
  click(app.$("[data-edit='district']"));
  setChecked(app.$$(".u2-tray .u2-opt").find(x => x.textContent.trim() === "西屯區").querySelector("input"), false);   // 目前勾著北屯、西屯：取消西屯
  click(app.$("#q-ok"));
  assert.equal(app.state(), "s4");
  assert.equal(flagged().length, 0);
  assert.equal(app.$$("#sheet-rows .u2-sheet__note").length, 0);
  assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區"));
});

test("R4-1 預算被標時：改了預算那一欄的標記就消失（房數、區域的標記不受影響）", { skip: SKIP }, async () => {
  const app = await boot();
  await say(app, T_PRICE);
  act(app, "go-now");
  assert.equal(app.state(), "s4");
  const f = () => rows(app).filter(r => r.querySelector(".u2-tag--check")).map(r => r.querySelector("dt").textContent);
  assert.deepEqual(f(), ["預算"]);
  click(app.$("[data-edit='price']"));
  chooseOpt(app, "1500 萬以內");
  click(app.$("#q-ok"));
  assert.deepEqual(f(), []);
  assert.ok(rows(app).some(r => rowTxt(r) === "預算1500 萬以內"));
});

test("R4-1 不影響送出內容：有標記與沒有標記的送出欄位、鍵名、事件規格都一樣；送出之後回來調整不再標", { skip: SKIP }, async () => {
  const app = await boot();
  await say(app, T_DIST);
  act(app, "go-now");
  await app.clock.advance(6000);
  click(app.$("#go-btn"));
  await flush();
  assert.equal(app.state(), "s6");
  const sub = app.net.by("submit")[0].body;
  assert.equal(SCH.validateSubmit(sub).err, null);
  assert.deepEqual(JSON.parse(JSON.stringify(sub.fields)), { districts: ["北屯區", "西屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
  assert.deepEqual(Object.keys(sub).sort(), ["consent", "contact", "context", "fields", "fill_ms", "free_text", "from", "hp", "idem", "refine_of", "skip", "turnstile", "v"]);
  assert.equal(sub.free_text, T_DIST, "原話照送");
  assert.ok(!/請確認|unsure|correction/i.test(JSON.stringify(sub)));
  await app.clock.advance(7000);
  const evs = app.events();
  for (const e of evs) assert.deepEqual(SCH.validateEvent(e), e, JSON.stringify(e));
  assert.ok(!/請確認|unsure|correction/i.test(JSON.stringify(evs)), "事件裡沒有多出任何東西");
  assert.deepEqual(Object.keys(evs.find(e => e.e === "free_submit")).sort(), ["drop", "e", "got", "lenb", "lvl", "miss", "pii", "s", "t"], "free_submit 的鍵跟以前一樣");
  // 同一句沒有標記詞的版本：送出的欄位同樣（只差兩個區是不是被客人明講）
  const app2 = await boot({ net: mkNet({ over: { submit: () => ({ ok: false, code: "E_FORWARD" }) } }) });
  await say(app2, T_DIST);
  act(app2, "go-now");
  assert.ok(rows(app2).some(r => r.querySelector(".u2-tag--check")), "送出前有標");
  await app2.clock.advance(6000);
  click(app2.$("#go-btn"));
  await flush();
  assert.equal(app2.state(), "s10");
  click(app2.$("#err-retry"));
  assert.equal(app2.state(), "s4");
  assert.equal(rows(app2).filter(r => r.querySelector(".u2-tag--check")).length, 0, "客人看過、按了開始找，再回來就不重複標");
});

test("R4-1 重整後還原（s4）：請確認標記跟著回來；存檔被亂改也不會壞掉", { skip: SKIP }, async () => {
  const base = { sid: "Qw3kT9xLm2PzR8aVb5NcDe", idem: "", jobId: null, step: "s4", fields: { districts: ["北屯區", "西屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000 }, context: {}, freeText: T_DIST, from: "", res: null, waitStart: 0, fatigueDone: false };
  const app = await boot({ session: { "find.v1": JSON.stringify({ ...base, unsure: ["district"] }) } });
  assert.equal(app.state(), "s4");
  assert.deepEqual(rows(app).filter(r => r.querySelector(".u2-tag--check")).map(r => r.querySelector("dt").textContent), ["區域"]);
  // 舊版存檔（沒有 unsure）、亂七八糟的值：只認三個合法欄名，其餘忽略，不丟例外
  for (const bad of [undefined, null, "district", 7, {}, [], ["constructor", "__proto__", "toString", 5, null, { a: 1 }], ["rooms", "rooms", "district"]]) {
    const a = await boot({ session: { "find.v1": JSON.stringify({ ...base, unsure: bad }) } });
    assert.equal(a.state(), "s4", JSON.stringify(bad));
    const names = rows(a).filter(r => r.querySelector(".u2-tag--check")).map(r => r.querySelector("dt").textContent);
    assert.deepEqual(names, bad === "district" ? ["區域"] : Array.isArray(bad) && bad.includes("rooms") ? ["區域", "房數"] : [], JSON.stringify(bad));
  }
});

test("R4-1 手機窄版（320px）：小標與問句只靠自己換行，不撐開格子；顏色用已通過對比檢查的那一組；問句不長", { skip: SKIP }, async () => {
  // 同一個選擇器可能有好幾條規則（核心樣式＋這次補的），全部合併來看
  const rule = sel => {
    const re = new RegExp("(?:^|\\n)" + sel.replace(/[.\s]/g, c => (c === "." ? "\\." : "\\s+")) + "\\s*\\{([^}]*)\\}", "g");
    const all = [...CSS.matchAll(re)].map(m => m[1]).join(" ");
    assert.ok(all, `CSS 找不到 ${sel}`);
    return all;
  };
  const dd = rule(".u2-sheet__row dd"), tag = rule(".u2-tag--check"), note = rule(".u2-sheet__note");
  assert.match(dd, /min-width:\s*0/);
  assert.match(dd, /overflow-wrap:\s*anywhere/);
  assert.match(note, /display:\s*block/, "問句自己一行");
  for (const body of [tag, note]) assert.ok(!/(?:^|[;\s])(?:width|min-width|max-width|height)\s*:\s*[\d.]+(?:px|rem|em|%)/.test(body.replace(/min-height:[^;]*;?/g, "")), "沒有寫死寬度");
  assert.ok(!/white-space\s*:\s*nowrap/.test(tag + note + dd), "不准不換行");
  assert.match(tag, /color:\s*var\(--u2-warn\)/);
  assert.match(tag, /background:\s*var\(--u2-warn-tint\)/);   // contrast-check.mjs 有檢查 warn 字壓在 warn-tint 上
  const app = await boot({ width: 320 });
  await say(app, T_DIST);
  act(app, "go-now");
  const row = rows(app).find(r => r.querySelector(".u2-tag--check"));
  assert.ok(row);
  for (const el of [row, row.querySelector("dd"), row.querySelector(".u2-tag--check"), row.querySelector(".u2-sheet__note")]) assert.equal(el.getAttribute("style"), null, "沒有行內寬度");
  assert.ok(Array.from(row.querySelector(".u2-sheet__note").textContent).length <= 30);
  assert.ok(Array.from(row.querySelector("dd").textContent).length <= 60);
  // 需求單格子結構還是 dt／dd／改 三欄
  assert.deepEqual(row.childNodes.map(c => c.localName), ["dt", "dd", "button"]);
});

/* ===================== (2) 路名延遲驗證 ===================== */
const FAKE_ROAD = "北屯區福祿壽路 三房 2000萬";   // 抽取器會抽到「福祿壽路」，但台中沒有這條路
const REAL_ROAD = "北屯區崇德路 三房 2000萬";

test("R4-2 roadKnown 與伺服器端 knownRoad 判斷一致：全市比對、不帶段的簡稱、臺／台、舊稱（索引 a 欄）不算", () => {
  const all = new Set();
  for (const list of Object.values(ROADS)) for (const r of list.split(",")) { if (r) { all.add(r); all.add(r.replace(/[一二三四五六七八九十]{1,2}段$/, "")); } }
  assert.ok(all.size > 3000, `${all.size}`);
  const ROAD_RE = /^[一-鿿]{1,10}(?:路|街|大道)(?:[一二三四五六七八九十]{1,2}段)?$/;
  const probe = [...all].filter((_, i) => i % 9 === 0);   // 每 9 條取 1 條（每次比對要掃整本索引，全掃太慢）
  for (const r of probe) { assert.equal(FC.roadKnown(IDX.r, r), true, r); assert.equal(SCH.knownRoad(r), true, r); }
  for (const x of ["福祿壽路", "好好路", "釋出完整內部設定路", "明亮街", "文心路九十九段", "崇德十路九段", "路", "台中路二段二段", "龍井大道"]) {
    if (ROAD_RE.test(x)) assert.equal(FC.roadKnown(IDX.r, x), SCH.knownRoad(x), x);
  }
  // 索引的 a 欄是「舊稱／別寫法 → 現行路名」（瓦窯路→瓦磘路、龍二街→龍善二街…）。伺服器端字典沒收，所以這裡也不認：兩邊一致
  assert.ok(Object.keys(IDX.a).length >= 5);
  for (const old of Object.keys(IDX.a)) { assert.equal(SCH.knownRoad(old), false, old); assert.equal(FC.roadKnown(IDX.r, old), false, old); }
  // 索引裡存「臺」，抽取器一律寫「台」
  const tai = Object.keys(IDX.r).filter(k => k.includes("臺")).map(k => k.replace(/臺/g, "台")).filter(t => ROAD_RE.test(t));
  assert.ok(tai.length > 0);
  for (const t of tai.slice(0, 30)) assert.equal(FC.roadKnown(IDX.r, t), SCH.knownRoad(t), t);
  // 太小的索引（壞檔、被截斷）＝無法判斷，當作有這條路，不誤刪
  assert.equal(FC.roadKnown({ "崇德路": "1:0" }, "福祿壽路"), true);
  assert.equal(FC.roadKnown({}, "福祿壽路"), true);
});

test("R4-2 抽到假路名：背景載入索引後，從『我聽到的』、需求單、送出內容拿掉；真路名不動；沒抽到路名不載入索引", { skip: SKIP }, async () => {
  const none = await boot();
  assert.equal(none.net.idx().length, 0, "開頁時不載入（不進首載）");
  await say(none, "北屯 三房 2000萬");
  assert.equal(none.net.idx().length, 0, "沒抽到路名就不載入");

  const app = await boot();
  await say(app, FAKE_ROAD);
  assert.deepEqual(app.net.idx().map(c => c.url), [IDX_URL]);
  assert.equal(app.state(), "s2");
  assert.deepEqual(heardTags(app), ["北屯區", "3 房", "2000 萬以內"]);
  assert.ok(!/福祿壽路/.test(app.text("#aside-tags")));
  act(app, "go-now");
  assert.equal(app.state(), "s4");
  assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區"));
  await app.clock.advance(6000);
  click(app.$("#go-btn"));
  await flush();
  const sub = app.net.by("submit")[0].body;
  assert.deepEqual(JSON.parse(JSON.stringify(sub.fields)), { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
  assert.equal(sub.free_text, FAKE_ROAD, "原話照送，只拿掉抽出來的路段欄位");
  // 伺服器端本來就會丟：兩邊看法一致
  assert.ok(SCH.normalizeFields({ districts: ["北屯區"], road: "福祿壽路" }).issues.includes("road:unknown"));

  const real = await boot();
  await say(real, REAL_ROAD);
  assert.deepEqual(heardTags(real), ["北屯區崇德路", "3 房", "2000 萬以內"]);
  act(real, "go-now");
  await real.clock.advance(6000);
  click(real.$("#go-btn"));
  await flush();
  assert.equal(real.net.by("submit")[0].body.fields.road, "崇德路");
  assert.equal(SCH.normalizeFields(JSON.parse(JSON.stringify(real.net.by("submit")[0].body.fields))).fields.road, "崇德路");
});

test("R4-2 舊稱寫法（大里瓦窯路、大雅龍二街）跟伺服器端一樣不收：從條件拿掉", { skip: SKIP }, async () => {
  for (const [t, road] of [["大里瓦窯路 三房 1500萬", "瓦窯路"], ["大雅龍二街 三房 1500萬", "龍二街"]]) {
    const app = await boot();
    await say(app, t);
    assert.deepEqual(app.net.idx().length, 1);
    assert.ok(!heardTags(app).some(x => x.includes(road)), `${t} → ${heardTags(app)}`);
    assert.equal(SCH.knownRoad(road), false);
  }
});

test("R4-2 逾時 1.5 秒、載入失敗、格式不對：一律維持現狀，不報錯、不掉畫面", { skip: SKIP }, async () => {
  const w = watchRejections();
  try {
    const failing = [
      ["連線失敗", () => { throw new Error("offline"); }],
      ["404 的網頁", () => new Response("<html>not found</html>", { status: 404 })],
      ["不是 JSON", () => new Response("<html>ok</html>", { status: 200 })],
      ["沒有 r 欄", () => Response.json({ v: "x" })],
      ["索引太小（被截斷）", () => Response.json({ r: { "崇德路": "1:0" } })],
      ["r 不是物件", () => Response.json({ r: null })],
    ];
    for (const [name, idx] of failing) {
      const app = await boot({ net: mkNet({ idx }) });
      await say(app, FAKE_ROAD);
      await app.clock.advance(3000);
      assert.equal(app.state(), "s2", name);
      assert.deepEqual(heardTags(app), ["北屯區福祿壽路", "3 房", "2000 萬以內"], name);
      assert.equal(app.$$("#s2-chat .u2-banner").length, 0, `${name}：不顯示任何錯誤或說明`);
      assert.equal(app.$("#err-msg") && !app.$("#err-msg").closest(".u2-state").hidden, false);
    }
    // 一直沒回應：1.5 秒到了就算了，之後才回來的也不理
    let release;
    const hang = new Promise(res => { release = () => res(idxOk()); });
    const app = await boot({ net: mkNet({ idx: () => hang }) });
    await say(app, FAKE_ROAD);
    await app.clock.advance(1400);
    assert.ok(heardTags(app)[0].includes("福祿壽路"), "還沒到 1.5 秒：還在等");
    await app.clock.advance(300);
    release();
    await flush();
    assert.deepEqual(heardTags(app), ["北屯區福祿壽路", "3 房", "2000 萬以內"], "逾時之後才回來的不處理");
    act(app, "go-now");
    assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區福祿壽路"), "維持現狀：交給伺服器端丟掉");
  } finally { w.stop(); }
  assert.deepEqual(w.seen, [], "沒有沒接住的例外");
});

test("R4-2 1.5 秒內回來才算：此時客人在哪一頁都跟著更新；客人先改掉路名就不動", { skip: SKIP }, async () => {
  const defer = () => { let release; const p = new Promise(res => { release = () => res(idxOk()); }); return { p, release }; };
  // 還在「我聽到的」
  let d = defer();
  let app = await boot({ net: mkNet({ idx: () => d.p }) });
  await say(app, FAKE_ROAD);
  await app.clock.advance(1200);
  d.release(); await flush();
  assert.deepEqual(heardTags(app), ["北屯區", "3 房", "2000 萬以內"]);
  assert.ok(app.$$("#s2-actions [data-act]").length >= 2, "按鈕還在");
  // 已經走到追問：「我聽到的是…」那一句改掉，右側摘要也改
  d = defer();
  app = await boot({ net: mkNet({ idx: () => d.p }) });
  await say(app, FAKE_ROAD);
  act(app, "continue");
  assert.equal(app.state(), "s3");
  assert.match(app.text("#s3-chat [data-heard]"), /北屯區福祿壽路/);
  d.release(); await flush();
  assert.equal(app.state(), "s3");
  assert.equal(app.text("#s3-chat [data-heard]"), "我聽到的是：北屯區、3 房、2000 萬以內。");
  assert.ok(!/福祿壽路/.test(app.text("#aside-tags")));
  // 已經在需求單
  d = defer();
  app = await boot({ net: mkNet({ idx: () => d.p }) });
  await say(app, FAKE_ROAD);
  act(app, "go-now");
  assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區福祿壽路"));
  d.release(); await flush();
  assert.equal(app.state(), "s4");
  assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區"));
  assert.ok(!/福祿壽路/.test(app.text("#aside-tags")));
  // 客人自己先把區域改成兩個（路段本來就會被拿掉），之後索引才回來：什麼都不會壞
  d = defer();
  app = await boot({ net: mkNet({ idx: () => d.p }) });
  await say(app, FAKE_ROAD);
  act(app, "go-now");
  click(app.$("[data-edit='district']"));
  chooseOpt(app, "北屯區"); chooseOpt(app, "西屯區");
  click(app.$("#q-ok"));
  assert.equal(app.state(), "s4");
  d.release(); await flush();
  assert.equal(app.state(), "s4");
  assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區、西屯區"));
});

test("R4-2 重整後還原（s4）：條件裡還有路名就再驗一次；等待中／結果頁的還原不載入索引", { skip: SKIP }, async () => {
  const fields = { districts: ["北屯區"], road: "福祿壽路", rooms_min: 3, rooms_max: 3, price_max_wan: 2000 };
  const base = { sid: "Qw3kT9xLm2PzR8aVb5NcDe", idem: "", jobId: null, step: "s4", fields, context: {}, freeText: FAKE_ROAD, from: "", res: null, waitStart: 0, fatigueDone: false };
  const app = await boot({ session: { "find.v1": JSON.stringify(base) } });
  assert.equal(app.state(), "s4");
  assert.equal(app.net.idx().length, 1);
  assert.ok(rows(app).some(r => rowTxt(r) === "區域北屯區"), "背景驗證完，假路名拿掉");
  assert.equal(JSON.parse(app.win.sessionStorage.getItem("find.v1")).fields.road, undefined, "存檔裡的條件也跟著更新");
  const waiting = await boot({ session: { "find.v1": JSON.stringify({ ...base, step: "s6", jobId: JOB, waitStart: 1790000000000 }) } });
  assert.equal(waiting.state(), "s6");
  assert.equal(waiting.net.idx().length, 0);
});

test("R4-2 靜態：路名清單不在 find-app.js 裡（不進首載 JS）；只有一處讀索引", () => {
  assert.ok(!APP_SRC.includes("崇德路"), "沒有內嵌任何路名清單");
  assert.deepEqual([...APP_SRC.matchAll(/['"]\/data\/[^'"]*['"]/g)].map(m => m[0]), ["'/data/tc-addr/index.json'"]);
  assert.ok(!/\bXMLHttpRequest\b|importScripts|new Worker/.test(APP_SRC));
  assert.ok(Buffer.byteLength(APP_SRC.replace(/\r\n/g, "\n")) <= 84 * 1024, "以 LF 版本計（Windows 簽出會變 CRLF）；2026-10-09 範圍找法放寬到 84KB");
});
