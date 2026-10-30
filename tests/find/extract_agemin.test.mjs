// 2026-10-30 屋齡下限（age_min）：景泰打「西屯 南屯 2-3房 1000萬內 屋齡10-20年 車位有無都可」，推薦頁 15 間裡有 0.9 年、6 年的新屋
// ——以前只收上限「20 年內」，下限整個丟掉。這裡守瀏覽器端抽取、正規化、#k 片段、推薦頁標籤與確認畫面文字，跟 mp_aif_need（tests/test_aif_need.py AgeMinTests）同一套。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT, loadClassic } from "./_helpers.mjs";

const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const FB_SRC = fs.readFileSync(path.join(ROOT, "public/js/find-brief.js"), "utf8");
const FB = (() => { const m = { exports: {} }; vm.runInThisContext(`(function(module){${FB_SRC}
})`)(m); return m.exports; })();
const A = t => { const f = NE.extract(t).fields; return { age_min: f.age_min, age_max: f.age_max }; };

test("區間兩頭都收；倒過來寫也一樣", () => {
  for (const s of ["西屯 南屯 2-3房 1000萬內 屋齡10-20年 車位有無都可", "屋齡10到20年 北屯三房", "屋齡10~20年 北屯",
    "南屯 三房 屋齡在十到二十年之間", "屋齡10年到20年 北屯", "屋齡20到10年 北屯"]) {
    assert.deepEqual(A(s), { age_min: 10, age_max: 20 }, s);
  }
});

test("「以上／起／至少」只收下限；舊說法不變", () => {
  assert.deepEqual(A("西屯 兩房 屋齡10年以上"), { age_min: 10, age_max: undefined });
  assert.deepEqual(A("西屯 兩房 屋齡至少15年"), { age_min: 15, age_max: undefined });
  assert.deepEqual(A("西屯 兩房 屋齡10年起"), { age_min: 10, age_max: undefined });
  assert.deepEqual(A("屋齡20年內 北屯三房"), { age_min: undefined, age_max: 20 });
  assert.deepEqual(A("北屯三房 屋齡20年"), { age_min: undefined, age_max: 20 });
  assert.deepEqual(A("北屯三房 新成屋"), { age_min: undefined, age_max: 5 });
  assert.deepEqual(A("屋齡0-20年 北屯"), { age_min: undefined, age_max: 20 });
  assert.deepEqual(A("我住這裡10年以上了 想換北屯三房"), { age_min: undefined, age_max: undefined });
});

test("正規化、追問、#k 片段與文字", () => {
  assert.deepEqual(NE.normalizeFields({ age_min: 25, age_max: 20 }).fields, {});
  assert.ok(!NE.nextQuestions({ districts: ["北屯區"], age_min: 10 }, {}, [], [], 4).includes("q_age"));
  const f = { districts: ["西屯區"], age_min: 10, age_max: 20 };
  const d = NE.fragDecode(NE.fragEncode(f));
  assert.equal(d.f.age_min, 10);
  assert.equal(d.f.age_max, 20);
  assert.equal(NE.ageText(f), "10～20 年");
  assert.equal(NE.ageText({ age_max: 20 }), "20 年內");
  assert.equal(NE.ageText({ age_min: 10 }), "10 年以上");
  assert.equal(NE.ageText({}), "");
});

test("推薦頁標籤（find-brief.js）照 #k 片段寫屋齡區間", () => {
  const tg = f => [...FB.model(NE.fragEncode(f, {})).tags];
  assert.ok(tg({ districts: ["西屯區"], age_min: 10, age_max: 20 }).includes("10～20 年"));
  assert.ok(tg({ districts: ["西屯區"], age_min: 10 }).includes("10 年以上"));
  assert.ok(tg({ districts: ["西屯區"], age_max: 20 }).includes("20 年內"));
});
