# -*- coding: utf-8 -*-
"""
品牌化 OG 圖合成器 — 本地 FLUX 出底圖 + 疊景泰品牌識別。

用在「代表網站/頁面本身」的分享預覽圖（default-og、各靜態頁專屬 og）。
文章封面圖走 generate_og_local_flux.py（純照片、不疊字）。

背景：2026-08-26 發現 public/default-og.jpg 一直是 AstroPaper 佈景主題的
英文示範拼貼圖（印著 "AstroPaper" "Mingalaba" "Copyright © 2022"），
而它是全站 20 個靜態頁分享到 LINE/FB 的預覽圖 —— 等於景泰把自己網站
貼給客戶，客戶看到的是別人的英文 demo。

版面（1200x630）：
    左側深棕漸層壓底 → 大標 → 副標（暖金）→ 底部一行品牌與 LINE
    右下角有巢氏 logo

用法：
    python scripts/make_brand_og.py --preset default
    python scripts/make_brand_og.py --preset buy
    python scripts/make_brand_og.py --all
    python scripts/make_brand_og.py --preset default --shift 1   # 換底圖
"""
from __future__ import annotations

import argparse
import hashlib
import io
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, r"C:\Users\a0920\房仲工作站\420_IG_API")
from comfyui_gen import gen_flux_image  # noqa: E402

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630

# 網站品牌色（src/styles/theme.css）
CREAM = (245, 241, 235)
DARK = (44, 37, 34)
GOLD = (201, 168, 124)

FONT_BOLD = r"C:\Windows\Fonts\msjhbd.ttc"   # 微軟正黑 Bold
FONT_REG = r"C:\Windows\Fonts\msjh.ttc"      # 微軟正黑 Regular
LOGO = ROOT / "public" / "logos" / "yochaoshi.png"

BRAND_LINE = "陳景泰・有巢氏房屋 台中世界之心加盟店"
CONTACT_LINE = "LINE sky811117 ・ 0920-118-756"

STYLE = (
    # 2026-08-26 景泰定案：要漂亮的台灣，不要老舊破爛的市容
    "pristine and well maintained, upscale modern development, immaculate clean surfaces, "
    "manicured landscaping, bright daytime, clear blue sky, golden natural sunlight, "
    "photorealistic architectural photography, sharp focus, high end real estate photography, "
    "no old weathered buildings, no rust, no metal window grilles, no utility poles, "
    "no overhead cables, no corrugated metal roofs, no clutter, "
    "no text, no lettering, no watermark, no signage, no people"
)

# 每個 preset 給多個底圖候選，--shift 換一張
PRESETS = {
    "default": {
        "out": "public/default-og.jpg",
        "title": "台中買房賣房",
        "sub": "用 AI 工具，把資訊差還給你",
        "scenes": [
            "wide aerial view of a modern upscale Taichung Taiwan district, elegant glass and stone towers, wide tree-lined boulevards, a large green park, green Central Range mountains on the horizon",
            "Qiuhong Valley Park Taichung Taiwan, sunken green park with a lake and arched wooden bridges, surrounded by elegant modern high rise towers, clear sky",
            "panoramic view from Dadu plateau over the bright modern Taichung Taiwan basin, elegant cityscape stretching to the green Central Range mountains on the horizon",
        ],
    },
    "buy": {
        "out": "public/og/page-buy.jpg",
        "title": "買房，不用自己摸索",
        "sub": "看屋、出價、貸款，一步一步陪你走",
        "scenes": [
            "bright spacious empty modern apartment living room, floor to ceiling windows overlooking a green Taiwanese city with green Central Range mountains on the horizon, polished light stone floor",
            "elegant empty modern apartment interior with open kitchen and dining area, light wood and stone, large windows with city and mountain view",
        ],
    },
    "sell": {
        "out": "public/og/page-sell.jpg",
        "title": "賣房，先把價格算清楚",
        "sub": "行情評估、屋況建議、多平台曝光",
        "scenes": [
            "elegant modern Taiwanese residential tower exterior, clean stone and glass facade, landscaped entrance plaza with palms, green Central Range mountains on the horizon",
            "beautifully staged bright modern living room ready for viewing, light stone floor, large window with green city view",
        ],
    },
    "services": {
        "out": "public/og/page-services.jpg",
        "title": "我幫你做的事",
        "sub": "買房・賣房・行情評估・換屋",
        "scenes": [
            "elegant modern real estate office interior, meeting table, floor to ceiling windows overlooking a green Taichung cityscape with green Central Range mountains on the horizon",
            "bright modern consultation room with a round table, tall windows with a panoramic view of an upscale Taiwanese city",
        ],
    },
    "about": {
        "out": "public/og/page-about.jpg",
        "title": "陳景泰｜台中房仲",
        "sub": "短影音叫泰迪・房仲大看板 BigKanBan 團隊",
        "scenes": [
            "beautiful wide aerial view of an upscale Taichung Taiwan residential district, elegant towers, green parks, green Central Range mountains on the horizon",
            "wide clean tree-lined green parkway in Taichung Taiwan, elegant modern towers on both sides, flowering trees",
        ],
    },
    "contact": {
        "out": "public/og/page-contact.jpg",
        "title": "有問題，直接問我",
        "sub": "LINE 秒回・台中全區",
        "scenes": [
            "elegant bright reception area with a stone counter and abundant green plants, tall glass with daylight",
            "spacious bright residential lobby with high ceiling, stone walls and indoor greenery, tall glass with daylight",
        ],
    },
    "faq": {
        "out": "public/og/page-faq.jpg",
        "title": "買賣房常見問題",
        "sub": "稅費、貸款、看屋、簽約，一次講清楚",
        "scenes": [
            "tidy light wooden desk with an open notebook, a calculator and a small white house model by a sunny window, overhead view",
            "clean modern desk with neatly stacked documents and a small plant, bright daylight, minimal composition",
        ],
    },
    "tools": {
        "out": "public/og/page-tools.jpg",
        "title": "免費房產小工具",
        "sub": "新青安試算・稅費計算・議價心法",
        "scenes": [
            "clean modern desk with a laptop, calculator and a small white house model, blank screen, bright daylight, overhead view",
            "minimal bright workspace with a tablet, notebook and a cup by a sunny window, light wood and stone",
        ],
    },
    "properties": {
        "out": "public/og/page-properties.jpg",
        "title": "在售物件",
        "sub": "台中全區・持續更新",
        "scenes": [
            "row of elegant modern residential towers in Taiwan seen across a beautiful green park with a lake, green Central Range mountains on the horizon",
            "aerial view of an upscale Taichung residential neighborhood, well spaced elegant towers and landscaped streets, green Central Range mountains on the horizon",
        ],
    },
    "posts": {
        "out": "public/og/page-posts.jpg",
        "title": "台中房市筆記",
        "sub": "數據、政策、區域，白話講給你聽",
        "scenes": [
            "elegant modern Taichung skyline seen across a large green park, glass towers, clear blue sky, green Central Range mountains on the horizon",
            "beautiful elevated view of an upscale Taiwanese city district, sleek towers and wide landscaped avenues, bright morning",
        ],
    },
}


def stable_hash(s: str) -> int:
    return int(hashlib.sha1(s.encode("utf-8")).hexdigest()[:12], 16)


def cover_crop(im: Image.Image, w: int, h: int) -> Image.Image:
    scale = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((left, top, left + w, top + h))


def compose(bg: Image.Image, title: str, sub: str) -> Image.Image:
    im = cover_crop(bg.convert("RGB"), W, H)

    # 左側深棕漸層壓底：讓白字在任何底圖上都讀得到
    grad = Image.new("L", (W, 1))
    for x in range(W):
        t = x / W
        a = int(232 * max(0.0, 1 - (t / 0.78) ** 1.5))   # 左邊最深 → 右邊透明
        grad.putpixel((x, 0), a)
    mask = grad.resize((W, H))
    shade = Image.new("RGB", (W, H), DARK)
    im = Image.composite(shade, im, mask)

    # 底部整條再壓一層，讓品牌行穩定可讀
    bar = Image.new("L", (1, H))
    for y in range(H):
        t = y / H
        bar.putpixel((0, y), int(150 * max(0.0, (t - 0.62) / 0.38) ** 1.2))
    im = Image.composite(Image.new("RGB", (W, H), DARK), im, bar.resize((W, H)))

    d = ImageDraw.Draw(im)
    f_title = ImageFont.truetype(FONT_BOLD, 74)
    f_sub = ImageFont.truetype(FONT_REG, 33)
    f_brand = ImageFont.truetype(FONT_BOLD, 26)
    f_contact = ImageFont.truetype(FONT_REG, 24)

    x = 78
    d.text((x, 150), title, font=f_title, fill=CREAM)
    d.line([(x, 262), (x + 84, 262)], fill=GOLD, width=5)          # 暖金短線
    d.text((x, 292), sub, font=f_sub, fill=(226, 216, 204))

    d.text((x, 486), BRAND_LINE, font=f_brand, fill=CREAM)
    d.text((x, 528), CONTACT_LINE, font=f_contact, fill=GOLD)

    # 右下有巢氏 logo
    if LOGO.exists():
        lg = Image.open(LOGO).convert("RGBA")
        lh = 64
        lg = lg.resize((round(lg.width * lh / lg.height), lh), Image.LANCZOS)
        im.paste(lg, (W - lg.width - 60, H - lh - 54), lg)
    return im


def build(key: str, shift: int) -> bool:
    p = PRESETS[key]
    scenes = p["scenes"]
    scene = scenes[(stable_hash(key) + shift) % len(scenes)]
    seed = (stable_hash(key) + shift * 7919) % (2 ** 31)
    out = ROOT / p["out"]

    print(f"\n[{key}] {p['title']}")
    print(f"   底圖: {scene[:82]}…")
    t0 = time.time()
    try:
        png = gen_flux_image(f"{scene}, {STYLE}", width=1216, height=640, seed=seed)
    except Exception as e:
        print(f"   !! 生圖失敗: {str(e)[:150]}")
        return False
    img = compose(Image.open(io.BytesIO(png)), p["title"], p["sub"])
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=90, optimize=True, progressive=True)
    print(f"   -> {p['out']}  {out.stat().st_size/1024:.0f}KB  ({time.time()-t0:.0f}s)")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", choices=sorted(PRESETS), help="做哪一張")
    ap.add_argument("--all", action="store_true", help="全部做一遍")
    ap.add_argument("--shift", type=int, default=0, help="換一張底圖")
    args = ap.parse_args()

    keys = sorted(PRESETS) if args.all else ([args.preset] if args.preset else [])
    if not keys:
        ap.error("要給 --preset 或 --all")

    ok = sum(build(k, args.shift) for k in keys)

    # 縮圖：page-*.jpg 也會被 Card/RelatedPosts 的 ogThumb 改寫成 webp
    if ok:
        th = ROOT / "scripts" / "generate-og-thumbs.mjs"
        if th.exists():
            print("\n[*] 產縮圖 webp…")
            r = subprocess.run(["node", str(th)], cwd=ROOT, capture_output=True,
                               text=True, encoding="utf-8", errors="replace")
            for l in [x for x in (r.stdout or "").splitlines() if x.strip()][-2:]:
                print("   ", l)
    print(f"\n[完成] {ok}/{len(keys)}")
    return 0 if ok == len(keys) else 1


if __name__ == "__main__":
    raise SystemExit(main())
