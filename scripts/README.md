# scripts/

teddy-website 維護腳本。

## ⚠️ 物件（src/content/properties）不是這個資料夾產生的

`sync_properties_from_nas.py` 只是 2026-05 的規劃稿（stub，跑了只會印四行），**不要改它**。
真正每晚 20:11 產生 / 更新物件 md 與 public/properties 照片的管線在 repo 外面：

| 角色 | 路徑 |
|---|---|
| 排程入口 | `C:\Users\a0920\房仲工作站\450_上架巡檢\nightly_run.py`（step 4–7：產 md → 標 stale → git commit/push） |
| 同事物件產生器 | `C:\Users\a0920\.claude\skills\properties-sync\scripts\apply_utrust.py`（`gen_md()`，delta-only：只吃今晚新增） |
| 自家物件產生器 | `C:\Users\a0920\.claude\skills\properties-sync\scripts\nas_generate.py` |
| 既有 md 重產 | 同目錄 `finalize_mds.py`（importlib 載入 apply_utrust 的 gen_md） |

要改物件文案的清洗規則（門牌 / 同事電話 / 誇大詞 / 漲跌預測）→ 改 `apply_utrust.py`，
不要手改 `src/content/properties/*.md`（下次 sync 會被覆寫）。
`audit-properties.mjs` 是閘門：deploy.yml 與 `pnpm run build` 都會跑，有 ERROR 就擋部署。

## 法規 / SEO 自動化

| 腳本 | 用途 | 跑頻率 |
|---|---|---|
| `audit-properties.mjs` | 物件法規閘門：完整門牌 / 非白名單手機 / 「經紀人：」非黃永隆 / 誇大詞 / 漲跌預測 / 內部用語 = **ERROR 擋 build**；預售敏感詞 / 議價 / 第三人聯絡引導 = WARN | 每次 deploy（deploy.yml、`pnpm run build`）；本機看報告用 `--warn-only` |
| `lint-seo.mjs` | 文章紅線 + SEO meta lint（編造客戶故事 / 同業比較 / 教議價 = ERROR；估價、誇大詞 = WARNING） | 每次 deploy |
| `sitemap-lastmod.mjs` | 給 astro.config.ts sitemap 用：lastmod 對照表（只算已發布、排程文與草稿不算、絕不超過 build 時間）+ 薄 tag（<3 篇）集合 | build 時自動 |
| `generate-og-thumbs.mjs` | /og/*.jpg → /og/thumbs/*.webp 列表縮圖 | 每次 deploy |
| `postbuild-headers.mjs` | dist/_headers.txt → _headers、_redirects、站內連結補尾斜線、pagefind copy | 每次 deploy |
| `fix_address_leak.py` | 一次性補救：把 properties md 裡的完整門牌砍到路段（產生端已套同一條 regex） | 手動 |

## 使用

```bash
# 物件法規 audit（有 ERROR → exit 1）
node scripts/audit-properties.mjs
node scripts/audit-properties.mjs --warn-only   # 只看報告不擋
# 輸出：audit/audit-{date}.md + .json（audit/ 已 gitignore，CI 用 artifact 收）

# SEO lint
node scripts/lint-seo.mjs
# 輸出：stdout markdown report
# exit 1 = 有 ERROR
```

## 閘門順序（package.json `build` = deploy.yml，兩邊一起改）

```
lint-seo → audit-properties → generate-og-thumbs → astro check → astro build → pagefind → postbuild-headers
```

## 規則設計原則

- **白名單優先**：例如景泰本人電話 0920-118-756、店電 04-2312-0888 加白名單避免誤報
- **詞表三處一致**：audit（這裡）/ 物件頁渲染層過濾 / properties-sync 產生腳本清洗 用同一組誇大詞、預測詞、聯絡、內部用語詞表
- **dedup**：同 file + 同 rule + 同 matched 只算 1 筆
- **嚴重度分層**：ERROR (擋 build) / WARN (人工複審)
- **false positive 友善**：報告附「人工複審提示」說明 WARN 類可忽略的類型；ERROR 類沒有例外
