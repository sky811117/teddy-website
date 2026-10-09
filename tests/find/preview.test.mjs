// 本機預覽伺服器（scripts/find-preview.mjs）：只綁 127.0.0.1，整條流程走一遍（假上游、假驗證）。
// 需要先建置（dist/find/index.html）。連線對象只有 127.0.0.1。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./_helpers.mjs";

const DIST = process.env.FIND_DIST ? path.resolve(process.env.FIND_DIST) : path.join(ROOT, "dist");
const HAVE_DIST = fs.existsSync(path.join(DIST, "find", "index.html"));

function start(mode, port) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, "scripts/find-preview.mjs"), "--port", String(port), "--dist", DIST, "--mode", mode], { cwd: ROOT });
    let out = "";
    const t = setTimeout(() => { p.kill(); reject(new Error("預覽伺服器 20 秒內沒起來：" + out.slice(0, 200))); }, 20000);
    p.stdout.on("data", d => {
      out += d;
      if (out.includes("推薦頁（過期）")) { clearTimeout(t); resolve({ p, out }); }
    });
    p.stderr.on("data", d => { out += d; });
    p.on("exit", c => { if (c) { clearTimeout(t); reject(new Error("預覽伺服器結束 " + c + "：" + out.slice(0, 200))); } });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const body = (over = {}) => ({
  v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDe", fields: { districts: ["北屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000 },
  context: { stage: "first", concerns: [] }, free_text: "北屯三房，兩千萬內", skip: false, contact: null, consent: null, refine_of: null,
  from: "line", fill_ms: 41000, turnstile: "preview-token", hp: "", ...over,
});

test("預覽：只綁 127.0.0.1；頁面、設定、送出、輪詢、推薦頁（有效／過期）整條走通", { skip: !HAVE_DIST, timeout: 60000 }, async () => {
  const port = 43500 + Math.floor(Math.random() * 400);
  const { p, out } = await start("fast", port);
  try {
    const base = `http://127.0.0.1:${port}`;
    const links = [...out.matchAll(/http:\/\/127\.0\.0\.1:\d+\/share\/(qa[0-9a-z]{4}[a-z2-7]{26})\//g)].map(m => m[1]);
    assert.equal(links.length, 2, "應列出有效與過期兩個推薦頁");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(out), "終端機輸出不應出現其他網址");

    // 靜態頁：/find/ 注入了假驗證（沒有外部腳本）
    const page = await (await fetch(base + "/find/")).text();
    assert.ok(page.includes("window.turnstile={render"), "預覽應注入假驗證");
    assert.ok(!/<script[^>]+src="https?:\/\/(?!127)/.test(page), "不載入外部腳本");
    assert.equal((await fetch(base + "/")).status, 200);
    assert.equal((await fetch(base + "/js/find-app.js")).status, 200);

    // 設定
    const H = { origin: base, "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const cfg = await (await fetch(base + "/api/find/config", { headers: { "sec-fetch-site": "same-origin" } })).json();
    assert.equal(cfg.mode, "live");
    assert.ok(cfg.turnstileSiteKey);

    // 送出（假上游）→ 工作編號
    const sub = await (await fetch(base + "/api/find/submit", { method: "POST", headers: H, body: JSON.stringify(body()) })).json();
    assert.equal(sub.ok, true);
    assert.match(sub.jobId, /^a[A-Za-z0-9_-]{22}$/);

    // 輪詢到完成（fast 約 6 秒）；推薦頁網址被改寫成本機
    let done = null;
    for (let i = 0; i < 20 && !done; i++) {
      const j = await (await fetch(`${base}/api/find/status?id=${sub.jobId}`, { headers: { "sec-fetch-site": "same-origin" } })).json();
      assert.equal(j.ok, true);
      if (j.status === "done") done = j; else await sleep(500);
    }
    assert.ok(done, "6 秒內應該做完");
    assert.ok(done.shareUrl.startsWith(base + "/share/qa"), done.shareUrl);

    // 推薦頁：有效 → 揭露＋個人化腳本＋noindex；過期 → 410
    const okPage = await fetch(done.shareUrl);
    assert.equal(okPage.status, 200);
    const html = await okPage.text();
    assert.ok(html.includes('id="qa-notice"'));
    assert.ok(html.includes("/js/find-brief.js?v="));
    assert.ok(/noindex/i.test(okPage.headers.get("x-robots-tag") || ""));
    const exp = await fetch(`${base}/share/${links[1]}/`);
    assert.equal(exp.status, 410);
    assert.ok(/noindex/i.test(exp.headers.get("x-robots-tag") || "") || /noindex/i.test(await exp.text()));

    // 其他來源（不是本機）的請求會被擋；事件端點永遠回 {ok:true}
    const bad = await (await fetch(base + "/api/find/submit", { method: "POST", headers: { ...H, origin: "https://elsewhere.example" }, body: JSON.stringify(body()) })).json();
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "E_ORIGIN");
    const ev = await (await fetch(base + "/api/find/event", { method: "POST", headers: H, body: JSON.stringify({ v: 1, sid: "Qw3kT9xLm2PzR8aVb5NcDe", jid: null, rid: null, events: [{ e: "view", t: 0, src: "line", dev: "d" }] }) })).json();
    assert.deepEqual(ev, { ok: true });

    // 路徑穿越
    const trav = await fetch(base + "/..%2f..%2fpackage.json");
    assert.notEqual(trav.status, 200);
  } finally {
    p.kill();
  }
});

test("預覽：down 模式（後端連不上）送出會降級收件，不會 5xx", { skip: !HAVE_DIST, timeout: 60000 }, async () => {
  const port = 43900 + Math.floor(Math.random() * 90);
  const { p } = await start("down", port);
  try {
    const base = `http://127.0.0.1:${port}`;
    const H = { origin: base, "content-type": "application/json" };
    const cfg = await (await fetch(base + "/api/find/config", { headers: { "sec-fetch-site": "same-origin" } })).json();
    assert.equal(cfg.mode, "intake");
    const r = await fetch(base + "/api/find/submit", { method: "POST", headers: H, body: JSON.stringify(body()) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, "degraded");
  } finally {
    p.kill();
  }
});

/* ---------- 2026-10-09 範圍找法：假家用機的 caps、範圍 0 筆的提示碼、本機假地圖圖片 ---------- */
test("預覽：health 帶 caps（預設三種、--caps none 時空的）；comm_unknown 模式回社區名冊找不到的提示碼；/__tiles/ 回本機假圖；find-map.js 的圖片網址換成本機", { skip: !HAVE_DIST, timeout: 90000 }, async () => {
  const os = await import("node:os");
  // 假 dist：只放 /find/ 頁與一支假的 find-map.js（裡面一個長得像正式圖片網址的字串）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "find-preview-dist-"));
  fs.mkdirSync(path.join(tmp, "find"));
  fs.mkdirSync(path.join(tmp, "js"));
  fs.copyFileSync(path.join(DIST, "find", "index.html"), path.join(tmp, "find", "index.html"));
  const fakeHost = ["tiles", "example", "invalid"].join(".");
  fs.writeFileSync(path.join(tmp, "js", "find-map.js"), `var TILE_URL = 'https://${fakeHost}/wmts/X/default/G/{z}/{y}/{x}';`);
  const port = 44000 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, [path.join(ROOT, "scripts/find-preview.mjs"), "--port", String(port), "--dist", tmp, "--mode", "comm_unknown"], { cwd: ROOT });
  try {
    let out = "";
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("沒起來：" + out.slice(0, 200))), 20000);
      proc.stdout.on("data", d => { out += d; if (out.includes("推薦頁（過期）")) { clearTimeout(t); res(); } });
      proc.stderr.on("data", d => { out += d; });
    });
    assert.match(out, /範圍找法：community、zone、geo/);
    const base = `http://127.0.0.1:${port}`;
    const G = { headers: { "sec-fetch-site": "same-origin" } };
    const cfg = await (await fetch(base + "/api/find/config", G)).json();
    assert.deepEqual(cfg.caps, ["community", "zone", "geo"]);
    const H = { origin: base, "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const sub = await (await fetch(base + "/api/find/submit", { method: "POST", headers: H, body: JSON.stringify(body({ fields: { community: "文化匯" }, free_text: "文化匯社區" })) })).json();
    assert.equal(sub.ok, true);
    let st = null;
    for (let i = 0; i < 20 && !st; i++) {
      const j = await (await fetch(`${base}/api/find/status?id=${sub.jobId}`, G)).json();
      if (j.status === "empty") st = j; else await sleep(400);
    }
    assert.ok(st, "應該在幾秒內回 empty");
    assert.deepEqual(st.hint, ["comm_fix", "scope_drop"]);
    assert.ok(!out.includes("文化匯"), "終端機不印社區名");
    const tile = await fetch(base + "/__tiles/15/14000/27000");
    assert.equal(tile.status, 200);
    assert.equal(tile.headers.get("content-type"), "image/png");
    const png = Buffer.from(await tile.arrayBuffer());
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const js = await (await fetch(base + "/js/find-map.js")).text();
    assert.equal(js, `var TILE_URL = '${base}/__tiles/{z}/{y}/{x}';`, "圖片網址換成本機的假圖");
    assert.equal((await fetch(base + "/__tiles/../x")).status, 404);
  } finally {
    proc.kill();
  }
  const port2 = 44400 + Math.floor(Math.random() * 300);
  const proc2 = spawn(process.execPath, [path.join(ROOT, "scripts/find-preview.mjs"), "--port", String(port2 + 1), "--dist", tmp, "--caps", "none"], { cwd: ROOT });
  try {
    await new Promise((res, rej) => {
      let o = "";
      const t = setTimeout(() => rej(new Error("沒起來")), 20000);
      proc2.stdout.on("data", d => { o += d; if (o.includes("推薦頁（過期）")) { clearTimeout(t); res(); } });
    });
    const cfg = await (await fetch(`http://127.0.0.1:${port2 + 1}/api/find/config`, { headers: { "sec-fetch-site": "same-origin" } })).json();
    assert.deepEqual(cfg.caps, [], "--caps none：入口不出現");
  } finally {
    proc2.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
