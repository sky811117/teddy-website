// 瀏覽器端抽取器（public/js/need-extract.js）吃共用夾具 need_fixtures.json，逐案比對。
// 夾具與伺服器端同一份（sha256 要一致，見 fixtures.test.mjs）；這裡只跑 JS 版負責的 kind：extract／assess／pii／frag／validate。
import test from "node:test";
import assert from "node:assert/strict";
import { loadClassic, readFixture } from "./_helpers.mjs";
import { validateSubmit } from "./_ne_submit.mjs";

const FX = readFixture("need_fixtures.json");
const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const cases = kind => FX.cases.filter(c => c.kind === kind);

const sorted = a => [...(a || [])].sort();
const normExtract = (r, e) => {
  const got = { fields: NE.normalizeFields(r.fields).fields, dropped: sorted(r.dropped), pii: sorted(r.pii), out_of_scope: r.out_of_scope, level: r.level, missing: r.missing };
  const exp = { fields: NE.normalizeFields(e.fields).fields, dropped: sorted(e.dropped), pii: sorted(e.pii), out_of_scope: e.out_of_scope, level: e.level, missing: e.missing };
  if ("context" in e) { got.context = r.context; exp.context = e.context; }
  if ("inferred" in e) { got.inferred = sorted(r.inferred); exp.inferred = sorted(e.inferred); }
  return [got, exp];
};

test("夾具規模：extract ≥80 句、各 kind 都有", () => {
  assert.ok(cases("extract").length >= 80);
  for (const k of ["extract", "assess", "pii", "frag", "validate"]) assert.ok(cases(k).length > 0, k);
});

// 夾具複本（sha256 鎖死，這裡不能改）落後家用機正本 08:56 修訂版的地方：x106「太原路附近」RT-11 之後期望 fields={}、level=empty
// （路段不能單獨成立；複本還是舊的 fields={road}、level=vague）。景泰／家用機端把夾具同步過來、更新 fixtures.test.mjs 的雜湊後，這張表可以刪。
const HOME_REVISED = {};   // 2026-10-06 14:40 夾具已與家用機正本同步，不再需要覆蓋表（保留空表以免動到下面的呼叫）

test("extract（規則式層）逐案相符", () => {
  const rules = cases("extract").filter(c => c.tier === "rules");
  assert.ok(rules.length >= 60);
  const bad = [];
  for (const c of rules) {
    const r = NE.extract(c.text);
    const [got, exp] = normExtract(r, { ...c.expect, ...(HOME_REVISED[c.id] || {}) });
    try {
      assert.deepEqual(got, exp);
      for (const x of c.must_not || []) assert.ok(!JSON.stringify(r).includes(x), `${c.id} 不得含 ${x}`);
    } catch (e) {
      bad.push(`${c.id} ${JSON.stringify(c.text)}\n   got=${JSON.stringify(got)}\n   exp=${JSON.stringify(exp)}`);
    }
  }
  assert.equal(bad.length, 0, `\n${bad.join("\n")}`);
});

test("extract（LLM 才行的層）不丟例外、輸出合法（可以答錯）", () => {
  for (const c of cases("extract").filter(c => c.tier === "llm")) {
    const r = NE.extract(c.text);
    assert.deepEqual(NE.normalizeFields(r.fields).issues, [], c.id);
  }
});

test("extract 對怪輸入不丟例外、欄位一定過白名單", () => {
  for (const x of [null, undefined, "", " ", "\x00", 123, [], {}, "😀".repeat(50), "a".repeat(5000), "北屯".repeat(400), "​​"]) {
    const r = NE.extract(x);
    assert.ok("fields" in r && typeof r.level === "string");
    assert.deepEqual(NE.normalizeFields(r.fields).issues, []);
  }
  for (const c of cases("extract")) {
    const r = NE.extract(c.text);
    const n = NE.normalizeFields(r.fields);
    assert.deepEqual(n.issues, [], c.id);
    assert.deepEqual(n.fields, r.fields, c.id);
  }
});

test("未完工建設與預售屋在抽取階段就丟掉（不進條件、有說明）", () => {
  for (const text of ["近藍線站 北屯 三房 2000萬", "輕軌旁 西屯 2房 1500萬以內", "橘線 北屯 3房 2000萬", "預計興建中的學校旁 北屯 三房 2000萬", "預售屋 北屯 3房 2000萬", "新建案 北屯 3房 2000萬"]) {
    const r = NE.extract(text);
    assert.ok(r.dropped.length > 0, text);
    assert.ok(!JSON.stringify(r.fields).match(/藍線|輕軌|橘線|預售|建案/), text);
  }
});

test("近捷運只當提示（已通車前提），不進條件", () => {
  const r = NE.extract("近捷運 西屯 兩房 1500萬以內");
  assert.deepEqual(r.context.special, ["transit"]);
  assert.ok(!JSON.stringify(r.fields).includes("捷運"));
});

test("個資只記型態，內容不進任何欄位", () => {
  const r = NE.extract("我姓王 電話0912-345-678 LINE ID: wang_1234 abc@x.com 北屯三房1800萬以內");
  assert.deepEqual(sorted(r.pii), ["email", "line", "name", "phone"]);
  const blob = JSON.stringify(r);
  for (const bad of ["0912", "wang_1234", "abc@x.com", "我姓王"]) assert.ok(!blob.includes(bad), bad);
});

test("assess／nextQuestions 逐案相符", () => {
  for (const c of cases("assess")) {
    const a = NE.assess(c.fields, c.skip);
    const e = c.expect;
    assert.deepEqual([a.level, a.missing, a.sendable], [e.level, e.missing, e.sendable], c.id);
    assert.deepEqual(NE.nextQuestions(c.fields, {}, c.answered, c.skipped, 4, c.skip), e.next, c.id);
  }
});

test("追問規則：最多 4 題、skip 回空、套房不問房數與車位、空的不可送", () => {
  assert.equal(NE.nextQuestions({}, {}, [], [], 10).length, 4);
  assert.deepEqual(NE.nextQuestions({}, {}, [], [], 4, true), []);
  assert.deepEqual(NE.nextQuestions({}, {}, [], [], 2), ["q_district", "q_budget"]);
  assert.deepEqual(NE.nextQuestions({}, {}, [], [], 0), []);
  assert.deepEqual(NE.nextQuestions({ districts: ["北屯區"] }, {}, ["q_budget"], ["q_rooms", "q_concerns"]), ["q_parking", "q_age", "q_stage", "q_timeline"]);
  const q = NE.nextQuestions({ districts: ["北區"], types: ["studio"], price_max_wan: 800 }, {}, [], []);
  assert.ok(!q.includes("q_rooms") && !q.includes("q_parking"));
  assert.equal(NE.assess({}, true).sendable, false);
});

test("pii 清洗逐案相符", () => {
  for (const c of cases("pii")) {
    const r = NE.scrub(c.text);
    assert.deepEqual(sorted(r.pii), sorted(c.expect.types), c.id);
    for (const x of c.expect.absent) assert.ok(!r.clean.includes(x), `${c.id} 應被清掉：${x}`);
    for (const x of c.expect.present) assert.ok(r.clean.includes(x), `${c.id} 應保留：${x}`);
  }
});

test("清洗：換行、控制字元、零寬字元被拿掉；清洗冪等", () => {
  const { clean } = NE.scrub("北屯\n三房\t2000萬\x00​以內\r\n");
  assert.ok(!/[\n\t\x00​]/.test(clean));
  const t = "我姓王 電話0912-345-678 北屯三房 2000萬以內 排除2樓、5樓、頂樓";
  const c1 = NE.scrub(t).clean;
  assert.equal(NE.scrub(c1).clean, c1);
});

test("#k 片段：組出與解析逐案相符（與伺服器端 token 逐字相同）", () => {
  for (const c of cases("frag")) {
    if (c.dir === "encode") {
      assert.equal(NE.fragEncode(c.fields, c.context), c.expect.token, c.id);
    } else {
      const d = NE.fragDecode(c.token);
      if (!c.expect.ok) { assert.equal(d, null, c.id); continue; }
      assert.deepEqual(d.f, NE.normalizeFields(c.expect.f).fields, c.id);
      assert.deepEqual([d.c, d.s, d.st, d.tl], [c.expect.c, c.expect.s, c.expect.st, c.expect.tl], c.id);
    }
  }
});

test("#k 片段：不含路段、坪數、樓層下限；拒絕怪字串；大小有上限", () => {
  const d = NE.fragDecode(NE.fragEncode({ districts: ["北屯區"], road: "太原路三段", area_min_ping: 30, floor_min: 3 }, { concerns: ["loan"] }));
  assert.deepEqual(d.f, { districts: ["北屯區"] });
  for (const t of [null, 123, "", "!!!", "A".repeat(901), "=".repeat(10), "北屯"]) assert.equal(NE.fragDecode(t), null);
  const big = NE.fragEncode({ districts: ["北屯區", "西屯區"], floor_exclude: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, { concerns: NE.ENUM.CONCERNS, special: NE.ENUM.SPECIALS });
  assert.ok(big.length <= 900);
});

test("validate 提交本文逐案相符", () => {
  for (const c of cases("validate")) {
    const { out, err } = validateSubmit(NE, c.body);
    const e = c.expect;
    if ("err" in e) { assert.equal(out, null, c.id); assert.equal(err, e.err, c.id); continue; }
    assert.equal(err, null, c.id);
    for (const [k, v] of Object.entries(e)) {
      if (k === "ok") continue;
      assert.deepEqual(out[k], v, `${c.id} ${k}`);
    }
  }
});

test("cnToNum", () => {
  const t = { 兩千五百: 2500, 十五: 15, 一點五: 1.5, 一千五: 1500, 12: 12, 兩百五: 250, 一五零零: 1500, 三: 3 };
  for (const [k, v] of Object.entries(t)) assert.equal(NE.cnToNum(k), v, k);
  assert.equal(NE.cnToNum("abc"), null);
  assert.equal(NE.cnToNum(""), null);
});

test("檔案大小在預算內、零網路與零儲存呼叫", async () => {
  const fs = await import("node:fs");
  const zlib = await import("node:zlib");
  const { transformSync } = await import("esbuild");
  const src = fs.readFileSync(new URL("../../public/js/need-extract.js", import.meta.url), "utf8");
  // 09 §6.4 寫「≤20KB」是以英文程式碼為想像；這支有大量中文規則（UTF-8 每字 3 位元組），
  // 原始檔約 38KB、壓縮後約 25KB、gzip 約 11KB。實際預算是 11.3 的「首載 JS（find-app＋need-extract）≤25KB gzip」，所以這裡守 gzip。
  // 2026-10-06 JS 移植員：移植 Python 規則式抽取器當天新增的行為（口語價格、自我更正、別人的意見、樓層清單、房數、未完工泛化…）後，
  // 原始檔約 57KB（含大量中文註解）、gzip 約 14.7KB；預算從 40KB／12KB 放寬到 60KB／15.5KB（量測值再加約 5% 餘裕）。
  const min = transformSync(src, { minify: true, loader: "js", charset: "utf8", legalComments: "none" }).code;
  assert.ok(Buffer.byteLength(src) <= 60 * 1024, `原始檔 ${Buffer.byteLength(src)}`);
  assert.ok(zlib.gzipSync(min).length <= 15.5 * 1024, `gzip ${zlib.gzipSync(min).length}`);
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|eval|document\.cookie)\b/.test(src));
  assert.ok(!/new Function\(/.test(src));
});
