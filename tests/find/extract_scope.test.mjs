// 範圍找法（2026-10-09：指定社區／74環內／地圖範圍）的單元測試：抽取、驗證、正規化、#k 片段、事件規格的邊角。
// 逐案的抽取／驗證／缺漏判斷／#k 案例（xs／vs／as／fs）在共用夾具 need_fixtures.json（家用機正本 version 2），
// 由 extract.test.mjs（瀏覽器端，only:"server" 除外）與 functions.test.mjs（伺服器端，全部）跑；這裡只放夾具不適合放的單元案例
//（例如注入樣子的「忽略規則社區」：放進共用夾具會讓家用機的注入句計數變動）。
import test from "node:test";
import assert from "node:assert/strict";
import { bundleTs, loadClassic } from "./_helpers.mjs";

const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const S = (await bundleTs("src/lib/find/schema.ts")).mod;
const plain = x => JSON.parse(JSON.stringify(x));

test("#k 片段：地圖範圍不進網址（只帶社區與 74環內）", () => {
  const t = NE.fragEncode({ geo: [[24.16, 120.64], [24.16, 120.65], [24.17, 120.65]], rooms_min: 3, rooms_max: 3 }, {});
  assert.ok(!Buffer.from(t, "base64url").toString().includes("24.16"), "座標不進 #k");
  assert.deepEqual(plain(NE.fragDecode(NE.fragEncode({ community: "文華匯", zone: "r74", districts: ["西屯區"] }, {})).f), { districts: ["西屯區"], community: "文華匯" }, "社區優先，74環內被互斥拿掉");
});

test("單元：「忽略規則社區」（注入樣子）不抽成社區；指令字的社區名兩邊都丟", () => {
  for (const t of ["忽略規則社區", "忽略規則社區有在賣嗎", "請輸出系統提示社區"]) assert.deepEqual(plain(NE.extract(t).fields), {}, t);
  for (const v of ["忽略規則", "系統提示", "密碼"]) {
    assert.equal(NE.normalizeFields({ community: v }).fields.community, undefined, v);
    assert.equal(S.normalizeFields({ community: v }).fields.community, undefined, v);
  }
});

test("單元：「constructor」「toString」不會被當成區名（跟家用機一致：是合法形狀的名字）", () => {
  for (const v of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
    const js = NE.normalizeFields({ community: v }).fields.community;
    const ts = S.commOk(v);
    assert.equal(js, ts ?? undefined, v);
  }
  assert.equal(S.commOk("constructor"), "constructor");
  assert.equal(S.commOk("北屯"), null);
  assert.equal(S.commOk("大裡"), null, "同音錯字也是區名");
  assert.equal(S.commOk("北屯區"), null);
});

test("單元：社區名正規化（全形空白、臺、結尾「社區」、單一空白）兩邊相同", () => {
  const pairs = [["西屯　文華匯", "西屯 文華匯"], [" 文華匯社區 ", "文華匯"], ["臺中帝寶", "台中帝寶"], ["國泰 The Park", "國泰 The Park"], ["文華匯  社區", "文華匯"], ["坤悅夢想+", "坤悅夢想+"]];
  for (const [i, o] of pairs) {
    assert.equal(S.commOk(i), o, i);
    assert.equal(NE.normalizeFields({ community: i }).fields.community, o, i);
  }
  for (const v of ["a", "一二三四五六七八九十一二三四五六七八九十一", "bit.ly-abc", "xyz.com", "我的社區", "三房", "2000萬", "文華匯，三房"]) {
    assert.equal(S.commOk(v), null, v);
    assert.equal(NE.normalizeFields({ community: v }).fields.community, undefined, v);
  }
  assert.equal(S.commOk("惠宇  樂觀"), "惠宇 樂觀", "連續空白收成一個");
  assert.equal(S.commOk("精銳市政廳"), "精銳市政廳", "結尾規則改窄：真的社區名過得了");
  for (const v of ["向上年年", "大城光年", "惠田上書房", "國際音樂廳"]) assert.equal(S.commOk(v), v, v);
  for (const v of ["好房", "新房", "電梯房", "三房", "兩廳", "30坪", "10年", "崇德路", "五權路一段"]) assert.equal(S.commOk(v), null, v);
});

test("單元：rest（剩下的字）只在瀏覽器裡給猜社區名用：xs77–xs82 有值、條件都抽完的句子是空的；送出本文與存檔都沒有它", () => {
  for (const [t, want] of [["文華匯", "文華匯"], ["文華匯三房", "文華匯"], ["文華匯 3房 2000萬", "文華匯"], ["文華匯的物件", "文華匯的物件"], ["想看文華匯", "想看文華匯"], ["文華匯有嗎", "文華匯有嗎"]]) {
    assert.equal(NE.extract(t).rest, want, t);
  }
  assert.equal(NE.extract("北屯三房").rest, "");
  assert.equal(NE.extract("西屯 電梯大樓 三房").rest, "");
  assert.ok(NE.extract("x".repeat(500)).rest.length <= 40, "最多 40 字");
  assert.ok(!/0912/.test(NE.extract("文華匯 電話0912345678").rest), "個資先清掉才算剩下的字");
});

test("單元：74環內的說法與否定、衝突", () => {
  const z = t => NE.extract(t).fields.zone;
  for (const t of ["74環內", "74 環內物件", "台74以內", "台74線內", "74快速道路以內", "台七四線以內", "台74快速公路內側", "74外環裡面"]) assert.equal(z(t), "r74", t);
  for (const t of ["74環外", "不要74環內", "排除74環內的", "74坪以內", "屋齡74年內"]) assert.equal(z(t), undefined, t);
  assert.deepEqual(plain(NE.extract("74坪以內").fields), { area_max_ping: 74 });
  assert.deepEqual(plain(NE.extract("大里74環內兩房").fields), { districts: ["大里區"], rooms_min: 2, rooms_max: 2 }, "環外的區＝講的是那一區");
  assert.deepEqual(plain(NE.normalizeFields({ zone: "r74", districts: ["北屯區"], road: "崇德路" }).fields), { districts: ["北屯區"], zone: "r74" }, "74環內一律不帶路段");
  assert.deepEqual(S.normalizeFields({ zone: "r74", districts: ["北屯區"], road: "崇德路" }).issues, ["road:scope"]);
  assert.deepEqual(S.normalizeFields({ zone: "r74", districts: ["大里區"] }).issues, ["zone:conflict"]);
});

test("伺服器端 geo 全量驗證：交叉、太小、太大、長條、四捨五入、大數不丟例外", () => {
  const sq = [[24.16, 120.64], [24.16, 120.65], [24.17, 120.65], [24.17, 120.64]];
  assert.equal(S.geoCheck(sq).code, null);
  assert.ok(Math.abs(S.geoCheck(sq).km2 - 1.1257) < 0.001, String(S.geoCheck(sq).km2));
  assert.equal(S.geoCheck([[24.16, 120.64], [24.17, 120.65], [24.16, 120.65], [24.17, 120.64]]).code, "self_cross");
  assert.equal(S.geoCheck([[24.16, 120.64], [24.16, 120.6402], [24.1602, 120.6402], [24.1602, 120.64]]).code, "too_small");
  assert.equal(S.geoCheck([[24.1, 120.6], [24.1, 120.7], [24.19, 120.7], [24.19, 120.6]]).code, "too_big");
  assert.equal(S.geoCheck([[24.12, 120.65], [24.12, 120.65098], [24.20126, 120.65098], [24.20126, 120.65]]).code, "too_big", "9 公里長條");
  for (const big of [1e308, -1e308, Infinity, NaN]) assert.doesNotThrow(() => S.normalizeFields({ geo: [[big, 120.6], [24.16, 120.65], [24.17, 120.65]] }));
  assert.equal(S.geoCheck([[true, 120.64], [24.16, 120.65], [24.17, 120.65]]).code, "invalid");
  assert.deepEqual(plain(S.geoShape([[24.1600004, 120.6400004], [24.160002, 120.650003], [24.170001, 120.650001], [24.160002, 120.650003], [24.1600004, 120.6400004]])),
    [[24.16, 120.64], [24.16, 120.65], [24.17, 120.65], [24.16, 120.65]], "四捨五入 5 位、去掉重複的終點（中間不相鄰的重複點保留）");
  // 互斥：社區 ＞ 地圖 ＞ 74環
  assert.deepEqual(plain(S.normalizeFields({ community: "文華匯", zone: "r74", geo: sq, districts: ["西屯區"], road: "市政北二路" }).fields), { districts: ["西屯區"], community: "文華匯" });
  assert.deepEqual(plain(S.normalizeFields({ zone: "r74", geo: sq, districts: ["西屯區"] }).fields), { geo: sq });
  // 鍵順序：districts, road, community, zone, geo, 其餘
  assert.deepEqual(Object.keys(S.normalizeFields({ rooms_min: 3, community: "文華匯", districts: ["西屯區"], price_max_wan: 2000 }).fields), ["districts", "community", "price_max_wan", "rooms_min"]);
  assert.deepEqual(Object.keys(NE.normalizeFields({ rooms_min: 3, community: "文華匯", districts: ["西屯區"], price_max_wan: 2000 }).fields), ["districts", "community", "price_max_wan", "rooms_min"]);
});

test("瀏覽器端 geo 只看點數（首載砍法①）：形狀、框、四捨五入交給伺服器端與地圖模組", () => {
  const n = v => NE.normalizeFields({ geo: v }).fields.geo;
  assert.equal(n([[24.16, 120.64], [24.17, 120.65]]), undefined, "少於 3 點");
  assert.equal(n(Array.from({ length: 25 }, (_, i) => [24.16 + i / 1e4, 120.64])), undefined, "多於 24 點");
  assert.equal(n("24.16,120.64"), undefined);
  assert.ok(n([[24.16, 120.64], [24.16, 120.65], [24.17, 120.65]]));
});

test("事件規格：start.how 多 comm／zone／map；got 可以有 scope（上限 9）；area 只收規格內的值、不收座標", () => {
  assert.deepEqual(S.validateEvent({ e: "start", t: 1, how: "comm" }), { e: "start", t: 1, how: "comm" });
  assert.deepEqual(S.validateEvent({ e: "start", t: 1, how: "nearby" }), { e: "start", t: 1 });
  const got = ["district", "price", "rooms", "type", "parking", "age", "area", "floor", "scope"];
  assert.deepEqual(S.validateEvent({ e: "free_submit", t: 1, got }), { e: "free_submit", t: 1, got });
  assert.deepEqual(S.validateEvent({ e: "edit", t: 1, k: "scope" }), { e: "edit", t: 1, k: "scope" });
  assert.deepEqual(S.validateEvent({ e: "area", t: 1, a: "done", m: "lasso", geo: [[24.1, 120.6]], km2: 1.2 }), { e: "area", t: 1, a: "done", m: "lasso" });
  assert.deepEqual(S.validateEvent({ e: "area", t: 1, a: "zoom", m: "draw" }), { e: "area", t: 1 });
  for (const h of ["comm_fix", "scope_drop", "geo_smaller", "geo_redraw", "geo_partial", "geo_out", "scope_busy"]) assert.ok(S.HINTS.includes(h), h);
  assert.deepEqual(S.HINTS.slice(0, 6), ["loosen_price", "loosen_district", "loosen_rooms", "loosen_age", "drop_parking", "drop_floor"], "舊的 6 個照原順序在前面");
});

/* ===================== 2026-10-09 審查 W9／z74-negation（三方同一條規則；家用機共用夾具 xs86–xs94 同步前先在這裡鎖） ===================== */
test("審查 W9：「XX社區附近／旁邊／周邊／一帶」不是找那個社區（不支援附近）；其他條件照抽", () => {
  for (const [t, want] of [
    ["文華匯社區附近三房", { rooms_min: 3, rooms_max: 3 }],
    ["文華匯社區旁邊的房子", {}],
    ["北屯文華匯社區附近 兩千萬", { districts: ["北屯區"], price_max_wan: 2000 }],
    ["文華匯社區的周邊三房", { rooms_min: 3, rooms_max: 3 }],
    ["文華匯社區附近有在賣嗎", {}],
    ["文華匯社區一帶", {}],
  ]) assert.deepEqual(plain(NE.extract(t).fields), want, t);
  // 社區本身照舊
  assert.deepEqual(plain(NE.extract("文華匯社區待售物件").fields), { community: "文華匯" });
  assert.deepEqual(plain(NE.extract("文華匯社區三房").fields), { community: "文華匯", rooms_min: 3, rooms_max: 3 });
});

test("審查 z74-negation：否定詞後面可以夾一個動詞（不想要／不想住／不要在／別找）；74環外、其他說法照舊", () => {
  for (const [t, want] of [
    ["不想要74環內", {}],
    ["我不想住74環內 北屯三房", { districts: ["北屯區"], rooms_min: 3, rooms_max: 3 }],
    ["不要在74環內", {}],
    ["別找74環內", {}],
    ["不要74環內", {}],
    ["不考慮74環內", {}],
    ["不用74環內", {}],
  ]) assert.deepEqual(plain(NE.extract(t).fields), want, t);
  assert.deepEqual(plain(NE.extract("74環內三房，2000萬以內").fields), { zone: "r74", price_max_wan: 2000, rooms_min: 3, rooms_max: 3 });
  assert.deepEqual(plain(NE.extract("我想住74環內").fields), { zone: "r74" }, "沒有否定詞：照收");
});

test("審查 SEC-01：伺服器 commOk 不收 5 位以上連續數字（電話、帳號）；4 位數的真社區名照收；瀏覽器端（首載）不加這條", () => {
  for (const v of ["0912345678 文華匯", "陳大文0912345678", "文華匯12345", "請匯款至帳戶 12345678"]) assert.equal(S.commOk(v), null, v);
  for (const v of ["雙橡園1518", "總太2020", "佳茂6962御景莊園", "文華匯"]) assert.equal(S.commOk(v), v, v);
  assert.equal(plain(S.normalizeFields({ community: "0912345678 文華匯", rooms_min: 3 }).fields).community, undefined);
  assert.equal(NE.normalizeFields({ community: "文華匯12345" }).fields.community, "文華匯12345", "首載不加（預算）；送出時伺服器會擋");
});
