# -*- coding: utf-8 -*-
"""
一次性補寫：替「已經生好的 AI 圖」補上機器可讀的 AI 標記（台帳 X028 / X036）。

標記內容：XMP 的 Iptc4xmpExt:DigitalSourceType
  - 純 AI 圖     → trainedAlgorithmicMedia
  - AI 底圖疊字  → compositeWithTrainedAlgorithmicMedia（public/og/page-*.jpg，make_brand_og.py 產的）

做法：直接在 JPEG 檔頭插一段 XMP（APP1），**不重新壓縮**，畫面一個像素都不動。
每張寫完會把新舊兩版都解碼比對像素，有任何差異就還原、報錯。

用法：
    python scripts/backfill_ai_xmp.py                 # 預設 dry-run：只列出 src/assets/areas/*.jpg 要補哪些
    python scripts/backfill_ai_xmp.py --apply         # 真的寫入區域代表圖 7 張
    python scripts/backfill_ai_xmp.py --og            # dry-run：public/og/*.jpg 文章封面＋品牌 OG
    python scripts/backfill_ai_xmp.py --og --apply    # 真的寫入 public/og/*.jpg

⚠ 補寫 public/og/*.jpg 會讓每張 jpg 的雜湊改變 → 下次跑 generate-og-thumbs.mjs
  會把全部縮圖重產（帶著 XMP），public/og/thumbs/*.webp 與 .hashes.json 都要一起 commit。
⚠ src/assets/areas/*.jpg 交給 astro:assets 轉 webp 時，Astro 的 sharp 服務預設會丟掉
  metadata，所以線上那張 webp 不會帶標記；標記留在原圖（下載原圖、日後改走原圖時有效）。
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ai_image_marker import (  # noqa: E402
    XMP_AI_BYTES,
    XMP_COMPOSITE_BYTES,
    has_ai_marker,
    inject_xmp_jpeg,
)

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
AREAS_DIR = ROOT / "src" / "assets" / "areas"
OG_DIR = ROOT / "public" / "og"


def pixels(data: bytes) -> tuple[tuple[int, int], str, bytes]:
    im = Image.open(io.BytesIO(data))
    im.load()
    return im.size, im.mode, im.tobytes()


def xmp_for(path: Path) -> bytes:
    # 品牌 OG（make_brand_og.py：AI 底圖＋文字＋logo）算合成圖
    if path.parent == OG_DIR and path.name.startswith("page-"):
        return XMP_COMPOSITE_BYTES
    return XMP_AI_BYTES


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真的寫入（預設只 dry-run）")
    ap.add_argument("--og", action="store_true",
                    help="改處理 public/og/*.jpg（預設處理 src/assets/areas/*.jpg）")
    args = ap.parse_args()

    target = OG_DIR if args.og else AREAS_DIR
    files = sorted(p for p in target.iterdir()
                   if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg"))
    print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] {target.relative_to(ROOT)}：{len(files)} 張 jpg")

    todo, done, skipped, failed = 0, 0, 0, 0
    for p in files:
        raw = p.read_bytes()
        if has_ai_marker(raw):
            skipped += 1
            continue
        todo += 1
        xmp = xmp_for(p)
        kind = "composite" if xmp is XMP_COMPOSITE_BYTES else "trainedAlgorithmicMedia"
        try:
            new = inject_xmp_jpeg(raw, xmp)
            if pixels(new) != pixels(raw):
                raise RuntimeError("補寫後像素不一致（不應發生），不寫入")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  !! {p.name}: {e}")
            continue
        if args.apply:
            p.write_bytes(new)
            # 寫完再讀回來驗一次
            back = p.read_bytes()
            if not has_ai_marker(back) or pixels(back) != pixels(raw):
                p.write_bytes(raw)
                failed += 1
                print(f"  !! {p.name}: 讀回驗證失敗，已還原")
                continue
            done += 1
            print(f"  ✓ {p.name}  [{kind}]  {len(raw):,} → {len(back):,} bytes")
        else:
            print(f"  · {p.name}  [{kind}]  會 +{len(new) - len(raw):,} bytes")

    print(f"\n要補 {todo}、已有標記跳過 {skipped}、失敗 {failed}"
          + (f"、實際寫入 {done}" if args.apply else "（dry-run，沒有寫檔）"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
