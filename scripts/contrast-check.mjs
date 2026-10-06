#!/usr/bin/env node
/**
 * contrast-check.mjs — 從 src/styles/ui2-core.css 直接讀色票，算 WCAG 對比度（淺色、深色、深色節奏帶三組）。
 * 文字配對要 ≥4.5:1；圖形／框線／焦點環配對要 ≥3:1。任何一組不過就 exit 1。
 * 只讀檔、不連網。用法：node scripts/contrast-check.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "src/styles/ui2-core.css"), "utf8");

/** 取出以 selector 開頭的整個 { } 區塊內容（只處理最外層、沒有巢狀的 token 區塊） */
function block(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) throw new Error("找不到區塊：" + selector);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/--(u2-[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].replace(/\/\*[\s\S]*?\*\//g, "").trim();
  return out;
}
function resolve(map, v, depth = 0) {
  const m = /^var\(--(u2-[a-z0-9-]+)\)$/.exec(v);
  if (m && depth < 5) return map[m[1]] ? resolve(map, map[m[1]], depth + 1) : null;
  return v;
}
const hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
const lum = h => {
  const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const light = tokens(block(".ui2"));
const dark = { ...light, ...tokens(block('html[data-theme="dark"] .ui2')) };
// 深色節奏帶：把 token 對映後的結果（var() 解開）；rgb(… / .08) 這種帶透明度的略過
const inverseRaw = tokens(block(".u2-band--inverse,\nhtml .ui2.u2-band--inverse"));
const inverse = { ...light, ...inverseRaw };

const TEXT = 4.5;
const GFX = 3;
const sets = [
  {
    name: "淺色",
    t: light,
    pairs: [
      ["ink", "paper", TEXT], ["ink", "sunken", TEXT], ["ink", "vellum", TEXT],
      ["ink-2", "paper", TEXT], ["ink-2", "sunken", TEXT], ["ink-2", "vellum", TEXT],
      ["ink-3", "paper", TEXT], ["ink-3", "vellum", TEXT],
      ["wood", "paper", TEXT], ["wood", "sunken", TEXT], ["wood", "vellum", TEXT], ["wood", "wood-100", TEXT],
      ["on-wood", "wood-600", TEXT], ["on-wood", "wood-700", TEXT],
      ["on-pine", "pine", TEXT], ["on-pine", "pine-hover", TEXT],
      ["ok", "paper", TEXT], ["ok", "ok-tint", TEXT],
      ["err", "paper", TEXT], ["err", "err-tint", TEXT],
      ["warn", "paper", TEXT], ["warn", "warn-tint", TEXT],
      ["line-strong", "paper", GFX], ["line-strong", "vellum", GFX],
      ["focus", "paper", GFX], ["focus", "vellum", GFX], ["wood-500", "paper", GFX],
    ],
  },
  {
    name: "深色",
    t: dark,
    pairs: [
      ["ink", "paper", TEXT], ["ink", "sunken", TEXT], ["ink", "vellum", TEXT],
      ["ink-2", "paper", TEXT], ["ink-2", "sunken", TEXT], ["ink-2", "vellum", TEXT],
      ["ink-3", "paper", TEXT], ["ink-3", "vellum", TEXT],
      ["wood", "paper", TEXT], ["wood", "sunken", TEXT], ["wood", "vellum", TEXT], ["wood", "wood-100", TEXT],
      ["on-wood", "wood-600", TEXT], ["on-pine", "pine", TEXT], ["on-pine", "pine-hover", TEXT],
      ["ok", "paper", TEXT], ["ok", "ok-tint", TEXT],
      ["err", "paper", TEXT], ["err", "err-tint", TEXT],
      ["warn", "paper", TEXT], ["warn", "warn-tint", TEXT],
      ["line-strong", "paper", GFX], ["line-strong", "vellum", GFX],
      ["focus", "paper", GFX], ["focus", "vellum", GFX], ["wood-500", "paper", GFX],
    ],
  },
  {
    name: "深色節奏帶",
    t: inverse,
    base: "inverse",
    pairs: [
      ["ink", "inverse", TEXT], ["ink-2", "inverse", TEXT], ["ink-3", "inverse", TEXT], ["wood", "inverse", TEXT],
      ["on-wood", "wood-600", TEXT], ["on-wood", "wood-700", TEXT],
      ["line-strong", "inverse", GFX], ["focus", "inverse", GFX],
    ],
  },
];

const rows = [];
let bad = 0;
for (const s of sets) {
  for (const [fg, bg, min] of s.pairs) {
    const a = hex(resolve(s.t, s.t["u2-" + fg] ?? ""));
    const b = hex(resolve(s.t, s.t["u2-" + bg] ?? ""));
    if (!a || !b) { rows.push({ set: s.name, fg, bg, skip: true }); continue; }
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) bad++;
    rows.push({ set: s.name, fg, bg, fgHex: a, bgHex: b, ratio: Math.round(r * 100) / 100, min, ok });
  }
}
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
else {
  for (const r of rows) {
    if (r.skip) { console.log(`略過  ${r.set}  ${r.fg} / ${r.bg}（含透明度或未定義）`); continue; }
    console.log(`${r.ok ? "OK  " : "不過"}  ${r.set}  ${r.fg} ${r.fgHex} on ${r.bg} ${r.bgHex}  ${r.ratio}:1（要 ≥${r.min}）`);
  }
  const n = rows.filter(r => !r.skip).length;
  console.log(bad ? `\n${bad} 組對比度不足（共算 ${n} 組）` : `\n全部通過（共算 ${n} 組）`);
}
process.exit(bad ? 1 : 0);
