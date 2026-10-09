// 上線時 dist/js/*.js 會被 scripts/postbuild-minify.mjs 壓縮。這裡用同一組 esbuild 選項壓一次，
// 確認壓完的行為跟原檔一致（匯出的名稱、抽取結果、計分），並確認它們不會被「保留原檔」跳過。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { ROOT, readFixture } from "./_helpers.mjs";

const read = f => fs.readFileSync(path.join(ROOT, "public/js", f), "utf8");
const mini = code => transformSync(code, { minify: true, loader: "js", legalComments: "none", charset: "utf8" }).code;
function load(code) {
  const m = { exports: {} };
  vm.runInThisContext(`(function (module, exports) {${code}\n})`)(m, m.exports);
  return m.exports;
}
const plain = o => JSON.parse(JSON.stringify(o));

test("postbuild-minify：六支新腳本都會被壓縮（不會被『頂層名稱找不到』跳過）", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/postbuild-minify.mjs"), "utf8");
  // 用跟 postbuild-minify 相同的判斷式：外層是 IIFE 的檔案，不檢查頂層名稱
  const m = /const missing = \((\/\^[^\n]*?\/)\.test\(code\)/.exec(src);
  assert.ok(m, "postbuild-minify.mjs 沒有 IIFE 例外判斷");
  const re = new Function("return " + m[1])();
  for (const f of ["find-app.js", "need-extract.js", "find-brief.js", "wait-game.js", "wait-board.js", "find-scope.js"]) {
    assert.ok(re.test(read(f)), `${f} 不是 IIFE 開頭`);
    assert.ok(mini(read(f)).length < read(f).length, `${f} 壓縮後沒有變小`);
  }
});

test("壓縮後：need-extract 對全部夾具句子的抽取結果與原檔逐案相同", () => {
  const A = load(read("need-extract.js"));
  const B = load(mini(read("need-extract.js")));
  assert.deepEqual(Object.keys(B).sort(), Object.keys(A).sort());
  const FX = readFixture("need_fixtures.json");
  let n = 0;
  for (const c of FX.cases) {
    if (c.kind !== "extract" || typeof c.text !== "string") continue;
    assert.deepEqual(plain(B.extract(c.text)), plain(A.extract(c.text)), c.id);
    assert.deepEqual(plain(B.assess(B.extract(c.text).fields, {})), plain(A.assess(A.extract(c.text).fields, {})), c.id);
    n++;
  }
  assert.ok(n >= 80);
  // 個資清洗與網址片段編碼
  const s = "我電話 0912-345-678，北屯三房 2000 萬內";
  assert.deepEqual(plain(B.scrub(s)), plain(A.scrub(s)));
});

test("壓縮後：find-app 匯出的純邏輯與原檔相同", () => {
  const A = load(read("find-app.js"));
  const B = load(mini(read("find-app.js")));
  assert.deepEqual(Object.keys(B).sort(), Object.keys(A).sort());
  for (const k of Object.keys(A)) assert.equal(typeof B[k], typeof A[k], k);
});

test("壓縮後：wait-game 的計分與匯出與原檔相同；find-brief 語法正確", () => {
  const A = load(read("wait-game.js"));
  const B = load(mini(read("wait-game.js")));
  assert.deepEqual(Object.keys(B).sort(), Object.keys(A).sort());
  for (const v of [0, 1, 9, 10, 49, 50, 199, 200, 1000, 99999]) assert.equal(B.core.scoreBucket(v), A.core.scoreBucket(v), String(v));
  assert.doesNotThrow(() => new vm.Script(mini(read("find-brief.js"))));
});

test("壓縮後：find-scope 的純函式（猜社區名、s8 說法）與原檔相同", () => {
  const A = load(read("find-scope.js"));
  const B = load(mini(read("find-scope.js")));
  const NE = load(read("need-extract.js"));
  assert.deepEqual(Object.keys(B).sort(), Object.keys(A).sort());
  for (const t of ["文華匯", "想看文華匯", "文華匯有嗎", "採光好", "七期有在賣嗎", "", "文華匯 "]) assert.equal(B.guess(t, NE.normalizeFields), A.guess(t, NE.normalizeFields), t);
  for (const h of [["scope_drop"], ["comm_fix", "scope_drop"], ["geo_partial", "scope_drop"], ["scope_busy"], []]) {
    for (const f of [{ community: "文華匯" }, { zone: "r74" }, { geo: [[1, 2], [3, 4], [5, 6]] }, {}]) assert.deepEqual(plain(B.emptyPlan(f, h, 0, ["geo"])), plain(A.emptyPlan(f, h, 0, ["geo"])));
  }
  assert.deepEqual(plain(B.T), plain(A.T), "固定文案沒有被壓壞");
});

test("壓縮後：wait-board 匯出的介面與原檔相同", () => {
  const A = load(read("wait-board.js"));
  const B = load(mini(read("wait-board.js")));
  assert.deepEqual(Object.keys(B).sort(), Object.keys(A).sort());
  for (const k of Object.keys(A)) assert.equal(typeof B[k], typeof A[k], k);
  assert.deepEqual(plain(B.T), plain(A.T), "固定文案沒有被壓壞");
});
