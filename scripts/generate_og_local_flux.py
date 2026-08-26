# -*- coding: utf-8 -*-
"""
teddy-website OG 封面圖批次補圖 — 本地 ComfyUI + FLUX.1-schnell，永久 $0。

取代舊的 generate_og_images.py（Vertex Imagen 付費版，2026-07-07 起禁用）。
2026-07-07 那次補 7 月批次用的是臨時腳本沒留檔，導致 8 月批次沒人補圖、
/posts/ 前兩頁封面全空 —— 這支就是把那個流程固定下來。

做什麼：
  1. 掃 src/content/posts/*.md，找出「沒有 ogImage」或「ogImage 指向不存在的檔」
  2. 依標題 / tags 判主題 → 組亮色白天 FLUX prompt（禁暗色，見 CLAUDE.md 圖卡鐵則）
  3. 本地 8188 生圖 1216x640 → PIL 裁成 1200x630 → public/og/{slug}.jpg
  4. 回寫 frontmatter 的 ogImage: /og/{slug}.jpg
  （縮圖 webp 由 npm build 的 scripts/generate-og-thumbs.mjs 自動產，這裡不用管）

用法：
    python scripts/generate_og_local_flux.py --dry-run      # 只列出要補哪些，不生圖
    python scripts/generate_og_local_flux.py                # 全部補完
    python scripts/generate_og_local_flux.py --limit 5      # 先補 5 篇試水溫
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import time
from pathlib import Path

from PIL import Image

# 本地 FLUX 生圖模組（IG 管線那支，回 PNG bytes，會自動背景啟動 ComfyUI:8188）
sys.path.insert(0, r"C:\Users\a0920\房仲工作站\420_IG_API")
from comfyui_gen import gen_flux_image  # noqa: E402

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "src" / "content" / "posts"
OG_DIR = ROOT / "public" / "og"

# FLUX 出圖尺寸（64 倍數對 FLUX 友善），最後裁成 OG 標準 1200x630
GEN_W, GEN_H = 1216, 640
OG_W, OG_H = 1200, 630

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


# ── 主題判定 ───────────────────────────────────────────────────────────
# 由上而下比對，第一個命中的決定畫面。畫面一律亮色白天。
THEMES = [
    # 行政區 / 地標 —— 給具體場景，避免整批長一樣
    (("北屯", "捷運綠線", "十四期", "機捷"),
     "wide aerial view of Beitun district Taichung, new mid-rise residential towers along a green MRT viaduct, tree-lined boulevard"),
    (("西屯", "水湳", "七期", "會展"),
     "wide aerial view of Xitun Taichung modern business district, glass office towers and luxury residential high-rises, wide landscaped avenue"),
    (("南屯", "單元二", "單元五", "文心"),
     "wide aerial view of Nantun Taichung, contemporary residential towers beside a large green park, wide clean streets"),
    (("豐原", "后里", "神岡", "大雅"),
     "wide aerial view of a Taiwanese suburban town center, low-rise apartment blocks and shophouses, distant green mountains"),
    (("大里", "太平", "霧峰", "烏日"),
     "wide aerial view of a Taichung satellite township, mixed low-rise apartments and new residential towers, rice fields and hills in the distance"),
    (("海線", "沙鹿", "梧棲", "清水", "龍井", "大甲"),
     "wide aerial view of Taichung coastal township, low-rise housing and new residential blocks, open sky and distant sea horizon"),
    (("中區", "東區", "南區", "北區", "舊市區"),
     "wide aerial view of central Taichung old town, dense mid-rise apartment buildings and narrow busy streets, urban texture"),
    # 主題類
    (("利率", "房貸", "貸款", "新青安", "青安", "撥款"),
     "clean modern bank lobby interior with tall bright windows, minimalist counters, soft daylight, architectural interior photography"),
    (("政策", "稅", "法規", "都更", "危老", "囤房"),
     "modern Taiwanese government civic building exterior, clean concrete and glass facade, wide plaza, bright open sky"),
    (("預售", "建案", "推案", "工地", "建照", "使照"),
     "construction site of a modern residential high-rise in Taiwan, tower crane against clear sky, tidy safety fencing, daytime"),
    (("餘屋", "待售", "庫存", "空屋", "餘量"),
     "row of newly finished residential towers in Taiwan, empty balconies, clean facade, wide open sky, daytime"),
    (("移轉", "成交", "交易", "量能", "棟數"),
     "wide aerial view of a Taichung residential neighborhood, orderly rows of apartment towers, wide boulevards, clear daytime sky"),
    (("社區", "熱銷", "銷售"),
     "modern Taiwanese residential community entrance, landscaped courtyard, clean stone facade, bright natural daylight"),
    (("景氣", "總經", "股", "經濟", "所得"),
     "modern Taichung city skyline seen from a distance, mixed high-rise towers, clear blue sky, calm bright daytime atmosphere"),
]

DEFAULT_SCENE = (
    "wide aerial view of modern Taichung Taiwan residential district, "
    "clean mid-rise and high-rise apartment towers, tree-lined streets"
)

# 亮色鐵則：禁 night / dusk / dark / moody / neon / blue hour（CLAUDE.md 圖卡鐵則延伸）
STYLE_SUFFIX = (
    "bright daytime, clear blue sky, natural sunlight, soft shadows, "
    "photorealistic architectural photography, wide angle, sharp focus, "
    "clean and airy, professional magazine quality, no text, no signage, no people, no cars in focus"
)


def build_prompt(title: str, tags: list[str]) -> str:
    haystack = title + " " + " ".join(str(t) for t in tags)
    scene = DEFAULT_SCENE
    for keywords, s in THEMES:
        if any(k in haystack for k in keywords):
            scene = s
            break
    return f"{scene}, {STYLE_SUFFIX}"


# ── frontmatter ────────────────────────────────────────────────────────
def parse_frontmatter(text: str) -> tuple[str, str] | None:
    """回 (frontmatter 原文, 全文剩下的部分)；沒有 frontmatter 回 None。"""
    m = FM_RE.match(text)
    if not m:
        return None
    return m.group(1), text


def fm_get_scalar(fm: str, key: str) -> str | None:
    m = re.search(rf"^{key}:\s*(.+?)\s*$", fm, re.MULTILINE)
    if not m:
        return None
    return m.group(1).strip().strip('"').strip("'")


def fm_get_tags(fm: str) -> list[str]:
    m = re.search(r"^tags:\s*\n((?:\s+-\s+.+\n)+)", fm, re.MULTILINE)
    if m:
        return [line.strip().lstrip("- ").strip() for line in m.group(1).splitlines() if line.strip()]
    m = re.search(r"^tags:\s*\[(.*?)\]", fm, re.MULTILINE)
    if m:
        return [t.strip().strip('"').strip("'") for t in m.group(1).split(",") if t.strip()]
    return []


def insert_og_line(text: str, og_path: str) -> str:
    """把 ogImage 插在 slug: 之後（沒 slug 就插在 pubDatetime: 之後），維持既有排版慣例。"""
    for anchor in ("slug", "pubDatetime", "author", "title"):
        m = re.search(rf"^{anchor}:\s*.+?$", text, re.MULTILINE)
        if m:
            return text[: m.end()] + f"\nogImage: {og_path}" + text[m.end():]
    raise RuntimeError("frontmatter 找不到可插入的錨點")


def needs_og(md: Path) -> tuple[bool, str]:
    text = md.read_text(encoding="utf-8")
    parsed = parse_frontmatter(text)
    if not parsed:
        return False, "無 frontmatter，跳過"
    fm, _ = parsed
    og = fm_get_scalar(fm, "ogImage")
    if not og:
        return True, "缺 ogImage"
    if og.startswith("http"):
        return False, "外部圖"
    if og.startswith("/"):
        f = ROOT / "public" / og.lstrip("/")
        if not f.exists():
            return True, f"ogImage 指向不存在的檔：{og}"
    return False, "已有圖"


# ── 生圖 ───────────────────────────────────────────────────────────────
def to_og_jpg(png_bytes: bytes, out: Path) -> None:
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    # 先等比放大到覆蓋 1200x630，再置中裁切
    scale = max(OG_W / im.width, OG_H / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left = (im.width - OG_W) // 2
    top = (im.height - OG_H) // 2
    im = im.crop((left, top, left + OG_W, top + OG_H))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "JPEG", quality=86, optimize=True, progressive=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只列出要補哪些，不生圖")
    ap.add_argument("--limit", type=int, default=0, help="最多處理幾篇（0=不限）")
    ap.add_argument("--only", nargs="+", default=None,
                    help="只處理指定檔名（給發布管線單篇呼叫用）")
    args = ap.parse_args()

    candidates = sorted(POSTS_DIR.glob("*.md"))
    if args.only:
        wanted = {Path(n).name for n in args.only}
        candidates = [p for p in candidates if p.name in wanted]
        missing = wanted - {p.name for p in candidates}
        for n in sorted(missing):
            print(f"[!] 找不到 {n}")

    todo = []
    for md in candidates:
        need, why = needs_og(md)
        if need:
            todo.append((md, why))

    if not todo:
        print("[OK] 所有文章都有封面圖，沒事做")
        return 0

    print(f"[*] 共 {len(todo)} 篇缺封面圖")
    for md, why in todo:
        print(f"    - {md.name}  ({why})")

    if args.dry_run:
        return 0

    if args.limit:
        todo = todo[: args.limit]

    ok, fail = 0, []
    for i, (md, _why) in enumerate(todo, 1):
        text = md.read_text(encoding="utf-8")
        fm, _ = parse_frontmatter(text)
        title = fm_get_scalar(fm, "title") or md.stem
        slug = fm_get_scalar(fm, "slug") or md.stem
        tags = fm_get_tags(fm)
        prompt = build_prompt(title, tags)
        out = OG_DIR / f"{slug}.jpg"

        print(f"\n[{i}/{len(todo)}] {title[:48]}")
        print(f"        prompt: {prompt[:110]}...")
        t0 = time.time()
        try:
            png = gen_flux_image(prompt, width=GEN_W, height=GEN_H)
            to_og_jpg(png, out)
            md.write_text(insert_og_line(text, f"/og/{out.name}"), encoding="utf-8")
            print(f"        -> {out.name}  {out.stat().st_size/1024:.0f}KB  ({time.time()-t0:.0f}s)")
            ok += 1
        except Exception as e:
            print(f"        !! 失敗: {str(e)[:160]}")
            fail.append(md.name)

    print(f"\n[完成] 成功 {ok} / {len(todo)}")
    if fail:
        print("[失敗清單]（可直接重跑本腳本，會自動只補這幾篇）")
        for n in fail:
            print(f"    - {n}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
