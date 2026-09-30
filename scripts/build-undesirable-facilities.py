# -*- coding: utf-8 -*-
"""
台中嫌惡設施資料 — 建置腳本（官方開放資料 ＋ OpenStreetMap 合併去重）
================================================================
產出：public/data/undesirable-facilities.json（給 /tools/undesirable-facilities/ 用）
報告：<快取資料夾>/report.json（前後筆數、各來源筆數、檔案大小、無法定位清單、合併案例）

為什麼要這支（2026-09-30）
----------------------------------------------------------------
2026-08-28 版 4,028 筆全來自 OpenStreetMap（志工標註）：殯葬設施只有 5 筆、宮廟裡混了教會，
明顯不完整。改成「官方開放資料為主、OSM 補官方沒有的類別與點」，每一筆標來源 s。

資料來源（原始檔快取在 <快取>/raw/，除非 --refresh 否則不重抓）
----------------------------------------------------------------
代號        類別             來源
moi-t      宮廟             內政部「全國宗教資訊系統資料－寺廟」（data.gov.tw 8203，XML 內含 WGS84）
tc-mort    殯葬設施、公墓    臺中市生命禮儀管理處「殯葬設施地圖」（殯儀館、納骨塔、公墓、環保葬區，含座標）
moi-f      殯葬設施、公墓    內政部「殯葬設施」（data.gov.tw 7052，無座標 → 先對 tc-mort，對不到才用門牌定位）
ea-gas     加油站           經濟部能源署「加油站位置」（整修中、停業中不列；無座標 → 門牌定位，定不到用中油站點座標）
tc-mkt     市場・夜市        臺中市公有零售市場（data.gov.tw 85003，門牌定位）
tc-wh      市場・夜市        臺中市批發市場（data.gov.tw 127820，門牌定位）
tc-nm      市場・夜市        臺中市列管夜市（data.gov.tw 85028，路段 → 兩路交叉口定位）
tc-vz      市場・夜市        臺中市攤販集中區（data.gov.tw 83855，路段 → 交叉口／巷定位）
tc-hosp    醫院             臺中市醫院（data.gov.tw 176960，門牌定位）
tc-lf      掩埋場・轉運站     臺中市使用中衛生掩埋場（data.gov.tw 83993，門牌定位，定不到用監測井座標中點）
osm        其他全部＋補點     OpenStreetMap（scripts/fetch-undesirable-facilities.mjs 產的中介檔）
變電所、高壓電塔、基地台、矯正機關、轉運站：沒有可靠的官方座標（台電只公布到路名），沿用 OSM。

門牌定位（地址 → 座標）
----------------------------------------------------------------
用 public/data/tc-addr/（臺中市 115 年 1 月 GIS 門牌，網站本來就在用的門牌庫，唯讀）：
  exact 完全對到門牌 → base 之號對不到改用本號（12-1 → 12）→ near 同一條路／巷、號碼差 ≤ 8 的最近門牌
  → lane 只有巷弄沒號碼：整條巷弄門牌的中心（巷弄範圍 ≤ 400 公尺才用）
  → xroad 「A 路與 B 路口」或只寫路段：兩條路門牌最接近處的中點（≤ 150 公尺才用）
⛔ 對不到就列進報告的「無法定位」清單，不放里中心、不放行政區中心。

合併去重
----------------------------------------------------------------
- 同一類別（依 label 分組，掩埋場＋轉運站算同一類）、距離 < 60 公尺、且名稱相近（或其中一筆沒名字）→ 視為同一筆
  名稱相近＝正規化後（拿掉臺中市、區名、財團法人、括號…）互相包含或雙字組相似度 ≥ 0.4；
  官方 ↔ 官方要 ≥ 0.7（各自是登記在案的設施，「新庄子永和宮」「新庄子福德祠」同一個門牌是兩間廟）
  加油站先拿掉品牌字（台塑石油、速邁樂、CPC…），拿完沒字就當沒名字
- 官方 ↔ OSM 另外：
  · 面狀類別（公墓、殯葬、市場、醫院、掩埋場、矯正機關）名稱正規化後相同且 < 250 公尺也算同一筆
    （OSM 的公墓、夜市是面狀，中心點常離官方點位 100 公尺以上）
  · 宮廟名稱完全相同（去掉宮廟寺字尾，土地公廟、萬善祠這種到處都有的名字除外）且 < 150 公尺
- 官方 ↔ 官方：同一個點（< 5 公尺）且名稱開頭 4 個字以上相同（「大度山無主納骨堂前棟／後棟」）併成一筆
- 內政部殯葬清冊：先用「同區、同類型、同編號／堂名」對生命禮儀管理處地圖，對到就不另外放；
  門牌定位後 300 公尺內已有地圖上同類設施（同一個園區的另一棟）也併進地圖那一筆
- 保留優先序較前的那筆（官方 > OSM）的名稱與座標
- 2026-09-30 查核後補強：
  · 名稱比對前拿掉所有標點括號（「中油加油站（直營）」拿掉品牌字只剩括號 → 當沒名字）
  · OSM ↔ OSM 也合併：同類、名稱相同、150 公尺內（面狀類別 250 公尺）
  · 面狀類別官方 ↔ OSM：OSM 的 official_name、門牌跟官方相同，或拿掉「公有零售、攤販集中區、觀光」後互相包含 → 同一筆
    （列管夜市、攤販集中區清冊只寫路段，點位是路口，名稱相同放寬到 400 公尺）
  · 加油站官方 ↔ OSM 25 公尺內直接併（品牌、站名寫法太多種）；宮廟 30 公尺內名稱有兩個字相同就併
- 寺廟官方座標跟登記地址的門牌（精確對到）差 > 150 公尺 → 改用門牌座標（報告 coord_fixed 有逐筆清單）
  例外：OSM 上同名的點就在官方座標旁（80 公尺內）→ 官方座標是對的，不改（神岡崇璞園）
- 加油站用「近鄰門牌」定位、跟中油站點座標差 > 150 公尺 → 改用中油座標
- ⛔ 規劃中、興建中、已廢止的一律不收（名稱／備註出現這類字眼就排除並列入報告）
  公墓「已禁葬」只是不再收新葬，墓地還在，照收並保留在名稱裡
- ⛔ OSM 醫院、掩埋場改白名單制（2026-09-30）：對不到官方清冊的 OSM 點不收（舊院址、已封場的掩埋場會留在 OSM 上），
  確定存在、只是官方清冊還沒收的，寫進 OSM_ALLOW 人工放行；轉運站只收清潔隊、環保局經營的

用法
----------------------------------------------------------------
  python scripts/build-undesirable-facilities.py                   # 用快取的原始檔重算
  python scripts/build-undesirable-facilities.py --refresh         # 官方資料全部重抓
  python scripts/build-undesirable-facilities.py --refresh-osm     # 順便重跑 OSM（呼叫 fetch-undesirable-facilities.mjs）
  python scripts/build-undesirable-facilities.py --cache <資料夾>  # 快取資料夾（預設 <系統暫存>/teddy-uf-cache）
  python scripts/build-undesirable-facilities.py --dry-run         # 只出報告，不寫網站檔
OSM 中介檔找不到、Overpass 又被擋時，改用現有網站檔裡 s=osm（或沒有 s）的點。

輸出格式（向下相容 2026-08-28 版）
----------------------------------------------------------------
  source      字串（舊欄位，保留）
  area        "臺中市"
  fetchedAt   "YYYY-MM-DD"（本次建置日）
  builtAt     "YYYY-MM-DDTHH:MM:SS+08:00"（新）
  count       筆數
  categories  {代號: {label, why}}（代號跟舊版一樣，landfill/waste 同一個 label）
  byCategory  {label: 筆數}
  sources     [{id, name, org, url, version, license, licenseUrl?, geo?, count}]（新；count = 網站檔裡掛這個來源的筆數）
  items       [{k 類別代號, n 名稱, y 緯度, x 經度（5 位小數）, s 來源代號}]
"""
import argparse
import collections
import datetime as dt
import glob
import gzip
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_JSON = os.path.join(REPO, "public", "data", "undesirable-facilities.json")
ADDR_DIR = os.path.join(REPO, "public", "data", "tc-addr")
FETCH_OSM = os.path.join(HERE, "fetch-undesirable-facilities.mjs")
DEFAULT_CACHE = os.path.join(tempfile.gettempdir(), "teddy-uf-cache")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
TZ8 = dt.timezone(dt.timedelta(hours=8))

# ---------------------------------------------------------------- 類別（代號跟舊版一致，頁面依 label 分組）
CATEGORIES = {
    # why：頁面欄名是「買方常見的考量」→ 只寫買方在意什麼，不下「會影響房價／轉手」這種沒有出處的判斷
    "fuel": {"label": "加油站", "why": "油氣味、進出車流"},
    "temple": {"label": "宮廟", "why": "誦經、鞭炮，法會期間人車多"},
    "cemetery": {"label": "公墓・墓地", "why": "心理上的顧忌"},
    "funeral": {"label": "殯葬設施", "why": "心理上的顧忌；出殯、法會時段人車多"},
    "substation": {"label": "變電所", "why": "外觀、電磁波"},
    "tower": {"label": "高壓電塔", "why": "外觀、電磁波"},
    "mast": {"label": "基地台・通訊塔", "why": "電磁波"},
    "hospital": {"label": "醫院", "why": "救護車鳴笛、夜間車流"},
    "market": {"label": "市場・夜市", "why": "油煙、噪音、垃圾與停車"},
    "prison": {"label": "矯正機關", "why": "心理上的顧忌"},
    "landfill": {"label": "掩埋場・轉運站", "why": "異味、垃圾車進出"},
    "waste": {"label": "掩埋場・轉運站", "why": "異味、垃圾車進出"},
}
LABEL_OF = {k: v["label"] for k, v in CATEGORIES.items()}

# ---------------------------------------------------------------- 來源（順序＝合併優先序：前面的贏）
GOV_LIC = "政府資料開放授權條款-第1版"
SOURCES = [
    {"id": "tc-mort", "name": "殯葬設施地圖", "org": "臺中市生命禮儀管理處",
     "url": "https://mortuary.taichung.gov.tw/Frontend/Maps.aspx", "license": "政府網站資料開放宣告",
     "licenseUrl": "https://mortuary.taichung.gov.tw/Frontend/ContentView.aspx?id=3095",  # 該站頁尾〈政府網站資料開放宣告〉
     "geo": "機關公布的座標", "versionKind": "fetched"},
    {"id": "moi-f", "name": "殯葬設施", "org": "內政部", "url": "https://data.gov.tw/dataset/7052",
     "license": GOV_LIC, "meta": 7052, "geo": "機關清冊只有地址，以臺中市門牌（115年1月）定位"},
    {"id": "moi-t", "name": "全國宗教資訊系統資料－寺廟", "org": "內政部", "url": "https://data.gov.tw/dataset/8203",
     "license": GOV_LIC, "meta": 8203, "geo": "機關公布的座標；缺座標或座標明顯偏離地址的，改用臺中市門牌（115年1月）定位"},
    {"id": "ea-gas", "name": "加油站位置", "org": "經濟部能源署",
     "url": "https://www2.moeaea.gov.tw/b0102/Dealer/GasStations", "license": "政府網站資料開放宣告",
     "licenseUrl": "https://www2.moeaea.gov.tw/b0102/opendataannouncement",
     "geo": "機關清冊只有地址，以臺中市門牌（115年1月）定位；定不到或只對到附近門牌的，用台灣中油公開的站點座標",
     "geoRef": {"text": "台灣中油〈加油站服務資訊〉", "url": "https://data.gov.tw/dataset/6065"}, "versionKind": "content"},
    {"id": "tc-mkt", "name": "臺中市公有零售市場地址及聯絡電話", "org": "臺中市政府經濟發展局",
     "url": "https://data.gov.tw/dataset/85003", "license": GOV_LIC, "meta": 85003,
     "geo": "以臺中市門牌（115年1月）定位"},
    {"id": "tc-wh", "name": "臺中市批發市場地址及聯絡電話", "org": "臺中市政府農業局",  # data.gov.tw 目錄的提供機關（不是經發局）
     "url": "https://data.gov.tw/dataset/127820", "license": GOV_LIC, "meta": 127820,
     "geo": "以臺中市門牌（115年1月）定位"},
    {"id": "tc-nm", "name": "臺中市列管夜市", "org": "臺中市政府經濟發展局",
     "url": "https://data.gov.tw/dataset/85028", "license": GOV_LIC, "meta": 85028,
     "geo": "清冊只寫路段，以兩條路門牌最接近處（路口）定位"},
    {"id": "tc-vz", "name": "臺中市七處籌設列管攤販集中區", "short": "攤販集中區清冊", "org": "臺中市政府經濟發展局",
     "url": "https://data.gov.tw/dataset/83855", "license": GOV_LIC, "meta": 83855,
     "geo": "清冊只寫路段，以路口或巷弄門牌定位"},  # note（清冊原名的說明）在 main() 依實際筆數產生
    {"id": "tc-hosp", "name": "臺中市醫院", "org": "臺中市政府衛生局",
     "url": "https://data.gov.tw/dataset/176960", "license": GOV_LIC, "meta": 176960,
     "geo": "以臺中市門牌（115年1月）定位"},
    {"id": "tc-lf", "name": "臺中市衛生掩埋場及地下水監測井資料", "org": "臺中市政府環境保護局",
     "url": "https://data.gov.tw/dataset/83993", "license": GOV_LIC, "meta": 83993,
     "geo": "地址精確的以臺中市門牌定位；地址是地號或「XX號旁」的，用上下游監測井座標的中點"},
    {"id": "osm", "name": "OpenStreetMap", "org": "OpenStreetMap 貢獻者", "url": "https://www.openstreetmap.org/copyright",
     "license": "開放資料庫授權條款（ODbL）", "licenseUrl": "https://opendatacommons.org/licenses/odbl/", "versionKind": "osm"},
]
PRIO = {s["id"]: i for i, s in enumerate(SOURCES)}

# 原始檔：檔名 → 下載方式
TC_DL = "https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid="
RAW_FILES = {
    "temple.xml": ("GET", "https://religion.moi.gov.tw/Report/temple.xml"),
    "moi_funeral_a.csv": ("GET", "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/"
                                 "CFF7163A-8C96-417E-B93D-156461404881/resource/0B675274-AA5F-4163-8C9A-16604BC53A2E/download"),
    "mort_funeralhomes.json": ("GET", "https://mortuary.taichung.gov.tw/api/getFuneralHomes"),
    "mort_towers.json": ("GET", "https://mortuary.taichung.gov.tw/api/getTowers"),
    "mort_tombs.json": ("GET", "https://mortuary.taichung.gov.tw/api/getTombs"),
    "mort_treeburials.json": ("GET", "https://mortuary.taichung.gov.tw/api/getTreeBurials"),
    "moeaea_gas_all.json": ("POST", "https://www2.moeaea.gov.tw/b0102/Dealer/GasStations/load"),
    "cpc_stations.json": ("GET", "https://vipmbr.cpc.com.tw/openData/getStationInfo"),
    "tc_market_public.csv": ("GET", TC_DL + "362d3a33-33e0-47ff-823e-71e364e18ec5"),
    "tc_wholesale.csv": ("GET", TC_DL + "82f7b607-df70-4b6b-b74e-7d675bd3c85d"),
    "tc_nightmarket.csv": ("GET", TC_DL + "ee92dc91-2834-4d46-92c4-5033e77cb9df"),
    "tc_vendor_zone.csv": ("GET", TC_DL + "e70331a7-72c6-4155-83e5-f11fdc89d1b4"),
    "tc_hospital.csv": ("GET", TC_DL + "3a1383e6-4fff-4b2b-8da0-e4adc69a8181"),
    "tc_landfill.csv": ("GET", TC_DL + "eefd0a77-73e5-4a45-9f7a-5a0e05087d9f"),
}

# ⛔ 規劃中／興建中／已廢止：名稱或備註出現就排除（CLAUDE.md：未完工的設施不收）
INACTIVE_RE = re.compile(r"規劃|籌建|興建|預定|施工中|廢止|廢除|已遷|遷移完成|已拆|拆除|停業|歇業|解散|撤銷|裁撤")
# OSM 名稱另外再擋：「變電所用地」（重劃區分區）、「開關場(土石流淹沒)」、「XX舊址」
OSM_INACTIVE_RE = re.compile(INACTIVE_RE.pattern + r"|用地|淹沒|舊址|原址|廢棄")

# OSM 醫院、掩埋場：白名單制（對不到官方清冊的不收）。確定現存、官方清冊還沒收的在這裡人工放行
OSM_ALLOW = {
    "hospital": re.compile(r"^臺中市立老人復健綜合醫院$"),  # 2025-09 開始營運，衛生局 1150107 版醫院清冊還沒收
    "landfill": None,  # 環保局清冊明寫只有 4 座使用中掩埋場（后里、大里、南屯文山、霧峰）；OSM 其他的是已封場或非正式
}
# 轉運站只收公部門經營的（民間資源回收業者、服務區垃圾儲存場不算）
OSM_WASTE_OK = re.compile(r"清潔隊|環境保護局|環保局")
# 查核確認不是現有設施的 OSM 點（規則已經會擋，這裡留逐筆理由當紀錄）
OSM_EXCLUDE = {
    "w647776276": "「變電所用地」是臺中港市鎮中心市地重劃區的土地使用分區，台電二次變電所清單梧棲只有港工、中沙、關連，都在 2 公里外",
    "n3049890935": "霧峰澄清醫院舊院址（霧峰中正路 1129 號）；衛生局清冊登記的是大里區成功路 55 號",
    "w1314281722": "神岡溪洲掩埋場已封閉復育，不在環保局 4 座使用中掩埋場名單",
}

DISTS = ["中區", "東區", "南區", "西區", "北區", "西屯區", "南屯區", "北屯區", "豐原區", "東勢區", "大甲區", "清水區",
         "沙鹿區", "梧棲區", "后里區", "神岡區", "潭子區", "大雅區", "新社區", "石岡區", "外埔區", "大安區", "烏日區",
         "大肚區", "龍井區", "霧峰區", "太平區", "大里區", "和平區"]
DIST_FIX = {"譚子區": "潭子區"}


# ================================================================ 小工具
FW = {ord(c): ord(c) - 0xFEE0 for c in "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－"}
CN_DIGIT = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CN_NUM_RE = re.compile(r"^[零〇一二兩三四五六七八九十百千]+$")


def half(s):
    return (s or "").translate(FW).replace("　", "").replace(" ", "").replace(" ", "").strip()


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


def int2cn(n):
    d = "零一二三四五六七八九"
    if n < 10:
        return d[n]
    if n < 20:
        return "十" + (d[n - 10] if n > 10 else "")
    return d[n // 10] + "十" + (d[n % 10] if n % 10 else "")


# ⚠ 跟 scripts/build-tc-addr.py 的 norm_road / norm_seg 同一套規則（門牌庫的 key 是這樣產的）
def norm_road(s):
    s = half(s).replace("ㄧ", "一").replace("台", "臺")
    s = re.sub(r"[()（）]", "", s)
    s = re.sub(r"(\d+)段$", lambda m: int2cn(int(m.group(1))) + "段", s)
    return s


def norm_seg(t, suffix):
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


def in_tc_bbox(lat, lng):
    return 23.95 <= lat <= 24.46 and 120.45 <= lng <= 121.46


def read_text(path):
    b = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp950", "big5hkscs"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode("utf-8", errors="replace")


def read_csv(path, delimiter=","):
    import csv
    import io
    txt = read_text(path).lstrip("﻿")
    rows = list(csv.DictReader(io.StringIO(txt), delimiter=delimiter))
    return [{(k or "").strip().lstrip("﻿"): (v or "").strip() for k, v in r.items()} for r in rows]


# ================================================================ 下載（--refresh 才重抓）
def fetch_raw(raw_dir, refresh):
    import requests
    os.makedirs(raw_dir, exist_ok=True)
    log_path = os.path.join(raw_dir, "_fetched.json")
    try:
        log = json.load(open(log_path, encoding="utf-8"))
    except Exception:
        log = {}
    for name, (method, url) in RAW_FILES.items():
        p = os.path.join(raw_dir, name)
        if os.path.exists(p) and os.path.getsize(p) > 0 and not refresh:
            continue
        time.sleep(1.0)
        try:
            if method == "POST":
                r = requests.post(url, data={"city": "all"}, headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"}, timeout=120)
            else:
                r = requests.get(url, headers={"User-Agent": UA}, timeout=180)
        except Exception as e:  # 網路失敗：有舊檔就沿用
            print(f"  [下載] {name} 失敗：{e}" + ("（沿用舊檔）" if os.path.exists(p) else ""))
            continue
        ok = r.status_code == 200 and len(r.content) > 100
        if ok and name.endswith(".json"):
            try:
                json.loads(r.content.decode("utf-8-sig"))
            except Exception:
                ok = False
        if not ok:
            print(f"  [下載] {name} HTTP {r.status_code} / {len(r.content)} bytes，" + ("沿用舊檔" if os.path.exists(p) else "⚠ 沒有舊檔"))
            continue
        open(p, "wb").write(r.content)
        log[name] = {"url": (method + " " if method == "POST" else "") + url, "at": time.strftime("%Y-%m-%d %H:%M")}
        print(f"  [下載] {name} {len(r.content):,} bytes")
    # data.gov.tw 詮釋資料（取「最後更新」當版本）
    for s in SOURCES:
        if not s.get("meta"):
            continue
        name = f"meta_{s['meta']}.json"
        p = os.path.join(raw_dir, name)
        if os.path.exists(p) and not refresh:
            continue
        try:
            time.sleep(0.8)
            r = requests.get(f"https://data.gov.tw/api/v2/rest/dataset/{s['meta']}", headers={"User-Agent": UA}, timeout=60)
            if r.status_code == 200:
                open(p, "wb").write(r.content)
                log[name] = {"url": f"https://data.gov.tw/api/v2/rest/dataset/{s['meta']}", "at": time.strftime("%Y-%m-%d %H:%M")}
        except Exception as e:
            print(f"  [下載] {name} 失敗：{e}")
    json.dump(log, open(log_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return log


# ================================================================ 門牌庫（public/data/tc-addr，唯讀）
class Geocoder:
    def __init__(self, addr_dir):
        t0 = time.time()
        ix = json.load(open(os.path.join(addr_dir, "index.json"), encoding="utf-8"))
        self.ver = ix.get("ver")
        o_lat, o_lng, scale = ix["o"]
        dnames = [n for _, n in ix["d"]]
        self.alias = ix.get("a", {})
        self.villages = {dnames[i]: sorted(set(ix["li"][i]), key=len, reverse=True) for i in range(len(dnames))}
        # (dist, road) -> {gkey: {no: (lat, lng)}}
        self.roads = collections.defaultdict(dict)
        self.road_keys = collections.defaultdict(set)   # dist -> {road key}
        self.grid = collections.defaultdict(list)       # 最近門牌（行政區檢查用）
        n = 0
        for fn in sorted(glob.glob(os.path.join(addr_dir, "s", "*.json"))):
            sh = json.load(open(fn, encoding="utf-8"))
            dist = dnames[sh["d"]]
            for rkey, ro in sh["r"].items():
                self.road_keys[dist].add(rkey)
                groups = self.roads[(dist, rkey)]
                for gkey, gs in ro["g"].items():
                    lat = lng = None
                    g = groups.setdefault(gkey, {})
                    for part in gs.split(";"):
                        no, _li, _lin, f_la, f_ln = part.split(",")
                        if lat is None:
                            lat, lng = int(f_la), int(f_ln)
                        else:
                            lat += int(f_la)
                            lng += int(f_ln)
                        y, x = lat / scale + o_lat, lng / scale + o_lng
                        g[no] = (y, x)
                        self.grid[(int(y * 200), int(x * 200))].append((y, x, dist))
                        n += 1
        self.sorted_keys = {d: sorted(ks, key=len, reverse=True) for d, ks in self.road_keys.items()}
        self.n = n
        print(f"  門牌庫 {self.ver}：{n:,} 個門牌，{time.time() - t0:.1f}s")

    # ---- 最近門牌所在行政區（檢查座標有沒有落在地址寫的區）
    def nearest_dist(self, lat, lng, max_m=1500):
        best, bd = None, max_m
        cy, cx = int(lat * 200), int(lng * 200)
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                for (y, x, d) in self.grid.get((cy + dy, cx + dx), ()):
                    m = haversine(lat, lng, y, x)
                    if m < bd:
                        best, bd = d, m
        return best, bd

    # ---- 地址字串 → 區、路、巷弄、號
    def parse(self, addr, dist_hint=None):
        s = half(addr).replace("ㄧ", "一").replace("台", "臺")
        s = re.sub(r"[（(][^）)]*[）)]", "", s)
        dist = None
        for _ in range(3):
            s0 = s
            s = re.sub(r"^\d{3,6}", "", s)
            s = re.sub(r"^(臺中市|臺中縣)", "", s)
            for bad, good in DIST_FIX.items():
                if s.startswith(bad):
                    s = good + s[len(bad):]
            for d in DISTS:
                if s.startswith(d):
                    dist, s = d, s[len(d):]
                    break
            else:
                m = re.match(r"^(\S{2})[鎮鄉市](?!場|民|政|區)", s)
                if m and m.group(1) + "區" in DISTS:
                    dist, s = m.group(1) + "區", s[3:]
            if s == s0:
                break
        dist = dist or (DIST_FIX.get(dist_hint, dist_hint) if dist_hint else None)
        s = re.sub(r"(?<![\d巷弄號-])(\d{1,2})段", lambda m: int2cn(int(m.group(1))) + "段", s)
        s = re.sub(r"(?<=[一-鿿])(\d{1,2})(路|街)", lambda m: int2cn(int(m.group(1))) + m.group(2), s)  # 崇德7路 → 崇德七路、大墩11街 → 大墩十一街
        s = re.sub(r"(?<=[段路街巷弄])([零一二三四五六七八九十百]+)號", lambda m: str(cn2int(m.group(1))) + "號", s)  # 三十五號 → 35號
        s = re.sub(r"(\d+)(?:[、,，]\d+)+號", r"\1號", s)  # 480、482號 → 480號
        return dist, s

    def _match_road(self, dist, s):
        """回傳 (road_key, 剩下的字串)；先試去掉「XX里／XX村／N鄰」的版本"""
        cands = [s]
        for v in self.villages.get(dist, []):
            if s.startswith(v):
                cands.insert(0, s[len(v):])
                break
        m = re.match(r"^[^\d路街道巷弄段號]{1,4}?[村里](\d+鄰)?", s)
        if m:
            cands.append(s[m.end():])
        cands = [re.sub(r"^\d+鄰", "", c) for c in cands]
        for c in cands:
            for k in self.sorted_keys.get(dist, []):
                if c.startswith(k):
                    return k, c[len(k):]
            for a, k in self.alias.items():
                if c.startswith(a) and k in self.road_keys.get(dist, ()):
                    return k, c[len(a):]
        return None, None

    def geocode(self, addr, dist_hint=None):
        """回傳 (lat, lng, 方法) 或 (None, None, 原因)"""
        dist, s = self.parse(addr, dist_hint)
        if not dist:
            return None, None, "no-dist"
        if "與" in s or "口" in s and not re.search(r"\d+號", s):
            r = self.xroad_text(s, dist)
            if r:
                return r
        road, rest = self._match_road(dist, s)
        if not road:
            return self._geocode_no_seg(dist, s)
        rest = re.sub(r"^(\d+)路$", r"\1號", rest)  # 「中正路115路」→ 115號（原始資料筆誤）
        groups = self.roads[(dist, road)]
        m = re.match(r"^(?:(?P<lane>[^巷弄號]+?)巷)?(?:(?P<alley>[^巷弄號]+?)弄)?(?P<no>\d+(?:[-之]\d+)*)號(?:之(?P<sub>\d+))?", rest)
        if m:
            gkey = norm_seg(m.group("lane") or "", "巷") + norm_seg(m.group("alley") or "", "弄")
            no = m.group("no").replace("之", "-") + ("-" + m.group("sub") if m.group("sub") else "")
            g = groups.get(gkey)
            if g:
                if no in g:
                    return g[no][0], g[no][1], "exact"
                base = no.split("-")[0]
                if base in g:
                    return g[base][0], g[base][1], "base"
                want = int(base)
                best = None
                for k, (y, x) in g.items():
                    mm = re.match(r"^(\d+)$", k)
                    if not mm:
                        continue
                    d = abs(int(mm.group(1)) - want)
                    score = (d, (int(mm.group(1)) - want) % 2)
                    if d <= 8 and (best is None or score < best[0]):
                        best = (score, y, x)
                if best:
                    return best[1], best[2], "near"
            return None, None, "no-number"
        m = re.match(r"^(?:(?P<lane>[^巷弄號\d]*\d*[^巷弄號]*?)巷)(?:(?P<alley>[^巷弄號]+?)弄)?", rest)
        if m:
            gkey = norm_seg(m.group("lane") or "", "巷") + norm_seg(m.group("alley") or "", "弄")
            pts = list(groups.get(gkey, {}).values())
            if not pts and m.group("alley"):
                gk2 = norm_seg(m.group("lane"), "巷")
                pts = [p for k, g in groups.items() if k.startswith(gk2) for p in g.values()]
            elif not m.group("alley"):
                pts = [p for k, g in groups.items() if k == gkey or k.startswith(gkey) for p in g.values()]
            if pts:
                cy = sum(p[0] for p in pts) / len(pts)
                cx = sum(p[1] for p in pts) / len(pts)
                spread = max(haversine(cy, cx, p[0], p[1]) for p in pts)
                if spread <= 400:
                    return cy, cx, "lane"
                return None, None, "lane-too-long"
        return None, None, "road-only"

    def _geocode_no_seg(self, dist, s):
        """地址的路名沒寫段（烏日區中山路539號，實際是中山路X段）：各段裡只有一段有這個門牌才採用"""
        m = re.match(r"^(.+?(?:路|街|大道))((?:[^巷弄號]+?巷)?(?:[^巷弄號]+?弄)?\d+(?:[-之]\d+)*號)", s)
        if not m:
            return None, None, "no-road"
        base, tail = m.group(1), m.group(2)
        fam = [k for k in self.road_keys.get(dist, ()) if k.startswith(base) and re.fullmatch(r"[一二三四五六七八九十]+段", k[len(base):])]
        hits = []
        for k in fam:
            y, x, how = self.geocode(k + tail, dist)
            if y is not None and how in ("exact", "base"):
                hits.append((y, x))
        if len(hits) == 1:
            return hits[0][0], hits[0][1], "noseg"
        return None, None, "no-road" if not fam else "noseg-ambiguous"

    # ---- 路口：兩條路（或路段）的門牌最接近處
    ROAD_TOKEN = re.compile(r"[一-鿿]{1,6}?(?:大道|路|街)(?:[一二三四五六七八九十]+段)?")

    def _road_family(self, dist, token):
        tk = norm_road(token)
        ks = self.road_keys.get(dist, set())
        if tk in ks:
            return [tk]
        return [k for k in ks if k.startswith(tk) and re.fullmatch(r"[一二三四五六七八九十]+段", k[len(tk):])]

    def xroad(self, dist, a, b, max_m=150):
        ka, kb = self._road_family(dist, a), self._road_family(dist, b)
        if not ka or not kb or set(ka) == set(kb):
            return None
        pa = [p for k in ka for g in self.roads[(dist, k)].values() for p in g.values()]
        pb = [p for k in kb for g in self.roads[(dist, k)].values() for p in g.values()]
        grid = collections.defaultdict(list)
        for p in pb:
            grid[(int(p[0] * 500), int(p[1] * 500))].append(p)
        best = None
        for p in pa:
            cy, cx = int(p[0] * 500), int(p[1] * 500)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for q in grid.get((cy + dy, cx + dx), ()):
                        d = haversine(p[0], p[1], q[0], q[1])
                        if best is None or d < best[0]:
                            best = (d, p, q)
        if best and best[0] <= max_m:
            return (best[1][0] + best[2][0]) / 2, (best[1][1] + best[2][1]) / 2, "xroad"
        return None

    def xroad_text(self, text, dist=None):
        t = re.sub(r"(\d+)段", lambda m: int2cn(int(m.group(1))) + "段", half(text).replace("台", "臺"))
        toks = []
        for m in self.ROAD_TOKEN.finditer(re.sub(r"[（()）、,，及與至]", "|", t)):
            tok = m.group(0).split("|")[-1]
            tok = re.sub(r"^(臺中市)?(" + "|".join(DISTS) + ")", "", tok)
            if tok and tok not in toks:
                toks.append(tok)
        dists = [dist] if dist else DISTS
        best = None
        for i in range(len(toks)):
            for j in range(i + 1, len(toks)):
                for d in dists:
                    r = self.xroad(d, toks[i], toks[j])
                    if r:
                        return r
        return best


# ================================================================ 名稱比對
GENERIC = re.compile(r"臺中市|台中市|臺中縣|財團法人|私立|公立|市立|附設|生命禮儀管理處|加油站|加油|站$|台灣中油|臺灣中油|中油|台塑石化|台塑|股份有限公司|有限公司|公司")


def name_key(n, cat=None):
    s = half(n).replace("台", "臺")
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    s = re.sub(r"^(臺中市)?(" + "|".join(DISTS) + ")", "", s)
    s = GENERIC.sub("", s)
    s = re.sub(r"第([零〇一二兩三四五六七八九十百]+)", lambda m: "第" + str(cn2int(m.group(1)) or m.group(1)), s)
    s = re.sub(r"[\s\-─－_．·・,，、。:：'\"「」『』]", "", s)
    return s


TEMPLE_SUFFIX = re.compile(r"[宮廟寺殿堂壇祠院觀巖岩庵亭府閣]$")
AREA_CATS = {"cemetery", "funeral", "market", "hospital", "landfill", "waste", "prison"}
# 到處都有的土地公廟、萬善祠：同名不代表同一間，不用「同名 150 公尺」規則
GENERIC_TEMPLE = re.compile(r"^(?:\S{0,3}(?:福德|土地|伯公|萬善|萬應|有應|百姓|大眾爺|聖公|姑娘)\S{0,2}|福德正神)$")


# 加油站的品牌字（OSM 常只標品牌：「台塑石油」「速邁樂」「CPC」）→ 拿掉後沒字就當沒名字
FUEL_BRAND = re.compile(r"(?i)[台臺]灣中油|中國石油|中油|cpc|[台臺]塑石油|[台臺]塑石化|[台臺]塑|[台臺]亞石油|[台臺]亞|速邁樂|統一精工|統一速邁|統一|"
                        r"全國|山隆|sanlong|福懋|西歐|[台臺]大|優力|直營|加盟|含自助|自助|石油|加油站|加油|站|no|dingdian|[_\s]")


def merge_key(r):
    if not r["named"]:
        return ""
    k = name_key(r["n"])
    if r["k"] == "temple" and len(k) >= 3:
        k = TEMPLE_SUFFIX.sub("", k)
    if r["k"] == "fuel":
        k = FUEL_BRAND.sub("", half(r["n"])).replace("台", "臺")
        k = re.sub(r"^(臺中市)?(" + "|".join(DISTS) + ")", "", k)
    # 標點括號全拿掉；拿完沒字就當沒名字（「中油加油站（直營）」→ 品牌字拿掉只剩「（）」）
    return re.sub(r"[\W_]+", "", k)


# 面狀類別（市場、夜市、醫院）官方 ↔ OSM 比對用：再拿掉機關清冊常加、OSM 常省略的字
AREA_STRIP = re.compile(r"醫療社團法人|醫療財團法人|社團法人|財團法人|攤販集中區|公有零售|公有|零售|觀光|附設|附屬|民眾診療服務處")


def area_key(n):
    s = name_key(n)
    s = AREA_STRIP.sub("", s).replace("市集", "市場")
    return re.sub(r"[\W_]+", "", s)


def addr_key(a):
    """門牌比對用：只留「路段巷弄＋號」（拿掉郵遞區號、市、區、樓層）"""
    if not a:
        return ""
    s = half(a).replace("台", "臺")
    s = re.sub(r"^\d{3,6}", "", s)
    s = re.sub(r"^(臺中市)?(" + "|".join(DISTS) + ")?", "", s)
    m = re.search(r"^(.*?\d+(?:[-之]\d+)?號)", s)
    return re.sub(r"\s", "", m.group(1)) if m else ""


def bigrams(s):
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else {s}


def name_sim(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if len(a) >= 2 and len(b) >= 2 and (a in b or b in a):
        return 0.9
    ba, bb = bigrams(a), bigrams(b)
    return 2 * len(ba & bb) / (len(ba) + len(bb))


# ================================================================ 各來源 → 統一格式
def rec(k, n, y, x, s, named=True, **kw):
    r = {"k": k, "n": n, "y": y, "x": x, "s": s, "named": named}
    r.update(kw)
    return r


def load_temples(raw, geo, report, osm=()):
    out = []
    # OSM 上的宮廟（第三方驗證：官方座標旁邊就有同名的 OSM 點 → 官方座標是對的）
    osm_by_key = collections.defaultdict(list)
    for o in osm:
        if o["k"] == "temple" and o["named"]:
            osm_by_key[merge_key(o)].append(o)
    root = ET.parse(os.path.join(raw, "temple.xml")).getroot()
    for e in root:
        r = {c.tag: (c.text or "").strip() for c in e}
        if r.get("行政區") not in ("臺中市", "台中市"):
            continue
        name, addr = r.get("寺廟名稱", ""), r.get("地址", "")
        if INACTIVE_RE.search(name + r.get("其他", "")):
            report["excluded"].append({"s": "moi-t", "n": name, "addr": addr, "why": "名稱／備註有規劃、廢止類字眼"})
            continue
        gy, gx, gm = geo.geocode(addr)
        try:
            y, x = float(r.get("WGS84Y") or "nan"), float(r.get("WGS84X") or "nan")
        except ValueError:
            y = x = float("nan")
        method = "official"
        if not (in_tc_bbox(y, x) if y == y else False):
            if gy is None:
                report["unresolved"].append({"s": "moi-t", "k": "temple", "n": name, "addr": addr,
                                             "why": "官方沒座標（或座標不在臺中），門牌也定不到（" + gm + "）"})
                continue
            y, x, method = gy, gx, "geocode-" + gm
        elif gy is not None and gm in ("exact", "base"):
            d = haversine(y, x, gy, gx)
            report["temple_offset"].append(d)
            if d > 150:
                # 官方座標離登記地址的門牌超過 150 公尺（頁面最小查詢範圍 300 公尺，誤差不能再大）：門牌定位精確到門，改用門牌。
                # 地址寫「對面／旁／邊」也一樣 150 公尺（就在那個門牌附近，不會差到幾百公尺）。
                # 例外：OSM 上同名的點就在官方座標 80 公尺內 → 第三方確認官方座標是對的，不改（神岡崇璞園：OSM 離官方 47 公尺、離門牌 410 公尺）
                key = merge_key({"k": "temple", "n": name, "named": True})
                ok = [o for o in osm_by_key.get(key, ()) if haversine(y, x, o["y"], o["x"]) < 80] \
                    if key and len(key) >= 2 and not GENERIC_TEMPLE.search(key) else []
                if ok:
                    report["coord_kept"].append({"s": "moi-t", "n": name, "addr": addr, "off_m": round(d), "osm": ok[0].get("oid"),
                                                 "osm_to_official_m": round(haversine(y, x, ok[0]["y"], ok[0]["x"]))})
                else:
                    report["coord_fixed"].append({"s": "moi-t", "n": name, "addr": addr, "off_m": round(d),
                                                  "from": [round(y, 5), round(x, 5)], "to": [round(gy, 5), round(gx, 5)]})
                    y, x, method = gy, gx, "geocode-" + gm
        out.append(rec("temple", name, y, x, "moi-t", addr=addr, how=method))
    return out


MORT_FILES = [("mort_funeralhomes.json", "funeral", "hall"), ("mort_towers.json", "funeral", "tower"),
              ("mort_tombs.json", "cemetery", "tomb"), ("mort_treeburials.json", "cemetery", "tomb")]


def load_mortuary(raw, geo, report):
    out = []
    for fn, k, kind in MORT_FILES:
        for f in json.load(open(os.path.join(raw, fn), encoding="utf-8-sig")):
            p = f.get("properties", {})
            lng, lat = f["geometry"]["coordinates"][:2]
            name = half(p.get("Name", "")).replace("\n", "")
            addr = half(p.get("Address", "")).replace("\n", "")
            area = p.get("Area", "")
            if INACTIVE_RE.search(name):
                report["excluded"].append({"s": "tc-mort", "n": name, "addr": addr, "why": "名稱有規劃、廢止類字眼"})
                continue
            # 停車場不是設施本體：「崇德殯儀館(五義停車場)」→ 名稱拿掉括號、座標改用地址門牌
            how = "official"
            if re.search(r"[（(][^）)]*停車場[）)]", name):
                name = re.sub(r"[（(][^）)]*停車場[）)]", "", name)
                gy, gx, gm = geo.geocode(addr, area)
                if gy is not None:
                    report["coord_fixed"].append({"s": "tc-mort", "n": name, "addr": addr, "off_m": round(haversine(lat, lng, gy, gx)),
                                                  "from": [round(lat, 5), round(lng, 5)], "to": [round(gy, 5), round(gx, 5)],
                                                  "why": "官方點位是停車場，改用設施地址"})
                    lat, lng, how = gy, gx, "geocode-" + gm
            if area and re.match(r"^(第|示範)", name):
                name = area + name  # 「第7公墓」「示範公墓」每區都有，加區名才分得出來
            name = name.replace("(", "（").replace(")", "）")
            out.append(rec(k, name, lat, lng, "tc-mort", addr=addr, dist=area, how=how, mid=p.get("ID"), kind=kind,
                           fkey=funeral_key(p.get("Name", ""))))
    return out


FUNERAL_NOTE = re.compile(r"[（(](?:已禁葬|部分禁葬|公墓已禁葬|休葬[^）)]*|僅限[^）)]*|[^）)]*樓[^）)]*|[^）)]*F)[）)]")


def funeral_key(name):
    """內政部清冊 ↔ 生命禮儀管理處地圖 對名字用：(編號, 名稱核心)。括號裡的堂名保留（懷賢堂／懷德堂要分得開）"""
    s = half(name).replace("台", "臺")
    s = FUNERAL_NOTE.sub("", s)
    s = re.sub(r"^(臺中市)?(" + "|".join(DISTS) + ")", "", s)
    s = re.sub(r"臺中市|生命禮儀管理處|私立|公立|區立", "", s)
    s = re.sub(r"^(" + "|".join(DISTS) + ")", "", s)
    s = re.sub(r"第([零〇一二兩三四五六七八九十百]+)", lambda m: "第" + str(cn2int(m.group(1)) or m.group(1)), s)
    s = re.sub(r"(?<=[\d、])([零〇一二兩三四五六七八九十]+)(?=公墓)", lambda m: str(cn2int(m.group(1)) or m.group(1)), s)
    m = re.search(r"第(\d+(?:[、,，及和]\d+)*)", s)
    nums = frozenset(re.findall(r"\d+", m.group(1))) if m else frozenset()
    s = re.sub(r"[\s\-─－_．·・,，、。:：()（）]", "", s)
    return nums, s


def load_moi_funeral(raw, geo, mort, report):
    out = []
    rows = read_csv(os.path.join(raw, "moi_funeral_a.csv"), delimiter="\t")
    by_dist = collections.defaultdict(list)
    for m in mort:
        by_dist[m.get("dist")].append(m)
    KIND = {"公墓": "tomb", "殯儀館": "hall", "火化場": "hall"}
    for r in rows:
        if r.get("管轄所屬縣市") not in ("臺中市", "台中市"):
            continue
        name, addr, typ = r.get("名稱", ""), r.get("地址", ""), r.get("類別", "")
        if INACTIVE_RE.search(name):
            report["excluded"].append({"s": "moi-f", "n": name, "addr": addr, "why": "名稱有規劃、廢止類字眼"})
            continue
        k = "cemetery" if typ == "公墓" else "funeral"
        kind = KIND.get(typ, "tower")
        dist, _ = geo.parse(addr)
        if not dist:
            m = re.search("|".join(DISTS), name)
            dist = m.group(0) if m else None
        # 1) 先對生命禮儀管理處地圖（同區、同類型；編號相同，或名稱核心相近）
        num, core = funeral_key(name)
        cands = [m for m in by_dist.get(dist, []) if m["kind"] == kind]
        hit = None
        same_num = [m for m in cands if num and (num & m["fkey"][0])]
        if same_num:  # 同編號的可能不只一處（后里「第1公墓」「第一示範公墓」）→ 取名稱最像的
            hit = max(same_num, key=lambda m: name_sim(core, m["fkey"][1]))
        else:
            scored = sorted(((name_sim(core, m["fkey"][1]), m) for m in cands), key=lambda t: -t[0])
            if scored and scored[0][0] >= 0.7:
                hit = scored[0][1]
        if hit is None:
            # 園區裡的單棟：「第一花園公墓-榮美殿」↔「南屯一花榮美殿」，用 - 後面或括號裡的堂名對
            subs = [t for t in re.split(r"[-─－（）()、]", half(name)) if re.search(r"[堂殿塔座館祠園]$", t) and 2 <= len(t) <= 6]
            hit = next((m for m in cands for t in subs if t in m["n"]), None)
        if hit is None and kind == "hall" and cands:
            hit = cands[0]  # 殯儀館／火化場：同區只有一處（大甲、東海、崇德、東勢）
        if hit is not None:
            report["moi_f_matched"].append({"moi": name, "mort": hit["n"]})
            continue
        # 2) 門牌定位
        gy, gx, gm = geo.geocode(addr, dist)
        if gy is None:
            u = {"s": "moi-f", "k": k, "n": name, "addr": addr, "why": f"地址對不到門牌（{gm}）"}
            near = sorted(((name_sim(core, m["fkey"][1]), m["n"]) for m in by_dist.get(dist, [])), key=lambda t: -t[0])
            if near and near[0][0] >= 0.3:
                u["likely_in"] = f"tc-mort：{near[0][1]}"
            report["unresolved"].append(u)
            continue
        # 3) 定位後 300 公尺內已有地圖上同類的設施（同一個園區的另一棟，例「第一花園公墓-中台福座」）→ 併進地圖那一筆
        near = [m for m in by_dist.get(dist, []) if m["k"] == k and haversine(gy, gx, m["y"], m["x"]) < 300]
        if near:
            report["moi_f_matched"].append({"moi": name, "mort": near[0]["n"], "by": "300m"})
            continue
        out.append(rec(k, name, gy, gx, "moi-f", addr=addr, dist=dist, how="geocode-" + gm))
    return out


def gas_key(s):
    s = half(s)
    for _ in range(3):
        s = re.sub(r"加油站$|站$|服務區|台灣中油|中油|台塑石化|台塑|台亞|統一精工|全國|福懋|北基|山隆|西歐", "", s)
    return s


def load_gas(raw, geo, report):
    out = []
    d = json.load(open(os.path.join(raw, "moeaea_gas_all.json"), encoding="utf-8-sig"))["data"]
    report["versions"]["ea-gas"] = (d.get("UpdateTime") or "").replace("/", "-")
    cpc = [c for c in json.load(open(os.path.join(raw, "cpc_stations.json"), encoding="utf-8-sig"))
           if c.get("縣市") in ("台中市", "臺中市") and str(c.get("營業中")) == "1"]
    for s in d.get("stations", []):
        if s.get("City") not in ("臺中市", "台中市"):
            continue
        name, addr, town = s.get("Name", ""), s.get("Adress") or s.get("Address", ""), s.get("Town", "")
        if INACTIVE_RE.search(name):
            report["excluded"].append({"s": "ea-gas", "n": name, "addr": addr, "why": "名稱有停業類字眼"})
            continue
        gy, gx, gm = geo.geocode(addr, town)
        how = "geocode-" + (gm or "")

        def cpc_hit(addr_only=False):
            # 中油站點座標：同區、地址（去掉區、村里鄰、空白）相同；
            # 站名相同只認「能源署標台灣中油、而且同區只有一站同名」的（⚠ 站名比對會把「山隆北屯」對到中油「北屯站」）
            def norm(a):
                a = half(a).replace("台", "臺").replace(" ", "")
                a = re.sub(r"^(臺中市)?" + re.escape(town), "", a)
                return re.sub(r"^[^\d路街道巷弄段號]{1,4}?[村里](\d+鄰)?", "", a)
            a2 = norm(addr)
            same_town = [c for c in cpc if c.get("鄉鎮區") == town]
            for c in same_town:
                ca = norm(c.get("地址", ""))
                if ca and ca == a2:
                    return c
            if addr_only or s.get("Market") != "台灣中油" or not gas_key(name):
                return None
            by_name = [c for c in same_town if gas_key(c.get("站名", "")) == gas_key(name)]
            return by_name[0] if len(by_name) == 1 else None

        if gy is not None and gm == "near":
            # 只對到同一條路的附近門牌（號碼差 ≤ 8）：誤差可能到 200 公尺（和平站、豐潭站）→ 中油站點地址完全相同、
            # 而且差 150 公尺～1 公里（再遠就不是同一條路的誤差，寧可不動）就改用中油的
            c = cpc_hit(addr_only=True)
            if c:
                cy, cx = float(c["緯度"]), float(c["經度"])
                dd = haversine(gy, gx, cy, cx)
                if 150 < dd < 1000:
                    report["coord_fixed"].append({"s": "ea-gas", "n": name, "addr": addr, "off_m": round(dd),
                                                  "from": [round(gy, 5), round(gx, 5)], "to": [round(cy, 5), round(cx, 5)],
                                                  "why": "近鄰門牌定位跟中油站點座標差 > 150 公尺，改用中油座標"})
                    gy, gx, how = cy, cx, "cpc-coord"
        if gy is None:
            hit = cpc_hit()
            if hit:
                gy, gx, how = float(hit["緯度"]), float(hit["經度"]), "cpc-coord"
            else:
                report["unresolved"].append({"s": "ea-gas", "k": "fuel", "n": name, "addr": addr, "why": f"地址對不到門牌（{gm}），中油站點也對不到"})
                continue
        out.append(rec("fuel", name, gy, gx, "ea-gas", addr=addr, dist=town, how=how))
    return out


def load_markets(raw, geo, report):
    out = []
    for r in read_csv(os.path.join(raw, "tc_market_public.csv")):
        name, addr = r.get("市場名稱", ""), r.get("地址", "")
        gy, gx, gm = geo.geocode(addr, r.get("行政區"))
        if gy is None:
            report["unresolved"].append({"s": "tc-mkt", "k": "market", "n": name, "addr": addr, "why": f"地址對不到門牌（{gm}）"})
            continue
        out.append(rec("market", name, gy, gx, "tc-mkt", addr=addr, how="geocode-" + gm))
    for r in read_csv(os.path.join(raw, "tc_wholesale.csv")):
        name, addr = r.get("市場名稱", ""), r.get("住址", "")
        gy, gx, gm = geo.geocode(addr)
        if gy is None:
            report["unresolved"].append({"s": "tc-wh", "k": "market", "n": name, "addr": addr, "why": f"地址對不到門牌（{gm}）"})
            continue
        out.append(rec("market", name, gy, gx, "tc-wh", addr=addr, how="geocode-" + gm))
    seen = set()
    for fn, sid, ncol, acol in (("tc_nightmarket.csv", "tc-nm", "名稱", "位址"), ("tc_vendor_zone.csv", "tc-vz", "名稱", "地點")):
        for r in read_csv(os.path.join(raw, fn)):
            name, loc = r.get(ncol, ""), r.get(acol, "")
            if not name or name == "合計" or not loc:
                continue
            key = name_key(name).replace("集", "")
            if key in seen:  # 夜市清冊與攤販集中區清冊重複的（逢甲、中華路、昌平）只留一筆
                report["dup_official"].append({"s": sid, "n": name})
                continue
            dist = r.get("行政區") or None
            gy = None
            if re.search(r"\d+(?:[-之]\d+)?號", loc):
                gy, gx, gm = geo.geocode(loc, dist)
            if gy is None:
                g = geo.xroad_text(loc, dist)
                if g:
                    gy, gx, gm = g
            if gy is None:
                for d in ([dist] if dist else DISTS):
                    y2, x2, m2 = geo.geocode(loc, d)
                    if y2 is not None and m2 in ("lane", "exact", "base", "near"):
                        gy, gx, gm = y2, x2, m2
                        break
            if gy is None:
                report["unresolved"].append({"s": sid, "k": "market", "n": name, "addr": loc, "why": "只寫路段，找不到兩條路的路口"})
                continue
            seen.add(key)
            out.append(rec("market", name, gy, gx, sid, addr=loc, dist=dist, how="geocode-" + gm))
    return out


def load_hospitals(raw, geo, report):
    out = []
    for r in read_csv(os.path.join(raw, "tc_hospital.csv")):
        name, addr = r.get("醫院名稱", ""), r.get("地址", "")
        if not name:
            continue
        gy, gx, gm = geo.geocode(addr)
        if gy is None:
            report["unresolved"].append({"s": "tc-hosp", "k": "hospital", "n": name, "addr": addr, "why": f"地址對不到門牌（{gm}）"})
            continue
        out.append(rec("hospital", name, gy, gx, "tc-hosp", addr=addr, how="geocode-" + gm))
    return out


def load_landfills(raw, geo, report):
    from pyproj import Transformer
    tr = Transformer.from_crs(3826, 4326, always_xy=True)
    sites = collections.OrderedDict()
    for r in read_csv(os.path.join(raw, "tc_landfill.csv")):
        base = re.sub(r"[（(].*$", "", r.get("名稱", "")).strip()
        s = sites.setdefault(base, {"addr": r.get("掩埋場地址", ""), "wells": []})
        try:
            lng, lat = tr.transform(float(r["X座標_TWD97"]), float(r["Y座標_TWD97"]))
            s["wells"].append((lat, lng))
        except (KeyError, ValueError):
            pass
    out = []
    for base, s in sites.items():
        m = re.match(r"^(\S+?區)(.*)$", base)
        dist, place = (m.group(1), m.group(2)) if m else (None, base)
        name = f"{dist}{place}衛生掩埋場" if dist else f"{base}衛生掩埋場"
        gy, gx, gm = geo.geocode(s["addr"], dist)
        how = "geocode-" + gm if gy is not None else None
        if s["wells"]:
            # 監測井就在場區邊上：地址精確（對到門牌、不是「XX號旁」）且離監測井中點 1 公里內才用地址，否則用監測井中點
            wy = sum(w[0] for w in s["wells"]) / len(s["wells"])
            wx = sum(w[1] for w in s["wells"]) / len(s["wells"])
            good = (gy is not None and gm in ("exact", "base") and not re.search(r"旁|附近|地號", s["addr"])
                    and haversine(gy, gx, wy, wx) < 1000)
            if not good:
                gy, gx, how = wy, wx, "wells-mid"
        if gy is None:
            report["unresolved"].append({"s": "tc-lf", "k": "landfill", "n": name, "addr": s["addr"], "why": "地址對不到門牌、也沒有監測井座標"})
            continue
        out.append(rec("landfill", name, gy, gx, "tc-lf", addr=s["addr"], dist=dist, how=how,
                       wells=[[round(w[0], 5), round(w[1], 5)] for w in s["wells"]]))
    return out


def load_osm(args, cache, report):
    path = args.osm or os.path.join(cache, "osm.json")
    if args.refresh_osm:
        print("  [osm] 重跑 fetch-undesirable-facilities.mjs …")
        r = subprocess.run(["node", FETCH_OSM, "--out", path], cwd=REPO)
        if r.returncode != 0:
            print("  [osm] ⚠ Overpass 失敗，改用快取／現有網站檔")
    if os.path.exists(path):
        d = json.load(open(path, encoding="utf-8"))
        report["osm_from"] = path
        report["osm_base"] = d.get("osmBase") or d.get("fetchedAt")
        items = d["items"]
    else:
        d = json.load(open(OUT_JSON, encoding="utf-8"))
        items = [it for it in d.get("items", []) if it.get("s", "osm") == "osm"]
        report["osm_from"] = OUT_JSON + "（沿用網站檔裡的 OSM 點）"
        report["osm_base"] = next((s.get("version") for s in d.get("sources", []) if s.get("id") == "osm"), d.get("fetchedAt"))
    out = []
    for it in items:
        k = it["k"]
        n = it["n"]
        oid = it.get("id")
        named = bool(it.get("named", n != LABEL_OF.get(k)))
        why = None
        if oid in OSM_EXCLUDE:
            why = OSM_EXCLUDE[oid]
        elif named and OSM_INACTIVE_RE.search(n):
            why = "名稱看得出不是現有設施（用地、淹沒、舊址、廢止類字眼）"
        elif k in OSM_ALLOW and not (OSM_ALLOW[k] is not None and named and OSM_ALLOW[k].search(n)):
            why = "OSM 醫院、掩埋場改白名單制：以衛生局醫院清冊、環保局使用中掩埋場清冊為準"
        elif k == "waste" and not OSM_WASTE_OK.search(f"{n} {it.get('op') or ''}"):
            why = "轉運站只收清潔隊、環保局經營的（民間回收業者、服務區垃圾儲存場不算）"
        if why:
            report["excluded"].append({"s": "osm", "id": oid, "k": k, "n": n, "why": why})
            continue
        out.append(rec(k, n, it["y"], it["x"], "osm", named=named, oid=oid, on=it.get("on"), op=it.get("op"), ad=it.get("ad")))
    return out


# ================================================================ 合併去重
# 宮廟名稱裡到處都有的字（福德、土地公、宮、廟…）拿掉，剩下的才拿來比（「信義街福德祠」「新庄仔福德祠」只有「福德」相同，不算同一間）
TEMPLE_GENERIC_TOKENS = re.compile(r"福德正神|福德|土地公|土地|伯公|萬善|萬應|有應|百姓|大眾爺|媽祖|王爺|[宮廟寺殿堂壇祠院觀巖岩庵亭府閣]")


def temple_core(k):
    c = TEMPLE_GENERIC_TOKENS.sub("", k)
    return c if len(c) >= 2 else ""


# OSM ↔ OSM 同名合併時不算的通用名稱（不同地方都叫這個）
GENERIC_AREA = re.compile(r"^(?:黃昏市場|市場|早市|夜市|果菜市場|公墓|墓地|第\d+公墓|納骨塔)$")


def area_match(a, b, d):
    """面狀類別：一筆官方、一筆 OSM。OSM 的 official_name、門牌也拿來比"""
    off, o = (a, b) if a["s"] != "osm" else (b, a)
    ko = area_key(off["n"])
    if len(ko) < 2:
        return None
    ak = addr_key(off.get("addr"))
    if d < 250 and ak and o.get("ad") and ak == addr_key(o["ad"]):
        return "area-same-addr"
    for c in [area_key(o["n"]) if o["named"] else ""] + ([area_key(o["on"])] if o.get("on") else []):
        if len(c) < 2:
            continue
        if c == ko:
            # 列管夜市、攤販集中區清冊只寫路段，點位是路口；OSM 是整片夜市的中心 → 同名放寬到 400 公尺（旱溪夜市 354 公尺）
            if d < (400 if off["s"] in ("tc-nm", "tc-vz") else 250):
                return "area-samename"
        elif (c in ko or ko in c) and min(len(c), len(ko)) >= 3 and d < 250:
            return "area-contains"
    return None


def merge(records, report):
    records.sort(key=lambda r: PRIO[r["s"]])
    kept, grid = [], collections.defaultdict(list)
    cell = 0.004  # 約 400 公尺（最大合併距離是 400 公尺，查相鄰 9 格一定涵蓋）
    for r in records:
        lab = LABEL_OF[r["k"]]
        key_r = merge_key(r)
        cy, cx = int(r["y"] / cell), int(r["x"] / cell)
        best = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for q in grid.get((cy + dy, cx + dx), ()):
                    if LABEL_OF[q["k"]] != lab:
                        continue
                    d = haversine(r["y"], r["x"], q["y"], q["x"])
                    if d >= 400:
                        continue
                    key_q = merge_key(q)
                    if r["s"] == "osm" and q["s"] == "osm":
                        # OSM ↔ OSM：同名才併（乾靈寺 ×2、楊氏墓園宗祠 ×3、和平區清潔隊 ×3、上景興市場 A～F 區）
                        lim = 250 if r["k"] in AREA_CATS else 150
                        if (d < lim and key_r and key_r == key_q and len(key_r) >= 2
                                and not GENERIC_AREA.search(key_r) and not (r["k"] == "temple" and GENERIC_TEMPLE.search(key_r))):
                            if best is None or d < best[0]:
                                best = (d, q, "osm-samename", 1.0)
                        continue
                    sim = name_sim(key_r, key_q) if key_r and key_q else None
                    cross = (r["s"] == "osm") != (q["s"] == "osm")
                    if cross and r["k"] in AREA_CATS and sim is not None:
                        # 面狀類別：拿掉「公有零售、攤販集中區、觀光」再比一次（「烏日第一公有零售市場」↔「烏日市場」）
                        sim = max(sim, name_sim(area_key(r["n"]), area_key(q["n"])))
                    # 官方 ↔ 官方：各自是登記在案的不同設施，名稱要很像才算重複（「新庄子永和宮」「新庄子福德祠」同一個門牌，是兩間廟）
                    need = 0.4 if cross else 0.7
                    arule = area_match(r, q, d) if cross and r["k"] in AREA_CATS else None
                    if d < 60 and (sim is None or sim >= need):
                        rule = "60m-unnamed" if sim is None else "60m-name"
                    elif cross and r["k"] in AREA_CATS and d < 30 and sim is not None and sim >= 0.3:
                        rule = "30m-area-name"  # 「南屯早市」↔「南屯市場」15 公尺
                    elif cross and r["k"] == "fuel" and d < 25:
                        rule = "25m-fuel"  # 品牌、站名寫法太多種（「福懋三益」↔ OSM「大甲站」brand=福懋，21 公尺）
                    elif (cross and r["k"] == "temple" and d < 30 and key_r and key_q
                          and temple_core(key_r) and temple_core(key_q) and bigrams(temple_core(key_r)) & bigrams(temple_core(key_q))):
                        rule = "30m-temple-bigram"  # 「巧聖先師廟」↔「巧聖仙師廟」、「萬興宮媽祖廟」↔「社口萬興宮」
                    elif not cross and d < 5 and key_r and key_q and len(os.path.commonprefix([key_r, key_q])) >= 4:
                        rule = "same-spot-prefix"  # 同一個門牌、名稱開頭一樣（「大度山無主納骨堂前棟／後棟」）
                    elif arule:
                        rule = arule
                    elif d >= 250:
                        continue
                    elif (cross and r["k"] in AREA_CATS and sim is not None
                          and (key_r == key_q or (sim >= 0.9 and min(len(key_r), len(key_q)) >= 3))):
                        rule = "250m-samename"
                    elif (cross and r["k"] == "temple" and sim is not None and d < 150
                          and key_r == key_q and len(key_r) >= 2 and not GENERIC_TEMPLE.search(key_r)):
                        rule = "150m-temple-samename"  # OSM 的廟常標在廟埕或路邊，名稱完全一樣（去掉宮廟寺字尾）才算
                    else:
                        continue
                    if best is None or d < best[0]:
                        best = (d, q, rule, sim)
        if best:
            d, q, rule, sim = best
            q.setdefault("merged", []).append({"s": r["s"], "n": r["n"], "d": round(d, 1), "rule": rule})
            report["merge_log"].append({"keep": {"s": q["s"], "n": q["n"], "y": round(q["y"], 5), "x": round(q["x"], 5)},
                                        "drop": {"s": r["s"], "n": r["n"], "y": round(r["y"], 5), "x": round(r["x"], 5)},
                                        "k": q["k"], "d": round(d, 1), "rule": rule, "sim": None if sim is None else round(sim, 2)})
            report["merge_count"][f"{r['s']}→{q['s']}"] += 1
            continue
        kept.append(r)
        grid[(cy, cx)].append(r)
    return kept


# ================================================================ 主程式
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="快取資料夾（raw/ 原始檔、osm.json、report.json）")
    ap.add_argument("--refresh", action="store_true", help="官方原始檔全部重抓")
    ap.add_argument("--refresh-osm", action="store_true", help="重跑 OSM 抓取")
    ap.add_argument("--osm", help="OSM 中介檔路徑（預設 <cache>/osm.json）")
    ap.add_argument("--out", default=OUT_JSON)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cache = os.path.abspath(args.cache)
    raw = os.path.join(cache, "raw")
    print(f"[uf] 快取：{cache}")
    fetch_raw(raw, args.refresh)

    report = {"unresolved": [], "excluded": [], "coord_fixed": [], "coord_kept": [], "moi_f_matched": [], "dup_official": [],
              "merge_log": [], "merge_count": collections.Counter(), "temple_offset": [], "versions": {}}
    geo = Geocoder(ADDR_DIR)

    t0 = time.time()
    osm = load_osm(args, cache, report)  # 先讀：寺廟官方座標要拿 OSM 同名點做第三方驗證
    mort = load_mortuary(raw, geo, report)
    official = []
    official += mort
    official += load_moi_funeral(raw, geo, mort, report)
    official += load_temples(raw, geo, report, osm)
    official += load_gas(raw, geo, report)
    official += load_markets(raw, geo, report)
    official += load_hospitals(raw, geo, report)
    official += load_landfills(raw, geo, report)
    print(f"  讀入：官方 {len(official):,} 筆、OSM {len(osm):,} 筆（{time.time() - t0:.1f}s）")

    # 定位方法統計
    how = collections.Counter((r["s"], r.get("how", "official").split("-")[-1] if r.get("how", "").startswith("geocode") else r.get("how", "official")) for r in official)
    kept = merge(official + osm, report)

    # 行政區自我檢查：官方點（有寫地址的）最近門牌所在區 ≠ 地址寫的區 → 列出來
    dist_check = []
    for r in kept:
        if r["s"] == "osm" or not r.get("addr"):
            continue
        adist = geo.parse(r["addr"], r.get("dist"))[0]
        if not adist:
            continue
        nd, nm = geo.nearest_dist(r["y"], r["x"])
        if nd and nd != adist:
            dist_check.append({"s": r["s"], "n": r["n"], "addr": r["addr"], "addr_dist": adist, "near_dist": nd, "near_m": round(nm)})

    # ---- 輸出
    kept.sort(key=lambda r: (r["k"], r["y"], r["x"]))
    items = [{"k": r["k"], "n": r["n"], "y": round(r["y"], 5), "x": round(r["x"], 5), "s": r["s"]} for r in kept]
    by_label = collections.Counter(LABEL_OF[it["k"]] for it in items)
    src_n = collections.Counter(it["s"] for it in items)

    versions = dict(report["versions"])
    vkind = {sid: "content" for sid in versions}  # ea-gas：清冊本身的更新時間
    for s in SOURCES:
        if s.get("meta"):
            try:
                m = json.load(open(os.path.join(raw, f"meta_{s['meta']}.json"), encoding="utf-8"))["result"]
                # 資源檔名常帶民國日期（「臺中市列管夜市1070412(修)」＝ 2018-04-12 的清冊）→ 用清冊內容的日期，
                # 不要用 data.gov.tw 的詮釋資料更新日（2026-06-15 只是平台改欄位，會讓人以為資料很新）
                content = None
                for res in m.get("distribution", []):
                    mm = re.search(r"(?<!\d)(1\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)", res.get("resourceDescription") or "")
                    if mm:
                        content = f"{int(mm.group(1)) + 1911}-{mm.group(2)}-{mm.group(3)}"
                        break
                if s["id"] not in versions:
                    versions[s["id"]] = content or (m.get("modifiedDate") or "")[:10]
                    vkind[s["id"]] = "content" if content else "meta"
            except Exception:
                pass
    log = {}
    try:
        log = json.load(open(os.path.join(raw, "_fetched.json"), encoding="utf-8"))
    except Exception:
        pass
    versions.setdefault("tc-mort", (log.get("mort_tombs.json", {}).get("at") or time.strftime("%Y-%m-%d"))[:10])
    versions["osm"] = (report.get("osm_base") or "")[:10]
    for s in SOURCES:
        if s.get("versionKind") and s["id"] not in vkind:
            vkind[s["id"]] = s["versionKind"]
    vkind["osm"] = "osm"

    sources = []
    for s in SOURCES:
        if not src_n.get(s["id"]):
            continue
        o = {"id": s["id"], "name": s["name"], "org": s["org"], "url": s["url"], "version": versions.get(s["id"], ""),
             "versionKind": vkind.get(s["id"], "meta"), "license": s["license"]}
        for f in ("short", "licenseUrl", "geo", "geoRef"):
            if s.get(f):
                o[f] = s[f]
        if s["id"] == "tc-vz":
            # 清冊原名有「籌設」兩個字，容易被讀成還在規劃中：用實際收進來的點說明
            names = [it["n"] for it in items if it["s"] == "tc-vz"]
            n_dup = sum(1 for d in report["dup_official"] if d["s"] == "tc-vz")
            n_un = sum(1 for u in report["unresolved"] if u["s"] == "tc-vz")
            rest = "、".join(x for x in ([f"{n_dup} 處跟〈臺中市列管夜市〉重複只留一筆"] if n_dup else [])
                             + ([f"{n_un} 處清冊只寫路段、定不到位置"] if n_un else []))
            short_names = "、".join(re.sub(r"攤販集中區$", "", x) for x in names)
            o["note"] = (f"清冊原名；本頁收的是{short_names} {len(names)} 處，清冊裡都有自治會長與營業時段"
                         + (f"；另外 {rest}" if rest else ""))
        o["count"] = src_n[s["id"]]
        sources.append(o)

    now = dt.datetime.now(TZ8).replace(microsecond=0)
    payload = {
        "source": "內政部、經濟部能源署、臺中市政府等官方開放資料；OpenStreetMap contributors (ODbL)",
        "area": "臺中市",
        "fetchedAt": now.strftime("%Y-%m-%d"),
        "builtAt": now.isoformat(),
        "count": len(items),
        "categories": CATEGORIES,
        "byCategory": dict(sorted(by_label.items(), key=lambda kv: -kv[1])),
        "sources": sources,
        "items": items,
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    gz = len(gzip.compress(body.encode("utf-8"), 9))

    old = {}
    try:
        old = json.load(open(args.out, encoding="utf-8"))
    except Exception:
        pass
    old_by = collections.Counter(LABEL_OF.get(it["k"], it["k"]) for it in old.get("items", []))
    labels = sorted(set(old_by) | set(by_label), key=lambda l: -by_label.get(l, 0))
    comp = [{"label": l, "before": old_by.get(l, 0), "after": by_label.get(l, 0),
             "bySource": dict(collections.Counter(it["s"] for it in items if LABEL_OF[it["k"]] == l))} for l in labels]

    rep = {
        "builtAt": payload["builtAt"],
        "count_before": len(old.get("items", [])), "count_after": len(items),
        "bytes": len(body.encode("utf-8")), "gzip_bytes": gz,
        "categories": comp,
        "sources": {s["id"]: s["count"] for s in sources},
        "geocode_methods": {f"{a}:{b}": n for (a, b), n in sorted(how.items())},
        "merge_count": dict(report["merge_count"]),
        "unresolved": report["unresolved"],
        "excluded": report["excluded"],
        "coord_fixed": report["coord_fixed"],
        "coord_kept": report["coord_kept"],
        "dist_check_mismatch": dist_check,
        "moi_f_matched": report["moi_f_matched"],
        "dup_official": report["dup_official"],
        "temple_offset_m": {
            "n": len(report["temple_offset"]),
            "p50": round(sorted(report["temple_offset"])[len(report["temple_offset"]) // 2]) if report["temple_offset"] else None,
            "p90": round(sorted(report["temple_offset"])[int(len(report["temple_offset"]) * 0.9)]) if report["temple_offset"] else None,
            ">300m": sum(1 for d in report["temple_offset"] if d > 300),
        },
        "osm_from": report.get("osm_from"),
        "merge_log": report["merge_log"],
    }
    os.makedirs(cache, exist_ok=True)
    json.dump(rep, open(os.path.join(cache, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"\n[uf] {len(old.get('items', [])):,} → {len(items):,} 筆，{len(body.encode('utf-8')) / 1024:.0f}KB（gzip {gz / 1024:.0f}KB）")
    print("  類別            之前   之後   來源")
    for c in comp:
        print(f"  {c['label']:<10} {c['before']:>6} {c['after']:>6}   " + "、".join(f"{k} {v}" for k, v in sorted(c["bySource"].items(), key=lambda kv: -kv[1])))
    print("  來源：" + "、".join(f"{s['id']} {s['count']}" for s in sources))
    print("  合併：" + "、".join(f"{k} {v}" for k, v in sorted(report["merge_count"].items(), key=lambda kv: -kv[1])))
    print(f"  無法定位 {len(report['unresolved'])} 筆、排除 {len(report['excluded'])} 筆、座標改用門牌 {len(report['coord_fixed'])} 筆、行政區不符 {len(dist_check)} 筆")
    print(f"  報告：{os.path.join(cache, 'report.json')}")
    if args.dry_run:
        print("  （--dry-run：不寫網站檔）")
        return
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"  寫出 {args.out}")


if __name__ == "__main__":
    main()
