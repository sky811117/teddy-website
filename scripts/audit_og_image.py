"""
Audit & unify ogImage paths in src/content/posts/*.md.

Strategy:
- Public-absolute paths (/covers/x.png, /communities/x.png) — keep, verify file
- Relative to assets/images/covers/* — convert to /covers/x.png
- External URLs (https://...) — keep
- Other relative (e.g. _releases AstroPaper-v*.png) — keep, verify file
- Missing file — fallback by tag matching

Run: python scripts/audit_og_image.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "src" / "content" / "posts"
PUBLIC_COVERS = ROOT / "public" / "covers"
PUBLIC_COMMUNITIES = ROOT / "public" / "communities"
SRC_COVERS = ROOT / "src" / "assets" / "images" / "covers"
SRC_ASSETS = ROOT / "src" / "assets" / "images"

OG_LINE = re.compile(r"^ogImage:\s*(.+?)\s*$", re.MULTILINE)
TAGS_BLOCK = re.compile(r"^tags:\s*\n((?:\s+-\s+.+\n)+)", re.MULTILINE)
TAGS_INLINE = re.compile(r"^tags:\s*\[(.*?)\]", re.MULTILINE)

# Fallback by tag keyword -> cover filename (must exist in public/covers/)
TAG_FALLBACK = [
    ("看屋", "viewing-checklist.png"),
    ("買方", "viewing-checklist.png"),
    ("房貸", "new-housing-loan-calc.png"),
    ("新青安", "new-housing-loan-family.png"),
    ("議價", "negotiation-strategy.png"),
    ("成交", "negotiation-handshake.png"),
    ("嫌惡", "undesirable-warning.png"),
    ("漏水", "undesirable-checklist.png"),
    ("過戶", "transfer-document.png"),
    ("稅", "transfer-tax.png"),
    ("謄本", "disclosure-document.png"),
    ("法規", "disclosure-law.png"),
    ("揭露", "disclosure-document.png"),
    ("社區", "community-architecture.png"),
    ("北屯", "community-streetview.png"),
    ("西屯", "community-balcony.png"),
    ("南屯", "community-garden.png"),
]
DEFAULT_FALLBACK = "community-architecture.png"


def extract_frontmatter_ogimage(text: str) -> tuple[str, int, int] | None:
    """Return (ogImage value, line_start, line_end) or None."""
    fm_match = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not fm_match:
        return None
    fm = fm_match.group(1)
    fm_start = fm_match.start(1)
    og = OG_LINE.search(fm)
    if not og:
        return None
    return og.group(1), fm_start + og.start(), fm_start + og.end()


def extract_tags(text: str) -> list[str]:
    fm_match = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not fm_match:
        return []
    fm = fm_match.group(1)
    m_inline = TAGS_INLINE.search(fm)
    if m_inline:
        return [t.strip().strip('"').strip("'") for t in m_inline.group(1).split(",")]
    m_block = TAGS_BLOCK.search(fm)
    if m_block:
        return [
            line.strip().lstrip("-").strip().strip('"').strip("'")
            for line in m_block.group(1).strip().splitlines()
        ]
    return []


def classify(raw: str) -> dict:
    """Classify ogImage value and propose target."""
    raw = raw.strip()
    info: dict = {"raw": raw}
    if raw.startswith(("http://", "https://")):
        info["kind"] = "external"
        info["filename"] = None
        info["exists"] = True
        info["target"] = raw
        return info

    filename = raw.rsplit("/", 1)[-1]
    info["filename"] = filename

    if raw.startswith("/covers/"):
        info["kind"] = "public-covers"
        info["exists"] = (PUBLIC_COVERS / filename).is_file()
        info["target"] = raw if info["exists"] else None
    elif raw.startswith("/communities/"):
        info["kind"] = "public-communities"
        info["exists"] = (PUBLIC_COMMUNITIES / filename).is_file()
        info["target"] = raw if info["exists"] else None
    elif "/covers/" in raw:
        info["kind"] = "relative-covers"
        # Check both possible sources
        info["exists"] = (
            (SRC_COVERS / filename).is_file() or (PUBLIC_COVERS / filename).is_file()
        )
        # Target: convert to public absolute
        info["target"] = (
            f"/covers/{filename}"
            if (PUBLIC_COVERS / filename).is_file()
            else None
        )
    else:
        # other relative (e.g. assets/AstroPaper-v6.png or ../../../assets/images/X.png)
        info["kind"] = "relative-other"
        # check if the literal path resolves under src/assets
        info["exists"] = (SRC_ASSETS / filename).is_file() or filename in [
            p.name for p in SRC_ASSETS.rglob("*") if p.is_file()
        ]
        # do not auto-convert; leave to manual
        info["target"] = raw

    return info


def pick_fallback(tags: list[str]) -> str:
    joined = " ".join(tags)
    for kw, fn in TAG_FALLBACK:
        if kw in joined:
            return fn
    return DEFAULT_FALLBACK


def audit_post(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    og = extract_frontmatter_ogimage(text)
    if og is None:
        return {"path": path, "status": "no-ogimage"}
    raw, start, end = og
    info = classify(raw)
    info["path"] = path
    info["line"] = raw

    if not info.get("exists"):
        tags = extract_tags(text)
        fb = pick_fallback(tags)
        info["target"] = f"/covers/{fb}"
        info["status"] = "missing-fallback"
    elif info["kind"] == "relative-covers" and info["target"]:
        info["status"] = "needs-rewrite"
    elif info["kind"] in ("public-covers", "public-communities", "external"):
        info["status"] = "ok"
    elif info["kind"] == "relative-other":
        info["status"] = "ok-leave-alone"
    else:
        info["status"] = "unknown"
    return info


def rewrite(path: Path, target: str) -> None:
    text = path.read_text(encoding="utf-8")
    new_text, n = OG_LINE.subn(f"ogImage: {target}", text, count=1)
    if n == 0:
        raise RuntimeError(f"failed to rewrite {path}")
    path.write_text(new_text, encoding="utf-8")


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    results = []
    for md in sorted(POSTS_DIR.rglob("*.md")):
        # Skip _releases/ historical theme posts
        if "_releases" in md.parts:
            continue
        info = audit_post(md)
        results.append(info)

    by_status: dict[str, list[dict]] = {}
    for r in results:
        by_status.setdefault(r["status"], []).append(r)

    print(f"\n=== ogImage Audit ({len(results)} posts, excluding _releases) ===\n")
    for status, items in sorted(by_status.items()):
        print(f"[{status}]  {len(items)} posts")
    print()

    for status in ("missing-fallback", "needs-rewrite", "unknown", "ok-leave-alone"):
        items = by_status.get(status, [])
        if not items:
            continue
        print(f"\n--- {status} ---")
        for r in items:
            rel = r["path"].relative_to(POSTS_DIR)
            cur = r.get("line", "?")
            tgt = r.get("target", "?")
            print(f"  {rel}")
            print(f"    cur: {cur}")
            if tgt and tgt != cur:
                print(f"    new: {tgt}")

    if not apply:
        rewrite_count = sum(
            len(by_status.get(s, []))
            for s in ("needs-rewrite", "missing-fallback")
        )
        print(f"\n(dry-run) {rewrite_count} files would be rewritten. Use --apply to write.")
        return 0

    n_written = 0
    for r in results:
        if r["status"] in ("needs-rewrite", "missing-fallback") and r.get("target"):
            rewrite(r["path"], r["target"])
            n_written += 1
    print(f"\nWrote {n_written} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
