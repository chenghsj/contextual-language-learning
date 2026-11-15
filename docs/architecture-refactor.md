# 架構重構紀錄

日期：2026-10-17。來源為 `codex/core-redesign`（HEAD `21969bc`）及既有的未提交開發內容；本次已更新既有 Chrome 開發版的本機 Host，未建立 commit 或發布套件。

## 交付範圍

- **Create 流程：** `useCreateFlow` 集中草稿恢復、步驟、分析範圍、Quick Create、本次設定覆寫、預估與送出檢查。`CreateFrame` 集中步驟導覽、捲動、動畫及 Footer；App 保留全域偏好、頁面切換、跨頁事件與內容區塊組裝。
- **生成生命週期：** 既有 `GenerationSession`／Background 保留連線及入列鎖定責任。Create 模組不建立或 dispose session；上次使用設定只在收到新任務的 durable admission 事件後保存，並使用送出時的獨立 snapshot。
- **生成階段：** 候選、挑選、教學分別移至 `learning-candidates.ts`、`learning-selection.ts`、`learning-teaching.ts`。`learning-execution.ts` 管理固定模型、用量、429 降速及序列化 checkpoint 寫入；主 pipeline 組裝、驗證並保存教材。
- **歷史品質流程：** 舊診斷程式移至 `generation/legacy/`，移除目前 `PipelineDependencies` 中的品質呼叫選項。舊 V7 schema、checkpoint 與相容讀取維持原有處理；歷史診斷測試仍執行。
- **教材列表：** 一次列舉取得 ID 與檔案路徑，直接讀取／驗證文件，避免逐份重新掃描所有影片資料夾。保留排序、上限、版本過濾、損壞檔案及重複 ID 的錯誤。
- **設定與 Drive 連線：** `AppearancePreferences` 保留原有語言／外觀選項與 DOM 結構，讓選取、儲存與重新載入可以直接操作驗證。`connectDriveAndVerify` 保留 OAuth 身分先保存、Drive 權限驗證成功後才啟用備份的順序，以及錯誤帳號檢查。

介面視覺、教材／草稿格式、Host protocol 12 與標準／自訂請求契約維持原有設定。這些修改沒有加入新的模型呼叫；生成與儲存回歸使用暫存資料，安裝後另外讀取實際 Host health 與工作列表。

## 驗證

| 範圍               | 結果與界線                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 完整套件           | `pnpm test` **798／798 通過**：來源測試 770、Host 平台／bundle／入口／Setup 23、套件管理器 5；沒有排除檔案、失敗、取消或跳過。模擬 OAuth／Setup 測試允許 localhost 綁定                                                                    |
| 型別／建置         | `pnpm typecheck`、`pnpm build` 通過；Vite 仍提示大型 chunk，Host bundle 仍提示檔案大小                                                                                                                                                     |
| 建置產物           | Extension manifest／content-script asset 檢查與隔離環境 Native Host stdio smoke 通過                                                                                                                                                       |
| 本機 Host 安裝     | 已為 `agkdfdbgkoeooffhfkonpdkgfeldjifi` 更新 Chrome 註冊的 Host；安裝與建置 bundle 的 SHA-256 一致，實際 launcher 回報 0.1.0／protocol 12／pi-sdk，工作列表 2 completed、0 active                                                          |
| Provider 離線測試  | 允許 localhost 的模擬 OAuth 測試 **6／6 通過**；沒有交換真實憑證或呼叫實際生成                                                                                                                                                             |
| 生成演算法搬移核對 | 將三個階段還原 getter／共用寫入引用後，以 TypeScript AST printer 比對原始階段，內容一致；執行上下文另補 finally 清理                                                                                                                       |
| 瀏覽器 acceptance  | 實際 App／Worker 加模擬 Host，320／360／480px、亮／暗模式；涵蓋範圍驗證、自訂生成、Reader、提示重用、素材庫及設定。不是安裝後的擴充功能／真實影片／外部帳號驗收                                                                            |
| 實際 Chrome 開發版 | 已核對載入來源為本專案 `apps/extension/dist-dev`；5174 開發伺服器 cwd 為本專案 Extension。重新開啟側邊面板後可操作 Create／Settings／Library／Reader；本機服務「檢查連線」完成並顯示已連線、Host 0.1.0，實際教材列表與既有 N5 教材均可開啟 |

Create 行為測試透過可替換的草稿儲存及 session 介面操作，驗證晚到結果、恢復、設定覆寫、Quick Create、導覽、模型就緒、送出錯誤及 admission 保存。移除了三個因函式／按鈕搬動失效的來源排列斷言；對應行為改由操作測試覆蓋。

## 完整套件修復

初始基準曾有舊介面斷言失敗、佇列測試取消，以及重複 debug 測試造成 SIGKILL。後續先單獨重現，再修復測試契約與同步方式；目前完整套件已通過。

- `host-queue.test.ts`：標準任務的空模型 ID 在開始生成前被拒絕，測試卻一直等候生成開始。改用測試提供的 `offline` 模型，並在請求提早結束時立即回報錯誤；沒有修改正式佇列流程。
- `zz-debug-prompt.test.tsx`：與 `custom-prompt-ui.test.tsx` 重複七項情境，缺少焦點更新等待；直接比較 DOM 的失敗輸出又會耗盡記憶體。移除重複檔案，保留 canonical 七項測試與非同步等待。
- 舊來源字串截取改為語言／外觀的實際選取與保存、Drive 延遲驗證／失敗重試／錯誤帳號、進度畫面與按鈕 DOM 行為測試；Create 按鈕由實際 frame 測試覆蓋。
- 瀏覽器預覽刪除教材時，改等候刪除回覆反映在資料狀態，取代固定 100 ms；另驗證對應工作歷史仍保留。六個尺寸／主題組合皆通過。

安裝後 bundle SHA-256：`32a69040ba9f180ea5cc0bfae2d0eb02972d726df406240ae21a2d0c4513642b`。

初次檢查曾遇到 Chrome 詳情頁及側邊面板空白；在新分頁開啟同一詳情頁、關閉並重新開啟側邊面板後已恢復顯示。尚未確認根因，也沒有因此修改正式程式。後續實際 Chrome 檢查已確認開發版來源、Host 連線、教材列表及既有教材 Reader；此輪使用 HMR 開發版，未驗證 release `dist` 安裝、真實影片生成／取消／續跑、真實 Drive 權限或正式發行。

## 後續獨立建置檢查

依使用者安排，真實 Chrome 生成／取消／續跑驗收延後。此次沒有送出新的生成請求或執行 Drive 備份。

- 重新執行 `pnpm build` 與 `node apps/extension/scripts/check-build.mjs`，皆通過。正式 Extension 的 manifest、content script 經 classic JavaScript 解析，以及編譯後 CSS 檢查通過。
- `node --import tsx apps/extension/scripts/host-health-acceptance.mjs` 通過：在暫存 HOME 註冊正式 Host，驗證解除安裝後新 health 連線失敗、原有工作連線仍可回覆。使用 filesystem-backed browser adapter，沒有改動使用者的 Host 註冊。
- 將 `apps/extension/dist` 封裝成暫存驗證 ZIP：19 個檔案、13 個 manifest／HTML 引用資源均存在，ZIP CRC 與每個檔案的建置位元組比對通過；版本 0.1.0、沒有嵌入 extension key，也沒有 HMR loader 或 5174 開發伺服器依賴。
- 驗證 ZIP SHA-256：`1bb3af140b7c14d3b0f97d84ed31140348d1371ed0eebcf5942acb6e75acecb8`。這是暫存靜態驗證包，未執行六平台 release packaging 或發布。

建置提示仍存在：前端主 JS 約 1.09 MB（gzip 約 349 KB），Host 約 15.7 MB。這些是產物大小，尚未量測安裝後載入時間；是否拆分 bundle 應由載入效能量測決定。

## 列表量測與後續

後續已完成前端按需載入與正式產物比較：初始 JS 約減少 14%，保留同步載入的主要閱讀路徑；一般設定首次開啟約多 18 ms。詳見[載入效能紀錄](./load-performance.md)，不要將本機小樣本的時間差解讀為實機效能驗收。

量測只在暫存目錄使用固定小型 fixture：每份教材約 4.4 KB、每個影片資料夾一份，列表上限 50，每個數量測三次。執行時可能有其他回歸程序，僅供本機方向判斷，未量測記憶體或真實長教材。

| 教材數／資料夾數 | 改前中位數 | 改後中位數 |
| ---------------- | ---------- | ---------- |
| 10               | 7.6 ms     | 6.1 ms     |
| 50               | 44.5 ms    | 20.0 ms    |
| 100              | 128.4 ms   | 31.3 ms    |

原始資料見 [library-list-benchmark.json](./quality/architecture-refactor/library-list-benchmark.json)。可從儲存庫根目錄重跑：

```sh
node --import tsx apps/local-host/scripts/benchmark-library-list.ts
```

目前仍讀取完整教材，尚未加入持久摘要索引、分頁或記憶體使用優化。跨程序寫入協調也尚未實作：同一 Host 的序列化仍不保證 Chrome／Edge 不同 Host 之間的交易一致性；該項需要獨立的多程序競爭與崩潰恢復驗收。
