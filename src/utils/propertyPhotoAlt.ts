/**
 * 物件照片 alt ＋ 對外可用的社區名／路段（2026-10-03，稽核 X032／F040／F101）
 *
 * 以前照片 alt 是「行銷標題（第 N 張，共 M 張）」：廣告詞、誇大字、甚至未完工建設
 * 跟著標題被灌進 alt，同一張照片在 DOM 裡又重複 2–3 次。改成只用事實欄位：
 *   「社區名・格局 照片 第 N 張」，社區名不能用就退回行政區。
 *
 * ⛔ alt 不放 streetArea：HG0238992 的 streetArea 是「南興段717、718地號」，
 *    地號跟門牌一樣能指到那一戶（CLAUDE.md 隱私邊界：本戶只寫到路名）。
 *    最後再用 /\d+\s*(巷|弄|號).*\/ 保險切一次，防將來資料變動。
 */
import { hasExaggeration } from "@/utils/cleanPropertyTitle";

type PhotoAltData = {
  community?: string;
  district: string;
  layout?: string;
};

/** 社區名太長（多半是把案名殘段塞進 community）或含誇大字時不對外用 */
const COMMUNITY_MAX_CHARS = 12;
/**
 * 同事把案名賣點塞進 community 欄位的常見字（2026-10-03 逐筆看過在售 431 筆）：
 * 「優質生活圈新裝潢質感」「套房價買435坪大地坪」「都計內埔里鎮自己蓋」「北區錦祥街大中島2樓」
 * 「大鑫大心角間夾層大面寬」「大地球社區高樓視野收租」——這些不是社區名，不放進標題／alt。
 */
const COMMUNITY_COPY_RE =
  /裝潢|質感|優質|視野|收租|總價|大坪數|面寬|夾層|可停|自己蓋|價買|角間|\d+\s*(?:坪|樓)/;

/**
 * 可以放進標題／描述／alt 的社區名；不符合條件回傳空字串。
 * 條件：有值、≤12 個字、不含誇大／預測字、不是行政區名的一部分（例「南投」）、
 * 不含賣點用語（COMMUNITY_COPY_RE）。
 * 物件頁 SEO 標題、描述事實句、規格卡事實句、照片 alt 共用這一個判斷。
 */
export function publicCommunityName(data: { community?: string; district?: string }): string {
  const c = (data.community ?? "").trim();
  if (!c) return "";
  if ([...c].length > COMMUNITY_MAX_CHARS) return "";
  if (hasExaggeration(c)) return "";
  if (COMMUNITY_COPY_RE.test(c)) return "";
  if (data.district && data.district.includes(c)) return "";
  return c;
}

/**
 * 地址細節保險切：地號（「717、718地號」）與巷弄號碼一律砍掉，只留到路名／段名。
 * 給 streetArea 這種「理論上只到路段」的欄位做最後一道防線。
 */
export function stripAddressDetail(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\d０-９][\d０-９、,，\-－~～之及與和]*\s*地號.*$/, "")
    .replace(/\d+\s*(巷|弄|號).*/, "")
    .replace(/[\s、,，・·\-－]+$/, "")
    .trim();
}

export function photoAlt(data: PhotoAltData, i: number): string {
  const name = publicCommunityName(data) || data.district;
  const layout = (data.layout ?? "").trim();
  const head = (layout && layout !== "—" ? `${name}・${layout}` : name)
    .replace(/\d+\s*(巷|弄|號).*/, "")
    .trim();
  // 保險切只切前半段，「照片 第 N 張」固定接在後面（社區名像「精銳軟園1號B區」時才不會連序號一起被切掉）
  return `${head || data.district} 照片 第 ${i + 1} 張`;
}
