# -*- coding: utf-8 -*-
"""
Audit teddy-website 113 篇 draft，分 Tier 1/2/3。

Tier 1 (綠) — 政府公告引述 / 法規說明 / 純科普 → 可直接發
Tier 2 (黃) — 區域分析 / 觀點 / 統計分析 → 附 source 自動發
Tier 3 (紅) — 具體利率 / 預測 / 特定建案評論 → 暫停等景泰確認

判斷依據：
- 找關鍵字：%、利率、寬限期、預售 → 通常 Tier 2 或 3
- 找 .gov.tw 連結 → 加分到 Tier 1/2
- 找預測詞（看漲、看跌、未來、預期）→ Tier 3
- 找品牌名（順天、太子、合泰）→ Tier 3
"""
import re
import sys
import json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

POSTS_DIR = Path(r"C:\Users\a0920\teddy-website\src\content\posts")
OUT_FILE = POSTS_DIR.parent.parent / "audit_results.json"

TIER1_KEYWORDS = ["新青安", "央行", "內政部", "財政部", "房地合一", "房屋稅", "登記", "贈與稅",
                  "地價稅", "契稅", "印花稅", "謄本", "權狀", "經紀業", "管理條例"]
TIER1_BONUS_PATTERNS = [r"\.gov\.tw", r"\.moi\.gov", r"\.mof\.gov", r"\.cbc\.gov"]

TIER2_KEYWORDS = ["實價登錄", "移轉", "建照", "使照", "交易", "成交", "趨勢", "區域",
                  "北屯", "西屯", "南屯", "東區", "西區", "中區", "南區", "北區",
                  "霧峰", "大里", "太平", "烏日", "豐原", "潭子", "神岡"]

TIER3_KEYWORDS = ["%", "利率", "寬限期", "看漲", "看跌", "預期", "可能會",
                  "未來", "預測", "建議買", "建議賣", "最佳時機"]

# 真的「建案 / 社區名」才算 Tier 3（合泰建經是資料來源、皇家是品牌但泛用）
TIER3_BRAND_NAMES = ["順天豐華", "太子雲世紀", "聯聚信義", "豐邑科博", "勤美璞真", "華友聯",
                     "順天清漾", "太子湖心泊"]

# 真的「預測未來房價」才算 Tier 3
PREDICTION_WORDS = ["房價會漲", "房價會跌", "肯定上漲", "一定會跌", "勢必上漲",
                    "預期房價將", "趨勢將反轉", "保證升值"]


def classify(text: str, frontmatter: dict) -> tuple[str, list[str]]:
    """回傳 (tier, reasons)"""
    reasons = []
    text_lower = text.lower()

    # 加分項：有 .gov.tw 連結
    has_gov_link = any(re.search(p, text) for p in TIER1_BONUS_PATTERNS)

    # 算各 tier 命中數
    tier1_hits = [k for k in TIER1_KEYWORDS if k in text]
    tier2_hits = [k for k in TIER2_KEYWORDS if k in text]
    tier3_hits = [k for k in TIER3_KEYWORDS if k in text]
    brand_hits = [k for k in TIER3_BRAND_NAMES if k in text]
    pred_hits = [k for k in PREDICTION_WORDS if k in text]

    # Tier 3 條件：有具體 % / 預測 / 品牌名
    if pred_hits:
        reasons.append(f"有預測詞: {pred_hits[:3]}")
        return ("3", reasons)
    if brand_hits:
        reasons.append(f"提到建商/建案: {brand_hits[:3]}")
        return ("3", reasons)
    # 具體 % 數字判斷放寬：只有超過 5 個 % 才標 Tier 3
    if re.search(r"\d+\.\d+\s*%", text) or re.search(r"\d+%", text):
        percent_count = len(re.findall(r"\d+\.?\d*\s*%", text))
        if percent_count > 5:
            reasons.append(f"具體 % 數字密集 ({percent_count} 次)，需查證")
            return ("3", reasons)
        elif percent_count > 0:
            reasons.append(f"有 {percent_count} 個 % 數字（可接受）")

    # Tier 1 條件：政府公告類，純法規 / 政策說明
    if tier1_hits and has_gov_link:
        reasons.append(f"政府公告類: {tier1_hits[:3]} + .gov.tw 連結")
        return ("1", reasons)
    if len(tier1_hits) >= 2 and len(tier3_hits) == 0:
        reasons.append(f"純法規/政策: {tier1_hits[:3]}")
        return ("1", reasons)

    # Tier 2 條件：區域分析 / 統計 / 觀點
    if tier2_hits:
        reasons.append(f"區域/統計: {tier2_hits[:3]}")
        return ("2", reasons)

    # 預設 Tier 2
    reasons.append("一般房市內容")
    return ("2", reasons)


def parse_frontmatter(text: str) -> dict:
    """簡單抽 frontmatter"""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm


def main():
    results = {"tier1": [], "tier2": [], "tier3": []}
    counters = {"1": 0, "2": 0, "3": 0}

    files = sorted(POSTS_DIR.glob("*.md"))
    print(f"📂 共 {len(files)} 篇 md")

    for f in files:
        text = f.read_text(encoding="utf-8")
        fm = parse_frontmatter(text)
        is_draft = "draft: true" in text

        if not is_draft:
            continue

        tier, reasons = classify(text, fm)
        counters[tier] += 1
        results[f"tier{tier}"].append({
            "file": f.name,
            "title": fm.get("title", "(no title)"),
            "tags": fm.get("tags", ""),
            "char_count": len(text),
            "reasons": reasons,
        })

    OUT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n=== Audit Result ===")
    print(f"Tier 1 (綠 / 直接發): {counters['1']}")
    print(f"Tier 2 (黃 / 附 source 自動發): {counters['2']}")
    print(f"Tier 3 (紅 / 暫停等確認): {counters['3']}")
    print(f"\n📄 詳細結果: {OUT_FILE}")


if __name__ == "__main__":
    main()
