# 前端按需載入與量測

2026-10-17，`codex/core-redesign`，HEAD `21969bc` 及既有未提交內容。基準是此輪修改開始時的工作目錄，並非乾淨的 HEAD。

## 實作

- 自訂 Markdown（含 parser／sanitize）、字幕編輯、語音設定／資源管理、AI 連線及 Drive 備份設定在開啟時才載入；成功載入的模組在同一 App 執行期間共用。
- `deferView` 以穩定的外部 snapshot 訂閱載入結果，模組完成後立即顯示；`DeferredView` 提供五種語言的讀取／錯誤提示。字幕預覽及自訂 Reader 載入期間仍可返回。失敗時保留其他導覽並提供明確的重新載入操作，不自動重新整理或重試生成。
- `exportMarkdown` 移到小型共用檔案，避免活動頁的匯出動作把完整 Markdown viewer 拉回初始 bundle；原 viewer 的 export 保留相容性。
- 內容庫、標準 Reader 及 `SystemSpeechProvider` 維持同步載入。試驗曾將內容庫與 Reader 也拆開，但首次導航增加約 169／104 ms，因此沒有保留。內容庫既有的搜尋／篩選狀態與 App 擁有的草稿、生成 session 生命週期維持原樣。

## 量測方式與結果

使用正式 Vite 建置的 `sidepanel.html`、CSS 與 JavaScript，透過 localhost 提供資源。僅注入既有 acceptance fixture 的 browser／Host adapter，沒有載入 fixture 的 React App 或樣式。測試採獨立 headless Chrome 155.0.8059.41、400 × 800 viewport、4 倍 CPU 降速、減少動畫；每版五次、每次新 browser context，依序開啟 Create → Library → Reader → Settings → General。兩版保留的產物依序量測，期間沒有並行執行建置或測試。

首次就緒條件為字幕 ready；切頁為目標內容可見，再等待兩個 animation frame。一般設定需等系統朗讀區塊可見，避免只測到先出現的外觀選單。執行時間來自 CDP `Performance`，包含相同模擬 adapter 的開銷。

| 項目                             |    修改前中位數 |                  修改後中位數 |
| -------------------------------- | --------------: | ----------------------------: |
| 初始 JS 解壓後資源大小           | 1,305,153 bytes | 1,122,442 bytes（減少 14.0%） |
| Create 首次就緒                  |        520.7 ms |                      507.9 ms |
| 首次內容繪製 FCP                 |          348 ms |                        336 ms |
| Create 就緒前累計 ScriptDuration |        283.4 ms |                      272.4 ms |
| Library 切換                     |         47.4 ms |                       46.6 ms |
| Reader 開啟                      |         90.2 ms |                       90.1 ms |
| Settings 首頁                    |         60.3 ms |                       51.1 ms |
| General 首次開啟（含語音設定）   |         58.6 ms |                       76.1 ms |

確定的改善是初始 JS 減少約 183 KB。時間差只有約十餘毫秒，五次本機樣本不足以證明使用者可感受到的速度改善。主要閱讀路徑在此量測中相近；一般設定首次開啟增加約 18 ms，是延後載入的代價。這些結果不代表實際 Native Messaging、安裝後擴充功能啟動、真實影片或模型生成效能，也沒有測 INP、記憶體或網路限速。

原始樣本、資源列表及正式產物模組組成：[修改前](./quality/load-performance/before.json)、[修改後](./quality/load-performance/after.json)。模組的 `renderedLength` 是 Rollup 縮小前的歸屬資訊，不可當成各模組最終壓縮體積。

## 驗證與重跑

`pnpm typecheck`、完整 `pnpm test`（798／798，無排除／取消／跳過）、Extension 正式建置及 `check-build.mjs` 通過。主 JS 仍超過 Vite 的 500 KB 提示門檻；本次沒有單純為消除提示而把共用 runtime 切成更多檔案。

正式產物的 browser acceptance 驗證模組不在首次開啟時請求、首次使用才載入、內容庫篩選保持、一般／AI／備份設定、自訂 Markdown 安全顯示／匯出，以及延遲／失敗的字幕編輯模組仍可返回並透過重新載入恢復。全部使用獨立瀏覽器與模擬 Host，不會操作既有 Chrome、呼叫真實模型或備份使用者資料。

從儲存庫根目錄重跑：

```sh
pnpm --filter @contextual/extension benchmark:load /tmp/cll-load-report.json
pnpm --filter @contextual/extension test:deferred-ui /tmp/cll-load-report.json
```

量測指令在暫存目錄建立產物；新 report 的 `artifactsDir` 供 acceptance 使用，並輸出路徑。文件中的歸檔樣本只保留證據，重跑時應產生新的 report。真實 Chrome 生成／取消／續跑與 release 安裝驗收依使用者安排留待稍後。
