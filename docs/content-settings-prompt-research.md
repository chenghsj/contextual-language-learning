# 內容設定提示詞：生成範圍、學習價值與品質缺口

查核日期：2026-10-09。此文件整理學習研究與官方能力框架，供「內容設定 → 提示詞 → 產物」的原始碼審查使用；不宣稱已評估本產品的真實模型輸出或學習成效。先讀取既有 [語塊研究](./chunk-video-research.md) 與 [解說深度研究](./explanation-depth-research.md)，再查核下列第一手來源。此處補充可操作的判準，避免重複整份既有筆記。

原始碼範圍：`/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`，HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`，含目前工作目錄的未提交變更；HEAD 本身不代表本次查核的完整程式內容。結構化流程版本為 `scene-v5-2`／`scene-prompts-3`。本次只新增此研究文件，沒有修改功能、安裝 Native Host、呼叫付費模型或確認已載入擴充功能的版本。

## 對目前實作的判斷

**目前 prompt 有足夠的教學設計基礎，可以要求模型生成供理解原句和學習延伸用法的內容；但還不足以保證每次產物都有適切、完整的解說。** 最值得優先改善的是新內容的最低品質要求與驗證、例句的意思和使用條件，以及 prompt 內的歧義。不是單純增加字數、場景或例句，也不需要因此加入測驗。

此處的「足夠」分三層：

| 問題                              | 本次結論                                                     | 證據邊界                                   |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Prompt 是否要求了可供學習的內容？ | 有：情境、原句、意思、依程度解說、理解片段、可重用表達及例句 | 已查核原始碼與設定傳遞                     |
| 是否能穩定生成符合設定的好教材？  | 尚未證明，且目前存在漏掉解析仍通過的路徑                     | 有構造輸出的邊界驗證，沒有真實模型的發生率 |
| 使用者是否因此記住並能自主使用？  | 本次不能判定                                                 | 外部研究不等於本產品學習成效               |

## 內容設定實際控制什麼

主範圍是截圖對應的「標準內容」；同頁的自訂 Markdown 是另一條生成流程，另見下方。

| 設定                 | 實際傳入／作用                                  | 限制                                                                 |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| 學習語言             | `targetLanguage`；三階段均收到對應語言策略      | 12 種語言都有基本策略，但不是逐語言教材品質驗證                      |
| 程度                 | `level`；影響選材、解說背景與術語負擔           | 只有級別標籤，沒有使用者已知詞或個人學習紀錄，不能保證精準個人化難度 |
| 內容長度             | `sceneCount`，最多 2／4／6 個場景               | 每場景 1～2 個重點表達；不代表完整講解所有字幕                       |
| 情境例句             | `contextualExampleCount`，每個表達 1～3 組      | 每組 2～3 句新對話、逐句翻譯，至少一句含原表達                       |
| 解說語言             | `instructionLanguage`                           | 解說、情境描述及翻譯用此語言；原文與例句用學習語言                   |
| 六類關閉／一般／詳細 | `enabledExplanations`／`emphasizedExplanations` | 控制新教材；閱讀顯示開關只顯示已有內容，不會補生成                   |

設定來源：[App.tsx](../apps/extension/src/App.tsx#L2259)、[ExplanationSettings](../apps/extension/src/components/explanation-settings.tsx#L9)。傳遞來源：[contextualGenerationProfile](../apps/extension/src/lib/contextual-profile.ts#L14)、[buildGenerationRequest](../apps/extension/src/lib/generation-request.ts#L17)。規格：[LearningProfileSchema](../packages/core/src/schema.ts#L32)。

## 已經做得足夠具體的部分

1. **從來源選材，再教學。** 候選階段從字幕複製 1～2 個表達，保留相鄰對話；全片篩選避免重複和重疊，寧可少選，不補造場景。[選材與篩選 prompt](../apps/local-host/src/generation/scene-prompts.ts#L36)
2. **意思須回到原片上下文。** 要求解釋相鄰原句如何支持此處用法，不能只給字典義，也不能憑空確定人物、關係與心理。[教學 prompt](../apps/local-host/src/generation/scene-prompts.ts#L107)
3. **一般和詳細已有內容定義。** 一般須足以理解原句，詳細在同程度補有用的關係、對照和限制；不強制增加字數，避免重複。[解說深度策略](../apps/local-host/src/generation/language-strategies.ts#L62)
4. **拆解與可重用表達有區分。** 理解片段需對齊原文；任意片段不能標成固定表達；可重用框架可另列。[語句拆解規則](../apps/local-host/src/generation/scene-prompts.ts#L138)
5. **有實際結構檢查。** 原表達、來源 cue、鄰句證據、例句數及原表達出現在例句中，都有 Host 邊界驗證；讀者介面也有呈現意思、情境解說、分類補充和例句。[組裝驗證](../apps/local-host/src/generation/scene-pipeline.ts#L184)、[閱讀解析](../apps/extension/src/components/sentence-dialogue.tsx#L256)

## 優先缺口：新教材的解析可缺失而仍成功

`sentenceAnalyses` 使用 `.optional().catch(undefined)`，格式不合法時可整組捨棄。有效解析也可只有空 `chunks` 和空 `notes`；無效的切分範圍會被移除。這些降級能保留原始內容、支援舊教材，但目前也套用於新生成內容，無法區別「這句不需補充」與「模型漏掉使用者所選解說」。[場景 schema](../packages/core/src/schema.ts#L194)、[解析驗證與舊教材降級](../packages/core/src/sentence-analysis.ts#L58)

本次用實際 `assembleContextualScene` 執行構造輸出。固定原文為 `Do you want to go out tonight?`／`I'm not really up for it.`，焦點 `up for it`，程度 A2，文法和語句拆解設為詳細、語氣一般，例句 1 組；其他必要欄位保持合法。結果：

| 構造輸出                                       | 是否接受 | 最終內容                       |
| ---------------------------------------------- | -------- | ------------------------------ |
| 沒有 `sentenceAnalyses`                        | 是       | 無新增句子解析                 |
| `sentenceAnalyses: []`                         | 是       | 解析為空                       |
| 有解析，但 `chunks: []`、`notes: []`           | 是       | 沒有拆解與分類補充             |
| 拆解結束位置 999，超出原句                     | 是       | 無效拆解被捨棄                 |
| 例句含 `up for it`，其餘文字不自然、翻譯不相符 | 是       | 表面符合字串與結構要求即可接受 |

**這是驗證能力的反例，不是真實模型失敗樣本，也不代表發生率。** 基本表達意思、上下文解說和例句仍存在，不能說整份內容是空白。它證明的是「完成生成」不能等同「詳細文法／拆解確實交付」。

目前局部修復重試只針對鄰句證據錯誤，不會因缺少解析、空解說或無效拆解觸發內容修復。[重試條件](../apps/local-host/src/generation/scene-pipeline.ts#L473)

**建議：** 舊教材繼續寬容讀取；新生成另設品質檢查，確認焦點所在原句有適當解析。遇到有必要的解說缺失時做局部修復或清楚標示降級。不要強迫六類每句都有內容；文化、簡單結構或不確定讀音仍可省略。是否「有必要」含語言判斷，不能只靠陣列非空解決。

## 其他會影響學習品質的缺口

### 1. 例句更重視出現字串，還缺同義同用法的明確要求

Prompt 已要求情境不同、原表達原樣出現、避免額外難詞；但沒有同樣明確要求例句延續原片中的核心義項、句法功能及適切語域。驗證只檢查情境標籤不重複和字串出現，不能判斷情境是否實質不同、對話自然、翻譯相符或用法相同。[例句 prompt](../apps/local-host/src/generation/scene-prompts.ts#L121)、[例句驗證](../apps/local-host/src/generation/scene-pipeline.ts#L276)

**建議：** 明確要求同一核心用法、自然對話、前後句能顯示使用功能，以及符合程度的非焦點語言；不同情境不可只換人名。若另示範形式變化，要與原字幕字面形式分開，不要移除來源保真檢查。

### 2. 選材有方向，但可移用單位的邊界仍依賴模型

候選 prompt 要求日常、可重用、符合程度；各語言也有片語、詞尾、助詞等規則。但還缺選材示例和反例，來說明何時該選完整表達、何時是句型框架、何時只是此句的理解片段。後段詳細拆解雖有固定／可變部分的要求，早期候選若選得零碎，後段已被要求照選定表達教學。[候選選材](../apps/local-host/src/generation/scene-prompts.ts#L50)、[語言策略](../apps/local-host/src/generation/language-strategies.ts#L8)

**建議：** 在選材階段加入少量逐語言例子與反例；偏好能說清楚交際作用、邊界完整的學習單位。選材品質仍需以真實產物檢查，不能從規則存在推出已選得好。

### 3. 有兩處指令／示範容易造成歧義

- 共通規則籠統禁止編造對話，教學階段又明確要求新對話。雖然後文明確分開來源和 AI 例句，仍建議改成「不得編造或改寫來源對話；只允許在 AI 例句欄位創作新對話」。[共通規則](../apps/local-host/src/generation/scene-prompts.ts#L32)
- 結尾 JSON 示意仍只有舊欄位，沒有 `sentenceAnalyses`；前文另提醒必須加入。建議提供完整且符合當前輸出格式的示例，尤其是焦點、完整原句、拆解與解說之間的對應。[舊格式示意](../apps/local-host/src/generation/scene-prompts.ts#L146)

這些是原始碼可見的歧義風險，尚未以 A/B 模型輸出證明其影響大小。

### 4. 能力和音訊的資料限制，不能靠 prompt 消除

程度目前是級別標籤，語言策略是基本規則；沒有個人已知詞資料，不能宣稱精準掌握學習負擔。教學模型收到的是標題與文字字幕，不能確認錄音中的實際重音、語調或連音。現有一般／詳細規則已提醒後者，應保留；若要更精準，需要新增資料與評估，而不是只強化措辭。[程度與語言輸入](../apps/local-host/src/generation/scene-prompts.ts#L14)、[讀音證據限制](../apps/local-host/src/generation/language-strategies.ts#L47)

### 5. 自訂 Markdown 不具有相同的教學保證

同頁自訂模式以使用者 prompt、選用標題與字幕生成 Markdown，不攜帶標準模式的學習 profile，也不套用六類解說深度規則。內建詞彙、文法、跟讀等範本目前主要是簡短任務描述；文法範本會要求練習題，跟讀範本會要求節奏提示。這是獨立模式的內容設計，不能將標準教材的來源、程度與讀音限制視為它已具有的行為。[自訂 request](../apps/extension/src/lib/generation-request.ts#L45)、[自訂生成](../apps/local-host/src/generation/custom-pipeline.ts#L61)、[內建範本](../apps/extension/src/i18n/builtin-prompts.ts#L7)

**建議：** 保留使用者自行要求測驗的自由；若內建文法範本目標是解說，練習應是明確選擇。內建教學範本應補來源／示例區分、可讀程度及文字推測發音的限制。自訂 prompt 仍須尊重使用者明確任務，不能強行套用所有標準教材限制。

## 可先採用的 prompt 補強草案

此節是取消「每場景最多兩個表達」之前的局部品質補強。後續以完整原句與可變學習重點為主體的定稿見 [完整 Prompt 規格](./learning-points-prompts.md)；不要把下方 expression-centered 草案當作新流程的完整規格。

以下只為研究建議，尚未改寫應用程式。現有 Normal／Detailed 定義已存在，應保留；新增規則應替換歧義或補缺口，不重複整套教學策略。

```text
Never invent or alter SOURCE dialogue. Create new dialogue only inside
AI-created contextual examples, clearly separate from source evidence.

For each selected expression, identify its contextual meaning and communicative
function. Explain necessary reference, omission, negation or dependency that
would otherwise prevent this learner from understanding the original utterance.
Use only enabled explanation categories; preserve basic meaning and context.

For a genuinely reusable expression or frame, explain fixed and replaceable
parts and important usage limits when relevant. Do not label arbitrary
understanding segments as fixed expressions.

New examples must demonstrate the same core sense and use of the focus expression
as the source, in natural dialogues appropriate for the learner level.
Keep non-focus language simple. Distinct situations must differ meaningfully,
not merely by names or locations. Translations must match each dialogue line.

Return sentenceAnalyses for the selected original utterances as requested.
If exact chunk offsets are uncertain, omit those chunks but retain useful,
source-grounded enabled notes for the utterance. Do not fill irrelevant categories.
Before returning, check coverage, source references, translation consistency,
example use, and whether Detailed adds useful information without repetition.
```

模型自我檢查只是輔助，不能取代程式結構驗證或語言審閱。仍需把實際 JSON 示例補齊，以及將新生成的品質要求和舊資料讀取相容處理分開。

## 本次驗證及建議順序

- 執行 `node --import tsx --test packages/core/src/learning-analysis.test.ts apps/local-host/src/generation/sentence-analysis.test.ts`：26／26 通過。這些測試驗證設定傳遞、來源對齊、降級及保存；不證明真實生成內容的教學品質。
- 另外執行上述五個構造輸出的邊界探針，全部被接受；未新增測試或修改功能程式碼。
- 尚未做真實模型產物抽樣、已安裝 Host／擴充功能驗證或使用者學習效果評估，因此不報告成功率、錯誤率或效果量。

建議順序：先澄清指令與補齊輸出示例，再為新生成補最低內容品質檢查及局部修復；接著固定字幕、模型版本、程度與例句數，抽查英／日／韓的簡單與複雜原句、一般／詳細，以及關閉部分解說的產物。最初可用三語言 × 兩段素材 × 兩種深度作為 12 個設定案例；小樣本用來找問題，不用來宣稱可靠率。其他已支援語言也需逐步納入具語言能力的審閱。保留每次模型、設定、prompt 版本與原始輸出，避免混淆不同生成條件。

## 可以下的結論

保留原字幕及前後文、提供適切意思與解說、指出可重用表達並展示新情境，是合理的教材生成方向。它可以構成「可供理解和學習的材料」，但還不足以證明使用者已能長期記住、即時聽懂或在對話中自行使用。這個區分應同時用在產品宣稱與驗收標準；生成欄位完整只證明格式完整。

這是下方證據的**綜合推論**，不是任何單篇論文對本產品的驗證。內容本身應先用準確性、可理解性、情境一致性與可移用條件評估；學習效果則需要另外觀察使用者。

## 1. 保留情境與影片回放有研究支持，但不是所有標示都更好

Majuddin、Siyanova-Chanturia、Boers（2021）將 122 位 L2 學習者分到字幕有無／標示與觀看一次／兩次的六個條件。字幕有利於多詞表達形式回想，重看也改善理解和表達習得；字體強調削弱字幕對內容理解的幫助。這裡讀取出版者摘要，沒有重新分析資料。[原論文摘要](https://doi.org/10.1017/S0272263121000036)

同作者的近似複現（2024 線上發表）在預告表達學習目的及測驗後，看到強調字幕對回想較有利，但原研究中重看的顯著預測效果未複現；較低詞彙知識學習者的內容理解尤其受到標示影響。它更換了影片及目標表達，不能把兩研究差異全部歸因於目的說明。此處查核全文結果與結論。[複現原論文](https://doi.org/10.1017/S0261444824000296)

**提示詞／介面推論：** 選句應保留理解所需的前後文與指涉；語言重點不能使使用者失去整段在說什麼。回放值得保留，但不可把所有字都標成同等重要，或宣稱任意拆句就是多詞表達學習。上述研究中的測驗是研究測量工具，沒有推出產品必須加入作答或評分。

## 2. 程度需要改變支援方式，不能只改句子長度

CEFR Companion Volume（2020）將影片理解、語言產出、互動列為不同活動；影片理解尺度會考慮語速、清晰度、熟悉主題、視覺支援與隱含意思。中介策略包含調整語言、連結既有知識、拆解複雜資訊並說明部分和整體關係。發音尺度強調可理解度，並包含音段與韻律。這是官方描述框架，並非 AI 教材效果實驗；此處查核印刷頁 52–53、118–120、133–135。[Council of Europe 官方全文](https://rm.coe.int/cefr-companion-volume-with-new-descriptors-2020/16809ea0d4)

**提示詞推論：** 初學者可能需要指涉還原、基本詞義及句子主幹；進階者可能更需要語域、搭配限制及細微差異。程度和解說深度應分開：詳細是補足有用關係，不是使用更難術語。模型若只有文字字幕，就沒有證據斷言演員實際的連音、重音或語調；可提供一般讀音提示，並讓使用者回原片聽辨。

## 3. 翻譯是起點；可移用表達還需要形式與使用條件

Nation（2022）將詞彙知識分成讀音、字形、構詞、形式與意思連結、概念、聯想、文法功能、搭配及使用限制，並區分所需學習負擔。這是作者概念架構；此處讀取出版者章節摘要，不是「九個面向都填滿才有效」的實驗。[Knowing a word 原章節摘要](https://www.cambridge.org/core/books/abs/learning-vocabulary-in-another-language/knowing-a-word/A663820BEC148D495A5B56E923CE3C37)

**提示詞推論：** 除了此處意思，可重用表達應在需要時交代固定部分、可替換位置及重要使用限制。為了理解原句而切出的自由片段，和可以移用的搭配／片語／框架應明確區分。不必每句填滿所有解說類別，也不應只換寫法重複同一翻譯。

## 4. 多個新情境不自動等於更好遷移

Chandy、Serrano、Pellicer-Sánchez（2025 線上發表；卷期標為 2024）讓 42 位成人 L2 英語學習者閱讀相同故事三次及三個不同故事；每種條件包含十個假詞，各出現六次。相同故事帶來更快處理與較佳短期學習，優勢未保留到延後測驗；不同故事沒有帶來更高短期或長期詞彙分數。此處查核全文摘要及結論，不能據此判定新情境無用，也不能把單詞閱讀結果直接套到影片語塊。[原論文全文](https://doi.org/10.1017/S0142716424000407)

**提示詞推論：** 「1～3 則」是產物數量設定，沒有上述研究所認定的最佳值。品質至少應看：情境是否確實不同、表達是否自然、核心意思及語域是否適用、其餘文字是否符合程度。原片中的形式必須保真；若另示範人稱、時態或槽位變化，需要清楚區分原文與新例句。強制每則完全相同的字串可以幫助辨識，也可能限制有用的形式變化；這是待樣本評估的取捨，並非此研究測得的結論。

## 5. 看懂與即時運用不能混為一談

Saito、Fan、Pellicer-Sánchez、Uchihara（2026）在短期、有意的影音訓練前後，用辨識、回想及詞義判斷任務評估中國英語學習者對 18 個多詞表達的知識。摘要報告陳述性知識增益大於自動化知識增益。此處只讀取出版者摘要，不補報未查核的樣本數或效果量，也不把其任務等同自由對話。[原論文摘要](https://journals.sagepub.com/doi/abs/10.1177/13621688251413734)

Li、Ni（2026）將 109 位華語背景英語學習者隨機分到三個實驗組及控制組；三次觀看時輪換 L1／L2／無字幕的條件，整體優於一直使用 L2 字幕的條件。作者以提取與試誤機制討論結果；這些機制是解釋，不能單獨視為本研究已操弄並證實的原因。查核層級為摘要。[原論文摘要](https://doi.org/10.1002/tesq.70164)

**產品推論：** 可用回放、重看、切換字幕或再次遇到同一表達支援學習，並讓使用者自行選擇；不需把產品改成測驗系統。若產品目標只是提供理解和延伸用法的材料，沒有題目不構成 prompt 缺陷；若要宣稱能培養即時口說，就需要額外的使用活動及成效驗證，不能靠增加解說篇幅證明。

## 用於本次原始碼審查的最低教材品質判準

以下是**產品驗收建議**，不是研究指定的 schema 或最佳數量。應同時檢查 prompt 是否要求、資料是否承載、驗證是否能發現違反、介面是否真的呈現。

| 判準       | 合格產物應能回答的問題                       | 典型不合格情形                                     |
| ---------- | -------------------------------------------- | -------------------------------------------------- |
| 來源與情境 | 原句在哪裡？前後文足以知道指誰、回應什麼嗎？ | 字面複製正確，但省略必要前文；編造人物意圖         |
| 核心意思   | 這句在此處是什麼意思？譯文是否一致？         | 泛用字典義；譯文與解說相互矛盾                     |
| 學習焦點   | 哪個部分值得理解或移用，為什麼？             | 任意片段都稱固定表達；只因表面難就選               |
| 組合關係   | 選中的結構如何形成此處意思？                 | 逐字翻譯相加，沒有說明指涉、否定或修飾範圍         |
| 適切深度   | 詳細多解決了哪個問題？一般是否足以理解？     | 一般故意缺必要資訊；詳細同義重述                   |
| 移用條件   | 固定／可變部分、語域及重要限制是什麼？       | 只說「很常用」；換情境後語氣或意思不適用           |
| 新情境例句 | 不同情境自然成立，而且仍示範同一重點嗎？     | 只更換人物名稱；生硬插入完全相同字串               |
| 程度負擔   | 解說和非焦點語言是否讓這個程度讀得懂？       | 初學者例句引入大量新難點；術語沒有解釋             |
| 證據邊界   | 一般規則、生成示例、影片事實有沒有區分？     | 文字模型推測的重音被寫成原片確定發音               |
| 完整呈現   | 有價值且已生成的解說是否可在讀者介面找到？   | 後端生成、驗證通過，但設定沒有對應顯示或內容被漏掉 |

## 下一步驗證

1. 先固定字幕素材、程度和例句數，審閱少量真實模型產物；涵蓋指涉／省略、慣用語、自由句法片段、禮貌語域和沒有文化背景需求的案例。
2. 使用同一材料比較一般與詳細、不同程度及內容類別關閉時的產物，找出必要資訊是否仍完整、詳細是否只是增加文字。
3. 人工審閱需按目標語言進行；英語研究與共通能力尺度不能取代日語、韓語或其他語言的語言專業判斷。
4. 先判斷教材是否正確、可讀、有用；若要進一步主張更好保留或自主使用，再設計包含延後觀察的使用者研究。結構驗證與單元測試無法回答這個成效問題。
