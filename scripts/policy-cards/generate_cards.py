"""
8 篇政策深度解讀 IG 圖卡 batch generator
"""
import sys
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
"""8 篇政策深度解讀 IG 圖卡 batch generator

每篇 5 張 4:5（1080×1350）：
  - cover  : 標題 + 副標 + handle
  - bullet : 條列重點（社群圖卡 social-cards 橘白系版型）
  - number : 大數字試算（自訂版型，強調關鍵數據）
  - cta    : LINE 我 + 證號

使用：
  python generate_cards.py
  node screenshot.mjs <output_dir>
"""

from pathlib import Path

# ============ 品牌設定 ============
HANDLE = "@nov__817"
LINE_ID = "sky811117"
PHONE = "0920-118-756"
BROKER = "黃永隆 113彰縣字324"
AGENT = "陳景泰 114登字488296"
COMPANY = "一品不動產 / 有巢氏房屋台中世界之心店"

# ============ 8 篇內容定義 ============
POSTS = [
    {
        "id": "01",
        "slug": "新青安2",
        "cover": {
            "title": "新青安 2.0<br>完全解讀",
            "subtitle": "6 月底定案前<br>把所有風聲整理給你",
        },
        "bullet1": {
            "title": "2.0 可能怎麼變？",
            "items": [
                "1. 年齡可能放寬到 45 歲",
                "2. 額度可能提高到 1,200 萬",
                "3. 補貼從 0.375% 降到 0.25%",
                "4. 寬限期從 5 年縮到 3 年",
            ],
        },
        "number": {
            "title": "30 年差距",
            "big": "35 萬",
            "subtitle": "借 800 萬、30 年<br>新青安 vs 一般房貸<br>總利息差距",
        },
        "bullet2": {
            "title": "3 個族群這樣做",
            "items": [
                "38 歲以下、貸 800 萬以下 → 6/30 前送件",
                "40 歲以下、還在看房 → 觀望到 7 月初",
                "40 歲以上 → 等 2.0 放寬年齡再評估",
            ],
        },
        "cta": {
            "title": "不知道你<br>適合哪個？",
            "subtitle": "用 AI 幫你算 30 年總利息<br>看你能省多少",
        },
    },
    {
        "id": "02",
        "slug": "房地合一2",
        "cover": {
            "title": "房地合一 2.0<br>怎麼算？",
            "subtitle": "自住豁免 4 條件<br>賺 500 萬不用繳半毛稅",
        },
        "bullet1": {
            "title": "4 個級距稅率",
            "items": [
                "持有 2 年內 → 45%",
                "持有 2-5 年 → 35%",
                "持有 5-10 年 → 20%",
                "持有 10 年以上 → 15%",
            ],
        },
        "bullet2": {
            "title": "自住豁免 4 條件",
            "items": [
                "本人/配偶/未成年子女設籍",
                "持有並居住連續 6 年以上",
                "6 年內未曾辦過自住優惠",
                "出售前 6 年無營業、無出租",
            ],
        },
        "number": {
            "title": "稅差有多大",
            "big": "165 萬",
            "subtitle": "賺 500 萬<br>持有 5-10 年 vs 自住豁免<br>稅金差距",
        },
        "cta": {
            "title": "你的 4 條件<br>齊不齊？",
            "subtitle": "賣房前 1 週<br>讓我陪你逐條盤點",
        },
    },
    {
        "id": "03",
        "slug": "央行管制",
        "cover": {
            "title": "央行第 7 波<br>信用管制",
            "subtitle": "第二戶 5.5 成、第三戶 4 成<br>真實影響全解",
        },
        "bullet1": {
            "title": "貸款成數上限",
            "items": [
                "第一戶自住 → 無上限",
                "第二戶 → 5.5 成、無寬限",
                "第三戶 → 4 成、無寬限",
                "公司戶 / 餘屋 → 3 成",
            ],
        },
        "number": {
            "title": "第二戶換屋族",
            "big": "+450 萬",
            "subtitle": "買 1,800 萬<br>從 8 成貸降到 5.5 成<br>自備款多生 450 萬",
        },
        "bullet2": {
            "title": "簽約前 3 個必做",
            "items": [
                "1. 算清楚自己是第幾戶（家戶歸戶）",
                "2. 預估真實自備款（含仲介費、稅）",
                "3. 銀行端預審 → 拿核貸通知書",
            ],
        },
        "cta": {
            "title": "你算第幾戶？<br>能貸幾成？",
            "subtitle": "簽約前先預審<br>避免退斡賠錢",
        },
    },
    {
        "id": "04",
        "slug": "不動產說明書",
        "cover": {
            "title": "不動產說明書<br>30 個欄位",
            "subtitle": "賣方漏勾 1 個<br>可能要賠 200 萬",
        },
        "bullet1": {
            "title": "5 個最容易出事的欄位",
            "items": [
                "凶宅（不分年限，知悉就要揭）",
                "漏水（含已修繕、樓上漏到你家）",
                "海砂屋、輻射屋（強制驗）",
                "違建（84/1 後加蓋必揭）",
                "嫌惡設施（300 公尺內全揭）",
            ],
        },
        "number": {
            "title": "凶宅漏勾代價",
            "big": "200 萬",
            "subtitle": "去年真實判例<br>屋主以為「20 年前不算」<br>法院判賠 200 萬",
        },
        "bullet2": {
            "title": "賣方 4 個揭露功課",
            "items": [
                "委託前 1 週自盤 30 欄",
                "簽委託時逐條確認、有疑慮就揭",
                "保留簽過的說明書副本",
                "「我不知道」不是免責理由",
            ],
        },
        "cta": {
            "title": "30 欄揭露<br>checklist",
            "subtitle": "賣房前先逐條對<br>LINE 我索取電子版",
        },
    },
    {
        "id": "05",
        "slug": "履約保證",
        "cover": {
            "title": "履約保證制度<br>完全解讀",
            "subtitle": "你的 1,500 萬<br>到底躺在哪？",
        },
        "bullet1": {
            "title": "3 種履保版本",
            "items": [
                "建經公司型 → 0.06%、最常見",
                "銀行型 → 0.1-0.15%、豪宅用",
                "仲介自家擔保 → 不要接受",
            ],
        },
        "number": {
            "title": "費用 vs 保障",
            "big": "4,500 元",
            "subtitle": "1,500 萬交易<br>履保費總額 9,000<br>買賣雙方各半",
        },
        "bullet2": {
            "title": "履保保護你 5 件事",
            "items": [
                "賣方拿錢跑路 → 錢還在信託",
                "過戶期間賣方死亡 → 可退款",
                "過戶後發現海砂 → 凍結未撥款",
                "買方貸款核不下來 → 退款",
                "仲介公司倒閉 → 跟你的錢無關",
            ],
        },
        "cta": {
            "title": "履保合約<br>怎麼看？",
            "subtitle": "5 項必檢清單<br>LINE 我索取",
        },
    },
    {
        "id": "06",
        "slug": "房屋稅2",
        "cover": {
            "title": "房屋稅 2.0<br>囤房稅",
            "subtitle": "全國歸戶後<br>3 間房稅金漲 2.5 倍",
        },
        "bullet1": {
            "title": "4 種自住認定稅率",
            "items": [
                "全國單一自住 → 1%（降稅）",
                "多戶自住 2-3 戶 → 1.2%",
                "非自住 2-4 戶 → 2.0-3.6%",
                "非自住 5 戶以上 → 3.0-4.8%",
            ],
        },
        "number": {
            "title": "4 屋投資族",
            "big": "+150%",
            "subtitle": "原本台中市歸戶<br>新版全國歸戶累進<br>稅金可能漲 50-150%",
        },
        "bullet2": {
            "title": "4 個自住認定雷區",
            "items": [
                "戶籍在 A、住 B → 認定不清",
                "親戚住、沒收租 → 要有證據",
                "登記公司行號 → 變非住家",
                "跨縣市分散 → 全國歸戶照樣中",
            ],
        },
        "cta": {
            "title": "全國持有<br>戶數盤點",
            "subtitle": "算清楚每間實際投報率<br>LINE 我幫你算",
        },
    },
    {
        "id": "07",
        "slug": "地價稅",
        "cover": {
            "title": "地價稅<br>完全解讀",
            "subtitle": "11 月開徵前<br>9/22 申辦自用住宅優惠",
        },
        "bullet1": {
            "title": "自用住宅 4 條件",
            "items": [
                "本人/配偶/直系親屬設籍",
                "無營業用、無出租",
                "全國 3 處內歸戶",
                "都市 90 坪 / 非都市 210 坪內",
            ],
        },
        "number": {
            "title": "差多少？",
            "big": "5-27 倍",
            "subtitle": "自用住宅 0.2%<br>vs 一般 1.0-5.5%<br>累進級距差距",
        },
        "bullet2": {
            "title": "買方 3 個功課",
            "items": [
                "看物件問清楚土地持分",
                "簽約後 30 天內申辦自用",
                "9/22 前完成、當年才適用",
            ],
        },
        "cta": {
            "title": "9/22 前<br>申辦自用住宅",
            "subtitle": "省 1-7 萬/年<br>LINE 我教你流程",
        },
    },
    {
        "id": "08",
        "slug": "平均地權",
        "cover": {
            "title": "預售屋<br>平均地權條例",
            "subtitle": "紅單禁炒、私法人限購<br>檢舉獎 1 億",
        },
        "bullet1": {
            "title": "5 大修法重點",
            "items": [
                "1. 預售屋換約轉售 → 禁止",
                "2. 散布不實資訊炒作 → 重罰",
                "3. 檢舉獎金 → 罰金 20%",
                "4. 私法人購屋 → 許可制",
                "5. 解約 30 日內申報",
            ],
        },
        "number": {
            "title": "轉手 5 戶代價",
            "big": "1,500 萬",
            "subtitle": "今年 3 月真實案例<br>每戶罰 300 萬 × 5<br>+ 沒收差價 800 萬",
        },
        "bullet2": {
            "title": "3 個合法解約情形",
            "items": [
                "配偶/直系親屬/繼承人之間",
                "非自願（失業、重大傷病、災害）",
                "同建案、同戶內換戶",
            ],
        },
        "cta": {
            "title": "預售屋<br>能不能買？",
            "subtitle": "5 年內不能轉<br>下手前讓我幫你評估",
        },
    },
]

# ============ HTML 版型 ============

COVER_HTML = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>Cover {ID}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  .card {{
    width: 1080px;
    height: 1350px;
    background: #fff;
    position: relative;
    overflow: hidden;
    font-family: 'Noto Sans TC', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }}
  .card::before {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 720px;
    background: linear-gradient(180deg, rgba(231,155,80,0.28) 0%, rgba(231,155,80,0.08) 65%, transparent 100%);
    pointer-events: none;
  }}
  .card::after {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background-image:
      linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
  }}
  .tag {{
    position: absolute;
    top: 90px;
    left: 90px;
    background: #E27F2E;
    color: #fff;
    font-size: 28px;
    font-weight: 700;
    padding: 12px 28px;
    border-radius: 999px;
    letter-spacing: 2px;
  }}
  .num {{
    position: absolute;
    top: 90px;
    right: 90px;
    font-size: 32px;
    font-weight: 700;
    color: rgba(0,0,0,0.25);
    font-family: 'Inter', sans-serif;
  }}
  .title {{
    font-weight: 900;
    font-size: 96px;
    color: #1a1a1a;
    text-align: center;
    line-height: 1.3;
    margin-bottom: 40px;
    padding: 0 60px;
  }}
  .divider {{
    width: 100px;
    height: 6px;
    background: #E27F2E;
    border-radius: 3px;
    margin-bottom: 44px;
  }}
  .subtitle {{
    font-weight: 500;
    font-size: 42px;
    color: #40444D;
    text-align: center;
    line-height: 1.7;
    padding: 0 80px;
  }}
  .handle {{
    position: absolute;
    bottom: 60px;
    left: 90px;
    font-family: 'Inter', sans-serif;
    font-size: 32px;
    font-weight: 600;
    color: rgba(0,0,0,0.35);
  }}
  .footer {{
    position: absolute;
    bottom: 60px;
    right: 90px;
    text-align: right;
    color: rgba(0,0,0,0.35);
    font-size: 24px;
    font-weight: 500;
  }}
</style>
</head>
<body>
<div class="card">
  <span class="tag">政策深度解讀</span>
  <span class="num">{ID}/08</span>
  <h1 class="title">{TITLE}</h1>
  <div class="divider"></div>
  <p class="subtitle">{SUBTITLE}</p>
  <span class="handle">{HANDLE}</span>
  <div class="footer">陳景泰 · 房仲說政策</div>
</div>
</body>
</html>
"""

BULLET_HTML = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>Bullet {ID}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  .card {{
    width: 1080px;
    height: 1350px;
    background: #F6F7F8;
    position: relative;
    overflow: hidden;
    font-family: 'Noto Sans TC', sans-serif;
    padding: 110px 80px 120px;
    display: flex;
    flex-direction: column;
  }}
  .card::before {{
    content: '';
    position: absolute;
    top: 0; left: 227px;
    width: 626px; height: 16px;
    background: #E27F2E;
  }}
  .card::after {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background-image:
      linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
  }}
  .title {{
    font-weight: 900;
    font-size: 72px;
    color: #1a1a1a;
    line-height: 1.35;
    margin-bottom: 60px;
    position: relative;
    z-index: 1;
  }}
  .title::after {{
    content: '';
    display: block;
    width: 80px;
    height: 5px;
    background: #E27F2E;
    margin-top: 24px;
    border-radius: 3px;
  }}
  .bullet-list {{
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 32px;
    flex: 1;
    position: relative;
    z-index: 1;
  }}
  .bullet-item {{
    display: flex;
    gap: 30px;
    align-items: flex-start;
    background: #fff;
    padding: 28px 32px;
    border-radius: 16px;
    border-left: 6px solid #E27F2E;
    box-shadow: 0 4px 16px rgba(0,0,0,0.04);
  }}
  .bullet-dot {{
    flex-shrink: 0;
    width: 18px; height: 18px;
    background: #E27F2E;
    border-radius: 50%;
    margin-top: 18px;
  }}
  .bullet-text {{
    font-size: 38px;
    font-weight: 500;
    color: #2a2a2a;
    line-height: 1.55;
  }}
  .handle {{
    position: absolute;
    bottom: 50px;
    left: 80px;
    font-family: 'Inter', sans-serif;
    font-size: 30px;
    font-weight: 600;
    color: rgba(0,0,0,0.35);
  }}
  .pageno {{
    position: absolute;
    bottom: 50px;
    right: 80px;
    font-family: 'Inter', sans-serif;
    font-size: 26px;
    font-weight: 600;
    color: rgba(0,0,0,0.3);
  }}
</style>
</head>
<body>
<div class="card">
  <h2 class="title">{TITLE}</h2>
  <div class="bullet-list">
    {ITEMS}
  </div>
  <span class="handle">{HANDLE}</span>
  <span class="pageno">{PAGE} / 5</span>
</div>
</body>
</html>
"""

BULLET_ITEM = """<div class="bullet-item">
  <div class="bullet-dot"></div>
  <p class="bullet-text">{TEXT}</p>
</div>"""

NUMBER_HTML = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>Number {ID}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@800;900&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  .card {{
    width: 1080px;
    height: 1350px;
    background: linear-gradient(135deg, #E27F2E 0%, #C9651A 100%);
    position: relative;
    overflow: hidden;
    font-family: 'Noto Sans TC', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 100px 80px;
  }}
  .card::before {{
    content: '';
    position: absolute;
    top: -100px; right: -100px;
    width: 400px; height: 400px;
    background: rgba(255,255,255,0.08);
    border-radius: 50%;
  }}
  .card::after {{
    content: '';
    position: absolute;
    bottom: -150px; left: -150px;
    width: 500px; height: 500px;
    background: rgba(255,255,255,0.06);
    border-radius: 50%;
  }}
  .label {{
    position: relative;
    z-index: 1;
    font-size: 44px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 30px;
    text-align: center;
    letter-spacing: 4px;
    opacity: 0.95;
  }}
  .label::before, .label::after {{
    content: '';
    display: inline-block;
    width: 50px;
    height: 3px;
    background: #fff;
    vertical-align: middle;
    margin: 0 24px;
    opacity: 0.6;
  }}
  .big-number {{
    position: relative;
    z-index: 1;
    font-family: 'Inter', 'Noto Sans TC', sans-serif;
    font-weight: 900;
    font-size: 220px;
    color: #fff;
    line-height: 1;
    margin-bottom: 60px;
    text-shadow: 0 8px 24px rgba(0,0,0,0.15);
    letter-spacing: -4px;
  }}
  .subtitle {{
    position: relative;
    z-index: 1;
    font-size: 42px;
    font-weight: 500;
    color: #fff;
    text-align: center;
    line-height: 1.7;
    opacity: 0.95;
  }}
  .handle {{
    position: absolute;
    bottom: 60px;
    left: 80px;
    font-family: 'Inter', sans-serif;
    font-size: 30px;
    font-weight: 700;
    color: rgba(255,255,255,0.6);
  }}
  .pageno {{
    position: absolute;
    bottom: 60px;
    right: 80px;
    font-family: 'Inter', sans-serif;
    font-size: 26px;
    font-weight: 600;
    color: rgba(255,255,255,0.5);
  }}
</style>
</head>
<body>
<div class="card">
  <div class="label">{LABEL}</div>
  <div class="big-number">{BIG}</div>
  <div class="subtitle">{SUBTITLE}</div>
  <span class="handle">{HANDLE}</span>
  <span class="pageno">{PAGE} / 5</span>
</div>
</body>
</html>
"""

CTA_HTML = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>CTA {ID}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  .card {{
    width: 1080px;
    height: 1350px;
    background: #fff;
    position: relative;
    overflow: hidden;
    font-family: 'Noto Sans TC', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 100px 80px;
  }}
  .card::before {{
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 480px;
    background: linear-gradient(0deg, rgba(231,155,80,0.18) 0%, rgba(231,155,80,0.06) 65%, transparent 100%);
    pointer-events: none;
  }}
  .card::after {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background-image:
      linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
  }}
  .hashtag {{
    position: relative;
    z-index: 1;
    font-size: 30px;
    font-weight: 700;
    color: #E27F2E;
    margin-bottom: 32px;
    letter-spacing: 3px;
  }}
  .title {{
    position: relative;
    z-index: 1;
    font-weight: 900;
    font-size: 84px;
    color: #1a1a1a;
    text-align: center;
    line-height: 1.3;
    margin-bottom: 36px;
  }}
  .subtitle {{
    position: relative;
    z-index: 1;
    font-weight: 500;
    font-size: 38px;
    color: #555;
    text-align: center;
    line-height: 1.7;
    margin-bottom: 60px;
  }}
  .contact-card {{
    position: relative;
    z-index: 1;
    background: #fff;
    border: 3px solid #E27F2E;
    border-radius: 24px;
    padding: 40px 56px;
    box-shadow: 0 12px 32px rgba(231,155,80,0.18);
    text-align: center;
  }}
  .contact-row {{
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 36px;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 12px;
    justify-content: center;
  }}
  .contact-row:last-child {{ margin-bottom: 0; }}
  .contact-label {{
    background: #E27F2E;
    color: #fff;
    font-size: 24px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 8px;
  }}
  .footer-license {{
    position: absolute;
    bottom: 36px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 18px;
    color: rgba(0,0,0,0.4);
    line-height: 1.6;
  }}
  .handle {{
    position: absolute;
    top: 60px;
    right: 80px;
    font-family: 'Inter', sans-serif;
    font-size: 30px;
    font-weight: 600;
    color: rgba(0,0,0,0.35);
  }}
</style>
</head>
<body>
<div class="card">
  <span class="handle">{HANDLE}</span>
  <div class="hashtag">— 不知道怎麼決定？—</div>
  <h2 class="title">{TITLE}</h2>
  <p class="subtitle">{SUBTITLE}</p>
  <div class="contact-card">
    <div class="contact-row"><span class="contact-label">LINE</span> {LINE_ID}</div>
    <div class="contact-row"><span class="contact-label">電話</span> {PHONE}</div>
  </div>
  <div class="footer-license">
    {COMPANY}<br>
    經紀人 {BROKER} ｜ 營業員 {AGENT}
  </div>
</div>
</body>
</html>
"""

# ============ 主流程 ============

OUTPUT_DIR = Path(r"C:\Users\a0920\teddy-website\output\2026-05-22-policy-cards")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def write_post(post):
    pid = post["id"]
    slug = post["slug"]

    # 1. Cover
    cover_html = COVER_HTML.format(
        ID=pid,
        TITLE=post["cover"]["title"],
        SUBTITLE=post["cover"]["subtitle"],
        HANDLE=HANDLE,
    )
    (OUTPUT_DIR / f"{pid}-1-cover.html").write_text(cover_html, encoding="utf-8")

    # 2. Bullet 1
    items_html = "\n    ".join(BULLET_ITEM.format(TEXT=it) for it in post["bullet1"]["items"])
    b1_html = BULLET_HTML.format(
        ID=pid,
        TITLE=post["bullet1"]["title"],
        ITEMS=items_html,
        HANDLE=HANDLE,
        PAGE="2",
    )
    (OUTPUT_DIR / f"{pid}-2-bullet1.html").write_text(b1_html, encoding="utf-8")

    # 3. Number（policy 02 把順序調整：先 4 條件後 number）
    # policy 02 邏輯：先講稅率 4 級距、再講自住豁免 4 條件、再講稅差 number
    # 為簡化我固定 2=bullet1, 3=number, 4=bullet2, 但 policy 02 內容上 bullet1 是稅率、bullet2 是自住條件、number 是稅差
    # 所以對 policy 02 來說順序剛好

    # 3. Number
    n_html = NUMBER_HTML.format(
        ID=pid,
        LABEL=post["number"]["title"],
        BIG=post["number"]["big"],
        SUBTITLE=post["number"]["subtitle"],
        HANDLE=HANDLE,
        PAGE="3",
    )
    (OUTPUT_DIR / f"{pid}-3-number.html").write_text(n_html, encoding="utf-8")

    # 4. Bullet 2
    items2_html = "\n    ".join(BULLET_ITEM.format(TEXT=it) for it in post["bullet2"]["items"])
    b2_html = BULLET_HTML.format(
        ID=pid,
        TITLE=post["bullet2"]["title"],
        ITEMS=items2_html,
        HANDLE=HANDLE,
        PAGE="4",
    )
    (OUTPUT_DIR / f"{pid}-4-bullet2.html").write_text(b2_html, encoding="utf-8")

    # 5. CTA
    cta_html = CTA_HTML.format(
        ID=pid,
        TITLE=post["cta"]["title"],
        SUBTITLE=post["cta"]["subtitle"],
        HANDLE=HANDLE,
        LINE_ID=LINE_ID,
        PHONE=PHONE,
        COMPANY=COMPANY,
        BROKER=BROKER,
        AGENT=AGENT,
    )
    (OUTPUT_DIR / f"{pid}-5-cta.html").write_text(cta_html, encoding="utf-8")

    print(f"✅ {pid} {slug} → 5 張 HTML")


def write_preview():
    """總覽 preview.html"""
    cards_html = []
    for post in POSTS:
        pid = post["id"]
        cards_html.append(f"""
        <div class="row">
          <h3>{pid}. {post["cover"]["title"].replace("<br>", " ")}</h3>
          <div class="cards">
            <iframe src="{pid}-1-cover.html"></iframe>
            <iframe src="{pid}-2-bullet1.html"></iframe>
            <iframe src="{pid}-3-number.html"></iframe>
            <iframe src="{pid}-4-bullet2.html"></iframe>
            <iframe src="{pid}-5-cta.html"></iframe>
          </div>
        </div>""")

    preview = """<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>政策圖卡預覽</title>
<style>
  body {{ font-family: -apple-system, sans-serif; background:#222; color:#fff; padding:40px; }}
  h1 {{ margin-bottom: 30px; }}
  h3 {{ margin: 30px 0 10px; color: #E27F2E; }}
  .row {{ margin-bottom: 50px; }}
  .cards {{ display: flex; gap: 12px; overflow-x: auto; padding-bottom: 10px; }}
  iframe {{
    width: 1080px; height: 1350px;
    transform: scale(0.22);
    transform-origin: top left;
    border: 1px solid #444;
    flex-shrink: 0;
    margin-right: -844px;
    margin-bottom: -1053px;
  }}
</style></head>
<body>
<h1>陳景泰 · 政策深度解讀 IG 圖卡（8 篇 × 5 張 = 40 張）</h1>
{ROWS}
</body></html>""".format(ROWS="\n".join(cards_html))

    (OUTPUT_DIR / "preview.html").write_text(preview, encoding="utf-8")
    print(f"📋 preview.html 已建立")


def main():
    print(f"📂 輸出目錄：{OUTPUT_DIR}")
    for post in POSTS:
        write_post(post)
    write_preview()
    print(f"\n✅ 全部完成！共 {len(POSTS) * 5} 個 HTML")
    print(f"\n下一步：")
    print(f"  cd \"C:\\Users\\a0920\\.claude\\skills\\social-cards\"")
    print(f"  node scripts/screenshot.mjs \"{OUTPUT_DIR}\"")


if __name__ == "__main__":
    main()
