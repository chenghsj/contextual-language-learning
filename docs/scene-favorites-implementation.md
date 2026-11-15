# 情境收藏實作與驗證

2026-10-21 完成整合與驗證。工作分支 `codex/core-redesign`，原工作目錄 HEAD `ece1cde`。實作在包含原有未提交工作的隔離副本完成，再只匯回收藏差異。

## 使用方式

在教材 Reader 的目前情境旁按收藏。進入教材庫的收藏分頁，可搜尋、篩選、開啟或取消收藏。收藏頁提供單一「Google Drive 同步」開關，首次預選教材備份帳號。開啟時合併本機現有收藏至該帳號並自動同步；關閉後保留同一份離線清單。帳號選擇與手動同步收在設定 popover。

收藏快照不依賴原教材，唯讀顯示原文、翻譯與解析。可朗讀與回看來源，不能在收藏內編輯時間校正。

## 模組責任

- `packages/core/src/favorites-schema-v1.ts` 固定保存格式，不匯入目前生成版本判斷。
- `packages/core/src/favorites.ts` 定義契約、擷取引用閉包、純版本合併及 Reader 輸入轉換。
- `apps/local-host/src/favorites/service.ts` 負責持久操作、集合、分頁、重試、同步設定與匯入。
- `apps/local-host/src/drive/favorites.ts` 負責完整分頁、驗證與預產 ID 上傳，重用既有 OAuth HTTP 基礎。
- `apps/local-host/src/host/favorites.ts` 處理 Native 指令與分塊回應。Host protocol 提升為 15，舊 Host 需要更新。
- Extension 的 favorites store、收藏清單與 Reader 控制僅經 Host 讀寫；顯示偏好與未確認 mutation ID 存於 Chrome local storage。

## 可重跑驗證

```sh
node --import tsx --test packages/core/src/favorites.test.ts apps/local-host/src/storage/favorites.test.ts apps/local-host/src/drive/favorites.test.ts
node --import tsx apps/local-host/scripts/favorites-host-smoke.mjs
node apps/extension/scripts/favorites-acceptance.mjs
pnpm typecheck
pnpm build
```

Host smoke 需先建置，使用臨時 HOME 與合成教材，不改既有 Host 註冊。

Live Drive smoke 需要明確選定已連線帳號與 Google OAuth 建置環境。它使用獨立命名空間、兩個臨時資料根目錄與合成情境，不讀取私人教材，驗證後把自建測試檔移到資源回收筒。

```sh
node --env-file=.env --import tsx apps/local-host/scripts/favorites-drive-smoke.ts <已選定的測試帳號 email>
```

## 已確認的驗證

- 本機測試涵蓋程序重啟、兩個真實 Node 程序寫入、重複 mutation、同狀態重試、來源刪除、壞檔、分頁失效與可恢復匯入。
- Drive adapter 測試涵蓋超過 500 筆、完整分頁、未知格式、不完整查詢、409 衝突核對、20 MiB 下載限制及大檔 resumable upload。
- 正式建置 Host 經實際 Native framing 完成寫入、重啟、原教材移除後讀取、取消與舊請求重試。
- 使用明確指定的 Google 帳號完成兩根目錄真實新增、讀回、離線衝突、明確重新收藏與重啟同步。最後取消並將五個合成操作檔移到資源回收筒。
- 瀏覽器驗收涵蓋真實 App 與 controller、合成 Host，320／480px 及明暗主題均通過。未測試已安裝的 Chrome 擴充功能。

## 審查修正與限制

獨立後端審查發現並修正同步開關同毫秒排序、競爭寫入的目錄 fsync，以及缺少 MD5 時跳過內容驗證。回歸測試涵蓋可執行的設定順序與內容驗證情境。

在變更前，既有 `reader-layout-acceptance.mjs:201` 已因 `border 0px` 與 `1px` 的斷言失敗。本次不修改其斷言或相關版面。

目前證據不等於既有 Chrome 安裝版已更新，也不涵蓋 Windows 真機。沒有發布版本或改動使用者既有 Native Host 註冊。

## 最後整合驗證，2026-10-21

完整 repository 測試共 855 項通過，包含 826 項 TypeScript 行為測試、23 項 Host／安裝檢查、5 項套件管理檢查及 1 項 Vite 設定檢查。原有 OAuth 測試需要本機 callback server，已在允許監聽本機連接埠的環境完成。Core、Native Host 與 Extension 的型別檢查全部通過。

Native Host 與 Extension 已建置。正式 Host 的實際 Native framing 驗證使用協定 14，涵蓋寫入、重啟、原教材移除後讀取與取消後舊請求重送。收藏協定與同時進行的語音下載協定已合併，原有語音下載 request／response 保留。

整合後再次使用選定的 Google 帳號完成兩個隔離資料根目錄的真實 Drive 同步。只使用合成情境，驗證離線新增／取消衝突、明確重新加入與重啟。五個測試操作檔已移至 Drive 資源回收筒。

最後審查另發現同步中的新修改可能只回覆 pending。已以可控制的上傳阻塞重現，修正前兩個請求都回覆 pending；修正後會合併重疊的同步要求，接續執行一輪並讓兩個請求等待完成。第二個資料根目錄可直接取得最後取消狀態。此處只因新要求接續同步，沒有閒置輪詢。

暫存工作副本遭系統清理後，已從原始執行紀錄還原全部收藏修改，再與現有工作目錄整合。還原及驗證證據保存在本機 `.audit/scene-favorites/`；功能檔案另有持久壓縮備份。這些本機紀錄未提交。

目前沒有更新使用者已安裝的 Native Host 或 Chrome 擴充功能，亦未 commit、push 或發布。Windows 真機與使用者既有 Chrome 安裝版仍未驗收。

## 單一同步開關

收藏頁不再要求先選擇本機／帳號集合。主要操作為「Google Drive 同步」開關，狀態顯示僅存本機、同步中、已同步或等待同步。首次使用時帶入教材備份已選帳號；已使用過的收藏同步帳號繼續沿用，避免備份偏好變更時默默切換收藏帳號。

關閉同步後仍使用目前帳號的本機副本，不切回另一份本機集合。重新啟用相同帳號也不清空清單。首次啟用失敗保留原本本機內容，重試沿用同一個 configuration mutation ID。

帳號設定位於 popover；同步開啟時不能更換帳號。關閉後可選擇其他帳號，單純選擇不會切換清單或啟用上傳。必須再次開啟同步，才啟用所選帳號。不同帳號仍維持既有資料隔離；本次沒有把 A 帳號的收藏自動複製到 B。

此次確認 23 項 store、Native client 與本機持久化測試通過。真實 App 搭配合成 Native Host 的瀏覽器驗收涵蓋 320／480／548px 明暗主題、預選第二個備份帳號、失敗重試、首次匯入、手動同步、關閉後保留清單，以及取消後重新啟用不復活。Extension 型別檢查通過。此次不操作使用者真實收藏，也沒有替使用者開啟實際帳號的同步。

## 自訂教材收藏，2026-10-21

自訂 Markdown Reader 的標題列新增與情境 Reader 相同大小的收藏按鈕。收藏單位是整份教材，清單與既有情境收藏共用；卡片標示「自訂內容」，沒有宣告學習語言的教材歸入「未指定語言」。取消收藏沿用簡短、錨定按鈕的確認 popover。

自訂收藏使用 `snapshotVersion: 2, kind: custom`，保存完整 Markdown、標題、建立時間、來源與字幕。它不保存生成 Prompt、執行憑證或模型設定，也不建立假的情境資料。既有 snapshotVersion 1 情境格式與操作紀錄格式 1 保留。為沿用既有操作鍵與 Native 指令，整份自訂教材的識別槽固定為 `documentId === sceneId`；這僅是儲存鍵，不代表情境。

開啟自訂收藏直接讀取不可變快照，不再載入原教材。原教材改名、刪除、後續生成版本改變，都不影響已收藏的內容。收藏 Reader 保留安全 Markdown、朗讀／發音標註與 Markdown 匯出，隱藏改名、本機刪除、重生等修改原教材的操作。取消收藏仍只修改收藏狀態。

Host 透過既有 custom repository 擷取自訂內容，沿用同一個 immutable operation journal、帳號隔離、首次匯入與 Drive 同步機制；Native 協定升為 15。舊 Host 與擴充功能需要更新到此建置，既有收藏不需要搬移。

驗證：69 項相關自動測試通過，涵蓋既有情境收藏、自訂完整內容、超過摘要長度的全文搜尋、語言篩選、跨裝置同步、取消／重新收藏、來源刪除、重啟與大型 UTF-8 分塊。Drive HTTP adapter 使用合成回應驗證完整 Markdown 的上傳與校驗讀回；同步狀態測試使用兩個本機資料根目錄與記憶體 Drive，沒有操作真實 Google 帳號。

正式建置 Host 經真實 Native framing 驗證自訂教材寫入、程序重啟、來源移除後讀回與舊請求不復活。真實 App 配合合成 Host 的瀏覽器驗收，在 320／480／548px 與明暗主題確認自訂收藏與既有情境收藏；自訂收藏包含來源刪除後開啟、唯讀選單、同步匯入、篩選與取消確認。Core、Host、Extension 型別檢查通過，Host 與 Extension 均已建置；尚未更新使用者已安裝的 Host 或擴充功能。

```sh
node --import tsx --test packages/core/src/favorites.test.ts packages/core/src/native-messaging.test.ts packages/core/src/learning-points.test.ts apps/local-host/src/storage/favorites.test.ts apps/local-host/src/drive/favorites.test.ts apps/local-host/src/custom-host.test.ts apps/extension/src/native/favorite-client.test.ts apps/extension/src/lib/favorites-store.test.ts apps/extension/src/i18n/custom-content.test.tsx apps/extension/src/i18n/custom-prompt-ui.test.tsx
node apps/extension/scripts/custom-favorites-acceptance.mjs
```

本次本機證據與修改前副本位於 `.audit/custom-favorites/`，未提交或發布。
