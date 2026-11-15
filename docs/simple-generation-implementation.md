# 簡化教學生成

日期：2026-10-14。prompt `learning-points-prompts-14`、檢查策略 `program-validation-1`。

## 行為

- 素材候選／選材流程保留。每批教學生成一次，程式驗證完整來源覆蓋、引用／ID、來源字元範圍、啟用類別、例句數與目標。
- 格式或結構失敗最多自動修正一次，使用同一教學 prompt 附具體錯誤與前次輸出。未知結果的模型傳輸失敗不當結構錯誤重送。
- 無固定 AI 品質 review／repair／recheck，不可靠選填讀音本地省略，保留教學與來源並記錄診斷。
- 人名／人物稱呼保留來源寫法。無法確定正確姓名不等於無法理解句意；不可靠读音省略，不補猜測漢字。
- 有效模型輸出先保存 pendingTeaching，取消後續跑沿用，不重新付費生成。完成批次不重跑。
- 舊 prompts-12／13 V7 完成教材仍可讀取，不改寫檔案。使用者續跑舊任務時驗證固定來源／模型／分組後，更新未完成工作之策略，記錄 previousExecution 並保留舊 calls 與完成批次；不直接發布 blocked 草稿。

## 驗證

- 新增紅綠回歸：不確定來源仍一次生成完成；舊 blocked 任務只重新生成未完成批次。舊流程分别報 unexpected quality review 與 Quality blocked；修改後通過。
- 驗證格式失敗一次修補、取消競態保留已收到輸出、可用教材在省略讀音後仍完整、相容 V7 教材讀取前後檔案內容相同。
- 固定 pointsFixture 日文 N3 教學 prompt：32,020 → 10,161 字元，減少約 68%。這是字元量，不是實際 token／帳單測量。
- 上述為離線結構／恢復測試；尚未用真實模型重新生成同一份影片，不能宣稱翻譯或教學品質因此提升。

## 本機交付與限制

- 核心／生成／任務／儲存定向測試 184／184，三個 workspace 型別檢查、production build 與 Host stdio smoke 通過。Native Host 平台／standalone bundle／entrypoint／setup 封裝測試通過；setup 的 localhost 沙盒限制在允許本機監聽的暫存測試環境重跑 3／3 通過。
- 完整套件首次為 714 passed、15 failed、1 cancelled（730 tests）。失敗涉及未修改 UI 契約、缺少 execution 的舊傳輸 fixture、OAuth localhost 沙盒限制及佇列 fixture。傳輸 fixture 用修改前後的讀取函式均重現拒絕；OAuth 在允許 localhost 的測試環境重跑 6／6 通過。完整套件未宣稱全綠。
- 已更新既有 Chrome extension `agkdfdbgkoeooffhfkonpdkgfeldjifi` 的本機 Host。建置與安裝 SHA-256 相同：`063b699a91cf790094b46aebf4906a1c9d320ad623f49a998f594e3c423dd583`。
- 已安裝 Host 協定 12：實際失敗任務 `e95ec3bb-e171-4fd6-9866-05816df2024c` 仍可讀取執行紀錄；prompts-12 完成教材 `68f7ac84-5d9c-4a25-97d7-51d0792881c6` 可讀回完整 309 字幕。此項沒有 AI 呼叫，也沒有續跑或改寫實際任務。
- Browser 已載入的擴充功能及既有 Host 連線需重新載入／重連。未宣稱 Chrome 真實續跑、新模型教材品質或影片播放已驗收。
