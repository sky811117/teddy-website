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

# 容忍 CRLF：git core.autocrlf=true，checkout 出來的 md 是 CRLF，
# 只認 LF 的 regex 會整個比對不到 → parse_frontmatter 回 None → crash
FM_RE = re.compile("^---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)


# ── 畫面總則：漂亮的台灣 ─────────────────────────────────────────────
# 2026-08-26 景泰兩次指示定案：
#   ①「儘量要是台灣的市容、風景」→ 場景一律帶台灣地景（中央山脈／大肚山
#      當背景、亞熱帶植栽、台中真實地標）
#   ②「是要漂亮的，不是那種舊城市破破爛爛的感覺」→ ⛔ 禁鐵窗、電線桿、
#      交錯電線、鐵皮加蓋、老磁磚髒污、機車亂停、密集雜亂老市區
#
# A/B 測試結論（4 輪 33 張實測）：只寫 "Taiwan/Taichung" 會生出通用亞洲城市；
# 加寫實老台灣元素會變成景泰打槍的破爛感；正解是「新重劃區 + 台中地標 +
# 自然美景 + 山景」，台灣辨識度靠山景與亞熱帶植栽，不靠老舊質感。
#
# ⚠️ FLUX 實測畫得出來的台中地標：國家歌劇院（曲面白殼）、秋紅谷（下凹綠地
#    +湖+拱橋）、高美濕地（木棧道+風機）、東海路思義教堂（黃色曲面屋頂）、
#    大坑（層疊綠山+雲霧）、大肚山（俯瞰台中盆地）。這幾個都很漂亮，可用。

PRETTY = (
    "pristine and well maintained, upscale modern development, immaculate clean surfaces, "
    "manicured landscaping, bright daytime, clear blue sky, golden natural sunlight, "
    "photorealistic architectural photography, sharp focus, high end real estate photography"
)

# ⛔ 這些一定要擋：前段是景泰的「不要破爛」，後段是「不要出字」
#    （5/24 那批 109 張就是 prompt 寫 magazine cover quality 才印出
#     TAVAN / REAL WHAT MARKEET / DASKET 一堆亂碼英文）
STYLE_SUFFIX = (
    f"{PRETTY}, "
    "no old weathered buildings, no rust, no stains, no metal window grilles, "
    "no utility poles, no overhead cables, no corrugated metal roofs, no rooftop additions, "
    "no clutter, no parked scooters, no cramped alleys, "
    "no text, no lettering, no watermark, no logo, no signage, no captions, "
    "no magazine layout, no border, no frame, no people, no cars in focus"
)

# 台灣味的來源：山景 + 亞熱帶植栽。所有場景都盡量帶上其中之一。
TW_BG = "green Central Range mountains on the horizon"
TW_PLANT = "palms and flowering subtropical trees"


# ── 文章家族判定（優先於下面的關鍵字表）─────────────────────────────
# 教學型文章（看屋／名詞／FAQ／工具／週記／社區）要的畫面跟房市數據文
# 完全不同。舊那批 109 張就是全部丟同一個「黃昏豪宅」prompt，結果
# 「教你測漏水」配一張夕陽別墅。
SLUG_FAMILIES = [
    ("viewing-", [   # 看屋實戰：明亮新成屋的檢查點（不是老屋）
        f"close up of a bright clean empty apartment corner where wall meets ceiling, flawless white paint, sunlight from a nearby window, {PRETTY}",
        f"bright spacious empty modern apartment room, floor to ceiling window, polished light stone floor, view over a green Taiwanese cityscape with {TW_BG}",
        f"clean modern apartment balcony with glass railing, {TW_PLANT} below, looking out over an upscale Taiwanese residential district with {TW_BG}",
        f"bright immaculate modern bathroom, large format tiles, frameless glass shower, window with daylight",
        f"bright empty modern kitchen with clean stone countertops and light wood cabinets, large window, daylight",
        f"looking up at a clean modern apartment ceiling with recessed lighting, flawless white surface, daylight",
    ]),
    ("term-", [      # 房地產名詞：現代建築構造細節
        f"architectural detail of an elegant modern Taiwanese residential tower, clean stone facade with generous balconies and glass railings, {TW_BG}",
        f"upscale modern apartment building facade seen from below, glass curtain wall and stone cladding, {TW_PLANT}, clear sky",
        f"spacious bright residential lobby with high ceiling, stone walls, indoor greenery, tall glass wall with daylight",
        f"beautiful roof terrace of a modern Taiwanese residential tower, wooden deck, planters, panoramic view of a green city with {TW_BG}",
        f"clean bright modern apartment corridor with stone floor and recessed lighting, daylight from an end window",
    ]),
    ("faq-", [       # 常見問題：乾淨的文件 / 諮詢 / 現代空間
        f"tidy light wooden desk with an open folder and a pen by a sunny window, overhead view, {PRETTY}",
        f"elegant modern consultation room with a round table and two chairs, floor to ceiling window overlooking a green Taiwanese city with {TW_BG}",
        f"sunlit clean desk with a calculator, a small white house model and a clipboard, minimal composition",
        f"bright modern office corner with a light wood desk, a potted plant and a bookshelf, large window, daylight",
        f"close up of neatly stacked blank documents and a fountain pen on a light stone table, morning sunlight",
        f"elegant modern apartment entrance door with clean stone surround, bright hallway daylight",
    ]),
    ("tool-", [      # 工具：乾淨桌面
        f"clean modern desk with a laptop, calculator and notepad, blank screen, bright daylight, overhead view, {PRETTY}",
        f"minimal bright workspace with a tablet, a cup and a notebook by a sunny window, light wood and stone",
        f"tidy modern home office desk with a monitor and a small plant, blank screen, large window with city and {TW_BG}",
    ]),
    ("week-", [      # 週記：現代工作空間
        f"elegant modern home office with a desk by a floor to ceiling window overlooking a bright green Taiwanese city with {TW_BG}, blank screen",
        f"bright minimal workspace with light wood desk, designer chair and bookshelf, large window, daylight",
        f"spacious modern coworking interior with wooden desks and abundant plants, floor to ceiling glass, daytime",
    ]),
    ("community-", [  # 社區評論：高級社區（示意，不指向特定建築）
        f"beautifully landscaped courtyard of an upscale Taiwanese residential complex, reflecting pool, {TW_PLANT}, stone paving, modern towers around, sunlight",
        f"elegant entrance plaza of a modern Taiwanese residential community, stone facade, water feature, {TW_PLANT}, {TW_BG}",
        f"row of elegant modern residential towers along a wide tree-lined boulevard in Taichung Taiwan, {TW_BG}",
        f"spacious bright residential lobby with high ceiling, stone walls and indoor greenery, tall glass with daylight",
        f"aerial view of an upscale Taiwanese residential community, well spaced modern towers around a large landscaped garden, {TW_BG}",
    ]),
    ("policy-", [    # 政策：現代公共建築
        f"elegant modern Taiwanese civic building, clean stone and glass facade, wide plaza with {TW_PLANT}, clear sky",
        f"bright spacious public service hall interior, high ceiling, orderly counters, abundant natural daylight",
        f"the National Taichung Theater by Toyo Ito, distinctive curved white concrete shell facade, wide clean plaza, clear sky",
    ]),
]


# ── 主題判定 ───────────────────────────────────────────────────────────
# 由上而下比對，第一個命中的類別決定畫面。
THEMES = [
    # ── 行政區 / 地標 ────────────────────────────────────────────────
    (("北屯", "捷運綠線", "十四期", "機捷"), [
        f"wide aerial view of a modern newly developed residential district in Beitun Taichung Taiwan, elegant high-rise towers along a landscaped MRT boulevard, large green park, {TW_BG}",
        f"street level view of a wide clean boulevard in Taichung with an elevated MRT viaduct, elegant modern apartment towers, {TW_PLANT}",
        f"aerial view of a newly built upscale Taichung residential block, well spaced modern towers around a green neighborhood park, {TW_BG}",
    ]),
    (("西屯", "水湳", "七期", "會展"), [
        f"Taichung Taiwan 7th redevelopment zone skyline, sleek glass office and residential towers, wide landscaped avenue with {TW_PLANT}, {TW_BG}",
        f"Qiuhong Valley Park Taichung Taiwan, sunken green park with a lake and arched wooden bridges, surrounded by elegant modern high rise towers, clear sky",
        f"modern Taiwanese convention center exterior with a sweeping curved roof, wide clean plaza, {TW_PLANT}, clear sky",
    ]),
    (("南屯", "單元二", "單元五", "文心"), [
        f"large beautiful urban park in Taichung Taiwan with wide lawns, curved paths and a lake, elegant modern residential towers beyond the treeline, {TW_BG}",
        f"wide aerial view of a planned upscale residential district in Taichung, grid of clean boulevards, modern towers and generous green belts, {TW_BG}",
        f"street level view of a wide green parkway in Taichung Taiwan, elegant modern towers on both sides, flowering trees, neat sidewalks",
    ]),
    (("豐原", "后里", "神岡", "大雅"), [
        f"aerial view of a tidy Taiwanese town center with modern low-rise apartment blocks and clean streets, surrounding farmland, {TW_BG}",
        f"beautiful Taiwanese countryside near a town, neat flooded rice paddies reflecting the sky, tree lines, {TW_BG}",
        f"wide clean street of a Taiwanese town with modern mid-rise buildings and street trees, bright daylight, {TW_BG}",
    ]),
    (("大里", "太平", "霧峰", "烏日"), [
        f"aerial view of a Taichung satellite township, new modern residential towers rising beside neat green farmland, {TW_BG}",
        f"wide aerial view of a Taiwanese suburb with a clean river running through it, landscaped riverside parks and modern housing, {TW_BG}",
        f"elegant modern residential towers at the edge of a Taiwanese township, wide clean roads, green fields beyond, clear sky",
    ]),
    (("海線", "沙鹿", "梧棲", "清水", "龍井", "大甲"), [
        f"Gaomei Wetlands Taichung Taiwan, long clean wooden boardwalk over shallow reflective tidal flats, rows of white wind turbines on the horizon, bright clear sky",
        f"wide aerial view of the Taichung coastal plain, tidy modern low-rise townscape, white wind turbines along the shoreline, blue Taiwan Strait horizon",
        f"beautiful coastal scenery of western Taiwan, calm sea, clean sandy shoreline, white wind turbines, bright open sky",
    ]),
    (("中區", "東區", "南區", "北區", "舊市區"), [
        f"beautifully restored riverside walkway in central Taichung Taiwan, clear water canal, stone banks, landscaped planting and modern lighting, bright daylight",
        f"revitalized old town district of Taichung Taiwan, restored heritage buildings beside clean modern mid-rise architecture, tidy pedestrian street, {TW_PLANT}",
        f"elegant tree-lined pedestrian boulevard in central Taichung Taiwan, modern buildings, wide clean paving, flowering trees",
    ]),
    # ── 房貸 / 利率（最大宗，變體要最多）─────────────────────────────
    (("利率", "房貸", "貸款", "新青安", "青安", "撥款", "成數", "寬限期"), [
        f"elegant modern bank lobby interior with tall bright windows and minimalist stone counters, abundant daylight",
        f"sunlit light wooden desk with a small white house model, a set of keys and neatly stacked documents, shallow depth of field",
        f"beautiful bright residential lobby with mailboxes, polished stone floor, sunlight through tall glass doors, indoor greenery",
        f"elegant modern bank branch exterior at street level, clean glass and stone facade, {TW_PLANT}, bright daytime",
        f"tidy modern desk by a sunny window with a calculator, an open notebook and a small plant, overhead view",
        f"bright spacious empty new apartment living room with floor to ceiling windows overlooking a green Taiwanese city with {TW_BG}",
        f"close up of house keys resting on a clean document beside a small potted plant on light stone, soft daylight",
    ]),
    # ── 政策 / 稅制 ─────────────────────────────────────────────────
    (("政策", "稅", "法規", "都更", "危老", "囤房", "實價", "登錄"), [
        f"elegant modern Taiwanese civic building, clean stone and glass facade, wide plaza with {TW_PLANT}, clear sky",
        f"bright spacious public service hall interior, high ceiling, orderly counters, abundant natural daylight",
        f"the National Taichung Theater by Toyo Ito, distinctive curved white concrete shell facade, wide clean plaza",
        f"a newly rebuilt elegant modern residential tower standing on a tidy urban renewal site, clean hoarding, {TW_BG}",
    ]),
    # ── 預售 / 建案 ─────────────────────────────────────────────────
    (("預售", "建案", "推案", "工地", "建照", "使照", "開工"), [
        f"tidy construction site of an elegant modern residential high-rise in Taiwan, tower crane against a clear sky, clean safety hoarding, {TW_BG}",
        f"newly topped out modern residential towers with neat scaffolding and clean green safety netting, bright blue sky",
        f"beautiful architectural scale model of an upscale residential development on a clean white table, bright studio daylight",
        f"aerial view of a large well organised construction site beside finished elegant apartment towers, clear daytime, {TW_BG}",
    ]),
    # ── 餘屋 / 庫存 ─────────────────────────────────────────────────
    (("餘屋", "待售", "庫存", "空屋", "餘量", "去化"), [
        f"row of newly completed elegant residential towers in Taiwan, clean stone facades, glass balcony railings, {TW_PLANT}, clear sky",
        f"bright spacious empty new apartment interior with flawless walls and floor to ceiling windows, polished stone floor, daylight",
        f"aerial view of several newly finished upscale apartment towers with landscaped grounds, {TW_BG}",
    ]),
    # ── 交易量 ─────────────────────────────────────────────────────
    (("移轉", "成交", "交易", "量能", "棟數", "買氣"), [
        f"wide aerial view of a modern upscale Taichung residential district, elegant towers along clean tree-lined boulevards, {TW_BG}",
        f"elevated view of a bright modern Taiwanese cityscape, well spaced towers, green parks and wide avenues, clear sky",
        f"beautiful aerial view of a newly developed Taiwanese city district at midday, orderly modern architecture and abundant greenery, {TW_BG}",
    ]),
    # ── 社區 ───────────────────────────────────────────────────────
    (("社區", "熱銷", "銷售", "戶數"), [
        f"beautifully landscaped courtyard of an upscale Taiwanese residential complex, reflecting pool, {TW_PLANT}, stone paving, sunlight",
        f"elegant entrance plaza of a modern Taiwanese residential community, stone facade, water feature, {TW_PLANT}, {TW_BG}",
        f"spacious bright residential lobby with high ceiling, stone walls and indoor greenery, tall glass with daylight",
    ]),
    # ── 總經 / 景氣 ─────────────────────────────────────────────────
    (("景氣", "總經", "股", "經濟", "所得", "房價所得比", "通膨"), [
        f"panoramic view from Dadu plateau over the Taichung Taiwan basin, bright modern cityscape stretching to the {TW_BG}",
        f"elegant modern Taichung skyline seen across a large green park, glass towers, clear blue sky",
        f"elevated view of an upscale Taiwanese business district, sleek office towers and wide landscaped avenues, bright morning",
    ]),
]

DEFAULT_SCENES = [
    f"wide aerial view of a modern upscale Taichung Taiwan residential district, elegant towers, clean tree-lined boulevards and a green park, {TW_BG}",
    f"street level view of a wide clean tree-lined boulevard in Taichung Taiwan, elegant modern residential buildings, {TW_PLANT}",
    f"beautiful elevated view of a bright modern Taiwanese city neighborhood, well spaced towers, parks and wide avenues, {TW_BG}",
]


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
    m = re.search("^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]+.+\r?\n)+)", fm, re.MULTILINE)
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
    text = md.read_text(encoding="utf-8-sig")
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
        text = md.read_text(encoding="utf-8-sig")
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
