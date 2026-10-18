# Reader 整合來源的 prompts-17 四組生成驗收

**在 commit `939c401bbae44bbf8c1df3853dfabbe160ab8d74` 的隔離來源快照重新生成四組固定案例，程式驗證、情境覆蓋及 Codex AI 語意審查均為 4／4，保留一項非阻擋文案警告。** 這是目前整合來源的新結果，沒有沿用或覆寫 [前一輪 prompts-17](../pilot-2026-10-18-prompts17/README.md) 的輸出與判定。

## 設定與結果

Antigravity `gemini-3.8-flash`／`medium`；`learning-points-prompts-17`、`learning-points-v7-1`、`program-validation-2`、protocol 12。英文 B1、日文 N3 各一組一般對話與不確定情境，繁體中文說明，每個可重用項目一組新例句。四份固定請求除任務 ID 外，與歷史試跑相同。

| 案例           |   個案耗時 | 呼叫 | 程式驗證 | 情境覆蓋 | AI 語意審查    |
| -------------- | ---------: | ---: | -------- | -------- | -------------- |
| 英文一般對話   |  47.929 秒 |    3 | 通過     | 通過     | 通過           |
| 英文不確定情境 | 100.100 秒 |    3 | 通過     | 通過     | 通過           |
| 日文一般對話   |  47.580 秒 |    4 | 通過     | 通過     | 通過，1 項警告 |
| 日文不確定情境 | 139.969 秒 |    3 | 通過     | 通過     | 通過           |

每組只進行一次完整生成，沒有整組重跑或 provider fallback。日文一般對話在候選階段使用一次既有結構修復（`window-0-repair`）；其餘呼叫為候選、選擇及教學。該組另省略兩項 `empty_annotation` 可選讀音註記，未增加模型呼叫。最終日文詞語讀音與例句已另行核對，但未驗證實際音訊。

## 內容判定

依 [同一份審查準則](./review-rubric.md)，將完整來源、翻譯、逐句解說、教學重點、可重用形式及新例句逐項對照；JSON 合法與情境覆蓋分開判定。

- [英文一般對話](./review-en-normal.json)：摘要不串接未標明的說話者；保留來電時即將離開的時間關係，未斷言取消離開。新例句角色一致，Sure 保持基本回應。
- [英文不確定情境](./review-en-uncertainty.json)：she 不被認定為 Maya；`[???]` 在受影響欄位標為不明，沒有猜測、更正或新增畫面／書寫。Not yet 保持基本回應，沒有前輪的額外重複教學。
- [日文一般對話](./review-ja-normal.json)：`ところだった` 與 `てくれる？` 的構造、例句及角色一致，うん 不增加填充教學。對「疑問語調」及「親切自然」的泛論仍宜加上情境／可能性條件，保留文案警告，沒有據此認定實際錄音的語調。
- [日文不確定情境](./review-ja-uncertainty.json)：摘要未把ミオ定為主語或引述者；此處不擴寫成螢幕或書寫證據。悪いない 明示不明，教學只引用可靠的 `って何？`，縮約模板 `[動詞て形]た` 沒有重複 て／で。

機器可讀判定見 [acceptance.json](./acceptance.json)，程式／來源／身份／覆蓋核對見 [verification.json](./verification.json)。原始 [report.json](./report.json) 的待語意審查欄位未被改寫；最終審查保存在獨立檔案。

## 來源與離線核對

執行前將隔離快照的全部 Git 追蹤檔案與 `git archive 939c401` 逐位元組核對，workspace core 依賴指向該快照，排除其他 session 的未提交變更。版本、請求及生成模組雜湊見 [conditions.json](./conditions.json)；commit tree、92 個 runtime 來源檔、依賴清單與 core 雜湊見 [run-context.json](./run-context.json)，實際 Node／套件版本見 [runtime-environment.json](./runtime-environment.json)。本輪沒有安裝或呼叫已安裝 Host。

在儲存庫根目錄執行：

```sh
node --import tsx docs/quality/pilot-2026-10-19-prompts17/verify.mts
```

核對工具不呼叫模型；它核對原始檔 SHA-256、來源版本／雜湊、固定請求、四份教材的結構與身份、情境覆蓋、審查引文、接受判定及用量。本輪執行結果為 `sourceDrift: []`、`accepted: 4`。日後來源改變時，預設會拒絕作為目前來源的驗收；加上 `--historical` 才可單獨核對歷史證據。

原始條件、請求、任務、最終教材及執行紀錄按原始位元組保存，清單見 [raw-artifacts.sha256.json](./raw-artifacts.sha256.json)。Runner 沒有保存候選修復前被拒絕的回應或本次修復的具體觸發原因；只能確認有一次修復及其用量，不能回推初次輸出的錯誤內容。

## 用量與範圍

四案耗時合計 **335.578 秒，約 5 分 36 秒**，共 **13 次**模型呼叫，其中一次結構修復。全部呼叫有回報用量：input **48,815**、output **49,608**、reasoning **42,598 tokens**。Reasoning 已包含於 output，不重複相加。服務回報 subscription，沒有金額資料，不換算成本；單輪耗時也不能推估通常延遲。

本輪只驗收這四份新輸出，是 AI 編輯審查，不能推估整體語言正確率、重複生成穩定性、教師／母語者認證或學習效果。先前的 230 個測試、建置與 12 組 Reader 合成預覽另見 [整合紀錄](../integration-2026-10-19/README.md)。28 組／14 種語言的完整模型矩陣尚未執行，真實 Chrome／影片驗收仍依先前安排延後。
