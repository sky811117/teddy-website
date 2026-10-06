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
  assert.deepEqual(plain(odd), { d: [], pmax: null, pmin: null, r: null, t: [], a: null, pk: null, fx: [], top: false, c: [], s: ["school"], st: null, tl: null });
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
  assert.ok(Buffer.byteLength(SRC) <= 12 * 1024, `大小 ${Buffer.byteLength(SRC)}`);
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
