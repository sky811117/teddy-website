#!/usr/bin/env node
/**
 * 從 OpenStreetMap 抓台中市的嫌惡設施（OSM 那一份），交給 scripts/build-undesirable-facilities.py 跟官方資料合併
 *
 * ⚠ 2026-09-30 起這支**不再直接寫** public/data/undesirable-facilities.json：
 *   網站用的檔案改由 build-undesirable-facilities.py 產（官方開放資料＋OSM 合併去重，每筆標來源 s）。
 *   這支只負責 OSM 那一段，輸出中介檔（預設 <系統暫存>/teddy-uf-cache/osm.json，可用 --out 指定）。
 *   直接跑這支不會動到網站資料；要更新網站請跑：python scripts/build-undesirable-facilities.py --refresh-osm
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
 *      node scripts/fetch-undesirable-facilities.mjs --out <路徑>
 *      （通常不用手動跑：build-undesirable-facilities.py --refresh-osm 會呼叫它）
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const rawArg = process.argv.indexOf("--raw"); // 除錯用：另存 Overpass 原始回應
const RAW = rawArg > 0 ? process.argv[rawArg + 1] : null;
const fromArg = process.argv.indexOf("--from-raw"); // 除錯用：不連網，直接用上次 --raw 存的回應重算
const FROM_RAW = fromArg > 0 ? process.argv[fromArg + 1] : null;
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 && process.argv[outArg + 1]
  ? process.argv[outArg + 1]
  : join(tmpdir(), "teddy-uf-cache", "osm.json");

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
  // ⛔ 2026-09-30 起不收 shop=funeral_directors：禮儀社、禮儀用品店依殯葬管理條例第 2 條是「殯葬服務業」，不是殯葬設施
  { key: "substation", label: "變電所", why: "外觀與電磁疑慮影響接受度", q: '["power"="substation"]' },
  { key: "tower", label: "高壓電塔", why: "外觀與電磁疑慮影響接受度", q: '["power"="tower"]' },
  { key: "mast", label: "基地台・通訊塔", why: "電磁疑慮，住戶常有意見", q: '["man_made"="mast"]' },
  { key: "hospital", label: "醫院", why: "救護車鳴笛、夜間車流", q: '["amenity"="hospital"]' },
  { key: "market", label: "市場・夜市", why: "油煙、噪音、垃圾與停車", q: '["amenity"="marketplace"]' },
  { key: "prison", label: "矯正機關", why: "心理因素影響轉手", q: '["amenity"="prison"]' },
  { key: "landfill", label: "掩埋場・轉運站", why: "異味與垃圾車動線", q: '["landuse"="landfill"]' },
  { key: "waste", label: "掩埋場・轉運站", why: "異味與垃圾車動線", q: '["amenity"="waste_transfer_station"]' },
];

// 2026-09-30 起改 out geom（原本 out center tags）：公墓、市場、殯葬是一整片，
// 合併時要拿「多邊形有沒有包住官方點」判斷是不是同一處（只看中心點會把同一座公墓算兩次）。
// out geom 的 way／relation 沒有 center，改用 bounds 的中點 —— Overpass 的 center 本來就是 bounds 中點，點位不變。
function buildQuery() {
  const body = CATEGORIES.map(c => `  nwr${c.q}(area.tc);`).join("\n");
  return `[out:json][timeout:180];
area["name"="臺中市"]["admin_level"="4"]->.tc;
(
${body}
);
out geom;`;
}

// 面狀類別才帶多邊形到中介檔（其他類別只要點位，檔案不必變大）
const POLY_KEYS = new Set(["cemetery", "funeral", "market"]);
const r5 = v => Math.round(v * 1e5) / 1e5;
function centerOf(el) {
  if (typeof el.lat === "number") return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  const b = el.bounds;
  if (b) return [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2];
  return [undefined, undefined];
}
// relation 的外框常由好幾條 way 首尾相接組成 → 接成完整的環
function stitch(parts) {
  const rings = [];
  const pool = parts.filter(p => p.length >= 2).map(p => p.slice());
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) ring = ring.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) ring = ring.concat(p.slice(0, -1).reverse());
        else if (same(ring[0], p[p.length - 1])) ring = p.slice(0, -1).concat(ring);
        else if (same(ring[0], p[0])) ring = p.slice(1).reverse().concat(ring);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}
// 多邊形 → [[lat1, lon1, lat2, lon2, …], …]（外框；座標 5 位小數）
function polygonOf(el) {
  let rings = [];
  if (el.type === "way" && Array.isArray(el.geometry)) {
    rings = [el.geometry.filter(Boolean).map(g => [r5(g.lat), r5(g.lon)])];
  } else if (el.type === "relation" && Array.isArray(el.members)) {
    const parts = el.members
      .filter(m => m.type === "way" && (m.role === "outer" || m.role === "") && Array.isArray(m.geometry))
      .map(m => m.geometry.filter(Boolean).map(g => [r5(g.lat), r5(g.lon)]));
    rings = stitch(parts);
  }
  rings = rings.filter(r => r.length >= 3);
  return rings.length ? rings.map(r => r.flat()) : null;
}

// 只供氫氣的站（逢甲大學「綠色加氫站」是研究用，fuel:LH2=yes、沒有汽柴油）不是一般加油站：
// 這裡先標 h2，由 build-undesirable-facilities.py 排除並寫進報告的排除清單
const H2_TAGS = ["fuel:LH2", "fuel:H2", "fuel:h2", "fuel:hydrogen", "fuel:compressed_hydrogen", "fuel:liquid_hydrogen"];
const PETROL_TAGS = ["fuel:octane_92", "fuel:octane_95", "fuel:octane_98", "fuel:diesel", "fuel:HGV_diesel", "fuel:GTL_diesel", "fuel:lpg", "fuel:e10"];
function hydrogenOnly(tags) {
  const name = `${tags["name:zh"] || ""} ${tags.name || ""}`;
  const h2 = H2_TAGS.some(k => tags[k] === "yes") || /加氫|氫能|氫氣/.test(name);
  return h2 && !PETROL_TAGS.some(k => tags[k] === "yes") && !/加油/.test(name);
}

// 「宮廟」只收佛道教與民間信仰。amenity=place_of_worship 也包含教會、清真寺，
// 2026-08-28 版把它們一起算成宮廟（1,014 筆裡混了教會），2026-09-30 起排除。
const TEMPLE_RELIGIONS = new Set(["buddhist", "taoist", "chinese_folk", "folk", "confucian", "yiguandao", "tenrikyo", "shinto", "multifaith"]);
const NON_TEMPLE_RELIGIONS = new Set(["christian", "muslim", "jewish", "hindu", "sikh", "bahai", "scientologist", "happyscience", "fortune_teller"]);
const NOT_TEMPLE_NAME = /教會|禮拜堂|天主|基督|浸信|浸禮|長老|清真|摩門|耶穌|福音|召會|會所|靈糧|貴格|門諾|行道會|信義會|凱歌|安息日|錫安|路德|宗親會|山達基|幸福科學|Church/i;
const TEMPLE_NAME = /宮|廟|寺|殿|祠|壇|巖|岩|庵|院|亭|堂|府|觀|閣|精舍|禪|佛|福德|土地|道場|講堂|聖母|聖媽|百姓公|有應|萬善|將軍|王爺|伯公|大眾爺|地理|塔|公$/;
function isTemple(tags) {
  const name = tags["name:zh"] || tags.name || "";
  if (NOT_TEMPLE_NAME.test(name)) return false;
  const rel = tags.religion;
  if (NON_TEMPLE_RELIGIONS.has(rel)) return false;
  if (TEMPLE_RELIGIONS.has(rel)) return true;
  // religion 沒標或亂標（例「媽祖廟」「百姓爺」「no」）→ 看名字
  // 沒標宗教：有名字且像宮廟才收；沒名字的也收（台灣路邊沒名字的多半是土地公廟）
  return !name || TEMPLE_NAME.test(name);
}

// 已廢止／興建中／規劃中的一律不收（CLAUDE.md：未完工的設施不寫）
const LIFECYCLE = ["disused", "abandoned", "construction", "proposed", "planned", "demolished", "razed", "removed", "was"];
// 名稱看得出不是現有設施的也不收（2026-09-30 查核：「變電所用地」是重劃區的土地使用分區、「開關場(土石流淹沒)」已被土石流埋掉）
const INACTIVE_NAME = /規劃|籌建|興建|預定|施工中|廢止|廢除|廢棄|已遷|遷移|已拆|拆除|停業|歇業|解散|撤銷|裁撤|用地|淹沒|舊址|原址/;
function inactive(tags) {
  for (const k of LIFECYCLE) {
    if (tags[k] && tags[k] !== "no") return true;
  }
  if (tags.building === "construction" || tags.landuse === "construction") return true; // 臺中二次變電所：building=construction
  if (tags.opening_date && tags.opening_date > new Date().toISOString().slice(0, 10)) return true;
  const name = `${tags["name:zh"] || ""} ${tags.name || ""}`;
  if (INACTIVE_NAME.test(name)) return true;
  // 重劃區的地籍分區：description 寫重劃區、沒有 building 標籤、又沒有正式名稱，看不出已經蓋好
  // （⚠ 不能只看 description：梧棲八德路的中油站也寫「臺中港市鎮中心市地重劃區」，但它有名稱、在營業）
  if (/重劃區/.test(tags.description || "") && !tags.building && !(tags["name:zh"] || tags.name)) return true;
  return false;
}

// 類別標錯的點（2026-09-30 查核）：便利商店被標成醫院／加油站、球場燈柱被標成基地台、充電站被標成變電所
const STORE_BRAND = /7-?eleven|統一超商|全家|familymart|萊爾富|hi-?life|ok ?mart|OK超商/i;
const NOT_TEMPLE_SHOP_NAME = /用品|紀念碑/; // 「宮廟慶典用品」是店家、「殉職員工紀念碑」是紀念碑
const MARKET_SUBAREA = /^[A-Za-z甲乙丙丁戊己庚]區$/; // 上景興市場被拆成 A～F 區：併回市場本身（名稱改成 operator）
const NOT_MARKET_NAME = /(?:商|果菜|菜|蔬果)行$|新村$|眷村|藝樹館|文創/; // 果菜行是店家、審計新村是文創聚落
function miscategorized(key, tags) {
  const name = tags["name:zh"] || tags.name || "";
  const brand = `${tags.brand || ""} ${tags.operator || ""} ${name}`;
  switch (key) {
    case "hospital":
      return Boolean(tags.shop) || STORE_BRAND.test(brand);
    case "temple":
      return Boolean(tags.shop) || NOT_TEMPLE_SHOP_NAME.test(name);
    case "fuel":
      return (tags.shop === "convenience" || STORE_BRAND.test(brand)) && !/加油/.test(name);
    case "mast":
      return tags["tower:type"] === "lighting";
    case "substation":
      return Boolean(tags.amenity) || /充電/.test(name);
    case "landfill":
    case "waste":
      // 非正式傾倒點（informal=yes／waste_dump_site）不是掩埋場也不是轉運站
      return tags.informal === "yes" || tags.amenity === "waste_dump_site";
    case "market":
      return NOT_MARKET_NAME.test(name);
    default:
      return false;
  }
}

function classify(tags) {
  if (inactive(tags)) return null;
  for (const c of CATEGORIES) {
    const m = c.q.match(/\["([^"]+)"="([^"]+)"\]/);
    if (m && tags[m[1]] === m[2]) {
      if (c.key === "temple" && !isTemple(tags)) return null;
      if (miscategorized(c.key, tags)) return null;
      return c;
    }
  }
  return null;
}

async function main() {
  const query = buildQuery();
  let data = null;
  if (FROM_RAW) {
    const { readFile } = await import("node:fs/promises");
    data = JSON.parse(await readFile(FROM_RAW, "utf-8"));
    console.log("[osm] 用快取的 Overpass 回應", FROM_RAW);
  }
  for (const url of FROM_RAW ? [] : ENDPOINTS) {
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
          "User-Agent": "teddy-website/1.0 (+https://teddy-house.tw)",
        },
      });
      if (!res.ok) {
        console.log("[osm]  → HTTP", res.status, "換下一個節點");
        continue;
      }
      data = await res.json();
      if (RAW) {
        await mkdir(dirname(RAW), { recursive: true });
        await writeFile(RAW, JSON.stringify(data), "utf-8");
      }
      break;
    } catch (e) {
      console.log("[osm]  → 失敗:", e.message, "換下一個節點");
    }
  }
  if (!data) {
    console.error("[osm] 所有節點都失敗（build-undesirable-facilities.py 會改用現有網站檔裡的 OSM 資料）");
    process.exit(1);
  }

  const seen = new Set();
  const out = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const cat = classify(tags);
    if (!cat) continue;
    const [lat, lon] = centerOf(el);
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    let name = (tags["name:zh"] || tags.name || "").trim();
    if (cat.key === "market" && MARKET_SUBAREA.test(name) && tags.operator) name = tags.operator.trim();
    // 去重：同類別、座標取到小數 4 位（約 11 公尺）視為同一點
    const key = `${cat.key}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pg = POLY_KEYS.has(cat.key) && el.type !== "node" ? polygonOf(el) : null;

    // ⚠️ 不要在每一筆重複存分類名稱與說明 —— 4,000 筆重複同樣的字串會讓檔案大一倍。
    //    分類資訊抽到 payload.categories 對照表，這裡只留 key。
    out.push({
      k: cat.key,
      n: name || cat.label,
      // 座標壓到小數 5 位（約 1 公尺），檔案小一半
      y: Number(lat.toFixed(5)),
      x: Number(lon.toFixed(5)),
      s: "osm",
      // 以下兩欄只在中介檔：合併時判斷「沒名字」與追查原始 OSM 物件用，網站檔不會帶
      id: `${el.type[0]}${el.id}`,
      named: Boolean(name),
      // 合併比對用（只在中介檔）：正式名稱、營運者、門牌（路＋號）
      ...(tags.official_name ? { on: tags.official_name.trim() } : {}),
      ...(tags.operator ? { op: tags.operator.trim() } : {}),
      ...(tags["addr:street"] && tags["addr:housenumber"] ? { ad: `${tags["addr:street"]}${String(tags["addr:housenumber"]).replace(/號$/, "")}號` } : {}),
      // 加油站合併用（2026-09-30）：完整地址、品牌、分店名；只供氫氣的站標 h2
      ...(tags["addr:full"] ? { af: tags["addr:full"].trim() } : {}),
      ...(cat.key === "fuel" && tags.brand ? { br: tags.brand.trim() } : {}),
      ...(cat.key === "fuel" && tags.branch ? { bn: tags.branch.trim() } : {}),
      ...(cat.key === "fuel" && hydrogenOnly(tags) ? { h2: true } : {}),
      // 面狀類別的多邊形（合併時判斷「多邊形包住官方點」用）
      ...(pg ? { pg } : {}),
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
    osmBase: data.osm3s?.timestamp_osm_base || null,
    area: "臺中市",
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: out.length,
    categories,
    byCategory: byCat,
    items: out,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload), "utf-8");
  console.log(`[osm] 寫出 ${out.length} 筆 → ${OUT}`);
  for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`       ${k} ${v}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
