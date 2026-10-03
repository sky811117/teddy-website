#!/usr/bin/env node
/* eslint-disable no-console -- CLI 腳本，輸出就是給人看的 */
/**
 * /shorts/ 影片清單同步（2026-10-04，SEO/GEO 台帳 X031-C）
 *
 * 從本機影片產線的兩個檔產出 src/data/videos.generated.json，給 src/pages/shorts.astro 的
 * 「最新物件短影音」區塊用。兩個來源只讀不改：
 *   - 房仲工作站\420_IG_API\video_registry.json   ← 三平台實際狀態（video_registry.py sync 維護）
 *   - 房仲工作站\420_IG_API\video_schedule.json   ← 發片排程（只拿來補日期、排除 cancelled）
 *
 * ⛔ CI（GitHub Actions）讀不到房仲工作站，所以這支只在本機跑，產物 videos.generated.json 要 commit。
 *    來源檔不存在時印一行就 exit 0，不會擋任何流程。
 *
 * 收錄條件（全部要過）：
 *   1. registry 的 delisted !== true（在不在架只看這個欄位，由 video_delist.py 維護；
 *      不要拿 src/content/properties 的 status 去對，委編大多沒填）
 *   2. platforms.yt.state === "公開"（YouTube 公開才能站內播放）
 *   3. 有日期（registry date，沒有就用 schedule 裡同一支 YT 的排程日）且 >= --since（預設 2026-07-01）
 *      → 7 月以前的舊片標題沒標準化，下架流程配對不到，物件在不在架無法自動確認
 *   4. 標題是標準格式「台中XX｜…｜…」→ 外縣市先不收（等景泰回答外縣市那題）、非物件片不收
 *   5. schedule 被 cancelled 的同一支不收（例：「物件沒賣了，不補發」）
 *   6. 標題過官網共用詞表（src/utils/cleanPropertyTitle.ts，跟 audit-properties.mjs／text_sanitize.py／
 *      450 staging_quality.py 同源）：未完工建設、誇大、漲跌預測、假第一人稱、夏田園區、非綠線區捷運宣稱，
 *      另擋「預售」、門牌巷弄號 → 命中就整支不收（不改寫標題）
 *   7. 同一物件（區＋標題第二段）多支只留最新一支
 *   8. （2026-10-04 修正者加）必須對得到官網物件：用「區＋社區名／路名＋總價」對 src/content/properties/*.md，
 *      對到而且 status: active 才收；對到但全是 withdrawn／sold → 不收（官網已下架，不能再廣告）；
 *      對不到任何一筆 → 預設不收，試算時列成「待景泰確認」清單（在不在架、承辦人都沒驗證過）
 *   9. 排除名單：對到的物件委編在 EXCLUDE_LISTING_CODES，或社區名在 EXCLUDE_COMMUNITIES → 不收。
 *      委編名單 = 寫死的基本名單 ＋ 每次執行時唯讀列 NAS「26.汎汎」夾名裡的委編（沾到戴菲汎就不廣告）；
 *      NAS 連不到只用寫死名單並印 WARN
 *
 * 用法：
 *   node scripts/sync-videos.mjs              # 試算：印出會收哪些、排除哪些，不寫檔
 *   node scripts/sync-videos.mjs --write      # 寫 src/data/videos.generated.json
 *   node scripts/sync-videos.mjs --since 2026-08-01
 *   環境變數 VIDEO_REGISTRY / VIDEO_SCHEDULE 可指定來源路徑
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";
import {
  hasExaggeration,
  offlineMrtSegment,
  UNBUILT_TITLE_PLACE_SOURCE,
} from "../src/utils/cleanPropertyTitle.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "videos.generated.json");
const IG_API = path.join(homedir(), "房仲工作站", "420_IG_API");
const REGISTRY = process.env.VIDEO_REGISTRY || path.join(IG_API, "video_registry.json");
const SCHEDULE = process.env.VIDEO_SCHEDULE || path.join(IG_API, "video_schedule.json");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const sinceIdx = args.indexOf("--since");
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : "2026-07-01";
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE || "")) {
  console.error(`[sync-videos] --since 要寫成 YYYY-MM-DD，收到：${SINCE}`);
  process.exit(2);
}

if (!existsSync(REGISTRY)) {
  console.log(`[sync-videos] 找不到 ${REGISTRY}（不是本機或路徑變了），略過，不動 ${path.relative(ROOT, OUT)}`);
  process.exit(0);
}

const readJson = p => JSON.parse(readFileSync(p, "utf-8").replace(/^﻿/, ""));
const registry = readJson(REGISTRY);
const schedule = existsSync(SCHEDULE) ? readJson(SCHEDULE) : [];
const entries = Array.isArray(registry?.entries) ? registry.entries : [];
if (!entries.length) {
  console.error("[sync-videos] registry 沒有 entries，格式可能變了，停止（不寫檔）");
  process.exit(1);
}

const YT_ID_RE = /(?:shorts\/|watch\?v=|youtu\.be\/)([\w-]{11})/;
const ytIdOf = link => (String(link || "").match(YT_ID_RE) || [])[1] || "";

// schedule：YT id → 排程日；cancelled 的 key（正規化後）
const norm = s => String(s || "").replace(/[\s_｜|()（）【】\-—→]/g, "").replace(/泰迪$/, "");
const scheduleDateByYt = new Map();
const cancelledKeys = new Set();
for (const s of Array.isArray(schedule) ? schedule : []) {
  if (s?.status === "cancelled") {
    cancelledKeys.add(norm(s.folder || s.key));
    continue;
  }
  const ids = [ytIdOf(s?.results?.YT?.link), s?.yt_video_id].filter(Boolean);
  for (const id of ids) if (!scheduleDateByYt.has(id)) scheduleDateByYt.set(id, s.date);
}

const STD_TITLE_RE = /^台中(\S{2,3}?)｜([^｜]+)｜/;
// 門牌：路街段後面接數字巷弄號、或「N巷N弄／N巷N號」；「市政1號院」這種社區名不算
const ADDRESS_RE = /(?:路|街|大道|段)\s*\d+\s*(?:巷|弄|號)|\d+\s*巷\s*\d+\s*(?:弄|號)|\d+\s*弄\s*\d+\s*號/;
const PRESALE_RE = /預售/;
const PLACE_RE = new RegExp(UNBUILT_TITLE_PLACE_SOURCE);

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/^[（(][^）)]*[）)]/, "") // 「(改封面標題)」「(優先)」這類內部前綴
    .replace(/[-－\s]*泰迪\s*$/, "") // 檔名尾巴的「-泰迪」「泰迪」
    .replace(/^[｜\s]+|[｜\s]+$/g, "")
    .trim();
}

function districtOf(short) {
  // 「北屯」→「北屯區」；「西區」「東區」本身已帶區
  return short.endsWith("區") ? short : `${short}區`;
}

// ── 8. 官網物件對照 ───────────────────────────────────────────────
const PROPERTIES_DIR = path.join(ROOT, "src", "content", "properties");
function readFrontmatter(file) {
  const raw = readFileSync(file, "utf-8").replace(/^﻿/, "");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const get = key => {
    const m = fm[1].match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  return {
    file: path.basename(file),
    listingCode: get("listingCode") || path.basename(file, ".md"),
    title: get("title"),
    district: get("district"),
    streetArea: get("streetArea"),
    community: get("community"),
    layout: get("layout"),
    totalPrice: Number(get("totalPrice")) || 0,
    status: get("status"),
  };
}
const properties = existsSync(PROPERTIES_DIR)
  ? readdirSync(PROPERTIES_DIR)
      .filter(f => f.endsWith(".md"))
      .map(f => readFrontmatter(path.join(PROPERTIES_DIR, f)))
      .filter(Boolean)
  : [];
if (!properties.length) {
  console.error("[sync-videos] 讀不到 src/content/properties/*.md，無法對照在架狀態，停止（不寫檔）");
  process.exit(1);
}

// ── 9. 排除名單 ──────────────────────────────────────────────────
// 基本名單（2026-10-04 審查抓到）：日月觀學 UG1211190／UG1211227 放在 NAS 26.汎汎 銷售夾，且官網已 withdrawn
const EXCLUDE_LISTING_CODES = new Set(["1211190", "1211227"]);
const EXCLUDE_COMMUNITIES = ["日月觀學"];
const FEIFAN_NAS_DIR = process.env.FEIFAN_NAS_DIR || String.raw`\\Hbnas\h&b共用\26.汎汎`;
const CASE_CODE_RE = /[A-Z]{2}(\d{7})/g;
function scanCaseCodes(dir, depth) {
  // 只列資料夾名稱（唯讀），不開任何檔案
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
  } catch {
    return depth === 0 ? null : [];
  }
  const codes = [];
  for (const d of names) {
    for (const m of d.name.matchAll(CASE_CODE_RE)) codes.push(m[1]);
    if (depth < 2) codes.push(...(scanCaseCodes(path.join(dir, d.name), depth + 1) || []));
  }
  return codes;
}
const feifanCodes = scanCaseCodes(FEIFAN_NAS_DIR, 0);
if (feifanCodes === null) {
  console.warn(`[sync-videos] WARN 連不到 ${FEIFAN_NAS_DIR}，只用寫死的排除名單（${EXCLUDE_LISTING_CODES.size} 筆）`);
} else {
  for (const c of feifanCodes) EXCLUDE_LISTING_CODES.add(c);
  console.log(`[sync-videos] 排除名單：NAS 26.汎汎 委編 ${new Set(feifanCodes).size} 筆＋寫死名單，共 ${EXCLUDE_LISTING_CODES.size} 筆`);
}

const normName = s =>
  String(s || "")
    .replace(/[\s　·・\-－_()（）【】「」]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

/** 價格段 → 候選總價（萬）。「1388萬→1350萬」兩個都算；「3800~3980萬」算區間；「4億5000萬」= 45000 */
function parsePrices(seg) {
  const s = String(seg || "");
  if (!/[萬億]/.test(s)) return { values: [], range: null };
  const toWan = t => {
    const m = t.match(/(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)萬?)?/);
    return (m && (Number(m[1] || 0) * 10000 + Number(m[2] || 0))) || 0;
  };
  const range = s.match(/(\d+)\s*[~～-]\s*(\d+)\s*萬/);
  if (range) return { values: [], range: [Number(range[1]), Number(range[2])] };
  const values = s
    .split(/→|->/)
    .map(t => toWan(t.trim()))
    .filter(n => n > 0);
  return { values, range: null };
}
const priceHit = (p, prices) =>
  p > 0 &&
  (prices.values.includes(p) || (prices.range && p >= prices.range[0] && p <= prices.range[1]));

const ROAD_RE = /([一-鿿]{1,4}(?:路|街|大道))/;
const ROOMS_RE = /(\d+)房/;

/** 回傳對得到的官網物件（可能多筆）；第二段是格局時改用「區＋總價＋房數」 */
function matchProperties(title, district, second, looksLayout) {
  const segs = title.split("｜");
  const prices = parsePrices(segs[segs.length - 1]);
  if (!prices.values.length && !prices.range) return [];
  const sameDistrict = properties.filter(p => p.district === district && priceHit(p.totalPrice, prices));
  if (looksLayout) {
    const rooms = (title.match(ROOMS_RE) || [])[1];
    return rooms ? sameDistrict.filter(p => (p.layout.match(ROOMS_RE) || [])[1] === rooms) : [];
  }
  const key = normName(second);
  const road = (second.match(ROAD_RE) || [])[1];
  return sameDistrict.filter(p => {
    const c = normName(p.community);
    if (c.length >= 2 && key.length >= 2 && (c.includes(key) || key.includes(c))) return true;
    if (normName(p.title).includes(key) && key.length >= 3) return true;
    if (road && (p.streetArea.includes(road) || p.title.includes(road))) return true;
    return false;
  });
}
const unmatched = [];

const kept = [];
const skipped = [];
for (const e of entries) {
  const title = cleanTitle(e.title);
  const yt = e?.platforms?.yt || {};
  const videoId = yt.id || ytIdOf(yt.link);
  const why = [];
  if (e.delisted === true) why.push("delisted");
  if (yt.state !== "公開" || !videoId) why.push(`YT=${yt.state ?? "無"}`);
  const date = e.date || scheduleDateByYt.get(videoId) || "";
  if (!date) why.push("沒有日期");
  else if (date < SINCE) why.push(`早於 ${SINCE}`);
  const m = title.match(STD_TITLE_RE);
  if (!m) why.push("非標準台中物件標題");
  if (cancelledKeys.has(norm(e.title)) || cancelledKeys.has(norm(title))) why.push("排程 cancelled");
  const district = m ? districtOf(m[1]) : "";
  if (hasExaggeration(title)) why.push("共用詞表命中（未完工建設／誇大／預測／假第一人稱）");
  if (PLACE_RE.test(title)) why.push("開發中園區");
  if (title.split("｜").some(seg => offlineMrtSegment(seg, district))) why.push("非綠線區捷運宣稱");
  if (PRESALE_RE.test(title)) why.push("預售");
  if (ADDRESS_RE.test(title)) why.push("門牌巷弄號");

  // 8／9. 官網物件對照＋排除名單（只在前面都過了才對，省得舊片也去對）
  const second = m ? m[2].trim() : "";
  // 第二段是格局（3房2廳2衛）或「三房兩廳」這類敘述就不當社區名
  const looksLayout = /\d+房|[一二三四五六七八九十兩]房|廳|坪|格局/.test(second);
  let matchedCodes = [];
  if (!why.length) {
    if (EXCLUDE_COMMUNITIES.some(c => title.includes(c))) why.push("排除名單（社區）");
    const hits = matchProperties(title, district, second, looksLayout);
    matchedCodes = hits.map(p => p.listingCode);
    if (!hits.length) {
      why.push("對不到官網物件（待景泰確認）");
      unmatched.push({ date, title, videoId });
    } else if (hits.some(p => EXCLUDE_LISTING_CODES.has(p.listingCode))) {
      why.push(`排除名單（委編 ${hits.filter(p => EXCLUDE_LISTING_CODES.has(p.listingCode)).map(p => p.listingCode).join("、")}）`);
    } else if (!hits.some(p => p.status === "active")) {
      why.push(`官網物件已下架（${hits.map(p => `${p.listingCode}=${p.status || "無狀態"}`).join("、")}）`);
    }
  }

  // 只記錄「曾經公開、近期」的排除原因，舊片／已下架太多不印
  if (why.length) {
    if (!why.includes("delisted") && yt.state === "公開" && date >= SINCE) skipped.push({ date, title, why });
    continue;
  }
  kept.push({
    id: `yt-${videoId}`,
    platform: "youtube",
    videoId,
    url: `https://www.youtube.com/shorts/${videoId}`,
    title,
    category: "看屋開箱",
    district,
    ...(looksLayout ? {} : { community: second }),
    pubDate: date,
    listingCodes: matchedCodes,
    // 同物件判定：去掉最後一段價格（改價「1388萬→1350萬」仍算同一戶），其餘段落都要一樣；
    // 第二段只是格局、沒有社區名時無從分辨，連最終價格一起比（寧可重複，不誤殺別戶）
    _dedupeKey: looksLayout ? `${title.replace(/[^｜]*→/, "")}` : title.split("｜").slice(0, -1).join("｜"),
  });
}

// 同物件只留最新
kept.sort((a, b) => (a.pubDate < b.pubDate ? 1 : a.pubDate > b.pubDate ? -1 : 0));
const seen = new Set();
const videos = [];
for (const v of kept) {
  if (seen.has(v._dedupeKey)) {
    skipped.push({ date: v.pubDate, title: v.title, why: ["同物件較舊的一支"] });
    continue;
  }
  seen.add(v._dedupeKey);
  const { _dedupeKey, ...rest } = v;
  videos.push(rest);
}

const out = {
  generatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).replace(" ", "T") + "+08:00",
  source: { registrySyncedAt: registry.synced_at || "", since: SINCE },
  count: videos.length,
  videos,
};

console.log(`[sync-videos] registry ${entries.length} 筆（synced_at ${registry.synced_at || "?"}）→ 收 ${videos.length} 支（since ${SINCE}）`);
for (const v of videos) console.log(`  + ${v.pubDate} ${v.title}`);
if (skipped.length) {
  console.log(`[sync-videos] 近期公開但排除 ${skipped.length} 支：`);
  for (const s of skipped) console.log(`  - ${s.date} ${s.title} ← ${s.why.join("、")}`);
}

if (unmatched.length) {
  console.log(`[sync-videos] ⚠️ 對不到官網物件、預設不收的 ${unmatched.length} 支（在不在架、承辦人沒驗證，要收請景泰確認）：`);
  for (const u of unmatched) console.log(`  ? ${u.date} ${u.title}  https://www.youtube.com/shorts/${u.videoId}`);
}

if (!WRITE) {
  console.log("[sync-videos] 試算模式，沒寫檔；要寫請加 --write");
  process.exit(0);
}
const next = JSON.stringify(out, null, 2) + "\n";
if (existsSync(OUT)) {
  const prev = readJson(OUT);
  if (JSON.stringify(prev.videos) === JSON.stringify(out.videos)) {
    console.log("[sync-videos] 清單沒變，不重寫（避免只因 generatedAt 產生 diff）");
    process.exit(0);
  }
}
writeFileSync(OUT, next, "utf-8");
console.log(`[sync-videos] 已寫入 ${path.relative(ROOT, OUT)}`);
