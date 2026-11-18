/**
 * homeMapData — 首頁「台中在售物件地圖」的資料（build 期算一次，首頁與兩個端點共用）
 *
 *   points → /data/home-map.json        每間一列，畫點與篩選用（首頁一開就抓）
 *   cards  → /data/home-map-cards.json  每間一列，點開小卡才用（列順序跟 points 一樣）
 *
 * 物件範圍：status 是 active、district 是台中 29 區的精確名（TAICHUNG_DISTRICTS），照物件代號排序。
 *
 * ⚠️ 只輸出列表卡本來就看得到的東西：總價、房數、坪數、類型、社區名或路段、封面縮圖。
 *    標題、文案、門牌一律不放；社區名與路段走跟物件頁／列表卡同一套清洗。
 * ⚠️ 位置：src/data/home-map-places.json（進版控；只在 build 讀，不會送到瀏覽器），
 *    由 房仲工作站\500_Strategy\SEO_GEO\改版2026-11\工具\make_home_map_data.py 產生。
 *    座標全部是臺中市政府數位發展局的門牌開放資料（2026-11-17 起；以前用樂居名冊的座標，已停用）。
 *    每間照這個順序找：
 *      1. 對外可用的社區名（publicCommunityName，且不像門牌）→ places.c[區][社區名] → 實心點（準度 2）
 *      2. 路名（streetArea 去掉區名、只留到路／段）→ places.r[區][路名] → 空心點（準度 1，路段的大概位置）
 *      3. 都沒有 → 0,0,0，前端放在行政區中心附近畫成空心點
 *    缺檔不會讓 build 失敗（全部變成 3）。新上架物件的社區要等重跑那支工具才有社區位置，之前先畫在路段上。
 *    比對用的 normCommunity／roadKeyOf 要跟那支工具的 norm()／road_key() 一模一樣，不然會默默對不到。
 * /data/* 快取一天，所以引用這兩個端點的網址要帶 ?v=（用這裡回傳的 ver）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCollection } from "astro:content";
import { cleanStreetArea } from "@/utils/cleanStreetArea";
import { coverSrcOf, coverThumb } from "@/utils/coverThumb";
import { TAICHUNG_DISTRICTS, getDistrictSlug } from "@/utils/isTaichung";
import { bodyPropertyType } from "@/utils/parkingCaliber";
import {
  publicCommunityName,
  stripAddressDetail,
} from "@/utils/propertyPhotoAlt";
import {
  buildCardMeta,
  shouldShowNewBadge,
  type PropertyEntry,
} from "@/pages/properties/_components/propertyMeta";

export interface HomeMapData {
  /** /data/home-map.json 的內容（緊湊 JSON 字串） */
  points: string;
  /** /data/home-map-cards.json 的內容（緊湊 JSON 字串） */
  cards: string;
  /** points＋cards 的 sha1 前 10 碼，給網址的 ?v= 用 */
  ver: string;
  /** 地圖上的物件數 */
  count: number;
  /** 其中有位置（社區或路段）的筆數 */
  located: number;
}

/**
 * 類型的名稱與順序。前端用「第幾個」比對篩選條件，順序不能動，最後一個固定是「其他」。
 */
const TYPE_NAMES = [
  "電梯大樓",
  "華廈",
  "公寓",
  "透天厝",
  "別墅",
  "套房",
  "其他",
] as const;
type TypeName = (typeof TYPE_NAMES)[number];
const OTHER_TYPE_INDEX = TYPE_NAMES.length - 1;

/**
 * 類型歸併表：左邊是地圖用的 7 種，右邊是資料裡的寫法。
 * 資料來源跟物件頁一樣：先看 src/data/property-types.json（依物件代號），沒有再看內文「**類型**：」那一行。
 * 表裡沒列到的寫法一律算「其他」。
 */
const TYPE_ALIASES: Record<TypeName, readonly string[]> = {
  電梯大樓: ["電梯大樓", "大樓"],
  華廈: ["華廈"],
  公寓: ["公寓"],
  透天厝: ["透天厝", "透天"],
  別墅: ["別墅"],
  套房: ["套房"],
  // 目前資料裡出現過、地圖不另外分的類型（寫出來是為了看得到，沒寫到的也一樣算其他）
  其他: ["其他", "土地", "店面", "廠房", "農舍", "商場", "不限"],
};
const TYPE_INDEX = new Map<string, number>(
  TYPE_NAMES.flatMap((name, i) =>
    TYPE_ALIASES[name].map(raw => [raw, i] as const)
  )
);

// 跟物件頁（properties/[...slug].astro）同一種讀法：檔案不在 → glob 回空物件 → 只看內文
const propertyTypeFiles = import.meta.glob<Record<string, unknown>>(
  "/src/data/property-types.json",
  {
    eager: true,
    import: "default",
  }
);
const propertyTypeMap = Object.values(propertyTypeFiles)[0] ?? {};

function typeIndex(p: PropertyEntry): number {
  const v = propertyTypeMap[p.id];
  const raw =
    (typeof v === "string" && v.trim() ? v.trim() : undefined) ??
    bodyPropertyType(p.body);
  return TYPE_INDEX.get(raw ?? "") ?? OTHER_TYPE_INDEX;
}

// 位置檔：有就讀，沒有就是空的（glob 對不到檔案時回空物件）
const placeFiles = import.meta.glob<unknown>("/src/data/home-map-places.json", {
  eager: true,
  import: "default",
});

type LatLng = readonly [number, number];
/** 區名 → (比對用的名字 → 座標) */
type PlaceTable = Map<string, Map<string, LatLng>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 台中一帶（跟 make_home_map_data.py 的 LAT_OK／LNG_OK 一樣）：跑出這個範圍的座標當成壞資料不用
const inTaichung = (lat: number, lng: number) =>
  lat >= 23.9 && lat <= 24.6 && lng >= 120.4 && lng <= 121.5;

function readTable(v: unknown): PlaceTable {
  const out: PlaceTable = new Map();
  if (!isRecord(v)) return out;
  for (const [district, rows] of Object.entries(v)) {
    if (!isRecord(rows)) continue;
    const m = new Map<string, LatLng>();
    for (const [key, ll] of Object.entries(rows)) {
      if (!Array.isArray(ll) || ll.length !== 2) continue;
      const [lat, lng] = ll as unknown[];
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!inTaichung(lat, lng)) continue;
      m.set(key, [lat, lng]);
    }
    if (m.size) out.set(district, m);
  }
  return out;
}

/**
 * 讀位置檔；格式不對的列跳過，形狀不對（是 JSON 但沒有 c／r）就當成沒有任何位置。
 * 檔案本身不是合法 JSON（例如寫到一半斷掉）時，建置會直接停下並指出這個檔：重跑 make_home_map_data.py 就好。
 */
function readPlaces(): { present: boolean; c: PlaceTable; r: PlaceTable } {
  const file = Object.values(placeFiles)[0];
  return {
    present: file !== undefined,
    c: readTable(isRecord(file) ? file.c : undefined),
    r: readTable(isRecord(file) ? file.r : undefined),
  };
}

/** 社區名比對用：拿掉空白和常見符號、臺→台（＝make_home_map_data.py 的 norm） */
function normCommunity(s: string): string {
  return s.replace(/[\s　·・\-－—_()（）/／]/g, "").replace(/臺/g, "台");
}

/** 社區名像門牌、地號的不畫在社區上：點會直接指到那一棟（本戶只寫到路名）（＝工具的 ADDR_LIKE） */
const ADDR_LIKE = /\d+\s*(?:號|巷|弄)|地號/;

const CN_DIGIT = "零一二三四五六七八九";
function int2cn(n: number): string {
  if (n < 10) return CN_DIGIT[n];
  if (n < 20) return "十" + (n > 10 ? CN_DIGIT[n - 10] : "");
  return CN_DIGIT[Math.floor(n / 10)] + "十" + (n % 10 ? CN_DIGIT[n % 10] : "");
}

/**
 * 物件的路名 → 門牌資料的路名 key（＝make_home_map_data.py 的 road_key）：
 * 去掉區名（第一個）、全形數字轉半形、去空白、台→臺、去掉「臺中市」、段用國字、只留到路／街／大道（＋段），巷弄號碼不要。
 */
function roadKeyOf(streetArea: string, district: string): string {
  let s = streetArea
    .replace(district, "")
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s/g, "")
    .replace(/台/g, "臺")
    .replace(/^臺中[市縣]/, "");
  s = s.replace(/(\d+)段/g, (all, d: string) => {
    const n = Number.parseInt(d, 10);
    return n > 0 && n < 100 ? int2cn(n) + "段" : all;
  });
  const m = s.match(/^(.+?(?:大道|路|街)(?:[一二三四五六七八九十]+段)?)/);
  return m ? m[1] : "";
}

type Spot = { lat: number; lng: number; prec: 0 | 1 | 2 };

/**
 * 重劃區範圍（public/data/home-map-zones.json，前端畫範圍線用的同一個檔）：
 * 每一塊是好幾圈 [緯度, 經度]，有的圈是「洞」——跟 tc_areas 的 build_areas.inside() 一樣用奇偶規則，被奇數圈包住才算在區內。
 * 讀不到就回 null（點的那一欄不輸出，前端照舊自己算）。
 */
type Ring = readonly (readonly [number, number])[];
function readZones(): Ring[][] | null {
  try {
    const j: unknown = JSON.parse(
      readFileSync(
        join(process.cwd(), "public", "data", "home-map-zones.json"),
        "utf8"
      )
    );
    const z = isRecord(j) && Array.isArray(j.z) ? (j.z as unknown[]) : null;
    if (!z) return null;
    // 跟 home-map.js 一樣：名字、範圍線不齊的那一塊不算（前端的第幾塊照原檔順序對）
    return z.map(v =>
      isRecord(v) && typeof v.n === "string" && Array.isArray(v.r)
        ? (v.r as Ring[])
        : []
    );
  } catch {
    return null;
  }
}

function inRing(r: Ring, lat: number, lng: number): boolean {
  let o = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (
      r[i][0] > lat !== r[j][0] > lat &&
      lng <
        ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]
    )
      o = !o;
  }
  return o;
}

/** 這一點落在哪幾塊重劃區：第 k 塊在裡面就把第 k 個位元設成 1（0＝哪一塊都不在） */
function zoneMask(zones: Ring[][], lat: number, lng: number): number {
  let m = 0;
  zones.forEach((rings, k) => {
    if (k > 30) return;
    let n = 0;
    for (const r of rings) if (inRing(r, lat, lng)) n++;
    if (n % 2) m |= 1 << k;
  });
  return m;
}

/**
 * 同一個位置有好幾間（同社區、同一條路）：繞著那一點排開，不然疊在一起點不到。
 * 社區的一圈約 14 公尺、路段的約 80 公尺；照物件代號的順序排，所以每次 build 結果一樣。
 */
function fanOut(spots: Spot[]): void {
  const groups = new Map<string, number[]>();
  spots.forEach((s, i) => {
    if (!s.prec) return;
    const key = `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    idx.forEach((i, k) => {
      const s = spots[i];
      const step = s.prec === 2 ? 0.00013 : 0.00072;
      const rad = step * Math.sqrt(k + 0.5);
      const ang = k * 2.399963;
      s.lat += rad * Math.cos(ang);
      s.lng += rad * Math.sin(ang) * 1.09;
    });
  }
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** 小卡第二行的地點：對外可用的社區名；沒有就用清過的路段（去行政區前綴、去地號與巷弄號碼） */
function cardLabel(p: PropertyEntry): string {
  return (
    publicCommunityName(p.data) ||
    stripAddressDetail(cleanStreetArea(p.data.streetArea, p.data.district))
  );
}

/** 小卡縮圖：跟列表卡同一套（400 寬縮圖，縮圖不在就退回封面原圖）；沒有封面回空字串 */
function cardThumb(p: PropertyEntry): string {
  const cover = coverSrcOf(p.data.coverImage);
  if (!cover) return "";
  const url = coverThumb(cover, 400);
  // 只放本站的根目錄相對網址
  return url.startsWith("/") && !url.startsWith("//") ? url : "";
}

async function buildHomeMapData(): Promise<HomeMapData> {
  const districtIndex = new Map<string, number>(
    TAICHUNG_DISTRICTS.map((d, i) => [d, i] as const)
  );
  const active = await getCollection(
    "properties",
    ({ data }) => data.status === "active"
  ).catch(() => [] as PropertyEntry[]);
  const listings = active
    .filter(p => districtIndex.has(p.data.district))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 「新上架」沿用列表頁那一套：7 天內算新；超過三成都算新就整批不標（那是同步日造成的假象）
  const now = Date.now();
  const metas = listings.map((p, idx) => buildCardMeta(p, idx, now));
  const showNew = shouldShowNewBadge(metas);

  const places = readPlaces();
  let hidden = 0; // 位置檔有這個社區，但社區名不能對外用 → 改用路段
  const spots = listings.map((p): Spot => {
    const d = p.data.district;
    const raw = p.data.community ?? "";
    const c = places.c.get(d)?.get(normCommunity(raw));
    if (c) {
      if (publicCommunityName(p.data) && !ADDR_LIKE.test(raw)) {
        return { lat: c[0], lng: c[1], prec: 2 };
      }
      hidden++;
    }
    const r = places.r.get(d)?.get(roadKeyOf(p.data.streetArea ?? "", d));
    return r ? { lat: r[0], lng: r[1], prec: 1 } : { lat: 0, lng: 0, prec: 0 };
  });
  // 落在哪一塊重劃區要在排開「之前」算：同一條路好幾間時，排開會把點推出去一百多公尺，
  // 推進範圍線裡就會被算成「港區市鎮中心」這種區內物件（2026-11-17 審查：臨港路四段 2 間被多算）
  const zones = readZones();
  const masks = spots.map(s =>
    zones && s.prec ? zoneMask(zones, s.lat, s.lng) : 0
  );
  fanOut(spots);

  const perDistrict = new Map<string, number>();
  const pointRows = listings.map((p, i) => {
    const d = p.data.district;
    perDistrict.set(d, (perDistrict.get(d) ?? 0) + 1);
    const rooms = p.data.layout.match(/(\d+)\s*房/);
    const s = spots[i];
    const row = [
      districtIndex.get(d) ?? 0,
      Math.round(p.data.totalPrice),
      rooms ? Number.parseInt(rooms[1], 10) : 0,
      typeIndex(p),
      showNew && metas[i].newListing ? 1 : 0,
      s.prec ? round5(s.lat) : 0,
      s.prec ? round5(s.lng) : 0,
      s.prec,
    ];
    // 第 9 欄：落在哪幾塊重劃區（位元，排開之前算的）；範圍檔讀不到就不放，前端自己算
    if (zones) row.push(masks[i]);
    return row;
  });
  const cardRows = listings.map(p => [
    p.id,
    Math.round(p.data.area * 10) / 10,
    cardLabel(p),
    cardThumb(p),
  ]);

  // 兩個檔的列要一一對上：放同一把鑰匙（物件清單的雜湊），前端兩邊不同（剛好遇到換版）就不出小卡，免得價錢配到別間的照片
  const k = createHash("sha1")
    .update(listings.map(p => p.id).join(","))
    .digest("hex")
    .slice(0, 10);
  const points = JSON.stringify({
    v: 1,
    k,
    d: [...TAICHUNG_DISTRICTS],
    // 分區列表頁 /properties/{slug}/ 只為有在售物件的區產生；沒有那一頁的區給空字串
    s: TAICHUNG_DISTRICTS.map(d =>
      perDistrict.get(d) ? (getDistrictSlug(d) ?? "") : ""
    ),
    t: [...TYPE_NAMES],
    p: pointRows,
  });
  const cards = JSON.stringify({ v: 1, k, c: cardRows });

  const community = spots.filter(s => s.prec === 2).length;
  const road = spots.filter(s => s.prec === 1).length;
  // eslint-disable-next-line no-console -- build 記錄要看得到地圖這次吃到幾筆位置
  console.log(
    `[home-map] listings ${listings.length} · located ${community + road} (community ${community}, road ${road}) · places file ${places.present ? "present" : "missing"} · community name not public ${hidden}`
  );

  return {
    points,
    cards,
    ver: createHash("sha1")
      .update(points + cards)
      .digest("hex")
      .slice(0, 10),
    count: listings.length,
    located: community + road,
  };
}

let memo: Promise<HomeMapData> | undefined;

/** 首頁地圖資料；同一次 build（同一個行程）只算一次 */
export function getHomeMapData(): Promise<HomeMapData> {
  memo ??= buildHomeMapData();
  return memo;
}
