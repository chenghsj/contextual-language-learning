# 本機提交切分與驗證

2026-10-17，`codex/core-redesign`；整理前 HEAD 為 `21969bc`。

## 提交範圍

1. `18681ad`：按需載入前的既有功能基準，共 412 個路徑。包含 App 已整合的 V7 教材／Reader、Create 流程、語音、Drive、Host 契約，以及對應測試、fixture、套件與建置依賴。這些功能在整理前已共存於未提交的原始碼中，沒有重新實作。三個整合檔 `App.tsx`、`custom-viewer.tsx`、Extension `package.json` 使用此輪按需載入前保留的精確版本。
2. 後續的 `perf(extension): defer secondary views with recoverable loading`：六個次要畫面按需載入、局部讀取／錯誤提示、Markdown 匯出拆分、量測及五組驗收腳本、效能樣本與本輪整理文件。Library、標準 Reader 及生成 session 的生命週期保留。

基準不是單一功能的小提交：套件命名、共用 schema 與 App／Host 實作已彼此依賴，僅加入新增 UI 模組無法形成可建置版本。基準檔案清單、四個混合檔案的部分納入規則與格式修正清單記錄於 [commit-scope.json](./quality/load-performance/commit-scope.json)。

`README.md`、CI／release workflow 與 `scripts/package-release.mjs` 只納入必要的品牌／名稱更新；其餘工作目錄差異保留。研究與架構文件、歷史品質產物、其他介面驗收腳本，以及未被選入的發佈工作均未整批納入提交。原始碼中的 28 個已選入依賴檔案另外經過 Prettier AST 檢查及格式修正。

## 獨立驗證方式

從原 HEAD 匯出到暫存目錄，僅覆蓋基準清單及必要的部分檔案；不複製 `.env`、使用者資料或已建置產物。使用本機 Node 22.20.0、專案指定 pnpm 9.15.4 與現有第三方套件；所有 `@contextual/core` workspace link 指向暫存目錄自己的原始碼。因此這是獨立原始碼快照驗證，並非重新下載依賴的乾淨安裝測試。

基準版通過：

- `pnpm format:check`、`pnpm typecheck`。
- 完整 `pnpm test`：770 個原始碼測試、23 個平台／bundle／entrypoint／setup 測試、5 個套件管理器測試，共 798 項；沒有失敗、跳過或取消。
- `pnpm build`：Extension、Native Host、macOS 系統朗讀與 Siri helper。
- `check-build.mjs` 的正式 Extension 產物檢查，以及隔離 HOME／資料目錄的 Host stdio smoke。

增量版使用另一份基準來源快照，加上本輪檔案，通過型別檢查、44 個 Create／GenerationSession／GenerationController 回歸、Extension 正式建置／產物檢查，以及五組正式模式瀏覽器驗收。瀏覽器使用獨立 headless Chrome 與模擬 Host，涵蓋按需請求、狀態保持、返回焦點、失敗恢復及模組等待期間任務完成。

pnpm patch 的上下文空白，以及第三方 Siri 原始碼／授權檔的原始尾端空行保持原樣；其餘選入變更通過 `git diff --check`。提交使用獨立索引，並將每個提交 tree 與測試用快照核對。

## 驗證邊界

真實 Chrome 的生成／取消／續跑、正式安裝、跨平台執行、CI 遠端工作與公開發佈仍未在本次執行。提交整理也沒有操作現有 Chrome 或推送遠端。
