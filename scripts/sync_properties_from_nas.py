#!/usr/bin/env python3
r"""
⛔ 這是 2026-05 的規劃稿（stub），從來沒實作、也不在任何排程裡。不要改這裡。

真正每晚 20:11 產生 src/content/properties/*.md 與 public/properties 照片的管線在 repo 外面：
  - 排程入口：C:\Users\a0920\房仲工作站\450_上架巡檢\nightly_run.py（step 4–7：產 md → 標 stale → git commit/push）
  - 同事物件：C:\Users\a0920\.claude\skills\properties-sync\scripts\apply_utrust.py  gen_md()（delta-only）
  - 自家物件：C:\Users\a0920\.claude\skills\properties-sync\scripts\nas_generate.py
  - 既有 md 重產：同目錄 finalize_mds.py（importlib 載入 apply_utrust 的 gen_md）
要改文案清洗規則（門牌 / 同事電話 / 誇大詞 / 漲跌預測）去改 apply_utrust.py，不要手改 md；
repo 這邊的閘門是 scripts/audit-properties.mjs（deploy 前有 ERROR 就擋）。
詳見 scripts/README.md。

--------------------------------------------------------------------------
（以下為 2026-05 原規劃稿，保留當歷史紀錄）

NAS → properties content collection ETL（草稿，等真實資料再啟用）

從 NAS 個人格（景泰個人格 23.景泰 / 01.在售物件）讀物件資料夾，
產生 Astro content collection 的 markdown 檔到 `src/content/properties/`。

⚠️ 還沒實作 — 等以下準備好再動工：
1. NAS 物件資料夾盤點完成（哪些有照片、PDF、xlsx）
2. 法規 audit 過：哪些欄位可公開、哪些必須屏蔽（屋主資訊絕對不放）
3. 照片壓縮策略決定（直接 copy 還是上 Cloudflare Images）

## 使用方式（規劃中）

```bash
cd C:/Users/a0920/teddy-website
python scripts/sync_properties_from_nas.py --dry-run   # 預覽會生成什麼
python scripts/sync_properties_from_nas.py             # 實際寫入
python scripts/sync_properties_from_nas.py --status active  # 只同步 active 物件
```

## 資料對應（規劃）

NAS 物件資料夾命名 `[總價]萬-[賣點]([委編])`，例：
    `1280萬-北屯輕屋齡屋況最優(UG1195643)`

→ 解析出：
- totalPrice: 1280
- title: 「北屯輕屋齡，屋況最優」
- listingCode: UG1195643

NAS 內容對應 frontmatter:
- 個案明細表.pdf → 讀規格（坪數/格局/屋齡/樓層/車位）
- 照片/*.jpg → photos 陣列 + 第一張當 coverImage
- 廣告文案.txt → description
- 賣點清單.txt → highlights (line-by-line)

## 法規 checklist（必過）

- ❌ 不放屋主姓名 / 電話
- ❌ 不放完整門牌
- ❌ 不放建案案名
- ✅ 經紀人 + 營業員證號必載
- ✅ 區域 + 路段（不含門牌）可公開
- ✅ 社區名擇優公開（中性社區 OK，敏感社區跳過）

## TODO

- [ ] NAS 路徑掃描 + 資料夾命名 regex parse
- [ ] PDF 規格表 OCR / 結構化擷取（pdfplumber 或 pdf2image+ocr）
- [ ] 照片複製 → src/content/properties/{slug}/photos/
- [ ] markdown frontmatter 組裝
- [ ] 法規 audit 邏輯
- [ ] --dry-run 模式
- [ ] git commit + push（觸發 Cloudflare Pages 自動部署）
"""

import sys


def main():
    print("[stub] 這支從沒實作，也不在排程裡。")
    print("[stub] 真正的產生器：~/.claude/skills/properties-sync/scripts/apply_utrust.py（同事）/ nas_generate.py（自家）")
    print("[stub] 排程入口：房仲工作站/450_上架巡檢/nightly_run.py；閘門：scripts/audit-properties.mjs")
    print("[stub] 詳見 scripts/README.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
