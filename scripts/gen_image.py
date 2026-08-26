# -*- coding: utf-8 -*-
"""
teddy-website 通用生圖 CLI — 本地 ComfyUI + FLUX.1-schnell，永久 $0。

generate_og_local_flux.py 只處理 src/content/posts 的封面圖；
這支是給「網站任何地方要一張圖」用的（區域頁代表圖、靜態頁 hero、
預設 OG 圖、版面裝飾圖…），指定 prompt 與輸出路徑就好。

亮色鐵則寫死在 STYLE_SUFFIX，並會擋掉暗色字眼（night/dusk/dark/
moody/neon/blue hour）——景泰 2026-05-27、06-04 兩次打槍過暗色圖卡。

用法：
    python scripts/gen_image.py "wide aerial view of Beitun Taichung" public/areas/beitun.jpg
    python scripts/gen_image.py "..." public/hero.jpg --size 1600x900
    python scripts/gen_image.py "..." public/x.jpg --seed 42          # 可重現
    python scripts/gen_image.py "..." public/x.jpg --raw              # 不套亮色後綴
    python scripts/gen_image.py --batch jobs.tsv                      # 批次：prompt<TAB>輸出路徑
"""
from __future__ import annotations

import argparse
import io
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, r"C:\Users\a0920\房仲工作站\420_IG_API")
from comfyui_gen import gen_flux_image  # noqa: E402

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent

STYLE_SUFFIX = (
    # 2026-08-26 景泰定案：要漂亮的台灣市容風景，不要老舊破爛感
    "pristine and well maintained, upscale modern development, immaculate clean surfaces, "
    "manicured landscaping, bright daytime, clear blue sky, natural sunlight, "
    "photorealistic architectural photography, sharp focus, high end real estate photography, "
    "no old weathered buildings, no rust, no metal window grilles, no utility poles, "
    "no overhead cables, no corrugated metal roofs, no clutter, "
    "no text, no lettering, no watermark, no signage, no people"
)

# 景泰兩次打槍過的暗色字眼，一律擋下
BANNED = (# 暗色（景泰 2026-05-27 / 06-04 兩次打槍）
          "night", "twilight", "dusk", "dark", "moody", "neon", "blue hour",
          "sunset", "midnight", "gloomy",
          # 破爛感（景泰 2026-08-26：要漂亮的，不要舊城市破破爛爛）
          "run-down", "rundown", "dilapidated", "shabby", "slum", "decayed",
          "weathered", "rusty", "grungy", "gritty", "abandoned")


def parse_size(s: str) -> tuple[int, int]:
    """WxH → (w, h)，並修成 64 的倍數（FLUX 友善）。"""
    w, h = (int(x) for x in s.lower().split("x"))
    return max(64, round(w / 64) * 64), max(64, round(h / 64) * 64)


def fit(png: bytes, out: Path, w: int, h: int) -> None:
    """等比覆蓋後置中裁切到指定尺寸，存 JPG（或 PNG，看副檔名）。"""
    im = Image.open(io.BytesIO(png)).convert("RGB")
    scale = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - w) // 2, (im.height - h) // 2
    im = im.crop((left, top, left + w, top + h))
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".png":
        im.save(out, "PNG", optimize=True)
    else:
        im.save(out, "JPEG", quality=86, optimize=True, progressive=True)


def one(prompt: str, out_path: str, size: str, seed: int | None, raw: bool) -> bool:
    out = Path(out_path)
    if not out.is_absolute():
        out = ROOT / out
    low = prompt.lower()
    hit = [b for b in BANNED if b in low]
    if hit:
        print(f"  !! prompt 含暗色字眼 {hit}，景泰禁用（改亮色白天再跑）")
        return False

    full = prompt if raw else f"{prompt}, {STYLE_SUFFIX}"
    w, h = parse_size(size)
    # 先生比目標稍大一點的 64 倍數，再裁到精確尺寸
    gw, gh = max(64, round(w / 64) * 64), max(64, round(h / 64) * 64)

    print(f"  生圖 {w}x{h} … {prompt[:70]}")
    t0 = time.time()
    try:
        png = gen_flux_image(full, width=gw, height=gh, seed=seed)
        fit(png, out, w, h)
        print(f"  -> {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}"
              f"  {out.stat().st_size/1024:.0f}KB  ({time.time()-t0:.0f}s)")
        return True
    except Exception as e:
        print(f"  !! 失敗: {str(e)[:160]}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt", nargs="?", help="英文 prompt（亮色後綴會自動加）")
    ap.add_argument("out", nargs="?", help="輸出路徑（相對 repo 根目錄即可）")
    ap.add_argument("--size", default="1200x630", help="WxH，預設 1200x630（OG 標準）")
    ap.add_argument("--seed", type=int, default=None, help="固定 seed 讓結果可重現")
    ap.add_argument("--raw", action="store_true", help="不加亮色後綴（自己完全控制 prompt）")
    ap.add_argument("--batch", help="批次檔：每行 prompt<TAB>輸出路徑[<TAB>WxH]")
    args = ap.parse_args()

    jobs: list[tuple[str, str, str]] = []
    if args.batch:
        for ln in Path(args.batch).read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            parts = ln.split("\t")
            jobs.append((parts[0], parts[1], parts[2] if len(parts) > 2 else args.size))
    elif args.prompt and args.out:
        jobs.append((args.prompt, args.out, args.size))
    else:
        ap.error("要嘛給 prompt + out，要嘛給 --batch")

    ok = 0
    for i, (p, o, s) in enumerate(jobs, 1):
        print(f"\n[{i}/{len(jobs)}]")
        if one(p, o, s, args.seed, args.raw):
            ok += 1
    print(f"\n[完成] {ok}/{len(jobs)}")
    return 0 if ok == len(jobs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
