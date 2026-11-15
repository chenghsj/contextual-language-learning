# 生成證據與回歸觀察

目前只核對可重現的來源、結構、身份、檔案完整性與覆蓋資訊，**不再計算 AI 接受案數，也不要求措辭爭議完成獨立複核後才能進行 Chrome 測試。**

本次整理沒有重新生成或改寫教材，也沒有把原先的「2 案接受、1 案待複核」改成「3 案內容正確」。當時的判定與舊工具完整保存在 [歷史紀錄](./history/README.md)；現在使用 [validation.json](./validation.json) 記錄事實與非阻擋備註。

## 已移除的門檻

- AI 覺得某種翻譯較好，就讓整案等待複核或擋住使用驗收。
- 將單次 AI 審查的接受案數當作產品品質分數。
- 沒有產出某個可選教學點或 reusable item，就判定教材失敗。
- 硬性要求簡短回應只能 basic_only，否則稱為 filler teaching。
- 硬性要求固定案例必須切成特定數量的句內單位或選到指定片段，否則退出失敗。

「他們／對方」、`called` 的媒介解讀及「滯留」的措辭疑慮現在都是非阻擋編輯備註，沒有藉此認定翻譯必然正確或錯誤。先前西文、日文與中文的歷史爭議同樣不作為下一階段測試的前置條件；有明確來源矛盾或可重現反例時，仍應作為具體缺陷處理。

## 保留的檢查

- 教材 schema、引用與關聯、UTF-16／字素邊界及完整拉丁字母詞引用。
- 固定案例來源與模型／版本／任務／教材身份一致。
- 原始輸入、回傳、生成教材與來源識別的雜湊完整性。
- 已標示不明的來源片段不能被當成可確定的教學／重用目標。
- 舊教材與續跑相容性的既有回歸測試。

覆蓋仍如實報告：沒有實際教到的目標是 `not_exercised`，不能宣稱已驗證到該修正；但它不再等於產品失敗，也不阻擋其他功能測試。聲稱有教到的引用仍必須存在，且連到實際教學點。

## 目前保存的事實

prompts-20／program-validation-3 的 3 案已完成生成，保存 9 組客戶端 request／response。3 案來源 cue 都完整覆蓋，3 個指定西文形式有實際引用與教學。這些是一次固定樣本的觀察，不代表穩定正確率或跨模型品質。

既有的 207 項產品回歸、型別／建置與 Host smoke 紀錄保留於 [engineering-checks.json](./engineering-checks.json)，屬於當時的凍結來源。此輪只修改品質工具與判定政策，沒有改 prompt 或生成流程；新模型呼叫為 0。

原 [22 個準備階段檔案](./raw-artifacts.sha256.json) 與 [36 個生成檔案](./generation-artifacts.sha256.json) 均未改動。當時的固定計畫 [plan.json](./plan.json) 也保留原樣；其中 AI 全案接受的條款僅記錄當時做法，已不是目前的執行門檻。

## 使用方式

```sh
node --import tsx docs/quality/pilot-2026-10-19-prompts20/verify.mts
python3 docs/quality/pilot-2026-10-19-prompts20/check-verifier.py
pnpm exec tsc -p docs/quality/pilot-2026-10-19-prompts20/tsconfig.json --noEmit
```

[verification.json](./verification.json) 只報告資料完整性、來源差異、覆蓋與備註，不輸出語意接受率。退出碼 0 表示這些保存紀錄核對成功，不表示教材整體內容或產品品質已被認證。

預設可以檢查歷史紀錄，並明示 `sourceDrift` 與 `recordedSourceMatchesWorkspace`；需要證明全部來源與當時快照完全相同時，另加 `--require-current-source`。`--prepared` 只檢查當時準備的輸入，不執行模型。來源改動不會被隱藏，也不會被誤報為新版本通過。

[verification-checks.json](./verification-checks.json) 包括主觀備註不阻擋、可選教學缺席不退件、虛構覆蓋仍會被拒絕、原始資料竄改偵測，以及合法簡短回應教學／沒有 reusable items 的 CLI 案例。引用與來源對齊的 9 項回歸測試及品質工具型別檢查另有紀錄於 `logs/validation-cleanup-*.log`。

已移除「AI 全數接受」這項 Chrome 驗收前置條件。已安裝 Host／Chrome／真實影片驗收仍尚未執行；此輪沒有安裝、發布或提交。
