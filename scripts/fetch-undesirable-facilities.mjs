#!/usr/bin/env node
/**
 * 從 OpenStreetMap 抓台中市的嫌惡設施，產出 public/data/undesirable-facilities.json
 *
 * 為什麼要做這支：
 * GSC 實測「嫌惡設施查詢」113 曝、「嫌惡設施地圖」31 曝、「不動產嫌惡設施查詢」7 曝、
 * 「300公尺內嫌惡設施查詢」6 曝，合計 157 次搜尋。但第一頁全是**地圖工具站**
 * （實價登錄地圖、map8.zone 之類）—— 代表搜這個字的人要的是「可以點的東西」，
 * 不是一篇教學文。站上原本只有 week-04 那篇文章（排 8.1），差的就是工具本身。
 *
 * 資料來源：OpenStreetMap（ODbL 授權，使用時必須標示 © OpenStreetMap contributors）。
 * 用 OSM 而不是各縣市開放資料的原因：一次查詢就能拿到所有類別、格式一致、
 * 免註冊免金鑰，而且更新是社群持續在做。
 *
 * ⚠️ 這是**建置期**抓一次存成靜態檔，不是使用者每次查詢都打 Overpass。
 *    公開的 Overpass 有速率限制，讓每個訪客直接打會被擋、也會很慢。
 *
 * 用法：node scripts/fetch-undesirable-facilities.mjs
 *      （手動跑即可，資料不常變。要更新就重跑一次再 commit。）
 */
import { writeFile, mkdir } from "node:fs/promises";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// 分類 → OSM 標籤。中文標籤是要顯示給買方看的，用房仲會講的說法。
const CATEGORIES = [
  { key: "fuel", label: "加油站", why: "油氣味、進出車流、公安風險", q: '["amenity"="fuel"]' },
  { key: "temple", label: "宮廟", why: "誦經、鞭炮、法會期間人車多", q: '["amenity"="place_of_worship"]' },
  { key: "cemetery", label: "公墓・墓地", why: "心理因素影響轉手", q: '["landuse"="cemetery"]' },
  { key: "cemetery", label: "公墓・墓地", why: "心理因素影響轉手", q: '["amenity"="grave_yard"]' },
  { key: "funeral", label: "殯葬設施", why: "心理因素、法會與車流", q: '["amenity"="funeral_hall"]' },
  { key: "funeral", label: "殯葬設施", why: "心理因素、法會與車流", q: '["shop"="funeral_directors"]' },
  { key: "substation", label: "變電所", why: "外觀與電磁疑慮影響接受度", q: '["power"="substation"]' },
  { key: "tower", label: "高壓電塔", why: "外觀與電磁疑慮影響接受度", q: '["power"="tower"]' },
  { key: "mast", label: "基地台・通訊塔", why: "電磁疑慮，住戶常有意見", q: '["man_made"="mast"]' },
  { key: "hospital", label: "醫院", why: "救護車鳴笛、夜間車流", q: '["amenity"="hospital"]' },
  { key: "market", label: "市場・夜市", why: "油煙、噪音、垃圾與停車", q: '["amenity"="marketplace"]' },
  { key: "prison", label: "矯正機關", why: "心理因素影響轉手", q: '["amenity"="prison"]' },
  { key: "landfill", label: "掩埋場・轉運站", why: "異味與垃圾車動線", q: '["landuse"="landfill"]' },
  { key: "waste", label: "掩埋場・轉運站", why: "異味與垃圾車動線", q: '["amenity"="waste_transfer_station"]' },
];

function buildQuery() {
  const body = CATEGORIES.map(c => `  nwr${c.q}(area.tc);`).join("\n");
  return `[out:json][timeout:180];
area["name"="臺中市"]["admin_level"="4"]->.tc;
(
${body}
);
out center tags;`;
}

function classify(tags) {
  for (const c of CATEGORIES) {
    const m = c.q.match(/\["([^"]+)"="([^"]+)"\]/);
    if (m && tags[m[1]] === m[2]) return c;
  }
  return null;
}

async function main() {
  const query = buildQuery();
  let data = null;
  for (const url of ENDPOINTS) {
    try {
      console.log("[osm] 查詢", url);
      // ⚠️ 一定要帶 User-Agent：Overpass 會擋掉 node fetch 的預設 UA（回 406）。
      //    body 用 form-urlencoded 的 data= 參數，這是 Overpass 官方建議的送法。
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // ⚠️ HTTP 標頭只能放 ASCII，這裡寫中文會噴 ByteString 轉換錯誤
          "User-Agent": "teddy-website/1.0 (+https://teddy-website-blog.pages.dev)",
        },
      });
      if (!res.ok) {
        console.log("[osm]  → HTTP", res.status, "換下一個節點");
        continue;
      }
      data = await res.json();
      break;
    } catch (e) {
      console.log("[osm]  → 失敗:", e.message, "換下一個節點");
    }
  }
  if (!data) {
    console.error("[osm] 所有節點都失敗，維持既有資料檔不動");
    process.exit(1);
  }

  const seen = new Set();
  const out = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const cat = classify(tags);
    if (!cat) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    const name = (tags["name:zh"] || tags.name || "").trim();
    // 去重：同類別、座標取到小數 4 位（約 11 公尺）視為同一點
    const key = `${cat.key}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // ⚠️ 不要在每一筆重複存分類名稱與說明 —— 4,000 筆重複同樣的字串會讓檔案大一倍。
    //    分類資訊抽到 payload.categories 對照表，這裡只留 key。
    out.push({
      k: cat.key,
      n: name || cat.label,
      // 座標壓到小數 5 位（約 1 公尺），檔案小一半
      y: Number(lat.toFixed(5)),
      x: Number(lon.toFixed(5)),
    });
  }

  out.sort((a, b) => (a.k === b.k ? a.y - b.y : a.k.localeCompare(b.k)));

  const categories = {};
  for (const c of CATEGORIES) {
    if (!categories[c.key]) categories[c.key] = { label: c.label, why: c.why };
  }
  const byCat = {};
  for (const o of out) {
    const lb = categories[o.k].label;
    byCat[lb] = (byCat[lb] || 0) + 1;
  }

  const payload = {
    source: "OpenStreetMap contributors (ODbL)",
    area: "臺中市",
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: out.length,
    categories,
    byCategory: byCat,
    items: out,
  };

  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../public/data/undesirable-facilities.json", import.meta.url),
    JSON.stringify(payload),
    "utf-8"
  );
  console.log(`[osm] 寫出 ${out.length} 筆`);
  for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`       ${k} ${v}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
