# -*- coding: utf-8 -*-
"""
門牌洩漏偵測 + 清洗

掃 src/content/properties/*.md，找出 body / description / highlights 裡的「完整門牌」
（路名 + 數字 + 號，含 52-4號 / 76巷29弄9號 這類），砍成路段名（保留路名、刪門牌號）。

道路引用（74號快速道路 / 國道1號 / 公文號）一律不動 —— 規則：路段名可公開、門牌號不可。

usage:
  python scripts/fix_address_leak.py            # dry-run，只列清單不改檔
  python scripts/fix_address_leak.py --apply    # 實際寫回
"""
import re, glob, os, sys

sys.stdout.reconfigure(encoding="utf-8")

DIR = os.path.join(os.path.dirname(__file__), "..", "src", "content", "properties")
APPLY = "--apply" in sys.argv

# group1 = 路名（保留，2-6 個中文 + 路/街/大道 + 可選段）
# group2 = 門牌尾（砍掉，數字開頭、可含 之 - – 巷 弄，最後接「號」）
PAT = re.compile(
    r"([一-鿿]{2,6}?(?:路|街|大道)(?:[一二三四五六七八九十東西南北]{1,3}段)?)"
    r"(\d+(?:[之\-–]\d+)?(?:巷\d+)?(?:弄\d+)?號)"
)

def clean_line(line):
    """回傳 (新行, [(原門牌, 砍後路名)...])"""
    hits = []
    def repl(m):
        after = line[m.end():m.end()+2]
        # 道路白名單：號後接「快」(快速道路) 或「道」(道路) → 是道路不是門牌，保留原狀
        if after[:1] in ("快", "道"):
            return m.group(0)
        hits.append((m.group(0), m.group(1)))
        return m.group(1)
    return PAT.sub(repl, line), hits

total = 0
changed_files = []
for path in sorted(glob.glob(os.path.join(DIR, "*.md"))):
    rel = os.path.basename(path)
    lines = open(path, encoding="utf-8").read().split("\n")
    file_changed = False
    for i, line in enumerate(lines):
        newline, hits = clean_line(line)
        if hits:
            for orig, kept in hits:
                print(f"{rel}:{i+1}  「{orig}」  →  「{kept}」")
                total += 1
            lines[i] = newline
            file_changed = True
    if file_changed and APPLY:
        open(path, "w", encoding="utf-8").write("\n".join(lines))
        changed_files.append(rel)

print("")
if APPLY:
    print(f"✅ 已清洗 {total} 筆門牌，改動 {len(changed_files)} 個檔案：{', '.join(changed_files)}")
else:
    print(f"[DRY-RUN] 共 {total} 筆完整門牌洩漏（加 --apply 才實際改檔）")
