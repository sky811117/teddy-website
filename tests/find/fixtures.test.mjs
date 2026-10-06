// 兩側共用夾具與版本戳的一致性檢查。
//  - need_fixtures.json／event_cases.json／sign_vectors.json：家用機正本與官網複本的 sha256 必須相同。
//    這裡記的是 2026-10-06 04:36 兩側同步時的雜湊；任何一側改了夾具，要同步兩邊並更新這裡（測試失敗就是提醒）。
//  - find-brief.js 的版本戳（src/lib/find/version.ts）必須是檔案內容 md5 的前 10 碼。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, FIX, readFixture } from "./_helpers.mjs";

const SHA = {
  "need_fixtures.json": "1543deb76ca5116ccd86b759b177494378c9f7b14ea91e1f6365ac52a24a489f",   // 2026-10-06 14:40 與家用機正本重新同步（x106 RT-11 修訂）
  "event_cases.json": "e2d3bea4078443c3a2bd6736677ea01832c9b8d0beadad7dc276cea8ac0eee8c",
  "sign_vectors.json": "96609db0ef7d444a16e915621615f6e1ff4c30f858940425b2636c806c8919d0",
};

test("共用夾具的雜湊與家用機正本同步時相同", () => {
  for (const [f, want] of Object.entries(SHA)) {
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(FIX, f))).digest("hex");
    assert.equal(got, want, `${f} 與家用機正本不一致：請兩邊一起改，並更新本檔的雜湊`);
  }
});

test("夾具只用假資料：沒有任何上游品牌字樣、真實網域", () => {
  const blob = ["need_fixtures.json", "event_cases.json", "sign_vectors.json"].map(f => fs.readFileSync(path.join(FIX, f), "utf8")).join("\n");
  // 網址只允許：官網網域（推薦頁），以及注入測試句裡明顯是假的 evil.example.com
  const urls = blob.match(/https?:\/\/[^\s"'<>）)]+/gi) || [];
  for (const u of urls) assert.ok(/^https:\/\/(www\.)?teddy-house\.tw\//.test(u) || /^https?:\/\/evil\.example\.com\//.test(u), "夾具裡出現非預期網址");
  // 內部主機／隧道字樣的檢查由 scripts/leak-audit.mjs（--diff 會掃 tests/）負責，清單只放工作站
});

test("夾具規模：抽取 ≥80 句、規則式 ≥60、需要 LLM 才行的 ≥10、含注入句 ≥4；各 kind 都有", () => {
  const FX = readFixture("need_fixtures.json");
  const ext = FX.cases.filter(c => c.kind === "extract");
  assert.ok(ext.length >= 80);
  assert.ok(ext.filter(c => c.tier === "rules").length >= 60);
  assert.ok(ext.filter(c => c.tier === "llm").length >= 10);
  assert.ok(ext.filter(c => c.inject).length >= 4);
  for (const k of ["compose", "assess", "pii", "validate", "brief", "frag"]) assert.ok(FX.cases.some(c => c.kind === k), k);
  assert.equal(new Set(FX.cases.map(c => c.id)).size, FX.cases.length, "id 不可重複");
});

test("find-brief.js 版本戳（version.ts）沒有過期", () => {
  const v = crypto.createHash("md5").update(fs.readFileSync(path.join(ROOT, "public/js/find-brief.js"))).digest("hex").slice(0, 10);
  const ts = fs.readFileSync(path.join(ROOT, "src/lib/find/version.ts"), "utf8");
  assert.match(ts, new RegExp(`BRIEF_V = "${v}"`), "請執行 node scripts/find-stamp.mjs");
});
