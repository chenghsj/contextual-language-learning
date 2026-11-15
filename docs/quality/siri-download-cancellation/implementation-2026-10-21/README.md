# Siri 下載產品整合驗證

2026-10-21，macOS 27.0.1，Apple Silicon。工作目錄為 `codex/core-redesign`，HEAD 為 `ece1cde`，包含尚未提交的既有與並行變更。

刪除成功提示已改用共用 Sonner toast，會自動消失並可手動關閉，錯誤仍留在對應聲音旁。[通知修正與驗證](removal-toast.md)。

最新刪除修正已完成。Samer 刪除後約62秒仍保持未下載，本程式訂閱已撤回，Nora、Helena 的資源與訂閱保留。「可下載」列表不再顯示舊完成標籤，活動歷史仍保留。狀態改為「已交由 macOS 處理」，按鈕改為「取消下載」。完整測試848個 TypeScript、34個 Node、5個 package-manager、1個 config 通過，型別檢查、extension 與 native 建置通過。[刪除與文案修正證據及驗證範圍](deletion-repair.md)。

最新更新已精簡回饋為轉圈與確認時間提示，並修復 en-US-G 的 daemon 版本省略造成的狀態查詢失敗。同一筆工作已在實際側欄恢復取消。最近完整測試 847 個 TypeScript、32 個 Node、5 個 package-manager 與1個 config 測試通過。[完整更新與驗證範圍](feedback-and-version.md)。後續另補齊12種缺少的試聽句，[Else 已在實際側欄試聽成功](voice-preview.md)，相關23測試與建置通過。原生版本比對與試聽句修正的獨立複查現已完成，沒有重大未解決項目。真實下載百分比仍未串接。

後續使用者實測發現 Chrome worker 計時器 receiver 錯誤，造成 `Illegal invocation`。此問題已修正，原先三筆取消要求已恢復處理，並實際觀察 Nora 在關閉側欄後完成下載、重開活動頁保留結果。[計時器修復與實際側欄補驗紀錄](timer-recovery.md) 更新下文較早的驗收限制。

## 實作狀態

背景 worker 保存下載工作，Siri 清單與活動頁使用同一份狀態。關閉頁面不會取消下載。每個工作可獨立取消、重試與查看對應聲音，活動頁可清除已結束的紀錄。狀態觀察中斷與下載結果分開表示，沒有虛構百分比或預計完成時間。通知只在應用程式內顯示。

Native helper 以操作 UUID 建立獨立 Siri client，持久化開始與取消紀錄。取消只撤回該 client 的訂閱。若其他 client 仍使用相同資源，介面會表示自己的要求已取消，而系統可能繼續下載。取消不刪除已安裝資源。

## 實機 helper

[`accepted/result.json`](accepted/result.json) 記錄 Axel 取消、同一操作的延遲啟動被阻擋、重複取消、Else 獨立完成及既有資源保留。逐步輸入與回覆保存在 [`accepted/operations.ndjson`](accepted/operations.ndjson)。這次實驗新增完成的 Else 保留在系統中。

初次整合發現 XPC proxy 轉型崩潰與 daemon 省略 gender、footprint 的資源識別差異，修正後才通過實驗。資源比對仍要求語言、類型、名稱與版本一致，只允許 daemon 實際省略的兩個欄位為 undefined。

完整實機下載實驗早於最後的缺失 receipt 與共享資源 key 保守處理修正。最終 helper 已重建並安裝，Swift journal 測試通過。[最終已安裝 helper 的唯讀回查](final-installed-helper-readback.json) 確認 Axel 仍無訂閱、無資源，取消阻擋紀錄為 true，排序為 settled。沒有重跑最終版本的完整並行下載實驗。

## UI 與實際擴充功能

注入模擬 client 的預覽測試涵蓋 320px 繁體中文淺色、480px 日文深色、逐項取消、獨立工作保留、活動數量、頁面切換後狀態保留、完成不自動切換分頁，以及相同聲音重試後從正確歷史工作查看已下載聲音。截圖位於 [`../ui/activity-320.jpg`](../ui/activity-320.jpg) 與 [`../ui/siri-dark-ja-480.jpg`](../ui/siri-dark-ja-480.jpg)。這些截圖是模擬預覽。

實際 Chrome Dev 側欄已確認能列出 Else、Aaron、Sakura、Jinsoo、Tilde 與 Shufen。最初安裝的 Host 使用 protocol 12，原始碼為 14。更新 Host 後直接健康檢查回報 14，語音清單回覆 193 筆。更新只替換既有程式與 launcher，未更動使用者教材資料。

另一個故障來自本次新增的設定測試。測試透過 resolveConfig 執行 CRXJS 的 configResolved，清除了正在使用的 dist-dev，Chrome 因而找不到 manifest。測試現改為讀取原始設定，並僅在暫存根目錄解析不含 plugin 的 cache 設定。開發服務已重啟，輸出已恢復。[測試前後的 manifest 雜湊](dev-manifest-retention.json) 相同。重新連線按鈕移除 44px 最小高度，使用既有 small button 的 32px 高度。IAB 的 disconnected 預覽實際量測為 74×32px，[畫面已保存](../ui/reconnect-small.jpg)。

實際 Chrome 側欄在原生下載期間關閉再開啟的完整操作驗收尚未完成。目錄連線已確認，後續原生視窗控制回報沒有可用視窗。模擬 UI、worker 持久化與實機取消各自有驗證，但不能合併宣稱完整的實際側欄端到端驗收。

## 自動檢查與獨立審閱

`pnpm test` 通過 843 個 TypeScript 測試、31 個 Node 測試、5 個 package-manager 測試與 1 個 Vite 設定測試。之後修正設定測試的清理副作用，單獨重跑通過並確認 live manifest 保留。`pnpm build` 與 `pnpm typecheck` 通過。Swift journal 8 個測試與保存證據的 4 個反例控制通過。

獨立 gpt-6.1-sol 審閱找出的開始標記競態、未送出工作無法結束，以及活動頁選到較舊同聲音工作均已修正。額外發現的 frozen resource key 與缺失 receipt 排序問題也已修正。[最終獨立審閱](handoff-review.md) 沒有重大未解決項目，保留上述實機驗收限制。

Model the Domain 原則使 worker 成為下載工作狀態的單一擁有者。Prove It Works 原則使實機 helper、模擬 UI、實際 Chrome 目錄與尚未完成的操作驗收分別記錄。

這些結果不涵蓋其他 macOS 版本、正式部署、Store 發佈或 Windows Siri 支援。
