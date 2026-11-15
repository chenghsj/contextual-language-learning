# 語塊學習設定簡化與閱讀器重整

實作位置：`/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`，基準 HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`。保留原有未提交變更，未建立提交或發佈。

## 設定與資料

- 新標準教材固定六類可用、無著重類別、每個可移用項目一組例句。移除六類深度和例句數控制，沒有新增整體深度選單。
- 預設、偏好、舊草稿、預檢和建立請求共用 `contextualGenerationProfile`。保留舊欄位供相容讀取；教材本身不正規化或重寫。
- 新學習點必須提供 `presentation`。必要理解與避免誤用用 `core`；替代形式／對照可用 `extended`。舊 V6 點缺少欄位讀作 core；V5 和舊多組例句保留。
- Reader adapter 保留 ID、來源範圍與層級；只有完全相同的 spans 才建立語塊關聯。非連續 spans 可精確關聯，沒有關聯的延伸項目保留整句範圍標示，共用 ID 去重。
- workflow：`learning-points-v6-3`；prompt：`learning-points-prompts-6`；Host protocol：9。舊 checkpoint 可保留／讀取，但不能混用新策略續跑；舊版本教材備份還原仍可用，重複比對不把舊執行身分當作新身分。
- 五種介面語言新增整合閱讀文案；Markdown 匯出保留必要／延伸層級。JSON 匯出、備份與還原保留可選欄位。自訂 Markdown 的範本與生成流程保留。

## 閱讀與生成

完整原句組織字幕；跨字幕只展開一份解析，每個來源 cue 仍有原文、讀音、播放與翻譯。選語塊突出片段意思，保留整句關係與 core，避免再重述整句意思。選整句顯示整句理解。一次只展開一份；場景切換收合，播放、翻譯與讀音切換保留解析。

移除六類閱讀開關及分類 accordion。必要解說直接可見，「更多解說 → AI 延伸例句 → 本影片其他出現」按實際內容出現。舊多組例句仍可繼續展開。側欄與寬版均單欄，保留既有字體、色彩、導覽與播放器。

生成規則先判斷對理解或移用有用的資訊，整合詞語、文法、縮約及語氣，不設重點數量配額，不要求產出 extended 或可移用項目。可移用項目一組自然對話；沒有可靠延伸價值可省略。生成時自查來源不確定性、轉述角色與例句對話關係。

Host 嚴格拒絕空白／標點、越界、重疊、Unicode 及保守詞界錯誤的切分。`prepareTeachingBatch` 只在移除可選切分後其餘完整契約仍獨立通過時，保留整句理解、重點和例句；不猜新邊界，不修改原文，不增加模型呼叫。模型已用引號及不明標記明確指出的原文片段，Host 另省略其來源讀音，保留相鄰可靠標註與原文；這項保守處理只辨識明確標記，不宣稱能自動找出所有字幕錯誤。一般 validator 仍拒絕錯誤切分，舊檔讀取不套用新增品質限制。

## 自動驗證

| 驗證                                         | 結果                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 相關資料／請求／閱讀 UI／備份／pipeline 回歸 | 50 / 50 通過                                                                                                   |
| 全部 TypeScript 回歸                         | 583 / 588 通過；五項既有失敗列於下方                                                                           |
| Host 平台／安裝器／bundle／pnpm 檢查         | 27 / 27 通過；需要 localhost 的檢查在允許該能力後重跑                                                          |
| typecheck、extension build、Host build       | 通過                                                                                                           |
| 四種寬度預覽                                 | 320、390、1000、1280px 通過                                                                                    |
| 閱讀操作預覽                                 | 跨字幕、非連續 spans、空入口、舊例句、日韓長句與讀音、側欄／寬版、鍵盤焦點／選取、播放／翻譯／讀音保留解析通過 |
| Host protocol 9 smoke                        | 通過；V5／V6 混合讀取、校準儲存、舊資料隔離、重複檢查及 custom-v1                                              |

完整回歸剩下：task-history 版面字串契約、generation-status 舊文案契約、六個共享 shadcn wrapper 舊樣式契約、task-history 舊 badge 契約、`zz-debug-prompt.test.tsx` 的 timeout。相同項目已出現在本次實作前的 `/tmp/cll-reading-full-final.log`，並未為使總數全綠而修改無關介面。

預覽記錄：`/tmp/cll-chunk-final-layout.log`；完整回歸：`/tmp/cll-chunk-final-regression.log`；相關回歸：`/tmp/cll-chunk-latest-focused.log`；typecheck／build：`/tmp/cll-chunk-final-typecheck.log`、`/tmp/cll-chunk-final-build.log`；平台：`/tmp/cll-chunk-platform.log`；Host smoke：`/tmp/cll-chunk-final-smoke.log`。

最後一輪預覽截圖與結果 JSON：`/var/folders/9p/y1z7d0wd4033k52mhtfk2trc0000gn/T/cll-v6-ui-h9T3Pq/`。其中 `settings-390-advanced.png` 已確認進階區域實際展開、解說語言欄位可見；這些截圖使用隔離預覽及模擬 adapter，不是實際影片驗收。

## 模型內容品質

使用已獲使用者明確允許的 Antigravity／`gemini-3.7-flash`（medium），輸入六段固定英／日／韓合成對話及四段 N3 問題字幕與鄰句。真實字幕的 cue ID、原文與原時間直接使用提供教材，所有結果只存隔離測試目錄，不改寫內容庫。結構成功數只代表完成契約，沒有作為語義通過率。

初輪發現詞內切分、臆補輕音部／樂譜、把未明名字當休假、指派韓文省略角色，以及簡單反應的冗餘重點。後續補強詞界拒絕／整句降級、各欄不確定性、保留人名原字、省略不確定名字讀音、轉述者／請求者／受益者與例句角色檢查。

| 素材                    | 已人工核對的重點                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EN interrupted plan     | 時間關係、整合 be about to／head out；例句可移用                                                                                                                              |
| EN reference decision   | think it over、敲定與考慮期限；例句自然，時態解說仍須避免當成無例外規則                                                                                                       |
| JA forgotten item       | 縮約與假定、慶幸；移除 N3 下不必要的あれ重點                                                                                                                                  |
| JA reported plan        | 不接受けど／ない的錯誤切分；可退回整句；自然邀約例句                                                                                                                          |
| KO changed plan         | 完整保留참에／그치면；條件與意圖解說                                                                                                                                          |
| KO reported decision    | 不把같이／알려切成詞內片段；請求者與收件者未明時使用中性譯法                                                                                                                  |
| N3 uncertain title      | 不補書名，保留「反応そう」不明；短反應不建立額外學習點                                                                                                                        |
| N3 incomplete caption   | 不將K音部／過去の不補成確定社團或樂譜；可靠被動／報酬／推測保留                                                                                                               |
| N3 whole inflected word | いける完整、條件與後項關係；原人名不以劇情補充                                                                                                                                |
| N3 uncertain name       | 保留休み／藤／テッシー／ヒカる原字；不以字典意思解作休假、不猜名字讀音；最後複測在翻譯、整句理解一致標示不明並省略不可靠切分；Host 移除仍被猜測的休み讀音，保留友達等可靠讀音 |

品質結果目錄：第一輪 `cll-v6-quality-SnsTj7`、第二輪 `cll-v6-quality-u0p3JW`、問題複測 `cll-v6-quality-NAu5yU`、角色／名稱複測 `cll-v6-quality-0EVVJ0`、名稱原字／讀音複測 `cll-v6-quality-JIwIT9`，均位於 `/var/folders/9p/y1z7d0wd4033k52mhtfk2trc0000gn/T/`。不確定性跨欄一致的最後複測 `cll-v6-quality-9gftnl`，記錄在 `/tmp/cll-chunk-quality-consistency-final.log`；該隔離目錄的 `host-uncertainty-validation.json`／`host-safe-batch.json` 保留模型原輸出與 Host 保守處理的對照，確認額外模型呼叫為0。

同樣五份可比較素材在第二輪與第三輪，重點總數由17降到13，可移用項目由13降到10，每項一組例句。這是此模型這次樣本的比較，不能推論每部影片固定減少相同比例；沒有比較不同篇幅素材或把失敗的第六份算作減量。

## 安裝與實機界線

已為 Chrome 開發擴充功能 `agkdfdbgkoeooffhfkonpdkgfeldjifi` 安裝 protocol 9 Host。已核對 localhost:5174 的開發伺服器來自本工作目錄，實際 Chrome Side Panel 顯示精簡內容設定，能從 Host 內容庫打開原有 N3 V6 教材與來源語塊。

尚未完成擴充功能正式重載及真實影片的選句展開、播放、循環、校準完整驗收。原生控制遇到無畫面定位／失效索引；瀏覽器工具也拒絕開啟 chrome-extension 協定頁面，未繞過此限制。上述預覽播放器與 Host smoke 不等於實際影片驗收。完成這一步需在 Chrome 重新載入 Dev 擴充功能，於原影片依序核對解析選取與播放獨立、切換翻譯／讀音保留解析、循環區間、校準後播放位置，以及切場景收合。
