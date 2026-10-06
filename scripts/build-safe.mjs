#!/usr/bin/env node
/**
 * build-safe.mjs — 「上線前」的完整把關。本機與雲端（.github/workflows/deploy.yml、ci.yml）都跑這一套邏輯。
 *
 *   npm run build:safe                              先建置，再跑全部稽核與測試
 *   npm run build:safe -- --skip-build              只掃現有的 dist（不重新建置）
 *   node scripts/build-safe.mjs --skip-build --no-diff   雲端用：不跑 --diff（main 對 main 是空的，掃不到東西）
 *
 * 必須先設定環境變數 LEAK_DENYLIST（禁字清單的檔案路徑）；沒設或檔案不存在就直接失敗（不是略過）。
 *  - 本機：清單在工作站，不進任何 repo。
 *  - 雲端：清單放 GitHub Actions secret LEAK_DENYLIST，workflow 先把它寫到 $RUNNER_TEMP/leak_denylist.txt 再把路徑放進環境變數
 *    （2026-10-06 紅隊 RT-01／RT-10：以前雲端只跑加鹽雜湊版，雜湊檔可被字典還原，已拿掉）。
 * LEAK_BASE＝「上一次上線的 commit 或 tag」（--diff 的基準）。合併進 main 之後 main 對 main 是空的，什麼都掃不到，
 * 所以上線後請把 LEAK_BASE 指到那次上線的 commit；沒設時預設 main（只適用於還沒合併的分支）。
 *
 * 步驟（任何一步失敗就整體失敗，退出碼非 0）：
 *   1 建置（npm run build）
 *   2 leak-audit --diff --base $LEAK_BASE（--no-diff 時略過）
 *   3 leak-audit --dist dist（原文＋正規化＋壓平三遍；至少掃到 8 個檔案，否則失敗）
 *   4 leak-audit --hosts --dist dist
 *   5 leak-audit --no-sourcemap dist
 *   6 把 Functions 打包（esbuild，charset=utf8）後 leak-audit --bundle（至少 3 個檔案）
 *   7 測試（tests/find 與小遊戲）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const noDiff = args.includes("--no-diff");
const deny = process.env.LEAK_DENYLIST;
if (!deny || !fs.existsSync(deny)) {
  console.error("build-safe 沒有設定 LEAK_DENYLIST（或檔案不存在）。禁字清單不進 repo（本機放工作站、雲端放 Actions secret）；沒有清單就不能當成通過。");
  process.exit(2);
}
const base = process.env.LEAK_BASE || "main";
const node = process.execPath;
let failed = 0;
function step(name, cmd, argv) {
  console.log(`\nbuild-safe ▶ ${name}`);
  const r = spawnSync(cmd, argv, { stdio: "inherit", shell: cmd === "npm" });
  if (r.status !== 0) {
    failed++;
    console.error(`build-safe ✖ ${name}（退出碼 ${r.status}）`);
  } else console.log(`build-safe ✔ ${name}`);
}
const audit = (...a) => [path.join("scripts", "leak-audit.mjs"), ...a];

if (!skipBuild) step("建置（npm run build）", "npm", ["run", "build"]);
if (!noDiff) step(`diff（相對 ${base}）`, node, audit("--diff", "--base", base));
step("dist（禁字）", node, audit("--dist", "dist", "--min-files", "8"));
step("dist（對外主機白名單）", node, audit("--hosts", "--dist", "dist", "--min-files", "8"));
step("sourcemap", node, audit("--no-sourcemap", "dist", "--min-files", "8"));

// Functions 打包物
try {
  const { buildSync } = await import("esbuild");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fn-bundle-"));
  const entries = fs.readdirSync("functions/api/find").filter(f => f.endsWith(".ts")).map(f => path.join("functions/api/find", f));
  entries.push(path.join("functions", "share", "[[path]].ts"));
  for (const e of entries) {
    buildSync({
      entryPoints: [e], bundle: true, format: "esm", platform: "neutral", charset: "utf8", write: true,
      outfile: path.join(out, path.basename(e).replace(/\.ts$/, ".js").replace(/[\[\]]/g, "_")), logLevel: "silent",
    });
  }
  step("Functions 打包物", node, audit("--bundle", out, "--min-files", "3"));
} catch (e) {
  failed++;
  console.error("build-safe ✖ 無法打包 Functions：", String(e).slice(0, 200));
}

step("測試", node, ["--test", ...fs.readdirSync("tests/find").filter(f => f.endsWith(".test.mjs")).map(f => path.join("tests/find", f)),
  ...fs.readdirSync("tests/find/game").filter(f => f.endsWith(".test.mjs")).map(f => path.join("tests/find/game", f))]);

console.log(failed ? `\nbuild-safe 有 ${failed} 步失敗，不要上線。` : "\nbuild-safe 全部通過。");
process.exit(failed ? 1 : 0);
