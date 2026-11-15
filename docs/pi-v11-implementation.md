# Pi v11 實作與驗收紀錄

2026-10-12，工作目錄 `/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`，基準 HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`。保留既有未提交工作，未建立提交或 PR。

## 已實作

- 標準教材僅接受 `learning-points-prompts-11`、`learning-points-v6-4` 與目前完整 execution identity；Host 協定 11、V6 教材、V4 checkpoint。移除 v8 提示詞封存、舊選擇／回退／續跑、V5 schema／生成器／reader adapter／儲存合併。
- 本機與 Drive 在完整內容驗證前檢查版本身份。標準教材清單、任務、重複檢查與 Drive 還原略過舊版本，直接開舊 ID 提示重新生成。舊檔與遠端舊檔不刪除、不轉換。branding migration 只延續設定、憑證與獨立 `custom-v1` 內容。
- 允許必要字串 `contextExplanation` 留空；基本回應使用 `basic_only`；翻譯、句意、必要語境、形式用法分工；縮短解說、合併寒暄、不教猜測字幕。reader 略過空白與完全相同文字，翻譯隱藏時仍能查看句意。
- ModelRuntime 按 auth root 共用、合併初始化、失敗可重建，登入／登出刷新共用狀態；每次生成使用獨立 Session，取消與結束時清除監聽器並 dispose。測試注入保持隔離。
- 候選窗口最多並行兩個，以穩定 ID 拆分與儲存，結果依來源順序組合；全部候選完成再統一選材，教學循序。維持 FIFO、單一 writer 與任務鎖。429 將本次剩餘候選降為單工；取消停止派送、取消請求、等待清理，保留有效結果與可取得用量。
- 以精簡既有重點索引取代完整教材；修復提示詞只含一次教學輸入。活動由 `session.subscribe()` 回報 waiting／thinking／writing／retrying，只留記憶體、不寫逐段 checkpoint、不傳推理文字。Create／Activity 每秒更新時間與活動窗口數，五種 UI 語言同步。

## 短樣本

只執行 v11，Antigravity／Gemini 3.7 Flash／medium，四個固定 cues、N3、繁中，每例上限 600 秒。前兩輪雖通過結構驗證，人工閱讀發現縮約、詞源與填充問題，修正規則後第三輪接受；保留兩輪失敗的離線紀錄。

| 樣本             | 最終 v11 時間 | 呼叫 | 重點 | 逐句檢查                                                                 |
| ---------------- | ------------: | ---: | ---: | ------------------------------------------------------------------------ |
| contractions     |     43.447 秒 |    3 |    4 | 保留「なる」及完整縮約，未猜漫畫所有者，不列詞源或場合清單               |
| damaged-negation |     89.458 秒 |    3 |    4 | 「悪いない」只標示不明，不製成教學目標；可靠周邊內容可教，簡單回應不填充 |

[最終樣本報告](quality/learning-points-learnability/prompt-11/report.json)。已保存的 v10 contraction 為 75.466 秒、四次呼叫、六個重點；v10 damaged 的另一次初始執行 360.045 秒中止，續跑 119.486 秒後完成，共十一筆已保存呼叫。這些是歷史紀錄，本次沒有重跑 v10，也沒有保留舊生成器。提示詞、workflow、執行時點、快取、修復／續跑情況及輸出容量不同（歷史 v10 8192，v11 medium 16384），**不是嚴格版本效能比較**。

[離線輸入量測](quality/learning-points-learnability/prompt-11/input-measurement.json)：利用已保存的 31 個重點、24 個項目重建輸入，索引從 69,963 bytes 降到 10,051 bytes（減少 85.63%）；修復附錄從 72,391 bytes 降到 144 bytes（減少 99.80%），教學輸入只出現一次。這是索引／附錄的估算，不能當作整次呼叫 token 節省比例或實際計費量。

## 完整教材

新 UUID：`ce85031e-9c66-4f23-88a0-d73bb2cec4c8`。原任務 UUID `b205ebf3-1d7a-4293-a8e8-74df4491bc41` 只作離線來源與比較。

- 從原請求取得全部 **309 個 cues**，保留逐字內容、ID 與時間；完整範圍、JA／N4／zh-TW、最多四場景、一組例句、Antigravity／Gemini 3.7 Flash／high、本機、不備份 Drive。
- 17:10:23.903Z 到 17:23:31.852Z，**13 分 7.949 秒**；五個候選窗口、十二個候選，統一選四場景、教學循序；十二次模型呼叫，包含兩次結構修復。沒有超過單次 90 分鐘上限，未需續跑。
- 模型生成四場景、20 組 utterances、18 個重點、15 個延伸項目；人工逐場字幕校訂後為 **17 個重點**。四場景選用 22 個來源 cues，其餘仍完整保留在教材來源中。
- 人工校訂四十個欄位／引用變更：移除把「お友達」還原為「〜と食べたの？」的教學、標示「出たぞ」「下に見てる」的未明指涉、移除未經字幕支持的場所／人物關係／修行目的，以及縮短重複、場合清單等。這些校訂屬交付品質檢查，**不能表示原始模型輸出已自動達到所有語意要求**。
- 原句、時間與已驗證讀音沒有改動；「うん。」獨立回應沒有重點、chunks、例句或填充語境。「ただいま／お帰り」共用一個重點。另一個「うん。」和後面的完整回應共用 utterance，沒有另外教「うん」的用法。
- 仍有三筆讀音省略診斷：`ただいま。`、`うん。` 及延伸例句的 `ただいま。` 未提供另外的 annotation；原始假名保留，reader 會顯示讀音未提供提示。沒有把不明詞製成讀音或例句。
- 原教材、原任務的 SHA-256 與執行前相同。新文件、checkpoint 的 sections／points／items 及發布內容一致；本機匯出已同步。未排程或執行 Drive 備份。

[修正版教材](quality/learning-points-learnability/prompt-11-full/ce85031e-9c66-4f23-88a0-d73bb2cec4c8/lesson.md) · [執行報告](quality/learning-points-learnability/prompt-11-full/ce85031e-9c66-4f23-88a0-d73bb2cec4c8/report.json) · [逐項校訂](quality/learning-points-learnability/prompt-11-full/ce85031e-9c66-4f23-88a0-d73bb2cec4c8/editorial-review.json) · [逐場來源與時間驗收](quality/learning-points-learnability/prompt-11-full/ce85031e-9c66-4f23-88a0-d73bb2cec4c8/scene-acceptance.json)。同資料夾的 `model-lesson.json`／`model-checkpoint.json` 保留校訂前輸出，只作離線紀錄，不進產品清單。

## 自動驗證與安裝

- 定向離線測試 **172／172**：共用／隔離 Runtime、兩窗口上限與順序、拆分、429、取消、usage、寫入競爭、續跑只處理未完成、終態清除、舊檔略過且雜湊不變、身份拒絕、自訂內容保留、reader 基本回應與空／重複解說等。
- core／Host／extension 型別檢查通過，production build 通過；standalone bundle／平台／安裝入口測試 **28／28**，Host smoke 與已安裝 launcher smoke 通過。
- 全套 `pnpm test` 為 **643／649**，五個 UI 文案／樣式原碼契約測試失敗，另一個 `zz-debug-prompt.test.tsx` 超時後終止。既有 V6 實作文件已記錄同類五個 UI 失敗及 debug timeout，本次沒有修改那些無關測試；不宣稱全套測試通過。
- 重建目前 Chrome Dev 的 `apps/extension/dist-dev`；安裝 Host manifest 已指向 `agkdfdbgkoeooffhfkonpdkgfeldjifi`。已安裝 bundle 與 `apps/local-host/dist/native-host.mjs` 相同，SHA-256：`31be81956a3232450558efae53eb4c3a5f8831b5d5ab00013d3bda97d3914a0b`。
- [實際已安裝 Host 讀取結果](quality/learning-points-learnability/prompt-11/installed-host.json)：protocol 11、pi-sdk、標準教材清單只有新 UUID，讀到四場景／17 重點／309 cues，publication published，Activity 已清除，舊 ID 拒絕。這是實際 launcher 的 stdio 驗證。

## 尚未完成的實機驗收

瀏覽器安全政策拒絕開啟 `chrome-extension://…/sidepanel.html`，不能改用其他控制方法繞過。已驗證同一份新教材在 HTTP 開發預覽的四場景原句、解說、翻譯隱藏與模擬播放進度；[畫面](quality/learning-points-learnability/prompt-11/episode-basic-reader-preview.png) 清楚標示模擬播放。

尚未確認 Chrome 實際載入路徑、reload、`runtime.connectNative` 重新連線、實際 Create／Activity 畫面及 YouTube 逐場播放。Host 已安裝及預覽通過均不等同這些驗收完成。使用者可在 Chrome 擴充功能頁重載既有 Dev 版，再開側欄確認連線及新教材；原教材應不再出現在標準清單。

另以唯讀方式嘗試核對 Chrome 擴充功能安裝 metadata，系統在一般與提升權限執行下均以 `EPERM` 拒絕讀取 Chrome 目錄；未改權限或換方法繞過。這不是 automatic approval review 拒絕，且沒有取得足以確認實際載入路徑的資料。
