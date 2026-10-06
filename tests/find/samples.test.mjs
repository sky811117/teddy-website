// 端點回應樣本：把同源端點在各種情況下的「完整回應（狀態＋標頭＋本文）」寫成檔案，交給洩漏稽核掃。
// 全部離線、用假資料；上游是假的，會故意回傳帶毒標記的內容，確認毒標記一個字都出不去。
//   產出位置：環境變數 FIND_SAMPLES_DIR（沒設就只在記憶體裡驗，不寫檔）
//   接著執行：node scripts/leak-audit.mjs --samples <FIND_SAMPLES_DIR> --denylist <工作站清單>
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bundleTs } from "./_helpers.mjs";

const H = (await bundleTs("src/lib/find/handlers.ts")).mod;
const SH = (await bundleTs("src/lib/find/shareqa.ts")).mod;

const POISON = "ZZPOISON_S9";
const UP = "https://home.invalid:8443";
const ENV = {
  FIND_ENABLED: "1", FIND_UPSTREAM_URL: UP, FIND_HMAC_SECRET: "test-secret-do-not-use", FIND_IP_SALT: "test-salt",
  TURNSTILE_SECRET_KEY: "ts-secret", TURNSTILE_SITE_KEY: "0xTESTSITEKEY", CONTACT_TG_TOKEN: "tg-token", CONTACT_TG_CHAT: "99",
};
const JOB = "aX3kT9xLm2PzR8aVb5NcDe1";
const ORIGIN = { origin: "https://teddy-house.tw" };
const OUT = process.env.FIND_SAMPLES_DIR || "";

function net(routes = {}) {
  const base = {
    turnstile: () => Response.json({ success: true, hostname: "teddy-house.tw", action: "find" }),
    tg: () => Response.json({ ok: true }),
    submit: () => Response.json({ ok: true, v: 1, status: "queued", jobId: JOB, queue: { ahead: 1, eta_s: 150 }, saved: true }),
    status: () => Response.json({ ok: true, v: 1, status: "searching" }),
    contact: () => Response.json({ ok: true, saved: true }),
    event: () => Response.json({ ok: true, n: 1 }),
    feedback: () => Response.json({ ok: true }),
    health: () => Response.json({ ok: true, v: 1, mode: "live", queue: { len: 0, eta_s: 0 } }),
    ...routes,
  };
  const fetch = async url => {
    const u = String(url);
    if (u.startsWith("https://challenges.cloudflare.com/")) return base.turnstile();
    if (u.startsWith("https://api.telegram.org/")) return base.tg();
    for (const k of ["submit", "status", "contact", "event", "feedback", "health"]) if (u.startsWith(UP + "/aif/v1/" + k)) return base[k]();
    throw new Error("測試不准連到其他網址：" + u);
  };
  return { fetch, now: () => 1790000000000 };
}
const post = (p, body, env = ENV) => ({
  request: new Request("https://teddy-house.tw" + p, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...ORIGIN }, body: JSON.stringify(body) }),
  env, waitUntil() {},
});
const getc = (p, env = ENV) => ({ request: new Request("https://teddy-house.tw" + p, { method: "GET", headers: { "sec-fetch-site": "same-origin" } }), env });
const good = (over = {}) => ({
  v: 1, idem: "Qw3kT9xLm2PzR8aVb5NcDe", fields: { districts: ["北屯區"], rooms_min: 3, rooms_max: 3, price_max_wan: 2000, parking: "flat" },
  context: { stage: "first", concerns: ["loan"] }, free_text: "北屯三房，兩千萬內", skip: false, contact: null, consent: null, refine_of: null,
  from: "line", fill_ms: 41000, turnstile: "tok", hp: "", ...over,
});

const samples = [];
async function rec(name, resP) {
  const res = await resP;
  const body = await res.text();
  const head = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
  const text = `HTTP ${res.status}\n${head}\n\n${body}\n`;
  samples.push({ name, status: res.status, body, text });
  return { res, body };
}

test("端點回應樣本：各情況都是 200 + 白名單 JSON，毒標記一個字都出不去", async () => {
  const bad = {
    "up-5xx": { submit: () => new Response(POISON, { status: 502, headers: { "x-poison": POISON } }), status: () => new Response(POISON, { status: 500 }) },
    "up-html": { submit: () => new Response(`<html>${POISON}</html>`, { headers: { "content-type": "text/html", server: POISON } }), status: () => new Response(`<html>${POISON}</html>`) },
    "up-weird": { submit: () => Response.json({ ok: true, status: "weird", msg: POISON, finder: POISON }), status: () => Response.json({ ok: true, status: "weird", msg: POISON }) },
    "up-throw": { submit: () => { throw new TypeError(POISON); }, status: () => { throw new TypeError(POISON); } },
    "up-extra-keys": { submit: () => Response.json({ ok: true, v: 1, status: "queued", jobId: JOB, queue: { ahead: 1, eta_s: 150 }, saved: true, finder: POISON, debug: POISON }), status: () => Response.json({ ok: true, status: "searching", msg: POISON, finder: POISON }) },
  };
  const cases = [
    ["config-ok", () => H.handleConfig(getc("/api/find/config"), { fetch: net().fetch, now: () => 1790000000000 })],
    ["submit-ok", () => H.handleSubmit(post("/api/find/submit", good()), net())],
    ["submit-need-more", () => H.handleSubmit(post("/api/find/submit", good()), net({ submit: () => Response.json({ ok: true, v: 1, status: "need_more", missing: ["price", POISON], ask: ["q_budget", "q_evil"] }) }))],
    ["submit-bad-body", () => H.handleSubmit(post("/api/find/submit", { v: 1, junk: POISON }), net())],
    ["submit-honeypot", () => H.handleSubmit(post("/api/find/submit", good({ hp: "x" })), net())],
    ["submit-bad-origin", () => H.handleSubmit({ ...post("/api/find/submit", good()), request: new Request("https://teddy-house.tw/api/find/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://elsewhere.example" }, body: JSON.stringify(good()) }) }, net())],
    ["submit-turnstile-fail", () => H.handleSubmit(post("/api/find/submit", good()), net({ turnstile: () => Response.json({ success: false, "error-codes": [POISON] }) }))],
    ["submit-intake-off", () => H.handleSubmit(post("/api/find/submit", good(), { ...ENV, FIND_ENABLED: "0" }), net())],
    ["status-ok", () => H.handleStatus(getc(`/api/find/status?id=${JOB}`), net())],
    ["status-bad-job", () => H.handleStatus(getc("/api/find/status?id=zzz"), net())],
    ["status-done", () => H.handleStatus(getc(`/api/find/status?id=${JOB}`), net({ status: () => Response.json({ ok: true, v: 1, status: "done", shareUrl: "https://teddy-house.tw/share/qa008kmn3x7q2pzrtavb5ncdetwoxy4k/", count: 3, summary: POISON }) }))],
    ["status-bad-share-url", () => H.handleStatus(getc(`/api/find/status?id=${JOB}`), net({ status: () => Response.json({ ok: true, v: 1, status: "done", shareUrl: "https://elsewhere.example/" + POISON, count: 3 }) }))],
    ["contact-ok", () => H.handleContact(post("/api/find/contact", { v: 1, jid: JOB, contact: { line: "test_line_id", pref: "line" }, consent: { contact: true, v: "2026-10-06" }, hp: "", turnstile: "tok" }), net())],
    ["contact-no-jid-to-tg", () => H.handleContact(post("/api/find/contact", { v: 1, jid: null, contact: { line: "test_line_id", pref: "line" }, consent: { contact: true, v: "2026-10-06" }, hp: "", turnstile: "tok" }), net())],
    ["contact-tg-down", () => H.handleContact(post("/api/find/contact", { v: 1, jid: null, contact: { line: "test_line_id" }, consent: { contact: true, v: "2026-10-06" }, hp: "", turnstile: "tok" }), net({ tg: () => new Response(POISON, { status: 500 }) }))],
    ["contact-no-consent", () => H.handleContact(post("/api/find/contact", { v: 1, jid: JOB, contact: { line: "test_line_id" }, hp: "", turnstile: "tok" }), net())],
    ["contact-no-token", () => H.handleContact(post("/api/find/contact", { v: 1, jid: JOB, contact: { line: "test_line_id" }, consent: { contact: true, v: "2026-10-06" }, hp: "" }), net())],
    ["contact-not-found", () => H.handleContact(post("/api/find/contact", { v: 1, jid: JOB, contact: { line: "test_line_id" }, consent: { contact: true, v: "2026-10-06" }, hp: "", turnstile: "tok" }), net({ contact: () => new Response(POISON, { status: 404 }) }))],
    ["submit-rate", () => H.handleSubmit(post("/api/find/submit", good()), net({ submit: () => Response.json({ ok: false, v: 1, code: "rate", msg: POISON }) }))],
    ["submit-no-turnstile-key", () => H.handleSubmit(post("/api/find/submit", good(), { ...ENV, TURNSTILE_SECRET_KEY: undefined }), net())],
    ["status-rate", () => H.handleStatus(getc(`/api/find/status?id=${JOB}`), net({ status: () => Response.json({ ok: false, v: 1, code: "rate", msg: POISON }) }))],
    ["event-ok", () => H.handleEvent(post("/api/find/event", { v: 1, sid: "Qw3kT9xLm2PzR8aVb5NcDe", jid: null, rid: null, events: [{ e: "view", t: 0, src: "line", dev: "m" }] }), net())],
    ["event-junk", () => H.handleEvent(post("/api/find/event", { v: 1, events: POISON }), net())],
    ["feedback-ok", () => H.handleFeedback(post("/api/find/feedback", { v: 1, jid: JOB, rating: -1, tags: ["too_few"], text: "太少了", fatigue: "ok" }), net())],
    ["feedback-up-down", () => H.handleFeedback(post("/api/find/feedback", { v: 1, jid: JOB, rating: -1, tags: ["too_few"], text: "太少了", fatigue: "ok" }), net({ feedback: () => new Response(POISON, { status: 503 }) }))],
    ["feedback-junk", () => H.handleFeedback(post("/api/find/feedback", { v: 1, jid: "bad", rating: 99, text: POISON }), net())],
  ];
  for (const [name, run] of cases) {
    try { await rec(name, run()); }
    catch (e) { assert.fail(`${name}：端點拋出例外（Function 不得回 5xx 也不得丟錯）：${String(e).slice(0, 80)}`); }
  }
  for (const [tag, routes] of Object.entries(bad)) {
    await rec(`submit-${tag}`, H.handleSubmit(post("/api/find/submit", good()), net(routes)));
    await rec(`status-${tag}`, H.handleStatus(getc(`/api/find/status?id=${JOB}`), net(routes)));
  }

  assert.ok(samples.length >= 28, "樣本數不足");
  // 該成功的要真的成功（避免樣本全是 400 而稽核失去意義）
  const ok = n => assert.equal(samples.find(x => x.name === n)?.status, 200, n + " 應為 200");
  for (const n of ["config-ok", "submit-ok", "status-ok", "status-done", "contact-ok", "event-ok", "feedback-ok"]) ok(n);
  for (const s of samples) {
    assert.ok(s.status < 500, `${s.name} 回了 ${s.status}（不得 5xx）`);
    assert.ok(!s.text.includes(POISON), `${s.name} 洩出毒標記`);
    assert.ok(!/home\.invalid|test-secret|tg-token|ts-secret|X-Aif|aif\/v1/i.test(s.text), `${s.name} 洩出內部資訊`);
    if (s.body) assert.doesNotThrow(() => JSON.parse(s.body), `${s.name} 不是 JSON`);
  }
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const s of samples) fs.writeFileSync(path.join(OUT, s.name + ".txt"), s.text);
  }
});

test("推薦頁（qa）樣本：過期頁與注入區塊都不含內部字樣", () => {
  const exp = SH.expiredResponse();
  assert.equal(exp.status, 410);
  return exp.text().then(t => {
    const text = `HTTP ${exp.status}\n${[...exp.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${t}\n`;
    assert.ok(!/aif\/v1|X-Aif|home\.invalid/i.test(text));
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "share-qa-expired.txt"), text); }
    const html = SH.injectQaBlocks("<html><head></head><body><main>x</main></body></html>", "/");
    assert.ok(!/aif\/v1|X-Aif|home\.invalid/i.test(html));
    if (OUT) fs.writeFileSync(path.join(OUT, "share-qa-injected.txt"), html);
  });
});
