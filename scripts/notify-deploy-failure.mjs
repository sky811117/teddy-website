#!/usr/bin/env node
/**
 * 官網部署失敗 → 推 TG「泰迪的小聲音」（2026-10-15 補的安全網）
 *
 * 為什麼要有：lint-seo（文章紅線）／audit-properties（物件法規）都會擋部署，
 * 每晚物件同步、IG 圖卡、每日新聞三條產線自動 push，只要一篇被擋整站就停在舊版，
 * 以前沒有任何通知，要等有人剛好去看 Actions 才知道。
 *
 * 由 .github/workflows/deploy.yml 的 notify-failure job 在 deploy job 失敗後呼叫：
 *   1. 查這次 run 的 commit 標題、哪一步失敗；下載 deploy job 的紀錄，抓出被擋的檔案
 *   2. 查同一支 workflow 在 main 上更早的紀錄，算「連續第幾次失敗」
 *   3. 防洗版：
 *      - 上一次成功、這次失敗（連續第 1 次）→ 推
 *      - 連續失敗，但卡住的步驟或被擋的檔案跟上一次不一樣 → 推（又多了新問題）
 *      - 跟上一次一模一樣 → 不推；每連續第 REMIND_EVERY 次（一天約 5 次部署 ≈ 一天一次）再提醒
 *      - 查歷史失敗（API 掛掉）→ 寧可多推一則，也不要漏
 *   4. TG 回 ok 而且拿到 message_id 才算送達；沒送到 exit 1（notify job 會變紅）
 *
 * 環境變數：
 *   TG_BOT_TOKEN、TG_CHAT_ID  Actions secrets（跟工作站 .env 同名，bot 是「泰迪的小聲音」）
 *   GITHUB_TOKEN              github.token，job 要有 actions: read（讀 run／job／紀錄）
 *   GITHUB_REPOSITORY、GITHUB_RUN_ID、GITHUB_API_URL、GITHUB_SERVER_URL  Actions 自帶
 *
 * 本機試跑（只印訊息、不送 TG）：
 *   GITHUB_TOKEN=$(gh auth token) node scripts/notify-deploy-failure.mjs --dry-run --run-id <某次失敗的 run id>
 *
 * 這支只用 Node 內建（fetch），不吃 node_modules：notify job 不裝套件，只 checkout 這一個檔。
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const argRunId = args.includes("--run-id") ? args[args.indexOf("--run-id") + 1] : "";

const REPO = process.env.GITHUB_REPOSITORY || "sky811117/teddy-website";
const RUN_ID = argRunId || process.env.GITHUB_RUN_ID || "";
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const SERVER = process.env.GITHUB_SERVER_URL || "https://github.com";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const TG_TOKEN = (process.env.TG_BOT_TOKEN || "").trim();
const TG_CHAT = (process.env.TG_CHAT_ID || "").trim();

const DEPLOY_JOB = "deploy"; // deploy.yml 裡被盯的 job（沒有 name: 所以 API 顯示的名字就是 job id）
const REMIND_EVERY = 5;
const MAX_ITEMS = 5;

// 步驟名稱 → 白話。比對用「包含」，deploy.yml 改步驟名時這裡要跟著改（對不到就直接顯示原名）。
const STEP_PLAIN = [
  ["leak denylist", "洩漏檢查用的禁字清單沒設好（要到 GitHub 設定補）", false],
  ["Content lint", "文章紅線檢查：有文章踩到禁寫規則", false],
  ["Property audit", "物件法規檢查：有物件內容踩到法規紅線", false],
  ["Checkout", "準備環境時出錯", true],
  ["Setup", "準備環境時出錯", true],
  ["Install dependencies", "安裝套件時出錯", true],
  ["OG thumbnails", "產生文章縮圖時出錯", false],
  ["cover thumbnails", "產生物件縮圖時出錯", false],
  ["Astro check", "網站格式檢查沒過（常見是文章開頭的欄位寫錯，例如日期、標籤）", false],
  ["Build site", "網站建置失敗", false],
  ["Pagefind", "站內搜尋建置失敗", false],
  ["Minify", "壓縮工具頁程式時出錯", false],
  ["Postbuild", "建置後整理（轉址、網站地圖）失敗", false],
  ["Verify build output", "建置完成後檢查發現缺檔", false],
  ["Leak audit", "洩漏檢查：網站上出現不該公開的字，或找房小幫手測試沒過", false],
  ["Deploy to Cloudflare", "上傳到 Cloudflare 時出錯", true],
];

const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function gh(path) {
  const r = await fetch(`${API}/repos/${REPO}${path}`, { headers: ghHeaders });
  if (!r.ok) throw new Error(`GitHub API ${path.split("?")[0]} 回 HTTP ${r.status}`);
  return r.json();
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

// job 紀錄：API 先回 302 轉到有時效的下載網址，下載那一跳不要帶 Authorization（儲存端會拒收）。
// job 剛結束時紀錄偶爾還沒備好，重試幾次；拿不到就回空字串（只是少了「被擋的檔案」那段）。
async function jobLog(jobId) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`${API}/repos/${REPO}/actions/jobs/${jobId}/logs`, { headers: ghHeaders, redirect: "manual" });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        const d = await fetch(r.headers.get("location"));
        if (d.ok) return await d.text();
      } else if (r.ok) {
        return await r.text();
      }
    } catch {
      /* 網路抖動，下一輪再試 */
    }
    await sleep(5000);
  }
  return "";
}

/** 從 deploy job 紀錄抓出「被擋的東西」：文章紅線、物件法規、洩漏檢查各自的錯誤行。 */
export function parseBlocked(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").replace(/\x1b\[[0-9;]*m/g, ""));
  const items = [];
  let inLintErrors = false;
  for (const l of lines) {
    // lint-seo.mjs：「## 🔴 ERROR (n)」底下一行一筆「- `檔案` · 訊息」，空行或下一個 ## 結束（WARNING 段同格式，不能收）
    if (/^## 🔴 ERROR/.test(l)) { inLintErrors = true; continue; }
    if (inLintErrors && (/^## /.test(l) || l.trim() === "")) inLintErrors = false;
    let m;
    if (inLintErrors && (m = l.match(/^- `([^`]+)` · (.+)$/))) { items.push({ key: m[1], what: m[2] }); continue; }
    // audit-properties.mjs：「  ✗ 檔案.md: 規則「命中」、…」
    if ((m = l.match(/^\s*✗ (\S+?\.mdx?): (.+)$/))) { items.push({ key: m[1], what: m[2] }); continue; }
    // build-safe.mjs：「build-safe ✖ 步驟名（退出碼 n）」
    if ((m = l.match(/^build-safe ✖ (.+?)(?:（退出碼.*）)?$/))) { items.push({ key: `build-safe:${m[1]}`, what: "" }); continue; }
  }
  return items;
}

function failedStepOf(job) {
  if (!job) return { step: "", cancelled: false };
  const s = (job.steps || []).find(x => x.conclusion === "failure");
  return { step: s ? s.name : "", cancelled: !s && job.conclusion === "cancelled" };
}

const signature = (failed, items) =>
  `${failed.cancelled ? "cancelled" : failed.step}|${[...new Set(items.map(i => i.key))].sort().join(",")}`;

async function analyseRun(runId) {
  const jobs = await gh(`/actions/runs/${runId}/jobs?filter=latest&per_page=50`);
  const job = (jobs.jobs || []).find(j => j.name === DEPLOY_JOB);
  const failed = failedStepOf(job);
  const items = job ? parseBlocked(await jobLog(job.id)) : [];
  return { failed, items };
}

const twTime = iso => {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 8 * 3600e3).toISOString();
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`;
};

function sourceLabel(run, title) {
  if (run?.event === "schedule") return "每日定時重建";
  if (run?.event === "workflow_dispatch") return "手動重新部署";
  if (/房市新聞/.test(title)) return "每日新聞產線";
  if (/IG/i.test(title) && /圖卡|cards?/i.test(title)) return "IG 圖卡產線";
  if (/properties sync/i.test(title)) return "每晚物件同步";
  if (/社區評價文|自動補稿/.test(title)) return "社區評價文補稿";
  return "手動更新";
}

function stepPlain(failed) {
  if (failed.cancelled) return { text: "跑超過時間被系統中止（或有人按了取消）", transient: true };
  if (!failed.step) return { text: "查不到是哪一步（請看詳細紀錄）", transient: false };
  const hit = STEP_PLAIN.find(([k]) => failed.step.toLowerCase().includes(k.toLowerCase()));
  return hit ? { text: hit[1], transient: hit[2] } : { text: failed.step, transient: false };
}

function itemLine(it) {
  if (it.key.startsWith("build-safe:")) return `・${it.key.slice("build-safe:".length)}`;
  const name = it.key.split("/").pop().replace(/\.mdx?$/, "");
  // lint 訊息是「類別: 細節 — 給 AI 看的修法」，TG 只留破折號前面那段
  let what = it.what.split(/\s*—\s/)[0].replace(/:\s*/, "：").trim();
  if (what.length > 70) what = `${what.slice(0, 70)}…`;
  return what ? `・${name}：${what}` : `・${name}`;
}

function buildMessage({ run, title, failed, items, streak, streakCapped, lastSuccess, reason, runUrl }) {
  const plain = stepPlain(failed);
  const out = ["⚠️ 官網這次沒有更新上線", ""];
  out.push(`更新內容：${title || "（查不到 commit 標題）"}`);
  out.push(`來源：${sourceLabel(run, title)}${run?.created_at ? `（${twTime(run.created_at)}）` : ""}`);
  out.push(`卡在：${plain.text}`);
  if (items.length) {
    out.push("被擋的檔案：");
    const shown = [...new Map(items.map(i => [i.key, i])).values()];
    for (const it of shown.slice(0, MAX_ITEMS)) out.push(itemLine(it));
    if (shown.length > MAX_ITEMS) out.push(`・…還有 ${shown.length - MAX_ITEMS} 筆`);
  }
  out.push("");
  if (streak === null) {
    out.push("（查不到之前的部署紀錄，不知道是連續第幾次）");
  } else {
    const n = streakCapped ? `${streak} 次以上` : `${streak} 次`;
    let line = `這是連續第 ${n}失敗`;
    if (streak > 1) line += reason === "changed" ? "，這次多了新的問題" : "，同一個問題還沒修好";
    if (lastSuccess) line += `；上一次成功上線是 ${twTime(lastSuccess.updated_at || lastSuccess.created_at)}`;
    out.push(`${line}。`);
  }
  out.push("線上網站沒有壞，還是上一次成功的版本；問題修好、重新推上去就會自動上線。");
  if (plain.transient) out.push("這類多半是暫時性的，到下面連結按「Re-run all jobs」重跑一次通常就好。");
  if (streak !== null && streak === 1) out.push(`同一個問題接下來不會每次都推，每連續 ${REMIND_EVERY} 次提醒一次。`);
  out.push("");
  out.push(`詳細紀錄：${runUrl}`);
  return out.join("\n");
}

async function sendTG(text) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
  });
  const body = await r.json().catch(() => ({}));
  const id = body?.ok ? body?.result?.message_id : null;
  if (!id) throw new Error(`TG 沒有回 message_id（HTTP ${r.status}${body?.description ? `：${body.description}` : ""}）`);
  return id;
}

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`); } catch { /* summary 寫不進去不影響通知 */ }
  }
}

async function main() {
  if (!RUN_ID) throw new Error("沒有 run id（GITHUB_RUN_ID 或 --run-id）");
  const runUrl = `${SERVER}/${REPO}/actions/runs/${RUN_ID}`;

  let run = null;
  try { run = await gh(`/actions/runs/${RUN_ID}`); } catch (e) { console.log(`::warning::${e.message}`); }
  const title = (run?.head_commit?.message || run?.display_title || "").split("\n")[0].trim();

  let cur = { failed: { step: "", cancelled: false }, items: [] };
  try { cur = await analyseRun(RUN_ID); } catch (e) { console.log(`::warning::讀這次的 job 失敗：${e.message}`); }

  // 連續失敗次數：只看 main、同一支 workflow、比這次早建立、已跑完的；取消／略過的不算成功也不算失敗
  let streak = null, streakCapped = false, lastSuccess = null, prevFail = null;
  try {
    if (!run) throw new Error("沒有 run 資料");
    const created = encodeURIComponent(`<${run.created_at}`);
    const hist = await gh(`/actions/workflows/${run.workflow_id}/runs?branch=main&status=completed&per_page=50&created=${created}`);
    streak = 1;
    let foundSuccess = false;
    for (const r of hist.workflow_runs || []) {
      if (r.id === run.id) continue;
      if (r.conclusion === "success") { lastSuccess = r; foundSuccess = true; break; }
      if (["failure", "timed_out", "startup_failure"].includes(r.conclusion)) {
        streak++;
        if (!prevFail) prevFail = r;
      }
    }
    if (!foundSuccess && (hist.workflow_runs || []).length >= 50) streakCapped = true;
  } catch (e) {
    console.log(`::warning::查歷史部署失敗（照樣推）：${e.message}`);
  }

  const sig = signature(cur.failed, cur.items);
  let notify = true, reason = "first";
  if (streak !== null && streak > 1) {
    let prevSig = null;
    try {
      if (prevFail) {
        const prev = await analyseRun(prevFail.id);
        prevSig = signature(prev.failed, prev.items);
      }
    } catch (e) {
      console.log(`::warning::讀上一次失敗的紀錄失敗（照樣推）：${e.message}`);
    }
    if (prevSig === null) reason = "unknown";
    else if (prevSig !== sig) reason = "changed";
    else if (streak % REMIND_EVERY === 0) reason = "remind";
    else { notify = false; reason = "same"; }
  }

  console.log(`這次：${cur.failed.cancelled ? "被中止" : cur.failed.step || "（查不到步驟）"}，被擋 ${cur.items.length} 筆，連續第 ${streak ?? "?"} 次，判斷：${reason}`);
  if (!notify) {
    summary(`TG 通知：不推（跟上一次失敗的原因一樣，連續第 ${streak} 次；第 ${Math.ceil(streak / REMIND_EVERY) * REMIND_EVERY} 次會再提醒）`);
    return;
  }

  const text = buildMessage({ run, title, failed: cur.failed, items: cur.items, streak, streakCapped, lastSuccess, reason, runUrl });
  if (DRY_RUN) {
    console.log("----- 試跑，不送 TG -----");
    console.log(text);
    return;
  }
  if (!TG_TOKEN || !TG_CHAT) {
    // 訊息內容只有 commit 標題、步驟、檔名、連結（紀錄裡本來就公開的東西），印出來方便對照
    console.log("----- secrets 沒設，以下是本來要送的內容 -----");
    console.log(text);
    console.log("::error::GitHub Actions secrets TG_BOT_TOKEN／TG_CHAT_ID 沒設定，部署失敗通知送不出去。到 repo Settings → Secrets and variables → Actions 新增這兩個（值同工作站 .env；工作站 999_tools\\官網部署通知\\設定TG通知金鑰.py 可代勞）。");
    process.exit(1);
  }
  const messageId = await sendTG(text);
  summary(`TG 通知：已送達（message_id ${messageId}）`);
}

// 被 import（測試 parseBlocked）時不要自己跑起來
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.log(`::error::部署失敗通知沒送出：${e.message}`);
    process.exit(1);
  });
}
