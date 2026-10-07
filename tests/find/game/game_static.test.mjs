// 小遊戲檔的靜態稽核：體積、沒有網路／發聲／外部資源 API、沒有計時器、沒有 emoji、儲存都在 try 內、字串是繁體中性字、來源註明。
// 上游品牌字樣的檢查由 scripts/leak-audit.mjs 用工作站的禁字清單做（清單不進 repo，所以這裡不寫）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ROOT } from "../_helpers.mjs";
import path from "node:path";
import { transformSync } from "esbuild";
import { gzipSync } from "node:zlib";

const src = fs.readFileSync(path.join(ROOT, "public/js/wait-game.js"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");   // 去掉註解，只看程式

test("體積：未壓縮 < 40000 位元組；上線壓縮後 < 24000、gzip 後 < 11000 位元組（等待時才載入）", () => {
  const raw = Buffer.byteLength(src, "utf8");
  const mini = transformSync(src, { minify: true, loader: "js", legalComments: "none", charset: "utf8" }).code;
  const min = Buffer.byteLength(mini, "utf8"), gz = gzipSync(mini).length;
  assert.ok(raw < 40000, `未壓縮 ${raw} bytes`);
  assert.ok(min < 24000, `壓縮後 ${min} bytes`);
  assert.ok(gz < 11000, `gzip 後 ${gz} bytes`);
});

test("檔頭註明玩法來源（程式與畫面自行實作）", () => {
  assert.ok(src.slice(0, 400).includes("玩法參考 iamkun/tower_game（MIT）；程式與畫面為自行實作"));
});

test("沒有外部網址、網路 API、發聲 API、動態執行、計時器", () => {
  const forbidden = [
    /https?:/i, /wss?:/i, /\/\/[a-z0-9.-]+\.[a-z]{2,}/i, /\bwww\./i,
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /importScripts/,
    /\beval\s*\(/, /new\s+Function/, /document\.cookie/, /sessionStorage/, /indexedDB/,
    /new\s+Audio|AudioContext|\.play\s*\(|speechSynthesis|vibrate\s*\(/,
    /\bsetTimeout\b|\bsetInterval\b|\brequestIdleCallback\b/,
    /最強|無敵|第一名|必勝|絕版|最高級|Game\s*Over/i, /neon|霓虹/i,
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

test("遊戲內可見字串全是中性繁中、無常見簡體字、不誇大", () => {
  const block = /var LABELS = \{([\s\S]*?)\n\};/.exec(src)[1];
  const strings = [...block.matchAll(/'([^']*)'/g)].map(m => m[1]).filter(s => /[一-鿿]/.test(s));
  assert.ok(strings.length >= 20, `找到 ${strings.length} 句`);
  const simplified = /[这个们说还会对时间发开关东车见现么为样应让没网页点击总结过进钟楼层盖续记录]/;
  for (const s of strings) {
    assert.ok(!simplified.test(s), `疑似簡體：${s}`);
    assert.ok(!/最|第一|唯一|保證|絕對|限時|倒數|搶/.test(s.replace(/最高紀錄/g, "")), `誇大或催促字眼：${s}`);
  }
  assert.ok(block.includes("點一下放下樓層，疊得越準蓋得越高"), "開始畫面的一句說明");
  assert.ok(block.includes("你蓋了 {n} 層樓！"));
  assert.ok(block.includes("再蓋一棟"));
});

test("場景色不用暗黑霓虹：淺色天空每一格都夠亮；兩個主題都沒有「又飽和又亮」的霓虹色", () => {
  const scene = /var SCENE = \{([\s\S]*?)\n\};/.exec(src)[1];
  const part = (name) => new RegExp(`${name}: \\{([\\s\\S]*?)\\n  \\}`).exec(scene)[1];
  const hexes = (s) => [...s.matchAll(/#([0-9a-f]{6})/gi)].map(m => m[1]);
  const rgb = (h) => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = (h) => { const [r, g, b] = rgb(h).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const neon = (h) => { const c = rgb(h), mx = Math.max(...c), mn = Math.min(...c); return mx > 0.7 && (mx - mn) / mx > 0.6; };   // HSV：亮度高又飽和
  const lightSky = hexes(/sky: (\[[^\n]*\]),/.exec(part("light"))[1]);
  assert.ok(lightSky.length === 6 && lightSky.every(h => lum(h) > 0.65), `淺色天空 ${lightSky}`);
  for (const t of ["light", "dark"]) for (const h of hexes(part(t))) assert.ok(!neon(h), `${t} 場景有霓虹色：#${h}`);
  const darkSky = hexes(/sky: (\[[^\n]*\]),/.exec(part("dark"))[1]);
  assert.ok(darkSky.every(h => lum(h) < 0.05), "深色天空是暗的（配深色網站）");
});

test("深色模式對比：樓的外框、要對準那塊的木色框，跟夜空每一格都至少 3:1（圖形最低建議）", () => {
  const scene = /var SCENE = \{([\s\S]*?)\n\};/.exec(src)[1];
  const dark = /dark: \{([\s\S]*?)\n  \}/.exec(scene)[1];
  const lum = (h) => { const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const sky = [.../sky: (\[[^\n]*\]),/.exec(dark)[1].matchAll(/#([0-9a-f]{6})/gi)].map(m => m[1]);
  const line = /line: '#([0-9a-f]{6})'/i.exec(dark)[1];
  const wood = /dark:\s+\{[^}]* wood: '#([0-9a-f]{6})'/.exec(/var BUILTIN = \{([\s\S]*?)\n\};/.exec(src)[1])[1];
  for (const c of sky) {
    assert.ok(ratio(line, c) >= 3, `外框 #${line} 對夜空 #${c} 只有 ${ratio(line, c).toFixed(2)}`);
    assert.ok(ratio(wood, c) >= 3, `木色框 #${wood} 對夜空 #${c} 只有 ${ratio(wood, c).toFixed(2)}`);
  }
});

test("對外介面：mountWaitGame 與 WaitGameCore 掛在 window，Node 端同一份 core；銷毀會拆掉所有監聽", () => {
  assert.match(src, /window\.mountWaitGame\s*=\s*mountWaitGame/);
  assert.match(src, /window\.WaitGameCore\s*=\s*core/);
  assert.match(src, /module\.exports\s*=\s*api/);
  // 所有監聽都經過 on()（才會被 destroy 拆掉）
  const direct = [...code.matchAll(/\.addEventListener\(/g)].length;
  assert.equal(direct, 1, "只有 on() 裡面那一處直接 addEventListener");
  assert.ok(/requestAnimationFrame/.test(code) && /cancelAnimationFrame/.test(code));
});

test("找房頁的遊戲容器：標題寫「蓋大樓」（不是舊遊戲名）、掛載點還在、畫布預設不擋捲動", () => {
  const page = fs.readFileSync(path.join(ROOT, "src/pages/find.astro"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "src/styles/ui2-find.css"), "utf8");
  const wrap = /<div id="game-wrap" hidden>([\s\S]*?)<\/div>\s*<details/.exec(page);
  assert.ok(wrap, "#game-wrap 區塊");
  assert.match(wrap[1], /<p class="u2-small">蓋大樓<\/p>/);
  assert.match(wrap[1], /id="wait-game-mount"/);
  assert.match(wrap[1], /id="game-skip"/);
  assert.ok(!/守護小屋/.test(page + src), "舊遊戲名不留在頁面與遊戲檔");
  assert.match(css, /\.u2-gamebox canvas \{[^}]*touch-action: manipulation/);
});
