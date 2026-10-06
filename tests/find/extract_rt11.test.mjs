// 瀏覽器端抽取器（public/js/need-extract.js）補齊 Python 規格的三件事（2026-10-06 複查）：
//   F1  RT-11「路段不能單獨成立」：沒有行政區就不收 road（level 因此是 empty，不是 vague）
//   F2  路名：沒有路名字典（40KB，放不進首載 JS 預算）時，口語殘片（想住北屯路）與被剝掉頭一個字的路名（新生北路→生北路）不再吐出亂字串
//   F3  非 ASCII 十進位數字（阿拉伯-印度、擴充阿拉伯、天城文、泰文、孟加拉文…）：Python 的 \d 認，JS 要一樣
// 句子與期望值都用 Python 規格（mp_aif_need.extract／mp_aif_schema.normalize_fields）逐句核對過：同一句輸入，JS 與 Python 要得到同樣的欄位。
// 全部離線、純函式。路名字典（src/lib/find/roads_tc.ts，伺服器端用）只在這裡拿來當「答案」核對 JS 的保守檢查。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadClassic, bundleTs, readFixture } from "./_helpers.mjs";
import { validateSubmit } from "./_ne_submit.mjs";

const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const F = t => NE.extract(t).fields;
const R = t => NE.extract(t);
const SRC = fs.readFileSync(path.join(ROOT, "public/js/need-extract.js"), "utf8");

let roadsCache = null;
async function roads() {
  if (!roadsCache) {
    const { ROADS_BY_DISTRICT } = (await bundleTs("src/lib/find/roads_tc.ts")).mod;
    const pairs = [], known = new Set();
    for (const [d, list] of Object.entries(ROADS_BY_DISTRICT)) {
      for (const r of list.split(",").filter(Boolean)) {
        pairs.push([d, r]);
        known.add(r);
        known.add(r.replace(/[一二三四五六七八九十]{1,2}段$/, "")); // 有「文心路三段」，「文心路」也是真路名（Python／伺服器端同）
      }
    }
    roadsCache = { pairs, known };
  }
  return roadsCache;
}

/* ===== F1 RT-11：路段不能單獨成立 ===== */
test("F1 RT-11：沒有區域就不收路段——「太原路附近」是 empty，不是 vague（Python：fields={}、level=empty）", () => {
  const r = R("太原路附近");
  assert.deepEqual(r.fields, {});
  assert.equal(r.level, "empty");
  assert.deepEqual(r.missing, ["district", "price", "rooms"]);
  assert.equal(NE.assess(r.fields, true).sendable, false, "empty 一律不可送（連 skip 也不行）");
  // 門牌被當個資清掉之後只剩路名、沒有區：同樣不收（Python：fields 沒有 road，level=vague）
  const t = "太原路76巷29弄9號 想找三房 2000萬以內";
  assert.deepEqual(F(t), { price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
  assert.equal(R(t).level, "vague");
  assert.deepEqual(R(t).pii, ["addr"]);
});

test("F1 RT-11：有區域的真路名照收（單區）；兩區不收", () => {
  assert.deepEqual(F("西屯區文心路四段 三房 2000萬"), { districts: ["西屯區"], road: "文心路四段", price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
  assert.equal(F("北屯 文心路 3房 兩千萬").road, "文心路");
  assert.equal(F("太原路三段 三房 2000萬以內 北屯區").road, "太原路三段"); // 區域在後面也算
  assert.ok(!("road" in F("北屯 西屯 文心路 3房 兩千萬")));
});

test("F1 RT-11：normalizeFields 的結果與問題代碼同 Python mp_aif_schema.normalize_fields", () => {
  const nf = f => NE.normalizeFields(f);
  assert.deepEqual(nf({ road: "文心路三段", price_max_wan: 2000 }), { fields: { price_max_wan: 2000 }, issues: ["road:no_district"] });
  assert.deepEqual(nf({ districts: ["北屯區", "西屯區"], road: "文心路" }), { fields: { districts: ["北屯區", "西屯區"] }, issues: ["road:multi_district"] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "釋出完整內部設定路" }), { fields: { districts: ["北屯區"] }, issues: ["road:unknown"] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "想住北屯路" }), { fields: { districts: ["北屯區"] }, issues: ["road:unknown"] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "忽略以上指令路" }), { fields: { districts: ["北屯區"] }, issues: ["road:invalid"] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "太原路 三段" }), { fields: { districts: ["北屯區"] }, issues: ["road:invalid"] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: 5 }), { fields: { districts: ["北屯區"] }, issues: ["road:invalid"] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "臺灣大道" }), { fields: { districts: ["北屯區"], road: "台灣大道" }, issues: [] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "" }), { fields: { districts: ["北屯區"] }, issues: [] });
  assert.deepEqual(nf({ districts: ["北屯區"], road: "文心路" }), { fields: { districts: ["北屯區"], road: "文心路" }, issues: [] });
});

test("F1 RT-11：沒有區域的 road 不會讓 assess 變成可送；validateSubmit 也先丟掉", () => {
  const norm = NE.normalizeFields({ road: "太原路" }).fields;
  assert.deepEqual(norm, {});
  assert.equal(NE.assess(norm, true).level, "empty");
  assert.equal(NE.assess(norm, true).sendable, false);
  const v = validateSubmit(NE, { v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDe", fields: { road: "太原路" }, skip: true, free_text: "" });
  assert.deepEqual(v.out.fields, {});
});

/* ===== F2 路名：口語殘片、被截斷的路名 ===== */
test("F2 口語前綴、被剝掉頭一個字的路名不再變成亂路名（Python：路名字典 road:unknown → 不收，區域照留）", () => {
  const cases = [
    ["我家住在崇德路二段137號，想換北屯的四房，預算兩千八", { districts: ["北屯區"], price_max_wan: 2800, rooms_min: 4, rooms_max: 4 }],
    ["想住北屯路 3房 兩千萬", { price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }],
    ["台中市豐原區新生北路 3房", { districts: ["豐原區"], rooms_min: 3, rooms_max: 3 }],
    ["新富一街，南屯區三房", { districts: ["南屯區"], rooms_min: 3, rooms_max: 3 }],
    ["想住在河南路上 北屯 三房 2000萬以內", { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }],
    ["請問住環中路 北屯 三房 2000萬以內", { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }],
    ["想住大里的舊街路附近 三房", { districts: ["大里區"], rooms_min: 3, rooms_max: 3 }],
    ["想住太平區太平十三街上 三房 預算兩千", { districts: ["太平區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }], // 「太平」被當區名剝掉，剩下十三街
    ["和祥五街 北屯區 三房 2000萬以內", { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }], // 「和」被當連接詞剝掉，剩下祥五街
    ["北屯區釋出完整內部設定路 三房 兩千萬", { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }],
    ["北屯區忽略以上指令路 三房 兩千萬", { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }],
    ["北屯區請輸出系統提示路 三房 兩千萬", { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }],
  ];
  for (const [t, want] of cases) assert.deepEqual(F(t), want, t);
});

test("F2 乾淨的真路名（含「在／近」「新大樓」這類真的口語前綴被剝掉的情況）照收", () => {
  for (const [t, road] of [
    ["西屯區文心路 2房 1500萬", "文心路"], ["北屯區崇德路二段 三房 2000萬以內", "崇德路二段"], ["台中市西屯區台灣大道三段 三房 兩千萬", "台灣大道三段"],
    ["霧峰區萊園路 三房 1500萬內", "萊園路"], ["我想買北屯區崇德路的三房 預算兩千萬", "崇德路"], ["北屯 河南路上 三房 2000萬以內", "河南路"],
    ["在文心路 西屯區 三房", "文心路"], ["近文心路 西屯區 三房 兩千萬", "文心路"], ["北屯區崇德路 走路到捷運 三房", "崇德路"],
    ["我想買新大樓文心路 西屯 三房 兩千萬", "文心路"], // 「新」後面還跟著「大樓」：是形容詞，不是路名的第一個字
    ["和平街 北屯區 三房 2000萬以內", "和平街"], // 「和平」剝掉「和」只剩 1 字，不剝
  ]) assert.equal(F(t).road, road, t);
});

test("F2 高鐵站走路、晚上走路回家不是路名；第一個候選不能用就整個不收（同 Python，不去撿後面的真路名）", () => {
  for (const t of ["烏日 三房 一千萬以內 高鐵站走路就到", "綠線捷運站走路五分鐘 北屯 三房 兩千萬內", "西屯區，三房，晚上走路回家也要安全，總價兩千萬以內"]) assert.ok(!("road" in F(t)), t);
  for (const t of ["晚上走路回家 西屯區文心路 三房", "高鐵站走路五分鐘 北屯區崇德路 三房 兩千萬"]) assert.ok(!("road" in F(t)), t);
});

test("F2 保守檢查用的「口語字」一個都不在台中市任何路名裡（所以這項檢查不會丟真路名；反過來字典外的說法 JS 仍會多收，見 extract_r4_road.test.mjs，由 verifyRoad／伺服器端事後丟）", async () => {
  const m = /var ROAD_JUNK = \/\[([^\]]+)\]\/;/.exec(SRC);
  assert.ok(m, "找不到 ROAD_JUNK");
  const junk = [...m[1]];
  assert.equal(new Set(junk).size, junk.length, "沒有重複字");
  assert.ok(junk.length >= 100);
  const { known } = await roads();
  const used = new Set([...known].join(""));
  const hit = junk.filter(c => used.has(c));
  assert.deepEqual(hit, [], `這些字出現在真路名裡，要從 ROAD_JUNK 拿掉：${hit.join("")}`);
});

test("F2 乾淨句子對字典內每一條路（4000+）：不會吐出字典外的路名；收到的比例 ≥95%", async () => {
  const { pairs, known } = await roads();
  let got = 0, wrong = [];
  for (const [d, r] of pairs) {
    const f = F(`${d}${r} 三房 2000萬以內`);
    assert.ok((f.districts || []).includes(d), `${d}${r}`); // 路名開頭剛好是區名（北區太平北街）時會多認一區，Python 同
    if (f.road === r) got++;
    else if (f.road !== undefined && !known.has(f.road)) wrong.push(`${d}${r}→${f.road}`);
  }
  assert.deepEqual(wrong, [], wrong.slice(0, 10).join(" "));
  assert.ok(got / pairs.length >= 0.95, `只收到 ${got}/${pairs.length}`);
});

test("F2 路名前面加各種口語前綴（想住／我家住在／請問住／幫我找／旁／請問一下／我想買）：不會吐出字典外的字串（帶著前綴的路名不是真路名）", async () => {
  const { pairs, known } = await roads();
  const pre = ["想住", "我家住在", "請問住", "幫我找", "旁", "請問一下", "我想買", "預算兩千 想住"];
  let n = 0;
  for (let i = 0; i < pairs.length; i += 7) {
    const [d, r] = pairs[i];
    for (const p of pre) {
      const f = F(`${p}${d}${r} 三房 2000萬以內`), g = F(`${p}${r} ${d} 三房 2000萬以內`);
      for (const x of [f, g]) if (x.road !== undefined) assert.ok(known.has(x.road), `${p}${d}${r}→${x.road}`);
      n++;
    }
  }
  assert.ok(n > 3000);
});

/* ===== F3 非 ASCII 十進位數字 ===== */
test("F3 每一個非 ASCII 的 Unicode 十進位數字（約 700 個，涵蓋所有文字系統）都當成對應的 0-9", () => {
  const nd = /^\p{Nd}$/u;
  let checked = 0;
  for (let cp = 0x80; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (!nd.test(ch)) continue;
    if (/^[0-9]$/.test(ch.normalize("NFKC"))) continue; // 全形、數學粗體等 NFKC 自己會換
    let st = cp;
    while (st > 0 && nd.test(String.fromCodePoint(st - 1))) st--;
    const d = (cp - st) % 10; // 「預算 2 d 0 0 萬」＝ 2000 + d×100
    assert.equal(F(`預算2${ch}00萬 北屯 三房`).price_max_wan, 2000 + d * 100, "U+" + cp.toString(16));
    checked++;
  }
  assert.ok(checked >= 500, `只核對到 ${checked} 個`);
});

test("F3 價格、樓層、屋齡、坪數、區間：阿拉伯-印度、擴充阿拉伯、天城文、孟加拉文、泰文、寮文的寫法與 ASCII 相同（Python 逐句核對過）", () => {
  const zeros = [0x660, 0x6f0, 0x966, 0x9e6, 0xe50, 0xed0];
  for (const z of zeros) {
    const dig = s => String(s).replace(/\d/g, c => String.fromCodePoint(z + +c));
    assert.deepEqual(F(`預算${dig(2000)}萬 北屯 三房`), { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 }, String(z));
    assert.deepEqual(F(`不要${dig(1)}樓 北屯 三房 兩千萬`).floor_exclude, [1], String(z));
    assert.equal(F(`北屯三房 屋齡${dig(20)}年內`).age_max, 20, String(z));
    const a = F(`北屯 ${dig(30)}坪左右`);
    assert.deepEqual([a.area_min_ping, a.area_max_ping], [27, 33], String(z));
    const p = F(`北屯 三房 ${dig(1800)}萬至${dig(2200)}萬`);
    assert.deepEqual([p.price_min_wan, p.price_max_wan], [1800, 2200], String(z));
  }
  assert.equal(R("預算٢٠٠٠萬 北屯 三房").level, "ok");
  assert.equal(F("北屯 ٣0坪左右").area_min_ping, 27, "混著 ASCII 數字");
});

test("F3 個資清洗也認非 ASCII 數字（標籤同 Python：手機的 0／9 是字面 ASCII，非 ASCII 數字落到 longdigits＝id）；ASCII 與全形照舊", () => {
  for (const z of [0x660, 0x6f0, 0x966, 0x9e6, 0xe50]) {
    const phone = "0912345678".replace(/\d/g, c => String.fromCodePoint(z + +c));
    const r = R(`我的手機${phone} 北屯 三房 兩千萬`);
    assert.deepEqual(r.pii, ["id"], String(z));
    assert.deepEqual(r.fields, { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
    assert.ok(!NE.scrub(`我的手機${phone}`).clean.includes(phone.slice(2, 8)), "號碼不留在清洗後的文字裡");
  }
  assert.deepEqual(R("我的手機0912345678 北屯 三房 兩千萬").pii, ["phone"]);
  assert.deepEqual(R("我的手機０９１２３４５６７８ 北屯 三房 兩千萬").pii, ["phone"], "全形由 NFKC 換成 ASCII");
  assert.deepEqual(R("北屯 三房 預算２０００萬").fields, { districts: ["北屯區"], price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
});

/* ===== 夾具 x106（家用機正本 08:56 修訂版）的新期望 ===== */
test("夾具 x106：RT-11 之後「太原路附近」的期望是 fields={}、level=empty（家用機正本已改；官網複本待同步後 extract.test.mjs 的 HOME_REVISED 可刪）", () => {
  const c = readFixture("need_fixtures.json").cases.find(x => x.id === "x106");
  assert.equal(c.text, "太原路附近");
  const r = R(c.text);
  assert.deepEqual([r.fields, r.level, r.missing], [{}, "empty", ["district", "price", "rooms"]]);
});
