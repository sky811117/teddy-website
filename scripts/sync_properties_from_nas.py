#!/usr/bin/env python3
"""
NAS → properties content collection ETL（草稿，等真實資料再啟用）

從 NAS 個人格 `\\Hbnas\h&b共用\23.景泰\01.在售物件\` 讀物件資料夾，
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
    print("[stub] NAS → properties ETL 還沒實作。")
    print("[stub] 路徑：\\\\Hbnas\\h&b共用\\23.景泰\\01.在售物件\\")
    print("[stub] 輸出：src/content/properties/*.md")
    print("[stub] 等景泰盤點完 NAS + 決定法規 audit 規則再開工。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
