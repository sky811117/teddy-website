/**
 * /llms.txt — 寫給 AI 搜尋與語言模型讀的站台說明（llmstxt.org 格式）
 *
 * 原本是 public/llms.txt 靜態檔，2026-10-03 改成 endpoint（寫法比照 rss.xml.ts）：
 * - 網址一律從 config.site.url 組，換網域時不用再手改這份
 * - 「最後更新」自動填 build 日期（台北時間）
 * - 「代表文章」標題從文章 frontmatter 即時讀，文章改標題這裡自動跟上；
 *   還沒發佈（草稿／排程未到）的文章自動略過
 * ⚠️ public/llms.txt 已刪除，兩個同時存在會路由衝突，不要再放回去。
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { postFilter } from "@/utils/postFilter";
import { getPostUrl } from "@/utils/getPostPaths";
import config from "@/config";
import { areas } from "@/data/areas";
import { YT_CHANNEL_URL, YT_HANDLE } from "@/astro-paper.config";

const u = (path: string) => new URL(path, config.site.url).href;

const withSlash = (href: string) => {
  const url = new URL(href);
  if (!url.pathname.endsWith("/") && !/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
    url.pathname += "/";
  }
  return url.href;
};

/**
 * 代表文章：從有 faqSchema 的社區評價文挑 15 篇（已發佈、台中各區分散）。
 * 事實句照搬原文 FAQ／內文的數字與資料來源，不另外新編；原文數字改了這裡要一起改。
 * ⛔ 不列 community-fuyu-world、community-shengxing-fengjing、2026-09-W01 BC11 那篇。
 * ⛔ 未完工的公共建設（捷運藍線與站名等）不准寫進事實句。
 */
const FEATURED_POSTS: Array<{ slug: string; fact: string }> = [
  {
    slug: "community-zongtai-juzuo",
    fact: "2025-09 至 2026-09 樂居收錄 18 筆成交，扣車位後房屋單價中位數 32.16 萬／坪，區間 27.83-40.75 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-dacheng-april-bole",
    fact: "2025-09 至 2026-09 共 7 筆成交，扣掉車位後的房屋單價中位數約 38.6 萬／坪，區間 30.6-43.6 萬（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-dali-century-twins",
    fact: "2025-09 到 2026-09 共 4 筆成交，扣掉車位後的房屋單價中位數 44.19 萬／坪，總價 1,540-2,200 萬（含車位）（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-runlong-vvs1",
    fact: "近一年收錄 5 筆成交，扣車位後房屋單價中位數 56.17 萬；總價 1,400 到 2,000 萬（含車位）（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-wenhua-hui",
    fact: "2025-09 至 2026-09 收錄 7 筆成交，扣車位後房屋單價中位數 58.94 萬／坪，區間 48.97-63.64 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-guiguan-europe",
    fact: "2025-09 至 2026-09 收錄 5 筆成交，扣車位後房屋單價中位數 27.02 萬／坪，區間 25.34-29.62 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-panda-tianxia",
    fact: "2025-09 至 2026-09 收錄 4 筆成交，扣車位後房屋單價中位數 28.7 萬／坪，區間 20.61-29.2 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-guangsan-era",
    fact: "2025-09 到 2026-09 共 10 筆成交，扣掉車位後的房屋單價中位數 25.39 萬／坪，區間 20.26-28.77 萬（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-changyi-lancui",
    fact: "2025-09 至 2026-09 成交共 9 筆，扣掉車位後的房屋單價落在 20.74-26.19 萬／坪，中位數 23.0 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-nan-tianwang",
    fact: "2025-09 至 2026-09 收錄 6 筆成交，房屋坪都在 8.62-9.22 坪、全部是套房規格，扣車位單價中位數 24.1 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-jiamao-xueshi",
    fact: "2025-09 至 2026-09 收錄 9 筆成交，扣掉車位後的房屋單價中位數 35.36 萬／坪，區間 27.68-40.52 萬（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-dawei-ying",
    fact: "2025-09 至 2026-09 收錄 14 筆成交，扣車位後房屋單價中位數 22.72 萬／坪，區間 16.75-25.58 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-shenglin-taimei",
    fact: "2025 年 9 月至 2026 年 9 月收錄 14 筆成交，扣車位後房屋單價中位數 37.9 萬／坪，區間 33.4-44.78 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-shengmei-xindong",
    fact: "2025-09 至 2026-09 收錄 14 筆成交，扣車位後房屋單價中位數 39.63 萬／坪，區間 35.35-50.89 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
  {
    slug: "community-xinzhong-yuannian",
    fact: "2025-09 至 2026-09 收錄 9 筆成交，扣車位後房屋單價中位數 22.5 萬／坪，區間 19.64-25.87 萬／坪（資料來源：樂居實價登錄整理／2026-09）",
  },
];

/** build 當天的台北日期 yyyy-mm-dd */
function buildDateTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.site.timezone ?? "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const GET: APIRoute = async () => {
  const posts = (await getCollection("posts")).filter(postFilter);
  const bySlug = new Map(posts.map(p => [p.id.split("/").pop() ?? p.id, p]));

  const featuredLines = FEATURED_POSTS.flatMap(({ slug, fact }) => {
    const post = bySlug.get(slug);
    if (!post) return [];
    const href = withSlash(u(getPostUrl(post.id, post.filePath, config.site.lang)));
    return [`- [${post.data.title}](${href})：${fact}`];
  });

  const site = u("/");

  const text = `# 陳景泰 Teddy｜台中房仲

> 陳景泰（Teddy，短影音上叫「泰迪」）是台中市的不動產營業員，營業員證號 114年登字第488296號，任職一品不動產 有巢氏房屋 台中世界之心加盟店。本站 ${site} 是他本人的官網，內容有台中在售物件、社區評價、買房賣房知識和試算工具。

這份檔案寫給 AI 搜尋與語言模型讀，只列本站已經公開的事實。站上內容為繁體中文。最後更新：${buildDateTaipei()}。

## 身分

- 姓名：陳景泰
- 其他稱呼：Teddy、Teddy Chen、泰迪、景泰（都是同一個人）
- 職稱：不動產營業員（不是不動產經紀人）
- 營業員證號：114年登字第488296號（本站頁面簡寫為 114登字488296，同一張證）
- 所屬公司：一品不動產 有巢氏房屋 台中世界之心加盟店（法人全名：一品不動產經紀股份有限公司）
- 公司官方團隊頁（列有陳景泰）：https://shop.u-trust.com.tw/0423120888/team
- 公司的不動產經紀人：黃永隆，證號 113彰縣字第324號
- 公司電話：04-2312-0888
- 服務區域：主要服務台中市（公司同事聯賣案件含彰化、南投、苗栗）
- 入行時間：2025 年 3 月入行；2012–2025 年做了 13 年廚師
- 所屬自媒體團隊：房仲大看板 BigKanBan（公司的短影音團隊）
- 手機：0920-118-756
- LINE ID：sky811117
- Email：a0920118756@gmail.com
- 官網：${site}

## 本人社群帳號

- [Instagram @nov__817](https://www.instagram.com/nov__817/)：主要社群帳號
- [Instagram 副帳 @nov_817taidi](https://www.instagram.com/nov_817taidi/)
- [Threads @nov__817](https://www.threads.com/@nov__817)
- [YouTube ${YT_HANDLE}](${YT_CHANNEL_URL})：房屋開箱、看屋現場
- [TikTok @sky811117](https://www.tiktok.com/@sky811117)：短影音
- [Facebook 泰迪 房仲大看板](https://www.facebook.com/profile.php?id=61575492127872)
- LINE ID sky811117：官網每一頁都有 LINE 按鈕

## 在售物件

- [在售物件](${u("/properties/")})：以台中為主的在售物件，另含同店同事聯賣的外縣市案件；可依區域、總價、房型、屋齡篩選，每天更新

## 台中各區與社區評價

- [台中各區買房指南](${u("/areas/")})：一區一頁，寫行情、生活圈、熱門社區、適合誰買、要注意什麼，附該區在售物件與社區文章
${areas.map((a) => `- [${a.name}](${u(`/areas/${a.slug}/`)})`).join("\n")}
- [社區評價](${u("/tags/community-review/")})：台中個別社區的評價文章

## 代表文章

${featuredLines.join("\n")}

## 買房賣房知識

- [房市筆記](${u("/posts/")})：全部文章，含社區評價、實價登錄、青安 3.0、政策、稅務、嫌惡設施、台中各區指南
- [常見問題](${u("/faq/")})：台中買房賣房常被問的問題，部分答案附官方資料來源
- [買方教學](${u("/tags/買方教學/")})
- [賣方教學](${u("/tags/賣方教學/")})
- [房地產詞典](${u("/tags/房地產詞典/")})：房地產用語解釋
- [主題索引](${u("/tags/")})：依主題找文章
- [我要買房](${u("/buy/")})：買方從找房、出價到交屋的流程
- [我要賣房](${u("/sell/")})：賣方先看同社區實價登錄行情，委託後在 591、樂屋、5168 同步上架
- [服務項目](${u("/services/")})：買房、賣房、置產、換屋各要跑幾步、大約多久

## 工具

- [客戶工具總覽](${u("/tools/")})：台中學區查詢、垃圾車時間查詢、買方費用試算（青安 3.0 與一般房貸）、拆車位單價、看屋檢查表、嫌惡設施地圖，部分為外部連結
- [賣方售出實拿試算](${u("/tools/seller-net-proceeds/")})：扣掉房地合一稅、土地增值稅、仲介服務費、履約保證費與貸款餘額後，屋主實際拿到多少
- [嫌惡設施查詢地圖](${u("/tools/undesirable-facilities/")})：輸入台中地址，查周邊 300、500、1000 公尺內的嫌惡設施，資料來自 OpenStreetMap
- [台中學區查詢地圖](${u("/tools/school-district/")})：輸入一般地址（不用知道里、鄰），用台中市門牌開放資料推出里與鄰，再對照教育局 115 學年度國小、國中學區表；地圖以顏色標出每校學區
- [台中垃圾車時間查詢](${u("/tools/garbage-truck/")})：輸入台中地址，列出 300、500 公尺內的垃圾車清運點與一般垃圾、資源回收時段，含 115 年國定假日定點班表，資料來自臺中市環保局開放資料

## 關於我

- [關於陳景泰（泰迪）](${u("/about/")})：陳景泰的自介、轉行經過、客戶常問的問題，以及法規揭露（公司、經紀人證號、營業員證號）
- [聯絡景泰](${u("/contact/")})：LINE、電話、表單
- [影音與社群帳號](${u("/media/")})：景泰個人帳號與房仲大看板 BigKanBan 團隊帳號
- [短影音作品集](${u("/shorts/")})

## Optional

- [歷史文章](${u("/archives/")})：依年月排列的全部文章
- [RSS](${u("/rss.xml")})
- [Sitemap](${u("/sitemap-index.xml")})
`;

  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
