# prompts-19：完整單字引用與譯文人稱一致性

此輪現為歷史來源證據；目前 prompts-20 的規則範圍修正及已完成的 3 案定向驗收見 [下一輪紀錄](../pilot-2026-10-19-prompts20/README.md)。這裡保留原始輸出及審查，4／6 接受數不移用至新版本。

**6 案完成新生成，結構／來源／身份及四個來源 cue 的選擇覆蓋均通過；同一 Codex 的 AI 編輯審查接受 4 案、退件 1 案、待複核 1 案，另有 3 項非阻擋警告。** 這是一次固定小樣本，不能推估穩定正確率、改動的因果效果或完整語言支援品質。

## 實作與相容性

- 新教學點及 reusable sourceForms 的引用不能切在相鄰拉丁字母之間；組合附加符號與 UTF-16 範圍仍沿用既有 grapheme 檢查。完整引用 `called` 仍可在說明中教 `-ed`。撇號、連字號及不同 cue 的範圍可以分開，不猜測跨 cue 的單字，也不對中日文增加形態切分規則。
- 先保留既有逐字對齊錯誤及確定的 UTF-16 修復提示，再檢查單字邊界，避免新錯誤掩蓋既有診斷。截字檢查回報錯誤，由既有結構修復流程處理，不會自行改寫原文或擴張固定單位。
- 正式 compact 教學及其修復請求增加例句譯文的行為者、人稱／數、受詞與受益者核對：複數收件者不能把單數請求人變成「我們」，也不能把個人意圖改成集體提議。沒有新增語意模型審查循環。
- 版本為 `learning-points-prompts-19`、`program-validation-3`；language-strategy 保留 5。歷史 prompts-18／language-5／quality-2 教材仍可讀取；更早的既有相容組合保留。舊任務明確續跑時保留已完成批次及 previousExecution，新批次採新驗證；混合歷史批次的最終教材不會被新規則追溯誤擋。

## 事前固定與逐案結果

[plan.json](./plan.json) 與 [cases.json](./cases.json) 在推論前固定，雜湊見 [run-context.json](./run-context.json)。兩個前次退件、兩個同一審查者新寫的變體、英日各一個既有對照；每案只完整生成一次，最多同時兩案，無整案重跑、替代結果挑選、provider fallback 或推論期間的生成程式修改。

| 案例         | 編輯判定              | 特定觀察                                                              |
| ------------ | --------------------- | --------------------------------------------------------------------- |
| 法文前次退件 | 接受，1 警告          | 全部已產出引用完整，但這次沒有引用 `dehors`，該特定教學目標記為未覆蓋 |
| 西文前次退件 | 接受，1 警告          | 例句 `voy a pedir` 保留「我」；這案未產出單數請求人＋複數收件者組合   |
| 法文新變體   | 接受                  | `Les dossiers sont-ils`、`Pouvez-vous` 引用完整                       |
| 西文新變體   | 退件，另有 1 項待複核 | 例句保留單數請求人與複數收件者；另有時態規則概括過度                  |
| 英文對照     | 接受，1 警告          | 即將離開及例句人稱一致；`called` 選用電話解讀                         |
| 日文對照     | 待複核                | 時間關係的說明是否暗示來源未明示的影響／中斷                          |

完整逐句審查、JSON 路徑、引用及反方解讀見 [acceptance.json](./acceptance.json) 與 `reviews/`。所有四個來源 cue 都出現在選定單位，不代表每個可選教學目標均有產出。`dehors` 舊失敗的精確 `[0,31)`／`[0,32)` 邊界另由回歸測試驗證；本輪模型沒有觸發截字修復，不能說已驗收模型自行修復該錯誤。

## 保留的問題與判定依據

**西文退件：規則範圍。** `cuando tenga` 本句的現在虛擬式正確，但說明把任何尚未發生的未來時間子句都說成「子句動詞必須使用虛擬式現在時」。[RAE 的完成虛擬式條目](https://www.rae.es/gtg/pret%C3%A9rito-perfecto-compuesto-de-subjuntivo) 明列未來主句搭配 `cuando hayan comenzado` 的用法，支持反例。B1 簡化可能是其用意，但文字沒有限定為本句的簡單時態，因此按事前的文法範圍準則退件；嚴重程度仍是編輯判斷。[審查紀錄](./reviews/es-actor-recipient-variant-automatic.json)

這個西文來源的 `envíen` 另可對應第三人稱複數或禮貌的第二人稱複數；譯成「他們」是否合理採一般解讀，或應中性保留為「對方」，仍待獨立編輯複核。教學點本身列出兩種可能，故未判為確定錯誤。[RAE 變位表](https://www.rae.es/buen-uso-espa%C3%B1ol/conjugaci%C3%B3n-espa%C3%B1ola) 支持詞形與人稱核對，不能替代具體譯文判斷。

**日文待複核：時間關係。** 說明稱原定動作「受到了影響或中斷」，來源只明示來電時正準備出門。不過前面的「常伴隨」也可能只是限定典型語境，而非斷言本句必然中斷，故保留待複核，不當作確定錯誤或已接受。法文有明寫「或恰好重合」，只列精確度警告；兩者的不同判定理由保存在各案紀錄。[日文審查](./reviews/ja-normal-transfer-automatic.json)

本輪未更改上述新發現的生成程式，也未為通過而重跑。先前繁／簡中文引述角色爭議及法文不明片段選擇覆蓋仍在本輪範圍外。

## 真實請求、用量與來源

保留 **19 組 generatePiText 客戶端 request／response**，共 19 筆呼叫紀錄，全部有回報用量。其中一次是法文新變體的教學文字無法解析為合法 JSON，經既有結構修復後完成；初次文字與修復資料均保留。這是客戶端參數與回傳，不是 provider HTTP 封包或 SDK 內部重試擷取。[trace-audit.json](./trace-audit.json) 核對正式教學與修復請求包含新規則；傳入規則不代表模型遵守。

回報 input **66,252**、output **81,794**、reasoning **68,802 tokens**；reasoning 包含於 output，不重複加總。服務回報 subscription，沒有金額資料。本輪直接以所需權限讀取既有登入並連線，沒有額外的整案或憑證失敗重跑。

HEAD `ece1cde` 的隔離 archive 加上 run-context 列出的來源／測試覆蓋檔，為本輪生成與最終工程檢查的同一份凍結來源；98 個執行來源／依賴檔及 5 個覆蓋測試檔的雜湊與工作目錄相符。206 項核心、生成、任務及儲存測試、三個 workspace 型別檢查、品質工具／離線 verifier 型別檢查、正式 Extension／Host 建置、Host stdio smoke 及 Extension 產物檢查通過。建置保留既有大型 bundle 提醒。命令與原始紀錄見 [engineering-checks.json](./engineering-checks.json) 及 `logs/`；修正前的測試失敗紀錄亦保留。

## 離線核對

```sh
node --import tsx docs/quality/pilot-2026-10-19-prompts19/verify.mts --historical
pnpm exec tsc -p docs/quality/pilot-2026-10-19-prompts19/tsconfig.json --noEmit
python3 docs/quality/pilot-2026-10-19-prompts19/check-verifier.py
```

[原始檔雜湊清單](./raw-artifacts.sha256.json) 固定計畫、來源識別、原始請求／回傳、教材、任務及工程日誌；編輯審查另存。verifier 核對完整性、版本、固定輸入、模型身份、覆蓋、審查引用、判定與用量，並排除退件和待複核案件。暫存複本的反例檢查另驗證：待複核不能接受、改 verdict 不能隱藏未處理問題、原始回傳變更會被拒絕。

退出碼 0 只證明這些記錄一致，不會重新證明語言審查正確；後續來源改變時使用 `--historical` 核對歷史紀錄。此次沒有獨立教師／母語者審查、完整 28 案、已安裝 Host 更新、個人 Chrome／真實影片、實際音訊或學習成效驗收，也沒有提交或發布。
