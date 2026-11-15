# prompts-18：五組退件修正與新變體驗收

此輪現為歷史來源紀錄；目前的 prompts-19／program-validation-3 修正與新輸出見 [下一輪驗收](../pilot-2026-10-19-prompts19/README.md)。保留此輪原始結果，不將其 9／12 接受數沿用為新版本結論。

**12 組完成生成、結構／來源／身份及指定覆蓋檢查；同一 Codex 的 AI 編輯審查接受 9 組、退件 2 組、待複核 1 組，另有 6 項非阻擋警告。** 原先五個具體退件問題在這五組新輸出中均未再出現，但繁中案例另有引述角色說明待複核，不能將五組都記為整體接受。這是各案一次的固定小樣本，沒有重複種子或新變體的配對基線，不證明穩定正確率或 prompt 改動的因果效果。

## 修正依據

從 prompts-17 的凍結程式與保存 checkpoint 重建五組教學 prompt，發現正式教學使用 compact 設定：較長的 `LANGUAGE_CHECKS` 未進入這條路徑，而 essential `TEACHING_LANGUAGE_CHECKS` 當時只有日文。西文省略轉述主語及越文 gọi 的提醒因此未進入正式教學。一般來源忠實度及例句角色檢查則確實包含在內，不能把全部問題都歸因於漏傳。這只是來源／checkpoint 重建，並非歷史 HTTP 請求；證據見 [source-diagnosis.json](./source-diagnosis.json) 與 `diagnosis-prompts17/`。

本次在 essential teaching 路徑加入西、法、義、越文的精簡必要規則，並明確要求標題遵守來源界線、chunk 提供此處句意、文法推導限定適用範圍，以及 situation 描述該例句實際的任務。沒有恢復額外的語意 review／repair 模型循環，既有結構修復保留。

版本為 `learning-points-prompts-18`、`learning-language-strategies-5`；workflow `learning-points-v7-1` 與 `program-validation-2` 不變。以往教材與未完成 checkpoint 的相容性另外驗證：保留 prompts-12 至 prompts-17／language-strategy-4 教材讀取；明確繼續舊任務時，只更新未完成工作的執行身分，保留已完成 batches、呼叫紀錄與 previousExecution。

## 先固定案例及判準

[plan.json](./plan.json) 與 [cases.json](./cases.json) 在模型請求前保存，雜湊記錄於 [run-context.json](./run-context.json)。共五組既有退件、五組同一審查者新寫的變體與英日各一組既有通過對照。新變體不是盲測或獨立保留測試集。每案只完整生成一次、兩批最多同時各跑一案，沒有整組內容重跑、挑選替代結果、provider fallback 或中途更改生成快照。

| 組別         | 接受 | 退件 | 待複核 |
| ------------ | ---: | ---: | -----: |
| 五組既有退件 |    4 |    0 |      1 |
| 五組新變體   |    3 |    2 |      0 |
| 英日對照     |    2 |    0 |      0 |
| 合計         |    9 |    2 |      1 |

五個原問題的觀察：西文摘要不再把引述連到名字；法文局部句意採用處所義；義文規則保留 gli 例外；越文標題沒有新增偶遇情節；繁中 situation 與對話的通知動作一致。這些特定問題的未再出現不等於其他欄位全部正確。

## 保留的新發現

- **西文新變體退件：例句譯文變更行為者。** `Entonces le voy a pedir que nos mande un correo.` 由當下說話者去要求寄信，譯文卻是「那我們請他發電子郵件給我們吧」。`nos` 是收信者，不會把 `voy` 的單數行為者改為複數。[RAE 的 ir 變位表](https://dle.rae.es/ir) 列 `yo / voy` 與 `nosotros / vamos`；這支持人稱／數的核對，退件嚴重程度仍是按既定譯文角色準則作出的編輯判斷。[逐案審查](./reviews/es-report-transfer-variant-automatic.json)
- **法文新變體退件：來源引用切斷單字。** point 0 的範圍 `[0,31)` 引出 `Pourquoi êtes-vous encore dehor`，將 `dehors` 的最後一個 s 留在範圍外。這是完整審查發現的額外引用問題，不是法文處所句意再次錯誤，也沒有修改固定輸入或宣稱是預先指定的目標失敗。[逐案審查](./reviews/fr-location-transfer-variant-automatic.json)
- **繁中既有案例待複核：轉述說明範圍。** 新例句的動作一致，但教學點說「轉述自他人的發言」，可能把原文未明的引述角色說窄，也可能只是泛稱。沿用先前簡中爭議的相同標準，保留待獨立編輯複核，不能當成確定錯誤，也不能因零個 error 就算通過。[逐案審查](./reviews/zh-TW-uncertainty-quote-topic-automatic.json)

六項警告分別涉及西／義文簡答重複教學、越文小顆粒 chunk、英文明確採電話解讀，以及法／日文的語調概括。完整判定、JSON 路徑、原文引用與範圍見 [acceptance.json](./acceptance.json) 及 `reviews/`。同一 AI 編輯審查不能替代教師／母語者或獨立第二位審查。

## 真實請求紀錄與用量

新增品質工具參數 `--cases-file` 與 `--trace-prompts`，透過既有 generateText 注入點包裝真正的 `generatePiText`，保留原選定模型、預算、callback 及回傳值。每次請求前保存 system/stage prompt，每次回傳後保存完整文字與 call；結構修復的中間輸出也保留。這是模型客戶端參數及回傳紀錄，**不是 provider HTTP 封包或 SDK 內部重試的擷取**。[trace-audit.json](./trace-audit.json) 核對必要規則確實出現在正式教學請求；存在於 prompt 不代表模型必然遵守。

12 案共 **37 筆**已保存的呼叫紀錄與 37 組 request/response，含一次法文一般對話的候選結構修復，全部有回報用量。input **120,627**、output **179,482**、reasoning **150,083 tokens**；reasoning 已包含於 output，不重複加總。服務回報 subscription，沒有金額資料，不推估成本。

沙箱第一次啟動的兩批共 12 案均在建立憑證庫鎖檔時失敗，尚未建立 execution 或進入 generatePiText；原始記錄保存在 [infrastructure-preflight](./infrastructure-preflight/README.md)。取得所需執行權限後，才以相同來源與案例執行上述一次完整模型生成。這些基礎設施失敗沒有被當成成功內容或隱藏的付費重跑。

## 來源與工程檢查

模型生成使用 HEAD `ece1cde` 的隔離 archive，加上 run-context.json 列出的五個來源／測試覆蓋檔，整輪快照沒有修改。另建最終來源快照，補上舊教材讀取及舊任務 resume 相容性：runtime 差異只有 `schema.ts` 的歷史讀取判斷與 `jobs/manager.ts` 的舊任務身分升級；新生成的 prompt／規則／階段不變。差異與前後雜湊見 [compatibility.patch](./compatibility.patch)、[compatibility-context.json](./compatibility-context.json)。**模型案例沒有在這份最終相容性快照上再付費重跑**，兩層證據分開保存。

最終來源的 199 項核心、生成、任務與儲存回歸測試、三個 workspace 型別檢查、Extension／Host 正式建置、Host stdio smoke 及 Extension 產物檢查通過。測試特別使用真實舊 language-strategy-4 身分，涵蓋舊教材不改寫、保留已完成 batches 並只繼續未完成工作。完整紀錄見 `logs/`；建置仍保留既有大型 bundle 提醒。品質工具／離線核對工具另作型別與格式檢查。

## 離線重現與界線

```sh
node --import tsx docs/quality/pilot-2026-10-19-prompts18/verify.mts --historical
pnpm exec tsc -p docs/quality/pilot-2026-10-19-prompts18/tsconfig.json --noEmit
python3 docs/quality/pilot-2026-10-19-prompts18/check-verifier.py
```

[raw-artifacts.sha256.json](./raw-artifacts.sha256.json) 固定 151 個原始／證據檔案；審查與接受判定另存。離線工具核對凍結計畫、原始檔、來源、版本、輸入、模型身分、覆蓋、引用、判定與用量，並將待複核排除於接受數。退出碼 0 只證明資料完整及記錄一致，不會重新證明語言判斷正確。後續來源改變時，`--historical` 僅核對歷史證據。

本輪沒有合併 prompts-17 的 21／28 結果宣稱新版本通過完整矩陣。先前的法文不明片段選擇覆蓋問題與簡中獨立編輯爭議仍在範圍外。沒有更新已安裝 Host、操作個人 Chrome 或真實影片、驗證實際音訊／學習效果、部署或發布。
