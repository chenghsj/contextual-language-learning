# CLL UX Layout 實作與驗證紀錄

日期：2026-10-04。工作目錄為 `/Users/cheng/Desktop/immersive-language-learning`，分支為 `codex/core-redesign`。本輪以使用者提供的 [CLL UX Layout Spec](cll-ux-layout-spec.md) 修正既有五步流程；每一部分完成後提交。規格中的設計要求不代表發布、遠端寫入或修改真實帳號的授權。

## 分段提交

| 部分             | Commit    | 內容                                                                                                                              |
| ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 字幕恢復         | `91b124a` | 語言草稿恢復、重試及手動匯入入口                                                                                                  |
| 三步流程與 Sheet | `0be8580` | 影片／設定／建立，固定 Footer，設定與活動的 640px Sheet，單次模型與儲存位置                                                       |
| 字幕與影片草稿   | `6b6037c` | 獨立虛擬字幕預覽、文字與時間編輯、原始／工作版本、重新擷取衝突確認、IndexedDB 自動保存、依影片恢復步驟與設定、快速建立            |
| 任務與內容流程   | `932201e` | 持久化 FIFO 佇列、取消及恢復、安全重試、活動 Tabs 與詳情子頁、Prompt 範本 CRUD、完成通知與 Web 閱讀入口、不可用模型／推理選項驗證 |

後續依使用者調整：活動與設定 Sheet 的最大寬度改為 **400px**；窄於 400px 的視窗維持全寬。

## 規格對照

| 決策               | 實作結果                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4、12、14、26–28 | 三步建立；Step 1 範圍，Step 2 模式 Tabs 與基本／進階設定；設定和活動共用一張最大 400px Sheet；左上返回子頁，右上關閉；保留底層草稿與捲動位置，回復焦點；完成步驟可點擊，無效前置輸入阻擋跳步；表單獨立捲動與固定 Footer。                                                                                                 |
| 2、22–25           | 四種範圍；雙端點時間 Slider 僅在自訂模式顯示；未知影片長度不能選半部；無時間字幕只允許完整內容；虛擬化搜尋／編輯預覽、時間驗證；保留原始字幕與工作版本，重取前確認，替換時保留先前版本；工作字幕依影片／語言保存；建立草稿依影片保存，包含所選語言。                                                                      |
| 5–6                | Step 3 可修改本次 Provider、模型與推理強度，不修改預設；使用動態可用模型清單，保留失效選項並阻擋提交；Provider 原地展開登入。**目前 Pi Host 每個 Provider 只有一組授權，UI 明示帳號切換會取代既有授權，不提供假的並存帳號功能。** Google Drive 的既有多帳號管理獨立保留。                                                 |
| 7–8、14–16         | 標準與自訂任務共用 Host FIFO；入列前保存不可變輸入，直到 Host 確認才解除提交鎖定；每次只執行一筆，失敗不堵住下一筆；取消排隊／執行中任務，恢復尚未完成的 checkpoint。Activity 用 Tabs 區分狀態，顯示等待序號、重試次數／等待／原因；詳情在同一 Sheet 返回。完成後保留目前畫面與正在閱讀的文件，通知／活動入口才開啟結果。 |
| 9–10               | 預設儲存位置可在 Step 3 單次修改；重複 Dialog 提供開啟、建立新版本、取消；ticket 綁定不可變快照，入列時再次比對完成與待執行任務。自訂重複識別正規化影片 URL、cue IDs 與物件順序，並保留舊 checkpoint fingerprint。                                                                                                        |
| 11、13             | 保留標準教材分段選景與自訂 Markdown 分段／多層整合 checkpoint；兩種 schema、Prompt、repository 與 renderer 分開。可新增、套用、編輯、刪除命名 Prompt 範本；套用前確認取代，模式切換保留 Prompt。                                                                                                                          |
| 17–19              | 標準教材透過既有 VideoAdapter 尋找對應已開啟影片，不自行新增影片分頁；找不到仍可閱讀並提供恢復動作。標準／自訂內容均有「在 Web 中開啟」的 Extension 閱讀分頁。字幕自動擷取優先，失敗可重試、貼上、匯入。通知在點擊事件中立即嘗試開啟 Side Panel，失敗才開 Web 閱讀。                                                      |
| 20–21              | 成本金額不可靠時明示未知，可展開限制；不把訂閱視為 API 額度。實際模型、成功請求用量／估算與重試記錄可在詳情查看。快速建立使用最近已入列任務的設定；影片自己的草稿優先，仍重新檢查字幕、範圍、模型與重複資料。                                                                                                             |

## 重試與 Host 邊界

- 自動重試只處理明確被拒絕、沒有輸出且沒有已使用用量的暫時性 429／5xx 或可辨識的連線建立失敗。最多 **額外兩次**，指數退避加 jitter，遵守訊息中可取得的 `Retry-After`；很長的 cooldown 留給手動恢復。
- 授權、額度、輸入／context 錯誤、已有輸出或用量、timeout／stream 中斷等結果未知情況不自動重送。Provider 未提供結構化重試資料時採保守策略；不能因此保證零成本。
- 關閉 Side Panel 不取消 worker-owned Native 連線上的任務。關閉 Chrome、Native pipe 關閉或 Host 崩潰可能暫停；queued／running snapshot 保留，重新開啟後從 Activity 手動恢復。**未新增獨立 daemon 或 Runner。**
- Extension 與 Host 需一起更新至 **Native Messaging protocol 6**。V5 lesson、schema 3 checkpoint 與 custom-v1 格式保留；本輪只增加向後可讀的選用重試／佇列欄位，沒有改寫舊 checkpoint。

## 本輪驗證

- `pnpm test`：**404 個主測試 + 7 個 Host／打包測試 + 5 個套件管理測試 = 416/416** 通過。涵蓋佇列持久化與標準／自訂共用執行、重複續跑不污染已排隊工作、取消、失敗後繼續、chunk 傳送不被新任務打斷、SDK 安全重試、草稿、原始字幕、通知 fallback、失效選項與既有資料。
- `pnpm typecheck`、`pnpm format:check`、`pnpm build` 通過；保留既有 bundle size 警告。
- `node apps/local-host/scripts/smoke-host.mjs` 對實際 production Host bundle 傳送 Native Messaging frames，使用隔離資料驗證 protocol 6、Pi catalog、V5/custom-v1 讀取、重複確認與文件操作。
- `pnpm --filter @immersive/extension test:redesign-ui`：320／360／480px × Light／Dark，**6 組**通過。驗證手動開啟完成內容、生成新版本、閱讀不被替換、安全 Markdown、改名、匯出、Prompt 重用、刪除與四分類設定。
- `pnpm --filter @immersive/extension test:ux-layout-ui`：320／417／640／900px × Light／Dark（高度 560px），另加 320／900px × Light／Dark（高度 320px、reduced-motion），**12 組**通過。覆蓋 Footer 和獨立捲動區邊界、字幕編輯與重取衝突、範本 CRUD、重載草稿、Sheet 寬度、焦點與無橫向溢出。

UI 使用實際 App 與 background controller，但影片、Host 回應與通知 API 是 fixture。Host／模型測試使用隔離資料與假 credentials。上述結果不等於已安裝 Side Panel、真實 Pi／Google 帳號、YouTube／Netflix 播放、Drive OAuth／上傳還原或 macOS 通知橫幅驗收。本輪沒有安裝／重載使用者的 Host、push 或發布。

瀏覽器證據目錄（本機暫存，非可攜 artifact）：

- `/var/folders/9p/y1z7d0wd4033k52mhtfk2trc0000gn/T/immersive-redesign-ui-GvvUj8`
- `/var/folders/9p/y1z7d0wd4033k52mhtfk2trc0000gn/T/cll-ux-layout-AUE4Zl`
