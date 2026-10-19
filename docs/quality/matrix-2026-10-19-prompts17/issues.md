# 本輪未接受案例與後續修正方向

以下是本輪固定輸出的證據，原始教材未經人工修正。七組有內容問題；法文不確定情境另因風險覆蓋不足未接受。16 項非阻擋警告完整保存在各份審查 JSON，沒有拿警告取代錯誤判定。

## 來源忠實度須涵蓋全部欄位

1. **西文不確定情境：摘要將引述者連到 Maya。** `/sections/0/context/text` 寫「對其話語的引述」，其中「其」接回前面提及的 Maya；來源 `dijo` 省略主語，未確立兩者為同一人。摘要應列出引述的請求，不指派未明說話者。[逐項證據](./reviews/es-uncertainty-quote-topic-automatic.json)
2. **越文一般對話：標題新增「臨時遇見」。** `/sections/0/title` 加入偶遇／會面事件，來源只描述仍在此處、正要離開時被呼叫及等待請求。應讓標題也遵守與摘要相同的來源界線。[逐項證據](./reviews/vi-normal-transfer-automatic.json)
3. **泰文不確定情境：未保留來源性別的不確定性。** 翻譯、句意與 chunk 寫「他說」；`เขา` 本身不確立性別。在本次嚴格來源準則下，應在受影響欄位採用「對方說」等中性引述，不從名字或相鄰回合補性別。此用法另對照了 [Thai With Grace 的原始教學說明](https://thaiwithgrace.com/third-person-pronouns-in-thai/)。[逐項證據](./reviews/th-uncertainty-quote-topic-automatic.json)
4. **簡中不確定情境：摘要保持中性，教學點卻補了引述角色。** `/points/0/explanation` 說「在此處……對方的原話」；原文「是这么说的」未明示引述者，也可能轉述自己或其他人的發言。應說明引用功能，保留角色未明，而非只在摘要遵守來源規則。[逐項證據](./reviews/zh-CN-uncertainty-quote-topic-automatic.json)

這四組涉及標題、摘要、翻譯、句意、chunk 及教學點。後續應檢查規則是否真正進入每個實際生成欄位，並以新的獨立輸出驗收；不能只讓一個欄位的附註補救另一欄位的確定斷言。

## 局部教學與新例句須各自正確

5. **法文一般對話：局部 chunk 的句意不符合來源。** `Pourquoi es-tu encore là ?` 中的 `être` 是處所用法，`/sections/0/utterances/0/chunks/1/meaning` 卻將 `es-tu` 教成「你是」。整句翻譯正確，仍未修正局部「你是／還在這裡」的不當組合。應保留可獨立理解的處所構造，或改用符合此處語境的局部句意。[逐項證據](./reviews/fr-normal-transfer-automatic.json)
6. **繁中不確定情境：情境與例句動作不同。** 第一組例句的 `situation` 寫確認是否「寄送文件」，實際問答卻確認是否「通知大家明天的集合時間」。應讓情境與對話詢問／回答同一項動作。[逐項證據](./reviews/zh-TW-uncertainty-quote-topic-automatic.json)
7. **義文不確定情境：正確的 `dimmi` 被擴張為過度全面的構詞規則。** `/points/0/explanation` 說單音節命令式接代名詞時，代名詞字首子音會雙寫，未保留 `gli` 例外，例如 `digli`、`diglielo`。正確的來源及新例句不能證明這項無條件規則成立。應只解釋本例的 `mi`，或清楚限定規則及例外；例外另對照 [Treccani 文法條目](https://www.treccani.it/enciclopedia/pronomi-personali_%28La-grammatica-italiana%29/)。[逐項證據](./reviews/it-uncertainty-quote-topic-automatic.json)

後續驗收需同時對照完整譯文、局部 chunk、解釋規則、抽象模板、情境及例句角色；字串引用正確或一個正確例句不足以取代這些檢查。

## 覆蓋不足須與語言錯誤分開處理

8. **法文不確定情境：未選到不明片段。** 生成的學習 sections 只有 `c1`、`c2`，`c3`、`c4` 仍留在原始 `cues`，但 `[???]` 未出現在被選中的 utterances。程式結構合法、已生成內容未發現阻擋語言問題，固定案例的風險覆蓋仍未通過。[逐項證據](./reviews/fr-uncertainty-quote-topic-automatic.json)

這個結果需要確認驗收是否要求候選選擇保留該風險，或另設可固定教學範圍的品質測試。不能為提高數字而略過覆蓋條件，也不能據此推論產品刪除了原始字幕。修正來源忠實度與局部教學之後，應針對上述七組內容問題及這組覆蓋不足重新建立獨立驗收紀錄，再決定是否需要擴大重驗。
