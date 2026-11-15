# 情境收藏與 Google Drive 同步

2026-10-20 已依兩份候選設計及獨立審查收斂實作。本文件取代 2026-10-19 的 parent-operation DAG 草案。驗證指令與結果見 [實作紀錄](scene-favorites-implementation.md)。

## 功能範圍

收藏單位只有完整情境。情境標題旁可加入或取消收藏，教材庫內提供收藏清單、搜尋與語言篩選。收藏快照保留原文、翻譯、解析、例句、發音標記及影片時間。開啟收藏不需原教材或 AI 重新生成。

收藏 Reader 保留播放、朗讀、點選片段與展開解析，時間校正為唯讀。收藏使用獨立閱讀進度識別，不會修改原教材或其進度。

## 資料與操作

- `FavoriteSnapshotV1` 固定保存格式，獨立於目前教材 prompt／execution 版本。
- 收藏主鍵為 `SHA-256(JSON.stringify([documentId, sceneId]))`。同一情境只顯示一筆；重新生成的教材有不同 document ID。
- 快照擷取會閉合 scene、points、reusable items、supporting utterances、source/context/evidence cues、source spans、診斷與播放校正參照。
- Native Host 是權威讀寫入口。Extension 保存集合選擇、短期顯示狀態與未確認請求識別。
- 每個新增／取消請求都保存不可覆寫的 JSON 操作，包含明確目標狀態、mutation ID 與版本向量。同狀態請求也保留身分，避免延遲重送改變後來的取消結果。
- 同一 mutation 的重試不再套用操作或擷取來源；回覆目前合併狀態。
- 本機寫入成功才確認收藏。雲端失敗保留本機內容與待同步工作。

## 本機儲存

預設位置為 `Documents/Contextual Language Learning/user-data/favorites-v1/`，不依賴教材的 `data-v7` 或使用者選擇的發布資料夾。

```text
favorites-v1/
  local/operations/<mutationId>.json
  accounts/<collectionHash>/
    operations/<mutationId>.json
    configurations/<mutationId>.json
    reservations/<mutationId>.json
    acks/<mutationId>.json
```

操作檔先寫入及 fsync 暫存檔，再以 hard link 不覆寫提交。競爭同一 mutation 的程序讀回已提交內容並確認目錄同步，才回覆成功。Windows 不執行不支援的目錄 fsync；保留檔案 fsync 與不覆寫提交。

讀取時掃描檔案清單，僅重新解析新增或變動檔案，以記憶體摘要加速查詢。清單回傳分頁摘要，點開才傳送快照。游標包含資料與篩選版本，過期時要求重新讀取。無法解析的使用者資料保留原檔並回報部分錯誤，不當成空收藏覆寫。

第一版不用 SQLite。日後可替換 repository 或增加索引，但不能直接同步使用中的資料庫檔案，也不能從可重建索引推回收藏紀錄。

## 跨裝置合併

每個 Host 服務實例使用新的 writer UUID，同一情境在實例內依序寫入。新操作合併已知版本向量，再增加自己的計數。

合併時只比較因果上尚未被取代的操作。同時存在新增與取消時，取消優先；同步後明確重新加入會取代已知的取消。不以電腦時間判斷收藏操作先後，不需要 parent 補抓或依序上傳。

同步設定只存在本機，以遞增序號排序；並行同序號的關閉優先。這與收藏內容的跨裝置版本向量分開。

## Google Drive

本機集合預設可用。Google 帳號各有獨立集合及同步開關，連線或教材備份不會自動啟用收藏同步。開啟時明確合併本機收藏至所選帳號，匯入名單與目的 mutation ID 會保存。重試匯入不重複套用已匯入來源，取消過的帳號收藏不因再次開啟同步而復活。

每輪完整分頁列出收藏 metadata、下載未知操作、合併本機、上傳缺少操作，再讀一輪確認。查詢不以教材 prompt 或收藏版本過濾，以便發現未知格式。`incompleteSearch`、未知格式、內容衝突或下載失敗都不能回報同步完成。

雲端檔案存於既有應用資料夾下的 `Favorites/operations`。查詢以應用屬性及集合識別為準，不依賴同名資料夾唯一。每次上傳先保存預產生的 Drive file ID；逾時重試沿用同一 ID，409 須讀回核對內容。缺少可信內容 checksum 時重新下載驗證。大於 5 MB 使用 resumable upload。

同步由開啟頁面、變更收藏、恢復連線與手動操作觸發，不做常駐輪詢。關閉同步仍保留該帳號的本機集合；登出不刪除資料，切換帳號不將 A 的內容傳給 B。影片與音訊不下載或備份。

## 界線與後續

- 單筆操作與快照上限 20 MiB；分塊傳輸每塊 256 KiB。
- 每個情境的版本向量最多 2,048 個 writer 識別。超限明確拒絕，不截斷內容或因果資訊。
- 第一版保留操作與取消歷史，不自動清理。檔案數與初次 metadata 掃描成本會累積。
- 資料夾中手動刪檔不代表取消收藏。請使用功能內的取消操作。
- 真實影片是否可播放仍取決於來源與登入。模擬瀏覽器、正式 Host、真實 Drive、已安裝擴充功能與 Windows 執行是不同驗證範圍。
