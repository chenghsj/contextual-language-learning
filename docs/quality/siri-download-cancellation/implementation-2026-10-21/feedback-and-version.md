# 下載回饋與 en-US-G 狀態恢復

2026-10-21，macOS 27.0.1。此紀錄更新同日較早的驗證結果。

## 回饋保持精簡，不把動畫當比例

使用者回報狀態靜止後，初版增加不定比例動畫、背景說明與最近確認時間。使用者指出資訊太多，又詢問能否顯示正確比例。最終改為原有狀態旁的小轉圈，確認時間放在滑鼠提示中。Siri 清單與收合的活動列共用同一個元件。

目前原生 wire 只提供訂閱、資源、取消阻擋與排序觀察值，沒有傳輸位元組數，因此這個 UI 不顯示比例。唯讀 runtime 探針確認 UAFAssetSetStatus 有 completedBytes、totalBytes、completedPercent，但尚未驗證可可靠對應到單一語音工作的查詢方式。這不代表 macOS 沒有進度資料，也不代表真實百分比不可能。

連線無法觀察、儲存失敗或工作 observation unavailable 時，動畫停止。減少動態效果設定同樣停止動畫。進度結果仍由 worker 擁有，UI 沒有新增 timer 或重送下載。

預覽檢查涵蓋 320px 繁體中文淺色、480px 日文深色與 reduced motion、斷線後動畫停止、工作完成後指示消失，以及 Activity 收合時仍有指示。15 項相關測試、typecheck 與 extension build 通過。[獨立 UI 複查](feedback-review.md) 沒有重大未解決項目。

## en-US-G 的狀態查詢被版本比對阻擋

使用者之後回報 en-US-G 不斷停留在申請中，活動頁顯示無法查詢。對原本同一個操作 `6eac35fa-a83d-4aa7-acca-82eb9904aa56` 唯讀呼叫已安裝 helper，重現 `The Siri operation subscription identity does not match.`。

當時 durable receipt 記錄已進入且已獲確認的開始要求，資源識別為 `en-US:natural:female:en-US-G:premium:5028`。使用現有 SiriDownloadDaemon 在獨立唯讀程序回查，該操作自己的 client 回傳 `en-US:natural:undefined:en-US-G:undefined:0`。版本欄位差異導致嚴格比對拒絕，開始要求雖已被系統接受，worker 卻無法得到成功 observation。

比對現在只在 gender 與 footprint 均為 undefined、版本為0的已觀察 canonical 形式中接受省略的版本。語言、類型、聲音名稱、操作 UUID 和 client 隔離保持檢查。明確回傳不同版本、已指定 gender 的版本0、不同聲音與不同類型仍不接受。取消仍先持久化 fence，只撤回自己 client，不刪除語音。

新增 Swift 回歸測試在修正前得到 `[true,false,false,false,false,false]`，預期為 `[true,true,false,false,false,false]`。修正後 9 個 Swift 測試通過。已重建並原子替換既有安裝的 macos-speech-siri，保留舊 binary 備份，其他 Host 程式與使用者資料未更動。安裝檔與建置檔的 SHA256 相同。

[`version-readback-after.json`](version-readback-after.json) 記錄原工作開始能正常回查。期間使用者已要求取消，worker 恢復後完成該取消要求。[最終唯讀回查](version-readback-cancelled.json) 確認自己的訂閱 absent、資源 absent、cancelFenced true、ordering settled。[實際活動頁 AX](version-readback-ui.txt) 與[截圖](../ui/actual-version-recovered.jpg) 顯示兩筆 en-US-G 已取消，以及先前 Nora 已下載。驗證未重送下載要求。

這次原生修正的獨立複查最初因審閱者額度不足而中斷。額度重設後，[gpt-6.1-sol 已完成此原生修正與後續試聽句修正的複查](native-preview-review.md)，沒有重大未解決項目，並獨立通過9項 Swift 測試。合併與發佈未執行。

最終 `pnpm test` 完整通過847個 TypeScript、32個 Node、5個 package-manager 與1個設定測試。Extension build、typecheck 與原生 helper build 通過。Experience First 原則促成使用者要求的資訊精簡，Prove It Works 原則要求以原本操作在已安裝 helper 與實際側欄驗證，沒有把較早模擬 UI 檢查當成本次原生修復的證明。
