#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
區域頁實價登錄統計（台帳 F020 B 段）：從本機 lvr_buildings.db 逐筆算台中各行政區
「近 4 季」成屋買賣的扣車位單價中位數，輸出 src/data/area-stats.json 給 src/data/areas.ts 讀。

用法：
  python scripts/build-area-stats.py              # 寫 src/data/area-stats.json
  python scripts/build-area-stats.py --dry-run    # 只印結果不寫檔
  python scripts/build-area-stats.py --today 2026-10-04   # 指定「今天」（測試季別切換用）
  python scripts/build-area-stats.py --db <path>  # 指定資料庫（預設見 DEFAULT_DB；也可設環境變數 LVR_BUILDINGS_DB）

⚠️ CI／astro build 不跑這支（雲端沒有 DB），只讀 repo 內已產生的 area-stats.json。
   要更新數字就在本機跑這支、再 commit JSON。建議掛在 LVR_Update_D2/D12/D22 之後
   或 properties-sync 夜間 commit 之前（不要掛 WebsiteRefill）。

口徑（寫進 JSON 的 method 欄，頁面來源列照抄）：
  - 資料源：內政部不動產實價登錄「不動產買賣」（成屋），本機 lvr_buildings.db 唯讀開啟
  - 期間：以「成交日」切季。最近 3 個月的成交還沒登錄／公布完整 → 不用；
    取「結束日早於（今天 − 3 個月）」的最近一個完整季為終點，往回共 4 季。
    資料庫最新成交日若不到終點季結束後 45 天，再往前退一季（DB 沒更新就不硬算）。
    季別標示全部由這裡算出，頁面不寫死。
  - 剔除：成交日晚於今天的髒資料（庫裡有 1151218 這種）、非住家用、
    親友／員工／共有人等特殊關係、急買急賣、瑕疵、債權債務、含公共設施保留地、市場攤位、
    未登記建物、政府機關標讓售；套房／店面／廠辦等非四大住宅型態不算
  - 單價＝(總價 − 車位價) ÷ (建物移轉面積 − 車位面積)，平方公尺 × 0.3025 換坪，單位萬元/坪
    有車位面積但車位價為 0（車位價未拆分，台中大樓有六成以上是這種）：
      直接剔除會只剩沒車位的老大樓（實測北屯中古大樓剩下的中位屋齡 31 年，單價被拉低 7 萬以上），
      所以改用「同區、同車位類別，期間內有拆分車位價的成交，每個車位的中位數 × 車位個數」扣除；
      同區同類別不到 10 筆就用全市同類別，再不夠用全市全部。車位個數取「交易筆棟數」的「車位N」（缺就算 1）。
      各分群推估車位價的比例寫進 JSON（imputedShare），頁面來源列寫明這個口徑。
    扣完面積 < 8 坪、或大樓／華廈／公寓 > 150 坪、透天 > 300 坪、或單價 < 3 或 > 200 萬/坪 → 視為極端值剔除
  - 分群（不分群會誤導：新交屋社區會把整區中位數拉高）：
      新成屋大樓＝住宅大樓且（屋齡未滿 3 年 或 備註為「預售屋、或土地及建物分件登記案件」）
      中古大樓＝住宅大樓且屋齡 3 年以上；華廈、公寓、透天厝各自一群（不再分屋齡）
    屋齡＝成交日 − 建築完成日（缺完成日才用資料庫的 age_years）
  - 統計：中位數＋P25／P75；筆數 < 5 不出數字，5～9 筆標「樣本少」
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import statistics
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "data" / "area-stats.json"
DEFAULT_DB = Path(os.environ.get(
    "LVR_BUILDINGS_DB",
    str(Path.home() / "房仲工作站" / "200_泰迪房地開發" / "data" / "lvr_buildings.db"),
))

PING = 0.3025  # 平方公尺 × 0.3025 = 坪
MIN_N = 5          # 少於這個筆數不出數字
SMALL_N = 10       # 少於這個筆數標「樣本少」
INCOMPLETE_MONTHS = 3
DB_LAG_DAYS = 45   # 終點季結束後至少要有這麼多天的資料才算完整

EXCLUDE_NOTE_WORDS = [
    "特殊關係", "急買急賣", "瑕疵", "債權債務", "公共設施保留地", "市場攤位",
    "未登記建物", "政府機關",
]
PRESALE_NOTE = "預售屋、或土地及建物分件登記"

SEGMENTS = [
    # key, label, building_type 前綴, 屋齡條件
    ("tower_resale", "中古大樓（屋齡 3 年以上）", "住宅大樓", "resale"),
    ("tower_new", "新成屋大樓（屋齡未滿 3 年）", "住宅大樓", "new"),
    ("midrise", "華廈", "華廈", None),
    ("apartment", "公寓", "公寓", None),
    ("townhouse", "透天厝", "透天厝", None),
]


def roc_to_date(s: str | None) -> dt.date | None:
    """'1150630' → date(2026,6,30)；格式不對回 None。"""
    if not s:
        return None
    s = str(s).strip()
    if not s.isdigit() or len(s) not in (6, 7):
        return None
    y, m, d = int(s[:-4]) + 1911, int(s[-4:-2]), int(s[-2:])
    try:
        return dt.date(y, m, d)
    except ValueError:
        return None


def date_to_roc(d: dt.date) -> str:
    return f"{d.year - 1911:03d}{d.month:02d}{d.day:02d}"


def quarter_of(d: dt.date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def quarter_bounds(y: int, q: int) -> tuple[dt.date, dt.date]:
    start = dt.date(y, 3 * (q - 1) + 1, 1)
    end = (dt.date(y + (q == 4), (3 * q) % 12 + 1, 1) - dt.timedelta(days=1))
    return start, end


def prev_quarter(y: int, q: int) -> tuple[int, int]:
    return (y - 1, 4) if q == 1 else (y, q - 1)


def minus_months(d: dt.date, n: int) -> dt.date:
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12
        y -= 1
    last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).day
    return dt.date(y, m, min(d.day, last))


def pick_window(today: dt.date, db_max: dt.date) -> list[tuple[int, int]]:
    cutoff = minus_months(today, INCOMPLETE_MONTHS)
    y, q = quarter_of(cutoff)
    # 終點季：結束日要早於 cutoff
    while quarter_bounds(y, q)[1] >= cutoff:
        y, q = prev_quarter(y, q)
    # DB 沒更新到終點季結束後 45 天 → 往前退
    while quarter_bounds(y, q)[1] + dt.timedelta(days=DB_LAG_DAYS) > db_max:
        y, q = prev_quarter(y, q)
    quarters = [(y, q)]
    for _ in range(3):
        quarters.append(prev_quarter(*quarters[-1]))
    return list(reversed(quarters))


def pct(sorted_vals: list[float], p: float) -> float:
    # 線性內插百分位（同 numpy 預設）
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def parking_count(units: str | None) -> int:
    """「土地2建物1車位2」→ 2；抓不到就當 1。"""
    import re
    m = re.search(r"車位(\d+)", units or "")
    n = int(m.group(1)) if m else 1
    return n if n >= 1 else 1


def q_label(y: int, q: int) -> str:
    return f"{y} Q{q}"


def roc_q_label(y: int, q: int) -> str:
    return f"{y - 1911} 年第 {q} 季"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--today", default=None, help="YYYY-MM-DD，預設台北時間今天")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    if args.today:
        today = dt.date.fromisoformat(args.today)
    else:
        today = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).date()

    db = Path(args.db)
    if not db.exists() or db.stat().st_size == 0:
        print(f"[build-area-stats] 找不到資料庫或是 0 bytes：{db}", file=sys.stderr)
        return 2
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)

    today_roc = date_to_roc(today)
    # 「資料庫最新成交日」取第 20 新的成交日，不取 MAX：零星的未來日期髒資料（例 1151218）
    # 在「今天」往後推時會被當成有效日期，騙過下面的 45 天完整度檢查
    row = con.execute(
        "SELECT deal_date FROM lvr_buildings WHERE deal_date <= ? AND length(deal_date) = 7 "
        "ORDER BY deal_date DESC LIMIT 1 OFFSET 19",
        (today_roc,),
    ).fetchone()
    db_max = roc_to_date(row[0]) if row and row[0] else None
    if not db_max:
        print("[build-area-stats] 資料庫沒有有效成交日", file=sys.stderr)
        return 2
    real_max_row = con.execute(
        "SELECT MAX(deal_date) FROM lvr_buildings WHERE deal_date <= ? AND length(deal_date) = 7",
        (today_roc,),
    ).fetchone()
    db_real_max = roc_to_date(real_max_row[0]) if real_max_row and real_max_row[0] else db_max
    future_rows = con.execute(
        "SELECT COUNT(*) FROM lvr_buildings WHERE deal_date > ?", (today_roc,)
    ).fetchone()[0]

    quarters = pick_window(today, db_max)
    w_start = quarter_bounds(*quarters[0])[0]
    w_end = quarter_bounds(*quarters[-1])[1]

    rows = con.execute(
        """
        SELECT district, deal_date, total_price, building_area_m2, parking_area_m2, parking_price,
               building_type, main_purpose, note, complete_date, age_years, parking_type,
               json_extract(raw, '$."交易筆棟數"')
        FROM lvr_buildings
        WHERE deal_date BETWEEN ? AND ? AND deal_date <= ?
        """,
        (date_to_roc(w_start), date_to_roc(w_end), today_roc),
    ).fetchall()
    con.close()

    # 每個車位的拆分成交價（期間內、住家用、非特殊關係、車位價 > 0）→ 推估未拆分車位價用
    per_space: dict[tuple[str, str], list[float]] = {}
    for (district, _deal, _total, _b, p_area, p_price, _bt, purpose, note, _c, _a, ptype, units) in rows:
        if purpose != "住家用" or any(w in (note or "") for w in EXCLUDE_NOTE_WORDS):
            continue
        if (p_area or 0) > 0 and (p_price or 0) > 0:
            k = parking_count(units)
            v = p_price / k / 10000
            if 10 <= v <= 1000:  # 萬元/位，排除明顯異常
                per_space.setdefault(((district or "").strip(), ptype or ""), []).append(v)
                per_space.setdefault(("*", ptype or ""), []).append(v)
                per_space.setdefault(("*", "*"), []).append(v)

    def est_space_price(district: str, ptype: str) -> float | None:
        for key in ((district, ptype or ""), ("*", ptype or ""), ("*", "*")):
            vals = per_space.get(key, [])
            if len(vals) >= 10:
                return statistics.median(vals)
        return None

    counters = {"window_rows": len(rows), "non_residential": 0, "special_note": 0,
                "parking_imputed": 0, "other_type": 0, "outlier": 0, "kept": 0}
    buckets: dict[str, dict[str, list[float]]] = {}
    imputed: dict[str, dict[str, int]] = {}
    totals: dict[str, list[int]] = {}

    for (district, deal, total, b_area, p_area, p_price, btype, purpose, note,
         complete, age_years, ptype, units) in rows:
        district = (district or "").strip()
        if not district:
            continue
        note = note or ""
        btype = btype or ""
        if purpose != "住家用":
            counters["non_residential"] += 1
            continue
        if any(w in note for w in EXCLUDE_NOTE_WORDS):
            counters["special_note"] += 1
            continue
        seg_type = next((s[2] for s in SEGMENTS if btype.startswith(s[2])), None)
        if not seg_type:
            counters["other_type"] += 1
            continue
        p_area = p_area or 0.0
        p_price = p_price or 0
        was_imputed = False
        if p_area > 0 and p_price <= 0:
            est = est_space_price(district, ptype or "")
            if est is None:
                counters["outlier"] += 1
                continue
            p_price = est * parking_count(units) * 10000
            was_imputed = True
        net_area_ping = ((b_area or 0.0) - p_area) * PING
        net_price = (total or 0) - p_price
        max_ping = 300 if seg_type == "透天厝" else 150
        if net_area_ping < 8 or net_area_ping > max_ping or net_price <= 0:
            counters["outlier"] += 1
            continue
        unit = net_price / net_area_ping / 10000
        if unit < 3 or unit > 200:
            counters["outlier"] += 1
            continue

        deal_d = roc_to_date(deal)
        comp_d = roc_to_date(complete)
        if deal_d and comp_d:
            age = (deal_d - comp_d).days / 365.25
        elif age_years is not None:
            age = float(age_years)
        else:
            age = None

        if seg_type == "住宅大樓":
            is_new = (PRESALE_NOTE in note) or (age is not None and age < 3)
            if not is_new and age is None:
                counters["other_type"] += 1  # 屋齡不明、又不是預售交屋 → 不歸群
                continue
            key = "tower_new" if is_new else "tower_resale"
        else:
            key = next(s[0] for s in SEGMENTS if s[2] == seg_type)

        buckets.setdefault(district, {}).setdefault(key, []).append(unit)
        if was_imputed:
            counters["parking_imputed"] += 1
            imputed.setdefault(district, {})[key] = imputed.setdefault(district, {}).get(key, 0) + 1
        totals.setdefault(district, []).append(int(total or 0))
        counters["kept"] += 1

    districts_out: dict[str, dict] = {}
    for district in sorted(buckets):
        segs = []
        for key, label, _t, _a in SEGMENTS:
            vals = sorted(buckets[district].get(key, []))
            n = len(vals)
            if n < MIN_N:
                continue
            segs.append({
                "key": key,
                "label": label,
                "n": n,
                "median": round(statistics.median(vals), 1),
                "p25": round(pct(vals, 0.25), 1),
                "p75": round(pct(vals, 0.75), 1),
                "smallSample": n < SMALL_N,
                "imputedShare": round(imputed.get(district, {}).get(key, 0) / n * 100),
            })
        tot = totals.get(district, [])
        districts_out[district] = {
            "n": len(tot),
            "under5mShare": round(sum(1 for t in tot if 0 < t < 5_000_000) / len(tot) * 100) if tot else None,
            "segments": segs,
        }

    out = {
        "_comment": "由 scripts/build-area-stats.py 從 lvr_buildings.db 產生，勿手改；口徑見 method",
        "generatedAt": today.isoformat(),
        "period": {
            "label": f"{q_label(*quarters[0])}–{q_label(*quarters[-1])}",
            "rocLabel": f"{roc_q_label(*quarters[0])}～{roc_q_label(*quarters[-1])}",
            "start": w_start.isoformat(),
            "end": w_end.isoformat(),
            "quarters": [q_label(*x) for x in quarters],
        },
        "dbMaxDealDate": db_real_max.isoformat(),
        "dbRobustMaxDealDate": db_max.isoformat(),  # 第 20 新的成交日，季別完整度檢查用
        "source": "內政部不動產實價登錄（成屋買賣）",
        "method": (
            "站方逐筆統計：成交日落在期間內的住家用成屋買賣，"
            "單價＝(總價−車位價)÷(建物面積−車位面積)，取中位數；"
            "車位價未拆分的交易，以同區同類車位期間內有拆分成交的每位中位數乘車位個數扣除；"
            "剔除親友等特殊關係交易、成交日晚於統計日的資料與極端值；"
            "最近 3 個月的成交尚未登錄完整，不列入。"
            "新成屋大樓＝屋齡未滿 3 年或預售屋交屋登記，中古大樓＝屋齡 3 年以上。"
        ),
        "filters": {
            "excludeNoteWords": EXCLUDE_NOTE_WORDS,
            "minN": MIN_N,
            "smallSampleN": SMALL_N,
            "futureRowsInDb": future_rows,
        },
        "counters": counters,
        "districts": districts_out,
    }

    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    print(f"期間 {out['period']['label']}（{out['period']['start']}～{out['period']['end']}），"
          f"DB 最新有效成交日 {out['dbMaxDealDate']}（完整度檢查用 {out['dbRobustMaxDealDate']}），"
          f"未來日期髒資料 {future_rows} 筆")
    print("計數：", json.dumps(counters, ensure_ascii=False))
    for d, v in districts_out.items():
        segs = "、".join(f"{s['label']} {s['median']}（{s['n']}）" for s in v["segments"])
        print(f"  {d}：{segs}")
    if args.dry_run:
        print("[dry-run] 不寫檔")
        return 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"寫入 {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
