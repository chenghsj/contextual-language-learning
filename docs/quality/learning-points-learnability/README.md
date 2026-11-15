# 提示詞易學性：實際模型抽樣

日期：2026-10-11。工作目錄 `immersive-language-learning`，分支 `codex/core-redesign`，HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`。使用者明確授權將列出的兩個日文樣本送往 Antigravity／`gemini-3.7-flash`；思考級別 medium、JLPT N3、解說語言 zh-TW、每個可移用項目一組例句。

最新提示詞是 `learning-points-prompts-10`。兩個樣本均有完成並通過 Host 結構驗證的教材；以下是定向內容檢查，沒有驗證學習成效或所有語言的教學品質。

## 最新產物

| 樣本               | 重點 | 核心／延伸 | 可移用項目 | 教材                                                                                                                                                                 |
| ------------------ | ---- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 口語縮約與情境理解 | 6    | 5／1       | 3          | [Markdown](./prompt-10-attempt-1/ja-learnability-contractions-automatic/lesson.md)／[JSON](./prompt-10-attempt-1/ja-learnability-contractions-automatic/lesson.json) |
| 不明字幕與可靠片段 | 6    | 6／0       | 6          | [Markdown](./prompt-10-damaged-retry/lesson.md)／[JSON](./prompt-10-damaged-retry/lesson.json)                                                                       |

前者是合成日常對話；後者混合合成內容與使用者附檔中的不明字幕。兩者不是整份原教材的重生成，也沒有取得原音來校正字幕。

## 內容檢查結果與追補

Prompt 9 的兩個樣本都生成成功，但人工檢查發現三項問題：`ネタ` 的詞源仍佔核心解說；`読んでれば` 的 pattern 寫成 `[動詞て形去て/で]てれば`，會刪除原本的「で」；不明的 `悪いないって` 被另列為 extended 學習點，附上可能的意思及句尾推測，還產生讀音。這些輸出保留於 [prompt 9](./prompt-9/)，不能視為教學品質通過。

Prompt 10 將不明片段不可教成用法的邊界提升到 System Prompt，禁止以附註包裝推測或另建不明片段的學習點／讀音。另提供保留動詞完整「て／で」形的正向框架示例，以及完整活用詞讀音示例，並將 basic_only 的契約明定為必填 `pointIds: []`。

最新產物的定向檢查確認：

- 兩份教材都沒有詞源段落。口語樣本的框架保留 `[動詞て形]いたら`／`[動詞て形]いれば` 及口語省略「い」的說明。
- 不明字幕的翻譯、整句意思、情境、受影響的語塊及可靠重點均有相應不確定性說明；不明片段沒有獨立學習點、pattern、例句或 reading。
- `読んでれば` 本身仍能獨立解釋並移用，不把不明的後半句當成可靠結論。
- 每個已產生的可移用項目都有一組兩句對話，指定 targetText 對齊例句；原字幕文字與時間保留。

實際模型翻譯摘錄：

> 我懂。只要有讀ヒカル的漫畫，……（「悪いないって」原文不明，後半意思無法確定）。

這項結果確認本次產物採取了來源限制，不能證明所有可疑字幕都會自動被識別。

## 執行與恢復

Prompt 10 的口語樣本在一次局部修復後完成，約 75.5 秒、4 次模型呼叫。不明字幕第一個嘗試在 180 秒逾時；嘗試續跑時，凍結輸入校驗拒絕執行，沒有新增模型呼叫。[完整紀錄](./prompt-10-attempt-1/report.json)與[續跑拒絕紀錄](./prompt-10-attempt-1/resume-report.json)均保留。

確認資料內容完全相同後，發現品質腳本建立 request 的欄位順序與儲存 schema 的順序不同，造成 `JSON.stringify` 指紋不一致。品質腳本已改用 `GenerationRequestSchema.parse` 正規化請求，再凍結指紋；新 checkpoint 的指紋核對相符。這次沒有修改正式 Host 的輸入校驗，也沒有改寫既有 checkpoint 來繞過保護。

單獨重跑不明字幕樣本後，模型仍多次耗盡 8192 輸出預算；用量紀錄中的 reasoning 佔了大部分 output。Host 按既有規則拆批，完成第一句後在 360 秒逾時。從同一 checkpoint 續跑約 119.5 秒後完成剩餘內容，候選、選材及完成批次不重做。[首次逾時](./prompt-10-damaged-retry/initial-execution-report.json)、[續跑結果](./prompt-10-damaged-retry/resume-report.json)及[完成 checkpoint](./prompt-10-damaged-retry/completed-checkpoint.json)保留。最終 checkpoint 累計 11 次模型呼叫，其中包含先前的修復及截斷嘗試；沒有將恢復後成功改寫為首次成功。

所有本輪已記錄的模型呼叫去重後為 30 次，包含 prompt 9、prompt 10 失敗嘗試與最後恢復，見 [檢查摘要](./review-summary.json)。提供者紀錄為 subscription；未估算金額。

## 仍有的限制

部分解說仍先寫文法分析，或使用「非常高頻」等概括措辭；不明字幕樣本對 `読んでれば` 的核心說明仍較長。口語樣本的重點解說長度中位數由 prompt 9 的 75 字元變成 prompt 10 的 89.5 字元；本次改善主要可見於移除不必要詞源、保留構式及來源限制，不能宣稱每段文字都變短。例句與語用仍需要更廣的語言品質審查。

30 個相關離線測試、全專案 typecheck、最新 Native Host build 與提示詞文件同步檢查通過。Prompt 9 checkpoint 不能混用 prompt 10 續跑。已安裝的 Native Host 未更新，既有教材未改寫；本次不等同載入中的瀏覽器／影片驗收、發佈或學習成效驗證。
