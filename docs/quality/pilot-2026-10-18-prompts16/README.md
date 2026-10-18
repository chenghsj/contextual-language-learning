# prompts-16 四組試跑

這輪四組均完成生成、程式與情境覆蓋檢查，但 AI 編輯審查只通過 2／4。它是保留的未通過紀錄；目前修正與驗證另見 [prompts-17](../pilot-2026-10-18-prompts17/)。不以挑選前後輪結果的方式組成通過清單。

| 固定案例       |   個案耗時 | 模型呼叫 | AI 語意審查                                  |
| -------------- | ---------: | -------: | -------------------------------------------- |
| 英文一般對話   |  67.406 秒 |        4 | 通過：摘要不再串接不同台詞的說話者           |
| 英文不確定情境 | 110.468 秒 |        3 | 通過；Not yet 教學重複列警告                 |
| 日文一般對話   |  46.723 秒 |        3 | 未通過：新例句的門鈴動作者與睡覺者角色不一致 |
| 日文不確定情境 | 114.047 秒 |        3 | 未通過：摘要仍把可作呼語的ミオ確定為動作主語 |

日文不確定情境的翻譯與句意已使用中性的「這裡」，不再補寫書寫或畫面；不明片段在受影響欄位明示，未成為教學目標，沒有補女性說話者，縮約模板也正確。不過摘要中仍有未確立的名字角色，因此仍判未通過。日文一般對話的來源解釋正確，但第一個新例句中「是你按的門鈴嗎？」接「對啊，我當時正要睡覺」，與睡覺被門鈴打斷的情境不一致；正確句型不能抵銷這項問題。

完整證據見 [英文一般](./review-en-normal.json)、[英文不確定](./review-en-uncertainty.json)、[日文一般](./review-ja-normal.json)、[日文不確定](./review-ja-uncertainty.json)。最終接受判定見 [acceptance.json](./acceptance.json)，程式與情境檢查見 [verification.json](./verification.json)。原始生成報告不改寫為接受狀態。

模型仍為 Antigravity `gemini-3.8-flash`／`medium`，版本為 prompts-16／program-validation-2。四組請求與修改前除 ID 外相同；詳細設定與來源雜湊見 [conditions.json](./conditions.json) 及 [run-context.json](./run-context.json)。來源 patch 已從起始提交重建核對，見 [source-verification.json](./source-verification.json)。

個案耗時合計 338.644 秒、13 次呼叫，包含一次既有結構修復；沒有新增語意審查模型呼叫、同版本整組重跑或 provider fallback。回報 input 47,278、output 57,519、reasoning 49,708、cacheRead 2,087 tokens，reasoning 已包含在 output。沒有回報金額，不推估成本。

目前來源已更新，離線核對本輪凍結證據使用：

```sh
node --import tsx docs/quality/pilot-2026-10-18-prompts16/verify.mts --historical
```

歷史模式列出來源差異，仍核對原始檔雜湊、固定輸入、教材結構、審查引文、預期覆蓋結果與用量，不會呼叫模型或宣稱目前版本通過。這是 AI 編輯審查，沒有教師／母語者、音訊、學習效果或真實 Chrome／影片驗證。
