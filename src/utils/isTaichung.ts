/**
 * 行政區 → 縣市 對照（全站唯一一份，2026-09-06 收斂）
 *
 * frontmatter 沒有 city/county 欄位，只有 district（例「北屯區」「彰化市」），
 * 而且 properties-sync 抓下來的 district 有髒值（「南投中寮區」「南投縣國姓鄉」），
 * 所以要靠這份表 + 前綴猜測。properties/index.astro 與 properties/[...slug].astro
 * 以前各自維護一份、兩邊對不齊（明細頁缺桃園／台北／雲林／高雄／台南 →
 * 楠梓區物件的「其他物件」標題印成「其他其他物件」），現在一律 import 這裡。
 */
export const TAICHUNG_DISTRICTS = [
  "北屯區",
  "西屯區",
  "南屯區",
  "北區",
  "南區",
  "東區",
  "西區",
  "中區",
  "太平區",
  "大里區",
  "霧峰區",
  "烏日區",
  "大肚區",
  "沙鹿區",
  "梧棲區",
  "清水區",
  "大甲區",
  "外埔區",
  "大安區",
  "龍井區",
  "潭子區",
  "大雅區",
  "神岡區",
  "豐原區",
  "后里區",
  "東勢區",
  "和平區",
  "新社區",
  "石岡區",
] as const;

const TAICHUNG_SET = new Set<string>(TAICHUNG_DISTRICTS);

const NANTOU = ["南投市", "草屯鎮", "埔里鎮", "竹山鎮", "集集鎮", "名間鄉", "中寮鄉", "水里鄉", "魚池鄉", "國姓鄉", "信義鄉", "仁愛鄉", "鹿谷鄉"];
const CHANGHUA = ["彰化市", "和美鎮", "田中鎮", "二林鎮", "北斗鎮", "員林市", "溪湖鎮", "鹿港鎮", "大村鄉", "田尾鄉", "秀水鄉", "花壇鄉", "芬園鄉", "福興鄉", "線西鄉", "伸港鄉", "埔鹽鄉", "埔心鄉", "永靖鄉", "社頭鄉", "二水鄉", "竹塘鄉", "溪州鄉", "大城鄉", "芳苑鄉"];
const MIAOLI = ["苗栗市", "竹南鎮", "頭份市", "卓蘭鎮", "苑裡鎮", "通霄鎮", "後龍鎮", "獅潭鄉", "泰安鄉", "銅鑼鄉", "三義鄉", "西湖鄉", "造橋鄉", "公館鄉", "三灣鄉", "南庄鄉", "頭屋鄉"];
const TAOYUAN = ["中壢區", "八德區", "桃園區", "蘆竹區", "龜山區", "平鎮區", "楊梅區", "大溪區"];
// ⚠️ 台北的「大安區」跟台中的「大安區」同名：台中優先（先查 TAICHUNG），這裡不放大安區
const TAIPEI = ["內湖區", "信義區", "中山區", "松山區", "士林區", "北投區", "文山區", "萬華區", "大同區", "中正區", "南港區"];
const YUNLIN = ["斗六市", "斗南鎮", "虎尾鎮", "西螺鎮", "土庫鎮", "北港鎮"];
const KAOHSIUNG = ["楠梓區", "左營區", "鼓山區", "三民區", "苓雅區", "前鎮區", "鳳山區", "岡山區", "小港區"];
// ⚠️ 台南的「東區／北區／南區」跟台中同名：台中優先，這裡只放不撞名的
const TAINAN = ["安平區", "永康區", "安南區", "善化區", "新市區", "仁德區", "歸仁區"];

const COUNTY_MAP: Record<string, string> = {};
TAICHUNG_DISTRICTS.forEach(d => (COUNTY_MAP[d] = "台中市"));
NANTOU.forEach(d => (COUNTY_MAP[d] = "南投縣"));
CHANGHUA.forEach(d => (COUNTY_MAP[d] = "彰化縣"));
MIAOLI.forEach(d => (COUNTY_MAP[d] = "苗栗縣"));
TAOYUAN.forEach(d => (COUNTY_MAP[d] = "桃園市"));
TAIPEI.forEach(d => (COUNTY_MAP[d] = "台北市"));
YUNLIN.forEach(d => (COUNTY_MAP[d] = "雲林縣"));
KAOHSIUNG.forEach(d => (COUNTY_MAP[d] = "高雄市"));
TAINAN.forEach(d => (COUNTY_MAP[d] = "台南市"));

/** 髒 district 帶縣市前綴（例「南投中寮區」「南投縣國姓鄉」「臺中北屯」）的猜測順序 */
const PREFIX_GUESS: ReadonlyArray<readonly [string, string]> = [
  ["南投", "南投縣"],
  ["彰化", "彰化縣"],
  ["苗栗", "苗栗縣"],
  ["雲林", "雲林縣"],
  ["桃園", "桃園市"],
  ["台北", "台北市"],
  ["臺北", "台北市"],
  ["高雄", "高雄市"],
  ["台南", "台南市"],
  ["臺南", "台南市"],
  ["台中", "台中市"],
  ["臺中", "台中市"],
];

export const OTHER_COUNTY = "其他";

/** 縣市顯示順序（列表頁「更多區域」用，依在售筆數） */
export const COUNTY_ORDER = [
  "台中市",
  "彰化縣",
  "南投縣",
  "苗栗縣",
  "桃園市",
  "台北市",
  "雲林縣",
  "高雄市",
  "台南市",
  OTHER_COUNTY,
];

export function isTaichung(district: string | undefined): boolean {
  if (!district) return false;
  return (
    TAICHUNG_SET.has(district) ||
    district.startsWith("台中") ||
    district.startsWith("臺中")
  );
}

/** district → 「台中市」「彰化縣」…；認不出來回 OTHER_COUNTY（「其他」） */
export function getCounty(district: string | undefined): string {
  if (!district) return OTHER_COUNTY;
  if (COUNTY_MAP[district]) return COUNTY_MAP[district];
  for (const [prefix, county] of PREFIX_GUESS) {
    if (district.startsWith(prefix)) return county;
  }
  return OTHER_COUNTY;
}
