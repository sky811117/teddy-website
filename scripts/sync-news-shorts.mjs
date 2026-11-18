#!/usr/bin/env node
/* eslint-disable no-console -- CLI 腳本，輸出就是給人看的 */
/**
 * /shorts/news/ 房市新聞短影音清單同步（2026-11-18）
 *
 * 從本機新聞片產線讀每一集，產出 src/data/news-shorts.generated.json。來源只讀不改。
 * CI 讀不到本機產線，所以這支只在本機跑（夜間流程 6.7），產物要 commit；來源不存在時印一行就 exit 0。
 *
 * 收錄條件（全部要過）：
 *   1. IG 已發（published.json）、YouTube 已公開（youtube.json status=done）、沒有 HOLD.txt
 *   2. 片子裡沒有新聞台畫面（youtube.json 走到 done 就已經過這關）
 *   3. 文字沒有物件銷售或委託字眼：新聞頁一提到物件就變廣告
 * 未完工建設：新聞照新聞用語可以寫，但 hubSafe=false，不上有物件的專區首頁。
 *
 * 用法：node scripts/sync-news-shorts.mjs          # 試算，不寫檔
 *       node scripts/sync-news-shorts.mjs --write  # 寫檔
 *       環境變數 NEWS_SHORTS_DIR 可指定 episodes 路徑
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UNBUILT_RE } from "../src/utils/cleanPropertyTitle.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "news-shorts.generated.json");
const POSTS_DIR = path.join(ROOT, "src", "content", "posts");
const EPISODES =
  process.env.NEWS_SHORTS_DIR || path.join(homedir(), "房仲工作站", "ai_realestate_account", "episodes");
const WRITE = process.argv.includes("--write");

if (!existsSync(EPISODES)) {
  console.log(`[sync-news-shorts] 找不到新聞片產線（不是本機或路徑變了），略過`);
  process.exit(0);
}

const readJson = p => {
  try {
    return JSON.parse(readFileSync(p, "utf-8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const readText = p => (existsSync(p) ? readFileSync(p, "utf-8").replace(/^﻿/, "") : "");

const AD_RE = /委託|帶看|在售|開價|總價\s*\d|歡迎.{0,6}(?:買賣|賞屋|看屋)|社區.{0,4}(?:熱銷|完銷)/;

function categoryOf(d) {
  const s = `${d.category || ""} ${d.topic || ""} ${(d.keywords || []).join(" ")}`;
  if (/租金|租屋|社宅|社會住宅/.test(s)) return "租屋";
  if (/房貸|貸款|利率|央行|寬限期|新青安|負擔率/.test(s)) return "貸款";
  if (/實價|行情|坪|房價|成交|買氣|移轉/.test(s)) return "台中行情";
  return "政策補助";
}

function slugOf(folder) {
  const m = folder.match(/^(\d{4})(\d{2})(\d{2})_(.+)$/);
  if (!m) return folder.replace(/_/g, "-").toLowerCase();
  return `${m[4].replace(/_/g, "-").toLowerCase()}-${m[1]}-${m[2]}-${m[3]}`;
}

function parseCaption(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const firstBlank = lines.findIndex(l => !l);
  const hook = lines.slice(0, firstBlank < 0 ? 3 : firstBlank).join("");
  const points = lines
    .filter(l => l.startsWith("📍"))
    .map(l => l.replace(/^📍\s*/, "").replace(/\s*[：:]\s*/, "：").trim());
  const sources = [
    ...new Set(lines.filter(l => l.startsWith("📌")).map(l => l.replace(/^📌\s*(?:資料來源[：:])?\s*/, "").trim())),
  ];
  return { hook, points, sources };
}

function parseNarration(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.replace(/^s\d+\s+/i, "").trim())
    .filter(Boolean);
  // 最後一句是互動與追蹤，網頁上不需要
  if (lines.length && /留言|追蹤泰迪/.test(lines[lines.length - 1])) lines.pop();
  return lines;
}

// 同題文章：前後 10 天內的新聞文，共用一個精確數字，或標題描述命中兩個以上關鍵字；社區文是廣告，不連
function loadPosts() {
  if (!existsSync(POSTS_DIR)) return [];
  return readdirSync(POSTS_DIR)
    .filter(f => /\.mdx?$/.test(f))
    .map(f => {
      const raw = readText(path.join(POSTS_DIR, f));
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
      const get = k => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
      return {
        slug: get("slug") || f.replace(/\.mdx?$/, ""),
        title: get("title"),
        description: get("description"),
        date: get("pubDatetime").slice(0, 10),
        community: get("community"),
        draft: get("draft") === "true",
        isNews: /房市新聞|市場觀察/.test(fm),
      };
    })
    .filter(p => p.date && !p.draft && !p.community && p.isNews);
}
const posts = loadPosts();
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

function relatedPost(item, keywords) {
  const nums = new Set(`${item.title} ${item.points.join(" ")}`.match(/\d+\.\d+/g) ?? []);
  let best = null;
  for (const p of posts) {
    if (dayDiff(p.date, item.date) > 10) continue;
    const hay = `${p.title} ${p.description}`;
    const numHit = [...nums].some(n => hay.includes(n));
    const kwHit = keywords.filter(k => k && k.length >= 2 && hay.includes(k)).length;
    const score = (numHit ? 10 : 0) + (kwHit >= 2 ? kwHit : 0);
    if (score > 0 && (!best || score > best.score)) best = { slug: p.slug, title: p.title, score };
  }
  return best ? { slug: best.slug, title: best.title } : null;
}

async function coverOf(id, prev) {
  if (prev === "oar2") return prev;
  try {
    const r = await fetch(`https://i.ytimg.com/vi_webp/${id}/oar2.webp`, {
      method: "HEAD",
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) return "oar2";
  } catch {
    /* 查不到就用備用封面，下一晚再查 */
  }
  return "hq";
}

const previous = readJson(OUT)?.items ?? [];
const prevCover = new Map(previous.map(i => [i.videoId, i.cover]));
const items = [];
const skipped = [];

for (const folder of readdirSync(EPISODES).sort()) {
  const ep = path.join(EPISODES, folder);
  if (!/^20\d{6}_/.test(folder)) continue;
  const d = readJson(path.join(ep, "ready.json"));
  const yt = readJson(path.join(ep, "youtube.json"));
  if (!d || !yt) continue;
  if (!existsSync(path.join(ep, "published.json")) || existsSync(path.join(ep, "HOLD.txt"))) continue;
  if (yt.status !== "done" || !yt.id) {
    skipped.push(`${folder}：YouTube ${yt.status}${yt.reason ? `（${yt.reason}）` : ""}`);
    continue;
  }
  const { hook, points, sources } = parseCaption(readText(path.join(ep, d.caption || "out/IG文案.txt")));
  const transcript = parseNarration(readText(path.join(ep, "narration_final.txt")));
  const title = String(d.title || "").trim();
  const text = [title, hook, ...points, ...transcript].join("\n");
  if (!title || !sources.length) {
    skipped.push(`${folder}：缺標題或資料來源`);
    continue;
  }
  if (AD_RE.test(text)) {
    skipped.push(`${folder}：文字有物件銷售字眼`);
    continue;
  }
  const item = {
    slug: slugOf(folder),
    title,
    description: hook.slice(0, 120),
    videoId: yt.id,
    url: `https://www.youtube.com/shorts/${yt.id}`,
    date: String(d.date),
    duration: Math.round(Number(d.duration) || 0),
    category: categoryOf(d),
    points,
    transcript,
    sources,
    hubSafe: !UNBUILT_RE.test(text),
    cover: await coverOf(yt.id, prevCover.get(yt.id)),
  };
  item.relatedPost = relatedPost(item, Array.isArray(d.keywords) ? d.keywords : []);
  items.push(item);
}
items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

console.log(`[sync-news-shorts] 收 ${items.length} 支`);
for (const i of items) console.log(`  + ${i.date} ${i.title}（${i.category}）${i.relatedPost ? ` → ${i.relatedPost.slug}` : ""}`);
for (const s of skipped) console.log(`  - ${s}`);
if (!WRITE) {
  console.log("[sync-news-shorts] 試算模式，沒寫檔；要寫請加 --write");
  process.exit(0);
}
if (JSON.stringify(previous) === JSON.stringify(items)) {
  console.log("[sync-news-shorts] 清單沒變，不重寫");
  process.exit(0);
}
writeFileSync(OUT, `${JSON.stringify({ count: items.length, items }, null, 2)}\n`, "utf-8");
console.log(`[sync-news-shorts] 已寫入 ${path.relative(ROOT, OUT)}`);
