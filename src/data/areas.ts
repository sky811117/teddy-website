// 台中 7 區 — 景泰主跑區深度頁資料
//
// 每區獨立 URL /areas/{slug}，命中各自的長尾關鍵字
// 共用此資料：/areas (總覽) + /areas/[district] (深度頁)

export type Community = {
  name: string;
  // 對應 src/content/posts/community-{postSlug}.md，沒寫 deep-dive 文的留空
  postSlug?: string;
  note?: string;
};

export type AreaStat = {
  label: string;
  value: string;
  trend?: string; // 例 "↗" / "↘" / "→" / "🔥"
};

export type AreaFAQ = {
  q: string;
  a: string;
};

export type Area = {
  slug: string;            // URL slug 例 "north-tun"
  name: string;            // 顯示名 例「西屯區（含七期）」
  shortName: string;       // 短名 例「西屯區」(breadcrumb / schema)
  emoji: string;
  headline: string;
  summary: string;
  // properties filter 用：data.district 命中任一即列入該區
  districtMatch: string[];
  stats: AreaStat[];
  hotCommunities: Community[];
  suitableFor: string[];
  avoidIf: string[];
  faqs: AreaFAQ[];
  // 對應 posts tag (連到 /tags/{tag})
  relatedTag?: string;
};

export const areas: Area[] = [
  {
    slug: "north-tun",
    name: "北屯區",
    shortName: "北屯區",
    emoji: "🏗️",
    headline: "預售屋大爆發、新青安族最熱",
    summary:
      "2026 Q1 預售屋成交 72 件（全市最多）— 北屯特區、廍子、機捷段是主要案源。成屋反而冷、新成屋議價空間大。",
    districtMatch: ["北屯區"],
    stats: [
      { label: "預售屋平均單價", value: "35-40 萬/坪", trend: "↗" },
      { label: "成屋大樓單價", value: "35 萬/坪", trend: "→" },
      { label: "透天單價", value: "33 萬/坪", trend: "→" },
      { label: "Q1 成交大樓", value: "15 件" },
      { label: "Q1 成交預售", value: "72 件", trend: "🔥 全市最多" },
    ],
    hotCommunities: [
      { name: "總太心之所向", postSlug: "community-zongtai-heart" },
      { name: "總太 2020", postSlug: "community-zongtai-2020" },
      { name: "皇普莊園" }, // 主要在北區，但北屯買家也常看
      { name: "宏總加州" },
    ],
    suitableFor: [
      "首購族新青安",
      "三代同堂自住",
      "投資新案",
    ],
    avoidIf: [
      "想要快速增值（已被炒過一輪）",
      "預算 1000 萬以下（新案多 1500+）",
    ],
    faqs: [
      {
        q: "北屯預售屋這麼多、真的還有議價空間嗎？",
        a: "有，但要分案。剛公開的旗艦案幾乎沒空間（建商還在試水溫）；已完銷餘戶或快交屋的小坪數，9.2-9.5 折是常見落點。我手上有幾個案場「同戶型最近成交價」可參考，LINE 問我哪個案就傳給你。",
      },
      {
        q: "廍子重劃區 vs 北屯特區、差別在哪？",
        a: "廍子（環太路一帶）屋齡新、生活機能還在養（重劃區常態），建商案多、單坪 33-38 萬。北屯特區（崇德路後段）發展早 5-8 年、機能成熟、屋齡兩極化、單坪 30-42 萬都有。看你要「住起來方便」還是「等增值」。",
      },
      {
        q: "新青安在北屯能用嗎？",
        a: "可以但要選總價 1000 萬以下的物件 — 北屯新案大多超過 1500 萬、不符合資格。中古大樓比較有機會：2-3 房、25-30 坪、屋齡 10-15 年，總價落在 800-1000 萬的可以鎖定。",
      },
    ],
    relatedTag: "北屯區",
  },
  {
    slug: "west-tun",
    name: "西屯區（含七期）",
    shortName: "西屯區",
    emoji: "🏙️",
    headline: "七期效應外溢、單價跳到 42 萬",
    summary:
      "2026 年 2 月大樓單價 42.92 萬/坪、單月跳 4.2 萬。七期黃金段 + 文心路 + 河南路是主軸。預售 + 成屋雙熱。",
    districtMatch: ["西屯區"],
    stats: [
      { label: "大樓平均單價", value: "42.92 萬/坪", trend: "🔥 全市最高" },
      { label: "透天單價", value: "41 萬/坪", trend: "↗" },
      { label: "套房單價", value: "28 萬/坪" },
      { label: "Q1 成交成屋", value: "41 件" },
      { label: "Q1 成交預售", value: "46 件" },
    ],
    hotCommunities: [
      { name: "滿庭芳花園", postSlug: "community-mantingfang" },
      { name: "佳茂世界之心", postSlug: "community-16-shijie-zhixin" },
      { name: "聯聚中雍" },
      { name: "網銀國際" },
    ],
    suitableFor: [
      "高資產族",
      "企業主自住",
      "投資七期長線",
    ],
    avoidIf: [
      "首購預算 1500 以下",
      "想要透天獨棟（七期幾乎沒透天）",
    ],
    faqs: [
      {
        q: "七期 vs 一般西屯、差多少？",
        a: "同樣權狀 50 坪、屋齡 10 年、3 房：七期黃金段（市政路、惠中路）開價落在 2400-3200 萬；一般西屯（青海路、河南路後段）落在 1600-2200 萬。差價主要在「七期門牌」的轉手優勢。",
      },
      {
        q: "七期 42 萬還會漲嗎？",
        a: "短線（半年內）我不會押會漲。2026 年 2 月一口氣跳 4.2 萬是「成交少 + 案例極端」造成的波動。長線（3-5 年）看：(1) 重劃區土地用光 (2) 大企業總部進駐 (3) 高資產換屋潮。這 3 個都還在，所以不容易跌。",
      },
      {
        q: "想買七期但預算只有 2000 萬有可能嗎？",
        a: "可能，但要放寬條件：(1) 七期邊緣（朝富路、市政路尾段）的 20+ 年大樓 (2) 30 坪以下的小坪數 (3) 中低樓層或邊間採光普通的戶別。我手上有 3-4 戶這種「七期門牌但條件 trade-off」的物件，LINE 問我「七期 2000 萬」傳清單給你。",
      },
    ],
    relatedTag: "西屯區",
  },
  {
    slug: "south-tun",
    name: "南屯區",
    shortName: "南屯區",
    emoji: "🌳",
    headline: "大樓連 3 月下跌、是修正還是陷阱",
    summary:
      "2026 Q1 大樓單價 34→32→30 萬/坪、連跌 3 月。但黎明特區、向上市場周邊仍熱。透天暴跌要謹慎。",
    districtMatch: ["南屯區"],
    stats: [
      { label: "大樓平均單價", value: "30.62 萬/坪", trend: "↘ 連跌 3 月" },
      { label: "透天單價", value: "25.63 萬/坪", trend: "↘ 暴跌" },
      { label: "Q1 成交成屋", value: "35 件" },
      { label: "Q1 成交預售", value: "38 件" },
    ],
    hotCommunities: [
      { name: "富宇世界花園", postSlug: "community-fuyu-world" },
      { name: "向上市場周邊新案" },
    ],
    suitableFor: [
      "想撿便宜的自住族",
      "南屯舊住戶換屋",
    ],
    avoidIf: [
      "短線投資（趨勢偏弱）",
      "想要快速增值",
    ],
    faqs: [
      {
        q: "南屯大樓連跌 3 個月、是不是該等？",
        a: "看你買的目的。自住：如果遇到喜歡的物件、預算 OK，跌 3 個月對你 20 年自住影響有限，別過度擇時。投資：那真的要等成交量回來再看，現在出手可能再扛 6-12 個月帳面跌幅。",
      },
      {
        q: "黎明特區跟其他南屯、差多少？",
        a: "黎明特區（黎明路、向上市場一帶）生活機能最成熟、單坪 32-38 萬、抗跌。其他南屯（南屯路後段、五權西路）28-32 萬、跌得比較明顯。差距大約 4-6 萬/坪。",
      },
      {
        q: "南屯透天暴跌、敢碰嗎？",
        a: "我的態度是：透天看「地段 + 條件」遠勝看「平均單價」。南屯透天暴跌是因為近期成交集中在面寬窄、邊間採光差、屋齡老的個案。如果你看的是雙面採光、面寬 5+ 米、屋齡 15 年內的，那 25 萬/坪以下其實是進場點。",
      },
    ],
    relatedTag: "南屯區",
  },
  {
    slug: "north-district",
    name: "北區",
    shortName: "北區",
    emoji: "🏛️",
    headline: "老社區翻新潮、中古屋低點進場",
    summary:
      "美麗殿 31 年、皇普莊園 2 年新 — 屋齡兩極化。中古屋單價 23-28 萬 / 新案 33-40 萬。一中商圈周邊熱。",
    districtMatch: ["北區"],
    stats: [
      { label: "大樓中位單價", value: "30 萬/坪" },
      { label: "華廈單價", value: "21 萬/坪" },
      { label: "Q1 成交成屋", value: "34 件" },
      { label: "Q1 成交預售", value: "4 件" },
    ],
    hotCommunities: [
      { name: "美麗殿", postSlug: "community-meili-dian" },
      { name: "皇普莊園", postSlug: "community-huangpu-manor" },
      { name: "微笑世紀雲品", postSlug: "community-smile-century-yunpin" },
      { name: "麗園道", postSlug: "community-liyuandao" },
    ],
    suitableFor: [
      "首購中古屋族",
      "想要一中商圈生活機能",
    ],
    avoidIf: [
      "想要新成屋（選擇少）",
      "怕老屋管線結構",
    ],
    faqs: [
      {
        q: "北區老屋一定要買嗎、有新案選擇嗎？",
        a: "有但少。Q1 北區預售屋成交只有 4 件、新成屋（5 年內）約佔總成交 8%。要新案大概只能鎖定皇普莊園、微笑世紀雲品這幾個社區。其他都是 20+ 年中古。",
      },
      {
        q: "一中商圈周邊真的適合自住嗎？",
        a: "看你接受度。優點：步行 5 分鐘有 7-11、四海游龍、家樂福、捷運。缺點：學期間商圈吵到晚上 11 點、停車一位難求、租客多進出複雜。30 歲以下年輕族通常 OK、有小孩或長輩同住的我會推薦再往育德路 / 太原路一帶。",
      },
      {
        q: "北區老屋管線整理要花多少？",
        a: "基本（水電 + 油漆 + 廚具 + 衛浴）30 坪老公寓抓 80-120 萬。中等（連管線重拉 + 廚衛拉皮 + 地板）抓 200-300 萬。全包（連結構補強 + 全室裝修）抓 400-600 萬。買老屋前先抓裝修預算進總成本、別只看屋價。",
      },
    ],
    relatedTag: "北區",
  },
  {
    slug: "central-district",
    name: "中區",
    shortName: "中區",
    emoji: "🏯",
    headline: "舊城區重生、總價 500 萬以下選擇多",
    summary:
      "舊城區房價低、未滿 500 萬佔 27%。台中車站特定區計畫帶動翻新潮、但結構老化要評估。",
    districtMatch: ["中區"],
    stats: [
      { label: "大樓中位單價", value: "25 萬/坪" },
      { label: "未滿 500 萬物件佔比", value: "27%" },
      { label: "Q1 成交", value: "少 / 流動性低" },
    ],
    hotCommunities: [
      { name: "車站周邊老公寓翻新案" },
    ],
    suitableFor: [
      "低預算首購",
      "投資收租（短期租金回報率高）",
    ],
    avoidIf: [
      "想要新建案",
      "重視社區管理品質",
    ],
    faqs: [
      {
        q: "中區房子真的能買嗎？",
        a: "能買但要分用途。自住：除非你有舊城情結 + 願意承擔老屋翻新成本，不然我不會推薦。投資：總價 300-500 萬、租 1.2-1.8 萬、年回報 4-6% 是有的，但流動性低（轉手難）要先想好出場。",
      },
      {
        q: "投資中區收租會不會慘？",
        a: "不會慘但要選對物件。重點 3 個：(1) 走到台中車站 8 分鐘內 (2) 屋況可以直接入住不用大整 (3) 樓上樓下沒住特殊行業。符合這 3 個的、租客 90% 是台鐵高鐵通勤族 + 醫護學生，相對穩定。",
      },
      {
        q: "500 萬以下的中區物件、能貸款嗎？",
        a: "可以但成數會被砍。屋齡 40+ 年的老華廈、銀行通常貸 6-7 成（一般物件貸 8 成）。差的那 1-2 成要自備。另外、結構評估如果不過（海砂 / 輻射 / 嚴重傾斜）銀行直接不貸、要查清楚。",
      },
    ],
    relatedTag: "中區",
  },
  {
    slug: "taiping",
    name: "太平區",
    shortName: "太平區",
    emoji: "🌄",
    headline: "穩定上漲、北屯外溢買家首選",
    summary:
      "大樓近半年 28.70→30.04→30.34 萬/坪、穩漲。被北屯擠出的首購族最常落腳這。國光路 + 太平公園周邊熱。",
    districtMatch: ["太平區"],
    stats: [
      { label: "大樓平均單價", value: "30.34 萬/坪", trend: "↗ 穩漲" },
      { label: "透天單價", value: "32.31 萬/坪" },
      { label: "Q1 成交", value: "成屋穩定、預售有限" },
    ],
    hotCommunities: [
      { name: "春福興波", postSlug: "community-chunfu-xingbo" },
      { name: "陞霖執美" },
    ],
    suitableFor: [
      "首購族（北屯買不起）",
      "想透天的小家庭",
    ],
    avoidIf: [
      "重視商圈密度",
      "通勤不到台中市區",
    ],
    faqs: [
      {
        q: "太平比北屯便宜多少？",
        a: "同樣 3 房、屋齡 5 年、25 坪：北屯（廍子）大約 1300-1500 萬、太平（國光路一帶）大約 900-1100 萬。差 300-500 萬。透天的話差距更大。",
      },
      {
        q: "太平到台中市區、交通方便嗎？",
        a: "看你住哪段。靠國光路 / 太平公園的：開車 15 分鐘到一中商圈、20 分鐘到七期。靠 136 縣道後段（往新光、頭汴坑）：通勤 30+ 分鐘、塞車時 45 分鐘。買前先實際走過上下班時段。",
      },
      {
        q: "太平透天 vs 北屯大樓、哪個划算？",
        a: "看家庭結構。年輕夫妻 + 1 小孩：北屯大樓（管理服務 + 機能成熟）相對省心。三代同堂 / 多代家庭：太平透天（同價格能買到 3 樓 5 房）空間勝出很多。預算 1200-1500 萬這價位、兩邊都能買，差別是「住的形態」不是「划不划算」。",
      },
    ],
    relatedTag: "太平區",
  },
  {
    slug: "dali",
    name: "大里區",
    shortName: "大里區",
    emoji: "🌾",
    headline: "波動大、新成屋平均單價 31.55 萬",
    summary:
      "2026 Q1 大樓單價 30.94→25.85→31.55 萬/坪、波動大。新成屋 vs 中古屋差別大、要分清楚買哪種。",
    districtMatch: ["大里區"],
    stats: [
      { label: "大樓平均單價", value: "31.55 萬/坪", trend: "波動大" },
      { label: "透天單價", value: "34.08 萬/坪" },
      { label: "套房單價", value: "59 萬/坪", trend: "🔥 小坪數爆衝" },
    ],
    hotCommunities: [
      { name: "大里成功路新案" },
    ],
    suitableFor: [
      "想透天的首購族",
      "中科外圍工程師",
    ],
    avoidIf: [
      "套房投資（單價已過高）",
      "求穩定漲幅",
    ],
    faqs: [
      {
        q: "大里適合中科工程師嗎？",
        a: "看你在中科哪一園區。中科主園區（西屯）：大里到主園區開車 25-30 分鐘、塞車 40 分鐘、不建議。中科二期 / 中科精密機械園區（往大雅、潭子）：那大里更遠了。如果你在台中工業區（南屯）：大里 15-20 分鐘 OK。",
      },
      {
        q: "大里套房單價漲到 59 萬、合理嗎？",
        a: "不合理但有原因。59 萬是小坪數（10-15 坪）+ 新成屋 + 特定建案造成的「樣本偏誤」。實際大里中古套房（15-20 坪、屋齡 10 年）成交還是 25-35 萬/坪。買套房前要看「同類型 + 同屋齡 + 同坪數」的實價登錄、別被平均值騙。",
      },
      {
        q: "大里成功路新案、值得買嗎？",
        a: "看你比較對象。跟北屯廍子比：成功路新案單價 28-33 萬、便宜 5-8 萬/坪。跟太平國光路比：差不多。跟大里其他區段比：成功路是大里機能最成熟的一段、單坪會貴 3-5 萬。要不要買看你「願不願意為機能付溢價」。",
      },
    ],
    relatedTag: "大里區",
  },
];

export const areaSlugs = areas.map(a => a.slug);

export function getAreaBySlug(slug: string): Area | undefined {
  return areas.find(a => a.slug === slug);
}
