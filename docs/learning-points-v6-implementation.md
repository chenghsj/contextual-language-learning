# V6 接入與驗收紀錄

日期：2026-10-09。工作目錄 `/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`，起始 HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`。保留原有未提交變更，未發佈、部署或建立提交。

## 已接入

新標準請求明確指定 outputSchemaVersion 6；Host 要求協定 7。V5／V6 使用獨立 schema、驗證器及共用唯讀 reader adapter。V6 場景保存原句來源與基本理解，教材層保存 points／reusableItems；完整原句可跨字幕，重點可非連續或跨原句共用，沒有可移用項目與沒有額外重點皆合法。

V5 留在 data-v5，新教材與 checkpoint 4 寫入 data-v6。混合教材庫與歷史讀取、按版本保存／校準／還原，JSON／Markdown 匯出及 Drive metadata 支援兩版本。相同來源的 V5 是已有內容提醒，V6 完全相同生成比對包含資料、workflow、prompt、程度與語言策略版本。舊 checkpoint 3 不以新策略續跑。

候選探索、素材篩選、原句教學使用同一 prompt 組裝器。候選保留每段前後兩則上下文；來源原文與時間不改寫。程度影響選材及必要支援，Detailed 只進入教學深度。Chunks Off 仍可由 Grammar 教句型。場景數 2／4／6、每可移用項目例句 1／2／3、12 語言、17 級別與六類設定保留。

每次輸出預算 min(模型上限,8192,context/4)，另留 1024 安全 tokens。輸入超量縮候選 window、分組 shortlist 或按完整原句拆教學批次。每個批次驗證後保存，結構錯誤最多一次自動修復；拆批須減少單位數。只有完整覆蓋、通過最終合併驗證才存成完成教材。失敗保留其他成果；續跑驗證凍結版本、模型容量、來源及計畫。

SDK 的成功、空輸出、截斷及回傳 error 訊息皆先記錄可得用量，再做輸出驗證；未回報的用量維持未知。初始輸入估算不代表總費用。

閱讀入口是完整原句；跨字幕解析放在最後一行下。例句入口只在相關可移用項目存在時出現；其他出現只搜尋 sourceForms。播放、選句、翻譯、解析及顯示設定互相獨立，點擊既有解說不呼叫模型。

## 自動化與本機預覽

- V6 定向契約、生成、分批、一次修復、失敗 checkpoint、續跑、版本凍結、混合儲存、Drive 還原／metadata、分塊傳輸測試通過；涵蓋 Chunks Off＋Grammar On、三個以上重點、全關閉、各類關閉、例句數、同字串異義、既有重點引用、跨字幕與非連續 span。
- 12 語言與 17 級別的策略路由測試通過；此項不證明教學品質。
- typecheck、Extension／Host build 通過。
- 協定 7 實際 Host 程序 smoke 通過：V5／V6 混合列表、讀取、V6 校準保持原文時間、重複檢查及 custom-v1 相容。
- 320px／1000px 預覽通過：基本原句無例句入口、相關重點、延伸例句、原文出現搜尋、播放與翻譯保持解析、無水平溢出或 pageerror。播放使用 preview adapter。
- SDK 定向測試在允許 localhost 的環境 5／5 通過；Host Setup 3／3 通過。沙箱中的 OAuth callback／setup listen EPERM 另外記錄，沒有當成產品回歸。
- 完整回歸失敗清單與原先基線一致：五個既有 UI 契約測試、一個既有 zz-debug-prompt timeout、兩個受 localhost 限制的 OAuth 測試。未以本次範圍改寫既有 UI。

完整回歸 `pnpm test`：559 個測試，551 通過、8 失敗；與實作前 542 個測試、534 通過、8 失敗的清單一致。後續包裝／platform／entrypoint 測試共 27 項，其中 26 在沙箱通過；Host Setup 剩餘的 localhost 案例在允許 localhost 的環境通過（該檔 3／3）。

## 真實模型教材

使用執行時介面指定的 Antigravity `gemini-3.7-flash`，middle 對應 SDK `medium`，context 1048576、模型輸出上限 65536、每次實際預算 8192。英文 B1、日文 N3、韓文 TOPIK 3，各兩段原創合成四句對話，Normal／Detailed 共 12 設定，六類啟用、例句 1、最多 2 場景。測試資料與生成結果使用隔離暫存庫，不放入使用者教材庫。

第一輪 prompt 1：5／12 完成。第二輪 prompt 2：9／12 完成。失敗沒有存成教材；保留執行版本、來源、各次呼叫用量及 checkpoint。根據輸出修正 V6 語塊 ID 長度、讀音定位、例句 JSON 形狀及 span／target 具體錯誤提示。

格式通過後另審查選材、正確性、自然度與深度，不能用點數增加證明 Detailed 有效。樣本可找出三個以上重點、獨立文法句型及沒有必要增加解說的句子；抽象框架、文字讀音及推論仍須逐份審查。

## 尚未完成的外部驗收

實際影片上的播放／字幕讀取與解析操作，以及目前已載入 Extension 的版本／Host handshake 尚未驗收。瀏覽器工具拒絕直接開啟 chrome-extension URL，因此僅使用本機 http 預覽與隔離 Native Host 驗收，沒有繞過 URL 限制。

Drive 相容已由注入 transport 的 API／metadata／還原測試確認；未對使用者真實 Drive 執行 V6 備份／還原。此紀錄不等同商店發佈、遠端部署或完整教學品質認證。

## 第三輪內容審查與修正

Prompt 3 的 12 個設定中，11 個直接完成；韓文 changed-plan Detailed 因一份完全沒有 reading 的 annotation 被拒絕。補強錯誤定位後，該設定獨立重跑 1／1 完成。因此 12 種設定皆有通過結構／引用驗證的產物，這不是 12／12 教學品質通過。

人工檢查發現：日文 forgotten-item 的部分 frame 將縮約的「てたら」概括成「て形＋たら」，省略了 underlying form；韓文 reported-decision Detailed 有一處將請託發話者指成民秀；部分讀音仍有詞界或音變疑慮。Normal／Detailed 有可觀察的關係／替代形式差異，但並非每組都有充分且穩定的深度提升。

Prompt 4 加入活用／縮約還原、轉述角色追溯及具體深度要求，針對日／韓兩段素材的 Normal／Detailed 共 8 設定重新檢查。原先失敗與審查意見保留，不因後續重跑成功抹掉。

## 最終交付狀態

Prompt 4 的日／韓重查 7／8 直接完成；最後的韓文 reported-decision Detailed 仍因沒有 reading 的 annotation 被拒絕，獨立重跑後完成。英文 4 設定保留 prompt 3 的結果，日／韓 8 設定保存 prompt 4 的最新成功結果。12 個設定都有通過目前 V6 結構、來源、引用與對齊驗證的教材；全部執行嘗試、失敗與用量，以及最新成功教材與審查意見，保存於 [品質結果 JSON](./learning-points-v6-quality-results.json)。

**真實模型的教學品質驗收尚未全數通過。** Prompt 4 改善部分角色追溯，但日文 forgotten-item 的抽象 pattern 仍有省略縮約關鍵成分的問題；韓文 reported-decision Detailed 的重跑仍將未確定的請託發話者指為民秀。不能將結構成功稱為內容正確，也不能以再生成成功掩蓋上述缺陷。其他設定的例句多數可讀，仍需母語者檢查音變、語用及自然度；英文 Detailed 的深度提升亦非每組都明顯。

最新 V6 定向測試 17 項通過，SDK 5 項在允許 localhost 的環境通過；Host client／generation-session 等另外的定向回歸共 23 項通過。一次修復額度會保存在 checkpoint；手動續跑可重試未完成的生成，但不續增同批的自動修復額度。最後修正以對應定向測試驗證；上述完整回歸保留其原始結果與失敗清單。

Extension 與 Host 最新 build 通過；已安裝對應 Chrome ID `agkdfdbgkoeooffhfkonpdkgfeldjifi` 的 Native Host，安裝檔與本機 bundle SHA256 同為 `3a99df15fbc5f6bab7f29fdbac4ef5533fe087d63a88f2f8ffd952f366d89f89`。Host 安裝與 isolated connect/uninstall/health 測試不證明目前開啟的影片分頁或已載入 Extension 已更新，需重載並另行驗收。實際 Drive、影片與載入版本的外部驗收仍保留在未完成清單。

跨字幕原句與跨兩行的非連續理解語塊也已在 320px／1000px 預覽通過：點擊任一片段共用同一份解析，完整原句解析在最後來源行下，播放與翻譯維持獨立。截圖位於 `/var/folders/9p/y1z7d0wd4033k52mhtfk2trc0000gn/T/cll-v6-ui-L1iQNk/`。
