# prompts-20：文法規則範圍修正與三案定向驗收

**3 案已完成新生成，結構／來源／身份、四個來源 cue 及指定教學目標的覆蓋均通過。三個指定西文形式都有實際引用與教學；同一 Codex 的 AI 編輯審查接受 2 案、待複核 1 案，沒有明確退件，另有 2 項非阻擋警告。** 這是一次固定小樣本，不是獨立教師認證，也不能推估穩定正確率或 prompt 改動的因果效果。

最新狀態見 [run-result.json](./run-result.json)，逐案判定見 [acceptance.json](./acceptance.json)。前次尚未取得核准、模型呼叫為 0 的紀錄保留於 [README-prepared.md](./README-prepared.md)、`inference-status.json` 及 `source-verification.json`；這些是當時的準備狀態，不是目前的執行結果。

## 修正依據與內容

上一輪西文說明把未來的 `cuando` 子句概括為「必須使用虛擬式現在時」。[RAE 的完成虛擬式條目](https://www.rae.es/gtg/pret%C3%A9rito-perfecto-compuesto-de-subjuntivo) 列出未來主句搭配 `cuando hayan comenzado` 的用法，支持反例；原文及退件判斷保留於 [prompts-19 審查](../pilot-2026-10-19-prompts19/reviews/es-actor-recipient-variant-automatic.json)。

本次共用的正式 compact 教學規則加入 `GRAMMAR SCOPE CHECK`：先解釋本句形式，再限定一般規則的適用條件；使用 only／always／must 前核對有效替代形式；以完整述語辨識複合時態，不能只看助動詞。程度只限制細節，不能把本句形式變成唯一選擇；無法可靠概括時，明確只解釋本句。正式教學與既有修復路徑共用相同指令，沒有增加語意模型審查循環或硬編碼某句西文答案。

版本為 `learning-points-prompts-20`；workflow、language-strategy-5、program-validation-3 不變。prompts-19 舊教材及舊任務續跑已納入相容測試：檔案不改寫、保留已完成批次，只繼續未完成工作。與上一輪凍結來源的 runtime 差異只有教學規則及版本／歷史讀取，見 [source-comparison.json](./source-comparison.json)、[implementation.patch](./implementation.patch)。

## 事前固定與逐案結果

[plan.json](./plan.json) 與 [cases.json](./cases.json) 在推論前固定，雜湊見 [run-context.json](./run-context.json)。每案只完整生成一次，循序執行，無整案內容重跑、替代結果挑選、provider fallback、推論期間的生成程式或判準變更。

| 案例             | 指定目標的實際教學                                                       | 編輯判定                     |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------- |
| 西文原退件，B1   | 引用並解釋 `cuando tenga`；不再要求現在虛擬式是唯一時態                  | 待複核：寄送者仍譯成「他們」 |
| 新西文對照，B2   | 引用並解釋 `cuando reciba` 與 `cuando haya recibido`，區分簡單式與完成式 | 接受                         |
| 英文既有對照，B1 | 不強制可選教學點；本次有來源、即將動作及等待用法的教學                   | 接受，2 項警告               |

來源 cue 被選中只算來源覆蓋；指定形式必須被實際引用並教學，否則是 `not_exercised`，不能接受。西文原案已覆蓋時態修正目標，但仍有另一項語意判定未決，因此整案不接受。英文沒有強制的西文目標，不代表其所有可選功能均已驗收。所有案例均未產出可選讀音，沒有實際音訊驗收。

西文新對照的 `reciba` 說明先限定未來時間子句的虛擬式語氣，再說本句用現在時；`haya recibido` 則以完整述語辨識完成虛擬式與未來先時完成，沒有只把助動詞的現在式當成整個複合時態。這些是本次三個具體形式的觀察，不是所有語言或所有一般化規則均已正確的證明。

## 保留的待複核與警告

**西文寄送者指涉仍待複核。** 原文 `envíen` 的詞形可對應第三人稱複數或禮貌的第二人稱複數，來源未交代寄送者身份，譯文與 chunk 卻採用「他們」。第三方也可能是自然的一般解讀；即使教學說「第三人稱複數」，也可能在說 `ustedes` 使用的文法一致形式，不能單憑此斷言是確定錯誤。[RAE 變位表](https://www.rae.es/buen-uso-espa%C3%B1ol/conjugaci%C3%B3n-espa%C3%B1ola) 支持詞形核對，不能替代具體譯文判定。因此沿用前一輪相同標準，交由獨立編輯判斷是否應中性保留為「對方」。[本案審查](./reviews/es-actor-recipient-variant-automatic.json)

英文兩項警告分別是 `called` 採電話解讀，以及標題「滯留」可能比 `still here` 更帶有受阻意味；兩者都存在合理較寬解讀，未列為確定錯誤。[英文審查](./reviews/en-normal-transfer-automatic.json)

本次西文的來源、教材摘錄、兩種解讀及複核問題已整理為 [獨立編輯複核資料](./pending-editorial-review.md)，尚未對外傳送或取得第二位審查者的判定。

前一輪西文與日文原始教材的兩種解讀及待決問題仍保留於 [pending-review-packet.json](./pending-review-packet.json)。本輪沒有進行獨立審查，也沒有因新生成而改判舊文件。更早的繁／簡中文爭議亦未更動。

## 真實請求、用量與核准紀錄

前兩次生成命令均因自動核准審查容量不足而未能建立程序，模型呼叫為 0；[原始審查失敗紀錄](./inference-authorization-attempts.json) 未修改。第三次透過相同核准流程獲准，才啟動每案第一次完整生成；詳見 [resumed-execution.json](./resumed-execution.json)。這不是兩次內容失敗後重跑，也沒有繞過審查。

保留 **9 組 generatePiText 客戶端 request／response** 與 9 筆呼叫紀錄，沒有結構修復，全部有回報用量。input **29,196**、output **26,019**、reasoning **21,248 tokens**；reasoning 包含於 output，不重複加總。服務回報 subscription，沒有金額資料。這是客戶端參數與回傳，不是 provider HTTP 封包或 SDK 內部重試擷取。

[trace-audit.json](./trace-audit.json) 核對三次正式教學請求均包含文法範圍、完整複合述語及局部說明的 fallback 指令，原先引用與例句人稱規則也保留。傳入規則不等於模型遵守；本輪沒有實際觸發修復，修復指令傳遞仍只有工程測試證據。

## 來源、工程與離線核對

本輪沿用 HEAD `ece1cde` 的同一隔離 archive 與覆蓋檔；生成期間 runtime／依賴／覆蓋測試及固定計畫的雜湊維持不變。這份來源在前次已完成 207 項核心／生成／任務／儲存測試、三個 workspace 型別檢查、正式 Extension／Host 建置、Host stdio smoke、產物檢查及 prompts-19 歷史證據核對；本次沒有重跑這些未變更的產品檢查。建置保留既有大型 bundle 提醒。[原工程紀錄](./engineering-checks.json) 保持不變；本次新增離線工具的型別與反例檢查。

前次的 [22 個準備階段檔案雜湊](./raw-artifacts.sha256.json) 原樣保留。新模型輸入／輸出、任務、教材、啟動紀錄及完成日誌另由 [generation-artifacts.sha256.json](./generation-artifacts.sha256.json) 固定；審查與接受判定分開保存。

```sh
node --import tsx docs/quality/pilot-2026-10-19-prompts20/verify.mts
pnpm exec tsc -p docs/quality/pilot-2026-10-19-prompts20/tsconfig.json --noEmit
python3 docs/quality/pilot-2026-10-19-prompts20/check-verifier.py
```

[完整離線核對](./generation-verification.json) 檢查兩層原始檔、凍結來源／計畫、版本／模型、輸入／任務／教材身份、來源與指定教學覆蓋、審查引用／判定及用量。覆蓋引用必須連到實際教學點，待複核或缺少必要目標不能計入接受數。暫存複本測試驗證上述接受限制及原始回傳的變更偵測，沒有模型呼叫；舊準備模式的反例紀錄亦保留。

`--prepared` 現在只核對歷史準備輸入，明示 `generatedCasesAtPreparation: 0`，不能當成目前生成狀態；後續來源變更後，可用 `--historical` 核對保存的完整紀錄。離線成功只代表完整性與記錄一致，不會獨立重判語言品質。

本輪未全數接受，仍需獨立編輯判定指涉爭議。已安裝 Host／Chrome／真實影片尚未驗收；`browser-acceptance.json` 的 profile 占用是前次連線紀錄，本輪未重新測試其可用性。沒有更新已安裝環境、發布或提交，也不沿用早期矩陣結果宣稱新版本通過完整 28 案。
