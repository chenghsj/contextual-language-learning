# prompts-20：文法規則範圍修正，等待真實生成

**程式修正、207 項回歸測試、型別檢查、正式建置、Host smoke 及產物檢查通過。3 案輸入已固定並完成準備驗證；新模型呼叫為 0，尚無生成品質接受結果。** 不沿用 prompts-19 的 4／6 接受數作為新版本結論。

## 修正依據與內容

上一輪西文說明把未來的 `cuando` 子句概括為「必須使用虛擬式現在時」。[RAE 的完成虛擬式條目](https://www.rae.es/gtg/pret%C3%A9rito-perfecto-compuesto-de-subjuntivo) 明列未來主句搭配 `cuando hayan comenzado` 的用法，支持反例；上一輪的原文及編輯退件判斷保留於 [原審查](../pilot-2026-10-19-prompts19/reviews/es-actor-recipient-variant-automatic.json)。

本次在所有語言共用的正式 compact 教學規則加入 `GRAMMAR SCOPE CHECK`：先解釋來源中的具體形式，再限定一般規則的適用條件；使用 only／always／must 前核對有效替代形式；以完整述語辨識複合時態，不能只看助動詞。程度只限制說明細節，不能把本句形式變成唯一選擇；無法可靠概括時，明確只解釋本句。相同指令由正式教學及既有修復路徑共用，沒有新增語意 review／repair 模型循環或硬編碼某句西文答案。

版本更新為 `learning-points-prompts-20`；workflow、language-strategy-5、program-validation-3 保持不變。prompts-19 舊教材的讀取及舊任務續跑已納入相容測試：檔案不改寫、已完成批次保留、只繼續未完成工作。更早相容版本仍可讀取。與上一輪凍結來源的 runtime 差異只有教學規則及版本／歷史讀取，見 [source-comparison.json](./source-comparison.json)、[implementation.patch](./implementation.patch)。

## 固定的 3 案

[plan.json](./plan.json) 與 [cases.json](./cases.json) 在推論前固定，雜湊見 [run-context.json](./run-context.json)。

| 案例             | 目的                                 | 必須實際教到的目標                      |
| ---------------- | ------------------------------------ | --------------------------------------- |
| 西文原退件，B1   | 檢查一般化是否越界，並檢查譯文角色   | `cuando tenga`                          |
| 新西文對照，B2   | 同一未來時間功能的簡單式與完成式     | `cuando reciba`、`cuando haya recibido` |
| 英文既有對照，B1 | 共用規則變更後的來源、翻譯與教學檢查 | 不強制新增可選教學點                    |

來源四個 cue 被選中，只算來源覆蓋；指定形式若未實際被引用並教學，記為 `not_exercised`，不能列入接受數。每案只完整生成一次、循序執行，保存真實客戶端請求／回傳及既有結構修復；不為缺少目標或內容退件重跑。判準在執行前固定，不能以後來結果修改。

## 目前阻擋與待複核

兩次所需權限的生成命令均在建立程序前，因**自動核准審查回報 Selected model is at capacity** 而未執行。這是審查服務未能完成，不是生成模型回傳或安全性否決；不能繞過核准。紀錄見 [inference-authorization-attempts.json](./inference-authorization-attempts.json) 與 [inference-status.json](./inference-status.json)。沒有 provider 請求、用量或新教材，不能宣稱修正已經模型驗收。

已另外執行 `--prepare-only`，保存三組合法請求與條件於 `prepared/`；此模式不讀取登入鎖檔、不連線推論，也不建立接受清單。它只確認已可供後續執行，不能替代真實生成。

上一輪西文 sender-reference 與日文時間關係的原始教材、兩種解讀及待決問題整理為 [pending-review-packet.json](./pending-review-packet.json)。尚未進行獨立編輯複核，也沒有對外傳送資料；舊審查與教材雜湊均保留，新輸出不會自動改判舊爭議。更早的繁／簡中文爭議仍在本輪範圍外。

Chrome 工具的 `list_pages` 另外回報專用 profile 已被占用，無法連線。沒有停止使用者瀏覽器、變更 profile 或更新已安裝 Host；[browser-acceptance.json](./browser-acceptance.json) 只記錄連線限制。已安裝 Host／Chrome／真實影片驗收尚未執行，需在定向生成通過後另行確認。

## 工程與離線檢查

隔離 archive 的 HEAD 為 `ece1cde`，加上 run-context 列出的來源／測試覆蓋檔，與目前工作目錄的來源雜湊相符。207 項核心／生成／任務／儲存測試、三個 workspace 型別檢查、品質工具與 verifier 型別檢查、正式 Extension／Host 建置、Host stdio smoke、Extension 產物檢查及 prompts-19 歷史證據讀取均通過。建置保留既有大型 bundle 提醒。命令及日誌見 [engineering-checks.json](./engineering-checks.json)；原始準備請求、條件、來源身份與工程紀錄由 [檔案雜湊清單](./raw-artifacts.sha256.json) 固定。

```sh
node --import tsx docs/quality/pilot-2026-10-19-prompts20/verify.mts --prepared
pnpm exec tsc -p docs/quality/pilot-2026-10-19-prompts20/tsconfig.json --noEmit
python3 docs/quality/pilot-2026-10-19-prompts20/check-verifier.py
```

`--prepared` 核對固定輸入、版本、來源、未執行狀態及舊待複核資料完整性；輸出明示 `semanticAcceptance: not_evaluated`。暫存複本檢查會拒絕被修改的輸入／計畫，並確認未執行的生成不能通過完整接受驗證。沒有 `--prepared` 的完整 verifier 須等真實輸出與審查完成才能執行，目前不會誤報成功。

## 接續方式

核准服務恢復後，先核對上述來源與計畫雜湊，再從 `run-context.json` 的 `sourceDirectory` 執行下列命令；仍需所需登入鎖檔與連線權限的核准，不得繞過。若隔離來源已移除，須先依原覆蓋檔重建並核對雜湊。

```sh
node --import tsx apps/local-host/scripts/learning-points-quality.ts \
  --trace-prompts \
  --cases-file=docs/quality/pilot-2026-10-19-prompts20/cases.json \
  --output=/Users/cheng/Desktop/immersive-language-learning/docs/quality/pilot-2026-10-19-prompts20/batch-1
```

後續應保留新的啟動紀錄、原始 request／response，再按既定判準作逐案審查並核對來源／目標覆蓋。此輪尚無模型結果，不推估正確率、因果改善、穩定性、金額成本或學習效果。沒有提交、發布或更新已安裝環境。
