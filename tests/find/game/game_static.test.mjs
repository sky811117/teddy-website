// 小遊戲檔的靜態稽核：體積、沒有網路／發聲／外部資源 API、沒有 emoji、儲存都在 try 內、字串是繁體中性字。
// 上游品牌字樣的檢查由 scripts/leak-audit.mjs 用工作站的禁字清單做（清單不進 repo，所以這裡不寫）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ROOT } from "../_helpers.mjs";
import path from "node:path";

const src = fs.readFileSync(path.join(ROOT, "public/js/wait-game.js"), "utf8");

test("未壓縮體積 < 40000 位元組（十進位與二進位算法都過）", () => {
  assert.ok(Buffer.byteLength(src, "utf8") < 40000, `${Buffer.byteLength(src, "utf8")} bytes`);
});

test("沒有外部網址、網路 API、發聲 API、動態執行", () => {
  const forbidden = [
    /https?:/i, /wss?:/i, /\/\/[a-z0-9.-]+\.[a-z]{2,}/i, /\bwww\./i,
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /importScripts/,
    /\beval\s*\(/, /new\s+Function/, /document\.cookie/, /sessionStorage/, /indexedDB/,
    /new\s+Audio|AudioContext|\.play\s*\(/,
    /最強|無敵|第一名|必勝|Game\s*Over/i, /neon|霓虹/i,
  ];
  for (const re of forbidden) {
    const m = re.exec(src);
    assert.equal(m, null, `命中 ${re}：…${m && src.slice(Math.max(0, m.index - 20), m.index + 40)}…`);
  }
});

test("沒有 emoji、沒有圖片／字型／音效資源參照", () => {
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(src), false, "emoji");
  assert.equal(/\bnew\s+Image\b|\bImage\s*\(|@font-face|\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp3|wav|ogg)\b|url\s*\(|data:/i.test(src), false, "外部資源");
});

test("所有 localStorage 存取都在 try 內（只有讀與寫兩處）", () => {
  const lines = src.split("\n");
  let n = 0;
  lines.forEach((l, i) => {
    if (/localStorage/.test(l)) {
      n++;
      assert.ok(/try\s*\{/.test(lines.slice(Math.max(0, i - 1), i + 1).join("\n")), `第 ${i + 1} 行 localStorage 沒有 try：${l.trim()}`);
    }
  });
  assert.equal(n, 2);
});

test("遊戲內可見字串全是中性繁中、無常見簡體字", () => {
  const block = /var LABELS = \{([\s\S]*?)\n\};/.exec(src)[1];
  const strings = [...block.matchAll(/'([^']*)'/g)].map(m => m[1]).filter(s => /[一-鿿]/.test(s));
  assert.ok(strings.length >= 15, `找到 ${strings.length} 句`);
  const simplified = /[这个们说还会对时间发开关东车见现么为样应让没网页点击总结过进钟]/;
  for (const s of strings) assert.ok(!simplified.test(s), `疑似簡體：${s}`);
});

test("對外介面：mountWaitGame 與 WaitGameCore 掛在 window，Node 端同一份 core", () => {
  assert.match(src, /window\.mountWaitGame\s*=\s*mountWaitGame/);
  assert.match(src, /window\.WaitGameCore\s*=\s*core/);
  assert.match(src, /module\.exports\s*=\s*api/);
});
