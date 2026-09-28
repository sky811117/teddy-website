#!/usr/bin/env node
/**
 * indexnow-submit.mjs — 部署成功後，把「這次新增或內容有變的網址」推給 IndexNow
 *
 * IndexNow（api.indexnow.org）會轉發給 Bing / Yandex / Naver / Seznam 等引擎。
 * Bing 的索引同時是 ChatGPT 搜尋、Copilot 的資料來源，所以新頁面越早進 Bing 越好。
 *
 * 判斷「有變的網址」不看檔名（文章網址由 frontmatter slug 決定，跟檔名常常不同），
 * 一律拿 sitemap 比對：
 *   舊版 = 部署「前」線上的 sitemap（sitemap-index.xml → 各子 sitemap）
 *   新版 = 這次 build 出來的 dist/sitemap-*.xml（lastmod 由 scripts/sitemap-lastmod.mjs 填）
 *   要推 = 新版有、舊版沒有的網址 + 兩邊都有但 lastmod 不同的網址
 * 舊版抓不到（第一次、網路錯、子 sitemap 缺一份、被轉址到別的網域）→ 不整站推，
 * 只推 dist 裡 lastmod 在最近 N 天（預設 2 天）內的網址。
 * 比對結果超過一半網址（且 >200 筆）也視為比對基準壞掉，同樣改走最近 N 天。
 * sitemapindex 巢狀（index 裡再包 index）最多 3 層。
 *
 * 用法（CI，見 .github/workflows/deploy.yml）：
 *   部署前：node scripts/indexnow-submit.mjs --snapshot "$RUNNER_TEMP/indexnow-live-sitemap.json"
 *   部署後：node scripts/indexnow-submit.mjs --old "$RUNNER_TEMP/indexnow-live-sitemap.json"
 * 本機試算（直接抓線上 sitemap 當舊版，只算要推哪些，不打 API）：
 *   node scripts/indexnow-submit.mjs --dry-run
 *
 * 選項：
 *   --dist <dir>          build 輸出目錄（預設 repo 的 dist/）
 *   --old <file>          --snapshot 存下的舊版 JSON；沒給就當場抓線上 sitemap
 *   --snapshot <file>     只抓線上 sitemap 存成 JSON，不比對、不推送
 *   --dry-run             只算不推
 *   --fallback-days <n>   舊版不可用時，只推 lastmod 在最近 n 天內的網址（預設 2）
 *   --show <n>            log 列出前 n 筆網址（預設 30）
 *
 * 金鑰：不寫死在程式裡。從 dist 根目錄找「檔名＝內容」的 <key>.txt
 * （public/ 裡的 IndexNow 驗證檔），環境變數 INDEXNOW_KEY 可覆寫。log 只印遮罩過的金鑰。
 *
 * ⛔ 這支程式永遠 exit 0：IndexNow 失敗絕不能讓部署變紅燈。
 * 零新依賴，只用 Node 內建 fetch（Node 22+）。
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10000; // IndexNow 單次上限
// 比對模式要推的筆數同時超過 BULK_MIN 筆、且超過 dist 網址數的 BULK_RATIO → 視為比對基準壞掉
const BULK_MIN = 200;
const BULK_RATIO = 0.5;
const FALLBACK_SITE = "https://teddy-website-blog.pages.dev";
// Cloudflare 會擋沒有 User-Agent 的請求（indexnow_push.py 實測回 403）
const UA =
  "Mozilla/5.0 (compatible; teddy-website-indexnow/1.0; +https://teddy-website-blog.pages.dev/)";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (...a) => console.log("[indexnow]", ...a);
const warn = (...a) => console.warn("[indexnow] ⚠️", ...a);

// ─── 參數 ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    dist: path.join(REPO_ROOT, "dist"),
    old: null,
    snapshot: null,
    dryRun: false,
    fallbackDays: 2,
    show: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--dist") opts.dist = path.resolve(next());
    else if (a === "--old") opts.old = path.resolve(next());
    else if (a === "--snapshot") opts.snapshot = path.resolve(next());
    else if (a === "--fallback-days") opts.fallbackDays = Number(next());
    else if (a === "--show") opts.show = Number(next());
    else warn(`不認得的參數 ${a}，忽略`);
  }
  if (!Number.isFinite(opts.fallbackDays) || opts.fallbackDays <= 0) opts.fallbackDays = 2;
  if (!Number.isFinite(opts.show) || opts.show < 0) opts.show = 30;
  return opts;
}

// ─── sitemap 解析（手刻 regex，不加 XML 套件）────────────────────────────
function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`));
  return m ? decodeXml(m[1]) : null;
}

const isSitemapIndex = xml => /<sitemapindex[\s>]/.test(xml);

/** sitemap-index.xml → 子 sitemap 網址清單；不是 sitemapindex 就丟錯 */
function parseSitemapIndex(xml) {
  if (!isSitemapIndex(xml)) throw new Error("不是 sitemapindex");
  const locs = [];
  for (const m of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/g)) {
    const loc = tag(m[1], "loc");
    if (loc) locs.push(loc);
  }
  if (locs.length === 0) throw new Error("sitemapindex 裡沒有任何子 sitemap");
  return locs;
}

/** 子 sitemap → Map(網址 → lastmod 字串或 null)；不是 urlset 就丟錯 */
function parseUrlset(xml, into = new Map()) {
  if (!/<urlset[\s>]/.test(xml)) throw new Error("不是 urlset");
  for (const m of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/g)) {
    const loc = tag(m[1], "loc");
    if (loc) into.set(loc, tag(m[1], "lastmod"));
  }
  return into;
}

/**
 * 從子 sitemap 清單一路往下收網址。sitemapindex 底下可以再包 sitemapindex
 * （@astrojs/sitemap 現在只有一層，但換套件或分檔後可能變多層），最多 MAX_SITEMAP_DEPTH 層。
 * loadXml(loc) 負責拿到那份 XML（dist 讀檔 / 線上 GET）；任何一份失敗就整份丟錯。
 */
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_FILES = 200;
async function collectUrls(locs, loadXml, depth = 1, urls = new Map(), seen = new Set()) {
  for (const loc of locs) {
    if (seen.has(loc)) continue;
    seen.add(loc);
    if (seen.size > MAX_SITEMAP_FILES) throw new Error(`sitemap 檔超過 ${MAX_SITEMAP_FILES} 份，疑似迴圈`);
    const xml = await loadXml(loc);
    if (isSitemapIndex(xml)) {
      if (depth >= MAX_SITEMAP_DEPTH) throw new Error(`sitemapindex 巢狀超過 ${MAX_SITEMAP_DEPTH} 層：${loc}`);
      await collectUrls(parseSitemapIndex(xml), loadXml, depth + 1, urls, seen);
    } else {
      parseUrlset(xml, urls);
    }
  }
  return urls;
}

// ─── 新版：dist 的 sitemap ─────────────────────────────────────────────
function readDistIndex(distDir) {
  const indexPath = path.join(distDir, "sitemap-index.xml");
  if (!existsSync(indexPath)) throw new Error(`找不到 ${indexPath}（先 build）`);
  const subs = parseSitemapIndex(readFileSync(indexPath, "utf8"));
  return { subs, site: new URL(subs[0]).origin };
}

async function loadDistSitemap(distDir) {
  const { subs, site } = readDistIndex(distDir);
  const urls = await collectUrls(subs, async loc => {
    // 子 sitemap 的 loc 是完整線上網址，對回 dist 裡同路徑的檔案
    const u = new URL(loc);
    if (u.origin !== site) throw new Error(`dist 子 sitemap 不在同網域：${loc}`);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    return readFileSync(path.join(distDir, rel), "utf8");
  });
  if (urls.size === 0) throw new Error("dist sitemap 一個網址都沒有");
  return { site, urls };
}

// ─── 舊版：線上 sitemap ───────────────────────────────────────────────
async function httpGet(url, timeoutMs = 20000) {
  // 加查詢字串避開 CDN 快取；Cloudflare Pages 對靜態檔會忽略它照常回檔
  const u = new URL(url);
  u.searchParams.set("indexnow", String(Date.now()));
  const res = await fetch(u, {
    headers: {
      "User-Agent": UA,
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  // 被轉址到別的網域（改網域、Pages 專案被停用導去別處）→ 拿到的不是本站的東西，當失敗處理
  const finalHost = res.url ? new URL(res.url).host : u.host;
  if (finalHost !== u.host) throw new Error(`GET ${url} 被轉址到別的網域 ${finalHost}`);
  return await res.text();
}

/**
 * 抓線上 sitemap。任何一份子 sitemap 抓不到、解析失敗或指到別的網域就整份判失敗
 * （不然那一份裡的網址全部會被當成「新網址」，等於整站推）。
 */
async function fetchLiveSitemap(site) {
  try {
    const host = new URL(site).host;
    const subs = parseSitemapIndex(await httpGet(`${site}/sitemap-index.xml`));
    const urls = await collectUrls(subs, loc => {
      if (new URL(loc).host !== host) throw new Error(`線上子 sitemap 指到別的網域：${loc}`);
      return httpGet(loc);
    });
    if (urls.size === 0) throw new Error("線上 sitemap 一個網址都沒有");
    return { ok: true, site, fetchedAt: new Date().toISOString(), sitemaps: subs, urls };
  } catch (err) {
    return { ok: false, site, fetchedAt: new Date().toISOString(), error: String(err?.message ?? err) };
  }
}

function snapshotToJson(snap) {
  return JSON.stringify(
    snap.ok ? { ...snap, urls: Object.fromEntries(snap.urls) } : snap,
    null,
    0
  );
}

function loadSnapshotFile(file) {
  if (!existsSync(file)) return { ok: false, error: `找不到舊版檔 ${file}` };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (!j.ok) return { ok: false, error: `舊版快照當時就失敗：${j.error ?? "未知原因"}` };
    const urls = new Map(Object.entries(j.urls ?? {}));
    if (urls.size === 0) return { ok: false, error: "舊版快照是空的" };
    return { ok: true, site: j.site, fetchedAt: j.fetchedAt, urls };
  } catch (err) {
    return { ok: false, error: `舊版檔讀取失敗：${err.message}` };
  }
}

// ─── 比對 ─────────────────────────────────────────────────────────────
// sitemap 的 lastmod 照規格要帶時區（現在 build 出來都是 toISOString 的 …Z）。
// 萬一出現沒帶時區的「日期+時間」，Date.parse 會拿本機時區解讀：CI 是 UTC、景泰電腦是 UTC+8，
// 同一個字串兩邊差 8 小時，dry-run 跟 CI 算出來的結果會不一樣 → 一律補 Z 當 UTC。
// 純日期（2026-09-29）Date.parse 本來就當 UTC，不用處理。
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const toMs = s => {
  if (!s) return null;
  let str = String(s).trim();
  if (NAIVE_DATETIME.test(str)) str = `${str.replace(" ", "T")}Z`;
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
};

function sameLastmod(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = toMs(a);
  const tb = toMs(b);
  if (ta !== null && tb !== null) return ta === tb;
  return a.trim() === b.trim();
}

/** 新網址排前面，同一類裡照 lastmod 新到舊（沒 lastmod 的排最後） */
function byPriority(a, b) {
  if (a.reason !== b.reason) return a.reason === "new" ? -1 : 1;
  return (toMs(b.lastmod) ?? 0) - (toMs(a.lastmod) ?? 0);
}

function diffSitemaps(oldUrls, newUrls) {
  const picked = [];
  let newer = 0;
  let older = 0;
  for (const [url, lastmod] of newUrls) {
    if (!oldUrls.has(url)) {
      picked.push({ url, lastmod, reason: "new" });
      continue;
    }
    const prev = oldUrls.get(url);
    if (sameLastmod(prev, lastmod)) continue;
    picked.push({ url, lastmod, prev, reason: "changed" });
    const tp = toMs(prev);
    const tn = toMs(lastmod);
    if (tp !== null && tn !== null && tn < tp) older++;
    else newer++;
  }
  let removed = 0;
  for (const url of oldUrls.keys()) if (!newUrls.has(url)) removed++;
  picked.sort(byPriority);
  return { picked, newer, older, removed };
}

function recentOnly(newUrls, days, now = Date.now()) {
  const since = now - days * 86400000;
  const picked = [];
  for (const [url, lastmod] of newUrls) {
    const t = toMs(lastmod);
    // 沒 lastmod 的（about / tags 等）判斷不了新舊，fallback 模式一律不推
    if (t !== null && t >= since && t <= now + 3600000) {
      picked.push({ url, lastmod, reason: "recent" });
    }
  }
  picked.sort(byPriority);
  return picked;
}

// ─── 金鑰 ─────────────────────────────────────────────────────────────
function findKey(distDir) {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY.trim();
  for (const name of readdirSync(distDir)) {
    const m = name.match(/^([a-zA-Z0-9-]{8,128})\.txt$/);
    if (!m) continue;
    try {
      if (readFileSync(path.join(distDir, name), "utf8").trim() === m[1]) return m[1];
    } catch {
      /* 讀不到就看下一個 */
    }
  }
  return null;
}

const mask = key => `${key.slice(0, 6)}…（共 ${key.length} 字）`;

async function checkKeyLocation(keyLocation, key) {
  try {
    const body = (await httpGet(keyLocation, 15000)).trim();
    if (body === key) log("keyLocation 線上驗證檔 OK");
    else warn("keyLocation 內容跟金鑰對不上，IndexNow 可能回 403");
  } catch (err) {
    // 錯誤訊息裡有完整網址（含金鑰），照 log 只印遮罩版的規矩換掉
    warn(`keyLocation 抓不到（${String(err.message).replaceAll(key, "<key>")}），IndexNow 可能回 403`);
  }
}

// ─── 推送 ─────────────────────────────────────────────────────────────
async function submit(payload) {
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": UA,
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const text = (await res.text().catch(() => "")).slice(0, 300);
      // 429 / 5xx 等一下再試一次；4xx 是請求本身有問題，重試沒用
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        warn(`HTTP ${res.status}，5 秒後重試一次`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return { status: res.status, ok: res.status === 200 || res.status === 202, text };
    } catch (err) {
      if (attempt < 2) {
        warn(`連線失敗（${err.message}），5 秒後重試一次`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return { status: -1, ok: false, text: String(err?.message ?? err) };
    }
  }
  return { status: -1, ok: false, text: "unreachable" };
}

const REASON = { new: "新", changed: "改", recent: "近" };

const STATUS_HINT = {
  200: "成功",
  202: "已收到（金鑰驗證中，也算成功）",
  400: "請求格式錯誤",
  403: "金鑰無效（keyLocation 抓不到或內容不符）",
  422: "網址不屬於這個 host，或金鑰對不上",
  429: "推太頻繁被限流",
};

function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, lines.join("\n") + "\n");
  } catch {
    /* summary 寫不進去不影響主流程 */
  }
}

const pretty = u => {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
};

// ─── 主流程 ───────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 模式一：部署前只抓線上 sitemap 存檔
  if (opts.snapshot) {
    let site = FALLBACK_SITE;
    try {
      site = readDistIndex(opts.dist).site;
    } catch {
      /* dist 還沒 build 也能抓，用預設網域 */
    }
    const snap = await fetchLiveSitemap(site);
    writeFileSync(opts.snapshot, snapshotToJson(snap));
    if (snap.ok) log(`已存線上 sitemap 舊版：${snap.urls.size} 筆 → ${opts.snapshot}`);
    else warn(`線上 sitemap 抓不到（${snap.error}），部署後會改用「最近 ${opts.fallbackDays} 天 lastmod」模式`);
    return;
  }

  // 模式二：比對 + 推送（或 dry-run）
  const { site, urls: newUrls } = await loadDistSitemap(opts.dist);
  const host = new URL(site).host;
  log(`dist sitemap：${newUrls.size} 筆（${site}）`);

  const old = opts.old ? loadSnapshotFile(opts.old) : await fetchLiveSitemap(site);
  let picked;
  let mode;
  if (old.ok && new URL(old.site ?? site).host === host) {
    const d = diffSitemaps(old.urls, newUrls);
    picked = d.picked;
    mode = "diff";
    const added = picked.filter(p => p.reason === "new").length;
    log(
      `比對模式：線上舊版 ${old.urls.size} 筆（抓取 ${old.fetchedAt}）→ 新網址 ${added}、lastmod 變了 ${d.newer + d.older}` +
        (d.older ? `（其中 ${d.older} 筆是 dist 比線上舊，本機 dist 過期才會這樣）` : "") +
        `；線上有但這次消失 ${d.removed} 筆（不推）`
    );
    // 保險：比對出來超過一半網址都要推，多半是比對基準壞了（網址格式改版、lastmod 算法改了、
    // 舊版其實是別的站），不是真的整站都改了 → 改走 fallback，不整站推。
    // 真的要整站推一次（例如第一次讓 Bing 收錄全站）請手動處理，不要靠部署自動推。
    if (picked.length > BULK_MIN && picked.length > newUrls.size * BULK_RATIO) {
      warn(
        `比對結果要推 ${picked.length}/${newUrls.size} 筆（超過 ${BULK_RATIO * 100}%），判定比對基準不可靠 → 改推最近 ${opts.fallbackDays} 天`
      );
      picked = recentOnly(newUrls, opts.fallbackDays);
      mode = "fallback";
    }
  } else {
    picked = recentOnly(newUrls, opts.fallbackDays);
    mode = "fallback";
    warn(`舊版不可用（${old.error ?? "網域不同"}）→ 只推 lastmod 在最近 ${opts.fallbackDays} 天內的網址`);
  }

  picked = picked.filter(p => {
    try {
      return new URL(p.url).host === host;
    } catch {
      return false;
    }
  });
  const total = picked.length;
  if (total > MAX_URLS) {
    warn(`要推 ${total} 筆超過上限，只推最前面 ${MAX_URLS} 筆`);
    picked = picked.slice(0, MAX_URLS);
  }

  log(`要推 ${picked.length} 筆${opts.dryRun ? "（dry-run，不打 API）" : ""}`);
  for (const p of picked.slice(0, opts.show)) {
    const tagText = REASON[p.reason];
    const lm = p.reason === "changed" ? `${p.prev ?? "無"} → ${p.lastmod ?? "無"}` : p.lastmod ?? "無 lastmod";
    console.log(`  [${tagText}] ${pretty(p.url)}  (${lm})`);
  }
  if (picked.length > opts.show) console.log(`  …其餘 ${picked.length - opts.show} 筆略`);

  const head = [`### IndexNow（${mode === "diff" ? "sitemap 比對" : `最近 ${opts.fallbackDays} 天 fallback`}）`];

  if (picked.length === 0) {
    log("0 筆，不打 API");
    summary([...head, "", "沒有新增或變動的網址，未推送。"]);
    return;
  }

  const key = findKey(opts.dist);
  if (!key) {
    warn("dist 根目錄找不到 IndexNow 驗證檔（<key>.txt，內容＝檔名），也沒設 INDEXNOW_KEY，跳過推送");
    summary([...head, "", `⚠️ 找不到金鑰，${picked.length} 筆沒推。`]);
    return;
  }
  const keyLocation = `${site}/${key}.txt`;
  log(`金鑰 ${mask(key)}，keyLocation ${site}/<key>.txt`);

  if (opts.dryRun) {
    await checkKeyLocation(keyLocation, key);
    log("dry-run 結束，沒有推送");
    return;
  }

  await checkKeyLocation(keyLocation, key);
  const res = await submit({
    host,
    key,
    keyLocation,
    urlList: picked.map(p => p.url),
  });
  const hint =
    STATUS_HINT[res.status] ??
    (res.status === -1 ? "連線失敗" : res.status >= 500 ? "IndexNow 伺服器錯誤" : "非預期狀態");
  if (res.ok) log(`✅ 推送 ${picked.length} 筆 → HTTP ${res.status} ${hint}`);
  else warn(`推送 ${picked.length} 筆失敗 → HTTP ${res.status} ${hint}${res.text ? `｜${res.text}` : ""}`);

  summary([
    ...head,
    "",
    `${res.ok ? "✅" : "⚠️"} 推送 ${picked.length} 筆 → HTTP ${res.status}：${hint}`,
    "",
    ...picked.slice(0, 50).map(p => `- ${REASON[p.reason]}｜${pretty(p.url)}`),
    ...(picked.length > 50 ? [`- …其餘 ${picked.length - 50} 筆略`] : []),
  ]);
}

// 不用 process.exit(0)：Windows 管線上 stdout 是非同步寫，硬 exit 會截斷 log
process.on("unhandledRejection", err => {
  warn(`未預期錯誤，略過 IndexNow（不影響部署）：${err?.stack ?? err}`);
  process.exitCode = 0;
});
// 自己的總時限，比 deploy.yml 的 step timeout（2 分 / 3 分）短：時間到就自己收工 exit 0。
// 不靠 GitHub 砍 step —— 被砍的 step 是紅 X，萬一拖到 job 的 15 分鐘上限就整條部署變紅。
// 故意不 unref：萬一有 promise 永遠不 settle、又沒有別的 handle 撐著，Node 會以
// exit 13（unsettled top-level await）結束；有這個計時器撐著就會走到下面的 exit 0。
// 正常跑完在 finally 清掉，不會多等。
const DEADLINE_MS = process.argv.includes("--snapshot") ? 60_000 : 150_000;
const watchdog = setTimeout(() => {
  warn(`超過 ${DEADLINE_MS / 1000} 秒還沒跑完，放棄這次 IndexNow（不影響部署）`);
  process.exit(0);
}, DEADLINE_MS);
try {
  await main();
} catch (err) {
  warn(`未預期錯誤，略過 IndexNow（不影響部署）：${err?.stack ?? err}`);
} finally {
  clearTimeout(watchdog);
}
process.exitCode = 0;
