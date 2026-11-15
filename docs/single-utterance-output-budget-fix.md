# 單句截斷與續跑修正

2026-10-09，`codex/core-redesign`，HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`。此次只修改 Host 的容量恢復及其 checkpoint 契約，不重置來源、設定、已完成教材或既有修復額度。

## 原因與修正

原任務使用 Antigravity `gemini-3.7-flash`、日語 N3、六類一般解說、每項 3 組例句。模型容量記錄為 context 1,048,576、output 65,536；應用初始預算限制 8,192。任務已保存 6 個教學批次，剩餘批次拆至單一原句後仍多次輸出 8,188 tokens，SDK 明確回報 length。手動續跑使用同一預算，因此再度截斷。

初始預算與多原句拆批保持原方式。已拆到單一原句且確認截斷時，預算逐級提高：8,192 → 16,384 → 32,768 → 65,536，受凍結模型上限、context 四分之一與 1,024 tokens 安全空間限制。每次提高都重新檢查完整 prompt，不以刪除來源、減少指定例句或漏原句換取成功。

提高預算先保存到 checkpoint 的可選 outputTokenBudget，再發模型請求；診斷記錄截斷時的預算。中斷後使用已保存的預算，不回到 8,192，也不在未使用新預算前再倍增。舊 checkpoint 缺少欄位時，依既有截斷診斷提高預算，可直接接續原任務。成功批次不重跑。

這是容量恢復，不追加結構／讀音修復額度。JSON 格式錯誤維持結構錯誤，不再誤標成單句超出預算。到達容量上限或輸入安全空間不足時，保存明確失敗與有效預算，不無限重試。有效預算寫入 execution call 的 step（如 `s3-1-0-output-16384`），用量照實保留。

教材仍為 V6、checkpoint 4、workflow v6-2、協定 8。新增欄位只在 Host 本機 checkpoint，不更換教學策略；既有凍結模型／來源／策略驗證保持不變。

## 驗證

先執行新回歸測試，修正前重現原訊息 `single_utterance_exceeds_budget: output truncated after repair; checkpoint preserved`；修正後由 8,192 提高至 16,384 完成。其他定向案例涵蓋舊任務續跑、修復額度保留、四級預算上限、context 限制、超限 checkpoint 拒絕、JSON 錯誤不升額度，以及中斷後預算與成功批次保留。

定向 30／30、相容／用量估算 6／6、SDK 9／9 通過。完整主測試段 582 項中 575 通過、7 失敗：四個既有 UI 契約、一個既有 debug prompt timeout，以及兩個沙箱 localhost OAuth 失敗；SDK 在允許 localhost 的環境已另行通過，沒有新增失敗。型別檢查、Host build 與協定 8 Host 程序 smoke 通過。

本機 pnpm 啟動卡住，未進入專案程式；已停止此次啟動的卡住命令，直接執行專案已安裝的 Prettier／TypeScript、原 Host build script 與測試命令，未修改套件管理器、依賴或全域設定。

## 真實任務隔離驗證

原失敗任務複製到暫存庫，保留模型、設定、選材、成功批次與診斷，只改副本工作身分及保存位置。第一輪已使用 16,384，不再回報 length，仍因無效 JSON 失敗；該次診斷與用量保留。再對隔離副本做一次明確續跑並擷取 SDK 回傳：卡住原句通過，最後一句在結構修復時又遇到 8,188 tokens 的 length 截斷，原修復嘗試提高到 16,384 後完成。未增加第二次結構修復。

隔離副本最終 **14／14 完成**。來源字幕與原先六個成功批次經 deep equality 確認完全不變。原使用者 checkpoint SHA256 前後皆為 `68d605798861023c9acf08a4d797b4ffe887219cfaa2379f0e40e744534ce079`，沒有改寫。

完整嘗試、失敗、模型用量、擷取回傳位置及完成狀態見 [結果 JSON](./single-utterance-output-budget-results.json)。完成代表結構、覆蓋、來源與引用驗證通過，不代表已完成母語者教學品質審查。

最新 Host 已安裝至 Chrome 開發版 ID `agkdfdbgkoeooffhfkonpdkgfeldjifi`，本機 bundle 與安裝檔 SHA256 相同：`086739dd58f421365752d4674391b8ff30197110aba7d1e251cbcae17b4624fb`。現有已連線程序需要重新連線才能使用新程式；重新載入擴充功能後，可在原任務按「繼續」，不需要建立新任務。未替使用者續跑原庫、發布、部署或改動進行中的其他工作。
