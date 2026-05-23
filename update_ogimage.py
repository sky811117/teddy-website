#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_ogimage.py — 批次為 teddy-website 文章補上 ogImage frontmatter

規則：
1. 已有 ogImage 的文章跳過（community 系列 + 其他預設）
2. 技術文（week-01-launch / week-02-5168-force-click / week-03-bigkanban-monitor）跳過保留 default-og.jpg
3. 其他按 SLUG_MAPPING 對應到 33 張 cover 之一
4. ogImage 寫成 /covers/[slug].png（public 根目錄相對路徑）
"""
import sys, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

POSTS_DIR = Path(r"C:\Users\a0920\teddy-website\src\content\posts")
COVERS_DIR = Path(r"C:\Users\a0920\teddy-website\src\assets\images\covers")

# 跳過：純技術文用 default-og
SKIP_SLUGS = {
    "week-01-launch",
    "week-02-5168-force-click",
    "week-03-bigkanban-monitor",
}

SLUG_MAPPING = {
    # === FAQ 系列 ===
    "faq-01-agent-fee-negotiable":      "negotiation-strategy",
    "faq-02-down-payment":              "new-housing-loan-calc",
    "faq-03-haunted-house-check":       "undesirable-warning",
    "faq-04-viewing-order":             "viewing-checklist",
    "faq-05-illegal-construction":      "undesirable-warning",
    "faq-06-common-area-ratio":         "disclosure-document",
    "faq-07-30-year-old-house":         "community-architecture",
    "faq-08-eaves-area":                "disclosure-document",
    "faq-09-escrow-guarantee":          "disclosure-stamp",
    "faq-10-second-home-loan":          "new-housing-loan-calc",
    "faq-11-presale-developer":         "disclosure-review",
    "faq-12-renovation-budget":         "viewing-corner",
    "faq-13-old-apartment-elevator":    "community-architecture",
    "faq-14-sea-sand-radiation":        "undesirable-warning",
    "faq-15-leak-warranty":             "undesirable-checklist",
    "faq-16-transfer-documents":        "transfer-document",
    "faq-17-escrow-necessary":          "disclosure-stamp",
    "faq-18-land-value-increment-tax":  "transfer-tax",
    "faq-19-stamp-duty":                "transfer-stamp",
    "faq-20-deed-tax":                  "transfer-tax",
    "faq-21-house-tax":                 "transfer-tax",
    "faq-22-land-value-tax":            "transfer-tax",
    "faq-23-viewing-process":           "viewing-checklist",
    "faq-24-offer-vs-negotiation":      "negotiation-talk",
    "faq-25-earnest-vs-deposit":        "negotiation-strategy",
    "faq-26-contract-signing":          "disclosure-signing",
    "faq-27-public-private-deed":       "disclosure-document",
    "faq-28-mortgage-reading":          "disclosure-document",
    "faq-29-co-owner":                  "disclosure-law",
    "faq-30-foreclosure":               "undesirable-warning",

    # === Policy 系列 ===
    "policy-01-new-housing-loan-2-final":      "new-housing-loan-family",
    "policy-02-house-land-tax-2":              "transfer-tax",
    "policy-03-central-bank-credit-control":   "new-housing-loan-calc",
    "policy-04-disclosure-document":           "disclosure-document",
    "policy-05-escrow-system":                 "disclosure-stamp",
    "policy-06-house-tax-2":                   "transfer-tax",
    "policy-07-land-value-tax":                "transfer-tax",
    "policy-08-presale-equality-amendment":    "disclosure-law",

    # === Term 系列（房地產名詞）===
    "term-01-main-building":            "disclosure-document",
    "term-02-accessory-building":       "disclosure-document",
    "term-03-public-facilities":        "community-architecture",
    "term-04-rain-cover":               "disclosure-document",
    "term-05-eaves":                    "community-architecture",
    "term-06-terrace":                  "community-balcony",
    "term-07-flat-parking":             "community-architecture",
    "term-08-mechanical-parking":       "community-architecture",
    "term-09-ramp-parking":             "community-architecture",
    "term-10-independent-parking":      "community-architecture",
    "term-11-house-tax-bill":           "transfer-tax",
    "term-12-announced-value-vs-actual":"transfer-calculator",
    "term-13-actual-price-registration":"transfer-calculator",
    "term-14-deed":                     "disclosure-document",
    "term-15-transcript":               "disclosure-document",

    # === Tool 系列 ===
    "tool-agent-fee":                   "negotiation-calculator",
    "tool-ai-photo":                    "viewing-natural-light",
    "tool-area-market":                 "community-streetview",
    "tool-buyer-fee":                   "new-housing-loan-calc",
    "tool-multi-platform":              "community-livingroom",
    "tool-negotiation":                 "negotiation-strategy",
    "tool-new-housing-loan":            "new-housing-loan-keys",
    "tool-pricing-analysis":            "transfer-calculator",
    "tool-viewing-checklist":           "viewing-checklist",

    # === Viewing 看屋實戰系列 ===
    "viewing-01-monthly-picks":         "viewing-corner",
    "viewing-02-haunted-house-check":   "undesirable-warning",
    "viewing-03-leak-test":             "undesirable-checklist",
    "viewing-04-sea-sand-radiation":    "undesirable-warning",
    "viewing-05-renovation-budget":     "viewing-corner",
    "viewing-06-presale-checklist":     "viewing-checklist",
    "viewing-07-old-house-structure":   "community-architecture",
    "viewing-08-daylight-ventilation":  "viewing-natural-light",

    # === Week 系列 ===
    "week-02-new-housing-loan":         "new-housing-loan-family",
    "week-03-negotiation-7":            "negotiation-handshake",
    "week-04-undesirable-facilities":   "undesirable-overview",
    "week-05-property-disclosure":      "disclosure-document",
    "week-06-listing-photos":           "viewing-natural-light",

    # === W07-W26 月度報告系列 ===
    "2026-05-taichung-market-pillar":   "community-streetview",
    "2026-05-W08-new-housing-loan-2":   "new-housing-loan-family",
    "2026-05-W09-cbc-second-home":      "new-housing-loan-calc",
    "2026-05-W10-taichung-30k-inventory":"community-streetview",
    "2026-05-W11-loan-rate-2306":       "new-housing-loan-calc",
    "2026-05-W12-q1-transfer-trend":    "transfer-process",
    "2026-05-W13-business-climate":     "transfer-calculator",
    "2026-05-W14-top20-communities":    "community-architecture",
    "2026-05-W15-wuqi-three-on-list":   "community-streetview",
    "2026-05-W16-beitun":               "community-streetview",
    "2026-05-W17-xitun":                "community-streetview",
    "2026-05-W18-nantun":               "community-architecture",
    "2026-05-W19-central-district":     "community-streetview",
    "2026-05-W20-taiping":              "community-streetview",
    "2026-05-W21-dali":                 "community-streetview",
    "2026-05-W22-wuri":                 "community-streetview",
    "2026-05-W23-presale-vs-existing":  "community-architecture",
    "2026-05-W24-apt-vs-townhouse":     "community-livingroom",
    "2026-05-W25-studio-market":        "community-livingroom",
    "2026-05-W26-price-bands":          "transfer-calculator",
}


def parse_frontmatter(text):
    """split frontmatter from body. returns (fm_lines, body, has_fm)"""
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return [], text, False
    # find closing ---
    lines = text.split("\n")
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return [], text, False
    fm_lines = lines[1:end_idx]
    body = "\n".join(lines[end_idx+1:])
    return fm_lines, body, True


def has_ogimage(fm_lines):
    return any(re.match(r"^\s*ogImage\s*:", line) for line in fm_lines)


def is_our_old_ogimage(fm_lines):
    """detect our previous /covers/[slug].png writes so we can rewrite them"""
    for line in fm_lines:
        m = re.match(r"^\s*ogImage\s*:\s*(.+?)\s*$", line)
        if m:
            val = m.group(1).strip().strip('"').strip("'")
            return val.startswith("/covers/")
    return False


def remove_ogimage(fm_lines):
    return [line for line in fm_lines if not re.match(r"^\s*ogImage\s*:", line)]


def get_slug(fm_lines):
    for line in fm_lines:
        m = re.match(r"^\s*slug\s*:\s*(.+?)\s*$", line)
        if m:
            slug = m.group(1).strip()
            # strip quotes
            slug = slug.strip('"').strip("'")
            return slug
    return None


def insert_ogimage(fm_lines, cover_slug):
    """在 draft: 之後插入 ogImage 用相對路徑（Astro image() asset）
    src/content/posts/X.md → src/assets/images/covers/Y.png 退 2 層"""
    rel_path = f"../../assets/images/covers/{cover_slug}.png"
    out = []
    inserted = False
    for line in fm_lines:
        out.append(line)
        if not inserted and re.match(r"^\s*draft\s*:", line):
            out.append(f"ogImage: {rel_path}")
            inserted = True
    if not inserted:
        out.append(f"ogImage: {rel_path}")
    return out


def process_post(md_path: Path, stats: dict):
    text = md_path.read_text(encoding="utf-8")
    fm_lines, body, has_fm = parse_frontmatter(text)
    if not has_fm:
        stats["no_fm"] += 1
        return
    slug = get_slug(fm_lines)
    if not slug:
        stats["no_slug"] += 1
        return
    # 如果是我們上一輪寫的 /covers/...（會 break build），先清掉重寫
    if is_our_old_ogimage(fm_lines):
        fm_lines = remove_ogimage(fm_lines)
    elif has_ogimage(fm_lines):
        # 其他來源的 ogImage（例如 community-XX 用相對路徑）不動
        stats["already_has_ogimage"] += 1
        return
    if slug in SKIP_SLUGS:
        stats["skipped_tech"] += 1
        return
    cover_slug = SLUG_MAPPING.get(slug)
    if not cover_slug:
        stats["no_mapping"] += 1
        print(f"  [NO MAP] {slug}")
        return
    cover_path = COVERS_DIR / f"{cover_slug}.png"
    if not cover_path.exists():
        stats["cover_missing"] += 1
        print(f"  [NO COVER FILE] {slug} -> {cover_slug}")
        return
    # 更新 frontmatter
    new_fm = insert_ogimage(fm_lines, cover_slug)
    new_text = "---\n" + "\n".join(new_fm) + "\n---\n" + body
    md_path.write_text(new_text, encoding="utf-8")
    stats["updated"] += 1
    print(f"  [+] {slug:50s} -> {cover_slug}")


def main():
    stats = {
        "updated": 0,
        "already_has_ogimage": 0,
        "skipped_tech": 0,
        "no_mapping": 0,
        "cover_missing": 0,
        "no_fm": 0,
        "no_slug": 0,
    }
    md_files = sorted(POSTS_DIR.glob("*.md"))
    print(f"\n=== 掃描 {len(md_files)} 個 .md 文章 ===\n")
    for md in md_files:
        process_post(md, stats)
    print(f"\n=== 統計 ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
