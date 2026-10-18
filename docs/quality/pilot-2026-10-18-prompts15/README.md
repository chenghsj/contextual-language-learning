# prompts-15 修正後的四組試跑

本輪為中間結果，**未通過整輪語意驗收，也不是目前 prompts-16 的通過依據**。四組都完成生成、程式驗證與固定情境覆蓋；AI 編輯審查通過 2／4。後續結果另存 [prompts-16](../pilot-2026-10-18-prompts16/)，未覆寫或重選本輪輸出。

模型為 Antigravity `gemini-3.8-flash`／`medium`；版本為 `learning-points-prompts-15`／`program-validation-2`。四組請求與 [修改前試跑](../pilot-2026-10-18/) 除任務 ID 外相同，未擴大到 28 組。版本與雜湊見 [conditions.json](./conditions.json)，未提交來源差異及核心雜湊見 [run-context.json](./run-context.json) 與 [source-change.patch](./source-change.patch)。

| 固定案例       |   個案耗時 | 呼叫次數 | 情境覆蓋 | AI 語意審查                                      |
| -------------- | ---------: | -------: | -------- | ------------------------------------------------ |
| 英文一般對話   |  39.300 秒 |        3 | 通過     | 未通過：摘要仍把說明與下一個請求串成同一人的行為 |
| 英文不確定情境 |  55.527 秒 |        3 | 通過     | 通過；Not yet 教學重複列警告                     |
| 日文一般對話   |  72.766 秒 |        3 | 通過     | 通過；語氣說明仍宜加條件                         |
| 日文不確定情境 | 238.304 秒 |        3 | 通過     | 未通過：翻譯與逐句句意把此處擴成「這裡寫著」     |

日文不確定情境已不再補女性說話者，損壞文字在受影響欄位標為不清楚、未成為教學目標，模板改為 `[動詞て形]た` 並正確展開縮約。這些改善沒有抵銷其他欄位的來源推論錯誤。本輪沒有結構修復、整組重跑或模型 fallback。

逐項證據與判定：

- [英文一般對話](./review-en-normal.json)
- [英文不確定情境](./review-en-uncertainty.json)
- [日文一般對話](./review-ja-normal.json)
- [日文不確定情境](./review-ja-uncertainty.json)
- [最終接受判定與用量](./acceptance.json)、[程式／覆蓋檢查](./verification.json)

個案耗時合計 405.897 秒，12 次呼叫均有用量。回報 input 40,950、output 69,530、reasoning 62,103、cacheRead 2,087 tokens；保留 SDK 欄位，reasoning 已包含在 output，不能再加一次。沒有回報金額，不推估成本。較長耗時主要出現在最後一組的候選分析；單輪結果不能證明速度或費用改善。

目前來源已更新；核對本輪凍結證據時使用歷史模式：

```sh
node --import tsx docs/quality/pilot-2026-10-18-prompts15/verify.mts --historical
```

此模式仍核對原始檔案、教材與審查引文、固定輸入、預期覆蓋結果與用量，並列出目前來源相對本輪的差異；不宣稱目前版本通過。原始生成 `report.json` 的待審查欄位不回寫，最終語意判定另存 `acceptance.json`。這是 Codex AI 編輯審查，沒有教師／母語者、音訊、學習效果或真實 Chrome／影片驗證。
