// 瀏覽器端抽取器的效能回歸（2026-10-06 複查 F4）：個資清洗的 line／賴 正規式曾是立方時間回溯。
// 「line」後面接 2000 個空白 → 約 2.5 秒（客人的手機分頁凍結）。find-app.js 的 #q= 網址片段路徑能把沒裁過的 2000 字送進 extract。
// 修法：每個 \s* 後面都跟一個必要字元，語言不變、線性時間。這裡守兩件事：① 惡意輸入夠快 ② 新舊正規式的比對結果一模一樣。
import test from "node:test";
import assert from "node:assert/strict";
import { loadClassic } from "./_helpers.mjs";

const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const ms = s => { const t0 = performance.now(); const r = NE.extract(s); return [performance.now() - t0, r]; };

test("F4 惡意輸入耗時：line／賴 後面接長空白（#q= 網址片段能把 2000 字送進抽取器）；門檻 100ms（修補前約 2500ms）", () => {
  for (const head of ["line", "LINE", "賴", "Line id", "line id", "賴id"]) {
    for (const sp of [" ", "　", "\t", "\n", " "]) {
      const s = (head + sp.repeat(2000)).slice(0, 2000);
      const [t] = ms(s);
      assert.ok(t < 100, `${JSON.stringify(head)}+${JSON.stringify(sp)}×… 花了 ${t.toFixed(0)}ms`);
    }
  }
});

test("F4 惡意輸入耗時：300 字上限內與 2000 字的代表性輸入都在 100ms 內", () => {
  const cases = ["line" + " ".repeat(296), "1".repeat(300), "千".repeat(300), "改成".repeat(150), "他要".repeat(150), "a-".repeat(150), "1,".repeat(150),
    "(".repeat(300), "（".repeat(300), " ".repeat(300), "line ".repeat(60), "賴 ".repeat(150), "line:".repeat(60), "lineid ".repeat(40),
    "٢".repeat(2000), "٠٩".repeat(1000), "預算٢٠٠٠萬 ".repeat(150), "๑".repeat(2000)];
  for (const s of cases) { const [t] = ms(s); assert.ok(t < 100, `${JSON.stringify(s.slice(0, 12))}… 花了 ${t.toFixed(0)}ms`); }
});

test("F4 line／賴 的 ID 照樣被當個資清掉（行為不變）", () => {
  for (const [inp, pii] of [["我 line:abc123 找北屯三房", ["line"]], ["賴 id 是 abc_123", ["line"]], ["LINE @abc123", ["line"]], ["line   abc123 北屯", ["line"]], ["line id : abc123", ["line"]], ["賴=abc123", ["line"]]]) {
    assert.deepEqual(Array.from(NE.extract(inp).pii), pii, inp);
  }
  assert.deepEqual(Array.from(NE.extract("北屯三房兩千萬內").pii), []);
  assert.equal(NE.scrub("找北屯 line id: wang_1234 三房").clean, "找北屯 三房");
});

test("F4 新舊 line／賴 正規式的比對結果一模一樣（隨機字串差分：命中位置與長度）", () => {
  const OLD = /(?<![A-Za-z])(?:line|賴)\s*(?:id)?\s*[:=是為]?\s*@?[A-Za-z0-9._\-]{4,30}/gi;
  const NEW = /(?<![A-Za-z])(?:line|賴)\s*(?:id\s*)?(?:[:=是為]\s*)?@?[A-Za-z0-9._\-]{4,30}/gi;
  const toks = ["l", "i", "n", "e", "L", "I", "D", "id", "ID", "line", "LINE", "賴", " ", " ", "\t", "　", ":", "=", "是", "為", "@", "a", "1", "-", "_", ".", "abcd", "x9", "，"];
  let seed = 20261006;
  const rnd = n => (seed = (seed * 1664525 + 1013904223) >>> 0) % n;
  for (let i = 0; i < 40000; i++) {
    let s = "";
    for (let k = rnd(14); k >= 0; k--) s += toks[rnd(toks.length)];
    const a = [...s.matchAll(OLD)].map(m => [m.index, m[0].length]), b = [...s.matchAll(NEW)].map(m => [m.index, m[0].length]);
    assert.deepEqual(b, a, JSON.stringify(s));
  }
});
