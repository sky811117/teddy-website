"""
Step 1 止血 — 把所有「含 AI 編造個人經歷」的文章 frontmatter 改 draft: true
不刪檔，先讓客戶看不到。
"""
import sys
import re
from pathlib import Path

REPO = Path(r"C:\Users\a0920\teddy-website")
POSTS = REPO / "src" / "content" / "posts"

# 從 grep 抓出來「含第一人稱經歷宣稱」的 52 篇 + 額外可疑的
TARGETS = [
    "2026-06-W04-district_other-district-wuri-may.md",
    "faq-13-old-apartment-elevator.md",
    "faq-16-transfer-documents.md",
    "faq-02-down-payment.md",
    "faq-29-co-owner.md",
    "faq-27-public-private-deed.md",
    "faq-25-earnest-vs-deposit.md",
    "faq-26-contract-signing.md",
    "faq-23-viewing-process.md",
    "faq-18-land-value-increment-tax.md",
    "faq-15-leak-warranty.md",
    "faq-17-escrow-necessary.md",
    "faq-09-escrow-guarantee.md",
    "faq-04-viewing-order.md",
    "faq-05-illegal-construction.md",
    "faq-03-haunted-house-check.md",
    "2026-05-W10-taichung-30k-inventory.md",
    "week-05-property-disclosure.md",
    "week-04-undesirable-facilities.md",
    "week-03-negotiation-7.md",
    "week-02-new-housing-loan.md",
    "viewing-08-daylight-ventilation.md",
    "viewing-07-old-house-structure.md",
    "viewing-06-presale-checklist.md",
    "viewing-05-renovation-budget.md",
    "viewing-04-sea-sand-radiation.md",
    "viewing-03-leak-test.md",
    "viewing-02-haunted-house-check.md",
    "viewing-01-monthly-picks.md",
    "tool-viewing-checklist.md",
    "tool-negotiation.md",
    "term-15-transcript.md",
    "policy-05-escrow-system.md",
    "faq-01-agent-fee-negotiable.md",
    "community-zongtai-heart.md",
    "community-meili-dian.md",
    "community-huangpu-manor.md",
    "community-fuyu-world.md",
    "community-chunfu-xingbo.md",
    "2026-05-W24-apt-vs-townhouse.md",
    "2026-05-W23-presale-vs-existing.md",
    "2026-05-W21-dali.md",
    "2026-05-W20-taiping.md",
    "2026-05-W18-nantun.md",
    "2026-05-W17-xitun.md",
    "2026-05-W16-beitun.md",
    "2026-05-W14-top20-communities.md",
    "2026-05-W11-loan-rate-2306.md",
    "2026-05-W09-cbc-second-home.md",
    "2026-05-W08-new-housing-loan-2.md",
    "2026-05-W07-taichung-market-pillar.md",
    "2026-05-W26-price-bands.mdx",
]


def set_draft_true(content: str) -> tuple[str, str]:
    """傳回 (新內容, 動作說明)"""
    # 切 frontmatter
    m = re.match(r"^(---\n)(.*?)(\n---\n)(.*)$", content, re.DOTALL)
    if not m:
        return content, "SKIP-no-frontmatter"

    head, fm, tail_sep, body = m.groups()

    # 已經是 draft: true 不動
    if re.search(r"^draft:\s*true\s*$", fm, re.MULTILINE):
        return content, "SKIP-already-draft"

    if re.search(r"^draft:\s*false\s*$", fm, re.MULTILINE):
        new_fm = re.sub(r"^draft:\s*false\s*$", "draft: true", fm, flags=re.MULTILINE)
        return head + new_fm + tail_sep + body, "CHANGED-false-to-true"

    # 沒有 draft 欄位 → 加一行
    new_fm = fm + "\ndraft: true"
    return head + new_fm + tail_sep + body, "CHANGED-added-draft-true"


def main():
    changed = 0
    skipped = 0
    missing = 0
    for fname in TARGETS:
        fp = POSTS / fname
        if not fp.exists():
            print(f"[MISS] {fname}")
            missing += 1
            continue
        content = fp.read_text(encoding="utf-8")
        new_content, action = set_draft_true(content)
        if new_content != content:
            fp.write_text(new_content, encoding="utf-8")
            print(f"[OK ] {fname:55s} {action}")
            changed += 1
        else:
            print(f"[--  ] {fname:55s} {action}")
            skipped += 1
    print()
    print(f"changed={changed}  skipped={skipped}  missing={missing}  total={len(TARGETS)}")


if __name__ == "__main__":
    main()
