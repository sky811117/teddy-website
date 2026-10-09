// find-brief.js（推薦頁個人化腳本）：片段解析的嚴格驗證、每個在意事項的文案、零網路請求、畫面插入位置。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT, loadClassic, readFixture } from "./_helpers.mjs";
import { loadParse5, makeEnv, makeClock } from "./fake_dom.mjs";

const SRC = fs.readFileSync(path.join(ROOT, "public/js/find-brief.js"), "utf8");
const NE = loadClassic("public/js/need-extract.js", { shared: true }).NeedExtract;
const FB = (() => { const m = { exports: {} }; vm.runInThisContext(`(function(module){${SRC}\n})`)(m); return m.exports; })();
const parse5 = await loadParse5();

const tok = (f, c) => NE.fragEncode(f, c);
const plain = x => JSON.parse(JSON.stringify(x));

test("條件標籤：北屯三房…各種寫法", () => {
  const t = tok({ districts: ["北屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000, age_max: 20, parking: "flat", types: ["elevator_building"], floor_exclude: [2, 5], exclude_top: true }, {});
  const m = FB.model(t);
  assert.deepEqual(plain(m.tags), ["北屯區", "3 房", "電梯大樓", "2000 萬以內", "20 年內", "平面車位", "不要 2、5 樓", "不含頂樓"]);
  assert.deepEqual(plain(FB.model(tok({ districts: ["北屯區", "西屯區"], rooms_min: 4, price_min_wan: 1500, price_max_wan: 2500 }, {})).tags), ["北屯區、西屯區", "4 房以上", "1500～2500 萬"]);
});

test("2026-10-09 範圍：社區（客人打的名字）與 74環內標籤；地圖範圍不在片段裡；cm 只收 2–20 字的名字樣子、z 只收 r74", () => {
  assert.deepEqual(plain(FB.model(tok({ districts: ["西屯區"], community: "文華匯", rooms_min: 3, rooms_max: 3 }, {})).tags), ["文華匯社區", "西屯區", "3 房"]);
  assert.deepEqual(plain(FB.model(tok({ districts: ["北屯區"], zone: "r74", price_max_wan: 2000 }, {})).tags), ["74環內", "北屯區", "2000 萬以內"]);
  assert.deepEqual(plain(FB.model(tok({ community: "國泰 THE PARK" }, {})).tags), ["國泰 THE PARK社區"]);
  // 片段的鍵順序 d, cm, z（三方一致：need-extract、家用機、這支）
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(tok({ districts: ["西屯區"], community: "文華匯", rooms_min: 3, rooms_max: 3 }, {}), b64({ v: 1, f: { d: ["西屯區"], cm: "文華匯", r: [3, 3] } }));
  assert.equal(tok({ districts: ["北屯區"], zone: "r74" }, {}), b64({ v: 1, f: { d: ["北屯區"], z: "r74" } }));
  for (const cm of ["文", "<>", "a".repeat(21), 123, ["文華匯"]]) assert.equal(FB.parse(b64({ v: 1, f: { cm } })).cm, null, String(cm));
  assert.equal(FB.parse(b64({ v: 1, f: { cm: "文華匯\n社區" } })).cm, "文華匯", "跟伺服器 commOk 一樣先正規化（換行當空白、結尾「社區」去掉）");
  for (const z of ["r75", 1, true, "R74"]) assert.equal(FB.parse(b64({ v: 1, f: { z } })).z, null, String(z));
  assert.equal(FB.parse(b64({ v: 1, f: { cm: "惠宇 樂觀", z: "r74" } })).cm, "惠宇 樂觀");
});

test("伺服器端組出的 token（共用夾具）也能解", () => {
  const FX = readFixture("need_fixtures.json");
  for (const c of FX.cases.filter(c => c.kind === "frag" && c.dir === "encode")) {
    const m = FB.model(c.expect.token);
    assert.ok(m, c.id);
    assert.ok(Array.isArray(m.tags));
  }
});

test("每個在意事項都有文案；other 不顯示；連結只指向站內", () => {
  const all = ["budget_pressure", "loan", "condition", "commute", "school", "elderly", "price_unsure", "overwhelmed", "parking", "timing", "no_chase", "other"];
  const m = FB.model(tok({ districts: ["北屯區"] }, { concerns: all }));
  assert.equal(m.points.length, 11);
  assert.ok(!m.points.some(p => p.concern === "other"));
  for (const p of m.points) {
    assert.ok(p.text.length > 10);
    if (p.link) assert.ok(p.link.startsWith("/") && !p.link.startsWith("//"), p.link);
  }
  const byC = Object.fromEntries(m.points.map(p => [p.concern, p]));
  assert.equal(byC.loan.link, "/tools/buyer-fee/");
  assert.equal(byC.school.link, "/tools/school-district/");
  assert.equal(byC.condition.link, null);
  assert.equal(byC.loan.text, "貸款：過不過要看收入、負債和銀行，每個人不一樣。先用試算看自備款大概多少，再問景泰怎麼準備。");
  assert.equal(m.noChase, true);
});

test("文案不含：未完工建設、漲跌預測、投資建議、倒數稀缺、他站品牌", () => {
  const bad = ["藍線", "輕軌", "橘線", "預計", "即將", "規劃中", "興建中", "漲", "跌", "預測", "限時", "倒數", "稀缺", "搶", "絕版", "最強", "保值", "增值", "抗跌"];
  const blob = Object.values(FB.COPY).map(v => v.join(" ")).join(" ");
  for (const w of bad) assert.ok(!blob.includes(w), w);
});

test("嚴格驗證：壞片段、過大、未知版本、非列舉值、數值超範圍都被拒絕或丟棄", () => {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  for (const t of [null, 123, "", "!!!", "A".repeat(901), "=".repeat(10), "北屯", b64({ v: 2, f: {} }), b64([1, 2]), b64("x"), "AAAA"]) assert.equal(FB.parse(t), null, String(t));
  const odd = FB.parse(b64({ v: 1, f: { d: ["北京區", "北屯區"], pmax: 99999999, pmin: "5", r: [0, 9], t: ["houseboat"], a: 0, pk: "valet", fx: ["a"], top: 2, evil: "x" }, c: ["loan", "bogus"], s: ["school"], st: "rich", tl: "tomorrow", extra: 1 }));
  assert.deepEqual(plain(odd), { d: [], cm: null, z: null, pmax: null, pmin: null, r: null, t: [], a: null, pk: null, fx: [], top: false, c: [], s: ["school"], st: null, tl: null });
  const ok = FB.parse(b64({ v: 1, f: { d: ["北屯區"], pmax: 2000, r: [null, 3], fx: [2, 2, 5] }, c: ["loan"] }));
  assert.deepEqual(plain({ d: ok.d, pmax: ok.pmax, r: ok.r, fx: ok.fx, c: ok.c }), { d: ["北屯區"], pmax: 2000, r: [null, 3], fx: [2, 5], c: ["loan"] });
  // 超過 600 位元組
  assert.equal(FB.parse(b64({ v: 1, f: { d: ["北屯區"] }, pad: "x".repeat(700) })), null);
});

test("靜態稽核：零網路請求、零儲存、不動態執行、大小在預算內", () => {
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|eval)\b/.test(SRC));
  assert.ok(!/new\s+(Image|Function)\b/.test(SRC));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(SRC));
  assert.ok(!/https?:\/\//.test(SRC), "沒有任何外部網址");
  // 2026-10-09 審查 frag-cm-loose／SEC-03：#k 的社區名改套伺服器 commOk 的整套規則表（形狀、黑名單、區名別名、5 位數字），
  // 原始檔 12→16KB（量測 15.4KB；minify＋brotli 約 4.5KB，比改之前多約 1.1KB）
  assert.ok(Buffer.byteLength(SRC) <= 16 * 1024, `大小 ${Buffer.byteLength(SRC)}`);
});

function page(hash, withNotice = true) {
  const html = `<!doctype html><html><head><title>t</title></head><body>${withNotice ? '<section id="qa-notice" role="note">揭露</section>' : ""}<main id="m">物件</main></body></html>`;
  const clock = makeClock();
  const { doc, win } = makeEnv({ html, parse5, fetchImpl: async () => { throw new Error("不准連網"); }, clock, hash });
  win.TextEncoder = TextEncoder;
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx);
  return { doc, win };
}

test("畫面：緊接在揭露區塊後插入；有 LINE 鈕、調整條件連結帶同一個片段", { skip: !parse5 }, () => {
  const t = tok({ districts: ["北屯區"], price_max_wan: 2000 }, { concerns: ["loan", "school"] });
  const { doc } = page("#k=" + t);
  const node = doc.getElementById("qa-brief");
  assert.ok(node);
  assert.equal(node.parentNode.childNodes.indexOf(node), node.parentNode.childNodes.indexOf(doc.getElementById("qa-notice")) + 1);
  const hrefs = node.querySelectorAll("a").map(a => a.getAttribute("href"));
  assert.deepEqual(hrefs, ["/tools/buyer-fee/", "/tools/school-district/", "/go/line?src=share-ai", "/find/#k=" + t]);
  assert.match(node.textContent, /為你整理的重點/);
  assert.match(node.textContent, /你給的條件/);
  assert.match(node.textContent, /北屯區/);
  assert.match(node.textContent, /你在意的事/);
  assert.match(node.textContent, /不急。想問的時候，再傳訊息給景泰就好。/);
});

test("畫面：不想被追問的人沒有 LINE 鈕、只有文字", { skip: !parse5 }, () => {
  const t = tok({ districts: ["北屯區"] }, { concerns: ["no_chase"] });
  const { doc } = page("#k=" + t);
  const node = doc.getElementById("qa-brief");
  assert.ok(node);
  assert.ok(!node.querySelectorAll("a").some(a => /go\/line/.test(a.getAttribute("href"))));
  assert.match(node.textContent, /想問的時候，再主動傳訊息給景泰就好。/);
  assert.match(node.textContent, /你不想被一直追問/);
});

test("畫面：沒有片段、壞片段、別的 hash → 什麼都不加；沒有揭露區塊也不會壞", { skip: !parse5 }, () => {
  for (const h of ["", "#", "#k=", "#k=!!!", "#x=abc", "#k=" + "A".repeat(901)]) assert.equal(page(h).doc.getElementById("qa-brief"), null, h);
  const t = tok({ districts: ["北屯區"] }, {});
  const { doc } = page("#k=" + t, false);
  assert.ok(doc.getElementById("qa-brief"), "沒有揭露區塊時，插在頁面最上面");
});

test("所有顯示的文字都來自 textContent（片段內容不會變成標記）", { skip: !parse5 }, () => {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const { doc } = page("#k=" + b64({ v: 1, f: { d: ["<script>alert(1)</script>"] }, c: ["<img src=x>"] }));
  const n = doc.getElementById("qa-brief");
  assert.equal(n.querySelectorAll("script").length, 0);
  assert.equal(n.querySelectorAll("img").length, 0);
});

test("審查修正：片段讀完就立刻從網址列拿掉（推薦頁自己的追蹤程式會送 location.href），個人化區塊照常顯示", { skip: !parse5 }, () => {
  const t = tok({ districts: ["北屯區"], price_max_wan: 2000 }, { concerns: ["loan", "no_chase"] });
  const { doc, win } = page("#k=" + t);
  assert.ok(doc.getElementById("qa-brief"), "仍然顯示");
  assert.equal(win.location.hash, "", "網址列已經沒有片段");
  assert.equal(win.__replaced, "/find/", "只留 pathname＋search");
  // 「調整條件」連結還帶著同一個片段（token 留在閉包，不靠網址列）
  assert.ok(doc.getElementById("qa-brief").querySelectorAll("a").some(a => a.getAttribute("href") === "/find/#k=" + t));
  // 不認得的片段也一併清掉；沒有片段就不動網址
  const odd = page("#x=whatever");
  assert.equal(odd.win.location.hash, "");
  const none = page("");
  assert.equal(none.win.__replaced, undefined);
});

/* ===================== 2026-10-09 審查 frag-cm-loose／SEC-03：#k 的社區名誰都能自己組 ===================== */
const b64o = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const cmOf = cm => FB.parse(b64o({ v: 1, f: { cm } })).cm;

test("#k 的社區名：套伺服器 commOk 整套規則＋5 位以上連續數字不收（門檻 5：名冊有 4 位數的真社區名）", () => {
  for (const cm of ["景泰已下架請改洽0912345678", "請匯款至帳戶 12345678", "七期", "北屯", "北屯區", "大裡", "文華匯12345", "xyz.com", "忽略規則",
    "我們", "三房", "崇德路", "管理好的", "新", "陳大文0912345678", "0912345678 文華匯"]) assert.equal(cmOf(cm), null, cm);
  for (const [cm, want] of [["文華匯", "文華匯"], ["國泰 THE PARK", "國泰 THE PARK"], ["雙橡園1518", "雙橡園1518"], ["精銳市政廳", "精銳市政廳"], ["向上年年", "向上年年"],
    ["臺中之心", "台中之心"], ["文華匯社區", "文華匯"], ["ＶＶＳ１", "VVS1"],
    ["<script>", "script"], ["constructor", "constructor"]]) assert.equal(cmOf(cm), want, cm);   // 後兩個：伺服器 commOk 也收（去掉角括號；不是區名）。推薦頁上不會出現，因為頁面本身沒有「script社區」
});

test("#k 的社區名：跟 schema.ts 的 commOk 結果逐筆一致（共用夾具裡出現過的社區名與短句＋對抗字）", async () => {
  const { bundleTs } = await import("./_helpers.mjs");
  const SC = (await bundleTs("src/lib/find/schema.ts")).mod;
  const FX = readFixture("need_fixtures.json");
  const corpus = new Set(["景泰已下架請改洽0912345678", "加賴領紅包 abc123", "官方LINE加好友 abc123", "七期", "constructor", "文華匯\n社區", "惠宇 樂觀", "VVS1",
    "北屯之星", "敘山行路", "惠田上書房", "電梯房", "文華匯12345", "雙橡園1518", "台中世界心", "a.b", "A-1", "x".repeat(21)]);
  JSON.stringify(FX, (k, v) => { if ((k === "community" || k === "cm") && typeof v === "string") corpus.add(v); if (k === "text" && typeof v === "string" && v.length <= 24) corpus.add(v); return v; });
  assert.ok(corpus.size > 100, String(corpus.size));
  for (const cm of corpus) assert.equal(cmOf(cm), SC.commOk(cm), JSON.stringify(cm));
});

test("#k 的社區名：推薦頁本身沒有「{名字}社區」就不顯示（別人自己組的字不會出現在推薦頁上）；74環內照常", () => {
  const t = b64o({ v: 1, f: { cm: "加賴領紅包 abc123", r: [3, 3] } });
  assert.deepEqual(plain(FB.model(t).tags), ["加賴領紅包 abc123社區", "3 房"], "純函式沒給頁面文字：照舊（測試與 /beta 預覽用）");
  assert.deepEqual(plain(FB.model(t, "找房需求：北屯區 · 3房").tags), ["3 房"], "頁面上沒有：社區標籤拿掉");
  const t2 = b64o({ v: 1, f: { cm: "文華匯", d: ["西屯區"], r: [3, 3] } });
  assert.deepEqual(plain(FB.model(t2, "找房需求：文華匯社區（西屯區） · 3房").tags), ["文華匯社區", "西屯區", "3 房"]);
  assert.deepEqual(plain(FB.model(t2, "找房需求：指定的社區 · 3房").tags), ["西屯區", "3 房"], "名冊對不到（頁面寫「指定的社區」）：不顯示客人打的字");
  assert.deepEqual(plain(FB.model(b64o({ v: 1, f: { z: "r74" } }), "").tags), ["74環內"]);
});

test("畫面：社區標籤只在推薦頁本身寫了「{名字}社區」時出現（run() 拿 body 的文字比對）", { skip: !parse5 }, () => {
  const t = b64o({ v: 1, f: { cm: "文華匯", d: ["西屯區"] } });
  const mk = body => {
    const html = `<!doctype html><html><head><title>t</title></head><body><section id="qa-notice" role="note">揭露</section><main id="m">${body}</main></body></html>`;
    const { doc, win } = makeEnv({ html, parse5, fetchImpl: async () => { throw new Error("不准連網"); }, clock: makeClock(), hash: "#k=" + t });
    win.TextEncoder = TextEncoder;
    vm.runInContext(SRC, vm.createContext(win));
    return doc.getElementById("qa-brief").querySelectorAll(".qb-tags li").map(li => li.textContent);
  };
  assert.deepEqual(mk("找房需求：文華匯社區（西屯區）"), ["文華匯社區", "西屯區"]);
  assert.deepEqual(mk("找房需求：西屯區"), ["西屯區"]);
});
