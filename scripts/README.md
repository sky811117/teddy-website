# scripts/

teddy-website 維護腳本。

## 法規 / SEO 自動化

| 腳本 | 用途 | 跑頻率 |
|---|---|---|
| `audit-properties.mjs` | 物件法規合規掃描（屋主隱私 / 廣告誇大 / 預售敏感詞 / 證號揭露） | 月初 + 大量上架後 |
| `lint-seo.mjs` | 文章 SEO meta lint（title / description / tags / pubDatetime / ogImage） | 每次發新文前 |

## 使用

```bash
# 物件法規 audit
node scripts/audit-properties.mjs
# 輸出：audit/audit-{date}.md + .json

# SEO lint
node scripts/lint-seo.mjs
# 輸出：stdout markdown report
# exit 1 = 有 ERROR、適合接 pre-commit hook
```

## 整合 pre-commit (未來)

```bash
# .git/hooks/pre-commit (示意)
node scripts/lint-seo.mjs || exit 1
```

或用 husky / lefthook 管理。

## 規則設計原則

- **白名單優先**：例如景泰本人電話 0920-118756 加白名單避免誤報
- **dedup**：同 file + 同 rule + 同 matched 只算 1 筆
- **嚴重度分層**：ERROR (擋 commit) / WARNING (人工複審) / INFO (參考)
- **false positive 友善**：報告附「人工複審提示」說明可忽略的類型
