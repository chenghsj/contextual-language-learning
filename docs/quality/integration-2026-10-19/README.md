# 2026-10-19 生成與 Reader 整合驗證

**基於 Reader 修正 `e0053b2cb580d2ae6c2cc93d35e683f3f681ac3d`，加入 prompts-17／program-validation-2，在獨立來源快照完成整合檢查。** 只納入本次生成修正與品質紀錄，其他既有工作目錄變更未加入快照或 commit。

| 檢查                                                     | 結果                           |
| -------------------------------------------------------- | ------------------------------ |
| 核心、生成、任務、儲存、Drive、Reader 與時間通知定向測試 | 230 通過，0 失敗               |
| 獨立快照全專案格式檢查                                   | 通過                           |
| 三個 workspace 型別檢查                                  | 通過                           |
| 品質工具與歷史證據核對工具型別檢查                       | 通過                           |
| Extension／Native Host 正式建置                          | 通過；保留既有大型 bundle 提醒 |
| Extension 產物與 Host stdio smoke                        | 通過                           |
| Reader 群組、斷句、收合、樣式預覽                        | 8 組通過                       |
| 選字 popup 開啟時點擊、真正拖曳選字、開合後清除選字      | 4 組通過                       |
| 28 組固定請求準備、14 種語言                             | 通過，模型呼叫 0 次            |
| 四輪原始品質證據雜湊                                     | 相符，沒有重寫原始模型輸出     |

型別檢查、建置與測試使用同一份快照，workspace core 依賴也指向該快照。來源版本及各修改檔案雜湊見 [source-manifest.json](./source-manifest.json)，機器可讀結果見 [verification.json](./verification.json)。

## 本輪驗收範圍

Reader 預覽使用隔離的 headless Chrome、合成來源與模擬播放，涵蓋 320／480px、亮／暗色及跨字幕分組。沒有操作使用者既有 Chrome 分頁、載入已安裝擴充功能或播放真實影片。截圖及八組群組預覽結果見 [reader-previews](./reader-previews/acceptance.json)，另外四組選字互動結果記錄於 [預覽執行紀錄](./logs/reader-preview.log)。

本輪沒有新的模型推論。原 prompts-17 四組的 AI 語意審查 4／4 保留為歷史結果；Reader commit 修改了共用的 `learning-points.ts`，目前程式與當輪雜湊不同，因此不能將這次程式／Reader 整合檢查寫成新一輪模型品質通過。各輪歷史核對結果見 [historical-verification.json](./logs/historical-verification.json)。

原始 `conditions.json`、`requests.json`、`report.json`、`run-context.json`、任務及生成教材均按原位元組保存，格式化工具只略過這些原始證據；衍生報告、審查、核對工具與程式碼仍納入格式檢查。

## 執行指令

在對應來源與已安裝依賴下：

```sh
pnpm typecheck
pnpm build
node --import tsx --test --test-concurrency=1 packages/core/src/*.test.ts apps/local-host/src/generation/*.test.ts apps/local-host/src/jobs/*.test.ts apps/local-host/src/storage/*.test.ts apps/local-host/src/drive/learning-points-drive.test.ts apps/extension/src/i18n/sentence-analysis-ui.test.tsx apps/extension/src/i18n/contextual-reader.test.ts apps/extension/src/i18n/pi-feedback.test.ts apps/extension/src/i18n/pi-feedback-ui.test.tsx
node apps/extension/scripts/reader-standardization-acceptance.mjs
node apps/extension/scripts/reader-selection-interaction-acceptance.mjs
node apps/local-host/scripts/smoke-host.mjs
node apps/extension/scripts/check-build.mjs
node --import tsx apps/local-host/scripts/learning-points-quality.ts --prepare-only --output=/tmp/cll-quality-new-empty-output
```

對應執行紀錄保存在 [logs](./logs/regression.log)。準備模式輸出目錄必須是新的或空的；上述指令不會執行新一輪推論。歷史模型證據使用各輪 `verify.mts --historical` 核對。

本次沒有推送、發布或更新已安裝 Host。真實 Chrome／影片驗收依先前安排保留待做，28 組模型矩陣也尚未執行。
