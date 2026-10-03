# 五階段實作與驗證紀錄

日期：2026-10-03。起點為乾淨的 `main @ 4440cbd`，在原 checkout 建立 `codex/core-redesign`。每階段各一個 commit；未 push、發布或變更真實帳號資料。

## 階段交付

| 階段 | Commit                                                                 | 交付與檢查                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `79da99a` `refactor(extension): unify app shell and settings layout`   | 固定 Header／主導覽、主要滾動區、共用返回標題；相關回歸 30/30、typecheck、build、修改範圍格式檢查通過。                                                                                  |
| 2    | `c99534c` `feat(settings): complete provider backup and host settings` | 四分類設定、寫入失敗回復、Provider 同頁管理、AI 摘要、Drive 目錄與備份狀態、Host 說明；相關回歸 169/169、typecheck、build、修改範圍格式檢查通過。                                        |
| 3    | `40440af` `feat(generation): add subtitle analysis range selection`    | 完整／前半／後半／自訂、精確時間、Slider、目前位置、字幕跳轉與 50 筆分頁；相關回歸 280/280、typecheck、build、修改範圍格式檢查通過。                                                     |
| 4    | `785a8de` `feat(host): add resumable custom markdown generation`       | 獨立 custom-v1 Repository、JSON／Markdown Session 隔離、版本與模型固定、長內容分段與多層整合、checkpoint／取消／續跑／儲存重試；相關回歸 83/83、typecheck、build、修改範圍格式檢查通過。 |
| 5    | 本次 `feat(extension): integrate custom content library and recovery`  | 五步建立、自訂 Viewer／內容庫、Prompt 操作、Drive 備份與還原、Activity／通知、受控重連；以下完整驗證通過後提交。                                                                         |

## 操作入口

- **建立內容**：影片與字幕 → 分析範圍 → 標準教材／自訂 Markdown → 學習設定或可編輯 Prompt → 確認 AI 並建立。自訂模式不顯示程度、場景數與例句數。
- **內容庫**：以全部／標準／自訂類型篩選，配合搜尋與語言篩選。自訂內容使用「未指定語言」，不捏造程度、場景或學習進度。Drive-only 文件先還原再開啟。
- **自訂 Viewer**：查看／重用 Prompt、重新生成新版本、改名、匯出 Markdown、本機刪除。重新生成使用保存的來源、Prompt、範圍與實際模型；舊版本保留。
- **Activity**：查看任務、checkpoint 續跑、儲存／備份重試、執行版本／模型／用量。儲存失敗時可在執行詳情匯出最終 Markdown。清除紀錄不刪文件。
- **設定**：一般、AI 與模型、教材與備份、本機服務。Drive 資料夾連結來自 Host 查詢，不為顯示連結而建立資料夾。
- Extension 與 Host 必須一起更新至目前 build（Native Messaging protocol **5**）。目前已產生 production build；已安裝環境的重載／安裝不等於本次自動發布。

## 最終驗證

- `pnpm test`：385 個主回歸測試、7 個 Host／打包測試、5 個套件管理測試，合計 **397/397** 通過。
- `pnpm typecheck`、`pnpm format:check`、`pnpm build` 通過。Build 保留既有的大 bundle 警告，沒有編譯失敗。
- `node apps/local-host/scripts/smoke-host.mjs`：對實際 production Host 傳送 Native Messaging frames，驗證 protocol 5、Pi provider catalog、V5 讀取與重複確認、custom-v1 讀取／改名／刪除及舊資料隔離。使用隔離測試資料；未使用真實 Pi credentials。
- `pnpm --filter @immersive/extension test:redesign-ui`：獨立 Chrome profile、實際 App 與 worker，320／360／480px × Light／Dark 共六組通過。覆蓋範圍邊界、目前位置、原 cue 時間、50 筆分頁、鍵盤選項、Portal／Escape／焦點回復、生成／新版本、改名、匯出、Prompt 重用、Activity、本機刪除及四分類設定。
- UI 測試的影片橋接、Host 與通知 API 使用開發 fixture；模型與 Drive 測試使用注入的測試介面。這些結果不構成真實影片平台、Pi 帳號、Drive 或 macOS 系統通知驗收。
- Drive 回歸覆蓋 Markdown 先上傳／metadata 最後提交、部分上傳重試去重、checksum／成對檔案驗證、衝突保留、重啟接續備份、上傳中切換帳號的同步處理。
- 重連回歸確認最多 1／2／4 秒三次，只握手及查詢狀態，不重送生成、續跑或其他副作用指令；關閉 Side Panel 不取消進行中的任務。

UI 驗收環境：macOS、Node v22.20.0、Chrome 154.0.8037.93。截圖與 evidence JSON 由驗收腳本寫入獨立暫存目錄。480px 是額外測試尺寸；未把 fixture 宣稱為使用者目前已安裝的 Side Panel 寬度或版本。

## 保留界線與待實機驗證

- V5 與舊 checkpoint 可讀；自訂資料獨立，沒有將舊任務改寫成自訂格式。Canonical custom 資料位於 `~/Documents/Immersive Learning/custom-v1/`。
- Canonical 文件保存後才發布／備份；本機刪除保留 Drive 備份及任務紀錄。已另行匯出或發布到選定資料夾的副本是獨立檔案。
- 未回報的用量標示未知；模型牌價估算不代表訂閱額度或實際帳單。
- 尚待實機驗證：真實 Pi 帳號登入與生成、真實 YouTube／Netflix 字幕與播放、Drive OAuth／多帳號／上傳及還原、系統通知橫幅、已安裝 Side Panel、Windows／Linux 原生資料夾選擇器。
- TTS、本地 AI、正式安裝器、獨立 Runner、Virtual Models、Pi Durable、雙向同步仍屬另案。
