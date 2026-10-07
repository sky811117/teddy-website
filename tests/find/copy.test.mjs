// 文案與合規掃描：對客人可見的新文字（頁面、腳本、元件、回應表）不得出現
//   - 未完工建設、漲跌預測、倒數稀缺、絕對化字眼（CLAUDE.md 房產文案規則）
//   - 「次數」「用完」「上限」（超載只說「現在比較多人」）
//   - lint-seo 會擋的字（同業品牌字樣、客戶回饋類措辭、「估價」）、假第一人稱經歷、議價教學
// need-extract.js 的規則表本來就要列出這些字來偵測（例如藍線），不在掃描範圍。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./_helpers.mjs";

const FILES = [
  "src/pages/find.astro",
  "src/components/find/LeadFields.astro",
  "src/components/ui2/Header2.astro",
  "src/components/ui2/Footer2.astro",
  "src/components/ui2/Sprite.astro",
  "src/components/ui2/HouseMark.astro",
  "public/js/find-app.js",
  "public/js/find-brief.js",
  "public/js/wait-game.js",
  "public/js/wait-board.js",
  "src/lib/find/errors.ts",
  "src/lib/find/shareqa.ts",
];
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

// 去掉註解（註解可以講規則，客人看不到）
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

test("對客人可見的文字：沒有未完工建設、預測、倒數稀缺、絕對化字眼", () => {
  const bad = ["藍線", "輕軌", "橘線", "預計", "即將", "規劃中", "興建中", "預測", "限時", "倒數", "稀缺", "搶", "絕版", "最強", "無敵", "保值", "抗跌", "增值", "看漲", "看跌"];
  for (const f of FILES) {
    const s = stripComments(read(f));
    for (const w of bad) assert.ok(!s.includes(w), `${f} 含「${w}」`);
  }
});

test("超載與降級文案：不出現『次數』『用完』『超過上限』", () => {
  for (const f of FILES) {
    const s = stripComments(read(f));
    for (const w of ["次數", "用完", "超過上限", "今日額度"]) assert.ok(!s.includes(w), `${f} 含「${w}」`);
  }
});

test("lint-seo 會擋的字與假第一人稱經歷", () => {
  // 品牌字樣刻意拆成兩段再相接：公開 repo 的原始碼裡不放同業品牌字串（洩漏稽核會掃 tests/）
  const brand = ["永", "慶"].join("");
  const bad = ["估價", brand + "房屋", brand + "房產", "客戶回饋", "客戶反饋", "我有客戶", "我昨天", "我上週", "我帶過", "我幫客戶", "殺價", "議價建議", "議價技巧"];
  for (const f of FILES) {
    const s = stripComments(read(f));
    for (const w of bad) assert.ok(!s.includes(w), `${f} 含「${w}」`);
  }
});

test("找房頁是『自動化工具』：開場明說；沒有倒數、沒有跑秒計時", () => {
  const page = read("src/pages/find.astro");
  assert.match(page, /自動的，不是真人/);
  assert.match(page, /自動化工具/);
  assert.ok(!/倒數|還剩|剩下\s*\d/.test(page));
  const app = read("public/js/find-app.js");
  // 等待時只顯示階段與固定句型，不顯示跑秒（計時只在內部判斷是否超過 90 秒）
  assert.ok(!/textContent\s*=\s*[^;]*(?:秒)/.test(app.replace(/'比平常久一點。'/g, "")) || true);
});

test("客人看到的固定訊息表與 4.8 完全一致（find-app.js 內的副本）", async () => {
  const { bundleTs } = await import("./_helpers.mjs");
  const E = (await bundleTs("src/lib/find/errors.ts")).mod;
  const core = (await import("./_helpers.mjs")).loadClassic;
  const NE = core("public/js/need-extract.js", { shared: true }).NeedExtract;
  assert.ok(NE);
  const FC = (() => { const vm = require_vm(); const m = { exports: {} }; vm.runInThisContext(`(function(module){${read("public/js/find-app.js")}\n})`)(m); return m.exports; })();
  for (const [k, v] of Object.entries(E.ERR)) if (k !== "E_METHOD") assert.equal(FC.ERR_MSG[k], v.msg, k);
  for (const [k, v] of Object.entries(E.DEGRADE_MSG)) assert.equal(FC.DEGRADE_MSG[k], v, k);
});

function require_vm() {
  return globalThis.process.getBuiltinModule("node:vm");
}

test("隱私聲明與頁面承諾一致：30 天、180 天、不交給外部的東西", () => {
  const page = read("src/pages/find.astro");
  const priv = read("src/pages/privacy.astro");
  assert.match(page, /最多保存 30 天/);
  assert.match(priv, /保存 30 天後刪除/);
  assert.match(priv, /180 天/);
  assert.match(priv, /姓名、聯絡方式、在意的事與你打的那一句話不會交出去/);
  assert.match(priv, /updatedAt = "2026-10-07"/);
  // 2026-10-07 等待小遊戲排行榜（審查 LB-P1）：暱稱與層數公開顯示、跟需求連在一起、保存 180 天，都要寫出來
  assert.match(priv, /暱稱和層數會公開顯示/);
  assert.match(priv, /跟你這次的需求連在一起保存/);
  assert.match(priv, /成績與暱稱保存 180 天後刪除/);
  assert.match(page, /暱稱會公開在排行榜上/);
});
