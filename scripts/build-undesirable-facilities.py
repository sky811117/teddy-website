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
- 2026-09-30 第二輪查核後（規則，不逐筆硬寫；報告 reclassified／merge_rules／merge_doubt／near_side_fixed 有逐筆清單）：
  · 分類：OSM 只供氫氣的站（fuel:LH2 等、名稱「加氫」）不是加油站 → 排除；
    OSM 標成公墓、名稱是骨灰存放設施（納骨、靈骨、塔、堂、生命紀念館…）→ 改歸「殯葬設施」，再跟官方殯葬清冊合併；
    OSM 公墓多邊形只包住官方殯葬設施、名稱核心相同（金陵山）→ 也改歸殯葬設施
  · 門牌 near 定位改「同一側（號碼同奇偶）優先」：台灣門牌單雙號分在路的兩側，舊版會挑到對面、差到 270 公尺（北屯路 436 號）
  · 面狀類別（公墓、殯葬、市場）用 OSM 多邊形：多邊形（外擴 30 公尺）包住另一筆的點 → 同一處（1.5 公里內）；
    名稱對不上的也併，但列進 merge_doubt
  · 公墓名稱正規化：區名（可不帶「區」）＋編號（第二／第2、第二、第三／第2、3）＋公墓／墓地／墓園同義 → 同區同編號 400 公尺內同一座
  · 加油站：OSM 門牌（addr:street＋housenumber 或 addr:full）跟能源署一樣 → 500 公尺內同一站；
    門牌不一樣 → 只有 25 公尺內才併；OSM 點在中油站點座標 60 公尺內、那一站就是能源署那一站（地址相同）→ 併；
    去掉品牌後站名相同 → 300 公尺內併；OSM 沒地址：250 公尺內只有這一個官方站 → 120 公尺內併，
    500 公尺內只有這一個官方站而且品牌一致 → 150 公尺內併（液化石油氣、加氣站名稱的不套這兩條）
  · 市場：名稱去掉區、批發、公有零售後相同（「霧峰第一市場」↔「霧峰市場」：只有一邊寫第一也算）→ 250 公尺內併；
    OSM ↔ OSM：沒名字的 60 公尺內併進旁邊那一筆；名稱核心相同（內新早上市場／內新早市）150 公尺內併；
    只寫「早市、黃昏市場」這種通稱的，150 公尺內有同類型（早市／黃昏／夜市）的就併
  · OSM ↔ OSM 沒名字的同類點 10 公尺內 → 重複標註（高壓電塔、基地台除外）
- 2026-09-30 第三輪查核後：
  · 公墓點位：OSM 範圍併進官方公墓後（包住官方點、同名 400 公尺內、同區同編號 1.5 公里內），只有「範圍中心在 300、500 公尺
    兩種查詢範圍都比官方點查到更多該看到這座公墓的門牌」才改放範圍中心（門牌＝網站門牌庫；該看到＝離公墓範圍邊界在查詢範圍內）。
    其他留在官方點（官方點多在路邊、入口，住家也在那一側）。報告 coord_area_center／coord_area_kept 有逐座門牌數
  · 公墓碎塊：OSM 公墓範圍之間邊界 30 公尺內、至少一塊沒名字 → 合併前先併成一筆（一組最多一塊有名字）；
    點位用有名字那塊，都沒名字就用「中心查得到最多門牌」的那一塊
  · 同區同編號的 OSM 公墓（有編號），1.5 公里內有同編號的官方公墓 → 併進去（已經併過同名範圍的那一筆優先，其次最近）
  · 加油站：OSM 加油站改白名單制 —— 合併後還留著的 OSM 站，只收「跟能源署或中油營業中站點同門牌」或「離中油站點 60 公尺內」的，
    其他排除並列入報告（可能已歇業；液化石油氣加氣站也在這裡排除，要不要算加油站待定）
  · 加油站：能源署門牌精確對到，但 OSM 同門牌的點和中油站點座標彼此 35 公尺內、又都離門牌點 80 公尺以上 → 改用中油座標
  · 宮廟：OSM 門牌（addr:street＋housenumber 或 addr:full）跟官方寺廟登記地址同一個門牌 → 400 公尺內同一間；
    官方 ↔ OSM 兩筆都是土地公廟（福德、土地、伯公）15 公尺內 → 同一間；OSM 沒名字的宮廟 60 公尺內有 OSM 有名字的宮廟 → 併進去

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
     "geo": "機關清冊只有地址，以臺中市門牌（115年1月）定位；定不到、只對到附近門牌，或門牌點跟中油、OpenStreetMap 兩份資料都差 80 公尺以上的，用台灣中油公開的站點座標",
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
    # 清冊原名有「籌設」兩個字，容易被讀成還在規劃中 → 原名只出現在資料來源段；地圖彈窗、清單、限制說明一律用 short
    {"id": "tc-vz", "name": "臺中市七處籌設列管攤販集中區", "short": "攤販集中區（列管）", "org": "臺中市政府經濟發展局",
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
        self.near_log = {}  # near 定位改挑同一側門牌的紀錄（地址 → 前後號碼、移動距離）
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
                best = old = None
                for k, (y, x) in g.items():
                    mm = re.match(r"^(\d+)$", k)
                    if not mm:
                        continue
                    n = int(mm.group(1))
                    d = abs(n - want)
                    if d > 8:
                        continue
                    # 同一側（號碼同奇偶）優先：台灣門牌單雙號分在路的兩側，兩側的號碼不一定對齊，
                    # 對面只差 1 號也可能差幾百公尺（北屯路 436 號：對面 435 號差 270 公尺、同側 438 號差 2 公尺）
                    score = ((n - want) % 2, d)
                    if best is None or score < best[0]:
                        best = (score, y, x, n)
                    if old is None or (d, (n - want) % 2) < old[0]:  # 2026-09-30 前的挑法（只看號碼差），留著比對寫報告
                        old = ((d, (n - want) % 2), y, x, n)
                if best:
                    if old[3] != best[3]:
                        self.near_log[addr] = {"addr": addr, "no": want, "picked": best[3], "before": old[3],
                                               "moved_m": round(haversine(old[1], old[2], best[1], best[2])),
                                               "from": [round(old[1], 5), round(old[2], 5)], "to": [round(best[1], 5), round(best[2], 5)]}
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
AREA_STRIP = re.compile(r"醫療社團法人|醫療財團法人|社團法人|財團法人|攤販集中區|公有零售|公有|零售|觀光|附設|附屬|民眾診療服務處|批發|運銷")


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


# ---- 2026-09-30 第二輪：公墓、市場的名稱正規化（區名可不帶「區」、編號中文／數字、公墓／墓地／墓園同義）
DIST2 = sorted({d[:-1] for d in DISTS if len(d) == 3}, key=len, reverse=True)  # 大雅、東勢…（名稱裡常省略「區」）
DIST1 = [d[:-1] for d in DISTS if len(d) == 2]                                 # 中、東、南、西、北：一定要帶「區」才算區名
CN_NUMS = "零〇一二兩三四五六七八九十百"
_NUM_LIST = re.compile(r"第((?:\d+|[" + CN_NUMS + r"]+)(?:[、,，及和與]第?(?:\d+|[" + CN_NUMS + r"]+))*)區?")
CEM_NOTE = re.compile(r"[（(](?:已禁葬|部分禁葬|禁葬|公墓已禁葬|休葬[^）)]*|僅限[^）)]*|[^）)]*樓[^）)]*|[^）)]*F)[）)]")


def _split_dist(s):
    """名稱開頭的區名（「大雅第三區公墓」「霧峰第五公墓」「沙鹿區第7公墓」）→ (區名或 None, 剩下的字)"""
    m = re.match(r"^(" + "|".join(DIST2) + r")(?:區|鄉|鎮|市(?!場|集))?", s) or re.match(r"^(" + "|".join(DIST1) + r")區", s)
    return (m.group(1), s[m.end():]) if m else (None, s)


def cem_sig(n):
    """公墓、殯葬設施名稱 → (區名, 編號集合, 名稱核心)。「大肚區第二、第三公墓」＝「大肚區第2、3公墓」＝(大肚, {2,3}, "")"""
    s = half(n).replace("台", "臺")
    s = CEM_NOTE.sub("", s)
    s = re.sub(r"^(臺中市|臺中縣)", "", s)
    s = re.sub(r"^(私立|公立|市立|區立|財團法人)+", "", s)
    dist, s = _split_dist(s)
    nums = set()

    def take(m):
        for t in re.split(r"[、,，及和與]第?", m.group(1)):
            nums.add(t if t.isdigit() else str(cn2int(t)))
        return ""
    s = _NUM_LIST.sub(take, s, count=1)
    s = re.sub(r"公墓|墓地|墓園", "", s)
    s = re.sub(r"[\W_]+", "", s)
    return dist, frozenset(x for x in nums if x and x != "None"), s


def cem_compat(a, b):
    """兩個公墓／殯葬名稱是不是同一處（同區、同編號；編號都沒有就比名稱核心）"""
    (da, na, ca), (db, nb, cb) = a, b
    if da and db and da != db:
        return False
    strip = lambda c: re.sub(r"示範|花園", "", c)
    if na and nb:
        return bool(na & nb) and (not ca or not cb or strip(ca) == strip(cb) or ca in cb or cb in ca)
    if na or nb:
        return False
    if len(ca) < 2 or len(cb) < 2:
        return False
    return ca == cb or (min(len(ca), len(cb)) >= 3 and (ca in cb or cb in ca))


MKT_TYPE = (("早", r"早上市場|早市"), ("昏", r"黃昏"), ("夜", r"夜市"))
MKT_WORDS = re.compile(r"早上市場|早市|黃昏市場|黃昏|夜市|市場|商場|路邊攤|攤販|^舊")


def market_sig(n):
    """市場名稱 → (類型 早／昏／夜, 編號集合, 名稱核心)。區名留著當核心（「霧峰市場」的核心就是霧峰）"""
    s = half(n).replace("台", "臺")
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    s = re.sub(r"^臺中市", "", s)
    s = re.sub(r"^(" + "|".join(DIST2) + r")區", r"\1", s)
    s = re.sub(r"^(" + "|".join(DIST1) + r")區", "", s)
    s = AREA_STRIP.sub("", s).replace("市集", "市場")
    s = re.sub(r"第([" + CN_NUMS + r"]+)", lambda m: "第" + str(cn2int(m.group(1)) or m.group(1)), s)
    s = re.sub(r"[\W_]+", "", s)
    typ = next((t for t, p in MKT_TYPE if re.search(p, s)), "")
    nums = frozenset(re.findall(r"第(\d+)", s))
    core = MKT_WORDS.sub("", re.sub(r"第\d+", "", s))
    return typ, nums, core


def market_compat(a, b):
    (ta, na, ca), (tb, nb, cb) = a, b
    if len(ca) < 2 or len(cb) < 2:
        return False
    if not (ca == cb or (min(len(ca), len(cb)) >= 3 and (ca in cb or cb in ca))):
        return False
    # 編號：一樣，或只有一邊寫「第一」（鄉鎮只有一個市場時常叫「第一市場」：霧峰第一市場＝霧峰市場）
    return na == nb or (not na and nb <= {"1"}) or (not nb and na <= {"1"})


GENERIC_MARKET = re.compile(r"^(?:黃昏市場|黃昏市集|市場|市集|早市|早上市場|夜市|果菜市場|傳統市場|攤販)$")


# ---- 加油站：地址正規化、品牌
def fuel_addr(geo, a):
    """地址 → 「路段巷弄號」（段、中文號碼、之 → -；拿掉郵遞區號、市、區、村里鄰、樓層）"""
    if not a:
        return ""
    _d, s = geo.parse(a)
    m = re.match(r"^[^\d路街道巷弄段號]{1,4}?[村里](\d+鄰)?", s)
    if m and not re.match(r"^[路街道巷弄段]", s[m.end():]):
        s = s[m.end():]
    s = re.sub(r"^\d+鄰", "", s)
    s = re.sub(r"(\d+)號之(\d+)", r"\1-\2", s)  # 596號之1號 → 596-1號
    m = re.match(r"^(.*?\d+(?:[-之]\d+)*)號", s)
    # 要有路名才算（OSM 有「臺中市南屯區14-1號」這種只有號碼的 addr:full）
    return m.group(1).replace("之", "-") if m and re.search(r"[路街道巷弄段]", m.group(1)) else ""


FUEL_BRANDS = (("中油", r"(?i)中油|\bcpc\b|中國石油"), ("台亞", r"[台臺]亞"), ("全國", r"(?i)全國|\bnpc\b"), ("福懋", r"福懋"),
               ("山隆", r"(?i)山隆|sanlong"), ("北基", r"北基"), ("統一", r"統一|速邁樂"), ("西歐", r"西歐"), ("優力", r"優力"),
               ("台塑", r"(?i)[台臺]塑|formosa"))
# 名稱看得出不是一般加油的（液化石油氣、加氣站、充電站）：不用「附近只有一站」的規則併進加油站
OTHER_FUEL = re.compile(r"(?i)液化石油氣|液化氣|加氣|lpg|充電")


def fuel_brand(text):
    for b, p in FUEL_BRANDS:
        if re.search(p, text or ""):
            return b
    return ""


# ---- 多邊形（OSM 面狀類別；中介檔 pg = [[lat1, lon1, lat2, lon2, …], …]）
POLY_BUFFER = 30  # 公尺：多邊形外擴這麼多還包得到，就算包住（官方點常落在公墓、市場的出入口或路邊）


def rings_of(pg):
    return [list(zip(r[0::2], r[1::2])) for r in (pg or []) if len(r) >= 6]


def _in_ring(lat, lng, ring):
    inside = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def poly_dist(lat, lng, rings):
    """點到多邊形的距離（公尺），在裡面＝0。沒閉合的環（拼不起來的 relation 外框）只量到邊的距離"""
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    best = float("inf")
    for ring in rings:
        closed = ring[0] == ring[-1]
        if closed and _in_ring(lat, lng, ring):
            return 0.0
        for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
            ax, ay, bx, by = (x1 - lng) * kx, (y1 - lat) * ky, (x2 - lng) * kx, (y2 - lat) * ky
            dx, dy = bx - ax, by - ay
            t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def poly_bbox(rings):
    ys = [p[0] for r in rings for p in r]
    xs = [p[1] for r in rings for p in r]
    return min(ys), min(xs), max(ys), max(xs)


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


def load_cpc(raw):
    """台灣中油站點清冊（臺中市、營業中）"""
    return [c for c in json.load(open(os.path.join(raw, "cpc_stations.json"), encoding="utf-8-sig"))
            if c.get("縣市") in ("台中市", "臺中市") and str(c.get("營業中")) == "1"]


def osm_fuel_addr(geo, o):
    """OSM 加油站的門牌鍵（addr:street＋housenumber 優先，沒有再用 addr:full）"""
    return fuel_addr(geo, o.get("ad") or "") or fuel_addr(geo, o.get("af") or "")


def load_gas(raw, geo, report, osm=()):
    out = []
    d = json.load(open(os.path.join(raw, "moeaea_gas_all.json"), encoding="utf-8-sig"))["data"]
    report["versions"]["ea-gas"] = (d.get("UpdateTime") or "").replace("/", "-")
    cpc = load_cpc(raw)
    report["_cpc"] = cpc
    # OSM 加油站依門牌分組（門牌精確、但點位跟中油站點不一致時，拿來當第三個來源）
    osm_by_addr = collections.defaultdict(list)
    for o in osm:
        if o["k"] == "fuel":
            ak = osm_fuel_addr(geo, o)
            if ak:
                osm_by_addr[ak].append(o)
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
        # 合併用（2026-09-30）：地址鍵、品牌（站名帶的零售品牌優先，沒有就看供油商）、地址相同的中油站點座標
        akey = fuel_addr(geo, addr)
        brand = fuel_brand(name) or ("中油" if s.get("Market") == "台灣中油" else "台塑")
        cx = next((c for c in cpc if c.get("鄉鎮區") == town and akey and fuel_addr(geo, c.get("地址", "")) == akey), None)
        if cx and akey and how in ("geocode-exact", "geocode-base"):
            # 門牌精確對到，但同門牌的中油站點座標離門牌點 > 80 公尺，而且 OSM 同門牌的點就在中油座標 35 公尺內（也離門牌點 > 80 公尺）
            # → 兩個獨立來源一致，門牌點反而是偏的，改用中油座標（北區三民路三段 225 號大同站：門牌點離中油、OSM 約 120 公尺）
            ccy, ccx = float(cx["緯度"]), float(cx["經度"])
            if haversine(gy, gx, ccy, ccx) > 80:
                agree = [o for o in osm_by_addr.get(akey, ())
                         if haversine(o["y"], o["x"], ccy, ccx) <= 35 and 80 < haversine(o["y"], o["x"], gy, gx) <= 2000]
                if agree:
                    report["coord_fixed"].append({"s": "ea-gas", "n": name, "addr": addr, "off_m": round(haversine(gy, gx, ccy, ccx)),
                                                  "from": [round(gy, 5), round(gx, 5)], "to": [round(ccy, 5), round(ccx, 5)],
                                                  "osm": agree[0].get("oid"),
                                                  "why": "門牌精確，但中油同門牌站點、OSM 同門牌的點彼此 35 公尺內、都離門牌點 80 公尺以上，改用中油座標"})
                    gy, gx, how = ccy, ccx, "cpc-coord"
        r = rec("fuel", name, gy, gx, "ea-gas", addr=addr, dist=town, how=how, akey=akey, brand=brand)
        if cx:
            r["cpc_xy"] = (float(cx["緯度"]), float(cx["經度"]))
            r["cpc_id"] = cx.get("站代號")
            d_c = haversine(gy, gx, r["cpc_xy"][0], r["cpc_xy"][1])
            if d_c > 150:  # 能源署點位（門牌定位）跟同地址的中油站點差 > 150 公尺：只列出來（中油座標有差到 10 公里以上的，門牌精確的以門牌為準）
                report["fuel_cpc_mismatch"].append({"n": name, "addr": addr, "how": how, "cpc": cx.get("站名"), "off_m": round(d_c)})
        out.append(r)
    # 中油站點清冊裡有、能源署清冊沒有（地址對不上、60 公尺內也沒有能源署的站）：
    # 算「附近的官方站」時要一起算（安和路 49 之 5 號「市政站」、臺灣大道六段 75 號「統徠一站」）
    used = {r.get("cpc_id") for r in out if r.get("cpc_id")}
    orphans = []
    for c in cpc:
        try:
            cy, cxx = float(c["緯度"]), float(c["經度"])
        except (KeyError, ValueError):
            continue
        if c.get("站代號") in used or not in_tc_bbox(cy, cxx) or any(haversine(cy, cxx, r["y"], r["x"]) < 60 for r in out):
            continue
        orphans.append({"n": c.get("站名"), "addr": c.get("地址"), "y": cy, "x": cxx})
    report["cpc_orphans"] = orphans
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


# OSM 標成公墓（landuse=cemetery／amenity=grave_yard），名稱其實是骨灰存放設施 → 算殯葬設施（跟生命禮儀管理處、內政部清冊的納骨塔同一類）
COLUMBARIUM = re.compile(r"納骨|靈骨|骨灰|懷恩堂|追思堂|[靈寶]塔|塔$|堂$|生命紀念館|生命藝術館|紀念館$")
# 名稱同時有「墓園／公墓／墓地」、又沒寫納骨／靈骨／骨灰的（「大肚山墓園寶塔」多邊形 1.2 公里，是整座墓園）→ 還是算公墓
CEMETERY_WORD = re.compile(r"墓園|公墓|墓地")
EXPLICIT_BONE = re.compile(r"納骨|靈骨|骨灰")
H2_NAME = re.compile(r"加氫|氫能|氫氣")


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
        elif k == "fuel" and (it.get("h2") or (named and H2_NAME.search(n) and "加油" not in n)):
            why = "只供氫氣的加氫站（研究用，沒有汽柴油），不是一般加油站"
        if why:
            report["excluded"].append({"s": "osm", "id": oid, "k": k, "n": n, "why": why})
            continue
        if k == "cemetery" and named and COLUMBARIUM.search(n) and (EXPLICIT_BONE.search(n) or not CEMETERY_WORD.search(n)):
            report["reclassified"].append({"id": oid, "n": n, "from": "cemetery", "to": "funeral",
                                           "why": "OSM 標成公墓，名稱是骨灰存放設施（納骨堂、塔、生命紀念館）"})
            k = "funeral"
        r = rec(k, n, it["y"], it["x"], "osm", named=named, oid=oid, on=it.get("on"), op=it.get("op"), ad=it.get("ad"),
                af=it.get("af"), br=it.get("br"), bn=it.get("bn"))
        if it.get("pg"):
            r["rings"] = rings_of(it["pg"])
        out.append(r)
    return out


# ================================================================ 合併去重
# 宮廟名稱裡到處都有的字（福德、土地公、宮、廟…）拿掉，剩下的才拿來比（「信義街福德祠」「新庄仔福德祠」只有「福德」相同，不算同一間）
TEMPLE_GENERIC_TOKENS = re.compile(r"福德正神|福德|土地公|土地|伯公|萬善|萬應|有應|百姓|大眾爺|媽祖|王爺|[宮廟寺殿堂壇祠院觀巖岩庵亭府閣]")


def temple_core(k):
    c = TEMPLE_GENERIC_TOKENS.sub("", k)
    return c if len(c) >= 2 else ""


FUDE = re.compile(r"福德|土地公|土地廟|伯公")


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


POLY_CATS = {"cemetery", "funeral", "market"}


def names_compat(r, q):
    """兩筆名稱是不是講同一處（多邊形規則用來決定優先序、要不要列進 merge_doubt）"""
    if not (r["named"] and q["named"]):
        return True
    if r["k"] in ("cemetery", "funeral"):
        a, b = cem_sig(r["n"]), cem_sig(q["n"])
        if a[1] and b[1] and not (a[1] & b[1]):
            return False  # 編號不一樣（「東勢第一公墓」多邊形包住「東勢區第2公墓」）→ 列進 merge_doubt
        return name_key(r["n"]) == name_key(q["n"]) or cem_compat(a, b) or name_sim(a[2], b[2]) >= 0.4
    if r["k"] == "market":
        a, b = merge_key(r), merge_key(q)
        return (market_compat(market_sig(r["n"]), market_sig(q["n"])) or bool(GENERIC_MARKET.search(a) or GENERIC_MARKET.search(b))
                or name_sim(area_key(r["n"]), area_key(q["n"])) >= 0.5)
    return name_sim(merge_key(r), merge_key(q)) >= 0.4


def match(r, q, d, key_r, ctx):
    """r（後處理的那筆）能不能併進 q（已保留的那筆）。回傳 (tier, 規則, 名稱相似度, 疑慮) 或 None；tier 小的優先，同 tier 取最近"""
    k = r["k"]
    key_q = merge_key(q)
    r_osm, q_osm = r["s"] == "osm", q["s"] == "osm"
    cross = r_osm != q_osm

    # ---- A. 面狀類別：OSM 多邊形（外擴 30 公尺）包住另一筆的點 → 同一處
    if k in POLY_CATS and r_osm and d <= 1500:
        inside = ((r.get("rings") and poly_dist(q["y"], q["x"], r["rings"]) <= POLY_BUFFER)
                  or (q_osm and q.get("rings") and poly_dist(r["y"], r["x"], q["rings"]) <= POLY_BUFFER))
        if inside:
            ok = names_compat(r, q)
            return (0 if ok else 1, "polygon-contains" if cross else "osm-polygon-contains", None,
                    None if ok else "名稱對不上，但 OSM 多邊形包住另一筆的點")
        # 沒名字的公墓、市場多邊形，邊界離官方點 60 公尺內、中心 160 公尺內（官方點在入口、OSM 只畫了旁邊那一塊）
        if (k in ("cemetery", "market") and cross and not r["named"] and r.get("rings") and d <= 160
                and poly_dist(q["y"], q["x"], r["rings"]) <= 60):
            return (1, "polygon-near-60m", None, None)

    # ---- B. 加油站（o＝OSM、f＝能源署）
    if k == "fuel" and cross:
        o, f = (r, q) if r_osm else (q, r)
        oa, fa = o.get("akey"), f.get("akey")
        if oa and fa:
            if oa == fa:
                return (0, "fuel-same-addr", None, None) if d <= 500 else None
            return (1, "25m-fuel", None, None) if d < 25 else None  # 門牌不一樣（安和路 49-5 號 ↔ 51-8 號）：只剩 25 公尺規則
        cxy = f.get("cpc_xy")
        if cxy and d <= 400 and haversine(o["y"], o["x"], cxy[0], cxy[1]) <= 60:
            return (0, "fuel-cpc-anchor", None, None)
        if key_r and key_q and key_r == key_q and len(key_r) >= 2 and d <= 300:
            return (1, "fuel-samename", 1.0, None)
        if not OTHER_FUEL.search(o["n"] or "") and d <= 150:
            n250, n500 = ctx["fuel_near"](o)
            if d <= 120 and n250 == 1:
                return (2, "fuel-only-station-120m", None, None)
            ob = fuel_brand(" ".join(x for x in (o.get("br"), o["n"], o.get("op")) if x))
            if n500 == 1 and (not ob or ob == f.get("brand")):
                return (2, "fuel-only-station-150m", None, None)

    # ---- C. 公墓、殯葬：名稱正規化後同區同編號（或同名）→ 400 公尺內同一座
    if k in ("cemetery", "funeral") and cross and d <= 400 and r["named"] and q["named"]:
        # OSM 有畫範圍、官方點卻在範圍外 150 公尺以上：可能是同一座公墓的另一區，不併（列進報告 same_name_far）
        far = r.get("rings") and poly_dist(q["y"], q["x"], r["rings"]) > 150
        if not far and (name_key(r["n"]) == name_key(q["n"]) or cem_compat(cem_sig(r["n"]), cem_sig(q["n"]))):
            return (0, "cem-name-400m", None, None)

    # ---- D. 市場
    if k == "market":
        if cross and r["named"] and q["named"] and market_compat(market_sig(r["n"]), market_sig(q["n"])):
            off = q if r_osm else r
            if d <= (400 if off["s"] in ("tc-nm", "tc-vz") else 250):
                return (1, "market-name", None, None)
        if r_osm and q_osm:
            if not r["named"] and d < 60:
                return (1, "osm-unnamed-60m", None, None)
            # 沒名字的市場範圍，跟旁邊的市場（點或範圍）只隔 60 公尺內 → 同一個市場被拆開畫（新民街兩塊無名市場隔 36 公尺）
            if not r["named"] and d <= 250 and (
                    (r.get("rings") and poly_dist(q["y"], q["x"], r["rings"]) <= 60)
                    or (q.get("rings") and poly_dist(r["y"], r["x"], q["rings"]) <= 60)
                    or (r.get("rings") and q.get("rings") and poly_gap(r["rings"], q["rings"]) <= 60)):
                return (1, "osm-unnamed-adjacent-60m", None, None)
            if r["named"] and q["named"] and d <= 150:
                sr, sq = market_sig(r["n"]), market_sig(q["n"])
                if market_compat(sr, sq):
                    return (1, "osm-market-core", None, None)
                if (GENERIC_MARKET.search(key_r) or GENERIC_MARKET.search(key_q)) and sr[0] and sr[0] == sq[0]:
                    return (2, "osm-market-generic", None, None)

    # ---- E. OSM ↔ OSM 沒名字的同類點 10 公尺內：同一個東西標了兩次（高壓電塔、基地台一座挨一座，不套）
    if r_osm and q_osm and not r["named"] and d <= 10 and k not in ("tower", "mast"):
        return (1, "osm-unnamed-10m", None, None)

    # ---- G. 宮廟（2026-09-30 第三輪）
    if k == "temple":
        # OSM 標的門牌（addr:street＋housenumber 或 addr:full）跟官方寺廟登記地址同一個門牌 → 同一間
        # （北屯苧園巷 20 之 1 號：內政部「台中市玉佛寺」↔ OSM「觀世音皇母聖殿」相距 10 公尺）
        if cross and d <= 400 and r.get("taddr") and q.get("taddr") and r["taddr"] & q["taddr"]:
            return (0, "temple-same-addr", None, None)
        # 兩筆都是土地公廟、15 公尺內：同一間（東區「信義街福德祠」↔ OSM「新庄仔福德祠」8 公尺）
        if cross and d <= 15 and r["named"] and q["named"] and FUDE.search(r["n"]) and FUDE.search(q["n"]):
            return (1, "15m-temple-fude", None, None)
        # OSM 沒名字的宮廟，60 公尺內有 OSM 有名字的宮廟 → 同一間（官方 ↔ OSM 沒名字的本來就是 60 公尺）
        if r_osm and q_osm and not r["named"] and q["named"] and d < 60:
            return (1, "osm-temple-unnamed-60m", None, None)

    # ---- F. 2026-09-30 第一輪的規則（照舊）
    if d >= 400:
        return None
    if r_osm and q_osm:
        # OSM ↔ OSM：同名才併（乾靈寺 ×2、楊氏墓園宗祠 ×3、和平區清潔隊 ×3、上景興市場 A～F 區）
        lim = 250 if k in AREA_CATS else 150
        if (d < lim and key_r and key_r == key_q and len(key_r) >= 2
                and not GENERIC_AREA.search(key_r) and not (k == "temple" and GENERIC_TEMPLE.search(key_r))):
            return (1, "osm-samename", 1.0, None)
        return None
    sim = name_sim(key_r, key_q) if key_r and key_q else None
    if cross and k in AREA_CATS and sim is not None:
        # 面狀類別：拿掉「公有零售、攤販集中區、觀光」再比一次（「烏日第一公有零售市場」↔「烏日市場」）
        sim = max(sim, name_sim(area_key(r["n"]), area_key(q["n"])))
    # 官方 ↔ 官方：各自是登記在案的不同設施，名稱要很像才算重複（「新庄子永和宮」「新庄子福德祠」同一個門牌，是兩間廟）
    need = 0.4 if cross else 0.7
    arule = area_match(r, q, d) if cross and k in AREA_CATS else None
    if d < 60 and (sim is None or sim >= need):
        rule = "60m-unnamed" if sim is None else "60m-name"
    elif cross and k in AREA_CATS and d < 30 and sim is not None and sim >= 0.3:
        rule = "30m-area-name"  # 「南屯早市」↔「南屯市場」15 公尺
    elif cross and k == "fuel" and d < 25:
        rule = "25m-fuel"  # 品牌、站名寫法太多種（「福懋三益」↔ OSM「大甲站」brand=福懋，21 公尺）
    elif (cross and k == "temple" and d < 30 and key_r and key_q
          and temple_core(key_r) and temple_core(key_q) and bigrams(temple_core(key_r)) & bigrams(temple_core(key_q))):
        rule = "30m-temple-bigram"  # 「巧聖先師廟」↔「巧聖仙師廟」、「萬興宮媽祖廟」↔「社口萬興宮」
    elif not cross and d < 5 and key_r and key_q and len(os.path.commonprefix([key_r, key_q])) >= 4:
        rule = "same-spot-prefix"  # 同一個門牌、名稱開頭一樣（「大度山無主納骨堂前棟／後棟」）
    elif arule:
        rule = arule
    elif d >= 250:
        return None
    elif (cross and k in AREA_CATS and sim is not None
          and (key_r == key_q or (sim >= 0.9 and min(len(key_r), len(key_q)) >= 3))):
        rule = "250m-samename"
    elif (cross and k == "temple" and sim is not None and d < 150
          and key_r == key_q and len(key_r) >= 2 and not GENERIC_TEMPLE.search(key_r)):
        rule = "150m-temple-samename"  # OSM 的廟常標在廟埕或路邊，名稱完全一樣（去掉宮廟寺字尾）才算
    else:
        return None
    return (1, rule, sim, None)


def merge_order(r):
    """官方在前（官方 > OSM）；OSM 裡有專名的在前、只有通稱（早市、黃昏市場、公墓）的其次、沒名字的最後
    → 同一處的點會併進有名字的那一筆，不會留下「早市」或沒名字的點"""
    if r["s"] != "osm":
        return (PRIO[r["s"]], 0)
    if not r["named"]:
        return (PRIO["osm"], 2)
    key = merge_key(r)
    return (PRIO["osm"], 1 if (GENERIC_AREA.search(key) or GENERIC_MARKET.search(key)) else 0)


def merge(records, report, ctx=None):
    ctx = ctx or {}
    records.sort(key=merge_order)
    kept, grid, kept_ids = [], collections.defaultdict(list), set()
    cell = 0.004  # 約 400 公尺；一般規則查前後 2 格（約 800 公尺），有多邊形的再加上多邊形範圍涵蓋的格子
    for r in records:
        lab = LABEL_OF[r["k"]]
        key_r = merge_key(r)
        cy, cx = int(r["y"] / cell), int(r["x"] / cell)
        cells = {(cy + dy, cx + dx) for dy in range(-2, 3) for dx in range(-2, 3)}
        if r.get("rings"):
            y0, x0, y1, x1 = poly_bbox(r["rings"])
            pad = 0.0005
            cells |= {(a, b) for a in range(int((y0 - pad) / cell), int((y1 + pad) / cell) + 1)
                      for b in range(int((x0 - pad) / cell), int((x1 + pad) / cell) + 1)}
        best = None
        tgt = r.get("fuel_target")
        if tgt is not None and id(tgt) in kept_ids:
            # OSM 加油站的門牌跟能源署某一站一模一樣（2 公里內只有這一站）→ 就是那一站，不管點位差多遠
            # （霧峰 OSM「優立中交站」標 320 號、點位卻在 256 號「霧峰中投」旁邊：併進 320 號「中交」，兩站都保留）
            cells = ()
            best = (0, haversine(r["y"], r["x"], tgt["y"], tgt["x"]), tgt, "fuel-same-addr", None, None)
        for c in sorted(cells):
            for q in grid.get(c, ()):
                if LABEL_OF[q["k"]] != lab:
                    continue
                d = haversine(r["y"], r["x"], q["y"], q["x"])
                res = match(r, q, d, key_r, ctx)
                if res and (best is None or (res[0], d) < (best[0], best[1])):
                    best = (res[0], d, q, res[1], res[2], res[3])
        if best:
            _t, d, q, rule, sim, doubt = best
            q.setdefault("merged", []).append({"s": r["s"], "n": r["n"], "d": round(d, 1), "rule": rule})
            # 併進官方公墓的 OSM 範圍（area_center 用門牌決定點位要不要移進範圍）；名稱對不上的不算
            if rule in ("polygon-contains", "cem-name-400m") and r.get("rings") and not doubt:
                q.setdefault("absorbed_polys", []).append(r)
            entry = {"keep": {"s": q["s"], "n": q["n"], "y": round(q["y"], 5), "x": round(q["x"], 5), **({"id": q["oid"]} if q.get("oid") else {})},
                     "drop": {"s": r["s"], "n": r["n"], "y": round(r["y"], 5), "x": round(r["x"], 5), **({"id": r["oid"]} if r.get("oid") else {})},
                     "k": q["k"], "d": round(d, 1), "rule": rule, "sim": None if sim is None else round(sim, 2)}
            report["merge_log"].append(entry)
            report["merge_count"][f"{r['s']}→{q['s']}"] += 1
            report["merge_rules"][rule] += 1
            if doubt:
                report["merge_doubt"].append({**entry, "why": doubt})
            if rule == "fuel-same-addr" and d > 150:
                nb = ctx["fuel_nearest"](r) if "fuel_nearest" in ctx else None
                report["fuel_offset"].append({"n": q["n"], "addr": q.get("addr"), "osm": r.get("oid"), "osm_addr": r.get("ad") or r.get("af"),
                                              "off_m": round(d), "why": "OSM 標的門牌跟這一站一樣，點位卻差 > 150 公尺（能源署點位是門牌定位，照舊）",
                                              **({"osm_near": f"{nb[0]}（{round(nb[1])} 公尺）"} if nb else {})})
            continue
        kept.append(r)
        kept_ids.add(id(r))
        grid[(cy, cx)].append(r)
    return kept


def reclass_by_polygon(osm, official, report):
    """OSM 公墓多邊形只包住官方的殯葬設施（沒有包住官方公墓）、名稱核心有兩個字相同 → 其實是那處殯葬設施（金陵山宗教休閒園區）"""
    offs = [q for q in official if q["k"] in ("cemetery", "funeral")]
    for o in osm:
        if o["k"] != "cemetery" or not o.get("rings") or not o["named"]:
            continue
        inside = [q for q in offs if haversine(o["y"], o["x"], q["y"], q["x"]) <= 1500
                  and poly_dist(q["y"], q["x"], o["rings"]) <= POLY_BUFFER]
        if not inside or any(q["k"] == "cemetery" for q in inside):
            continue
        core = cem_sig(o["n"])[2]
        hit = next((q for q in inside if len(core) >= 2 and bigrams(core) & bigrams(cem_sig(q["n"])[2])), None)
        if hit:
            report["reclassified"].append({"id": o["oid"], "n": o["n"], "from": "cemetery", "to": "funeral",
                                           "why": f"OSM 公墓多邊形只包住官方殯葬設施「{hit['n']}」，名稱核心相同"})
            o["k"] = "funeral"


def ring_centroid(ring):
    a = cx = cy = 0.0
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return None if abs(a) < 1e-14 else (cy / (3 * a), cx / (3 * a))


class DoorScore:
    """用網站的門牌庫（Geocoder.grid，762,160 個門牌）評估公墓點位放哪裡比較好。
    「該看到這座公墓的門牌」＝離公墓範圍邊界 R 公尺內的門牌；點位放在某處時，其中有幾個門牌在點位 R 公尺內（查得到）。
    R 取頁面的 300、500 公尺兩種查詢範圍"""
    RS = (300, 500)

    def __init__(self, geo, rings):
        pad = max(self.RS)
        y0, x0, y1, x1 = poly_bbox(rings)
        ky, kx = pad / 110540, pad / (111320 * math.cos(math.radians((y0 + y1) / 2)))
        self.doors = []
        for gy in range(int((y0 - ky) * 200), int((y1 + ky) * 200) + 1):
            for gx in range(int((x0 - kx) * 200), int((x1 + kx) * 200) + 1):
                for (y, x, _d) in geo.grid.get((gy, gx), ()):
                    if y0 - ky <= y <= y1 + ky and x0 - kx <= x <= x1 + kx:
                        e = poly_dist(y, x, rings)
                        if e <= pad:
                            self.doors.append((y, x, e))
        self.total = tuple(sum(1 for d in self.doors if d[2] <= R) for R in self.RS)

    def hits(self, lat, lng):
        return tuple(sum(1 for (y, x, e) in self.doors if e <= R and haversine(lat, lng, y, x) <= R) for R in self.RS)


def area_center(kept, official, geo, report):
    """公墓：OSM 範圍併進官方公墓之後，點位要不要改放範圍中心。
    2026-09-30 第三輪查核：全部改放中心的話，300 公尺內查得到公墓的門牌從 43% 掉到 30%（官方點多在路邊、入口，住家也在那一側；
    範圍中間幾乎沒有住家）→ 改成逐座用門牌算：範圍中心（各塊範圍的中心、OSM 點）在 300、500 公尺兩種查詢範圍
    都比官方點查到更多「該看到這座公墓的門牌」才移動，數字寫進報告 coord_area_center（沒移動的在 coord_area_kept）。
    範圍：多邊形包住官方點、同名 400 公尺內、同區同編號 1.5 公里內併進來的 OSM 範圍，併進好幾塊的當成同一片一起算
    （merge_same_number 併進來的，官方點常在範圍外：清水第十二公墓範圍 300 公尺內有 589 個門牌，不看門牌直接併會整片查不到）。
    範圍裡有別的官方公墓（一片範圍跨兩座）、官方點離範圍邊界超過 400 公尺的，照官方點"""
    offc = [q for q in official if q["k"] == "cemetery"]
    moved = collections.Counter()
    for q in kept:
        polys = q.get("absorbed_polys") or []
        if q["s"] == "osm" or q["k"] != "cemetery" or not polys:
            continue
        rings = [ring for p in polys for ring in p["rings"]]
        others = [o for o in offc if o is not q and any(haversine(o["y"], o["x"], p["y"], p["x"]) <= 2000 for p in polys)
                  and poly_dist(o["y"], o["x"], rings) <= POLY_BUFFER]
        if others or poly_dist(q["y"], q["x"], rings) > 400:
            continue
        cands = []
        for ring in rings:
            c = ring_centroid(ring) if len(ring) >= 4 and ring[0] == ring[-1] else None
            if c is not None and poly_dist(c[0], c[1], rings) == 0:
                cands.append(c)
        cands += [(p["y"], p["x"]) for p in polys if poly_dist(p["y"], p["x"], rings) == 0]
        cands = [c for c in cands if haversine(q["y"], q["x"], c[0], c[1]) > 50]
        if not cands:
            continue
        sc = DoorScore(geo, rings)
        h_off = sc.hits(q["y"], q["x"])
        h_c, c = max(((sc.hits(c[0], c[1]), c) for c in cands), key=lambda t: t[0])
        dm = haversine(q["y"], q["x"], c[0], c[1])
        ids = [p["oid"] for p in polys]
        base = {"s": q["s"], "n": q["n"], "osm": ids[0], **({"osm_more": ids[1:]} if len(ids) > 1 else {}),
                # [該看到這座公墓的門牌數, 官方點查得到, 範圍中心查得到]
                "doors": {str(R): [sc.total[i], h_off[i], h_c[i]] for i, R in enumerate(DoorScore.RS)}}
        if all(h_c[i] > h_off[i] for i in range(len(DoorScore.RS))):
            report["coord_area_center"].append({**base, "moved_m": round(dm),
                                                "from": [round(q["y"], 5), round(q["x"], 5)], "to": [round(c[0], 5), round(c[1], 5)],
                                                "why": "範圍中心在 300、500 公尺都比官方點查到更多該看到這座公墓的門牌"})
            q["y"], q["x"] = c
            moved[q["s"]] += 1
        else:
            report["coord_area_kept"].append({**base, "at": [round(q["y"], 5), round(q["x"], 5)],
                                              "center": [round(c[0], 5), round(c[1], 5)], "center_m": round(dm),
                                              "why": "範圍中心沒有在 300、500 公尺都查到比官方點多的門牌，留在官方點"})
    return moved


def poly_gap(ra, rb):
    """兩個多邊形邊界的距離（公尺，近似：各自的頂點到對方的距離取最小；重疊＝0）"""
    best = float("inf")
    for a, b in ((ra, rb), (rb, ra)):
        for ring in a:
            for y, x in ring[::max(1, len(ring) // 60)]:
                best = min(best, poly_dist(y, x, b))
                if best == 0:
                    return 0.0
    return best


def merge_fragments(kept, report):
    """同一片公墓在 OSM 被拆成好幾塊畫：沒名字的碎塊，邊界離「已經併進官方公墓的那片範圍」30 公尺內、
    中心離那個官方點（area_center 移過的是移動後的點）300 公尺內 → 也併進去（只看直接相鄰，不一路串下去）"""
    hubs = [q for q in kept if q["s"] != "osm" and q["k"] == "cemetery" and q.get("absorbed_polys")]
    out = []
    for r in kept:
        if r["s"] == "osm" and r["k"] == "cemetery" and not r["named"] and r.get("rings"):
            hit = None
            for q in hubs:
                d = haversine(r["y"], r["x"], q["y"], q["x"])
                if d <= 300 and (hit is None or d < hit[0]) and any(poly_gap(r["rings"], p["rings"]) <= POLY_BUFFER for p in q["absorbed_polys"]):
                    hit = (d, q)
            if hit:
                d, q = hit
                entry = {"keep": {"s": q["s"], "n": q["n"], "y": round(q["y"], 5), "x": round(q["x"], 5)},
                         "drop": {"s": "osm", "n": r["n"], "y": round(r["y"], 5), "x": round(r["x"], 5), "id": r["oid"]},
                         "k": q["k"], "d": round(d, 1), "rule": "osm-fragment-adjacent", "sim": None}
                report["merge_log"].append(entry)
                report["merge_count"]["osm→" + q["s"]] += 1
                report["merge_rules"]["osm-fragment-adjacent"] += 1
                continue
        out.append(r)
    return out


def group_cemetery_fragments(osm, geo, report):
    """（合併前）同一片公墓在 OSM 被拆成好幾塊畫（北屯 w315533659～62 四塊、彼此隔 15～19 公尺，都沒名字）：
    公墓範圍之間邊界 30 公尺內、至少一塊沒名字 → 併成一筆，範圍取所有碎塊（之後跟官方點比對用整片範圍）。
    一組最多一塊有名字（兩塊有名字的不同公墓緊鄰，不互併）。
    點位：有名字的那一塊；都沒名字 → 各塊的中心（OSM 點）裡，300 公尺（再看 500 公尺）查得到最多「該看到這片公墓的門牌」的那一個"""
    cands = [o for o in osm if o["k"] == "cemetery" and o.get("rings")]
    pad_y = POLY_BUFFER / 110540
    boxes = []
    for o in cands:
        y0, x0, y1, x1 = poly_bbox(o["rings"])
        pad_x = POLY_BUFFER / (111320 * math.cos(math.radians(y0)))
        boxes.append((y0 - pad_y, x0 - pad_x, y1 + pad_y, x1 + pad_x))
    edges = []
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            a, b = cands[i], cands[j]
            if a["named"] and b["named"]:
                continue
            A, B = boxes[i], boxes[j]
            if A[0] > B[2] or B[0] > A[2] or A[1] > B[3] or B[1] > A[3]:
                continue
            g = poly_gap(a["rings"], b["rings"])
            if g <= POLY_BUFFER:
                edges.append((g, i, j))
    parent = list(range(len(cands)))
    named = [1 if o["named"] else 0 for o in cands]

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for _g, i, j in sorted(edges):
        a, b = find(i), find(j)
        if a != b and named[a] + named[b] <= 1:
            parent[b] = a
            named[a] += named[b]
    groups = collections.defaultdict(list)
    for i, o in enumerate(cands):
        groups[find(i)].append(o)
    drop = set()
    for g in groups.values():
        if len(g) < 2:
            continue
        rings = [ring for o in g for ring in o["rings"]]
        nm = [o for o in g if o["named"]]
        if nm:
            rep, how = nm[0], "有名字的那一塊"
        else:
            sc = DoorScore(geo, rings)
            rep = max(g, key=lambda o: sc.hits(o["y"], o["x"]))
            how = "查得到最多門牌的那一塊"
        rep["rings"] = rep["rings"] + [ring for o in g if o is not rep for ring in o["rings"]]
        for o in g:
            if o is rep:
                continue
            drop.add(id(o))
            d = haversine(o["y"], o["x"], rep["y"], rep["x"])
            entry = {"keep": {"s": "osm", "n": rep["n"], "y": round(rep["y"], 5), "x": round(rep["x"], 5), "id": rep["oid"]},
                     "drop": {"s": "osm", "n": o["n"], "y": round(o["y"], 5), "x": round(o["x"], 5), "id": o["oid"]},
                     "k": "cemetery", "d": round(d, 1), "rule": "osm-fragment-30m", "sim": None, "why": "點位用" + how}
            report["merge_log"].append(entry)
            report["merge_count"]["osm→osm"] += 1
            report["merge_rules"]["osm-fragment-30m"] += 1
    return [o for o in osm if id(o) not in drop]


def merge_same_number(kept, geo, report):
    """（合併後）同區同編號的 OSM 公墓，離同編號的官方公墓 1.5 公里內 → 併進去（查詢時不會同時出現「清水區第十公墓」「清水區第10公墓」）。
    已經併過同名範圍的那一筆優先（清水第十公墓另一塊範圍已併進官方「第10公墓」），其次最近。
    OSM 名稱沒寫區名的，官方那一筆要在 OSM 點最近門牌所在的區"""
    offs = [q for q in kept if q["s"] != "osm" and q["k"] == "cemetery"]
    out = []
    for r in kept:
        if r["s"] == "osm" and r["k"] == "cemetery" and r["named"]:
            sr = cem_sig(r["n"])
            if sr[1]:
                here = sr[0] or (geo.nearest_dist(r["y"], r["x"])[0] or "")[:-1]
                c = []
                for q in offs:
                    d = haversine(r["y"], r["x"], q["y"], q["x"])
                    sq = cem_sig(q["n"])
                    if d > 1500 or not cem_compat(sr, sq) or (sq[0] and sq[0] != here):
                        continue
                    had = any(m["s"] == "osm" and cem_compat(sr, cem_sig(m["n"])) for m in q.get("merged", ()))
                    c.append((0 if had else 1, d, q))
                if c:
                    tier, d, q = min(c, key=lambda t: (t[0], t[1]))
                    q.setdefault("merged", []).append({"s": "osm", "n": r["n"], "d": round(d, 1), "rule": "cem-samenum-1500m"})
                    if r.get("rings"):
                        q.setdefault("absorbed_polys", []).append(r)  # 點位要不要移進這個範圍，交給 area_center 用門牌算
                    report["merge_log"].append({
                        "keep": {"s": q["s"], "n": q["n"], "y": round(q["y"], 5), "x": round(q["x"], 5)},
                        "drop": {"s": "osm", "n": r["n"], "y": round(r["y"], 5), "x": round(r["x"], 5), "id": r["oid"]},
                        "k": "cemetery", "d": round(d, 1), "rule": "cem-samenum-1500m", "sim": None,
                        "why": "同區同編號，官方那一筆已經併過同名範圍" if tier == 0 else "同區同編號，1.5 公里內最近的官方公墓"})
                    report["merge_count"]["osm→" + q["s"]] += 1
                    report["merge_rules"]["cem-samenum-1500m"] += 1
                    continue
        out.append(r)
    return out


# 能源署清冊有、但清冊地址定不到門牌的加油站 → 由人工核對過的 OSM 點代表（OSM 編號 → 能源署站名）。
# 2026-09-30：台亞關連加油站，清冊寫「梧棲區臨港路二段70號」門牌庫沒有這一號；OSM w857935070
# （無名、無地址）就在臨港路上，是同一站。沒有這條，白名單會把它當成可能已歇業排除。
FUEL_MANUAL_LINK = {"w857935070": "台亞關連加油站"}


def fuel_whitelist(kept, official, cpc, geo, report):
    """（合併後）OSM 加油站白名單（比照醫院、掩埋場）：合併後還留著的 OSM 站，只收
      1. 跟能源署或中油營業中站點同門牌（2 公里內）
      2. 離中油營業中站點 60 公尺內
    其他排除（OSM 上已歇業的站常沒人刪；大里中興路二段 186 號、西屯環中路三段 800 號兩份清冊都沒有），列入報告 excluded"""
    ea = [r for r in official if r["k"] == "fuel"]
    cp = []
    for c in cpc:
        try:
            cp.append((float(c["緯度"]), float(c["經度"]), c.get("站名", ""), fuel_addr(geo, c.get("地址", ""))))
        except (KeyError, ValueError):
            pass
    ver = report["versions"].get("ea-gas") or ""
    out = []
    for r in kept:
        if r["s"] != "osm" or r["k"] != "fuel":
            out.append(r)
            continue
        ok = None
        ak = r.get("akey")
        if ak:
            e = next((e for e in ea if e.get("akey") == ak and haversine(r["y"], r["x"], e["y"], e["x"]) <= 2000), None)
            c = next((c for c in cp if c[3] == ak and haversine(r["y"], r["x"], c[0], c[1]) <= 2000), None)
            if e:
                ok = f"跟能源署「{e['n']}」同門牌"
            elif c:
                ok = f"跟中油站點「{c[2]}」同門牌"
        near_c = min(((haversine(r["y"], r["x"], c[0], c[1]), c[2]) for c in cp), default=None)
        if not ok and near_c and near_c[0] <= 60:
            ok = f"離中油站點「{near_c[1]}」{round(near_c[0])} 公尺"
        if not ok and r.get("oid") in FUEL_MANUAL_LINK:
            # 能源署清冊有、但清冊地址定不到門牌的站：地圖上只能靠 OSM 那一點代表它（人工核對過）
            official_name = FUEL_MANUAL_LINK[r["oid"]]
            ok = f"能源署清冊「{official_name}」地址定不到門牌，人工核對 OSM 這一點就是該站"
            r["n"] = official_name
        if ok:
            report["fuel_osm_kept"].append({"id": r.get("oid"), "n": r["n"], "why": ok})
            out.append(r)
            continue
        near_e = min(((haversine(r["y"], r["x"], e["y"], e["x"]), e["n"]) for e in ea), default=None)
        why = f"能源署 {ver} 加油站清冊、中油營業中站點清冊都沒有（沒有同門牌的站，60 公尺內也沒有中油站點），可能已歇業"
        if OTHER_FUEL.search(r["n"] or ""):
            why = "液化石油氣加氣站：" + why + "；加氣站要不要算加油站另外決定"
        report["excluded"].append({"s": "osm", "id": r.get("oid"), "k": "fuel", "n": r["n"],
                                   "addr": r.get("af") or r.get("ad"), "why": why,
                                   "nearest": ", ".join(x for x in (
                                       f"能源署「{near_e[1]}」{round(near_e[0])} 公尺" if near_e else "",
                                       f"中油「{near_c[1]}」{round(near_c[0])} 公尺" if near_c else "") if x)})
    return out


def near_pairs(kept):
    """合併後同類、60～400 公尺、至少一筆是 OSM 的點對（公墓、殯葬、市場、加油站）：給人工抽查有沒有漏合"""
    cats = {"cemetery", "funeral", "market", "fuel"}
    pts = [r for r in kept if r["k"] in cats]
    grid = collections.defaultdict(list)
    for i, r in enumerate(pts):
        grid[(int(r["y"] / 0.004), int(r["x"] / 0.004))].append((i, r))
    out = []
    for i, r in enumerate(pts):
        cy, cx = int(r["y"] / 0.004), int(r["x"] / 0.004)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j, q in grid.get((cy + dy, cx + dx), ()):
                    if j <= i or LABEL_OF[q["k"]] != LABEL_OF[r["k"]] or (r["s"] != "osm" and q["s"] != "osm"):
                        continue
                    d = haversine(r["y"], r["x"], q["y"], q["x"])
                    if 60 <= d <= 400:
                        out.append({"k": r["k"], "d": round(d),
                                    "a": {"s": r["s"], "n": r["n"], "id": r.get("oid"), "y": round(r["y"], 5), "x": round(r["x"], 5)},
                                    "b": {"s": q["s"], "n": q["n"], "id": q.get("oid"), "y": round(q["y"], 5), "x": round(q["x"], 5)}})
    out.sort(key=lambda p: (p["k"], p["d"]))
    return out


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
              "merge_log": [], "merge_count": collections.Counter(), "temple_offset": [], "versions": {},
              "reclassified": [], "merge_rules": collections.Counter(), "merge_doubt": [], "fuel_offset": [], "fuel_cpc_mismatch": [],
              "cpc_orphans": [], "coord_area_center": [], "coord_area_kept": [], "fuel_osm_kept": []}
    geo = Geocoder(ADDR_DIR)

    t0 = time.time()
    osm = load_osm(args, cache, report)  # 先讀：寺廟官方座標要拿 OSM 同名點做第三方驗證
    mort = load_mortuary(raw, geo, report)
    official = []
    official += mort
    official += load_moi_funeral(raw, geo, mort, report)
    official += load_temples(raw, geo, report, osm)
    official += load_gas(raw, geo, report, osm)
    official += load_markets(raw, geo, report)
    official += load_hospitals(raw, geo, report)
    official += load_landfills(raw, geo, report)
    print(f"  讀入：官方 {len(official):,} 筆、OSM {len(osm):,} 筆（{time.time() - t0:.1f}s）")

    # 定位方法統計
    how = collections.Counter((r["s"], r.get("how", "official").split("-")[-1] if r.get("how", "").startswith("geocode") else r.get("how", "official")) for r in official)

    # near 定位改挑同一側門牌：實際用到的官方點逐筆列出（移動 > 150 公尺的另外標 big）
    near_fixed = []
    for r in official:
        lg = geo.near_log.get(r.get("addr"))
        if lg and str(r.get("how", "")).endswith("near"):
            near_fixed.append({"s": r["s"], "k": r["k"], "n": r["n"], **lg, **({"big": True} if lg["moved_m"] > 150 else {})})

    # 合併前準備：OSM 加油站的地址鍵；OSM 公墓多邊形只包住官方殯葬設施的改歸殯葬
    ea_by_addr = collections.defaultdict(list)
    for r in official:
        if r["k"] == "fuel" and r.get("akey"):
            ea_by_addr[r["akey"]].append(r)
    for o in osm:
        if o["k"] == "fuel":
            o["akey"] = osm_fuel_addr(geo, o)
            t = [r for r in ea_by_addr.get(o["akey"], ()) if haversine(o["y"], o["x"], r["y"], r["x"]) <= 2000] if o["akey"] else []
            if len(t) == 1:
                o["fuel_target"] = t[0]
    # 宮廟門牌鍵（官方：登記地址；OSM：addr:street＋housenumber、addr:full 兩個都算，OSM 常有錯字「芋園巷」↔ addr:full「苧園巷」）
    for r in official:
        if r["k"] == "temple":
            r["taddr"] = {fuel_addr(geo, r.get("addr") or "")} - {""}
    for o in osm:
        if o["k"] == "temple":
            o["taddr"] = {fuel_addr(geo, o.get("ad") or ""), fuel_addr(geo, o.get("af") or "")} - {""}
    reclass_by_polygon(osm, official, report)
    osm = group_cemetery_fragments(osm, geo, report)
    fuel_pts = [(r["y"], r["x"]) for r in official if r["k"] == "fuel"] + [(c["y"], c["x"]) for c in report["cpc_orphans"]]
    fuel_cache = {}

    def fuel_near(o):
        """OSM 加油站 250／500 公尺內有幾個官方站（能源署＋中油站點清冊裡能源署沒收的）"""
        if id(o) not in fuel_cache:
            ds = [haversine(o["y"], o["x"], y, x) for y, x in fuel_pts]
            fuel_cache[id(o)] = (sum(1 for d in ds if d <= 250), sum(1 for d in ds if d <= 500))
        return fuel_cache[id(o)]

    def fuel_nearest(o):
        return min(((r["n"], haversine(o["y"], o["x"], r["y"], r["x"])) for r in official if r["k"] == "fuel"), key=lambda t: t[1], default=None)

    kept = merge(official + osm, report, {"fuel_near": fuel_near, "fuel_nearest": fuel_nearest})
    kept = merge_same_number(kept, geo, report)
    area_moved = area_center(kept, official, geo, report)
    kept = merge_fragments(kept, report)
    kept = fuel_whitelist(kept, official, report["_cpc"], geo, report)

    # 同名（同區同編號）的 OSM 公墓跟官方點超過 400 公尺、多邊形也沒包住 → 沒有合併，列出來人工看
    same_name_far = []
    offc = [r for r in official if r["k"] in ("cemetery", "funeral")]
    for o in kept:
        if o["s"] != "osm" or o["k"] not in ("cemetery", "funeral") or not o["named"]:
            continue
        so = cem_sig(o["n"])
        for r in offc:
            d = haversine(o["y"], o["x"], r["y"], r["x"])
            if d <= 3000 and so[1] and cem_compat(so, cem_sig(r["n"])):
                same_name_far.append({"osm": o["oid"], "n": o["n"], "official": r["n"], "s": r["s"], "d": round(d),
                                      "edge_m": round(poly_dist(r["y"], r["x"], o["rings"])) if o.get("rings") else None})

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
        if area_moved.get(s["id"]) and o.get("geo"):
            # 公墓跟 OSM 範圍併成一筆、點位改放範圍中心的（area_center），照實寫出來
            # 只寫實際移動的筆數；移不移動是逐座用門牌算的（area_center），不是全部改放中心
            o["geo"] += (f"；其中 {area_moved[s['id']]} 處公墓的官方點在墓地邊上或外面，改放在 OpenStreetMap 畫的墓地範圍中心，"
                         "附近查得到這座公墓的門牌比較多")
        if s["id"] == "tc-vz":
            # 清冊原名有「籌設」兩個字，容易被讀成還在規劃中：用實際收進來的點說明
            names = [it["n"] for it in items if it["s"] == "tc-vz"]
            n_dup = sum(1 for d in report["dup_official"] if d["s"] == "tc-vz")
            n_un = sum(1 for u in report["unresolved"] if u["s"] == "tc-vz")
            rest = "，".join(x for x in ([f"{n_dup} 處跟〈臺中市列管夜市〉重複只留一筆"] if n_dup else [])
                             + ([f"{n_un} 處只寫路段、定不到位置"] if n_un else []))
            short_names = "、".join(re.sub(r"攤販集中區$", "", x) for x in names)
            o["note"] = (f"清冊原名，頁面其他地方簡稱「{s['short']}」；本頁收{short_names} {len(names)} 處，清冊都列有自治會長與營業時段"
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
        # 2026-09-30 第二輪
        "reclassified": report["reclassified"],
        "merge_rules": dict(report["merge_rules"].most_common()),
        "merge_doubt": report["merge_doubt"],
        "fuel_offset": report["fuel_offset"],
        "fuel_cpc_mismatch": report["fuel_cpc_mismatch"],
        "same_name_far": same_name_far,
        "coord_area_center": report["coord_area_center"],
        "coord_area_kept": report["coord_area_kept"],
        "fuel_osm_kept": report["fuel_osm_kept"],
        "near_side_fixed": near_fixed,
        "cpc_orphans": report["cpc_orphans"],
        "near_pairs_60_400m": near_pairs(kept),
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
    print(f"  改類別 {len(report['reclassified'])} 筆、門牌改挑同一側 {len(near_fixed)} 筆（移動 > 150 公尺 {sum(1 for x in near_fixed if x.get('big'))} 筆）、"
          f"合併有疑慮 {len(report['merge_doubt'])} 筆、同名沒併 {len(same_name_far)} 筆、加油站點位待看 {len(report['fuel_offset'])} 筆、"
          f"公墓點位改放範圍中心 {len(report['coord_area_center'])} 筆（留在官方點 {len(report['coord_area_kept'])} 筆）、"
          f"OSM 加油站白名單收 {len(report['fuel_osm_kept'])} 站")
    print("  合併規則：" + "、".join(f"{k} {v}" for k, v in report["merge_rules"].most_common()))
    print(f"  報告：{os.path.join(cache, 'report.json')}")
    if args.dry_run:
        print("  （--dry-run：不寫網站檔）")
        return
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"  寫出 {args.out}")


if __name__ == "__main__":
    main()
