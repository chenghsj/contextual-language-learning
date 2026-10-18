# 品質驗收資料

此目錄保存各功能的驗收紀錄。生成結果必須對應當次 prompt、流程、固定輸入與模型設定；歷史結果不能直接作為修改後流程的通過依據。

## 舊 V7 結果已歸檔

2026-10-18 已將舊 V7 的 514 個結果檔案，以及一次性工具、文件與相關來源快照，歸檔至儲存庫外：

`../immersive-language-learning-archives/quality-v7-2026-10-18.zip`（相對於儲存庫根目錄）

位置、ZIP SHA-256 與歸檔範圍見 [legacy-v7-archive.json](./legacy-v7-archive.json)。ZIP 內的 `ARCHIVE_MANIFEST.json` 保留各檔案路徑、大小與 SHA-256；所有檔案經核對後才從工作目錄移走。舊驗收清單跨多個 matrix 輪次引用，故保留完整歷史資料。

原始 N3／N1 生成、發布、字幕回歸及提示體積量測腳本已隨資料封存；舊傳輸診斷 helper 的唯一使用者也是這批腳本，因此一併移除。`reader-preview.html` 現在只使用合成資料。舊 `?episode=N3`／`N1` 書籤會顯示封存提示，不再讀取歷史教材。產品資料庫中的教材與任務不在本次搬移範圍內。

## 新流程沿用固定輸入

保留以下工具：

- [quality-v7-cases.ts](../../apps/local-host/scripts/quality-v7-cases.ts)：14 種語言／地區、28 組合成對話。V7 指教材 schema，並不表示沿用舊 prompt 的品質結論。
- [learning-points-quality.ts](../../apps/local-host/scripts/learning-points-quality.ts)：以目前的生成流程執行固定輸入，每次使用全新或空的輸出目錄。
- [check-v7-case-coverage.ts](../../apps/local-host/scripts/check-v7-case-coverage.ts)：離線檢查新結果的結構、來源與指定情境覆蓋；不判定語意品質。

先在儲存庫根目錄準備新一輪請求，不呼叫模型：

```sh
node --import tsx apps/local-host/scripts/learning-points-quality.ts \
  --prepare-only --output=/tmp/cll-quality-current-20261018
```

工具會輸出 `conditions.json` 與 `requests.json`，保存目前 prompt／workflow／程式驗證版本、固定輸入、生成模組、規則、提示詞與傳輸 patch 的雜湊。`--languages=ja,en` 可只準備指定語言。重跑需換一個輸出目錄，避免覆寫或混用歷史條件。

拿掉 `--prepare-only` 並換一個新的輸出目錄，會以工具指定的 Antigravity 模型進行實際推論。生成成功只記為 `generated`，`semanticAcceptance` 仍為待審查；不會自動建立 accepted 清單。新 prompt／流程仍須對照原文檢查翻譯、文法、例句、指涉及程度適切性，記錄審查者與警告；有條件時再由教師／母語者抽查。

## 本次整理驗證

- ZIP CRC 與全部 524 個來源檔案的 SHA-256 相符；固定 28 組輸入與歸檔前逐位元組一致。
- 準備模式輸出 28 組合法請求及 14 種語言，版本／流程雜湊已記錄；既有結果目錄及無匹配案例的輸入會被拒絕。
- 專案與保留品質工具的型別檢查、Extension 正式建置及產物檢查通過。
- 20 個教材／Reader 定向測試與 6 組獨立瀏覽器預覽驗收通過，包括 N3／N1 舊書籤、跨字幕及繁簡中文；沒有請求舊驗收資料。

本次整理僅確認歸檔完整性、工具準備模式及開發預覽，不代表新流程已完成真實模型品質驗收。
