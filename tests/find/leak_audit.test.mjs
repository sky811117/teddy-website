// 洩漏稽核腳本的自我測試：用「暫存的假清單」（FAKE_*），驗證它會抓、會放行白名單、不印原字串、沒清單就失敗。
// 真正的禁字清單放在工作站，不進 repo，所以這裡不能出現任何真實的禁字。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./_helpers.mjs";

const SCRIPT = path.join(ROOT, "scripts", "leak-audit.mjs");
const MADE = [];   // 2026-10-06：每次跑測試都會留下一堆 leak-* 暫存夾（一天上千個）；測試結束時自己清掉
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "leak-")); MADE.push(d); return d; };
process.on("exit", () => { for (const d of MADE) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 清不掉就留著 */ } } });
const write = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
function run(cwd, args) {
  const env = { ...process.env };
  delete env.LEAK_DENYLIST;   // 每個案例自己決定要不要給清單
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
// 清單放在另一個暫存夾（不在被稽核的 repo／dist 內，否則清單自己會被掃到）
function denylist() {
  const p = path.join(mk(), "deny.txt");
  fs.writeFileSync(p, ["# 假清單", "T1:FAKE_FORBIDDEN_1", "T1:FAKE_ENDPOINT_[0-9]+", "T2:FAKE_COMPANY_2", "T3:FAKE_INTERNAL_3"].join("\n"));
  return p;
}

test("沒有清單（或清單讀不到、是空的、有壞正規式）→ 退出碼 2，不是通過", () => {
  const d = mk();
  assert.equal(run(d, ["--dist", "dist"]).code, 2);
  assert.equal(run(d, ["--dist", "dist", "--denylist", path.join(d, "不存在.txt")]).code, 2);
  fs.writeFileSync(path.join(d, "empty.txt"), "# 只有註解\n");
  assert.equal(run(d, ["--dist", "dist", "--denylist", path.join(d, "empty.txt")]).code, 2);
  fs.writeFileSync(path.join(d, "bad.txt"), "T1:(未閉合\n");
  assert.equal(run(d, ["--dist", "dist", "--denylist", path.join(d, "bad.txt")]).code, 2);
});

test("--dist：T1 命中就失敗，輸出只有位置與規則編號、不印原字串", () => {
  const d = mk();
  write(d, "dist/find/index.html", "<html><body>\n<p>正常</p>\n<p>這裡有 fake_forbidden_1 字串</p></body></html>");
  const r = run(d, ["--dist", "dist", "--denylist", denylist(d)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /dist\/find\/index\.html:3:T1-1/);
  assert.ok(!/fake_forbidden_1/i.test(r.out), "不得印出命中的字串");
  const ok = mk();
  write(ok, "dist/find/index.html", "<html><body>乾淨</body></html>");
  assert.equal(run(ok, ["--dist", "dist", "--denylist", denylist(ok)]).code, 0);
});

test("--dist：首頁「房市筆記」新聞卡片（data-editorial-feed）內的禁字放行；卡片外、其他頁面一律照樣命中", () => {
  const card = '<article class="u2-note" data-editorial-feed><a href="/posts/x/"><h3>標題</h3><p>內文有 fake_forbidden_1 當資料來源</p></a></article>';
  const ok = mk();
  write(ok, "dist/index.html", "<html><body>\n" + card + "\n<p>乾淨</p></body></html>");
  assert.equal(run(ok, ["--dist", "dist", "--denylist", denylist(ok)]).code, 0, "首頁卡片內放行");
  const outside = mk();
  write(outside, "dist/index.html", "<html><body>\n" + card + "\n<p>卡片外有 fake_forbidden_1</p></body></html>");
  const r1 = run(outside, ["--dist", "dist", "--denylist", denylist(outside)]);
  assert.equal(r1.code, 1, "卡片外仍然命中");
  assert.match(r1.out, /dist\/index\.html:3:T1-1/, "行號不因剝掉卡片而位移");
  const other = mk();
  write(other, "dist/find/index.html", "<html><body>\n" + card + "\n</body></html>");
  assert.equal(run(other, ["--dist", "dist", "--denylist", denylist(other)]).code, 1, "只有首頁生效，/find/ 的同樣標記不放行");
  const noMark = mk();
  write(noMark, "dist/index.html", '<html><body>\n<article class="u2-note"><p>fake_forbidden_1</p></article></body></html>');
  assert.equal(run(noMark, ["--dist", "dist", "--denylist", denylist(noMark)]).code, 1, "沒有標記就照樣命中");
});

test("--dist：T2（公司網域）在 JSON-LD 與公司揭露區塊內放行，其他位置才算命中", () => {
  const d = mk();
  write(d, "dist/find/index.html", `<html><head><script type="application/ld+json">{"url":"FAKE_COMPANY_2"}</script></head><body><footer data-company-disclosure>FAKE_COMPANY_2</footer></body></html>`);
  assert.equal(run(d, ["--dist", "dist", "--denylist", denylist(d)]).code, 0);
  write(d, "dist/find/index.html", `<html><head><script type="application/ld+json">{"url":"FAKE_COMPANY_2"}</script></head>\n<body><p>FAKE_COMPANY_2</p></body></html>`);
  const r = run(d, ["--dist", "dist", "--denylist", denylist(d)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /index\.html:2:T2-1/);
});

test("--dist：T3（內部結構）出現在前端 JS／頁面就失敗；--bundle 允許 T3 但擋 T1", () => {
  const d = mk();
  write(d, "dist/js/find-app.js", "var a='FAKE_INTERNAL_3';");
  write(d, "dist/find/index.html", "<html></html>");
  const r = run(d, ["--dist", "dist", "--denylist", denylist(d)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /dist\/js\/find-app\.js:1:T3-1/);
  const b = mk();
  write(b, "bundle/worker.js", "const x='FAKE_INTERNAL_3';");
  assert.equal(run(b, ["--bundle", "bundle", "--denylist", denylist(b)]).code, 0);
  write(b, "bundle/worker.js", "const x='FAKE_INTERNAL_3'; const y='FAKE_ENDPOINT_42';");
  const r2 = run(b, ["--bundle", "bundle", "--denylist", denylist(b)]);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /worker\.js:1:T1-2/);
});

test("--dist：只掃新頁與新資源（既有頁面的既有字串不在範圍）；含 u2- 的 CSS 才掃", () => {
  const d = mk();
  write(d, "dist/posts/old/index.html", "<p>FAKE_FORBIDDEN_1 既有文章可以引用</p>");
  write(d, "dist/_astro/other.css", ".x{content:'FAKE_FORBIDDEN_1'}");
  write(d, "dist/find/index.html", "<html></html>");
  assert.equal(run(d, ["--dist", "dist", "--denylist", denylist(d)]).code, 0);
  write(d, "dist/_astro/ui.css", ".u2-btn{content:'FAKE_FORBIDDEN_1'}");
  assert.equal(run(d, ["--dist", "dist", "--denylist", denylist(d)]).code, 1);
});

test("--hosts：載入資源的目標必須是同源或白名單主機；<a href> 外連與提示類 link 不算", () => {
  const d = mk();
  write(d, "dist/find/index.html", [
    '<link rel="preconnect" href="https://elsewhere.example">',
    '<a href="https://elsewhere.example/page">外連導覽</a>',
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    '<script src="/js/find-app.js?v=abc"></script>',
    '<img src="/photos/a.webp" srcset="/photos/a.webp 1x, /photos/b.webp 2x">',
    '<div style="background:url(/img/x.png)"></div>',
  ].join("\n"));
  assert.equal(run(d, ["--hosts", "--dist", "dist"]).code, 0);
  write(d, "dist/find/index.html", '<html>\n<script src="https://cdn.elsewhere.example/x.js"></script></html>');
  const r = run(d, ["--hosts", "--dist", "dist"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /index\.html:2:HOST/);
  write(d, "dist/find/index.html", "<html></html>");
  write(d, "dist/js/find-app.js", "fetch('https://elsewhere.example/api');");
  assert.equal(run(d, ["--hosts", "--dist", "dist"]).code, 1);
  write(d, "dist/js/find-app.js", "fetch('/api/find/config');import('//www.googletagmanager.com/x');");
  assert.equal(run(d, ["--hosts", "--dist", "dist"]).code, 0);
});

test("--no-sourcemap：有 .map 檔或 sourceMappingURL 註解就失敗", () => {
  const d = mk();
  write(d, "dist/js/find-app.js", "var a=1;");
  assert.equal(run(d, ["--no-sourcemap", "dist"]).code, 0);
  write(d, "dist/js/find-app.js.map", "{}");
  assert.equal(run(d, ["--no-sourcemap", "dist"]).code, 1);
  fs.unlinkSync(path.join(d, "dist/js/find-app.js.map"));
  write(d, "dist/js/find-app.js", "var a=1;\n//# sourceMappingURL=find-app.js.map");
  assert.equal(run(d, ["--no-sourcemap", "dist"]).code, 1);
});

test("--diff：既有檔只掃新增的行；新檔掃全文；T3 允許在 functions/ 與 src/lib/find/；未追蹤的新檔也算", () => {
  const d = mk();
  const g = (...a) => execFileSync("git", a, { cwd: d, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.invalid");
  g("config", "user.name", "t");
  write(d, "src/old.ts", "// 既有行 FAKE_FORBIDDEN_1（舊的，不算）\nexport const a = 1;\n");
  write(d, "src/page.astro", "<p>正常</p>\n");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  g("checkout", "-q", "-b", "feature");
  // 既有檔：舊行不變，新增一行乾淨的 → 通過
  fs.appendFileSync(path.join(d, "src/old.ts"), "export const b = 2;\n");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 0);
  // 既有檔新增一行 T1 → 失敗，行號是新檔的行號
  fs.appendFileSync(path.join(d, "src/old.ts"), "export const c = 'FAKE_FORBIDDEN_1';\n");
  const r = run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/old\.ts:4:T1-1/);
  // 還原後，新增的（未追蹤）前端檔含 T3 → 失敗；同樣內容放 functions/ 則允許
  g("checkout", "--", "src/old.ts");
  write(d, "public/js/new.js", "var x='FAKE_INTERNAL_3';\n");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 1);
  fs.unlinkSync(path.join(d, "public/js/new.js"));
  write(d, "functions/api/x.ts", "const x = 'FAKE_INTERNAL_3';\n");
  write(d, "src/lib/find/y.ts", "const y = 'FAKE_INTERNAL_3';\n");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 0);
  // T1 就算在 functions/ 也不行
  write(d, "functions/api/x.ts", "const x = 'FAKE_ENDPOINT_7';\n");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 1);
});

test("腳本與其測試本身不含禁字（用真清單掃 scripts/ 與本測試；沒有真清單時略過）", t => {
  const real = process.env.LEAK_DENYLIST;
  if (!real || !fs.existsSync(real)) return t.skip("沒有設定 LEAK_DENYLIST（真清單在工作站，不進 repo）");
  const own = mk();   // 只掃本分支新增的腳本與測試（scripts/ 內既有的檔案不是這次的範圍）
  for (const f of ["scripts/leak-audit.mjs", "scripts/seo-diff.mjs", "scripts/find-stamp.mjs", "tests/find/leak_audit.test.mjs"]) {
    fs.copyFileSync(path.join(ROOT, f), path.join(own, path.basename(f)));
  }
  assert.equal(run(own, ["--bundle", ".", "--denylist", real]).code, 0);
});

/* ===================== 2026-10-06 審查修正：稽核本身的盲點 ===================== */
// 原本只做「逐行、不分大小寫」的字面比對，被編碼、被切開的字都看不到。以下全部用假字（FAKE_FORBIDDEN_1）驗證。
const T = "FAKE_FORBIDDEN_1";
function auditHtml(body, extra = {}) {
  const d = mk();
  write(d, "dist/find/index.html", `<html><body>${body}</body></html>`);
  for (const [f, t] of Object.entries(extra)) write(d, f, t);
  return run(d, ["--dist", "dist", "--denylist", denylist(d)]);
}
const b64 = s => Buffer.from(s).toString("base64");

test("編碼過的禁字也要抓到：HTML 實體、Unicode 跳脫、%XX、全形字、零寬字元、被註解切開", () => {
  const variants = {
    "HTML 實體": "FAKE&#95;FORBIDDEN&#x5f;1",
    "具名實體加數字實體": "&#70;&#65;KE_FORBIDDEN_1",
    "Unicode 跳脫": "\\u0046AKE_FORBIDDEN_1",
    "十六進位跳脫": "\\x46AKE_FORBIDDEN_1",
    "百分比編碼": "%46AKE_FORBIDDEN_1",
    "全形字": "ＦＡＫＥ＿ＦＯＲＢＩＤＤＥＮ＿１",
    "零寬字元": "FAKE_FOR\u200bBIDDEN_1",
    "軟連字號": "FAKE_FOR\u00adBIDDEN_1",
    "被 HTML 註解切開": "FAKE_FOR<!-- x -->BIDDEN_1",
    "被 CSS 註解切開": "FAKE_FOR/* x */BIDDEN_1",
    "字串相加": "var a = 'FAKE_FOR' + 'BIDDEN_1';",
    "陣列 join": "var a = ['FAKE_FOR', 'BIDDEN_1'].join('');",
  };
  for (const [name, body] of Object.entries(variants)) {
    const r = auditHtml(`<p>${body}</p>`);
    assert.equal(r.code, 1, `${name} 沒被抓到`);
    assert.match(r.out, /T1-1~n/, name);
    assert.ok(!/forbidden/i.test(r.out), `${name}：不得印出命中的字串`);
  }
});

test("被斷行、被標籤切開的禁字（壓平比對 ~sq）；base64 字串；乾淨內容不誤報", () => {
  let r = auditHtml("<p>FAKE_FOR\nBIDDEN_1</p>");
  assert.equal(r.code, 1);
  assert.match(r.out, /T1-1~sq/);
  r = auditHtml("<p>FAKE_FOR</p><span>BIDDEN</span> <b>1</b>");
  assert.equal(r.code, 1);
  r = auditHtml(`<script>var s='${b64(T)}';</script>`);
  assert.equal(r.code, 1, "base64 藏字");
  r = auditHtml("<p>這是一段完全正常的文字，有 fake 也有 forbidden，但沒有連在一起的那個詞。</p>");
  assert.equal(r.code, 0, "分開的兩個普通字不能誤報");
  r = auditHtml("<p>for bidden 1 fake 一般的句子</p>");
  assert.equal(r.code, 0);
});

test("--bundle：打包物裡被轉成 Unicode 跳脫的中文禁字也要抓到（esbuild 預設會把非 ASCII 轉義）", () => {
  const d = mk();
  const list = path.join(mk(), "deny.txt");
  fs.writeFileSync(list, "T1:假禁字用語\n");
  write(d, "bundle/worker.js", `const t = "\\u5047\\u7981\\u5b57\\u7528\\u8a9e";\n`);
  const r = run(d, ["--bundle", "bundle", "--denylist", list]);
  assert.equal(r.code, 1);
  assert.match(r.out, /worker\.js:\d+:T1-1~n/);
});

test("--dist 的範圍：全站共用的 _astro/*.js、404、llms.txt、sitemap 也要掃；圖片的中繼資料也看", () => {
  for (const [f, t] of [["dist/_astro/chunk.js", `var x='${T}';`], ["dist/404.html", `<p>${T}</p>`], ["dist/llms.txt", `- /find/ ${T}`], ["dist/sitemap-0.xml", `<urlset><url><loc>https://x.example/find/</loc><note>${T}</note></url></urlset>`], ["dist/_headers", T]]) {
    const r = auditHtml("<p>乾淨</p>", { [f]: t });
    assert.equal(r.code, 1, f);
  }
  // 全站共用的 sitemap／llms.txt 只看跟新頁（/find）有關的部分：既有網址與既有說明本來就會引用名稱
  const pre = auditHtml("<p>乾淨</p>", { "dist/llms.txt": `- /posts/old/ ${T}`, "dist/sitemap-0.xml": `<urlset><url><loc>https://x.example/posts/${T}/</loc></url></urlset>` });
  assert.equal(pre.code, 0, "既有內容不在範圍");
  const d = mk();
  write(d, "dist/find/index.html", "<html></html>");
  fs.mkdirSync(path.join(d, "dist/photos/ui2"), { recursive: true });
  fs.writeFileSync(path.join(d, "dist/photos/ui2/x.webp"), Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]), Buffer.from("XMP " + T + " meta")]));
  const r = run(d, ["--dist", "dist", "--denylist", denylist(d)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /x\.webp:0:T1-1~bin/);
});

test("--hosts：首頁與隱私頁的載入型外連也要查（原本整頁略過）", () => {
  const d = mk();
  write(d, "dist/find/index.html", "<html></html>");
  write(d, "dist/index.html", '<html>\n<script src="https://cdn.elsewhere.example/x.js"></script></html>');
  assert.equal(run(d, ["--hosts", "--dist", "dist"]).code, 1);
  write(d, "dist/index.html", '<html><a href="https://elsewhere.example/">導覽外連不算</a></html>');
  assert.equal(run(d, ["--hosts", "--dist", "dist"]).code, 0);
});

test("--diff：既有檔的舊內容（就算含被編碼的禁字）不算，新增行才算；--base 可用環境變數 LEAK_BASE", () => {
  const d = mk();
  const g = (...a) => execFileSync("git", a, { cwd: d, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.invalid");
  g("config", "user.name", "t");
  write(d, "src/old.ts", "// 舊的：FAKE_FOR\u200bBIDDEN_1 不算\nexport const a = 1;\n");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  g("checkout", "-q", "-b", "feature");
  fs.appendFileSync(path.join(d, "src/old.ts"), "export const b = 2;\n");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 0);
  fs.appendFileSync(path.join(d, "src/old.ts"), "export const c = 'FAKE_FOR' + 'BIDDEN_1';\n");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 1);
  // 合併進 main 之後 main 對 main 是空的：用上一次上線的 commit 當基準才掃得到
  g("add", "-A");
  g("commit", "-q", "-m", "feature");
  g("checkout", "-q", "main");
  g("merge", "-q", "feature");
  assert.equal(run(d, ["--diff", "--base", "main", "--denylist", denylist(d)]).code, 0, "main 對 main 什麼都掃不到（這就是盲點）");
  const prev = g("rev-parse", "HEAD~1").trim();
  const env = { ...process.env, LEAK_BASE: prev };
  const r = spawnSync(process.execPath, [SCRIPT, "--diff", "--denylist", denylist(d)], { cwd: d, encoding: "utf8", env });
  assert.equal(r.status, 1, "用上一次上線的 commit 當基準就掃得到");
});

/* ===================== 2026-10-06 紅隊修補（RT-01／RT-10／RT-19） ===================== */
test("RT-10：repo 裡不再有加鹽雜湊檔與它的產生器；稽核腳本沒有 --hashed 模式", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "scripts", "leak-hashes.json")), "leak-hashes.json 不能留在 repo（鹽與雜湊同檔，字典可還原禁字）");
  assert.ok(!fs.existsSync(path.join(ROOT, "scripts", "leak-hash-gen.mjs")));
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!/modeHashed|leak-hashes\.json/.test(src), "稽核腳本不能再讀雜湊檔");
  const d = mk();
  write(d, "dist/find/index.html", "<html></html>");
  const r = run(d, ["--hashed", "--dist", "dist"]);
  assert.notEqual(r.code, 0, "沒有 --hashed 這個模式了（不能因為認不得參數就通過）");
  // .gitignore 擋住它與它的產生輸出，免得日後有人又 commit 進公開 repo
  const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(gi, /^scripts\/leak-hashes\.json$/m);
});

test("RT-19：掃到 0 個檔案（目錄不存在、路徑寫錯、空建置）不是『乾淨』，退出碼 1；--min-files 可要求更多", () => {
  const d = mk();
  const deny = denylist(d);
  assert.equal(run(d, ["--dist", "沒有這個目錄", "--denylist", deny]).code, 1);
  fs.mkdirSync(path.join(d, "dist"));
  assert.equal(run(d, ["--dist", "dist", "--denylist", deny]).code, 1, "空的 dist");
  assert.equal(run(d, ["--hosts", "--dist", "dist"]).code, 1);
  assert.equal(run(d, ["--bundle", "沒有", "--denylist", deny]).code, 1);
  assert.equal(run(d, ["--no-sourcemap", "沒有"]).code, 1);
  write(d, "dist/find/index.html", "<html>乾淨</html>");
  assert.equal(run(d, ["--dist", "dist", "--denylist", deny]).code, 0);
  assert.equal(run(d, ["--dist", "dist", "--denylist", deny, "--min-files", "5"]).code, 1, "數量不夠");
});

test("RT-19：UTF-16（有 BOM）的檔案先解碼再比對；含 NUL 的文字類檔案不能被靜默略過（UNREADABLE，失敗）", () => {
  const d = mk();
  const deny = denylist(d);
  write(d, "dist/find/index.html", "<html>乾淨</html>");
  // UTF-16LE＋BOM：內容有禁字 → 抓得到
  fs.writeFileSync(path.join(d, "dist", "js-note.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("x FAKE_FORBIDDEN_1 y", "utf16le")]));
  write(d, "dist/llms.txt", "ok");
  fs.copyFileSync(path.join(d, "dist", "js-note.txt"), path.join(d, "dist", "_headers"));
  let r = run(d, ["--dist", "dist", "--denylist", deny]);
  assert.equal(r.code, 1, "UTF-16 的 _headers 裡的禁字要抓到");
  assert.match(r.out, /_headers:1:T1-1/);
  assert.ok(!/fake_forbidden/i.test(r.out));
  // 沒有 BOM 的 UTF-16（每個字元後面有 NUL）：不能略過
  const e = mk();
  write(e, "dist/find/index.html", "<html>乾淨</html>");
  fs.writeFileSync(path.join(e, "dist", "_headers"), Buffer.from("FAKE_FORBIDDEN_1", "utf16le"));
  r = run(e, ["--dist", "dist", "--denylist", denylist(e)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /_headers:0:UNREADABLE/);
  // 二進位（圖片）含 NUL 照常略過文字掃描，不誤報
  const f = mk();
  write(f, "dist/find/index.html", "<html>乾淨</html>");
  fs.writeFileSync(path.join(f, "dist", "photos-x.bin"), Buffer.from([0, 1, 2, 0, 0, 3]));
  assert.equal(run(f, ["--dist", "dist", "--denylist", denylist(f)]).code, 0);
});

test("RT-01：build-safe 的 --no-diff 與雲端流程——deploy.yml／ci.yml 都有洩漏稽核與找房測試，禁字清單只來自 secret、不進 repo", () => {
  const deploy = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  for (const [name, y] of [["deploy", deploy], ["ci", ci]]) {
    assert.match(y, /secrets\.LEAK_DENYLIST/, `${name} 要從 secret 取禁字清單`);
    assert.match(y, /\$RUNNER_TEMP\/leak_denylist\.txt/, `${name} 禁字清單寫到暫存檔（不進 repo、不進 dist）`);
    assert.match(y, /LEAK_DENYLIST=/, `${name} 要把清單路徑交給稽核腳本`);
    assert.match(y, /exit 1/, `${name} 沒設 secret 時要失敗（fail-closed），不是略過`);
  }
  assert.match(deploy, /build-safe\.mjs --skip-build --no-diff/, "deploy 要跑完整稽核（dist／hosts／sourcemap／Functions 打包物／找房測試）");
  assert.match(ci, /node --test/, "ci 要跑找房測試");
  assert.match(ci, /leak-audit\.mjs --diff/, "ci 要掃本分支的新增內容");
  // deploy：稽核與測試一定在「部署到 Cloudflare」之前
  assert.ok(deploy.indexOf("build-safe.mjs") < deploy.indexOf("cloudflare/wrangler-action"), "稽核要在部署之前");
  // 部署之前的稽核不能有 continue-on-error
  const stepBlock = (y, title) => {
    const i = y.indexOf(`- name: ${title}`);
    assert.ok(i >= 0, title);
    const rest = y.slice(i + 5);
    const m = /\n\s*(?:#|- name:)/.exec(rest);
    return y.slice(i, i + 5 + (m ? m.index : rest.length));
  };
  for (const t of ["Prepare leak denylist (from Actions secret)", "Leak audit + find tests (gate)"]) {
    assert.ok(!/continue-on-error/.test(stepBlock(deploy, t)), `${t} 不能 continue-on-error`);
  }
  assert.match(stepBlock(deploy, "Leak audit + find tests (gate)"), /run: node scripts\/build-safe\.mjs --skip-build --no-diff/);
  // package.json build 不再引用 --hashed
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  assert.ok(!/--hashed/.test(pkg));
  // build-safe 認得 --no-diff
  const bs = fs.readFileSync(path.join(ROOT, "scripts", "build-safe.mjs"), "utf8");
  assert.match(bs, /--no-diff/);
});
