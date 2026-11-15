# 固定輸出的退件、撤回與待複核

初審未接受八組；2026-10-19 對這八組作同一審查者的事後複核，保留五組退件、撤回一組、改列一組待複核，另一組仍屬固定測試覆蓋不足。目前接受 21／28 組，並非生成品質變好；原始輸出與初審檔案均未改寫。完整反面解讀、來源與判定修訂見 [複核紀錄](./reassessment/README.md) 及 [逐案決策](./reassessment/decisions.json)。

## 保留的五組退件

1. **西文不確定情境：摘要指涉，依據是產品契約。** `context.text` 的「對其話語的引述」將引述連到 Maya。自然對話中這可能是合理解讀，但目前 prompts-17 明定無說話者標籤的摘要不可用代詞連結不同回合。因此保留契約退件，不能說成該西文解讀在語言上不可能。[原始審查](./reviews/es-uncertainty-quote-topic-automatic.json)
2. **法文一般對話：局部句意，依據包含辭典及編輯判斷。** `Pourquoi es-tu encore là ?` 是處所用法，可獨立點選的 `es-tu` 卻提供「你是」作為此處句意。[法蘭西學院 être 條目](https://www.dictionnaire-academie.fr/article/A9E2986) 支持處所義；是否以此阻擋接受仍是按 contextual meaning 欄位定義作出的編輯判斷。若它只提供詞典式形態提示，嚴重程度可以不同，須明確區分。另將摘要的「接到電話」列為非阻擋疑慮：[appeler 條目](https://www.dictionnaire-academie.fr/article/A9A2203) 同列呼喚與電話聯絡義，支持媒介尚未唯一確立，而非證明電話解讀必錯。[目前審查](./reassessment/fr-normal-transfer-automatic.json)
3. **義文不確定情境：規則範圍，依據是可檢查的反例。** `di’ + mi → dimmi` 本身正確，但說明將單音節命令式接代詞一概寫成字首子音雙寫為 `-mm-`，沒有把範圍限定為本例的 `mi`。[Treccani 文法條目](<https://www.treccani.it/enciclopedia/pronomi-personali_(La-grammatica-italiana)/>) 列出 `gli` 結合形式的例外。退件原因是寫成一般規則，不是要求 B1 的單一例子列出所有文法例外。[原始審查](./reviews/it-uncertainty-quote-topic-automatic.json)
4. **越文一般對話：標題情節，依據是來源忠實度契約。** 「臨時遇見」可以是合理的場景猜測，但來源只確立仍在此處、正打算離開時被呼叫及請求等待，未確立偶遇事件。保留來源契約退件，不能說成越文語法錯誤。[原始審查](./reviews/vi-normal-transfer-automatic.json)
5. **繁中不確定情境：例句內部不一致，直接可比對。** 情境寫確認是否「寄送文件」，問答卻只確認是否「通知大家明天的集合時間」。同一辦公室可以發生兩件事，仍不足以讓情境準確描述這組問答。保留與同一動作契約不符的退件。[原始審查](./reviews/zh-TW-uncertainty-quote-topic-automatic.json)

這五組的證據類型不同，均應附帶其來源、契約或編輯判斷界線；不能一律稱為經獨立認證的語言錯誤。

## 撤回的退件

**泰文不確定情境：「他說」不構成足夠的男性身份證據。** 原審查只引用中文「他」的字形推定新增男性身份。[泰文教學資料](https://thaiwithgrace.com/third-person-pronouns-in-thai/) 只能證明 `เขา` 可指 he 或 she；中文 [教育部辭典](https://dict.revised.moe.edu.tw/dictView.jsp?ID=2423&q=1&word=%E4%BB%96) 釋為第三人稱，[漢典](https://zdic.net/hant/%E4%BB%96) 也記錄不分性別的泛指用法，不能單憑字形證明這裡新增男性。撤回阻擋判定，保留原有讀音標記警告，改列 AI 編輯接受。這不表示所有語境都適合使用「他」。[修訂審查](./reassessment/th-uncertainty-quote-topic-automatic.json)

## 待複核，不計入接受

**簡中不確定情境：「對方的原話」的作用範圍。** 原審查把「對方」直接認定為目前聽者，證據不足；它也可能只是一般轉述說明中的另一人。不過「在此處」「確實」仍可能把來源未明的角色說得過窄。改列 `needs_review`，保留未接受狀態，等待獨立編輯確認是具體角色斷言還是一般教學說明。存在更中性的改寫方式，本身不能證明原文錯誤。[修訂審查](./reassessment/zh-CN-uncertainty-quote-topic-automatic.json)

## 測試覆蓋不足，沒有新增語言退件

**法文不確定情境：未選到不明片段。** sections 只有 `c1`、`c2`，`c3`、`c4` 仍完整保存在原始 cues。這次未測到 `[???]` 的處理，因此固定風險覆蓋未通過。候選選擇可以只選有學習價值的段落；這個覆蓋結果不是字幕遺失或產品選擇功能故障的證據。後續須以固定教學範圍或新的案例確保真的測到該風險，不能直接降低原條件使數字通過。[原始審查](./reviews/fr-uncertainty-quote-topic-automatic.json)

17 項非阻擋警告保存在目前審查 JSON。本輪未修改 prompt、教材或來源案例，未增加模型生成，也沒有教師／母語者、真實音訊、已安裝 Host 或 Chrome／影片驗收。
