# 全產品動畫與偏好：實作驗證

日期：2026-10-16。工作目錄 `/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`、HEAD `21969bc`；保留既有本地變更。

## 完成項目

- 一般設定使用單一「減少動態效果」Switch，含五種介面語言及欄位說明連結。開啟為 `reduced`，關閉為 `full`（預設），即時套用並保存。依使用者回饋移除三選項與系統跟隨。
- 偏好沿用 `preferencesV2`，缺少欄位、舊版 `system` 與無效值回退 `full`；原有明確 `reduced`／`full` 保留，系統變更不影響開關。`html[data-motion]`、Tailwind motion variants 與原生內容動畫使用相同有效模式，涵蓋 Portal。
- 設定／活動 Sheet 240／180ms；子頁、建立步驟與字幕預覽使用前進／返回方向；內容庫及標準／自訂閱讀器正文淡入；場景切換只影響正文，標頭及播放器固定。
- 標準 Accordion 180／160ms 展開／收合，保留原有 `forceMount`／`hidden` 邏輯；活動列收起仍立即隱藏，避免隱藏內容暫時可聚焦。Dialog、Popover、通知及轉動指示遵循同一偏好。
- 動畫取消不重掛 DOM、不保留透明或位移狀態；減少動態效果不清除 Dialog／Popover 定位 transform。
- 儲存失敗回復已成功保存的偏好；App 跳過與 Store 相同的偏好快照，避免失敗回復造成無限重試。

## 自動測試

- 本次開關調整執行 4 個相關測試檔，共 **15 項通過、0 項失敗**：motion controller、內容動畫 hook／五語系、偏好保存／舊資料轉換，以及共享元件樣式。初版三選項實作曾執行 16 個檔案、120 項通過；未在本次重跑該較大範圍。
- 行為測試涵蓋兩種開關狀態、重複設定不發送通知、動畫中斷與卸載清理、資料刷新不重播、保留 input DOM／未儲存內容、舊資料及無效值相容、保存與失敗回復。
- Extension 與 Core typecheck 通過；Extension production build 通過。既有超過 500kB 的 bundle 提示仍在，未擴大為打包拆分工作。
- 修改檔案的 Prettier 與 diff whitespace 檢查通過。

## 真實瀏覽器預覽驗證

執行 `pnpm --filter @contextual/extension test:motion-ui`。使用實際 App、原生 Web Animations API 與 CSS，在隔離的 Chrome／Vite 預覽執行；Host、字幕、語音與影片為模擬，不存取使用者教材或呼叫模型服務。

| 檢查                  | 確認結果                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| 開關與系統偏好        | `full`／`reduced` 及舊版 `system` × 系統兩種偏好共六組；舊版轉 `full`，系統變更不影響開關、不重播頁面 |
| Sheet 與內容導航      | 完整模式開啟為 240ms；前進內容動畫為右側 12px，Header 固定；減少模式沒有位移進場                      |
| UI 選擇、重新載入     | 實際開啟減少動態效果、確認保存並重載；開關及有效模式保留                                              |
| 持續寫入失敗          | 顯示錯誤、回復原選項；只記錄一次失敗，沒有儲存重試迴圈                                                |
| 鍵盤操作              | Space 可開啟／關閉開關，有無障礙名稱與說明關聯                                                        |
| 快速前進／返回        | 最後目標正確，沒有殘留舊內容；關閉 Sheet 回復原入口焦點                                               |
| 建立流程              | 自訂 Prompt 在下一步及返回後保留                                                                      |
| 閱讀器場景切換        | 正文動畫 160ms；Header 及播放器的 bounding box 不變                                                   |
| Accordion／Popover    | Accordion 實測 `app-accordion-down` 180ms；Popover 完整模式有 enter，減少模式為 0.01ms                |
| 減少動態效果的 Dialog | 320×560 的字幕編輯 Dialog 無進場動畫、仍正確置中，可正常完成與關閉                                    |
| 響應式與色彩          | 320／390／555／900px，以及 320px 高短視窗；淺／深色、繁中與日文長說明；主要頁面與 Sheet 無水平溢出    |

量測資料：[results.json](results.json)。截圖：[390px 動畫設定](motion-preference-390.png)、[320px 動畫設定](motion-preference-320.png)、[減少動態效果 Dialog](reduced-dialog-320.png)。

另執行既有 `dialog-acceptance.mjs`，320／640px × 淺／深色 × 一般／減少動態效果共 **8 組通過**，檢查固定 Sheet Header、長標題、Dialog 定位及焦點回復。該次證據位於 `/var/folders/9p/y1z7d0wd4033k52mhtfk2trc0000gn/T/cll-dialog-llChGj`。

## 驗證邊界

未執行完整 repository suite、整份 `ux-layout-acceptance.mjs` 或已安裝 Extension 的真實影片／OS 朗讀驗收；其 Sheet 時間斷言已由 500／300ms 更新為 240／180ms。本機預覽與上述測試不代表發布或安裝版已驗收。

首次瀏覽器腳本曾停在收合的錯誤詳情、未先關閉的錯誤通知、重複場景資料及缺少的 Popover 定位標記；已修正驗收流程／fixture、補上元件標記，再完成全流程。兩場景 fixture 通過現有 V7 字幕完整性驗證，未放寬內容驗證。

本次改為開關後，保存失敗的測試操作改用 click，以允許開關在失敗時立即回復；不要求刻意失敗的寫入仍保持新值。

## 過場時間微調

場景切換由 120ms 調為 160ms；同層頁面由 140ms 調為 180ms；子頁、建立步驟及字幕預覽前進由 180ms 調為 200ms。返回 160ms、閱讀器入口 180ms、面板 240／180ms 與 Accordion 180／160ms 維持。瀏覽器驗收新增子頁前進 200ms 斷言，場景斷言更新為 160ms。

本次微調後，重新執行上述 4 個相關測試檔（15 項通過）、Extension typecheck、production build 與完整 `test:motion-ui` 均通過。瀏覽器實測確認子頁 200ms、場景 160ms，並再次通過開關、保存失敗回復、草稿、固定播放器及響應式檢查；安裝版／真實影片仍未驗收。

## 2026-10-21 再放慢轉場

依「轉場還是有點快」的回饋，場景切換由 160ms、同層頁面及閱讀器入口由 180ms 統一調為 240ms；建立步驟、設定／活動子頁及字幕預覽前進由 200ms 調為 280ms，返回由 160ms 調為 240ms。設定／活動 Sheet 開啟由 240ms 調為 320ms、關閉由 180ms 調為 240ms，遮罩同步。Accordion 與即時操作回饋沿用既有時間。

在 `codex/core-redesign`、HEAD `ece1cde` 的未提交工作區執行動畫 controller／hook 兩個測試檔（5 項通過）、Extension typecheck、production build 與完整 `test:motion-ui`，均通過。本次 [results.json](results.json) 及同目錄截圖已更新；瀏覽器確認 Sheet 開啟 320ms、子頁前進 280ms、場景 240ms，並通過偏好保存／失敗回復、快速導航、草稿保留、固定播放器及響應式檢查。

驗收腳本先展開目前閱讀器的解析群組，再操作其中的 AI 延伸例句；第一次執行因舊操作順序逾時，更新後完整通過。修改範圍的格式及 diff whitespace 檢查通過。`ux-layout-acceptance.mjs` 的 Sheet 時間期待已同步，但本次未重跑該完整腳本；未執行完整 repository suite、安裝版 Extension 或真實影片／OS 朗讀驗收。
