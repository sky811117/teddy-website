// 瀏覽器端抽取器（public/js/need-extract.js）R4-CMP-1（2026-10-06）：口語泛稱不要被當成路名。
// 背景：JS 沒有路名字典（40KB 放不進首載預算），只做保守檢查；Python 有字典，「面馬路」「離大路」「十二米路」「臨大馬路」這類字典外的說法一律不收 road。
// 以前 JS 會把它們收進 road（例：「西屯區 面馬路 3房」→ road=面馬路），確認畫面短暫顯示假路名，慢網路或載入失敗時一直顯示，送出後伺服器才丟掉。
// 這輪：①ROAD_JUNK 補「面離對側米沿著緊貼產」（0 次出現在台中市任何真路名）②近／臨開頭的泛稱（近馬路、臨大馬路、臨近大路）用形狀擋
//      （「近／臨」本身在真路名裡：近山路、臨港路，不能整個字丟）。
// 全部離線、純函式。黃金對照 need_r4_road_cases.json = Python（mp_aif_need.extract）對 47 句的完整輸出。路名字典只當「答案」核對。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadClassic, bundleTs, readFixture } from "./_helpers.mjs";

const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const F = t => NE.extract(t).fields;
const SRC = fs.readFileSync(path.join(ROOT, "public/js/need-extract.js"), "utf8");
const best = (fn, arg, n = 3) => { let m = 1e9; for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(arg); m = Math.min(m, performance.now() - t0); } return m; };

let roadsCache = null;
async function roads() {
  if (!roadsCache) {
    const { ROADS_BY_DISTRICT } = (await bundleTs("src/lib/find/roads_tc.ts")).mod;
    const pairs = [];
    for (const [d, list] of Object.entries(ROADS_BY_DISTRICT)) for (const r of list.split(",").filter(Boolean)) pairs.push([d, r]);
    roadsCache = pairs;
  }
  return roadsCache;
}

test("複查原句：口語泛稱不當路名，其他欄位（區域、價格、房數）照收", () => {
  const D = (d, extra) => ({ districts: [d], ...extra });
  const rooms3 = { rooms_min: 3, rooms_max: 3 };
  const cases = [
    ["西屯區 面馬路 3房", D("西屯區", rooms3)],
    ["南屯 臨大馬路 兩千萬", D("南屯區", { price_max_wan: 2000 })],
    ["北區 近馬路 三房", D("北區", rooms3)],
    ["北屯 離大路近 三房", D("北屯區", rooms3)],
    ["北屯區 面大路 三房", D("北屯區", rooms3)],
    ["西屯區 面公路 三房", D("西屯區", rooms3)],
    ["東區 近大路但不要吵 三房", D("東區", rooms3)],
  ];
  for (const [t, exp] of cases) assert.deepEqual(F(t), exp, t);
});

test("每個新字各一組：面／對／側／離／米／沿／緊／貼／產（含 15 米路這種阿拉伯數字寫法）", () => {
  for (const t of ["北屯區 面臨大馬路 要安靜 三房 兩千萬", "西區 對面就是大馬路 三房", "南區 側面馬路 兩房 1200萬內", "大里 離馬路遠一點 3房", "太平 距離大馬路遠 三房 一千五以內", "豐原 背對馬路 三房",
    "西屯 面十二米路 三房 兩千萬", "北區 三十米大道 四房 兩千五", "南屯 二十米大路旁 三房", "豐原 15米路 三房 一千萬",
    "北屯 沿著大馬路 三房", "大里 沿馬路 三房 1500萬內", "西屯區 緊臨大馬路 三房 兩千萬", "南屯 貼近馬路 兩房", "北屯區 產業道路旁 預算兩千萬 三房"]) {
    const f = F(t);
    assert.ok(!("road" in f), t);
    assert.equal(f.districts.length, 1, t); // 其他欄位沒被牽連
  }
});

test("近／臨開頭的泛稱用形狀擋：近馬路、臨馬路、臨大馬路、臨近大馬路、近公路、臨大路、臨近大道、近大街", () => {
  for (const t of ["北屯區 臨馬路 三房", "西屯 臨近大馬路 三房 兩千萬", "北區 近公路 三房", "大里 臨大路 三房", "東區 臨近大道 三房", "南區 近大街 三房 兩千萬"]) assert.ok(!("road" in F(t)), t);
});

test("第一個候選不能用就整個不收（同 Python）：後面的真路名不去撿；前面的真路名不受後面泛稱影響", () => {
  assert.ok(!("road" in F("面大馬路的不要 北屯區文心路 三房")));
  assert.ok(!("road" in F("臨大馬路不要，西屯區 河南路 三房 兩千萬以內")));
  assert.equal(F("想買北屯區崇德路 但不要面大馬路 三房").road, "崇德路");
});

test("對照組：真路名照收——含「近／臨」開頭的真路名（近山路、臨海路、臨江路、臨港路五段、臨港東路一段）與台中真的有的「大馬路」", () => {
  assert.equal(F("西屯區文心路 三房 2000萬以內").road, "文心路");
  assert.equal(F("北屯 近文心路 三房").road, "文心路"); // 「近」是口語前導詞，剝掉
  assert.equal(F("北屯區近山路 三房 兩千萬").road, "近山路");
  assert.equal(F("清水區臨海路 三房 一千萬").road, "臨海路");
  assert.equal(F("大甲區臨江路 三房 一千萬").road, "臨江路");
  assert.equal(F("清水區臨港路五段 三房 一千五").road, "臨港路五段");
  assert.equal(F("龍井區臨港東路一段 三房 一千五").road, "臨港東路一段");
  assert.equal(F("西屯區 大馬路 三房").road, "大馬路"); // 字典有這條路，Python 收
});

test("字典內「近／臨」開頭的真路名全部收得到（字典改版多了新的就會在這裡亮燈，提醒改 extRoad 的形狀）", async () => {
  const pairs = (await roads()).filter(([, r]) => /^[近臨]/.test(r));
  assert.ok(pairs.length >= 10, `只找到 ${pairs.length} 條`);
  const lost = pairs.filter(([d, r]) => F(`${d}${r} 三房 2000萬以內`).road !== r).map(([d, r]) => d + r);
  assert.deepEqual(lost, []);
});

test("新增的字與形狀不會丟掉任何一條真路名（字典全部 4000+ 條逐條核對路名主體）", async () => {
  const pairs = await roads();
  const base = r => r.replace(/(?:大道|路|街)(?:[一二三四五六七八九十]{1,2}段)?$/, "");
  const NEW = /[面離對側米沿著緊貼產]/, SHAPE = /^[近臨]+大?[馬公]?$/;
  const bad = pairs.filter(([, r]) => NEW.test(base(r)) || SHAPE.test(base(r))).map(([d, r]) => d + r);
  assert.deepEqual(bad, []);
  // 程式裡真的有這幾個字與這個形狀（上面的核對才算數）
  const m = /var ROAD_JUNK = \/\[([^\]]+)\]\/;/.exec(SRC);
  for (const c of "面離對側米沿著緊貼產") assert.ok(m[1].includes(c), c);
  assert.ok(SRC.includes("[近臨]+大?[馬公]?"), "近／臨 泛稱的形狀檢查");
});

test("黃金對照：Python 規則式對 47 句的完整輸出（欄位、丟棄、個資、level、missing、inferred、context）JS 欄欄一樣", () => {
  const G = readFixture("need_r4_road_cases.json").cases;
  assert.equal(G.length, 47);
  assert.ok(G.filter(c => !("road" in c.fields)).length >= 30 && G.filter(c => "road" in c.fields).length >= 10, "有路名／沒路名兩邊都要有");
  const sorted = a => [...(a || [])].sort();
  for (const c of G) {
    const r = NE.extract(c.text);
    assert.deepEqual(r.fields, c.fields, `${c.text} fields`);
    assert.deepEqual([sorted(r.dropped), sorted(r.pii), r.level, r.missing, sorted(r.inferred), !!r.out_of_scope, r.context],
      [c.dropped, c.pii, c.level, c.missing, c.inferred, c.out_of_scope, c.context], c.text);
  }
});

test("這個檔的句子都是新寫的：沒有任何一句出現在共用夾具 need_fixtures.json 裡", () => {
  const seen = new Set(readFixture("need_fixtures.json").cases.filter(c => typeof c.text === "string").map(c => c.text.trim()));
  assert.deepEqual(readFixture("need_r4_road_cases.json").cases.filter(c => seen.has(c.text.trim())).map(c => c.text), []);
});

test("已知落差（不是這輪要修的）：字典外的說法 JS 仍會多收，由伺服器端字典事後丟掉，其他欄位照送", async () => {
  const SCH = (await bundleTs("src/lib/find/schema.ts")).mod;
  // 已改名的舊路名、「臨」＋真路名：只有字典才分得出來
  for (const [t, road] of [["西屯區 近中港路 三房", "中港路"], ["西屯區 臨文心路 三房", "臨文心路"]]) {
    const f = F(t);
    assert.equal(f.road, road, t);
    const v = SCH.normalizeFields(f);
    assert.ok(v.issues.includes("road:unknown"), t);
    assert.ok(!("road" in v.fields) && v.fields.districts[0] === "西屯區" && v.fields.rooms_min === 3, t);
  }
});

test("惡意輸入耗時：近／臨／沿／面 反覆出現的 300 字句子，單次抽取 ≤ 50ms", () => {
  const units = ["近大馬路", "臨近大路", "面大馬路", "沿著馬路", "十二米路", "近近近近近近近近近近路", "臨臨臨臨臨臨臨臨臨臨街", "北屯區近大馬路 "];
  for (const u of units) {
    const s = u.repeat(Math.ceil(300 / u.length) + 1).slice(0, 300);
    const t = best(NE.extract, s);
    assert.ok(t <= 50, `${u}×300 花了 ${t.toFixed(1)}ms`);
  }
});
