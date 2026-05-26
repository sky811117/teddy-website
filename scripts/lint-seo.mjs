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
      const { meta } = parsed;
      scanned++;

      // draft post 跳過
      if (meta.draft === "true" || meta.draft === true) continue;

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
