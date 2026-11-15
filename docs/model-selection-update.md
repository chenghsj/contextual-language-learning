# 模型選擇與 Antigravity 更新

2026-10-13：pi-antigravity 已由 0.8.1 升級至 0.10.0，移植帳號目錄隔離、Pi 1.0.4 chat 型別相容性、Gemini JSON opt-in 及付費空回覆不自動重送的 patch。npm tarball 完整性已核對，專案宣告的 pnpm 9.15.4 frozen-lockfile 驗證通過；使用 Node 22.20.0 驗證。

使用套件的 fetchAvailableModelsCatalog 查詢與 buildAntigravityCatalog 分組，只保留帳號清單實際回傳的模型與推理強度，保留已知容量 metadata；不補回未回傳的靜態模型。明確空清單在 Host 重啟後保持空；查詢失敗保留快取與警告，標示尚未確認。已存模型不在有效清單時顯示不可用、阻止生成；生成前更新動態清單。選擇模型不發送付費測試。

五種介面語言同步顯示目前列名／尚未確認／不可用；舊 Host 缺少確認欄位時顯示尚未確認。查詢失敗不誤判成永久停用，普通429不作為模型被下架的證據。

**實際登入帳號清單仍回傳 Gemini 3.7 Flash。** 這次測試只能確認列名，不證明推理可用，也未證明服務商已將3.7下架。介面因此使用「服務商目前提供此模型，請求仍可能受容量或額度限制」，不宣稱一定能成功生成。移除了靜態補回行為，但不會捏造服務商回覆來排除3.7。

52項SDK／清單／介面／協定定向測試通過；另外6項串流回歸通過，包含缺少finishReason、尾端503、emoji／組合字元與原有JSON／取消案例，其中4項與52項重複。三個專案型別檢查、production build、standalone bundle、建置版及已安裝Host stdio smoke通過。production build沒有覆寫Chrome Dev的dist-dev，沿用HMR。

Native Messaging協定12；安裝來源為本checkout的apps/local-host/dist/native-host.mjs，Chrome extension ID agkdfdbgkoeooffhfkonpdkgfeldjifi。交付時建置及安裝SHA-256一致：`9157232ada79f2c72d3fbcd0df529acc34d08a9c4387b8226ec442754ab40895`。共享工作區後續建置／安裝會更新此雜湊；這是本次核對時的快照。

精確版本、patch雜湊與清單快照在 [model-selection-update.json](model-selection-update.json)，没有憑證或帳號識別資料。

實際Chrome重新連線與畫面仍未驗收。先等待擴充功能中的生成結束，再關閉所有本擴充功能的Side Panel與設定頁，重新開啟、重新整理模型。背景控制器在無活動任務、無請求且無介面連線時關閉idle Host，重新連線即可載入新安裝檔。若仍使用舊Host，可在沒有生成時重新載入Chrome Dev擴充功能；維持HMR，不以production build替換dist-dev。

本次只更新模型選擇與套件／Host，不啟動或續跑主對話的教材任務，沒有改動既有教材或其驗收結果。舊patch檔留作歷史資料，package.json與目前執行harness只使用0.10.0 patch。
