#!/usr/bin/env node
/**
 * find-stamp.mjs — 把推薦頁個人化腳本（public/js/find-brief.js）的版本戳寫進 src/lib/find/version.ts。
 *
 * /js/* 在 Cloudflare 快取一天，所以引用它的網址要帶 ?v=（檔案內容 md5 前 10 碼）；
 * 官網代理（functions/share/[[path]].ts）注入腳本時用的就是 BRIEF_V。
 *
 *   node scripts/find-stamp.mjs           # 寫入（檔案內容已是最新就不動）
 *   node scripts/find-stamp.mjs --check   # 只檢查，過期就 exit 1（給測試與建置前檢查用）
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public/js/find-brief.js");
const OUT = path.join(ROOT, "src/lib/find/version.ts");

export function briefVersion() {
  return crypto.createHash("md5").update(fs.readFileSync(SRC)).digest("hex").slice(0, 10);
}

function render(v) {
  return `/**
 * 推薦頁個人化腳本（find-brief.js）的版本戳。由 scripts/find-stamp.mjs 寫入：
 * 取檔案內容 md5 的前 10 碼，讓 /js/* 一天的快取在檔案改動後立刻換號。不要手改。
 */
export const BRIEF_V = "${v}";
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = briefVersion();
  const want = render(v);
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (process.argv.includes("--check")) {
    if (have !== want) {
      console.error("[find-stamp] 版本戳過期：請執行 node scripts/find-stamp.mjs");
      process.exit(1);
    }
    console.log(`[find-stamp] OK ${v}`);
  } else if (have !== want) {
    fs.writeFileSync(OUT, want, "utf8");
    console.log(`[find-stamp] 寫入 ${v}`);
  } else {
    console.log(`[find-stamp] 已是最新 ${v}`);
  }
}
