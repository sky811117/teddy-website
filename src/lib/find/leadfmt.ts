/**
 * 家用機沒接到（離線、收件模式、人機驗證服務連不上）時，由 Function 直接送給景泰的 Telegram 線索。
 * 這是「不丟線索」的最後一道：訊息只組我們自己的固定標籤與客人選的列舉值，聯絡方式只放客人同意留下的。
 *
 * 2026-10-06 紅隊修補（RT-07）：客人打的每一段文字（原話、稱呼、備註、LINE ID、電話、Email）都是「不可信輸入」：
 *  - 一律先過 normText（NFKC、換行類字元換空白、移除控制／格式／隱形字元）：客人沒辦法在訊息裡造出新的一行，
 *    也就偽造不出「看起來像系統產生」的行（例如貼在系統連結旁邊的假通知）。
 *  - 原話、稱呼、備註再過 hideLinks：看起來像網址（含 bit.ly 這類短網址）、Email、@帳號、#標籤、電話、身分證字號的字串
 *    換成「[已隱藏]」，不會變成可點的連結。
 *  - 每一段客人文字都包在 <code>…</code> 裡（等寬、視覺上跟系統固定文字分得開；Telegram 不會把 <code> 內的字串自動變成連結），
 *    而且全部 HTML 跳脫。系統產生的標籤放在 <code> 外面，客人文字出不了自己的框。
 * 客人原話只取前 120 字。
 */
import type { Consent, Contact, Context, Fields } from "./schema";
import { hideLinks, normText, scrub } from "./schema";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 客人文字的呈現方式：先正規化、再跳脫、再框起來（不放換行） */
const code = (s: string) => `<code>${esc(normText(s))}</code>`;

const TYPE_LABEL: Record<string, string> = { elevator_building: "電梯大樓", mid_rise: "華廈", apartment: "公寓", townhouse: "透天", studio: "套房" };
const PARKING_LABEL: Record<string, string> = { flat: "平面車位", ramp_flat: "坡道平面車位", mechanical: "機械車位", any: "有車位", none: "不需要車位" };
const STAGE_LABEL: Record<string, string> = { first: "第一次買", upgrade: "換屋", invest: "投資", browse: "還在看看" };
const TIMELINE_LABEL: Record<string, string> = { "3m": "3 個月內", "6m": "半年內", "12m": "一年內", browse: "還沒決定" };
const SPECIAL_LABEL: Record<string, string> = {
  school: "學區", market: "近市場、生活機能", low_public: "公設比低", lighting: "採光通風", pets: "可養寵物",
  elderly: "長輩友善", quiet: "安靜", transit: "交通方便（已通車路線）",
};
const CONCERN_LABEL: Record<string, string> = {
  budget_pressure: "預算壓力", loan: "貸款過不過", condition: "屋況（漏水、壁癌）", commute: "通勤時間", school: "孩子學區",
  elderly: "長輩的電梯與出入", price_unsure: "不知道行情、怕買貴", overwhelmed: "選擇太多不知道從哪看起", parking: "車位不好找",
  timing: "不確定現在是不是時機", no_chase: "不想被一直追問或打電話", other: "其他",
};
const DEV_LABEL: Record<string, string> = { m: "手機", d: "桌機", t: "平板", b: "不明" };
const PREF_LABEL: Record<string, string> = { line: "LINE", phone: "電話", email: "Email" };

/** 條件（系統固定文字，還沒跳脫）。社區名是客人打的字，不在這裡：formatLead 另外包 <code>；地圖範圍只寫點數，不寫座標 */
export function condParts(f: Fields): string[] {
  const p: string[] = [];
  if (f.zone) p.push("74環內");
  if (f.geo?.length) p.push(`地圖範圍（${f.geo.length} 個點）`);
  if (f.districts?.length) p.push(f.districts.join("、") + (f.road ?? ""));
  if (f.rooms_min !== undefined || f.rooms_max !== undefined) {
    if (f.rooms_min !== undefined && f.rooms_max !== undefined) p.push(f.rooms_min === f.rooms_max ? `${f.rooms_min} 房` : `${f.rooms_min}～${f.rooms_max} 房`);
    else if (f.rooms_min !== undefined) p.push(`${f.rooms_min} 房以上`);
    else p.push(`${f.rooms_max} 房以內`);
  }
  if (f.types?.length) p.push(f.types.map(t => TYPE_LABEL[t] ?? t).join("、"));
  if (f.price_min_wan !== undefined && f.price_max_wan !== undefined) p.push(`${f.price_min_wan}～${f.price_max_wan} 萬`);
  else if (f.price_max_wan !== undefined) p.push(`${f.price_max_wan} 萬以內`);
  else if (f.price_min_wan !== undefined) p.push(`${f.price_min_wan} 萬以上`);
  if (f.age_max !== undefined) p.push(`屋齡 ${f.age_max} 年內`);
  if (f.parking) p.push(PARKING_LABEL[f.parking] ?? f.parking);
  const fl: string[] = [];
  if (f.floor_exclude?.length) fl.push(`排除 ${f.floor_exclude.join("、")} 樓`);
  if (f.exclude_top) fl.push("不含頂樓");
  if (f.floor_min !== undefined) fl.push(`${f.floor_min} 樓以上`);
  if (fl.length) p.push(fl.join(" "));
  if (f.area_min_ping !== undefined && f.area_max_ping !== undefined) p.push(`${f.area_min_ping}～${f.area_max_ping} 坪`);
  else if (f.area_min_ping !== undefined) p.push(`${f.area_min_ping} 坪以上`);
  else if (f.area_max_ping !== undefined) p.push(`${f.area_max_ping} 坪以內`);
  return p;
}

export type LeadInput = {
  why: "intake" | "upstream_down" | "human_unverified";
  /** 冪等鍵前 6 碼：日後跟家用機的紀錄對帳用（不含個資） */
  ref?: string;
  fields: Fields;
  context: Context;
  free_text: string;
  contact: Contact | null;
  consent: Consent | null;
  from: string | null;
  dev: string;
};

/**
 * 聯絡方式那一行（已跳脫的 HTML）。客人留的每個值都放進 <code>；稱呼與備註另外過 hideLinks。
 * 備註放第二行（備註本身沒有換行，所以客人造不出第三行）。
 */
export function contactLine(c: Contact | null): string {
  if (!c) return esc("聯絡：未留聯絡方式（匿名，沒辦法主動回覆）");
  const items: string[] = [];
  if (c.line) items.push(`LINE ${code(c.line)}`);
  if (c.phone) items.push(`電話 ${code(c.phone)}`);
  if (c.email) items.push(`Email ${code(c.email)}`);
  const name = c.name ? hideLinks(c.name) : "";
  const note = c.note ? hideLinks(c.note) : "";
  return (
    `聯絡：${items.join("｜")}（客人已同意；偏好 ${esc(PREF_LABEL[c.pref] ?? "")}${name ? `；稱呼 ${code(name)}` : ""}）` +
    (note ? `\n備註：${code(note)}` : "")
  );
}

export function formatLead(i: LeadInput): string {
  // 每個元素都是「已跳脫的 HTML」；系統固定文字用 esc，客人文字用 code
  const lines: string[] = [esc("【找房小幫手｜收件】需要你親自回")];
  if (i.context.concerns?.includes("no_chase")) lines.push(esc("注意：客人明確不想被追問，只用文字、不要主動來電、不要連續追問。"));
  lines.push(
    esc(`來源：${i.from ?? "（無標記）"}｜${DEV_LABEL[i.dev] ?? "不明"}｜原因：${i.why === "intake" ? "收件模式" : i.why === "upstream_down" ? "後端沒接到" : "人機驗證服務連不上"}`),
  );
  if (i.ref) lines.push(esc("對帳碼：") + code(i.ref));
  const cond = condParts(i.fields).map(esc);
  if (i.fields.community) cond.unshift(`${code(hideLinks(i.fields.community))}社區`);   // 社區名是客人打的字：框起來，像網址／電話／帳號的字再遮掉
  lines.push(esc("條件：") + (cond.length ? cond.join(esc("｜")) : esc("（沒有抽到條件）")));
  const ctx: string[] = [];
  if (i.context.stage) ctx.push(STAGE_LABEL[i.context.stage] ?? i.context.stage);
  if (i.context.timeline) ctx.push(TIMELINE_LABEL[i.context.timeline] ?? i.context.timeline);
  if (i.context.special?.length) ctx.push(`特殊需求：${i.context.special.map(s => SPECIAL_LABEL[s] ?? s).join("、")}`);
  if (ctx.length) lines.push(esc(`補充：${ctx.join("｜")}`));
  lines.push(esc(`在意的事：${i.context.concerns?.length ? i.context.concerns.map(c => CONCERN_LABEL[c] ?? c).join("、") : "沒勾"}`));
  const ft = hideLinks(scrub(i.free_text).clean);
  if (ft) lines.push(esc("客人原話：") + code(Array.from(ft).slice(0, 120).join("")));
  lines.push(contactLine(i.consent ? i.contact : null));
  return limitLines(lines, 3500);
}

/**
 * Telegram 訊息上限 4096 字。各欄位本來就有長度上限，正常不會超過；萬一超過，只在「換行」處截斷：
 * 標籤（<code>…</code>）不會跨行，從行中間砍會留下沒閉合的標籤，Telegram 會整則拒收＝線索遺失。
 */
function limitLines(lines: string[], max: number): string {
  let out = "";
  for (const l of lines) {
    const next = out ? `${out}\n${l}` : l;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

export function formatContactLead(contact: Contact, consent: Consent | null): string {
  return [
    esc("【找房小幫手｜補留聯絡方式】"),
    contactLine(consent ? contact : null),
    esc("（需求內容見前一則通知；若沒有前一則，代表當時後端沒接到，客人條件請回頭問。）"),
  ].join("\n");
}
