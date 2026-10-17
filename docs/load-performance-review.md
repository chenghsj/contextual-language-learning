# 按需載入差異審查與提交範圍

2026-10-17，工作目錄 `/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`，HEAD `21969bc`。

## 審查結論

以本輪修改前保留的工作目錄快照為基準，分別進行 Standards 與 Spec 審查。沒有把整個 dirty tree 當成本輪變更。

- Standards：1 項已修正。`DeferredView` 的主要失敗說明改用 `text-foreground`，符合 `DESIGN.md` 的錯誤訊息規範；讀取提示維持輔助文字色。
- Spec：0 項確認問題。App 持有的草稿與生成 session、Library／標準 Reader 的掛載邊界維持原狀；動態模組載入不會啟動或重試生成。
- 抽出的 `backToLibrary` 保留既有切頁與下一個 animation frame 恢復焦點的行為。Markdown 匯出函式僅搬移位置。

## 本輪檔案

既有檔案的增量以 `/tmp/cll-load-source-before/` 為基準：

- `apps/extension/src/App.tsx`
- `apps/extension/src/components/custom-viewer.tsx`
- `apps/extension/package.json`

本輪新增檔案：

- `apps/extension/src/components/deferred-view.tsx`
- `apps/extension/src/lib/export-markdown.ts`
- `apps/extension/scripts/benchmark-load.mjs`
- `apps/extension/scripts/deferred-views-acceptance.mjs`
- `docs/load-performance.md`
- `docs/load-performance-review.md`
- `docs/quality/load-performance/before.json`
- `docs/quality/load-performance/after.json`

`docs/architecture.md` 與 `docs/architecture-refactor.md` 亦有相關說明，但同時包含前幾輪架構工作，不納入本次獨立差異包。

## 驗證

本次審查後執行型別檢查、44 個 Create／GenerationSession／GenerationController 回歸測試、Extension 正式建置及 `check-build.mjs`。

正式模式產物的獨立瀏覽器驗收共五組：

1. 功能模組首次使用才載入；內容庫搜尋保持；一般／AI／備份設定可開啟。
2. 自訂 Markdown 安全顯示、匯出、返回焦點、無 tooltip，以及 Create prompt 保留且僅提交一次。
3. 字幕模組延遲期間可返回；稍後重新開啟可成功載入。
4. 模組失敗被限制在局部畫面；導覽仍可用；使用者點擊重新載入可恢復。
5. 字幕模組等待期間生成任務正常完成；返回並重新開啟後，提交仍只有一次，沒有取消請求，也沒有被晚到的模組切換到 Reader。

本次只改動錯誤文字的顏色，初始 JS 比原量測增加 20 bytes；一次建置／量測確認為 1,122,462 bytes。五次比較的原始樣本仍保留在效能文件，沒有用單次樣本替換。原始審查後完整測試為 798／798；後續提交整理又在獨立基準快照重跑同樣的 798 項，全數通過。

所有瀏覽器驗收均使用獨立 headless Chrome 與模擬 Host；真實 Chrome 的生成／取消／續跑及正式安裝驗收仍依使用者安排延後。

## 提交依賴與差異包

無法直接把上述檔案選入暫存區後當成獨立提交：`App.tsx` 對 HEAD 的差異包含數千行既有工作，且本輪依賴的 `speech-settings.tsx`、`drive-backup-settings.tsx`、`use-create-flow.ts` 等檔案尚不存在於 HEAD。只提交本輪新檔會缺少整合點，整檔提交則會混入前面的功能工作。

後續已依使用者授權整理為兩個本機提交：先保存可獨立建置的功能基準，再套用已審查的按需載入增量。基準提交為 `18681ad`；完整範圍與驗證方式見 [commit-split.md](./commit-split.md) 及 [commit-scope.json](./quality/load-performance/commit-scope.json)。其餘未完成修改保留在工作目錄。

原始可攜差異包仍位於 `/tmp/cll-load-review-20261017.zip`。它保留提交整理前的十一個檔案快照、增量 patch、SHA-256 與重放證據，作為歷史審查紀錄；不包含後來新增的提交整理文件，也不應直接套到目前 HEAD。
