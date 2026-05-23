#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_community_paths.py — 把景泰原本寫的 ../../../assets/... 路徑修成 ../../assets/...

從 src/content/posts/X.md 到 src/assets/... 是退 2 層（../../），
不是 3 層（../../../）— 景泰原本算錯，導致 community-XX build 一直壞。
"""
import sys, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

POSTS_DIR = Path(r"C:\Users\a0920\teddy-website\src\content\posts")

count = 0
for md in sorted(POSTS_DIR.glob("*.md")):
    text = md.read_text(encoding="utf-8")
    # 把 ogImage: ../../../assets/ 改成 ogImage: ../../assets/
    new = re.sub(
        r"(ogImage:\s*)\.\./\.\./\.\./assets/",
        r"\1../../assets/",
        text,
    )
    if new != text:
        md.write_text(new, encoding="utf-8")
        count += 1
        print(f"  [FIX] {md.name}")

print(f"\n共修正 {count} 篇")
