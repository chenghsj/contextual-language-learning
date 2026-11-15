# 2026-11-03 JSON 失敗場景復原

依使用者「修正」處理任務 `3097124c-a39a-4764-8343-03d72934497c`。使用者另確認「先檢查 quota」指 Codex quota guard skill，不新增產品內的 Antigravity quota 檢查。工作前及主要階段已取得 fresh `continue`；沒有追加模型請求。

## 原因與回歸

失敗場景 `00271169-6c37-47e4-a051-a768f92c43bf` 的原始回應中，多個 `targetLineIndex` 欄位少了結尾引號；模型的後續修補回應又在 `pointIds` 陣列後混入 `factory` 字樣。兩個請求都有 stop 結束及實際 token 用量，保存證據不支持將此錯誤歸因於 quota 或輸出截斷。

原流程耗盡一次格式修補後，只會在 Resume 重讀最新的錯誤回應，沒有重新驗證仍可安全復原的原始回應。修改前，實際 checkpoint 的離線重播穩定停在 3／4，與截圖相同。

修改包含：

- 僅在 JSON 字串外、物件 key 位置，為觀察到的 `targetLineIndex` 數字欄位補上缺失的結尾引號。保留字串值，拒絕未知 key、任意雜字、截斷及其他仍無法解析的格式。
- 場景最新回應無法驗證時，先嘗試已保存的較早回應。每一份仍必須通過相同的完整場景 schema、字幕覆蓋、引用、讀音及教學結構檢查；有截斷標記的舊回應不採用。原回應與失敗修補回應保留在 checkpoint。
- 核心 checkpoint 加入 `target_line_index_key_quote` normalization 證據及 `recoveredPreviousOutput`。不變更凍結模型、提示、推理強度、預算或歷史請求。

新增回歸先失敗再通過，另驗證較早回應的來源引用不合法時仍拒絕，且不重發已完成的場景請求。針對性測試 18 項通過。擴大回歸 375 項中 373 項於沙箱通過；兩項 OAuth 取消測試因本機監聽 EPERM 失敗，在允許本機 callback listener 的環境重跑均通過，未交換憑證或執行推理。Core／Host／Extension 型別檢查及 Host 建置、protocol 16 smoke 通過。

## 實際任務與安裝

真實回應離線重播通過：完整 26 個來源單元的第 4 場景已恢復，原 3 場景一致，模型請求為 0。以比對原始 checkpoint、確認沒有運行中任務及備份為前提，已將此復原套用到正式任務。其餘 36 個內容庫檔案雜湊未變，原 12 筆請求紀錄未變。

Native Host 已備份並更新，manifest、擴充功能 ID 與權限不變。已安裝 bundle SHA-256 與本次建置相同：`974a6fa95c6d83c9ddc17d7b2f7bf1ba29e3bfc4e5056d67e21d11d1ad21effb`。透過真正安裝的 launcher／stdio 執行 `listJobs`、`getJobPreview`，確認 4／4 場景預覽可讀。

任務狀態為 `waiting`、phase 為 `checking`，**最後自動語義品質審查仍待執行**。沒有將它標示為 completed，沒有發布成完整教材，也沒有新增模型請求。先前授權的額外模型工作上限仍已耗盡。Chrome 重新連線後的實際閱讀 UI 未在此步驗證。

可重播證據位於 `work/compact-json-failure-20261103/`：`job.original.json`、`output-0.txt`、`output-1.txt`、`replay.mts`、`replay-result.json`、`job.before-apply.json`、`applied-recovery.json`、`installed-preview.json` 與 `host-backup/`。重播程式刻意在 4 場景可讀時停止，禁止呼叫模型。
