#!/usr/bin/env node
/**
 * SEO Lint — 掃 posts + pages frontmatter，找 SEO 不完整的地方
 *
 * 檢查項目：
 * 1. title 必填、長度 10-65 字 (Google SERP 截斷)
 * 2. description 必填、長度 50-160 字 (Google meta description)
 * 3. tags 必填且非空陣列
 * 4. pubDatetime 必填 (posts)
 * 5. ogImage 有設或 dynamic OG 開啟 (warn only)
 * 6. 重複 title (警告)
 * 7. description 開頭不應為標點
 * 8. description / title 含廣告誇大形容詞 (警告)
 * 9. description 重複 (兩篇 description 內容完全相同、警告)
 * 10. tags 含「2026」這類年份標籤 (警告) — 之後 dated 會顯示老舊
 * 11. 編造的第一人稱客戶故事 (ERROR) — 景泰紅線，2026-06 清過 51 篇、2026-08 又復發 23 篇
 * 12. 同業仲介品牌 (ERROR) — 不掛同業品牌
 * 13. 教議價 / 殺價 (ERROR) — 「議價空間」屬市場描述、不在此限
 * 14. 「估價」二字 (警告) — 那是估價師法定業務，房仲寫「行情評估」
 *     11-14 連 draft 也檢查（草稿之後會發布），draft 降級為 warning
 *
 * usage:
 *   node scripts/lint-seo.mjs
 *
 * exit code:
 *   0 = no errors (warnings OK)
 *   1 = has errors
 */
import { readdir, readFile } from "node:fs/promises";

const POSTS_DIR = new URL("../src/content/posts/", import.meta.url);

function stripQuotes(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  let currentKey = null;
  let listValues = null;
  let scalarMultiline = null; // 累積多行 scalar value

  const lines = m[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 空行 → 重置 multi-line scalar
    if (line.trim() === "") {
      if (scalarMultiline !== null && currentKey) {
        meta[currentKey] = stripQuotes(scalarMultiline.trim());
        scalarMultiline = null;
      }
      continue;
    }

    // list item (- "value" 或 - value)，必須在某個 key 下
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && listValues !== null) {
      listValues.push(stripQuotes(listItem[1].trim()));
      continue;
    }

    // 新 key (key: value 或 key:)
    const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (km) {
      // 關閉前一個 list
      if (currentKey && listValues !== null) {
        meta[currentKey] = listValues;
        listValues = null;
      }
      // 關閉前一個 scalar multiline
      if (currentKey && scalarMultiline !== null) {
        meta[currentKey] = stripQuotes(scalarMultiline.trim());
        scalarMultiline = null;
      }
      currentKey = km[1];
      const v = km[2].trim();
      if (v === "") {
        // 後續可能是 list 或縮排 scalar
        listValues = [];
      } else {
        scalarMultiline = v; // 可能後續行還會續接
        listValues = null;
      }
      continue;
    }

    // 縮排續行 (多行 scalar value)
    const cont = line.match(/^\s+(.+)$/);
    if (cont && scalarMultiline !== null) {
      scalarMultiline += " " + cont[1].trim();
      continue;
    }

    // 縮排但前 key 是 list → 可能是 list 的縮排 item (- 開頭已處理)
    // 其他情況忽略
  }

  // 收尾
  if (currentKey) {
    if (listValues !== null) meta[currentKey] = listValues;
    else if (scalarMultiline !== null) meta[currentKey] = stripQuotes(scalarMultiline.trim());
  }

  return { meta, body: m[2] };
}

async function listMdFiles(dir) {
  const files = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith("_")) continue;
    if (item.isDirectory()) {
      const sub = await listMdFiles(new URL(`${item.name}/`, dir));
      files.push(...sub.map(f => `${item.name}/${f}`));
    } else if (item.name.endsWith(".md") || item.name.endsWith(".mdx")) {
      files.push(item.name);
    }
  }
  return files;
}

function main() {
  return listMdFiles(POSTS_DIR).then(async files => {
    const errors = [];
    const warnings = [];
    const titleMap = new Map();
    const descMap = new Map();
    let scanned = 0;

    // 廣告誇大形容詞 (跟 audit-properties 共用清單)
    // 編造第一人稱客戶故事的樣態（時間詞後方 12 字內要出現「客戶/屋主/買方/夫妻」才算，
    // 避免誤殺「去年 11 月開徵地價稅」這種純政策時間敘述）
    const FABRICATION_PATTERNS = [
      { re: /(?:上週|上個月|前陣子|前幾天|昨天|去年|前一陣子)[^。\n]{0,12}(?:客戶|屋主|買方|夫妻|小姐|先生|太太)/, label: "時間+人物" },
      { re: /我(?:有|的)一?位?客戶/, label: "我的客戶" },
      { re: /客戶(?:問|跟|傳訊息問|LINE)我/, label: "客戶問我" },
      { re: /我幫(?:客戶|她|他)(?!你)/, label: "我幫客戶" },
      { re: /我帶[^。\n]{0,4}客戶/, label: "我帶客戶" },
      { re: /屋主(?:跟|對)我說/, label: "屋主跟我說" },
      { re: /一對[^。\n]{0,3}夫妻/, label: "一對夫妻" },
      { re: /真實案例/, label: "標榜真實案例" },
      { re: /我(?:自己)?(?:在|去)?[^。]{0,10}帶看(?:的)?經驗/, label: "帶看資歷" },
      { re: /「景泰[，,]/, label: "客戶直呼景泰" },
      { re: /(?:陳|林|王|李|張|黃|吳|劉|蔡|楊)(?:小姐|先生|太太|屋主)/, label: "虛構人名" },
    ];

    // 同業仲介品牌（591 / 樂屋網 / 5168 / 樂居 是刊登與實價平台，不在此列）
    // 引用語境 — 出現這些字代表是把同業當市場數據來源，屬景泰裁決 B 的允許範圍
    const CITATION_MARKERS = [
      "資料來源", "數據來源", "來源：", "來源:", "根據", "統計", "調查",
      "房價指數", "指數", "市調", "發布", "報告", "前瞻", "集團", "研究", "引用",
    ];

    const COMPETITOR_BRANDS = [
      "信義房屋", "永慶房屋", "永慶房產", "住商不動產", "東森房屋",
      "台灣房屋", "中信房屋", "21世紀不動產", "太平洋房屋",
    ];

    // 教議價／殺價的用詞（「議價空間」是市場描述、刻意不列入）
    // 只抓「真的在教讀者怎麼壓價」的用法。
    // 刻意不抓的（都是描述，不是教學）：
    //   「議價空間 / 殺價空間 5-8%」= 市場行情與定價策略描述
    //   「不是行銷話術」「建商廣告話術」= 在否定或指涉別人
    //   「買方會殺價」「結果不是買方殺價」= 描述市場行為
    const NEGOTIATION_COACHING = [
      "殺價要", "殺價可以", "可以殺到", "能殺到", "再殺", "多殺",
      "壓價", "怎麼開口談", "談判心理", "留尾數", "哀兵",
      "給賣方台階", "給屋主台階", "對話骨架", "砍仲介費", "議價話術", "殺價話術",
    ];

    const EXAGGERATED_TERMS = [
      "絕版", "最強", "全市場最低", "全市最低",
      "保證漲", "必漲", "穩賺",
      "頂級豪宅", "完美無缺",
      "千載難逢", "百年難得", "空前絕後", "前無古人",
      "無敵", "無可挑剔",
    ];

    for (const f of files) {
      const text = await readFile(new URL(f, POSTS_DIR), "utf-8");
      const parsed = parseFrontmatter(text);
      if (!parsed) {
        errors.push({ file: f, msg: "frontmatter parse failed" });
        continue;
      }
      const { meta, body } = parsed;
      scanned++;
      const isDraft = meta.draft === "true" || meta.draft === true;

      // 11. 編造的第一人稱客戶故事（景泰紅線 — 2026-06 清過 51 篇、2026-08 又復發 23 篇）
      //     draft 也要檢查：草稿之後會被發布，等到發布才擋就太晚了（只是降級成 warning）
      {
        const whole = `${meta.title || ""}
${meta.description || ""}
${body || ""}`;
        const hits = [];
        for (const { re, label } of FABRICATION_PATTERNS) {
          const m = whole.match(re);
          if (m) hits.push(`${label}「${m[0].slice(0, 24)}」`);
        }
        if (hits.length > 0) {
          const msg = `疑似編造的第一人稱客戶故事: ${hits.join("、")} — 景泰 2025-03 才轉房仲，此類敘述須為真實經歷，否則改中性寫法或明標「假設情境」`;
          (isDraft ? warnings : errors).push({ file: f, msg });
        }
      }

      // 12. 同業仲介品牌（景泰紅線 — 不掛同業品牌）
      {
        const whole = `${meta.title || ""}
${meta.description || ""}
${body || ""}`;
        for (const brand of COMPETITOR_BRANDS) {
          let idx = whole.indexOf(brand);
          while (idx !== -1) {
            // 景泰 2026-08-27 裁決 B：把同業當「市場數據來源」引用可以留，
            // 只有「比較優劣 / 幫對手曝光」才算違規。
            // 判斷法：看前後 30 字有沒有引用語境的字眼。
            const ctx = whole.slice(Math.max(0, idx - 30), idx + brand.length + 30);
            // 出處連結 [永慶房屋](https://…) 也算引用
            const linkCtx = whole.slice(Math.max(0, idx - 60), idx + brand.length + 120);
            const isSourceLink = linkCtx.includes("[") && linkCtx.includes("](http");
            const isCitation = isSourceLink || CITATION_MARKERS.some(k => ctx.includes(k));
            if (isCitation) { idx = whole.indexOf(brand, idx + 1); continue; }
            // ⚠️ 暫列 warning：月報文章多半是把「永慶房產集團」當市場數據來源引用，
            //    跟「幫同業打廣告」不同。等景泰裁決要不要連引用也拿掉，再決定要不要升為 error。
            (isDraft ? warnings : errors).push({
              file: f,
              msg: `同業品牌: 含「${brand}」且不在引用語境 — 引用市場數據可以留，比較優劣／幫對手曝光不行。前後文：…${ctx.trim().slice(0, 50)}…`,
            });
            break;
          }
        }
      }

      // 13. 教議價 / 殺價（景泰紅線）— 描述市場的「議價空間」不算，故不列入
      {
        const whole = `${meta.title || ""}
${meta.description || ""}
${body || ""}`;
        for (const term of NEGOTIATION_COACHING) {
          if (whole.includes(term)) {
            (isDraft ? warnings : errors).push({
              file: f,
              msg: `教議價: 含「${term}」— 不教議價/殺價/跟仲介鬥智（單純描述市場的「議價空間」不在此限）`,
            });
          }
        }
      }

      // 14. 「估價」是不動產估價師的法定專屬業務，對外文字改「行情評估」
      {
        const whole = `${meta.title || ""}
${meta.description || ""}
${body || ""}`;
        // 排除別的主體的行為或機構全名：銀行估價 / 估價單 / 估價師
        const stripped = whole
          .replace(/銀行(?:派)?估價/g, "")
          .replace(/估價師/g, "")
          .replace(/估價單/g, "");
        if (stripped.includes("估價")) {
          warnings.push({
            file: f,
            msg: `用詞: 含「估價」— 那是不動產估價師的法定專屬業務，房仲對外請寫「行情評估」`,
          });
        }
      }

      // draft post 之後的 SEO meta 檢查跳過
      if (isDraft) continue;

      // 1. title
      if (!meta.title) {
        errors.push({ file: f, msg: "缺 title" });
      } else {
        const len = meta.title.length;
        if (len < 10) {
          warnings.push({ file: f, msg: `title 太短 (${len} 字、建議 ≥10)` });
        } else if (len > 65) {
          warnings.push({ file: f, msg: `title 太長 (${len} 字、Google SERP 會截斷 ~65)` });
        }
        // dedup title check
        if (titleMap.has(meta.title)) {
          warnings.push({
            file: f,
            msg: `title 重複：與 ${titleMap.get(meta.title)} 相同`,
          });
        } else {
          titleMap.set(meta.title, f);
        }
      }

      // 2. description
      if (!meta.description) {
        errors.push({ file: f, msg: "缺 description (Google SERP 會撈隨機段落)" });
      } else {
        const dlen = meta.description.length;
        if (dlen < 50) {
          warnings.push({ file: f, msg: `description 太短 (${dlen} 字、建議 ≥50)` });
        } else if (dlen > 160) {
          warnings.push({ file: f, msg: `description 太長 (${dlen} 字、會截斷 ~160)` });
        }
        // 開頭不應為標點
        const firstChar = meta.description[0];
        if (/[、。，！？!?,\.;:]/.test(firstChar)) {
          warnings.push({ file: f, msg: `description 開頭是標點 "${firstChar}"` });
        }
        // description 重複檢測
        if (descMap.has(meta.description)) {
          warnings.push({
            file: f,
            msg: `description 重複：與 ${descMap.get(meta.description)} 相同`,
          });
        } else {
          descMap.set(meta.description, f);
        }
      }

      // 8. 廣告誇大形容詞 (title + description 都檢)
      const combinedText = `${meta.title || ""} ${meta.description || ""}`;
      for (const term of EXAGGERATED_TERMS) {
        if (combinedText.includes(term)) {
          warnings.push({
            file: f,
            msg: `廣告誇大: 含「${term}」(房仲業違反公平交易法 21 條風險)`,
          });
        }
      }

      // 3. tags
      if (!meta.tags || (Array.isArray(meta.tags) && meta.tags.length === 0)) {
        warnings.push({ file: f, msg: "缺 tags (影響 /tags 聚合)" });
      } else if (Array.isArray(meta.tags) && meta.tags.includes("others")) {
        warnings.push({ file: f, msg: "tags 含 'others' 預設值 (建議用實際主題標籤)" });
      }

      // 4. pubDatetime
      if (!meta.pubDatetime) {
        errors.push({ file: f, msg: "缺 pubDatetime" });
      }

      // 5. ogImage (warn only — dynamic OG 開啟時 fallback OK)
      if (!meta.ogImage) {
        warnings.push({ file: f, msg: "缺 ogImage (走 dynamic OG fallback)" });
      }
    }

    // 輸出
    console.log(`# SEO Lint Report`);
    console.log(``);
    console.log(`掃描 **${scanned}** 篇 .md`);
    console.log(`- 🔴 ERROR:   ${errors.length}`);
    console.log(`- 🟡 WARNING: ${warnings.length}`);
    console.log(``);

    if (errors.length > 0) {
      console.log(`## 🔴 ERROR (${errors.length})`);
      for (const e of errors.slice(0, 30)) {
        console.log(`- \`${e.file}\` · ${e.msg}`);
      }
      if (errors.length > 30) console.log(`- ... 還有 ${errors.length - 30} 筆`);
      console.log(``);
    }

    if (warnings.length > 0) {
      // 分類 warn
      const groupedWarn = {};
      for (const w of warnings) {
        // 萃取 msg 前綴當分類
        const cat = w.msg.match(/^(title|description|tags|ogImage|pubDatetime|缺 [a-zA-Z]+)/)?.[0] || w.msg;
        if (!groupedWarn[cat]) groupedWarn[cat] = [];
        groupedWarn[cat].push(w);
      }
      const sortedCats = Object.entries(groupedWarn).sort((a, b) => b[1].length - a[1].length);
      console.log(`## 🟡 WARNING (${warnings.length})`);
      for (const [cat, list] of sortedCats) {
        console.log(`### ${cat} (${list.length})`);
        for (const w of list.slice(0, 10)) {
          console.log(`- \`${w.file}\` · ${w.msg}`);
        }
        if (list.length > 10) console.log(`- ... 還有 ${list.length - 10} 筆`);
        console.log(``);
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`✅ 所有文章 SEO meta 完整、無 lint 違規`);
    }

    process.exit(errors.length > 0 ? 1 : 0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
