#!/usr/bin/env node
/**
 * postbuild-minify.mjs — 壓縮 dist/js/*.js（稽核 F116）
 *
 * public/js/ 底下三支工具頁腳本（tc-addr.js、sd-lookup.js、cine-map.js）原樣複製進 dist、
 * 沒壓縮（Lighthouse 估可省約 24KiB）。這支在 pagefind 之後、postbuild-headers 之前，
 * 用 esbuild（跟 Astro／Vite 同一版 0.27.7，devDependency）把 dist/js/*.js 壓縮後寫回 dist。
 *
 * - 只動 dist，public/ 原檔不動 → 工具頁 fileVer() 算的 ?v= 雜湊不變（快取鍵照舊）
 * - 這幾支是一般 <script>（非 module），頂層函式／變數會被頁面 inline script 直接呼叫：
 *   transform 不指定 format，esbuild 就不會改頂層名稱（只壓縮區域變數與空白）；
 *   壓完再檢查一次：原檔頂層宣告的名稱在壓縮結果裡都還找得到，找不到就放棄那支、保留原檔
 * - 任何一支失敗只印 WARN、保留原檔（沒壓縮的檔照樣能用），整支永遠 exit 0，不擋部署
 * - 測試：DIST_DIR=<假 dist 目錄> node scripts/postbuild-minify.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.env.DIST_DIR ?? "dist");
const JS_DIR = path.join(DIST, "js");
const warn = msg => console.warn(`[postbuild-minify] WARN ${msg}`);

/** 頂層 function／var／let／const／class 宣告的名稱（只看行首、沒縮排的宣告，夠用） */
function topLevelNames(code) {
  const names = new Set();
  const re = /^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:var|let|const|class)\s+([A-Za-z_$][\w$]*))/gm;
  for (const m of code.matchAll(re)) names.add(m[1] ?? m[2]);
  return names;
}

async function main() {
  if (!existsSync(JS_DIR)) {
    console.log("[postbuild-minify] skip：dist/js 不存在");
    return;
  }
  let transformSync;
  try {
    ({ transformSync } = await import("esbuild"));
  } catch (err) {
    warn(`載入 esbuild 失敗（${err.message}），dist/js 維持未壓縮`);
    return;
  }
  const files = readdirSync(JS_DIR).filter(f => f.endsWith(".js") && !f.endsWith(".min.js"));
  let before = 0;
  let after = 0;
  let ok = 0;
  for (const f of files.sort()) {
    const p = path.join(JS_DIR, f);
    try {
      const code = readFileSync(p, "utf8");
      const out = transformSync(code, {
        minify: true,
        loader: "js",
        legalComments: "none",
        charset: "utf8", // 中文字串原樣保留，不轉成 \uXXXX（轉了檔案反而變大）
      }).code;
      const missing = (/^(?:\s*\/\/[^\n]*|\s*\/\*[\s\S]*?\*\/)*\s*\(\s*function\b/.test(code) ? [] : [...topLevelNames(code)]).filter(n => !new RegExp(`(^|[^\\w$])${n.replace(/\$/g, "\\$")}([^\\w$]|$)`).test(out));
      if (missing.length) {
        warn(`${f}：壓縮後找不到頂層名稱 ${missing.slice(0, 5).join(", ")}，保留原檔`);
        continue;
      }
      if (out.length >= code.length) continue;
      writeFileSync(p, out, "utf8");
      before += Buffer.byteLength(code);
      after += Buffer.byteLength(out);
      ok++;
    } catch (err) {
      warn(`${f} 壓縮失敗，保留原檔：${err?.message ?? err}`);
    }
  }
  console.log(
    `[postbuild-minify] dist/js：壓縮 ${ok}/${files.length} 支，${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB`
  );
}

main().catch(err => warn(`整步失敗，略過（不擋部署）：${err?.stack ?? err}`));
