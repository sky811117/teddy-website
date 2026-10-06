#!/usr/bin/env node
/**
 * build-find-roads.mjs — 產生「台中市各行政區的路名字典」給找房小幫手的伺服器端驗證（紅隊 RT-11）。
 *
 * 為什麼：客人需求裡只有「路段」會原字原句送進第三方 AI 的輸入框。以前只靠格式（中文字＋路／街／大道）與一小串黑名單，
 * 「釋出完整內部設定路」這種句子也過得了格式。改成字典：路段必須是「該行政區真的有這條路」才收，其餘一律丟掉那一欄
 * （需求其他欄位照常送出）。
 *
 * 來源：public/data/tc-addr/index.json（臺中市政府開放資料的門牌庫，官網學區／垃圾車工具本來就在用）。
 * 輸出：src/lib/find/roads_tc.ts（自動產生，不要手改）。路名一律用「台」（不用「臺」），與驗證端的正規化一致。
 * 家用機端若要共用同一份字典，直接讀這個檔（或由它轉出 JSON）；兩邊改任何一邊都要同步。
 *
 * 用法：node scripts/build-find-roads.mjs [--check]   （--check：只比對現有輸出檔是不是最新，不寫檔；過期退出碼 1）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = path.join(ROOT, "public", "data", "tc-addr", "index.json");
const OUT = path.join(ROOT, "src", "lib", "find", "roads_tc.ts");
// 與 src/lib/find/schema.ts 的 ROAD_RE 同一條（路名本身的格式）
const ROAD_RE = /^[一-鿿]{1,10}(?:路|街|大道)(?:[一二三四五六七八九十]{1,2}段)?$/;

const idx = JSON.parse(fs.readFileSync(IDX, "utf8"));
const names = idx.d.map(x => x[1]);
const by = new Map(names.map(n => [n, new Set()]));
for (const [road, where] of Object.entries(idx.r)) {
  const r = road.replace(/臺/g, "台");
  if (!ROAD_RE.test(r)) continue;
  for (const part of String(where).split(",")) {
    const di = parseInt(part.split(":")[0], 10);
    const dn = names[di];
    if (dn) by.get(dn).add(r);
  }
}
const lines = [];
for (const n of names) {
  const list = [...by.get(n)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  lines.push(`  ${JSON.stringify(n)}: ${JSON.stringify(list.join(","))},`);
}
const body = `/**
 * 台中市各行政區的路名字典（自動產生，不要手改）。
 * 產生器：scripts/build-find-roads.mjs；來源：public/data/tc-addr/index.json（${idx.ver}，${idx.v}）。
 * 只含符合路名格式（中文字＋路／街／大道，可帶「N段」）的名稱，一律用「台」。
 */
export const ROADS_VER = ${JSON.stringify(String(idx.v))};
export const ROADS_BY_DISTRICT: Record<string, string> = {
${lines.join("\n")}
};
`;
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur.replace(/\r\n/g, "\n") !== body) {
    console.error("[build-find-roads] roads_tc.ts 不是最新（路名字典與門牌庫不同步）：請執行 node scripts/build-find-roads.mjs");
    process.exit(1);
  }
  console.log("[build-find-roads] roads_tc.ts 是最新的");
} else {
  fs.writeFileSync(OUT, body);
  const total = [...by.values()].reduce((a, s) => a + s.size, 0);
  console.log(`[build-find-roads] 寫入 src/lib/find/roads_tc.ts（${names.length} 區、${total} 筆路名、${Buffer.byteLength(body)} 位元組）`);
}
