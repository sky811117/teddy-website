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
  5. 呼叫 generate-og-thumbs.mjs 產 /og/thumbs/*.webp
     ⚠️ 縮圖不是可有可無：列表卡片走 ogThumb.ts 硬改寫成 webp 且無 fallback，
        只生 jpg 不生 webp = 線上列表 404 破圖（2026-08-26 踩過）

用法：
    python scripts/generate_og_local_flux.py --dry-run      # 只列出要補哪些，不生圖
    python scripts/generate_og_local_flux.py                # 全部補完
    python scripts/generate_og_local_flux.py --limit 5      # 先補 5 篇試水溫
"""
from __future__ import annotations

import argparse
import hashlib
import io
import re
import subprocess
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


# ── 文章家族判定（優先於下面的關鍵字表）─────────────────────────────
# 2026-08-26 加：教學型文章（看屋/名詞/FAQ/工具/週記/社區）要的畫面跟
# 房市數據文完全不同。舊那批 109 張就是全部丟同一個「黃昏豪宅」prompt，
# 結果「教你測漏水」配一張夕陽別墅，還印著 TAVAN / REAL WHAT MARKEET 亂碼。
SLUG_FAMILIES = [
    ("viewing-", [   # 看屋實戰：實地檢查場景
        "close up of a bright empty apartment corner where wall meets ceiling, clean white paint, daylight from a nearby window",
        "empty bright apartment room with bare walls, a window frame and wooden floor, inspection viewpoint, natural daylight",
        "bright empty balcony of a Taiwanese apartment with a metal railing, looking out to a green neighborhood, daytime",
        "bright empty bathroom interior with tiled walls and a window, clean and dry, natural light",
        "empty apartment kitchen with bare counters and a bright window, light wood cabinets, daylight",
        "looking up at an apartment ceiling with a light fixture and clean white surface, bright daylight from a window",
    ]),
    ("term-", [      # 房地產名詞：建築構造特寫
        "close up architectural detail of a Taiwanese apartment balcony and its overhanging eave, clean concrete, bright daylight",
        "exterior detail of a modern apartment facade showing balconies and window ledges, clean lines, bright sunlight",
        "bright apartment building lobby with a high ceiling and stone floor, common area, natural daylight",
        "roof terrace of a Taiwanese apartment with tiled floor and a low parapet wall, blue sky, daytime",
        "apartment stairwell and corridor with clean tiled walls, daylight through a window, no people",
    ]),
    ("faq-", [       # 常見問題：文件 / 諮詢 / 桌面
        "tidy desk with an open folder of documents and a pen by a sunny window, overhead view, bright natural light",
        "clean modern meeting table with a notebook and two chairs by a large bright window, no people, warm neutral tones",
        "sunlit desk with a calculator, a small house model and a clipboard, minimal composition, soft shadows",
        "bright modern office corner with a wooden desk, a plant and a bookshelf, natural daylight, no people",
        "close up of a stack of clean blank documents and a pen on a light wooden table, morning sunlight",
        "modern apartment entrance door with a clean frame and a doormat, bright hallway daylight",
    ]),
    ("tool-", [      # 工具：桌面試算 / 工作台
        "clean modern desk with a laptop, calculator and notepad, bright daylight, overhead view, blank screen",
        "minimal workspace with a tablet, a cup of coffee and a notebook by a sunny window, warm neutral tones",
        "tidy home office desk with a monitor, keyboard and a small plant, bright morning light, blank screen",
    ]),
    ("week-", [      # 週記：工作 / 城市
        "tidy desk setup with a monitor and keyboard by a window overlooking a bright city, blank screen, daytime",
        "modern home office with a desk, chair and bookshelf, large window with daylight, clean and minimal",
        "bright coworking space interior with wooden desks and plants, large windows, no people, daytime",
    ]),
    ("community-", [  # 社區評論：住宅社區示意（刻意不拍成可辨識的特定建築）
        "landscaped inner courtyard of a Taiwanese residential complex with trees and walking paths, bright daylight, no people",
        "modern Taiwanese residential community entrance with a stone facade and greenery, clean and bright, daytime",
        "row of mid-rise residential apartment buildings along a tree-lined Taiwanese street, bright clear daytime",
        "bright residential building lobby with high ceiling, stone walls and indoor plants, daylight through tall glass",
        "aerial view of a Taiwanese residential community with several apartment blocks and a central green space, clear sky",
    ]),
    ("policy-", [    # 政策
        "modern Taiwanese government civic building exterior, clean concrete and glass facade, wide plaza, bright open sky",
        "bright public service hall interior with orderly counters and high ceilings, natural daylight",
        "wide daytime view of a Taiwanese city hall plaza with open paving and flagpoles, clear blue sky",
    ]),
]


# ── 主題判定 ───────────────────────────────────────────────────────────
# 由上而下比對，第一個命中的類別決定畫面。畫面一律亮色白天。
#
# ⚠️ 每個類別都要給「多個場景變體」，用 slug hash 挑一個。
#    2026-08-26 第一版每類只有一個場景，結果 40 張裡 23 張是同一個銀行大廳
#    （news-alert 那批幾乎全是新青安主題），/posts/ 列表看起來像複製貼上。
THEMES = [
    # ── 行政區 / 地標 ────────────────────────────────────────────────
    (("北屯", "捷運綠線", "十四期", "機捷"), [
        "wide aerial view of Beitun district Taichung, new mid-rise residential towers along a green MRT viaduct, tree-lined boulevard",
        "street level view of a broad Taichung avenue with an elevated MRT line overhead, modern apartment buildings, leafy street trees",
        "aerial view of a newly developed Taichung residential block, orderly apartment towers around a green neighborhood park",
    ]),
    (("西屯", "水湳", "七期", "會展"), [
        "wide aerial view of Xitun Taichung modern business district, glass office towers and luxury residential high-rises, wide landscaped avenue",
        "modern Taiwanese convention center exterior with sweeping curved roof, wide plaza, clear sky",
        "street level view of a wide upscale Taichung boulevard lined with glass towers and manicured median planting",
    ]),
    (("南屯", "單元二", "單元五", "文心"), [
        "wide aerial view of Nantun Taichung, contemporary residential towers beside a large green park, wide clean streets",
        "large urban park with a lake surrounded by modern residential towers, Taiwan, bright daytime",
        "aerial view of a planned residential district in Taiwan, grid streets, new apartment blocks and green belts",
    ]),
    (("豐原", "后里", "神岡", "大雅"), [
        "wide aerial view of a Taiwanese suburban town center, low-rise apartment blocks and shophouses, distant green mountains",
        "quiet Taiwanese small town street with mixed shophouses and low apartments, mountains on the horizon, bright daylight",
        "aerial view of a Taiwanese township edge where housing meets farmland, green fields and distant hills",
    ]),
    (("大里", "太平", "霧峰", "烏日"), [
        "wide aerial view of a Taichung satellite township, mixed low-rise apartments and new residential towers, rice fields and hills in the distance",
        "new residential towers rising at the edge of a Taiwanese township, surrounding low houses and green fields, bright sky",
        "aerial view of a Taiwanese suburb with a river running through it, bridges and mixed housing, clear daytime",
    ]),
    (("海線", "沙鹿", "梧棲", "清水", "龍井", "大甲"), [
        "wide aerial view of Taichung coastal township, low-rise housing and new residential blocks, open sky and distant sea horizon",
        "coastal Taiwanese town seen from above, wide flat streets, port cranes far in the distance, bright open sky",
        "aerial view of a seaside Taiwanese township with wind turbines on the far coastline, low housing, clear blue sky",
    ]),
    (("中區", "東區", "南區", "北區", "舊市區"), [
        "wide aerial view of central Taichung old town, dense mid-rise apartment buildings and narrow busy streets, urban texture",
        "street level view of an older Taichung shopping street with tiled mid-rise buildings and shop awnings, bright midday light",
        "aerial view of a dense older Taiwanese city district, rooftops with water tanks, narrow lanes, bright daylight",
    ]),
    # ── 房貸 / 利率（最大宗，變體要最多）─────────────────────────────
    (("利率", "房貸", "貸款", "新青安", "青安", "撥款", "成數", "寬限期"), [
        "clean modern bank lobby interior with tall bright windows, minimalist counters, soft daylight, architectural interior photography",
        "sunlit wooden desk with a small white house model, a set of keys and neatly stacked documents, shallow depth of field, warm morning light",
        "bright modern apartment building entrance lobby with mailboxes, polished stone floor, sunlight through glass doors",
        "modern Taiwanese bank branch exterior at street level, clean glass and stone facade, bright daytime, tidy sidewalk",
        "tidy home desk by a sunny window with a calculator, an open notebook and a potted plant, overhead view, bright natural light",
        "empty bright new apartment living room with a large window looking out over a green city, wooden floor, morning sunlight",
        "close up of house keys resting on a clean signed document beside a small potted plant, soft daylight, minimal composition",
    ]),
    # ── 政策 / 稅制 ─────────────────────────────────────────────────
    (("政策", "稅", "法規", "都更", "危老", "囤房", "實價", "登錄"), [
        "modern Taiwanese government civic building exterior, clean concrete and glass facade, wide plaza, bright open sky",
        "bright public service hall interior with orderly counters and high ceilings, natural daylight, clean modern architecture",
        "wide daytime view of a Taiwanese city hall plaza with flagpoles and open paving, clear blue sky",
        "old low-rise Taiwanese apartment block beside a newly rebuilt modern tower, urban renewal contrast, bright daylight",
    ]),
    # ── 預售 / 建案 ─────────────────────────────────────────────────
    (("預售", "建案", "推案", "工地", "建照", "使照", "開工"), [
        "construction site of a modern residential high-rise in Taiwan, tower crane against clear sky, tidy safety fencing, daytime",
        "residential towers under construction with scaffolding and green safety netting, bright blue sky, wide shot",
        "architectural scale model of a residential development on a clean white table, bright studio daylight, no text",
        "aerial view of a large construction site with foundations and cranes beside finished apartment towers, clear daytime",
    ]),
    # ── 餘屋 / 庫存 ─────────────────────────────────────────────────
    (("餘屋", "待售", "庫存", "空屋", "餘量", "去化"), [
        "row of newly finished residential towers in Taiwan, empty balconies, clean facade, wide open sky, daytime",
        "empty bright unfurnished apartment interior with bare walls and large windows, wooden floor, daylight",
        "aerial view of several completed but unoccupied apartment towers with empty parking areas, bright daytime",
    ]),
    # ── 交易量 ─────────────────────────────────────────────────────
    (("移轉", "成交", "交易", "量能", "棟數", "買氣"), [
        "wide aerial view of a Taichung residential neighborhood, orderly rows of apartment towers, wide boulevards, clear daytime sky",
        "busy Taiwanese city street from above with traffic and mixed residential buildings, bright midday light",
        "aerial view of a mixed Taiwanese cityscape, apartment towers, parks and arterial roads, clear sky",
    ]),
    # ── 社區 ───────────────────────────────────────────────────────
    (("社區", "熱銷", "銷售", "戶數"), [
        "modern Taiwanese residential community entrance, landscaped courtyard, clean stone facade, bright natural daylight",
        "landscaped inner courtyard of a modern residential complex with trees and walkways, sunlight, no people",
        "clean modern residential lobby with high ceiling, stone walls and greenery, daylight through tall glass",
    ]),
    # ── 總經 / 景氣 ─────────────────────────────────────────────────
    (("景氣", "總經", "股", "經濟", "所得", "房價所得比", "通膨"), [
        "modern Taichung city skyline seen from a distance, mixed high-rise towers, clear blue sky, calm bright daytime atmosphere",
        "wide panoramic daytime view of a Taiwanese city with mountains behind, hazy blue sky, orderly urban grid",
        "elevated view of a Taiwanese business district with office towers and wide roads, bright clear morning",
    ]),
]

DEFAULT_SCENES = [
    "wide aerial view of modern Taichung Taiwan residential district, clean mid-rise and high-rise apartment towers, tree-lined streets",
    "street level view of a clean modern Taiwanese residential street with apartment buildings and street trees, bright daylight",
    "aerial view of a Taiwanese city neighborhood at midday, apartment blocks, parks and wide roads, clear sky",
]

# 亮色鐵則：禁 night / dusk / dark / moody / neon / blue hour（CLAUDE.md 圖卡鐵則延伸）
STYLE_SUFFIX = (
    "bright daytime, clear blue sky, natural sunlight, soft shadows, "
    "photorealistic architectural photography, wide angle, sharp focus, "
    "clean and airy, professional photography, "
    # ⚠️ 舊那批 109 張的 prompt 寫「magazine cover quality / Architectural Digest
    #    style」，模型就真的畫出雜誌版面 —— 印著 TAVAN / REAL WHAT MARKEET /
    #    DASKET 一堆亂碼英文字。任何「雜誌/海報/排版」字眼都會誘發出字。
    "no text, no lettering, no watermark, no logo, no signage, no captions, "
    "no magazine layout, no border, no frame, no people, no cars in focus"
)


def stable_hash(s: str) -> int:
    """穩定 hash（Python 內建 hash 有 PYTHONHASHSEED 隨機化，不能用）。"""
    return int(hashlib.sha1(s.encode("utf-8")).hexdigest()[:12], 16)


def build_prompt(title: str, tags: list[str], slug: str, variant_shift: int = 0) -> str:
    """挑場景 → 組 prompt。同一篇 slug 永遠拿到同一個場景（可重現），
    但同類別的不同文章會分散到不同場景，避免整批長一樣。
    variant_shift 用來「換一張」：重生時 +1 就會挑到別的場景。"""
    haystack = title + " " + " ".join(str(t) for t in tags)
    scenes = None
    # 先看文章家族（slug 前綴），教學文的畫面需求跟數據文完全不同
    for prefix, opts in SLUG_FAMILIES:
        if slug.startswith(prefix):
            scenes = opts
            break
    if scenes is None:
        scenes = DEFAULT_SCENES
        for keywords, opts in THEMES:
            if any(k in haystack for k in keywords):
                scenes = opts
                break
    scene = scenes[(stable_hash(slug) + variant_shift) % len(scenes)]
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


def make_thumbs() -> None:
    """產 /og/thumbs/*.webp 縮圖。

    ⚠️ 2026-08-26 血淚：Card.astro / RelatedPosts.astro 是透過
    src/utils/ogThumb.ts 把 /og/x.jpg 硬改寫成 /og/thumbs/x.webp，**沒有
    fallback**。只生 jpg 不生 webp，列表卡片線上就是 404 破圖 —— 而且
    文章頁本身看起來正常，很難發現。CI 那邊已補上這步，這裡再做一次
    當保險（發布管線單篇呼叫時 CI 還沒跑到）。"""
    script = ROOT / "scripts" / "generate-og-thumbs.mjs"
    if not script.exists():
        print("[!] 找不到 generate-og-thumbs.mjs，縮圖沒產（列表卡片會破圖）")
        return
    print("\n[*] 產縮圖 webp（列表卡片吃這個，不產會 404）…")
    r = subprocess.run(["node", str(script)], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = [l for l in (r.stdout or "").splitlines() if l.strip()][-3:]
    for l in tail:
        print("   ", l)
    if r.returncode != 0:
        print(f"[!] 縮圖產生失敗（{r.returncode}），列表卡片可能破圖："
              f"{(r.stderr or '')[:200]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只列出要補哪些，不生圖")
    ap.add_argument("--limit", type=int, default=0, help="最多處理幾篇（0=不限）")
    ap.add_argument("--only", nargs="+", default=None,
                    help="只處理指定檔名（給發布管線單篇呼叫用）")
    ap.add_argument("--regen", action="store_true",
                    help="連已有圖的也重生（配 --only 用來換掉不喜歡的那幾張）")
    ap.add_argument("--shift", type=int, default=0,
                    help="換一個場景變體（--regen 時用，1/2/3… 會挑到不同畫面）")
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
        if args.regen:
            todo.append((md, "強制重生"))
            continue
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
        prompt = build_prompt(title, tags, slug, args.shift)
        out = OG_DIR / f"{slug}.jpg"
        # seed 綁 slug＋shift：同一篇重跑結果一樣（可重現），--shift 才換畫面
        seed = (stable_hash(slug) + args.shift * 7919) % (2 ** 31)

        print(f"\n[{i}/{len(todo)}] {title[:48]}")
        print(f"        prompt: {prompt[:110]}...")
        t0 = time.time()
        try:
            png = gen_flux_image(prompt, width=GEN_W, height=GEN_H, seed=seed)
            to_og_jpg(png, out)
            if not re.search(r"^ogImage:\s*\S", text, re.MULTILINE):
                # ⚠️ newline="" 不做行尾轉換。Windows 的 write_text 預設會把
                #    \n 寫成 \r\n，--regen 時 109 個檔會全部變成「有改動但
                #    diff 是空的」，把 commit 洗成一片雜訊。
                md.write_text(insert_og_line(text, f"/og/{out.name}"),
                              encoding="utf-8", newline="")
            # 已經有 ogImage 就完全不碰檔案（重生只換圖，不動 frontmatter）
            print(f"        -> {out.name}  {out.stat().st_size/1024:.0f}KB  ({time.time()-t0:.0f}s)")
            ok += 1
        except Exception as e:
            print(f"        !! 失敗: {str(e)[:160]}")
            fail.append(md.name)

    if ok:
        make_thumbs()

    print(f"\n[完成] 成功 {ok} / {len(todo)}")
    if fail:
        print("[失敗清單]（可直接重跑本腳本，會自動只補這幾篇）")
        for n in fail:
            print(f"    - {n}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
