# -*- coding: utf-8 -*-
"""
台中門牌地址定位庫 — 建置腳本
================================================================
產出：public/data/tc-addr/index.json + public/data/tc-addr/s/*.json
給：public/js/tc-addr.js（window.TcAddr）在瀏覽器本機把地址變成「行政區/里/鄰/經緯度」，
    全程不打任何外部地理編碼服務。學區查詢、垃圾車查詢兩個工具共用。

資料來源（政府開放資料，政府資料開放授權條款-第1版）
----------------------------------------------------------------
- 資料集：臺中市政府資料開放平臺「臺中市空間資訊建物及門牌號碼位置新版本資料」
  https://opendata.taichung.gov.tw/search/50168dd2-4239-4f3e-89cf-f706617f0436
  提供機關：臺中市政府數位發展局
- 該資料集的 CSV 資源是一份「版本目錄」（27 列），每列是一個月份版本的官方下載連結（Google Drive）：
  https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=42350484-812f-4c08-a06f-45783904fe88
- 本次使用版本：臺中市 115年1月 GIS 門牌號碼（檔名「115年1月GIS門牌_臺中市_TGOS__WGS84.CSV」，
  1,316,674 列，含樓層分戶）。欄位：省市縣市代碼, 鄉鎮市區代碼, 村里, 鄰, 街、路段, 地區, 巷, 弄, 號,
  TWD97橫坐標, TWD97縱坐標, WGS84經度, WGS84緯度。
  （WGS84 欄位已抽樣用 pyproj EPSG:3826→4326 驗過，差 < 1e-8 度，所以直接用 WGS84 欄位。）

怎麼更新（官方出新月份時）
----------------------------------------------------------------
1. 下載版本目錄 CSV（上面 resource.download 那個網址），找最新一列「臺中市XXX年X月GIS門牌號碼」的 Drive 連結。
2. 下載該 CSV 到任一暫存資料夾（約 150MB，不要放進 repo）。
   Drive 大檔會先回一頁確認頁，改打
   https://drive.usercontent.google.com/download?id=<檔案ID>&export=download&confirm=t
3. 執行：
     python scripts/build-tc-addr.py <下載的CSV路徑> --ver "115年1月"
   （--ver 省略時從檔名抓「XXX年X月」）
4. 腳本會清掉舊的 public/data/tc-addr/ 再全部重產，最後印出檔數、總大小、最大檔。
5. 本機用 http://localhost:4321/tools/... 驗一下查詢，確認沒問題再部署。

資料格式（index.json / s/*.json）見檔尾 FORMAT 說明，或 public/js/tc-addr.js 檔頭。

正規化規則（⚠️ 必須與 public/js/tc-addr.js 完全一致，改一邊就要改另一邊）
----------------------------------------------------------------
- 全形 → 半形（數字、英文字母）；空白全部拿掉
- 路名 key：「台」→「臺」、注音「ㄧ」→「一」、括號字元拿掉（龍(善)二街 → 龍善二街，另加別名「龍二街」，
  因為網頁端會把使用者輸入的括號連內容一起拿掉）、段一律國字（四段），阿拉伯數字段 → 國字
- 巷/弄 key：保留「巷」「弄」字尾；「之」→「-」；純國字數字的巷弄（一巷、十六巷）→ 阿拉伯數字（1巷、16巷）
- 號 key：取第一個「號」之前（樓層丟掉；緊接在號後面的「號之N」算之號：50號之7 → 50-7）；「之」→「-」（12之1 → 12-1）；英文字母保留（13-5A）；
  號前帶地名的照原樣保留（三民路三段「一心市場36」、「臨9」）

原始資料已知問題與處理（見 ROAD_FIX / ROAD_ALIAS 與「巷名跑進路名欄」段）
----------------------------------------------------------------
- 「建和路二段段」「美村路―段」「松竹五路ㄧ段」錯字 → 修正
- 罕用字「磘」有部分列變成「■」（大里區瓦■路）→ 併回「瓦磘路」，另加別名「瓦窯路」
- 路名欄空白、路名跑到巷欄（11 列）→ 往左挪
- 巷欄只有「巷」、巷名跑進路名欄（東勢區粵寧街中路+巷、和平區中興路四段林道+巷）→ 併回「粵寧街」+「中路巷」
- 里欄帶鄰（「廣福里010」）→ 拆開
- 同一門牌多列（各樓層）→ 座標取沒有樓層的那列（都有樓層就取第一列）；
  里鄰取列數最多的那組，其他里鄰（744 個門牌有這種情況，例：北區崇德路一段503巷52弄8號）另記在分片的 x，
  網頁端會把全部里鄰拿去對學區，對到不同學校就亮黃燈
"""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import math
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO, "public", "data", "tc-addr")

# 分片大小：一般分片塞到 ~180KB（未壓縮）就換下一片；單一條路本身超過時獨立成片，
# 超過 HARD_LIMIT 再依巷弄切成多片。
SHARD_SOFT = 180_000
HARD_LIMIT = 780_000

# 座標整數化：(度 - 原點) × 1e5（精度 1e-5 度 ≈ 1.1 公尺）
ORIGIN_LAT = 23.9
ORIGIN_LNG = 120.4
SCALE = 100000

# 內政部鄉鎮市區代碼（以資料內各代碼的里名交叉確認過）
DIST_CODES = [
    ("6600100", "中區"), ("6600200", "東區"), ("6600300", "南區"), ("6600400", "西區"),
    ("6600500", "北區"), ("6600600", "西屯區"), ("6600700", "南屯區"), ("6600800", "北屯區"),
    ("6600900", "豐原區"), ("6601000", "東勢區"), ("6601100", "大甲區"), ("6601200", "清水區"),
    ("6601300", "沙鹿區"), ("6601400", "梧棲區"), ("6601500", "后里區"), ("6601600", "神岡區"),
    ("6601700", "潭子區"), ("6601800", "大雅區"), ("6601900", "新社區"), ("6602000", "石岡區"),
    ("6602100", "外埔區"), ("6602200", "大安區"), ("6602300", "烏日區"), ("6602400", "大肚區"),
    ("6602500", "龍井區"), ("6602600", "霧峰區"), ("6602700", "太平區"), ("6602800", "大里區"),
    ("6602900", "和平區"),
]
CODE2IDX = {c: i for i, (c, _) in enumerate(DIST_CODES)}

# 原始資料的已知錯字（段重複、注音ㄧ、破折號）→ 修正後的路名
ROAD_FIX = {
    "建和路二段段": "建和路二段",
    "美村路―段": "美村路一段",
    # 罕用字「磘」在部分列被轉成「■」：同在大里區大里里、巷弄也跟「瓦磘路」重疊 → 併回瓦磘路
    "瓦■路": "瓦磘路",
}
# 常見的替代寫法 → 另外加可查的別名（只加 key，不改顯示名；跟既有路名撞名就略過）
ROAD_ALIAS = {
    ("大里區", "瓦磘路"): ["瓦窯路"],
}

FW = {ord(c): ord(c) - 0xFEE0 for c in "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－"}
CN_DIGIT = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CN_NUM_RE = re.compile(r"^[零〇一二兩三四五六七八九十百千]+$")


def half(s):
    return (s or "").translate(FW).replace("　", "").replace(" ", "").strip()


def cn2int(s):
    """國字數字 → int（支援到千）。不是純國字數字回 None。"""
    if not s or not CN_NUM_RE.match(s):
        return None
    total, cur = 0, 0
    for ch in s:
        if ch in CN_DIGIT:
            cur = CN_DIGIT[ch]
        else:
            unit = {"十": 10, "百": 100, "千": 1000}[ch]
            total += (cur or 1) * unit
            cur = 0
    return total + cur


def int2cn(n):
    """1..99 → 國字（段用）。"""
    d = "零一二三四五六七八九"
    if n < 10:
        return d[n]
    if n < 20:
        return "十" + (d[n - 10] if n > 10 else "")
    return d[n // 10] + "十" + (d[n % 10] if n % 10 else "")


def norm_road(s):
    s = half(s).replace("ㄧ", "一").replace("台", "臺")
    s = re.sub(r"[()（）]", "", s)   # 「龍(善)二街」→ key「龍善二街」；另加別名「龍二街」（見下方 PAREN 別名）
    s = re.sub(r"(\d+)段$", lambda m: int2cn(int(m.group(1))) + "段", s)
    return s


def norm_seg(t, suffix):
    """巷/弄 key：'１２之１巷'→'12-1巷'、'十六巷'→'16巷'、'便行巷'→'便行巷'"""
    t = half(t).replace("ㄧ", "一").replace("台", "臺").replace("之", "-")
    if not t:
        return ""
    if not t.endswith(suffix):
        t += suffix
    body = t[: -len(suffix)]
    n = cn2int(body)
    if n is not None:
        body = str(n)
    return body + suffix


HAO_SUB_RE = re.compile(r"^((?:之(?:\d+|[一二三四五六七八九十]+))+)(號)?(.*)$")


def norm_no(no):
    """'２之３之２號二樓之１' → ('2-3-2', True[有樓層])
    「50號之7」「228號之20三樓」＝ 50之7號、228之20號（號之N 是門牌的之號，不是樓層；原始資料約 8,500 列這樣寫）。
    只有「之15樓」這種之N 後面緊接「樓」的分不出來（之1 5樓？之15 樓？），照舊當樓層。"""
    s = half(no)
    i = s.find("號")
    if i >= 0:
        base, rest = s[:i], s[i + 1:]
        m = HAO_SUB_RE.match(rest)
        if m and not re.match(r"^[樓Ff層]", m.group(3)):
            subs = []
            for x in m.group(1).split("之"):
                if not x:
                    continue
                v = cn2int(x)
                subs.append(str(v) if v is not None else x)
            base = base + "".join("之" + x for x in subs)
            rest = m.group(3)
    else:
        base, rest = s, ""
    base = base.replace("之", "-")
    return base, bool(rest)


def no_sort_key(no):
    parts = re.findall(r"\d+", no)
    nums = [int(p) for p in parts] if parts else [10 ** 9]
    special = 0 if re.fullmatch(r"\d+(-\d+)*", no) else 1
    return (special, nums, no)


def load_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        r = csv.reader(fh)
        header = next(r)
        col = {h.strip(): i for i, h in enumerate(header)}
        need = ["鄉鎮市區代碼", "村里", "鄰", "街、路段", "地區", "巷", "弄", "號"]
        for k in need:
            if k not in col:
                raise SystemExit(f"CSV 缺欄位：{k}（實際欄位：{header}）")
        has_wgs = "WGS84經度" in col and "WGS84緯度" in col
        tr = None
        if not has_wgs:
            from pyproj import Transformer  # 只有沒 WGS84 欄位時才需要
            tr = Transformer.from_crs(3826, 4326, always_xy=True)
        for row in r:
            if len(row) < len(header):
                continue
            if has_wgs:
                try:
                    lng = float(row[col["WGS84經度"]]); lat = float(row[col["WGS84緯度"]])
                except ValueError:
                    continue
            else:
                try:
                    lng, lat = tr.transform(float(row[col["TWD97橫坐標"]]), float(row[col["TWD97縱坐標"]]))
                except ValueError:
                    continue
            yield {
                "code": row[col["鄉鎮市區代碼"]].strip(),
                "li": row[col["村里"]].strip(),
                "lin": row[col["鄰"]].strip(),
                "road": row[col["街、路段"]].strip(),
                "area": row[col["地區"]].strip(),
                "lane": row[col["巷"]].strip(),
                "alley": row[col["弄"]].strip(),
                "no": row[col["號"]].strip(),
                "lat": lat, "lng": lng,
            }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="臺中市 GIS 門牌 CSV（官方月版本）")
    ap.add_argument("--ver", help="版本字樣，例：115年1月（預設從檔名抓）")
    ap.add_argument("--out", default=OUT_DIR)
    args = ap.parse_args()

    ver = args.ver
    if not ver:
        m = re.search(r"(\d{3})年(\d{1,2})月", os.path.basename(args.csv))
        ver = f"{m.group(1)}年{int(m.group(2))}月" if m else "未知版本"
    m = re.match(r"(\d{3})年(\d{1,2})月", ver)
    ver_code = f"{m.group(1)}{int(m.group(2)):02d}" if m else "0"

    stats = collections.Counter()
    # (distIdx, roadKey) -> {"name": 原始顯示名, "groups": {groupKey: {no: rec}}}
    roads = {}
    li_names = [collections.Counter() for _ in DIST_CODES]

    for row in load_rows(args.csv):
        stats["rows"] += 1
        di = CODE2IDX.get(row["code"])
        if di is None:
            stats["skip_code"] += 1
            continue
        li, lin_s = row["li"], row["lin"]
        m = re.match(r"^(.+里)(\d+)$", li)          # 例：「廣福里010」
        if m:
            li, lin_s = m.group(1), lin_s or m.group(2)
        if not li:
            stats["skip_noli"] += 1
            continue
        lin = int(re.sub(r"\D", "", half(lin_s)) or 0)

        name = row["road"] or row["area"]
        lane, alley = row["lane"], row["alley"]
        if not name and lane and re.search(r"(路|街|段|大道)$", half(lane)):
            name, lane, alley = lane, alley, ""      # 欄位錯位（路名跑到巷欄）
            stats["fix_shift"] += 1
        name = half(name).replace("ㄧ", "一")
        name = ROAD_FIX.get(name, name)
        if not name:
            stats["skip_noroad"] += 1
            continue
        base, has_floor = norm_no(row["no"])
        if not base:
            stats["skip_nono"] += 1
            continue
        rkey = norm_road(name)
        gkey = norm_seg(lane, "巷") + norm_seg(alley, "弄")
        ent = roads.setdefault((di, rkey), {"name": name, "groups": {}})
        g = ent["groups"].setdefault(gkey, {})
        rec = g.get(base)
        if rec is None:
            g[base] = rec = {"li": li, "lin": lin, "lat": row["lat"], "lng": row["lng"], "floor": has_floor, "n": 1,
                             "pairs": collections.Counter(), "nofloor": set()}
            stats["addr"] += 1
        else:
            rec["n"] += 1
            if rec["floor"] and not has_floor:        # 座標：有「無樓層」的那列就用它（跟舊版一樣，垃圾車定位不受影響）
                rec.update(lat=row["lat"], lng=row["lng"], floor=False)
        # 同一門牌（含各樓層）可能登記在不同里鄰：全部記下來，主要里鄰取列數最多的
        rec["pairs"][(li, lin)] += 1
        if not has_floor:
            rec["nofloor"].add((li, lin))
        li_names[di][li] += 1

    # ---- 巷名跑進路名欄的錯位資料 ----
    # 例：東勢區「粵寧街中路」+ 巷欄只有「巷」，同一批門牌另有「粵寧街」+「中路巷」；
    #     和平區「中興路四段林道」+「巷」。→ 併回「最長的既有路名」＋「剩下的字+巷」
    keys_by_dist = collections.defaultdict(set)
    for (di, rk) in roads:
        keys_by_dist[di].add(rk)
    for (di, rk) in list(roads):
        ent = roads[(di, rk)]
        bad = [gk for gk in ent["groups"] if gk.startswith("巷") or gk.startswith("弄")]
        if not bad:
            continue
        r1 = max((k for k in keys_by_dist[di] if k != rk and rk.startswith(k)), key=len, default=None)
        if not r1:
            continue
        tgt = roads[(di, r1)]["groups"]
        for gk in bad:
            ngk = rk[len(r1):] + gk
            dst = tgt.setdefault(ngk, {})
            for no, rec in ent["groups"].pop(gk).items():
                if no not in dst:
                    dst[no] = rec
                else:
                    dst[no]["n"] += rec["n"]
                    dst[no]["pairs"].update(rec["pairs"])
                    dst[no]["nofloor"] |= rec["nofloor"]
                    stats["addr"] -= 1
            stats["fix_lane_in_road"] += 1
        if not ent["groups"]:
            del roads[(di, rk)]

    # ---- 同一門牌分屬不同里鄰：主要里鄰＝列數最多的（同票時取「無樓層」那列的），其餘記在 alts ----
    for ent in roads.values():
        for g in ent["groups"].values():
            for rec in g.values():
                pairs = rec["pairs"]
                if len(pairs) <= 1:
                    rec["alts"] = []
                    continue
                prim = max(pairs, key=lambda p: (pairs[p], p in rec["nofloor"], -p[1]))
                rec["li"], rec["lin"] = prim
                rec["pc"] = pairs[prim]
                rec["alts"] = sorted(((p[0], p[1], c) for p, c in pairs.items() if p != prim), key=lambda x: (-x[2], x[0], x[1]))
                stats["multi_pair_addr"] += 1

    # ---- 里名表（每區固定順序：依筆數多→少，常用的索引小） ----
    li_list = [[n for n, _ in c.most_common()] for c in li_names]
    li_idx = [{n: i for i, n in enumerate(lst)} for lst in li_list]

    def ilat(v):
        return int(round((v - ORIGIN_LAT) * SCALE))

    def ilng(v):
        return int(round((v - ORIGIN_LNG) * SCALE))

    def encode_group(di, recs):
        """一組巷弄 → 'no,li,lin,lat,lng;...'（li/lin 同上一筆時留空；座標第一筆絕對值、之後差值）"""
        out = []
        pl = pli = plin = plat = plng = None
        for no in sorted(recs, key=no_sort_key):
            r = recs[no]
            la, ln = ilat(r["lat"]), ilng(r["lng"])
            lix = li_idx[di][r["li"]]
            f_li = "" if lix == pli else str(lix)
            f_lin = "" if r["lin"] == plin else str(r["lin"])
            if plat is None:
                f_la, f_ln = str(la), str(ln)
            else:
                f_la, f_ln = str(la - plat), str(ln - plng)
            out.append(f"{no},{f_li},{f_lin},{f_la},{f_ln}")
            pli, plin, plat, plng = lix, r["lin"], la, ln
        return ";".join(out)

    def road_obj(di, ent):
        groups = ent["groups"]
        allr = [r for g in groups.values() for r in g.values()]
        # 路段代表點：離所有門牌平均位置最近的那一筆（medoid 近似）
        cy = sum(r["lat"] for r in allr) / len(allr)
        cx = sum(r["lng"] for r in allr) / len(allr)
        kx = math.cos(math.radians(cy))
        best = None
        for gk, g in groups.items():
            for no, r in g.items():
                d = (r["lat"] - cy) ** 2 + ((r["lng"] - cx) * kx) ** 2
                if best is None or d < best[0]:
                    best = (d, gk, no, r)
        _, bgk, bno, br = best
        lic = collections.Counter(r["li"] for r in allr)
        obj = {
            "m": [ilat(br["lat"]), ilng(br["lng"]), li_idx[di][br["li"]], br["lin"], bgk, bno],
            "L": [[li_idx[di][n], c] for n, c in lic.most_common()],
            "c": len(allr),
            "g": {gk: encode_group(di, g) for gk, g in sorted(groups.items())},
        }
        # x：同一門牌（含各樓層）登記在不同里鄰的，列出其他里鄰
        #    {巷弄key: "號=主要里鄰列數|里索引:鄰:列數|里索引:鄰:列數;號=..."}
        #    （放在 g 以外，g 的 5 欄格式不變，scripts/build-garbage.py 照舊可讀）
        xs = {}
        for gk, g in sorted(groups.items()):
            parts = []
            for no in sorted(g, key=no_sort_key):
                r = g[no]
                if r.get("alts"):
                    parts.append(f"{no}={r['pc']}|" + "|".join(f"{li_idx[di][a]}:{b}:{c}" for a, b, c in r["alts"]))
            if parts:
                xs[gk] = ";".join(parts)
        if xs:
            obj["x"] = xs
        if norm_road(ent["name"]) != ent["name"]:
            obj["n"] = ent["name"]
        return obj

    # ---- 分片 ----
    # 不整個資料夾砍掉重建：原地覆寫、最後再刪掉這次沒產生的舊分片。
    # （整個砍掉重建時，正在跑的 astro dev 會漏接檔案事件，部分分片變 404，要重開 dev server 才會好）
    os.makedirs(os.path.join(args.out, "s"), exist_ok=True)
    old_shards = set(os.listdir(os.path.join(args.out, "s")))

    road_index = collections.defaultdict(list)   # key -> ["di:shard"]
    shard_files = []
    by_dist = collections.defaultdict(list)
    for (di, rkey), ent in roads.items():
        by_dist[di].append((rkey, ent))

    def dump(obj):
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    shard_hash = hashlib.sha1()   # 分片內容雜湊 → index.json 的 v（網頁抓分片時加 ?v=，同月份重建也會換號，瀏覽器／CDN 不會拿到舊分片）

    def write_shard(di, sn, robjs):
        code = DIST_CODES[di][0]
        fn = f"{code}-{sn}.json"
        body = dump({"v": ver_code, "d": di, "r": robjs})
        with open(os.path.join(args.out, "s", fn), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)
        shard_files.append((fn, len(body.encode("utf-8")), len(gzip.compress(body.encode("utf-8"), 9))))
        shard_hash.update(fn.encode("utf-8") + body.encode("utf-8"))

    split_roads = 0
    for di in sorted(by_dist):
        items = sorted(by_dist[di], key=lambda x: x[0])
        sn = 0
        cur, cur_size = {}, 0
        for rkey, ent in items:
            ro = road_obj(di, ent)
            sz = len(dump({rkey: ro}).encode("utf-8"))
            if sz > HARD_LIMIT:
                # 單一條路太大：依巷弄分組切成多片，每片都帶同樣的 m/L/c
                split_roads += 1
                if cur:
                    write_shard(di, sn, cur); sn += 1; cur, cur_size = {}, 0
                parts, part, psz = [], {}, 0
                for gk, gs in ro["g"].items():
                    gsz = len(gs.encode("utf-8")) + len(gk) + 8
                    if part and psz + gsz > SHARD_SOFT * 3:
                        parts.append(part); part, psz = {}, 0
                    part[gk] = gs; psz += gsz
                if part:
                    parts.append(part)
                refs = []
                for p in parts:
                    sub = dict(ro); sub["g"] = p
                    write_shard(di, sn, {rkey: sub}); refs.append(sn); sn += 1
                road_index[rkey].append(f"{di}:" + "+".join(map(str, refs)))
                continue
            if cur and cur_size + sz > SHARD_SOFT:
                write_shard(di, sn, cur); sn += 1; cur, cur_size = {}, 0
            cur[rkey] = ro; cur_size += sz
            road_index[rkey].append(f"{di}:{sn}")
        if cur:
            write_shard(di, sn, cur)

    # 別名
    alias = {}
    # 路名含括號（大雅區「龍(善)街」系列）：網頁端會把使用者輸入的括號連內容一起拿掉，
    # 所以「龍(善)二街」→「龍二街」也要查得到
    for (di, rk), ent in roads.items():
        if re.search(r"[(（]", ent["name"]):
            ak = norm_road(re.sub(r"[(（][^)）]*[)）]", "", ent["name"]))
            if ak and ak != rk and ak not in road_index:
                alias[ak] = rk
    dname2idx = {n: i for i, (_, n) in enumerate(DIST_CODES)}
    for (dn, raw), names in ROAD_ALIAS.items():
        k = norm_road(raw)
        if k not in road_index:
            continue
        for a in names:
            ak = norm_road(a)
            if ak in road_index:
                print(f"  ! 別名 {a} 跟既有路名撞名，略過")
                continue
            alias[ak] = k

    index = {
        "v": f"{ver_code}-{shard_hash.hexdigest()[:8]}",
        "ver": ver,
        "src": "臺中市政府資料開放平臺「臺中市空間資訊建物及門牌號碼位置新版本資料」（臺中市政府數位發展局）",
        "srcUrl": "https://opendata.taichung.gov.tw/search/50168dd2-4239-4f3e-89cf-f706617f0436",
        "lic": "政府資料開放授權條款-第1版",
        "o": [ORIGIN_LAT, ORIGIN_LNG, SCALE],
        "d": [[c, n] for c, n in DIST_CODES],
        "li": li_list,
        "r": {k: ",".join(v) for k, v in sorted(road_index.items())},
        "a": alias,
        "n": stats["addr"],
    }
    body = dump(index)
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    idx_size = len(body.encode("utf-8")); idx_gz = len(gzip.compress(body.encode("utf-8"), 9))
    # 這次沒產生的舊分片（上一版多出來的片號）刪掉
    stale = sorted(old_shards - {fn for fn, _, _ in shard_files})
    for fn in stale:
        os.remove(os.path.join(args.out, "s", fn))
    if stale:
        print(f"刪掉舊分片 {len(stale)} 個：{', '.join(stale[:5])}{' …' if len(stale) > 5 else ''}")

    total = idx_size + sum(s for _, s, _ in shard_files)
    total_gz = idx_gz + sum(g for _, _, g in shard_files)
    big = max(shard_files, key=lambda x: x[1])
    print(f"版本：{ver}（{ver_code}）")
    print(f"原始列數 {stats['rows']:,}；去樓層後門牌 {stats['addr']:,}；路段(區×路) {len(roads):,}；路名 key {len(road_index):,}")
    print("略過/修正：", {k: v for k, v in stats.items() if k.startswith(('skip', 'fix'))})
    print(f"index.json {idx_size/1024:.1f}KB（gzip {idx_gz/1024:.1f}KB）")
    print(f"分片 {len(shard_files)} 檔；最大 {big[0]} {big[1]/1024:.1f}KB（gzip {big[2]/1024:.1f}KB）；拆片的路 {split_roads}")
    avg_gz = sum(g for _, _, g in shard_files) / len(shard_files)
    print(f"分片平均 gzip {avg_gz/1024:.1f}KB；最大 gzip {max(g for _,_,g in shard_files)/1024:.1f}KB")
    print(f"總計 {total/1024/1024:.2f}MB（gzip {total_gz/1024/1024:.2f}MB），檔數 {len(shard_files)+1}")


if __name__ == "__main__":
    main()

# FORMAT
# ------
# index.json
#   v    版本代碼＋分片內容雜湊 "11501-1a2b3c4d"（網頁抓分片的 ?v=）；ver "115年1月"；src/srcUrl/lic 來源
#   o    [原點緯度, 原點經度, 倍率]：座標整數 = round((度 - 原點) × 倍率)
#   d    [[區代碼, 區名], ...] 29 區，陣列位置 = 區索引 di
#   li   [[里名...], ...]    每區的里名表，陣列位置 = 里索引
#   r    {路名key: "di:片號,di:片號"}  同名路跨區時多筆；單路拆多片時 "di:3+4+5"
#   a    {別名key: 路名key}
# s/<區代碼>-<片號>.json
#   {"v":..., "d":di, "r":{路名key:{
#       "n": 原始顯示名（跟 key 不同才有，例：台中路）,
#       "m": [lat, lng, 里索引, 鄰, 巷弄key, 號]   路段代表點（最接近平均位置的門牌）,
#       "L": [[里索引, 門牌數], ...]              這條路經過的里,
#       "c": 門牌數,
#       "g": {巷弄key: "號,里,鄰,lat,lng;號,里,鄰,dlat,dlng;..."}  # key "" = 路上本身
#   }}}
#       "x": {巷弄key: "號=主要里鄰列數|里索引:鄰:列數|...;號=..."}  同一門牌（含各樓層）也登記在別的里鄰時才有
#   巷弄 key 例："" / "12巷" / "12巷5弄" / "30弄" / "便行巷"；號例："12" / "12-1" / "2-3-2" / "臨9"
#   里、鄰空白 = 同上一筆；座標第一筆是絕對整數、之後是與上一筆的差值
