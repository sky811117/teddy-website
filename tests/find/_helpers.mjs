// 測試共用小工具：載入 classic script、把 TS 打包成可 import 的模組、讀夾具。全部離線。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIX = path.join(ROOT, "tests", "find", "fixtures");

export function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
}

/**
 * 執行 classic script（public/js 內的檔，沒有 import/export），回傳掛了全域的環境。
 * 預設在獨立的 vm 內（有 window）；shared:true 則在目前的 realm 執行（回傳 globalThis），
 * 這樣回傳的物件與測試檔共用 Object／Array 原型，才能用 deepStrictEqual 比對。純邏輯檔用 shared。
 */
export function loadClassic(rel, extra = {}) {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
  if (extra.shared) {
    vm.runInThisContext(code, { filename: rel });
    return globalThis;
  }
  const sandbox = {
    console,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    ...extra,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: rel });
  return sandbox;
}

/** 模擬 CommonJS require：讀 classic script（它有 module.exports 的保護寫法），在目前 realm 執行並回傳 module.exports。 */
export function requireClassic(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const m = { exports: {} };
  const fn = vm.runInThisContext(`(function (module, exports) {${code}\n})`, { filename: rel });
  fn(m, m.exports);
  return m.exports;
}

let counter = 0;
/** 把一支 TS 打包成單一 ESM（無外部依賴），寫進暫存資料夾後 import 回來。同時回傳打包後的原始碼，供稽核掃描。 */
export async function bundleTs(rel, opts = {}) {
  const entry = path.join(ROOT, rel);
  const out = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    logLevel: "silent",
    minify: false,
    ...opts,
  });
  const code = out.outputFiles[0].text;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-test-"));
  const file = path.join(dir, `m${++counter}-${createHash("md5").update(rel).digest("hex").slice(0, 6)}.mjs`);
  fs.writeFileSync(file, code, "utf8");
  const mod = await import(pathToFileURL(file).href);
  return { mod, code, file };
}

/** 做一個假的 Cloudflare 事件環境。fetchImpl 由各測試決定。 */
export function makeCtx({ method = "POST", url = "https://teddy-house.tw/api/find/submit", headers = {}, body, env = {} } = {}) {
  const h = new Headers(headers);
  const init = { method, headers: h };
  if (body !== undefined && method !== "GET" && method !== "HEAD") init.body = typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request(url, init);
  const pending = [];
  return {
    ctx: { request, env, waitUntil: p => pending.push(p) },
    pending,
  };
}
