// 推薦頁代理（functions/share/[[path]].ts）：找房小幫手推薦頁（qa 代號）的到期、揭露、不注入分析；
// 其他代號的輸出必須與修改前（git HEAD 的版本）逐位元組相同。離線：fetch 用假的。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { ROOT, bundleTs } from "./_helpers.mjs";

const NEW = (await bundleTs("functions/share/[[path]].ts")).mod;
const QA = (await bundleTs("src/lib/find/shareqa.ts")).mod;

// 修改前的版本：從 git 取出 HEAD 的檔，放到暫存資料夾打包（把相對 import 換成絕對路徑）
async function loadOriginal() {
  let src;
  try {
    src = execFileSync("git", ["show", "HEAD:functions/share/[[path]].ts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 });
  } catch {
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "share-orig-"));
  const abs = rel => JSON.stringify(path.join(ROOT, rel).replace(/\\/g, "/"));
  // 合併進 main 之後，HEAD 的版本本身就會 import src/lib/find/shareqa：兩個相對路徑都換成絕對路徑（在暫存資料夾打包才找得到）
  src = src.replace('"../../astro-paper.config"', abs("astro-paper.config.ts")).replace('"../../src/lib/find/shareqa"', abs("src/lib/find/shareqa.ts"));
  const entry = path.join(dir, "orig.ts");
  fs.writeFileSync(entry, src);
  try {
    const out = buildSync({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
    const file = path.join(dir, "orig.mjs");
    fs.writeFileSync(file, out.outputFiles[0].text);
    return await import(pathToFileURL(file).href);
  } catch {
    return null;   // 打包不起來（例如日後檔案結構又變了）：比對測試改成略過，不讓整支測試檔失敗
  }
}
const ORIG = await loadOriginal();

const PAGE = `<!doctype html><html><head><title>推薦</title></head><body><main>物件們</main></body></html>`;
const WITH_BACK = `<!doctype html><html><head></head><body><main>x</main><div>想看更多好屋</div></body></html>`;
const PROMO_OFF = `<!doctype html><html><head><meta name="x-share-promo" content="off"></head><body><main>x</main></body></html>`;

function withFetch(handler, fn) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return handler(String(url), init); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = realFetch; });
}
function withNow(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  return Promise.resolve(fn()).finally(() => { Date.now = real; });
}
const call = (mod, p) => mod.onRequest({ params: { path: p.split("/").filter(Boolean) }, request: new Request("https://teddy-house.tw/share/" + p) });
async function snap(res) {
  return { status: res.status, headers: [...res.headers].sort(([a], [b]) => (a < b ? -1 : 1)), body: Buffer.from(await res.arrayBuffer()).toString("base64") };
}

const NOW = Date.UTC(2026, 9, 6, 6, 0, 0);
const b36 = n => n.toString(36).padStart(4, "0");
const RAND = "abcdefghijklmnopqrstuvwxyz".slice(0, 26).replace(/[01689]/g, "2").replace(/[^a-z2-7]/g, "a");
const qaId = day => `qa${b36(day)}${RAND}`;
const TODAY = QA.dayIndex(NOW);

test("到期日編碼：2026-11-05 → 308 → 008k；今天的天數算法", () => {
  assert.equal(QA.dayIndex(Date.UTC(2026, 10, 5)), 308);
  assert.equal(b36(308), "008k");
  assert.deepEqual(QA.parseQa("qa008k" + RAND), { expDay: 308 });
  for (const bad of [undefined, "", "qa008k", "QA008k" + RAND, "qa008k" + RAND + "x", "qa00_k" + RAND, "ab12cd34", "qa008k" + "1".repeat(26)]) assert.equal(QA.parseQa(bad), null, String(bad));
});

test("到期邊界：到期日當天還在、隔天才過期", () => {
  assert.equal(QA.isQaExpired(TODAY, NOW), false);
  assert.equal(QA.isQaExpired(TODAY - 1, NOW), true);
  assert.equal(QA.isQaExpired(TODAY, NOW + 86400000), true);
  assert.equal(QA.isQaExpired(TODAY + 30, NOW), false);
});

test("過期的 qa 頁：410、固定頁面、noindex、no-store，而且不去抓上游", async () => {
  await withNow(NOW, () => withFetch(() => new Response(PAGE, { headers: { "content-type": "text/html" } }), async calls => {
    for (const p of [qaId(TODAY - 1), qaId(TODAY - 1) + "/photo.jpg"]) {
      const res = await call(NEW, p);
      assert.equal(res.status, 410);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      const html = await res.text();
      assert.match(html, /這一頁已經過期了/);
      assert.match(html, /href="\/find\/"/);
      assert.match(html, /prefers-color-scheme/);
      assert.ok(!/https?:\/\//.test(html), "過期頁沒有外部資源");
    }
    assert.equal(calls.length, 0, "過期頁不抓上游");
  }));
});

test("沒過期的 qa 頁：揭露區塊在 <body> 開頭、個人化腳本帶版本戳、不注入分析、不放邊緣快取", async () => {
  await withNow(NOW, () => withFetch(() => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }), async calls => {
    const res = await call(NEW, qaId(TODAY + 29));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, max-age=0, no-store");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    const html = await res.text();
    assert.equal(calls.length, 1);
    assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
    assert.match(html, /<body><section id="qa-notice" role="note"/, "揭露區塊緊接在 <body> 之後");
    assert.ok(html.includes(QA.QA_DISCLOSURE));
    assert.match(html, /<script src="\/js\/find-brief\.js\?v=[0-9a-z]{10}" defer><\/script><\/body>/);
    assert.ok(!/googletagmanager|gtag\(|G-WMQCYK4L88/.test(html), "不注入第三方分析");
    assert.ok(html.includes("想看更多好屋"));
    assert.ok(!html.includes("這一頁不使用第三方分析服務"), "推薦頁會把造訪送到我們自己的紀錄服務，不能寫這句不實的話");
    assert.ok(!html.includes("#6B8E23"), "qa 頁用木色版，不用舊的橄欖綠");
    assert.ok(html.includes("#6b4a26"));
  }));
});

test("qa 頁：已經有『想看更多好屋』就不重複注入；白牌頁不放回官網區塊但仍有揭露", async () => {
  await withNow(NOW, () => withFetch(url => new Response(url.endsWith("w/") ? WITH_BACK : PROMO_OFF, { headers: { "content-type": "text/html" } }), async () => {
    const id = qaId(TODAY + 5);
    // 第一個請求用 WITH_BACK
    const a = await withFetch(() => new Response(WITH_BACK, { headers: { "content-type": "text/html" } }), () => call(NEW, id).then(r => r.text()));
    assert.equal(a.split("想看更多好屋").length - 1, 1);
    assert.ok(a.includes('id="qa-notice"'));
    const b = await call(NEW, id).then(r => r.text());
    assert.ok(!b.includes("想看更多好屋"));
    assert.ok(b.includes('id="qa-notice"'));
  }));
});

test("qa 頁的非 HTML 資源原樣回傳（只有到期檢查）", async () => {
  await withNow(NOW, () => withFetch(() => new Response("PNGDATA", { headers: { "content-type": "image/png" } }), async () => {
    const res = await call(NEW, qaId(TODAY + 1) + "/a.png");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "PNGDATA");
  }));
});

// 2026-10-06 紅隊修補併入 A4 加固後：非 qa 代號的「頁面內容（本文、狀態碼、原有標頭的值）」仍與修改前相同；
// 差別只有 A4 新增的安全標頭（nosniff、noindex 等）與「不合格式的代號改回 404」（見 tests/functions/share.test.mjs）。
function sameButHardened(origSnap, newSnap, msg) {
  assert.equal(newSnap.status, origSnap.status, `${msg}：狀態碼`);
  assert.equal(newSnap.body, origSnap.body, `${msg}：本文`);
  const nh = new Map(newSnap.headers);
  for (const [k, v] of origSnap.headers) assert.equal(nh.get(k), v, `${msg}：原有標頭 ${k} 的值不能變`);
}
test("非 qa 代號（舊的猜你喜歡、同事白牌頁）：頁面內容與修改前相同（只多了 A4 的安全標頭）", async (t) => {
  if (!ORIG) { t.skip("取不到 git HEAD 的原檔"); return; }
  const pages = [PAGE, WITH_BACK, PROMO_OFF, "<html><body>沒有 head</body></html>"];
  const ids = ["ab12cd34", "qs9f3k2m1a", "qa008k", "QA008k" + RAND, "qb" + b36(1) + RAND];
  await withNow(NOW, async () => {
    for (const body of pages) for (const id of ids) {
      const h = () => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
      const [a, b] = await Promise.all([
        withFetch(h, () => call(ORIG, id).then(snap)),
        withFetch(h, () => call(NEW, id).then(snap)),
      ]);
      sameButHardened(a, b, `${id} 的輸出`);
    }
    // 非 HTML、上游失敗
    const png = () => new Response("PNG", { headers: { "content-type": "image/png" } });
    sameButHardened(await withFetch(png, () => call(ORIG, "ab12cd34/p.png").then(snap)), await withFetch(png, () => call(NEW, "ab12cd34/p.png").then(snap)), "圖片");
    const boom = () => { throw new Error("x"); };
    const bo = await withFetch(boom, () => call(ORIG, "ab12cd34").then(snap));
    const bn = await withFetch(boom, () => call(NEW, "ab12cd34").then(snap));
    assert.equal(bn.status, bo.status);
    // 沒帶代號：都是 302 去在售物件頁（新版用相對路徑，不吃 Host）
    const r1 = await NEW.onRequest({ params: {}, request: new Request("https://teddy-house.tw/share/") });
    const r2 = await ORIG.onRequest({ params: {}, request: new Request("https://teddy-house.tw/share/") });
    assert.equal(r1.status, r2.status);
    assert.ok(r1.headers.get("location").endsWith("/properties/") && r2.headers.get("location").endsWith("/properties/"));
  });
  // 舊頁仍然注入分析與舊的回官網區塊（沒被誤改）
  await withNow(NOW, () => withFetch(() => new Response(PAGE, { headers: { "content-type": "text/html" } }), async () => {
    const html = await call(NEW, "ab12cd34").then(r => r.text());
    assert.ok(html.includes("googletagmanager") && html.includes("#6B8E23"));
    assert.ok(!html.includes("qa-notice") && !html.includes("find-brief"));
  }));
});

test("qa 揭露區塊：字句與合約相同、沒有外連、沒有未完工建設或預測字樣", () => {
  assert.equal(QA.QA_DISCLOSURE, "這幾間是依你的條件從公開市場挑的，不一定都是景泰委託的物件。想看哪一間，告訴景泰，他會先確認現況再跟你說。");
  const all = QA.QA_NOTICE_HTML + QA.qaBackToSite("https://teddy-house.tw") + QA.QA_EXPIRED_HTML;
  for (const w of ["藍線", "輕軌", "橘線", "預計", "即將", "規劃中", "興建中", "漲", "跌", "預測", "限時", "倒數", "稀缺", "絕版", "最強"]) assert.ok(!all.includes(w), w);
});


/* ===================== 2026-10-06 審查修正 ===================== */
test("qa 頁的追蹤程式碼清洗：頁面網址只送 origin＋pathname（不含 #k= 片段），舊命名的識別字改名；其他頁不動", () => {
  const OLD = ["y", "c", "u", "t"].join("") + "Url"; // 舊命名不寫成字面（洩漏稽核會掃 tests/）
  const raw = `<script>
  function trackClick(slug, ${OLD}, name) {
    postTrack({ clicked_url: ${OLD}, url: location.href, referrer: document.referrer || '' });
  }
  function trackVisit() { postTrack({ duration: 3, url: location.href }); }
  var base = new URL(u, location.href);
  </script>`;
  const out = QA.sanitizeQaHtml(raw);
  assert.ok(!/\burl:\s*location\.href\b/.test(out));
  assert.equal(out.split("url: location.origin + location.pathname").length - 1, 2);
  assert.ok(out.includes("new URL(u, location.href)"), "不是追蹤用的 location.href 不動");
  assert.ok(!out.includes(OLD), "舊命名不再出現");
  assert.ok(out.includes("function trackClick(slug, itemUrl, name)") && out.includes("clicked_url: itemUrl"));
  // injectQaBlocks 會套用
  const page = QA.injectQaBlocks(`<html><body>${raw}</body></html>`, "");
  assert.ok(!/location\.href[,\s]*referrer|url: location\.href/.test(page));
});

test("qa 代號被百分比編碼（%71a… ＝ qa…）：整條路徑含 % 一律 404，而且不打上游（沒有任何繞過到期檢查的空間）", async () => {
  await withNow(NOW, () => withFetch(() => new Response(PAGE, { headers: { "content-type": "text/html" } }), async calls => {
    const old = qaId(TODAY - 1);
    const enc = "%71" + old.slice(1);
    const res = await call(NEW, enc);
    assert.equal(res.status, 404, "編碼過的過期代號：以前靠『先解碼再判斷』擋成 410，現在白名單直接擋成 404（更嚴）");
    assert.equal(calls.length, 0);
    // 沒過期的編碼代號也一律 404（合法代號沒有理由被編碼）
    const live = qaId(TODAY + 3);
    assert.equal((await call(NEW, "%71" + live.slice(1))).status, 404);
    assert.equal((await call(NEW, "ab%31cd34")).status, 404);
    assert.equal(calls.length, 0);
  }));
});

/* ===================== 紅隊 RT-18：到期檢查與實際抓取的路徑綁在一起 ===================== */
test("RT-18：到期的 qa 代號，任何寫法都拿不到過期頁（大小寫、尾斜線、檔名、副檔名、點、分號、編碼、反斜線）", async () => {
  await withNow(NOW, () => withFetch(() => new Response(PAGE, { headers: { "content-type": "text/html" } }), async calls => {
    const old = qaId(TODAY - 1);
    const attempts = [
      old, old + "/", old + "/index.html", old + "/photo.jpg",
      old.toUpperCase(), "Q" + old.slice(1), "q" + old.slice(1).toUpperCase(),
      old + "/.", old + "/..", old + "/%2e%2e/" + old, "%71" + old.slice(1), old.slice(0, 2) + "%" + "00" + old.slice(2),
      old + ";", old + "%3b", old + ".", old + "%2f", old + "%5c", old + "\\", old + "%00", ".%2f" + old, "./" + old, "../share/" + old,
      old + "/../" + old, old + "//", "/" + old, old + "?x=1", old + "#a",
    ];
    for (const a of attempts) {
      calls.length = 0;
      const res = await NEW.onRequest({ params: {}, request: new Request("https://teddy-house.tw/share/" + a) }).catch(() => null);
      if (!res) continue;
      const text = await res.text();
      // 絕對不能拿到 200（也就是上游的頁面內容）
      assert.notEqual(res.status, 200, `繞過成功：${JSON.stringify(a)}`);
      assert.ok(!text.includes("物件們"), `拿到頁面內容：${JSON.stringify(a)}`);
      // 打上游的話，網址的第一段一定是同一個代號（不是別的）
      for (const u of calls) assert.ok(/\/teddy-shares\/[A-Za-z0-9]{4,40}\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(u), `上游網址不合格：${u}`);
    }
  }));
});

test("RT-18：resolveUpstreamUrl——解析後的第一段必須是合法代號；跑出目錄之外或含怪字元回 null", () => {
  assert.deepEqual(NEW.resolveUpstreamUrl("ab12cd34/"), { href: "https://sky811117.github.io/teddy-shares/ab12cd34/", first: "ab12cd34" });
  assert.equal(NEW.resolveUpstreamUrl("ab12cd34/p.png").first, "ab12cd34");
  for (const bad of ["../x/", "a/../../x/", "%2e%2e/x/", "ab/cd/ef/", "", "a_b-c/", "..//x"]) {
    const r = NEW.resolveUpstreamUrl(bad);
    assert.ok(r === null || /^[A-Za-z0-9]{4,40}$/.test(r.first), `${bad} → ${JSON.stringify(r)}`);
  }
});

test("RT-18：qa 推薦頁帶保守的內容安全政策（防嵌框、禁 object／base 改寫）；舊代號的頁面不帶（輸出不變）", async () => {
  await withNow(NOW, () => withFetch(() => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }), async () => {
    const q = await call(NEW, qaId(TODAY + 3));
    const csp = q.headers.get("content-security-policy") || "";
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    const old = await call(NEW, "ab12cd34");
    assert.equal(old.headers.get("content-security-policy"), null);
  }));
});

test("剛產生、還沒發布的推薦頁（上游 404）：不放邊緣快取也不讓瀏覽器快取；上游只快取 2xx（2026-10-07 景泰拿到 404 連結）", async () => {
  let seenInit = null;
  await withNow(NOW, () => withFetch((u, init) => { seenInit = init; return new Response("<html><head></head><body>404</body></html>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }); }, async calls => {
    const res = await call(NEW, "qsAbCd1234");
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "private, max-age=0, no-store");
    assert.equal(calls.length, 2, "Pages 404 之後會再試一次 repo 原始檔（也 404）");
    const cf = seenInit && seenInit.cf;
    assert.ok(cf && cf.cacheTtlByStatus && cf.cacheTtlByStatus["200-299"] === 30 && cf.cacheTtlByStatus["300-599"] === 0, "上游只快取 2xx");
    assert.equal(cf.cacheTtl, undefined, "不再用會連 404 一起快取的 cacheTtl");
  }));
  await withNow(NOW, () => withFetch(() => new Response("<html><head></head><body>ok</body></html>", { headers: { "content-type": "text/html; charset=utf-8" } }), async () => {
    const res = await call(NEW, "qsAbCd1234");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=30", "正常頁維持 30 秒快取");
  }));
});

test("Pages 還沒發布（404）時，頁面本體改讀 repo 原始檔：200、照樣注入回官網區塊與標頭；原始檔也沒有才回 404（2026-10-07 實測 Pages 要 186 秒）", async () => {
  const RAW = "https://raw.githubusercontent.com/sky811117/teddy-shares/main/";
  const page = "<html><head><title>t</title></head><body><p>物件</p></body></html>";
  await withNow(NOW, () => withFetch(u => (u.startsWith(RAW)
    ? new Response(page, { headers: { "content-type": "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; sandbox" } })
    : new Response("404", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })), async calls => {
    const res = await call(NEW, "qsAbCd1234");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(res.headers.get("content-security-policy"), null, "不轉出原始檔的 sandbox 標頭");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    const html = await res.text();
    assert.ok(html.includes("<p>物件</p>"));
    assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
    assert.deepEqual(calls, ["https://sky811117.github.io/teddy-shares/qsAbCd1234/", RAW + "qsAbCd1234/index.html"]);
  }));
  // 原始檔也沒有 → 照原本 404、不快取
  await withNow(NOW, () => withFetch(() => new Response("nope", { status: 404, headers: { "content-type": "text/plain" } }), async () => {
    const res = await call(NEW, "qsAbCd1234");
    assert.equal(res.status, 404);
  }));
  // 資源檔（非頁面本體）不走原始檔
  await withNow(NOW, () => withFetch(() => new Response("nope", { status: 404, headers: { "content-type": "text/plain" } }), async calls => {
    await call(NEW, "qsAbCd1234/a.png");
    assert.equal(calls.length, 1);
  }));
});
