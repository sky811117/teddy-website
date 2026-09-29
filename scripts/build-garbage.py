# -*- coding: utf-8 -*-
"""
台中垃圾車時間查詢 — 網站資料建置腳本
================================================================
產出（全部在 public/data/garbage/，給 /tools/ 垃圾車查詢頁用）：
  index.json      網格索引：哪些 0.02 度格子有清運點、各幾點；來源與版本
  t/<格>.json     清運點分塊（使用者只下載自己附近 1～4 塊）
  routes.json     每台車（車牌）的路線摘要：所在區、點數、分佈在哪些格子、最早/最晚時間
  holiday.json    國定假日定點班表（年份、假日清單、各區定點與時間、環保局座標）
  rules.json      收運規則（每條都附官方網址＋原文）、官方 APP 與查詢連結、各區清潔隊電話
  meta.json       各來源版本日期與網址、筆數、定位精度統計、檔案大小
  drift.json      官方查詢系統抽查結果（開放資料有沒有過時；整區警示、班表不同的點、車牌確認）

資料來源（全部是政府官方／開放資料）
----------------------------------------------------------------
1. 臺中市定時定點垃圾收運地點（臺中市政府環境保護局）
   政府資料開放平臺 https://data.gov.tw/dataset/84004
   （台中市資料開放平臺同一份：https://opendata.taichung.gov.tw/search/7bb28898-6971-4f9b-972e-6e28edf52a56）
   下載端點（JSON，約 13.7MB，即時轉檔）：
   https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=68d1a87f-7baa-4b50-8408-c36a3a7eda68
   欄位：area 區、village 里、car_licence 車牌、caption 清運地址、task_type 定點/沿街、
         g_d1..g_d7_time_s/e 一般垃圾週一..週日起訖、r_d1..r_d7_time_s/e 資源回收週一..週日起訖
   ⚠ 原始資料沒有經緯度 → 本腳本用「門牌庫」public/data/tc-addr/（115 年 1 月 GIS 門牌，
     臺中市政府數位發展局）自己定位，每點記錄定位精度 geo（見下方 GEO_LABEL）。
2. 國定假日定點班表：環保局「臺中垃圾清運大車隊」https://cleaner.epb.taichung.gov.tw/schedule.aspx
   頁面彈窗公告原文＋WebService getholiday（每區呼叫一次，共 28 區；和平區官方沒有假日班表）
   公告與各區 PDF：https://www.epb.taichung.gov.tw/3173778/post
3. 收運規則原文：環保局新聞稿、資源回收網（見 RULES 內每條的 url）
4. 各區清潔隊地址電話：https://cleaner.epb.taichung.gov.tw/services_4.aspx
   （即時車輛位置不在這裡產，走 Cloudflare Pages Function functions/api/garbage-live.ts）

授權：政府資料開放授權條款-第1版

怎麼更新
----------------------------------------------------------------
  python scripts/build-garbage.py                      # 用快取（沒有的檔才下載）
  python scripts/build-garbage.py --refresh            # 重抓清運點、中介資料、公告頁、清潔隊電話頁、規則原文頁
  python scripts/build-garbage.py --refresh-holiday    # 重抓 28 區國定假日班表（28 次 POST，每次間隔 2 秒）
  python scripts/build-garbage.py --no-fetch           # 完全不連網，只用快取重產
  python scripts/build-garbage.py --cache <資料夾>      # 指定原始檔快取位置（預設：系統暫存 teddy-garbage-cache）
  python scripts/build-garbage.py --refresh --drift-check   # 每月建議：重抓清運點＋抽查官方查詢系統
- 清運點：官方寫「不定期更新」，建議每月 --refresh 一次。
- ⚠ 開放資料可能過時（2026-09-29 查核：中區 87 點有 84 點、太平區 40 點有 16 點、南區 411-VP 路線抽 6 點 6 點
  時間跟官方不同）→ 每次 --refresh 都要加 --drift-check：
  比對點數不足 5 點的區，各挑一個清運點最密的位置呼叫官方 Newgetlocation 一次（循序、間隔 ≥2 秒、非 200 就停），
  回應存 <cache>/drift/。判斷分兩層：
    ① 整區：比對 ≥5 點且不同比例 ≥20% → index.drift.flag，頁面對整區顯示「班表可能已改」
    ② 路線：抽到的點只要有一點不同（有收/沒收不一致、或開始時間差 >5 分鐘），同一台車（開放資料車牌）的其他點
       都標 od:2「可能已改」、抽到不同的點本身標 od:1 → index.drift.routes、routes.json 的 od 欄
  ⚠ 目前抽查只涵蓋部分路線（2026-09-29：約 1,400 點、140 多條路線），沒抽到的路線也可能已改；
    要每條路線至少抽一點（每月約 100～150 次非開放查詢）須景泰同意，沒同意前不要擴大。
  Newgetlocation 不是開放資料，只在建置時抽查、不拿來取代開放資料的時間；景泰若不同意，就不要加 --drift-check
  （沒加時沿用 <cache>/drift/ 快取；快取過期（45 天）或換了資料版本，就不會再顯示警示）。
- 國定假日：環保局約每年 12 月底公告隔年清單 → 公告出來後跑 --refresh --refresh-holiday，
  並手動更新下方 HOLIDAY_SPECIAL（春節特殊安排，照當年環保局新聞稿改）。
- 門牌庫換月份版（scripts/build-tc-addr.py）後要重跑本腳本，定位才會跟著更新。
- 跑完看印出的「定位精度」「假日座標驗證」「規則原文核對」三段；原文核對有 ✗ 代表官方頁面改字了，要重看再改 RULES。

禮貌規則：循序請求；GET 間隔 ≥1.5 秒、POST 間隔 ≥2 秒；原始檔快取；遇到非 200 立即停止，不重試、不繞過。

定位精度（geo）：exact 門牌同號／near 前後門牌內插／far、lane、lanemid、road、village 都算「位置約略」
（GEO_APPROX，頁面標「位置約略」、距離只給到百公尺）。2026-09-29 用官方座標驗證：lane 誤差中位數約 130～250m。
"""
import argparse
import collections
import glob
import gzip
import hashlib
import html
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO, "public", "data", "garbage")
ADDR_DIR = os.path.join(REPO, "public", "data", "tc-addr")
DEFAULT_CACHE = os.path.join(tempfile.gettempdir(), "teddy-garbage-cache")
TPE = timezone(timedelta(hours=8))
LICENSE = "政府資料開放授權條款-第1版"

# 網格：座標整數 = round(度 × 1e5)；格子 = floor(整數 / 2000)（0.02 度，約南北 2.2km × 東西 2.0km）
SCALE = 100000
CELL = 2000

URL_STOPS = "https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=68d1a87f-7baa-4b50-8408-c36a3a7eda68"
URL_CARS = "https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=c923ad20-2ec6-43b9-b3ab-54527e99f7bc"
URL_META_STOPS = "https://data.gov.tw/api/v2/rest/dataset/84004"
URL_META_CARS = "https://data.gov.tw/api/v2/rest/dataset/83558"
URL_GETHOLIDAY = "https://cleaner.epb.taichung.gov.tw/WebService/WsSkyeyes.asmx/getholiday"
URL_SCHEDULE = "https://cleaner.epb.taichung.gov.tw/schedule.aspx"
URL_QUERY = "https://cleaner.epb.taichung.gov.tw/index.aspx"
URL_HOLIDAY_POST = "https://www.epb.taichung.gov.tw/3173778/post"

# 快取檔名 → 官方網址
RAW_FILES = {
    "stops_json.json": URL_STOPS,
    "datagov_84004.json": URL_META_STOPS,
    "datagov_83558.json": URL_META_CARS,
}
PAGES = {
    "schedule.html": URL_SCHEDULE,
    "services_4.html": "https://cleaner.epb.taichung.gov.tw/services_4.aspx",
    "services_2_1.html": "https://cleaner.epb.taichung.gov.tw/services_2_1.aspx",
    "post3173778.html": URL_HOLIDAY_POST,
    "post3375213.html": "https://www.epb.taichung.gov.tw/3375213/post",
    "post3198939.html": "https://www.epb.taichung.gov.tw/3198939/post",
    "post3263783.html": "https://www.epb.taichung.gov.tw/3263783/post",
    "other10.html": "https://recycle.epb.taichung.gov.tw/other/other10.asp",
    "qa01-1.html": "https://recycle.epb.taichung.gov.tw/qa/qa_01-1.asp",
}
PAGE_OF_URL = {u: f for f, u in PAGES.items()}

DISTS = ["中區", "東區", "南區", "西區", "北區", "西屯區", "南屯區", "北屯區", "豐原區", "東勢區", "大甲區", "清水區",
         "沙鹿區", "梧棲區", "后里區", "神岡區", "潭子區", "大雅區", "新社區", "石岡區", "外埔區", "大安區", "烏日區",
         "大肚區", "龍井區", "霧峰區", "太平區", "大里區", "和平區"]
# schedule.aspx 國定假日下拉選單原樣（沒有和平區）
HOLIDAY_DISTS = ["中區", "北區", "北屯區", "南區", "南屯區", "后里區", "外埔區", "大安區", "大甲區", "大肚區", "大里區",
                 "大雅區", "太平區", "新社區", "東勢區", "東區", "梧棲區", "沙鹿區", "清水區", "潭子區", "烏日區", "石岡區",
                 "神岡區", "西區", "西屯區", "豐原區", "霧峰區", "龍井區"]
WEEK = "一二三四五六日"

# ⚠ 春節特殊安排：每年不同，照環保局當年新聞稿手動改（換年後舊的會自動被頁面當成「已過」）
HOLIDAY_SPECIAL = {
    "year": 2026,
    "source": "https://www.epb.taichung.gov.tw/3198939/post",
    "items": [
        {"date": "2026-02-15", "rule": "小年夜加班沿街收運"},
        {"date": "2026-02-16", "rule": "除夕取消夜間沿線及定點收運，改日間清運，約比平時提早 4 小時開始"},
        {"date": "2026-02-17", "rule": "初一定時定點"},
        {"date": "2026-02-18", "rule": "初二停止垃圾收運"},
        {"date": "2026-02-19", "rule": "初三定時定點"},
        {"date": "2026-02-20", "rule": "初四起恢復正常清運"},
        {"date": "2026-02-22", "rule": "初六停止垃圾收運"},
    ],
}

GEO_LABEL = {
    "exact": "門牌同號",
    "near": "同一條路或巷子裡前後門牌之間內插（或號碼差 6 號內的最近門牌）",
    "far": "同一條路或巷子裡最接近的門牌，但號碼差較多或前後門牌離很遠（位置約略）",
    "lane": "巷口（主路上與巷同號的門牌，位置約略）",
    "lanemid": "同一條巷子的門牌中段（位置約略）",
    "intersection": "兩條路最接近處",
    "road": "這條路在該里附近的中段（位置約略）",
    "village": "村里中心（門牌平均位置，位置約略）",
    "none": "無法定位",
}
# 前端要標「位置約略」、不給精確公尺數的精度（2026-09-29 查核：lane 跟官方座標差中位數 243m、far 常差 150m 以上）
GEO_APPROX = ["far", "lane", "lanemid", "road", "village"]
NEAR_SPAN = 40        # 前後兩個門牌號碼差在這以內才內插
NEAR_SPREAD_M = 250   # 前後兩個門牌相距在這以內才內插
NEAR_GAP_MAX = 6      # 只有單邊門牌時，號碼差在這以內還算 near

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


# ================================================================ 下載（循序、有間隔、非 200 就停）
class Fetcher:
    def __init__(self, cache):
        self.cache = cache
        self.sess = None
        self.last = 0.0
        self.log_path = os.path.join(cache, "_fetched.json")
        try:
            self.log = json.load(open(self.log_path, encoding="utf-8"))
        except (OSError, ValueError):
            self.log = {}

    def _s(self):
        if self.sess is None:
            import requests
            self.sess = requests.Session()
            self.sess.headers["User-Agent"] = UA
        return self.sess

    def _wait(self, gap):
        w = gap - (time.time() - self.last)
        if w > 0:
            time.sleep(w)

    def _save(self, rel, content, url):
        path = os.path.join(self.cache, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(content)
        self.log[rel.replace("\\", "/")] = {"url": url, "at": datetime.now(TPE).strftime("%Y-%m-%d %H:%M")}
        with open(self.log_path, "w", encoding="utf-8") as fh:
            json.dump(self.log, fh, ensure_ascii=False, indent=1)
        print(f"  下載 {rel} {len(content):,} bytes")

    def get(self, rel, url):
        self._wait(1.5)
        r = self._s().get(url, timeout=120)
        self.last = time.time()
        if r.status_code != 200:
            raise SystemExit(f"STOP：{url} 回 {r.status_code}（不重試、不繞過）")
        self._save(rel, r.content, url)

    def post_json(self, rel, url, payload, referer, timeout=120):
        self._wait(2.0)
        r = self._s().post(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), timeout=timeout,
                           headers={"Content-Type": "application/json; charset=utf-8", "Referer": referer})
        self.last = time.time()
        if r.status_code != 200:
            raise SystemExit(f"STOP：{url} 回 {r.status_code}（不重試、不繞過）")
        self._save(rel, r.content, url + " " + json.dumps(payload, ensure_ascii=False))

    def fetched_at(self, rel):
        ent = self.log.get(rel.replace("\\", "/"))
        if ent:
            return ent["at"]
        p = os.path.join(self.cache, rel)
        if os.path.exists(p):
            return datetime.fromtimestamp(os.path.getmtime(p), TPE).strftime("%Y-%m-%d %H:%M")
        return None


def fetch_all(f, args):
    def have(rel):
        p = os.path.join(f.cache, rel)
        return os.path.exists(p) and os.path.getsize(p) > 10

    need = []
    for fn, url in RAW_FILES.items():
        rel = os.path.join("raw", fn)
        if args.refresh or not have(rel):
            need.append(("get", rel, url, None))
    for fn, url in PAGES.items():
        rel = os.path.join("pages", fn)
        if args.refresh or not have(rel):
            need.append(("get", rel, url, None))
    for d in HOLIDAY_DISTS:
        rel = os.path.join("holiday", f"{d}.json")
        if args.refresh_holiday or not have(rel):
            need.append(("post", rel, URL_GETHOLIDAY, {"dept": d}))
    if not need:
        print("[1] 快取齊全，不下載")
        return
    if args.no_fetch:
        raise SystemExit("STOP：--no-fetch 但快取缺檔：" + "、".join(n[1] for n in need))
    print(f"[1] 下載 {len(need)} 個檔（循序、有間隔）")
    for kind, rel, url, payload in need:
        if kind == "get":
            f.get(rel, url)
        else:
            f.post_json(rel, url, payload, URL_SCHEDULE)


def read_json(path):
    with open(path, encoding="utf-8-sig") as fh:
        return json.load(fh)


def read_html(path):
    b = open(path, "rb").read()
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp950", errors="replace")  # 資源回收網是 Big5


def html_text(h):
    h = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S | re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    return html.unescape(h)


def squash(s):
    return re.sub(r"[\s　\xa0]+", "", s or "")


# ================================================================ 地址解析（清運點原文 → 路／巷／弄／號）
FW = str.maketrans("０１２３４５６７８９－", "0123456789-")
PAREN = re.compile(r"[\(（][^\)）]*[\)）]")
SEG_RE = re.compile(r"[一二三四五六七八九十]+段$")
ROAD_END = re.compile(r"(?:[一二三四五六七八九十]+段|大道|路|街)")
XROAD_RE = re.compile(r"^(?P<a>.+?(?:[一二三四五六七八九十]+段|大道|路|街))(?:與|和|及|、|/)"
                      r"(?P<b>.+?(?:[一二三四五六七八九十]+段|大道|路|街))(?:路口|交叉口|交岔路口|口|轉角|號|$)")
STOP_ROAD_ALIAS = {"瓦瑤路": "瓦磘路", "健東路一街": "健東一街", "健東路二街": "健東二街"}  # 清運資料寫法 → 門牌寫法
DIST_NAMES = sorted(DISTS, key=len, reverse=True)
CN = "零一二三四五六七八九"


def cn_num(n):
    n = int(n)
    if n < 10:
        return CN[n]
    if n < 20:
        return "十" + (CN[n % 10] if n % 10 else "")
    if n < 100:
        return CN[n // 10] + "十" + (CN[n % 10] if n % 10 else "")
    return str(n)


def norm_txt(s):
    return (s or "").translate(FW).replace("台", "臺").replace(" ", "").replace("　", "")


def split_road(prefix):
    """'新仁路二段福溝巷' → ('新仁路二段','福溝','')；'大明巷12弄' → ('大明巷','','12')"""
    alley = ""
    m = re.search(r"(\d+(?:[-之]\d+)?)弄$", prefix)
    if m:
        alley, prefix = m.group(1), prefix[:m.start()]
    lane = ""
    if prefix.endswith("巷"):
        body = prefix[:-1]
        ends = list(ROAD_END.finditer(body))
        if ends and ends[-1].end() < len(body):
            lane, prefix = body[ends[-1].end():], body[:ends[-1].end()]
    return prefix, lane, alley


def parse_addr(caption, li=""):
    """回傳 dict(road, lane, alley, no[, mouth|loose][, dist]) / dict(xa, xb) / None"""
    c = norm_txt(caption)
    base = PAREN.sub("", c).strip()
    base = re.sub(r"^臺中市", "", base)
    out = {}
    for d in DIST_NAMES:
        if base.startswith(d):
            out["dist"] = d
            base = base[len(d):]
            break
    if li and base.startswith(li) and len(base) > len(li) + 2:
        base = base[len(li):]
    # 「79巷口」「95巷巷口」→「79巷」（2026-09-29 修：原本把「巷口」整個刪掉，變成「瓦瑤路79」解析失敗 → 退到村里中心）
    base = re.sub(r"巷+口", "巷", base.replace("路路", "路")).replace("旁", "")
    m = re.match(r"^(.+?\d+巷)跟", base)  # 「建國北街315巷跟315巷6弄口」→ 取前半「建國北街315巷」
    if m:
        base = m.group(1)
    for k, v in STOP_ROAD_ALIAS.items():
        base = base.replace(k, v)
    base = re.sub(r"(\d+)(?=段|路|街)", lambda m: cn_num(m.group(1)), base)  # 崇德7路→崇德七路、沙田路1段→沙田路一段
    if "與" in base:  # 「A路與B路12號」「中平路與中平路99巷」→ 取後半
        tail = base.split("與")[-1]
        if ROAD_END.search(tail) and (re.search(r"\d+(?:[-之]\d+)*號", tail) or re.search(r"\d+巷號?$", tail)):
            base = tail
    m = re.match(r"^(?P<road>.+?(?:[一二三四五六七八九十]+段|大道|路|街))(?P<lane>\d+)巷(?P<alley>\d+)弄(?:口|號)*$", base)
    if m:  # 「丁台路559巷100弄號」只有弄沒號 → 弄口（巷裡與弄同號的門牌）
        out.update(road=m.group("road"), lane=m.group("lane"), alley="", no=int(m.group("alley")), mouth=True)
        return out
    m = re.match(r"^(?P<pre>.*?\D)(?P<no>\d+)(?P<sub>(?:[-之~]\d+)*)號", base)
    if m and m.group("pre"):
        road, lane, alley = split_road(m.group("pre"))
        if road:
            out.update(road=road, lane=lane, alley=alley, no=int(m.group("no")))
            if m.group("sub"):
                out["sub"] = True  # 「25之8號」：之號可能在離本號很遠的支巷裡
            return out
    m = re.match(r"^(?P<road>.+?(?:[一二三四五六七八九十]+段|大道|路|街))(?P<lane>\d+)巷號?$", base)
    if m:  # 「竹師路二段112巷號」只有巷沒號 → 巷口（主路上同號）
        out.update(road=m.group("road"), lane="", alley="", no=int(m.group("lane")), mouth=True)
        return out
    x = XROAD_RE.match(base)
    if x:
        xa, xb = x.group("a"), x.group("b")
        if len(xb) <= 3 and xb[0] in "一二三四五六七八九十" and len(xa) > len(xb):  # 「健東一街/二街」→ 二街＝健東二街
            xb = xa[: len(xa) - len(xb)] + xb
        out.update(xa=xa, xb=xb)
        return out
    for s in re.findall(r"[\(（]([^\)）]*)[\)）]", c):  # 括號裡才有地址，例「(民生路9巷口)」
        s = re.sub(r"(\d+)(?=段|路|街)", lambda m: cn_num(m.group(1)), s)
        m = re.match(r"^(?P<pre>.*?(?:段|大道|路|街))(?P<no>\d+)(?:巷|號)", s)
        if m:
            out.update(road=m.group("pre"), lane="", alley="", no=int(m.group("no")), loose=True)
            return out
    return out or None


# ---- 門牌庫 key 正規化（⚠ 必須跟 scripts/build-tc-addr.py 的 norm_road / norm_seg 一致）
HALF = {ord(c): ord(c) - 0xFEE0 for c in "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－"}
CN_DIGIT = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CN_NUM_RE = re.compile(r"^[零〇一二兩三四五六七八九十百千]+$")


def half(s):
    return (s or "").translate(HALF).replace("　", "").replace(" ", "").strip()


def cn2int(s):
    if not s or not CN_NUM_RE.match(s):
        return None
    total, cur = 0, 0
    for ch in s:
        if ch in CN_DIGIT:
            cur = CN_DIGIT[ch]
        else:
            total += (cur or 1) * {"十": 10, "百": 100, "千": 1000}[ch]
            cur = 0
    return total + cur


def addr_road_key(s):
    s = half(s).replace("ㄧ", "一").replace("台", "臺")
    s = re.sub(r"[()（）]", "", s)
    s = re.sub(r"(\d+)段$", lambda m: cn_num(int(m.group(1))) + "段", s)
    return s


def addr_seg_key(t, suffix):
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


def haversine(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ================================================================ 門牌庫定位（讀 public/data/tc-addr/）
class Geocoder:
    """用 tc-addr 門牌庫（115 年 1 月 GIS 門牌）把清運點地址變成座標。只在建置時跑，網頁端不需要。"""

    def __init__(self, addr_dir, needed_roads, needed_lanes):
        t0 = time.time()
        ix = read_json(os.path.join(addr_dir, "index.json"))
        self.ver = ix.get("ver")
        self.src, self.src_url = ix.get("src"), ix.get("srcUrl")
        o_lat, o_lng, scale = ix["o"]
        dnames = [n for _, n in ix["d"]]
        self.alias = ix.get("a", {})
        self.idx = collections.defaultdict(list)        # (dist, road, group) -> [(int號, lng, lat)]
        self.road_pts = collections.defaultdict(list)   # (dist, road) -> [(lng, lat)]
        self.base_roads = collections.defaultdict(set)  # (dist, 去掉段的路名) -> {路名}
        self.road_dists = collections.defaultdict(set)  # 路名 -> {區}
        self.lane_roads = collections.defaultdict(set)  # (dist, 巷名「大明巷」) -> {路名}（巷名當地址用的鄉間門牌）
        self.groups = collections.defaultdict(set)      # (dist, road) -> {巷弄 key}（找「同一條巷子」的門牌用）
        vil = collections.defaultdict(lambda: [0.0, 0.0, 0])
        n_addr = 0
        for fn in sorted(glob.glob(os.path.join(addr_dir, "s", "*.json"))):
            sh = read_json(fn)
            di = sh["d"]
            dist = dnames[di]
            lis = ix["li"][di]
            for rkey, ro in sh["r"].items():
                broad = SEG_RE.sub("", rkey)
                want_road = rkey in needed_roads or broad in needed_roads
                for gkey, gs in ro["g"].items():
                    lm = re.match(r"^(\D.*?巷)", gkey)
                    want_lane = bool(lm) and lm.group(1) in needed_lanes
                    li = lat = lng = None
                    for part in gs.split(";"):
                        no, f_li, _f_lin, f_la, f_ln = part.split(",")
                        if f_li != "":
                            li = lis[int(f_li)]
                        if lat is None:
                            lat, lng = int(f_la), int(f_ln)
                        else:
                            lat += int(f_la); lng += int(f_ln)
                        y, x = lat / scale + o_lat, lng / scale + o_lng
                        v = vil[(dist, li)]
                        v[0] += x; v[1] += y; v[2] += 1
                        n_addr += 1
                        if not (want_road or want_lane):
                            continue
                        mno = re.match(r"(\d+)", no)
                        if mno:
                            self.idx[(dist, rkey, gkey)].append((int(mno.group(1)), x, y))
                            self.groups[(dist, rkey)].add(gkey)
                        self.road_pts[(dist, rkey)].append((x, y))
                    if want_lane:
                        self.lane_roads[(dist, lm.group(1))].add(rkey)
                if want_road:
                    self.base_roads[(dist, broad)].add(rkey)
                    self.road_dists[rkey].add(dist)
        self.vil = {k: (v[0] / v[2], v[1] / v[2]) for k, v in vil.items() if v[2]}
        print(f"  門牌庫 {self.ver}：讀入 {n_addr:,} 個門牌、{len(self.vil):,} 個村里，{time.time() - t0:.1f}s")

    def road_key(self, road):
        k = addr_road_key(road)
        return self.alias.get(k, k)

    def village_center(self, dist, li):
        return self.vil.get((dist, li))

    @staticmethod
    def _avg(pts, n):
        sel = [(x, y) for m, x, y in pts if m == n]
        return sum(p[0] for p in sel) / len(sel), sum(p[1] for p in sel) / len(sel)

    def _num(self, key, no):
        """→ ((x, y), 精度, 號碼差) 或 None。
        同號 → exact。沒有同號 → 同側（單雙號）找前後最接近的兩個門牌：
          兩邊都有、號碼差 ≤ NEAR_SPAN 號、兩點相距 ≤ NEAR_SPREAD_M → 依號碼在兩點間內插（near）
          其他情況 → 取號碼最接近的門牌；號碼差 > NEAR_GAP_MAX 或前後兩點離很遠 → far（位置約略）"""
        pts = self.idx.get(key)
        if not pts:
            return None
        if any(n == no for n, _, _ in pts):
            return self._avg(pts, no), "exact", 0
        pool = [p for p in pts if p[0] % 2 == no % 2] or pts
        d, n0 = min((abs(n - no), n) for n, _, _ in pool)
        if d > 100:
            return None
        lo = [n for n, _, _ in pool if n < no]
        hi = [n for n, _, _ in pool if n > no]
        if lo and hi:
            nl, nh = max(lo), min(hi)
            a, b = self._avg(pool, nl), self._avg(pool, nh)
            spread = haversine(a[1], a[0], b[1], b[0])
            if nh - nl <= NEAR_SPAN and spread <= NEAR_SPREAD_M:
                t = (no - nl) / (nh - nl)
                return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), "near", d
            return self._avg(pool, n0), "far", d
        # 只有單邊（號碼在這條路的頭或尾之外）→ 最接近的門牌；差太多就算約略
        return self._avg(pool, n0), ("near" if d <= NEAR_GAP_MAX else "far"), d

    def _roads_for(self, dist, road, li):
        """同區找完整路名；沒寫段號就展開各段；本區沒有就找鄰區（離該里中心 3 公里內最近者）"""
        out = []
        if (dist, road) in self.road_pts:
            out.append((dist, road))
        elif SEG_RE.sub("", road) == road:
            out += [(dist, full) for full in sorted(self.base_roads.get((dist, road), ()))]
        if out:
            return out
        vc = self.village_center(dist, li)
        others = [d for d in self.road_dists.get(road, ()) if d != dist]
        if others and vc:
            def dist_to(d):
                pts = self.road_pts[(d, road)]
                return min(haversine(vc[1], vc[0], p[1], p[0]) for p in pts[::max(1, len(pts) // 200)])
            others.sort(key=dist_to)
            if dist_to(others[0]) < 3000:
                return [(others[0], road)]
        return []

    @staticmethod
    def _near_village(cands, vc, limit=2500):
        """同名巷在區內可能不只一條 → 只收離該里中心 limit 公尺內的結果"""
        if not vc:
            return cands[0] if cands else None
        if len(cands) == 1:
            limit = 8000  # 只有一個候選（同區同路同號）→ 放寬，鄉間村里很大
        ok = [c for c in cands if haversine(vc[1], vc[0], c[0][1], c[0][0]) < limit]
        ok.sort(key=lambda c: haversine(vc[1], vc[0], c[0][1], c[0][0]))
        return ok[0] if ok else None

    def _closest_pair(self, a_pts, b_pts):
        """兩條路門牌點最接近的一對（度數歐氏距離，跟 cKDTree 版本同口徑）；超過 0.0025 度視為沒交會"""
        cell = 0.0025
        grid = collections.defaultdict(list)
        for x, y in b_pts:
            grid[(int(x // cell), int(y // cell))].append((x, y))
        best = None
        for x, y in a_pts:
            cx, cy = int(x // cell), int(y // cell)
            for gx in (cx - 1, cx, cx + 1):
                for gy in (cy - 1, cy, cy + 1):
                    for bx, by in grid.get((gx, gy), ()):
                        d = math.hypot(x - bx, y - by)
                        if best is None or d < best[0]:
                            best = (d, ((y + by) / 2, (x + bx) / 2))
        return best

    def _lane_mid(self, roads, lane_key, vc):
        """同一條巷子（含巷內各弄）所有門牌的中位點；只收離該里中心 3 公里內的"""
        best = None
        for d, rk in roads:
            pts = [(x, y) for g in self.groups.get((d, rk), ()) if g == lane_key or g.startswith(lane_key)
                   for _, x, y in self.idx[(d, rk, g)]]
            if not pts:
                continue
            x = sorted(q[0] for q in pts)[len(pts) // 2]
            y = sorted(q[1] for q in pts)[len(pts) // 2]
            dv = haversine(vc[1], vc[0], y, x) if vc else 0
            if dv < 3000 and (best is None or dv < best[0]):
                best = (dv, (y, x))
        return best[1] if best else None

    def locate(self, dist, li, caption):
        """→ ((lat, lng) 或 None, 精度)"""
        p = parse_addr(caption, li) or {}
        dist = p.get("dist", dist)
        vc = self.village_center(dist, li)
        if "road" in p:
            road = self.road_key(p["road"])
            lane_k = addr_seg_key(p["lane"], "巷")
            group = lane_k + addr_seg_key(p["alley"], "弄")
            roads = self._roads_for(dist, road, li)
            if not roads:  # 異體字：清運資料寫「公館路」、門牌寫「公舘路」
                for v in char_variants(road):
                    roads = self._roads_for(dist, v, li)
                    if roads:
                        break
            cands = [r for d, rk in roads for r in [self._num((d, rk, group), p["no"])] if r]
            if not cands and p["lane"] and p["alley"]:  # 門牌庫沒有這個弄 → 弄口（巷裡與弄同號的門牌）
                an = re.match(r"^(\d+)", half(p["alley"]))
                if an:
                    cands = [(r[0], "lane", r[2]) for d, rk in roads for r in [self._num((d, rk, lane_k), int(an.group(1)))] if r]
            if not roads and road.endswith("巷"):  # 「大明巷12弄22號」：巷名在門牌裡是某條路的巷
                g2 = road + addr_seg_key(p["alley"], "弄")
                for rk in sorted(self.lane_roads.get((dist, road), ())):
                    r = self._num((dist, rk, g2), p["no"])
                    if r:
                        cands.append(r)
            best = self._near_village(cands, vc)
            if best:
                (x, y), q, _ = best
                if p.get("loose") or p.get("mouth"):
                    q = "lane"  # 巷口／弄口／括號裡的地址：位置是巷口，算約略
                elif q == "near" and p.get("sub"):
                    # 2026-09-29 查核第 2 輪：「之」號門牌庫沒有本號、只能用前後門牌推的，跟環保局座標差中位數 111m
                    # （沒有之號的 near 只差 27m；例：沙鹿區東晉路三和巷25之8號差 774m）→ 算位置約略
                    q = "far"
                return (y, x), q
            lane_no = re.match(r"^(\d+)", half(p["lane"]))
            if lane_no:  # 巷口：巷號 ≈ 主路門牌號
                cands = [r for d, rk in roads for r in [self._num((d, rk, ""), int(lane_no.group(1)))] if r]
                best = self._near_village(cands, vc)
                if best:
                    (x, y), _, _ = best
                    return (y, x), "lane"
            # 同一條巷子的門牌中段（「瓦瑤路79巷口」主路沒有 79 號時；「丁台路559巷100弄號」弄口找不到時）
            lk = lane_k or (f"{p['no']}巷" if p.get("mouth") else "")
            if lk:
                ll = self._lane_mid(roads, lk, vc)
                if ll:
                    return ll, "lanemid"
            for d, rk in roads:  # 路找得到、門牌對不上 → 該路在本里附近的中位點
                pts = self.road_pts[(d, rk)]
                if vc:
                    near = [q for q in pts if haversine(vc[1], vc[0], q[1], q[0]) < 1500]
                    if not near and pts:
                        q0 = min(pts, key=lambda q: haversine(vc[1], vc[0], q[1], q[0]))
                        near = [q0] if haversine(vc[1], vc[0], q0[1], q0[0]) < 5000 else []
                    pts = near
                if pts:
                    x = sorted(q[0] for q in pts)[len(pts) // 2]
                    y = sorted(q[1] for q in pts)[len(pts) // 2]
                    return (y, x), "road"
        if "xa" in p:
            best = None

            def roads_any(name):
                k = self.road_key(name)
                for v in [k] + char_variants(k):
                    rs = self._roads_for(dist, v, li)
                    if rs:
                        return rs
                return []

            for da, ra in roads_any(p["xa"]):
                for db, rb in roads_any(p["xb"]):
                    r = self._closest_pair(self.road_pts[(da, ra)], self.road_pts[(db, rb)])
                    if r and (best is None or r[0] < best[0]):
                        best = r
            if best and best[0] * 111000 < 250:
                return best[1], "intersection"
        if vc:
            return (vc[1], vc[0]), "village"
        return None, "none"


# 清運資料與門牌資料常見的異體字（兩個方向都試；只在原字找不到路時才換）
CHAR_VARIANTS = [("館", "舘"), ("峰", "峯"), ("群", "羣"), ("雙", "双"), ("德", "徳"), ("恆", "恒"), ("線", "綫"),
                 ("濂", "濓"), ("嶺", "岺"), ("鄰", "隣"), ("磘", "瑤"), ("村", "邨")]


def char_variants(name):
    out = []
    if name.startswith("工業") and not name.startswith("工業區"):  # 清運資料「工業三十八路」＝門牌「工業區三十八路」
        out.append("工業區" + name[2:])
    for a, b in CHAR_VARIANTS:
        for x, y in ((a, b), (b, a)):
            if x in name:
                v = name.replace(x, y)
                if v not in out and v != name:
                    out.append(v)
    return out


def needed_keys(items):
    """先解析全部地址，只把會用到的路名/巷名載入記憶體"""
    roads, lanes = set(), set()
    for dist, li, place in items:
        p = parse_addr(place, li) or {}
        for k in ("road", "xa", "xb"):
            if k in p:
                rk = addr_road_key(p[k])
                for v in [rk] + char_variants(rk):
                    roads.add(v); roads.add(SEG_RE.sub("", v))
                if k == "road" and rk.endswith("巷"):
                    lanes.add(rk)
    return roads, lanes


# ================================================================ 清運點
END_ONLY = collections.Counter()  # 開放資料「只寫結束時間、開始時間空白」的格子：borrowed＝借到同點別天同結束時間的起訖；end＝只能放結束時間


_HM_RE = re.compile(r"^(\d{1,2}):(\d{1,2})$")


def hhmm(t):
    """時間一律補成兩位數 HH:MM。
    ⚠ 2026-09-29 查核：開放資料有一格寫 "9:05"（太平區永平路三段211號 週六 g_d6_time_e），照抄會變成 "09:00-9:05"；
      頁面的正規式吃得下，但字串比較（例如下面借用起訖時比結束時間）會對不上。不是 H:MM 樣式的原樣回傳。"""
    t = (t or "").strip()
    m = _HM_RE.match(t)
    return f"{int(m.group(1)):02d}:{int(m.group(2)):02d}" if m else t


def win(s, e, siblings=()):
    """一格班表 → "HH:MM" / "HH:MM-HH:MM" / ""。
    ⚠ 2026-09-29 查核：開放資料有 7 格只寫結束時間（例：北屯區大連路一段92號 g_d2_time_e=18:22、開始時間空白），
      原本當成「那天沒收」丟掉，但官方系統證實那天有收（18:16~18:22）→ 開始時間空白但有結束時間時照樣保留：
      同一點別天（先找同類、再找另一類）有同樣結束時間的起訖就借用，沒有就只放結束時間。"""
    s, e = hhmm(s), hhmm(e)
    if not s and not e:
        return ""
    if not s:
        for s2, e2 in siblings:
            s2, e2 = hhmm(s2), hhmm(e2)
            if s2 and e2 == e and s2 != e2:
                END_ONLY["borrowed"] += 1
                return f"{s2}-{e}"
        END_ONLY["end"] += 1
        return e
    return s if (not e or e == s) else f"{s}-{e}"


def normalize_stops(rows):
    skipped = collections.Counter()
    merged = collections.OrderedDict()
    END_ONLY.clear()
    for r in rows:
        cap = (r.get("caption") or "").strip()
        if r.get("task_type") == "往廠" or re.search(r"焚化廠|垃圾場傾倒", cap):
            skipped["往廠/焚化廠（不是給民眾倒垃圾的點）"] += 1
            continue
        gp = [(r.get(f"g_d{i}_time_s"), r.get(f"g_d{i}_time_e")) for i in range(1, 8)]
        rp = [(r.get(f"r_d{i}_time_s"), r.get(f"r_d{i}_time_e")) for i in range(1, 8)]
        g = [win(s, e, gp + rp) for s, e in gp]
        rr = [win(s, e, rp + gp) for s, e in rp]
        if not any(g) and not any(rr):
            skipped["沒有任何班表"] += 1
            continue
        key = (r["area"], r["village"], cap, r.get("car_licence") or "", r.get("task_type") or "")
        if key in merged:  # 同地點同車一天來兩趟 → 併成 "18:30-18:35,18:56-19:01"
            m = merged[key]
            m["g"] = [",".join(x for x in (a, b) if x) for a, b in zip(m["g"], g)]
            m["r"] = [",".join(x for x in (a, b) if x) for a, b in zip(m["r"], rr)]
            skipped["同點同車一天兩趟（合併成一筆）"] += 1
            continue
        merged[key] = {"g": g, "r": rr}
    return merged, skipped


def build_stops(rows, geo):
    merged, skipped = normalize_stops(rows)
    out, qa = [], collections.Counter()
    for (dist, li, cap, car, tt), m in merged.items():
        latlng, q = geo.locate(dist, li, cap)
        qa[q] += 1
        has_g, has_r = any(m["g"]), any(m["r"])
        src_days = m["g"] if has_g else m["r"]  # times＝垃圾車到點時間（沒有垃圾班才用資收）
        starts = sorted({w.split("-")[0] for day in src_days for w in day.split(",") if w})
        sid = hashlib.sha1("|".join((dist, li, cap, car, tt)).encode("utf-8")).hexdigest()[:10]
        out.append({
            "id": sid, "place": cap, "dist": dist, "li": li,
            "lat": round(latlng[0], 5) if latlng else None, "lng": round(latlng[1], 5) if latlng else None,
            "method": tt, "route": car,
            "kind": "混合" if has_g and has_r else ("垃圾" if has_g else "回收"),
            "times": starts,
            "days": "".join(WEEK[i] for i in range(7) if m["g"][i]),
            "rdays": "".join(WEEK[i] for i in range(7) if m["r"][i]),
            "g": m["g"], "r": m["r"], "geo": q,
        })
    ids = collections.Counter(s["id"] for s in out)
    assert max(ids.values()) == 1, "id 撞號"
    return out, dict(skipped), dict(qa)


def tile_of(lat, lng):
    return f"{math.floor(round(lat * SCALE) / CELL)}_{math.floor(round(lng * SCALE) / CELL)}"


def first_start(s):
    for day in s["g"] + s["r"]:
        for w in day.split(","):
            if w:
                return w.split("-")[0]
    return "99:99"


# ================================================================ 國定假日
def build_holiday(cache, geo, fetcher):
    h = read_html(os.path.join(cache, "pages", "schedule.html"))
    m = re.search(r"親愛的市民朋友大家好：\s*<br>\s*(.*?)</p>", h, re.S)
    notice = re.sub(r"\s+", "", html.unescape(m.group(1))) if m else ""
    if not notice:
        raise SystemExit("STOP：schedule.aspx 找不到國定假日公告原文（頁面改版？）")
    ym = re.match(r"(\d{2,3})年", notice)
    roc = int(ym.group(1)) if ym else None
    dates = []
    if roc:
        for mm, dd, name in re.findall(r"(\d{1,2})月(\d{1,2})日\(([^)]+)\)", notice):
            dates.append({"date": f"{roc + 1911}-{int(mm):02d}-{int(dd):02d}", "name": name})
    pdfs = {}
    ph = os.path.join(cache, "pages", "post3173778.html")
    if os.path.exists(ph):
        t = read_html(ph)
        for href, label in re.findall(r'<a[^>]+href="(/media/[^"]+\.pdf)"[^>]*>([^<]+)</a>', t):
            label = html.unescape(label).replace("東南區", "")  # 「04-東南區-東區」：東南區是隊名，不是行政區
            for d in sorted(HOLIDAY_DISTS, key=len, reverse=True):  # 長的先比
                if d in label and d not in pdfs:
                    pdfs[d] = "https://www.epb.taichung.gov.tw" + href
                    break
    stops, per_dist, qa = [], collections.Counter(), []
    for d in HOLIDAY_DISTS:
        fn = os.path.join(cache, "holiday", f"{d}.json")
        data = json.loads(read_json(fn)["d"])["DATA"]
        for x in data:
            cap = x["caption"]
            place = (cap[len(x["area"]):] if cap.startswith(x["area"]) else cap).strip()
            s, _, e = x["cleartime"].partition("~")
            lat, lng = float(x["y"]), float(x["x"])
            stops.append({"id": "h" + x["seq"], "dist": x["area"], "li": x["village"], "place": place,
                          "lat": round(lat, 5), "lng": round(lng, 5), "start": s, "end": e})
            per_dist[x["area"]] += 1
            ll, q = geo.locate(x["area"], x["village"], place)  # 拿環保局自己的座標驗證門牌定位準度
            if ll and q in ("exact", "near", "lane"):
                qa.append(haversine(lat, lng, ll[0], ll[1]))
    stops.sort(key=lambda s: (DISTS.index(s["dist"]), s["start"], s["place"]))
    qa.sort()
    qa_stat = None
    if qa:
        qa_stat = {"compared": len(qa), "median_m": round(qa[len(qa) // 2]), "p90_m": round(qa[int(len(qa) * 0.9)]),
                   "within_100m": sum(1 for v in qa if v <= 100), "within_300m": sum(1 for v in qa if v <= 300)}
    hol_fetched = max(filter(None, (fetcher.fetched_at(os.path.join("holiday", f"{d}.json")) for d in HOLIDAY_DISTS)))
    no_data = [d for d in DISTS if d not in per_dist]
    return {
        "year_roc": roc, "year": roc + 1911 if roc else None,
        "notice": notice,
        "notice_source": URL_SCHEDULE,
        "announcement": URL_HOLIDAY_POST,
        "dates": dates,
        "special": HOLIDAY_SPECIAL,
        "pdf_by_district": {d: pdfs[d] for d in DISTS if d in pdfs},
        "no_data_districts": no_data,
        "no_data_note": "環保局國定假日定點班表的行政區選單裡沒有和平區，查也查不到；和平區國定假日怎麼收，請直接問和平區清潔隊。"
        if no_data == ["和平區"] else "這些區在官方國定假日定點班表查不到資料，請洽該區清潔隊。",
        "count": len(stops),
        "count_by_district": {d: per_dist[d] for d in DISTS if per_dist[d]},
        "fetched": hol_fetched,
        "fields": {"id": "h＋官方序號", "place": "官方定點地址原文（已去掉開頭區名）", "start/end": "定點停靠起訖 HH:MM",
                   "lat/lng": "環保局提供的座標（不是本站推算）"},
        "stops": stops,
    }, qa_stat


# ================================================================ 清潔隊聯絡方式
TEAM_OF_DIST = {"中區": "A1", "西區": "A1", "南區": "A2", "東區": "A4"}  # 中西區隊、東南區隊（東區另有一列）


def build_contacts(cache):
    t = read_html(os.path.join(cache, "pages", "services_4.html"))
    teams = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        cells = [re.sub(r"\s+", " ", html_text(c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) >= 4 and re.match(r"^A\d+$", cells[0]):
            teams.append({"no": cells[0], "name": cells[1], "address": cells[2], "tel": cells[3],
                          "fax": cells[4] if len(cells) > 4 else ""})
    if len(teams) < 20:
        raise SystemExit(f"STOP：清潔隊聯絡頁只解析到 {len(teams)} 列（頁面改版？）")
    by_no = {x["no"]: x for x in teams}
    dist_team = {}
    for d in DISTS:
        no = TEAM_OF_DIST.get(d)
        if not no:
            no = next((x["no"] for x in teams if x["name"] == d or x["name"].startswith(d)), None)
        if no and no in by_no:
            dist_team[d] = no
    missing = [d for d in DISTS if d not in dist_team]
    if missing:
        print("  ⚠ 這些區對不到清潔隊：", missing)
    return {"source": PAGES["services_4.html"], "teams": teams, "dist_team": dist_team,
            "note": "「中西區」隊管中區、西區；「東南區」隊管南區（東區另列一隊，電話同東南區）；和平區清潔隊歸和平區公所管轄。"}


# ================================================================ 規則（只放有官方原文的）
APP = {
    "name": "臺中垃圾清運大車隊",
    "android": "https://play.google.com/store/apps/details?id=tw.gis.tgcar",
    "ios": "https://apps.apple.com/tw/app/%E8%87%BA%E4%B8%AD%E5%9E%83%E5%9C%BE%E6%B8%85%E9%81%8B%E5%A4%A7%E8%BB%8A%E9%9A%8A/id935569593",
    "official_short_links": {"android": "https://is.gd/dbubSk", "ios": "https://is.gd/VTvexu"},
    "source": URL_HOLIDAY_POST,
    "source_quote": "國定假日定時定點收運時刻及地點與平常日不同，請用「臺中垃圾清運大車隊」APP查詢（Google Play或Apple App Store搜尋「臺中垃圾清運大車隊」即可免費下載安裝）。",
    "note": "環保局公告給的是 is.gd 短網址；android／ios 是 2026-09-29 解開短網址後的商店網址"
            "（Google Play tw.gis.tgcar、App Store id935569593）。",
}

RULES = [
    {"id": "weekly_pattern", "role": "general_note",
     "title": "大多數清運點週三、週日沒有排班",
     "text": "依環保局開放資料的各點星期班表統計，全市週日沒有任何排班，週三只有少數點（和平區、大甲區）有收；"
             "環保局新聞稿也寫到週日為例假日不收運。這是資料整理出的一般情形，不是環保局明文規定，"
             "實際哪天收一律看每個清運點自己的班表。",
     "basis": "開放資料班表統計＋環保局新聞稿佐證（環保局網站沒有一句「每週三、日停收」的明文規定）",
     "data_evidence": None,  # build 時填入統計
     "evidence": [
         {"url": "https://www.epb.taichung.gov.tw/3375213/post", "date": "2026-09-21",
          "quote": "9 月 26 日（星期六）維持正常垃圾收運， 9 月 27 日（星期日）為例假日不收運。"},
         {"url": "https://www.epb.taichung.gov.tw/3198939/post", "date": "2026-01-26",
          "quote": "另因清潔隊員例假日安排，初二（2月18日）及初六（2月22日）停止垃圾收運",
          "note": "2026-02-18 是星期三、2026-02-22 是星期日"}],
     "ui_hint": "不要寫成「環保局規定每週三、日停收」；判斷今天有沒有收，看該點 g／r 班表的當天欄位"},
    {"id": "kitchen_waste", "role": "rule",
     "title": "廚餘跟著垃圾車收（交給垃圾車上的廚餘回收桶）",
     "evidence": [
         {"url": "https://recycle.epb.taichung.gov.tw/other/other10.asp", "quote": "廚餘類隨垃圾車收運日回收。"},
         {"url": "https://recycle.epb.taichung.gov.tw/qa/qa_01-1.asp",
          "quote": "民眾自備容器盛裝，交由本局清潔隊之垃圾車上廚餘回收桶。"}],
     "ui_hint": "開放資料只有一般垃圾（g）與資源回收（r）兩組班表，廚餘日＝垃圾日"},
    {"id": "three_types", "role": "rule",
     "title": "倒垃圾前先分三類：資源垃圾、生熟廚餘、一般垃圾",
     "evidence": [{"url": "https://www.epb.taichung.gov.tw/3263783/post", "date": "2026-04-27",
                   "quote": "應事先將垃圾分類為「資源垃圾」、「生、熟廚餘」及「一般垃圾」三類"}]},
    {"id": "national_holiday", "role": "rule",
     "title": "國定假日停止沿街收運，改成定時定點",
     "evidence": [
         {"url": URL_SCHEDULE, "quote": "停止沿街垃圾收運，當天改為定時定點服務，時間、地點如下："},
         {"url": URL_HOLIDAY_POST, "date": "2025-12-26",
          "quote": "停止沿街垃圾收運，當天改為定時定點服務，時間、地點如附檔，敬請市民朋友注意並多加利用。"}],
     "ui_hint": "假日清單、各區定點見 holiday.json；和平區沒有國定假日定點班表"},
    {"id": "pressure_cans", "role": "rule",
     "title": "瓦斯罐、殺蟲劑、噴漆罐等壓力容器交給資源回收車，不要丟垃圾車",
     "evidence": [{"url": "https://www.epb.taichung.gov.tw/3375213/post", "date": "2026-09-21",
                   "quote": "瓦斯罐、殺蟲劑、噴漆罐等壓力容器切勿直接投入垃圾車，應依資源回收方式交付回收車"}]},
    {"id": "bulky_items", "role": "rule",
     "title": "大型家電、堪用家具要先跟清潔隊約時間",
     "evidence": [{"url": "https://recycle.epb.taichung.gov.tw/other/other10.asp",
                   "quote": "約定收運項目(大型家電、堪用家具等)：請先向所轄清潔隊提出申請約定時間。"}]},
    {"id": "announcements", "role": "rule",
     "title": "颱風、連假等臨時異動，以環保局官網與官方 APP 的最新消息為準",
     "evidence": [
         {"url": URL_HOLIDAY_POST, "date": "2025-12-26",
          "quote": "有關各區清潔隊垃圾收運資訊，環保局將透過官方網站及「臺中垃圾清運大車隊」APP 公布最新消息"},
         {"url": "https://cleaner.epb.taichung.gov.tw/services_2_1.aspx",
          "quote": "提供使用者可查看臺中市各區垃圾清運相關訊息，如國定假日、颱風等情況之收運訊息"}],
     "ui_hint": "本站資料沒有臨時停收資訊，頁面要引導到官方最新消息"},
    {"id": "official_app", "role": "rule",
     "title": "官方 APP「臺中垃圾清運大車隊」可查垃圾車到點，並設定到點前 3 或 5 分鐘推播",
     "evidence": [
         {"url": "https://www.epb.taichung.gov.tw/3375213/post", "date": "2026-09-21",
          "quote": "下載「台中垃圾清運大車隊」 APP ，即時接收最新消息，還能自行設定清運 3 分鐘或 5 分鐘到點推播通知"},
         {"url": URL_HOLIDAY_POST, "date": "2025-12-26",
          "quote": "臺中垃圾清運大車隊APP下載連結 【Android】 https://is.gd/dbubSk 【IOS】 https://is.gd/VTvexu"}],
     "ui_hint": "下載連結見 rules.json 的 app 欄"},
    {"id": "split_day_recycling", "role": "reference_only", "use_as_rule": False,
     "title": "（106 年說明）原市 8 區資源回收分日收的品項",
     "table": [
         {"districts": ["東區", "南區", "中區", "西區", "北屯區", "南屯區"],
          "days": [{"day": "週一", "items": "紙類(不含紙容器)、玻璃容器"},
                   {"day": "週四", "items": "紙容器、塑膠容器、金屬容器(不含紙類、玻璃容器)"},
                   {"day": "週六", "items": "所有資源回收物均收"}]},
         {"districts": ["北區", "西屯區"],
          "days": [{"day": "週一", "items": "紙類(不含紙容器)、玻璃容器"},
                   {"day": "週二、週四", "items": "紙容器、塑膠容器、金屬容器(不含紙類、玻璃容器)"},
                   {"day": "週六", "items": "所有資源回收物均收"}]}],
     "evidence": [{"url": "https://recycle.epb.taichung.gov.tw/other/other10.asp",
                   "quote": "資源物分日回收政策自106年10月2日起實施"},
                  {"url": "https://recycle.epb.taichung.gov.tw/other/other10.asp",
                   "quote": "其他資源回收日(星期六)所有資源回收物均收。"}],
     "caveat": "這頁是 106 年的政策說明，跟現在的開放資料班表有出入（例如東區、西區、北屯區、南屯區多數點週二也有資收車）。"
               "「哪天有資收車」一律看各點 r 班表；這張表不能拿來判斷哪天收，要顯示也必須附上這段說明。"},
]

LINKS = [
    {"label": "清運點動態查詢（官方，可看今天車子到了沒）", "url": URL_QUERY},
    {"label": "國定假日定點班表（官方）", "url": URL_SCHEDULE},
    {"label": "各區清潔隊聯絡方式（官方）", "url": PAGES["services_4.html"]},
    {"label": "115 年國定假日收運公告（環保局，附各區 PDF）", "url": URL_HOLIDAY_POST},
    {"label": "開放資料：臺中市定時定點垃圾收運地點", "url": "https://data.gov.tw/dataset/84004"},
    {"label": "開放資料：臺中市垃圾清運及資源回收車動態資訊", "url": "https://data.gov.tw/dataset/83558"},
]


def verify_quotes(cache):
    """每條規則的原文都要在快取的官方頁面裡找得到（忽略空白）"""
    texts, results = {}, []

    def page_text(url):
        fn = PAGE_OF_URL.get(url)
        if not fn:
            return None
        if fn not in texts:
            p = os.path.join(cache, "pages", fn)
            texts[fn] = squash(html_text(read_html(p))) if os.path.exists(p) else None
        return texts[fn]

    items = [(r["id"], ev["url"], ev["quote"]) for r in RULES for ev in r["evidence"]]
    items.append(("app", APP["source"], APP["source_quote"]))
    for rid, url, quote in items:
        t = page_text(url)
        ok = None if t is None else (squash(quote) in t)
        results.append({"rule": rid, "url": url, "ok": ok})
    return results


# ================================================================ 官方查詢系統抽查（開放資料是不是過時了）
# 2026-09-29 查核發現：開放資料 84004（2026-07-31 版）的中區班表，跟環保局官方查詢系統現況不同
# （93 點有 91 點時間不同、多數提早，週二也多了資源回收）。開放資料「不定期更新」，所以每次建置都要抽查：
#   - 呼叫環保局「臺中垃圾清運大車隊」查詢網頁自己用的 Newgetlocation（查某座標 300 公尺內今天有排班的點）
#   - ⚠ 那不是開放資料：只在建置時「抽查」用，每區最多 1 次、循序、間隔 ≥2 秒；網站本身從不呼叫它，
#     也不拿它的時間取代開放資料（要不要用它補資料，由景泰決定）
#   - 回應快取在 <cache>/drift/；沒加 --drift-check 就只用快取，完全不連網
#   - 比對結果：班表不同的點在分塊裡標 od:1；不同比例高的區列進 index.drift.flag，頁面對那些區顯示警示；
#     車牌跟官方一致的路線在 routes.json 標 ok（頁面只對這些車顯示「看路線」）
URL_NEWGETLOCATION = "https://cleaner.epb.taichung.gov.tw/WebService/WsSkyeyes.asmx/Newgetlocation"
DRIFT_METER = 300
DRIFT_MAX_AGE_DAYS = 45     # 超過這麼久的官方回應不算數
DRIFT_MIN_PER_DIST = 5      # --drift-check 時，已比對到的點少於這個數的區才再查
DRIFT_FLAG_MIN_N = 5        # 一區至少比對到這麼多點，才判斷整區要不要警示
DRIFT_FLAG_RATE = 0.2       # 班表不同的比例 ≥ 這個值 → 整區警示
DRIFT_TOL_MIN = 5           # 開始時間差在這以內（例：開放資料週一資收只寫結束時間 08:22、官方寫 08:18~08:22）不算不同


def off_win(v):
    """官方 "07:30~07:55" / "無清運" → "07:30-07:55" / ""（跟開放資料同格式）"""
    v = (v or "").strip()
    if not v or v == "無清運":
        return ""
    a, _, b = v.partition("~")
    a, b = a.strip(), b.strip()
    return a if (not b or a == b) else f"{a}-{b}"


def norm_cell(c):
    return ",".join(sorted(w for w in (c or "").split(",") if w))


def hm2min(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def cell_diff(a, b):
    """兩格班表是否「實質不同」（a＝開放資料、b＝官方）：一邊有一邊沒有、趟數不同、或任一趟開始時間差超過 DRIFT_TOL_MIN 分鐘。
    ⚠ 開放資料只寫一個時間、官方寫起訖的格子（例：太平區 035-VP 週一資收開放資料 06:12、官方 06:04~06:12）
      一律比開始時間（2026-09-29 查核第 2 輪：車子會比這裡寫的早到，算不同，寧可多提醒）。"""
    wa, wb = [w for w in a.split(",") if w], [w for w in b.split(",") if w]
    if bool(wa) != bool(wb) or len(wa) != len(wb):
        return True
    sa = sorted(hm2min(w.split("-")[0]) for w in wa)
    sb = sorted(hm2min(w.split("-")[0]) for w in wb)
    return any(abs(x - y) > DRIFT_TOL_MIN for x, y in zip(sa, sb))


def load_drift(cache, fetcher):
    """<cache>/drift/*.json（官方 Newgetlocation 原始回應）→ 官方清運點紀錄
    同一點同一台車若有多筆（跨區里重複列、一天兩趟）：相同班表去重，不同班表合併成「a,b」"""
    since = (datetime.now(TPE) - timedelta(days=DRIFT_MAX_AGE_DAYS)).strftime("%Y-%m-%d")
    by_seq, dates, used = {}, [], 0
    for fn in sorted(glob.glob(os.path.join(cache, "drift", "*.json"))):
        rel = os.path.relpath(fn, cache)
        at = fetcher.fetched_at(rel)
        if not at or at[:10] < since:
            continue
        try:
            data = json.loads(read_json(fn)["d"]).get("DATA", [])
        except (ValueError, KeyError, TypeError):
            continue
        used += 1
        dates.append(at[:10])
        for o in data:
            if o.get("seq") in (None, "NODATA", "OVERDATA") or not o.get("caption"):
                continue
            by_seq[o["seq"]] = o
    groups = collections.defaultdict(set)
    for o in by_seq.values():
        k = (o["area"], squash(o["caption"]), (o.get("car_licence") or "").strip(), o.get("task_type") or "")
        g = tuple(off_win(o.get(f"g_d{i}")) for i in range(1, 8))
        r = tuple(off_win(o.get(f"r_d{i}")) for i in range(1, 8))
        groups[k].add((g, r))
    recs = []
    for (area, cap, car, tt), variants in groups.items():
        g = [norm_cell(",".join(sorted({v[0][i] for v in variants if v[0][i]}))) for i in range(7)]
        r = [norm_cell(",".join(sorted({v[1][i] for v in variants if v[1][i]}))) for i in range(7)]
        recs.append({"area": area, "cap": cap, "car": car, "type": tt, "g": g, "r": r})
    return recs, used, (max(dates) if dates else None)


def drift_fetch(cache, fetcher, stops, recs, max_calls):
    """已比對點數不足的區，各挑一個清運點最密的位置查一次官方（循序、間隔 ≥2 秒；非 200 就停）"""
    cnt = collections.Counter()
    keys = {(s["dist"], squash(s["place"])) for s in stops}
    for o in recs:
        if (o["area"], o["cap"]) in keys:
            cnt[o["area"]] += 1
    todo = [d for d in DISTS if cnt[d] < DRIFT_MIN_PER_DIST][:max_calls]
    if not todo:
        print("  抽查：每區比對點數都夠，不再查")
        return 0
    tiles = collections.defaultdict(list)
    for s in stops:
        if s["lat"] is not None:
            tiles[tile_of(s["lat"], s["lng"])].append(s)
    stamp = datetime.now(TPE).strftime("%Y%m%d")
    calls = 0
    for d in todo:
        pool = [s for s in stops if s["dist"] == d and s["geo"] == "exact" and s["lat"] is not None]
        if not pool:  # 和平區：清運點多半只能定位到村里中心，查了也對不準 → 不查
            print(f"  抽查：{d} 沒有門牌同號定位的清運點，略過")
            continue

        def density(s):
            y, x = (int(v) for v in tile_of(s["lat"], s["lng"]).split("_"))
            near = [t for dy in (-1, 0, 1) for dx in (-1, 0, 1) for t in tiles.get(f"{y + dy}_{x + dx}", ())]
            return sum(1 for t in near if haversine(s["lat"], s["lng"], t["lat"], t["lng"]) <= DRIFT_METER * 0.8)

        pick = max(pool[:: max(1, len(pool) // 300)], key=density)
        rel = os.path.join("drift", f"{stamp}_{d}_{pick['id']}_{DRIFT_METER}.json")
        payload = {"x": f"{pick['lng']:.6f}", "y": f"{pick['lat']:.6f}", "meter": DRIFT_METER}
        try:
            fetcher.post_json(rel, URL_NEWGETLOCATION, payload, URL_QUERY, timeout=90)
        except SystemExit as e:  # 非 200：停止抽查（不重試、不繞過），建置照樣用已有的快取
            print(f"  抽查中止：{e}")
            break
        calls += 1
    return calls


def drift_compare(stops, recs, checked, modified):
    """官方紀錄 vs 本站清運點（同區＋同地點原文）→ 各區統計、班表不同的點、車牌確認"""
    by_place = collections.defaultdict(list)
    for s in stops:
        by_place[(s["dist"], squash(s["place"]))].append(s)
    res = {}          # stop id -> dict(same, plate_ok, shifts, extra_r, dist)
    only = collections.Counter()
    for o in recs:
        cands = by_place.get((o["area"], o["cap"]), [])
        if not cands:
            only[o["area"]] += 1
            continue
        pref = ([s for s in cands if s["route"] == o["car"] and s["method"] == o["type"]]
                or [s for s in cands if s["method"] == o["type"]] or cands)
        same_s = next((s for s in pref if not any(cell_diff(norm_cell(s["g"][i]), o["g"][i]) or
                                                  cell_diff(norm_cell(s["r"][i]), o["r"][i]) for i in range(7))), None)
        s = same_s or pref[0]
        cur = res.get(s["id"])
        if cur and cur["same"]:
            continue
        shifts, extra_r, extra_g, miss_r = [], set(), set(), set()
        for i in range(7):
            for k in ("g", "r"):
                a, b = s[k][i], o[k][i]
                if a and b and cell_diff(norm_cell(a), b):
                    shifts.append(hm2min(b.split(",")[0].split("-")[0]) - hm2min(a.split(",")[0].split("-")[0]))
            if o["r"][i] and not s["r"][i]:
                extra_r.add(i)
            if s["r"][i] and not o["r"][i]:
                miss_r.add(i)
            if o["g"][i] and not s["g"][i]:
                extra_g.add(i)
        res[s["id"]] = {"dist": s["dist"], "same": same_s is not None, "route": s["route"], "car": o["car"],
                        "plate_ok": bool(s["route"]) and s["route"] == o["car"],
                        "shifts": shifts, "extra_r": extra_r, "extra_g": extra_g, "miss_r": miss_r}
    dists = {}
    for d in DISTS:
        rows = [v for v in res.values() if v["dist"] == d]
        if not rows and not only[d]:
            continue
        diff = [v for v in rows if not v["same"]]
        sh = [x for v in diff for x in v["shifts"] if x]
        st = {"n": len(rows), "diff": len(diff), "plate": sum(1 for v in rows if v["route"] and not v["plate_ok"]),
              "only": only[d]}
        if sh:
            st["early"] = sum(1 for x in sh if x < 0)
            st["late"] = sum(1 for x in sh if x > 0)
            st["shift_med"] = sorted(sh)[len(sh) // 2]
        for key, lab in (("extra_r", "r"), ("extra_g", "g")):
            c = collections.Counter(i for v in diff for i in v[key])
            days = [WEEK[i] for i, k in sorted(c.items()) if k >= max(2, 0.3 * len(rows))]
            if days:
                st["more_" + lab] = "".join(days)
        dists[d] = st
    flag = [d for d, st in dists.items() if st["n"] >= DRIFT_FLAG_MIN_N and st["diff"] / st["n"] >= DRIFT_FLAG_RATE]

    def how_of(rows):
        """一群比對結果 → ["多數比這裡寫的早（常見差 10～20 分鐘）", "週二也有資源回收", …]"""
        diff = [v for v in rows if not v["same"]]
        sh = [x for v in diff for x in v["shifts"] if x]
        how = []
        a = sorted(abs(x) for x in sh)
        if a:
            e, l = sum(1 for x in sh if x < 0), sum(1 for x in sh if x > 0)
            lo, hi = a[len(a) // 4], a[(len(a) * 3) // 4]
            span = f"常見差 {lo}～{hi} 分鐘" if hi > lo else f"常見差約 {lo} 分鐘"
            if e >= 2 * max(l, 1):
                how.append(f"多數比這裡寫的早（{span}）")
            elif l >= 2 * max(e, 1):
                how.append(f"多數比這裡寫的晚（{span}）")
            else:
                how.append("有的早、有的晚")
        for key, word in (("extra_r", "資源回收"), ("extra_g", "垃圾車")):
            c = collections.Counter(i for v in diff for i in v[key])
            days = [WEEK[i] for i, k in sorted(c.items()) if k >= max(1 if len(rows) < 5 else 2, 0.3 * len(rows))]
            if days:
                how.append("週" + "、週".join(days) + "官方有" + word + "、這裡沒寫")
        miss_r = collections.Counter(i for v in diff for i in v["miss_r"])
        days = [WEEK[i] for i, k in sorted(miss_r.items()) if k >= max(1 if len(rows) < 5 else 2, 0.3 * len(rows))]
        if days:
            how.append("週" + "、週".join(days) + "官方沒有資源回收、這裡有寫")
        return how

    mm, dd = int(checked[5:7]), int(checked[8:10])
    msg = {}
    for d in flag:
        st = dists[d]
        how = how_of([v for v in res.values() if v["dist"] == d])
        msg[d] = (f"環保局官方查詢系統 {mm}/{dd} 抽查{d} {st['n']} 個清運點，{st['diff']} 個點的時間或收運日"
                  f"跟開放資料（{modified} 版）不一樣" + ("：" + "，".join(how) if how else "") + "。")
    # 2026-09-29 查核（第 2 輪）：班表常是「整條路線（整台車）」一起改，整區比例不高的區也會漏掉
    # （南區 411-VP 抽 6 點 6 點不同、太平區 KEG-8179…）→ 以路線為單位：抽到的點只要有一點不同，
    # 這台車在開放資料裡的所有點都標「可能已改」（od:2；抽到且不同的點本身是 od:1）
    routes = {}
    by_route = collections.defaultdict(list)
    for v in res.values():
        if v["route"]:
            by_route[v["route"]].append(v)
    for plate, rows in sorted(by_route.items()):
        nd = sum(1 for v in rows if not v["same"])
        if not nd:
            continue
        how = how_of(rows)
        routes[plate] = {"n": len(rows), "diff": nd, "dists": sorted({v["dist"] for v in rows}, key=DISTS.index),
                         "msg": (f"官方 {mm}/{dd} 抽查車號 {plate} 這條路線 {len(rows)} 個點，{nd} 個點的時間或收運日跟開放資料不一樣"
                                 + ("：" + "，".join(how) if how else "") + "。")}
    plates = collections.defaultdict(lambda: [0, 0])
    for v in res.values():
        if v["route"]:
            plates[v["route"]][0 if v["plate_ok"] else 1] += 1
    return {
        "checked": checked, "against": modified, "src": URL_QUERY,
        "method": f"環保局查詢網頁的 Newgetlocation（座標 {DRIFT_METER} 公尺內今天有排班的點），只在建置時抽查；"
                  "同區＋同地點原文比對開放資料的七天班表；抽到的點只要有一點不同，同一台車（路線）的其他點也標「可能已改」",
        "stops": len(res), "same": sum(1 for v in res.values() if v["same"]),
        "dists": dists, "flag": flag, "msg": msg, "routes": routes,
        "diff_ids": sorted(k for k, v in res.items() if not v["same"]),
        "same_ids": sorted(k for k, v in res.items() if v["same"]),
        "plates_ok": sorted(p for p, (ok, bad) in plates.items() if ok > bad),
        "plates_moved": sorted(p for p, (ok, bad) in plates.items() if bad >= ok),
    }


# ================================================================ 輸出
def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def write(base, rel, obj, sizes):
    body = dump(obj).encode("utf-8")
    path = os.path.join(base, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(body)
    sizes[rel.replace("\\", "/")] = (len(body), len(gzip.compress(body, 9)))


def main():
    ap = argparse.ArgumentParser(description="台中垃圾車時間查詢：建置 public/data/garbage/")
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="原始檔快取資料夾（raw/ holiday/ pages/）")
    ap.add_argument("--refresh", action="store_true", help="重抓清運點、中介資料、公告與規則原文頁")
    ap.add_argument("--refresh-holiday", action="store_true", help="重抓 28 區國定假日班表")
    ap.add_argument("--no-fetch", action="store_true", help="完全不連網")
    ap.add_argument("--addr-dir", default=ADDR_DIR, help="門牌庫資料夾（build-tc-addr.py 的輸出）")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--compare", help="（驗證用）另一份 stops_norm.json，比對同 id 的座標差距")
    ap.add_argument("--drift-check", action="store_true",
                    help="抽查環保局官方查詢系統（比對點數不足的區各查 1 次，循序、間隔 2 秒）；沒加就只用 <cache>/drift/ 快取")
    ap.add_argument("--drift-max", type=int, default=35, help="--drift-check 最多呼叫幾次（預設 35）")
    args = ap.parse_args()
    t0 = time.time()
    os.makedirs(args.cache, exist_ok=True)
    fetcher = Fetcher(args.cache)
    fetch_all(fetcher, args)

    # ---- 清運點
    raw = read_json(os.path.join(args.cache, "raw", "stops_json.json"))
    print(f"[2] 清運點原始 {len(raw):,} 筆")
    merged, _ = normalize_stops(raw)
    roads, lanes = needed_keys([(k[0], k[1], k[2]) for k in merged])
    hol_items = []
    for d in HOLIDAY_DISTS:
        for x in json.loads(read_json(os.path.join(args.cache, "holiday", f"{d}.json"))["d"])["DATA"]:
            cap = x["caption"]
            hol_items.append((x["area"], x["village"], cap[len(x["area"]):] if cap.startswith(x["area"]) else cap))
    r2, l2 = needed_keys(hol_items)
    geo = Geocoder(args.addr_dir, roads | r2, lanes | l2)
    stops, skipped, qa = build_stops(raw, geo)
    print("  排除/合併：", skipped)
    print("  只寫結束時間的格子：", dict(END_ONLY), "（borrowed＝借同點別天同結束時間的起訖、end＝只放結束時間）")
    print("  定位精度：", {k: qa.get(k, 0) for k in GEO_LABEL})

    # ---- 官方查詢系統抽查（開放資料有沒有過時）
    meta_raw = read_json(os.path.join(args.cache, "raw", "datagov_84004.json")).get("result", {})
    modified = (meta_raw.get("modifiedDate") or "")[:10] or None
    recs, used, checked = load_drift(args.cache, fetcher)
    if args.drift_check:
        if args.no_fetch:
            raise SystemExit("STOP：--drift-check 跟 --no-fetch 不能一起用")
        if drift_fetch(args.cache, fetcher, stops, recs, args.drift_max):
            recs, used, checked = load_drift(args.cache, fetcher)
    prev_drift = None
    pd = os.path.join(args.out, "drift.json")
    if os.path.exists(pd):
        try:
            prev_drift = read_json(pd)
        except ValueError:
            prev_drift = None
    if recs:
        drift = drift_compare(stops, recs, checked, modified)
        drift["responses"] = used
    elif prev_drift and prev_drift.get("against") == modified:
        drift = prev_drift  # 沒有快取 → 沿用上次同一版資料的抽查結果
        print("  抽查：沒有官方回應快取，沿用上次的 drift.json")
    else:
        drift = None
    if drift:
        diff_ids = set(drift["diff_ids"])
        same_ids = set(drift.get("same_ids") or [])
        d_routes = drift.get("routes") or {}
        od_cnt = collections.Counter()
        for s in stops:
            if s["id"] in diff_ids:
                s["od"] = 1          # 這一點抽查到班表不同
            elif s["route"] in d_routes and s["id"] not in same_ids:
                s["od"] = 2          # 同一台車（路線）有點抽查到不同 → 這點可能也改了
            if s.get("od"):
                od_cnt[s["od"]] += 1
        for plate, ri in d_routes.items():
            ri["marked"] = sum(1 for s in stops if s["route"] == plate and s.get("od"))
        drift["od_count"] = {"od1": od_cnt[1], "od2": od_cnt[2]}
        print(f"[2b] 官方抽查 {drift['checked']}：比對 {drift['stops']} 點、一致 {drift['same']}；"
              f"整區警示 {drift['flag']}；車牌確認 {len(drift['plates_ok'])} 條、不同 {len(drift['plates_moved'])} 條")
        print(f"    路線警示 {len(d_routes)} 條：抽查不同 {od_cnt[1]} 點（od:1）、同路線連帶標記 {od_cnt[2]} 點（od:2）")
        for plate, ri in d_routes.items():
            print(f"    ⚠ {plate} {ri['dists']} 標記 {ri['marked']} 點：{ri['msg']}")
        for d, st in drift["dists"].items():
            print(f"    {d}: {st}")
        for d, m in drift["msg"].items():
            print(f"    ⚠ {m}")
    else:
        print("[2b] 官方抽查：沒有資料（加 --drift-check 才會抽查）")

    wed = collections.Counter(r["area"] for r in raw if r.get("g_d3_time_s") or r.get("r_d3_time_s"))
    sun = sum(1 for r in raw if r.get("g_d7_time_s") or r.get("r_d7_time_s"))
    wed_txt = "、".join(f"{k} {v} 筆" for k, v in wed.most_common()) or "無"
    data_evidence = (f"{fetcher.fetched_at(os.path.join('raw', 'stops_json.json'))[:10]} 下載的 {len(raw):,} 筆清運班表中，"
                     f"週日有排班 {sun} 筆；週三有排班 {sum(wed.values())} 筆（{wed_txt}）")

    # ---- 國定假日、清潔隊、規則
    hol, hol_qa = build_holiday(args.cache, geo, fetcher)
    print(f"[3] 國定假日 {hol['year_roc']} 年：{len(hol['dates'])} 天、{hol['count']} 個定點；沒有資料的區：{hol['no_data_districts']}")
    print("  門牌定位 vs 環保局座標：", hol_qa)
    contacts = build_contacts(args.cache)
    checks = verify_quotes(args.cache)
    bad = [c for c in checks if c["ok"] is False]
    print(f"[4] 規則原文核對：{sum(1 for c in checks if c['ok'])} 條 ✓、{len(bad)} 條 ✗、"
          f"{sum(1 for c in checks if c['ok'] is None)} 條沒有快取頁可核對")
    for c in bad:
        print(f"  ✗ {c['rule']} {c['url']}")
    if bad:
        raise SystemExit("STOP：官方原文對不上（頁面改字了），請重看來源後更新 RULES")
    rules = json.loads(json.dumps(RULES, ensure_ascii=False))
    for r in rules:
        if r["id"] == "weekly_pattern":
            r["data_evidence"] = data_evidence

    # ---- 輸出
    if os.path.isdir(args.out):
        shutil.rmtree(args.out)
    os.makedirs(os.path.join(args.out, "t"))
    sizes = {}
    version = datetime.now(TPE).strftime("%Y%m%d%H%M")
    stops_fetched = fetcher.fetched_at(os.path.join("raw", "stops_json.json"))
    meta_cars = read_json(os.path.join(args.cache, "raw", "datagov_83558.json")).get("result", {})

    tiles = collections.defaultdict(list)
    unlocated = []
    for s in stops:
        if s["lat"] is None:
            unlocated.append({k: s[k] for k in ("id", "place", "dist", "li", "route")})
            continue
        tiles[tile_of(s["lat"], s["lng"])].append(s)
    for key, lst in tiles.items():
        lst.sort(key=lambda s: (s["route"], first_start(s), s["place"]))
        write(args.out, f"t/{key}.json", {"v": version, "k": key, "stops": lst}, sizes)

    routes = {}
    by_route = collections.defaultdict(list)
    for s in stops:
        if s["route"]:
            by_route[s["route"]].append(s)
    for plate, lst in sorted(by_route.items()):
        starts = sorted(w.split("-")[0] for s in lst for day in s["g"] + s["r"] for w in day.split(",") if w)
        routes[plate] = {
            "dists": sorted({s["dist"] for s in lst}, key=DISTS.index),
            "n": len(lst),
            "tiles": sorted({tile_of(s["lat"], s["lng"]) for s in lst if s["lat"] is not None}),
            "first": starts[0] if starts else "", "last": starts[-1] if starts else "",
            "days": "".join(WEEK[i] for i in range(7) if any(s["g"][i] for s in lst)),
            "rdays": "".join(WEEK[i] for i in range(7) if any(s["r"][i] for s in lst)),
        }
        if drift and plate in drift["plates_ok"]:
            routes[plate]["ok"] = drift["checked"]  # 官方抽查時車牌還是這台（⚠ 只代表車牌，不代表時間一致）
        elif drift and plate in drift["plates_moved"]:
            routes[plate]["moved"] = drift["checked"]  # 官方抽查時這條路線已經換車
        if drift and plate in (drift.get("routes") or {}):
            ri = drift["routes"][plate]
            routes[plate]["od"] = {"n": ri["n"], "diff": ri["diff"], "msg": ri["msg"]}  # 抽查到時間不同的路線
    write(args.out, "routes.json", {"v": version, "routes": routes}, sizes)

    src_stops = "臺中市政府環境保護局「臺中市定時定點垃圾收運地點」（政府資料開放平臺 84004）"
    src_geo = f"座標由本站用臺中市政府數位發展局 {geo.ver} GIS 門牌點位推算"
    index = {
        "v": version,
        "fetched": stops_fetched,
        "modified": modified,
        "src": src_stops, "srcUrl": "https://data.gov.tw/dataset/84004", "geoSrc": src_geo, "lic": LICENSE,
        "scale": SCALE, "cell": CELL,
        "tilePath": "t/{key}.json",
        "count": sum(len(v) for v in tiles.values()),
        "tiles": {k: len(tiles[k]) for k in sorted(tiles)},
        "geoLabel": GEO_LABEL, "geoApprox": GEO_APPROX,
        "drift": ({k: drift.get(k) for k in ("checked", "against", "src", "stops", "same", "dists", "flag", "msg",
                                               "routes", "od_count")}
                  if drift else None),
        "fields": {
            "id": "穩定編號（區|里|地址|車牌|方式 的 sha1 前 10 碼）",
            "place": "官方清運地址原文（括號備註保留）；是公開清運點，不是住戶門牌",
            "dist/li": "行政區／里（官方原文）",
            "lat/lng": "本站用門牌推算的座標（5 位小數）；精度見 geo",
            "method": "定點 或 沿街（沿街＝車子沿路收，這個點是路線上的一站）",
            "route": "垃圾車車牌（官方資料原文，少數為空字串）",
            "kind": "混合（垃圾＋資收）／垃圾／回收",
            "times": "到點時間（起）去重排序；有垃圾班就只放垃圾班時間，沒有才放資收時間",
            "days": "一般垃圾收運日（一二三四五六日）", "rdays": "資源回收日",
            "g": "一般垃圾（廚餘同車）週一..週日 7 格；格內 \"HH:MM\" 或 \"HH:MM-HH:MM\"，一天兩趟以逗號分隔；空字串＝那天不收",
            "r": "資源回收 週一..週日 7 格，格式同 g",
            "geo": "定位精度代碼，見 geoLabel；geoApprox 內的要標「位置約略」",
            "od": "1＝建置時抽查環保局官方查詢系統，這點的班表跟開放資料不同；2＝這點沒抽到（或沒比對到），但同一台車（路線）有抽到的點不同，"
                  "可能也改了（沒有這欄＝沒抽到或一致；整區警示看 drift.flag）",
        },
    }
    write(args.out, "index.json", index, sizes)
    if drift:
        write(args.out, "drift.json", drift, sizes)

    hol_out = dict(hol)
    hol_out["v"] = version
    write(args.out, "holiday.json", hol_out, sizes)

    rules_out = {
        "v": version,
        "note": "每條規則的 evidence 都是官方頁面原文（建置時自動核對過）；role=general_note 是資料整理出的一般情形、不是官方明文，"
                "role=reference_only 只能當背景說明、不能拿來判斷哪天收。",
        "rules": rules,
        "app": APP,
        "links": LINKS,
        "contacts": contacts,
        "phones": [{"label": "1999（環保局公告寫可撥打詢問）", "tel": "1999", "source": URL_HOLIDAY_POST},
                   {"label": "臺中垃圾清運大車隊系統諮詢", "tel": "04-22289111#66618", "source": URL_QUERY}],
        "quote_check": checks,
    }
    write(args.out, "rules.json", rules_out, sizes)

    # 即時車輛：拿快取裡的快照算「車牌對得上路線」的比例（沒有快照就略過）
    cars_stat = None
    cp = os.path.join(args.cache, "raw", "cars_json.json")
    if os.path.exists(cp):
        cars = read_json(cp)
        plates = {c.get("car") for c in cars}
        cars_stat = {"snapshot_file_fetched": fetcher.fetched_at(os.path.join("raw", "cars_json.json")),
                     "cars": len(cars), "plates_matching_routes": len(plates & set(routes))}

    tile_sizes = [v for k, v in sizes.items() if k.startswith("t/")]
    big = max(((k, v) for k, v in sizes.items() if k.startswith("t/")), key=lambda kv: kv[1][0])
    meta = {
        "v": version,
        "built": datetime.now(TPE).strftime("%Y-%m-%d %H:%M"),
        "sources": [
            {"id": "stops", "name": "臺中市定時定點垃圾收運地點", "org": "臺中市政府環境保護局",
             "url": "https://data.gov.tw/dataset/84004",
             "alt_url": "https://opendata.taichung.gov.tw/search/7bb28898-6971-4f9b-972e-6e28edf52a56",
             "download": URL_STOPS, "dataset_modified": meta_raw.get("modifiedDate"),
             "update_frequency": "不定期更新", "fetched": stops_fetched, "license": LICENSE},
            {"id": "holiday", "name": f"{hol['year_roc']} 年國定假日定點班表（臺中垃圾清運大車隊）",
             "org": "臺中市政府環境保護局", "url": URL_SCHEDULE, "announcement": URL_HOLIDAY_POST,
             "fetched": hol["fetched"], "method": "WebService getholiday，每區一次、共 28 區（和平區官方無資料）"},
            {"id": "geo", "name": "臺中市空間資訊建物及門牌號碼位置（GIS 門牌）", "org": "臺中市政府數位發展局",
             "url": geo.src_url, "version": geo.ver, "license": LICENSE,
             "use": "清運點原始資料沒有經緯度，本站用門牌點位推算座標"},
            {"id": "live", "name": "臺中市垃圾清運及資源回收車動態資訊", "org": "臺中市政府環境保護局",
             "url": "https://data.gov.tw/dataset/83558", "download": URL_CARS,
             "dataset_modified": meta_cars.get("modifiedDate"), "update_frequency": "每 10 分鐘一次快照",
             "use": "由 /api/garbage-live（Cloudflare Pages Function）代理，不在靜態檔裡"},
            {"id": "contacts", "name": "清潔隊聯絡方式", "org": "臺中市政府環境保護局",
             "url": PAGES["services_4.html"], "fetched": fetcher.fetched_at(os.path.join("pages", "services_4.html"))},
        ],
        "stops": {
            "raw_rows": len(raw), "count": len(stops), "located": index["count"], "unlocated": unlocated,
            "skipped": skipped,
            "method": dict(collections.Counter(s["method"] for s in stops)),
            "kind": dict(collections.Counter(s["kind"] for s in stops)),
            "routes": len(routes), "empty_route": sum(1 for s in stops if not s["route"]),
            "by_district": {d: c for d, c in sorted(collections.Counter(s["dist"] for s in stops).items(),
                                                    key=lambda kv: DISTS.index(kv[0]))},
            "geo_quality": {k: qa.get(k, 0) for k in GEO_LABEL},
            "geo_validation_vs_epb_holiday_xy": hol_qa,
            "geo_validation_note": "拿環保局國定假日定點自帶的座標，跟本站用門牌推算的座標比（只比門牌同號／最近門牌／巷口三種），單位公尺",
            "wed_sun": data_evidence,
        },
        "holiday": {"year": hol["year"], "dates": len(hol["dates"]), "stops": hol["count"],
                    "no_data_districts": hol["no_data_districts"]},
        "drift": ({k: drift.get(k) for k in ("checked", "against", "method", "stops", "same", "dists", "flag", "msg",
                                               "routes", "od_count")}
                  | {"responses": drift.get("responses"), "plates_ok": len(drift["plates_ok"]),
                     "plates_moved": drift["plates_moved"]} if drift else None),
        "end_only_cells": dict(END_ONLY),
        "live_match": cars_stat,
        "files": {
            "tiles": len(tile_sizes),
            "tiles_total_bytes": sum(s for s, _ in tile_sizes), "tiles_total_gzip": sum(g for _, g in tile_sizes),
            "largest_tile": {"file": big[0], "bytes": big[1][0], "gzip": big[1][1]},
            "others": {k: {"bytes": v[0], "gzip": v[1]} for k, v in sizes.items() if not k.startswith("t/")},
        },
        "update": "python scripts/build-garbage.py --refresh（清運點，建議每月）；每年 12 月底環保局公告隔年國定假日後加 --refresh-holiday，並手動更新腳本裡的 HOLIDAY_SPECIAL",
    }
    write(args.out, "meta.json", meta, sizes)

    total = sum(s for s, _ in sizes.values())
    total_gz = sum(g for _, g in sizes.values())
    print(f"[5] 輸出 {args.out}")
    print(f"  清運點 {len(stops):,}（有座標 {index['count']:,}）、格子 {len(tile_sizes)} 塊、路線 {len(routes)} 條")
    print(f"  最大格 {big[0]} {big[1][0] / 1024:.1f}KB（gzip {big[1][1] / 1024:.1f}KB）")
    for k in ("index.json", "routes.json", "holiday.json", "rules.json", "meta.json"):
        print(f"  {k} {sizes[k][0] / 1024:.1f}KB（gzip {sizes[k][1] / 1024:.1f}KB）")
    print(f"  總計 {len(sizes)} 檔 {total / 1024 / 1024:.2f}MB（gzip {total_gz / 1024 / 1024:.2f}MB）")
    if cars_stat:
        print("  即時車輛快照車牌對上路線：", cars_stat)

    if args.compare:
        ref = {s["id"]: s for s in read_json(args.compare)}
        ds, qdiff, missing = [], collections.Counter(), 0
        for s in stops:
            o = ref.get(s["id"])
            if not o:
                missing += 1
                continue
            if o.get("geo") != s["geo"]:
                qdiff[f"{o.get('geo')}→{s['geo']}"] += 1
            if o.get("lat") and s["lat"]:
                ds.append(haversine(o["lat"], o["lng"], s["lat"], s["lng"]))
        ds.sort()
        print(f"[compare] 同 id {len(ds):,} 筆；參考檔沒有的 {missing}；座標差 中位數 {ds[len(ds) // 2]:.1f}m、"
              f"P99 {ds[int(len(ds) * 0.99)]:.0f}m、>50m {sum(1 for d in ds if d > 50)} 筆、>300m {sum(1 for d in ds if d > 300)} 筆")
        print("  精度代碼變動：", dict(qdiff.most_common(12)))
    print(f"[done] {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
