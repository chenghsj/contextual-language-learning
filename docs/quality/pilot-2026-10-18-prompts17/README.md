# prompts-17 四組修正驗證

**本輪四組均完成生成，通過程式、情境覆蓋與 Codex AI 語意審查，保留三項非阻擋文案警告。** 接受依據是本輪同版本的四份原始輸出；這是已知固定小樣本，不能推估整體正確率、其他語言、其他影片或重複生成的穩定性，也不是教師／母語者認證。

## 設定與結果

Antigravity `gemini-3.8-flash`／`medium`；`learning-points-prompts-17`、`learning-points-v7-1`、`program-validation-2`。英文 B1、日文 N3 各一組一般對話與不確定情境，說明語言為繁體中文。請求除任務 ID 外與 [修改前](../pilot-2026-10-18/README.md) 相同。

| 固定案例       |   個案耗時 | 呼叫 | 程式驗證 | 情境覆蓋 | AI 語意審查    |
| -------------- | ---------: | ---: | -------- | -------- | -------------- |
| 英文一般對話   |  39.148 秒 |    3 | 通過     | 通過     | 通過           |
| 英文不確定情境 |  75.688 秒 |    3 | 通過     | 通過     | 通過，1 項警告 |
| 日文一般對話   |  67.664 秒 |    3 | 通過     | 通過     | 通過，1 項警告 |
| 日文不確定情境 | 110.868 秒 |    3 | 通過     | 通過     | 通過，1 項警告 |

程式驗證包括 `validateLearningDocumentV7`、固定來源 cues／profile 相同、模型與執行版本相符；語意審查另外依 [同一份準則](./review-rubric.md) 對照原文、翻譯、逐句解說、重點、可重用表達、情境與新例句，沒有以 JSON 合法替代內容判定。

逐項證據：

- [英文一般對話](./review-en-normal.json)：摘要列出台詞內容，不串接說話者；時間關係、框架與新例句角色一致。
- [英文不確定情境](./review-en-uncertainty.json)：保留 she，不綁定 Maya；不明片段明示且不成為教學目標。Not yet 額外教學仍偏重複，列警告。
- [日文一般對話](./review-ja-normal.json)：來源摘要不加視覺事件；新例句的寄訊者、收訊者與回答一致。語氣與親近程度的泛論仍宜加條件，列警告。
- [日文不確定情境](./review-ja-uncertainty.json)：摘要不把ミオ定為主語或引述者；不補女性說話者、書寫或畫面；不明片段逐欄位明示，可靠的 `って何` 僅引用周邊原文。`[動詞て形]た` 模板正確，省略 `い` 的術語可更精確，列警告。

機器可讀的最終判定見 [acceptance.json](./acceptance.json)，程式與覆蓋結果見 [verification.json](./verification.json)。原始 [report.json](./report.json) 的 `generated` 與待審查欄位保持原樣；審查結論另存，不手動修教材後改判模型通過。

## 來源與離線核對

詳細模型設定、固定輸入及來源雜湊分別在 [conditions.json](./conditions.json)、[requests.json](./requests.json)、[run-context.json](./run-context.json)。本輪生成時，修正尚未提交；起始提交為 `a95d558e8abfd3a03e31412fc5e893bc463f0b0e`，當輪的完整局部差異保存在 [source-change.patch](./source-change.patch)。已在暫存目錄套回該提交，重建後 12 個來源雜湊均相符，見 [source-verification.json](./source-verification.json)。

Reader commit `e0053b2` 後，共用驗證程式已改變，這輪結果保留為歷史證據。在儲存庫根目錄執行以下離線核對，不呼叫模型：

```sh
node --import tsx docs/quality/pilot-2026-10-18-prompts17/verify.mts --historical
```

它核對原始檔雜湊、固定請求、四份教材、執行身份、預期情境覆蓋、審查引文與用量，並列出目前來源差異。省略 `--historical` 時會拒絕把舊結果視為目前版本的驗收。後續獨立快照的整合檢查見 [2026-10-19 整合紀錄](../integration-2026-10-19/README.md)。

## 耗時與用量

本輪四個個案耗時合計 **293.368 秒，約 4 分 53 秒**，共 **12 次**模型呼叫，全部有回報用量：input **44,619**、output **49,555**、reasoning **42,244 tokens**。reasoning 已包含在 output，不能再加一次。服務回報 subscription，沒有金額資料，不換算成本。

每組均為 `window-0`、`selection`、`s0` 三次呼叫；本輪沒有結構修復、同版本整組重跑或 provider fallback。這些是本次觀測，不能由單輪推估通常延遲或費用。

本次修正共驗證三個實質不同的 prompt 版本，各自使用新的目錄，每個版本各執行同樣四組一次：

| 修訂版本                                              | 程式／情境覆蓋 | AI 語意審查 | 呼叫 | 個案耗時合計 |
| ----------------------------------------------------- | -------------- | ----------- | ---: | -----------: |
| [prompts-15](../pilot-2026-10-18-prompts15/README.md) | 4／4           | 2／4        |   12 |   405.897 秒 |
| [prompts-16](../pilot-2026-10-18-prompts16/README.md) | 4／4           | 2／4        |   13 |   338.644 秒 |
| prompts-17                                            | 4／4           | 4／4        |   12 |   293.368 秒 |

三輪共 12 個生成請求、37 次模型呼叫、個案耗時合計 1,037.909 秒；包含 prompts-16 的一次結構修復。各輪的原始結果與拒絕理由均保留。版本間改了規則與輸出契約，這張表是修正紀錄，不是模型正確率或效能實驗。

## 其他驗證與界線

- 196 個核心、生成、任務、儲存及教材 Drive 定向測試通過，包括錯誤模板攔截、既有的一次修復，以及 prompts-14／15／16 的讀取與續跑相容性。
- 三個 workspace 型別檢查、離線證據工具型別檢查、Extension／Native Host 正式建置、Extension 產物檢查與 Host stdio smoke 通過。
- 三項文案警告仍保留；尚未擴大到 28 組，沒有教師／母語者、音訊、學習效果或真實 Chrome／影片驗收。
- 尚未執行 Host 安裝或更新已安裝副本，沒有部署、推送或發布。

修正內容與紅綠回歸的原因見 [來源忠實度修正紀錄](../source-fidelity-fix-2026-10-18.md)。
