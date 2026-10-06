// 設計系統色票對比度（淺色／深色／深色節奏帶）：直接讀 ui2-core.css，由 scripts/contrast-check.mjs 計算。
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./_helpers.mjs";

test("色票對比度：文字 ≥4.5、框線與焦點環 ≥3，三組主題全部通過", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/contrast-check.mjs"), "--json"], { encoding: "utf8" });
  assert.ok(r.stdout, r.stderr);
  const rows = JSON.parse(r.stdout);
  const bad = rows.filter(x => x.ok === false).map(x => `${x.set} ${x.fg}/${x.bg} ${x.ratio}`);
  assert.deepEqual(bad, []);
  assert.ok(rows.filter(x => !x.skip).length >= 55, "算到的組數太少，解析可能壞了");
  assert.equal(r.status, 0);
});
