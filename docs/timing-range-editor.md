# 時間範圍編輯器

閱讀器的「調整時間」與字幕的「修改字幕」共用時間軸、播放位置與起訖欄位。

- 拖曳兩端粗調起訖點，抓取點會跟著游標的相對位移移動；放開後維持時間軸刻度與影片位置。
- 同一次編輯不自動縮放或重新置中。需要重看修改後的區間時，按「顯示範圍」；輸入的時間超出目前時間軸時，也會顯示此提示。
- 點時間軸定位；目前位置旁可播放／暫停與前後移動 1 秒。
- 欄位可輸入時間；加減鍵或上下鍵每次調整 0.1 秒，Shift + 上下鍵調整 1 秒。時間軸把手也支援方向鍵。
- 「設為開頭／結尾」與字幕的「設為影片目前位置」會先暫停，再讀取影片位置。
- 拖曳不允許起訖交叉。閱讀器保留 0.25 秒至 10 分鐘的範圍限制，字幕保留其原有有效時間規則。
- 顯示時間取至小數一位；僅聚焦、格式化或鍵盤微調不會抹掉來源的毫秒精度。拖曳以原時間為基準，每次移動 0.1 秒。
- 試聽與確認固定在底部，中段內容可捲動。閱讀器進入編輯時隱藏原導覽，關閉時回復閱讀捲動位置與播放選項焦點。字幕視窗開啟時聚焦文字欄位。
- 取消保留儲存前的內容，關閉會停止本編輯器啟動的播放。重設沿用各編輯器的來源時間規則。

## 驗證

```sh
node apps/extension/scripts/timing-range-layout-acceptance.mjs
node apps/extension/scripts/subtitle-editor-acceptance.mjs
node --import tsx --test apps/extension/src/i18n/reader-playback-ui.test.tsx apps/extension/src/lib/subtitle-draft.test.ts apps/extension/src/video/loop-window.test.ts apps/extension/src/lib/time-display.test.ts
node --import tsx --test apps/extension/src/i18n/timing-range-ui.test.tsx
```

新驗收涵蓋真實元件的滑鼠拖曳、範圍邊界、精確輸入、鍵盤微調、儲存重開、無效輸入與底部操作可達性。截圖包含 320、390、555、900px 寬度、390×320 短視窗、深色、英文閱讀器與日文 200% 字級。瀏覽器使用獨立的影片／Host 模擬資料，不代表真實 YouTube／Netflix 或已安裝擴充功能的音訊驗收。

跳動回歸測試會檢查鬆手前後的刻度與另一端把手位置、從把手邊緣抓取但未移動、調整時不自動跳轉影片，以及輸入超出時間軸後僅由明確操作重新置中。
