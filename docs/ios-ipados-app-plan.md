# iOS 與 iPadOS 閱讀 App 規劃

規劃日期為 2026-10-26。本文件以當日工作目錄中的程式碼為依據，包含尚未提交的 Web、收藏及 Reader 功能。這份文件保留產品規劃；原生 App 已建立於 `apps/ios/`，目前實作與驗證結果見 [實作紀錄](./ios-ipados-implementation.md)。

使用者已確定兩項方向。App 延伸現有 Contextual Language Learning，以閱讀與複習為主，使用 SwiftUI。以下最低系統版本、功能分期及介面細節是本次建議。

## 在手機和平板接續桌面端的學習

桌面 Extension 與 Native Host 負責產生教材。App 負責帶著教材閱讀、聽句子與複習。教材下載後，日常學習不必保持電腦開機，也不必登入才能使用本機匯入的教材。

首版的完整路徑是「匯入或下載教材 → 開啟場景 → 閱讀原文與解析 → 隱藏翻譯回想 → 朗讀 → 保存本機位置 → 下次繼續」。

| 能力 | 首版範圍                                                 | 後續擴充                               |
| ---- | -------------------------------------------------------- | -------------------------------------- |
| 教材 | 標準 V7 與自訂 Markdown 教材。支援檔案匯入及 Drive 下載  | 新 schema 的明確遷移                   |
| 閱讀 | 場景、原文、翻譯、語塊、解析、例句、可用讀音、來源資訊   | 使用者筆記及進階標註                   |
| 複習 | 使用者選教材或場景。先回想、再顯示解說。可存本機複習清單 | 間隔重複排程與跨裝置複習紀錄           |
| 收藏 | 讀取桌面端已同步的收藏快照，下載後離線閱讀               | 新增與取消雲端收藏、離線寫入佇列       |
| 位置 | 本機保存文件、場景、句子與最近閱讀時間                   | 桌面、Web、iPhone、iPad 之間的進度同步 |
| 語音 | 系統 TTS，選語音與速度，停止或重播句子                   | 背景連續播放與鎖定畫面控制             |
| 影片 | 安全開啟來源連結，閱讀不依賴播放器                       | 驗證後加入 YouTube 內嵌與循環播放      |
| 離線 | 明確下載的教材與收藏可離線重開，顯示占用空間             | 自動下載及更多快取策略                 |

首版的「本機複習清單」與「雲端收藏」分開命名及保存，避免讓使用者誤認手機的本機標記已同步到桌面。看過某一場景也不代表已學會。

## iPhone 讓閱讀與回想保持單一焦點

使用 `TabView` 提供「教材庫」、「複習」與「設定」。教材庫中的篩選可切換全部教材、已下載與雲端收藏。每個分頁以 `NavigationStack` 管理詳細頁。

教材庫上方顯示繼續閱讀，其下提供搜尋、語言篩選與教材清單。列項顯示名稱、語言、來源與下載狀態，不把長影片名稱重複做成巨大標題。搜尋先涵蓋標題、來源及語言，全文檢索另行評估。

Reader 先顯示原文與場景導覽，翻譯和解析可展開。單句提供朗讀、重播與加入本機複習清單。顯示既有教材的語塊與例句，不在手機重新生成缺少的內容。複習時隱藏翻譯及解析，使用者主動揭示答案，再前往下一句。

長文保留連續閱讀與文字選取，不把每段解析都放進獨立 modal。設定使用系統表單，包含字級、顯示偏好、語音、Drive 帳號及下載管理。

## iPad 依可用視窗寬度安排分欄

使用 `NavigationSplitView`，寬視窗提供教材清單與 Reader 兩欄。需要場景目錄時，可在閱讀欄開啟目錄側欄。預設不強制三欄，讓原文與解析保有足夠寬度。

窄視窗收合為單欄導覽。版面取決於目前視窗寬度與內容需要，不只依 `isPad` 或橫直向判斷。旋轉與調整視窗時保留目前教材、場景及展開狀態。Apple 的分欄導覽可在窄尺寸收合為導覽堆疊。[NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)

鍵盤可搜尋、切換場景與開始或停止朗讀，控制項支援指標及 VoiceOver。Dynamic Type 放大時讓原文、譯文與解析改為垂直排列，避免固定欄寬及固定行高。介面使用語意色彩與系統控制項，適應深淺色及系統外觀。

未來 YouTube 播放可採寬視窗影片左、教材右，窄視窗影片上、教材下；首版先完成原生閱讀。現有 [Web Reader 版面](./web-reader-layout.md) 是產品參考，不能直接當作 SwiftUI 已驗證的互動結果。

## 共用資料契約，原生實作閱讀與儲存

建議建立一個 Universal App target，放在 `apps/ios/`，同時支援 iPhone 與 iPad。初始 deployment target 建議為 iOS 17 與 iPadOS 17，使用 SwiftUI、Observation、SQLite 及 Swift concurrency。最低版本是產品預設，正式開發前以目標裝置確認。[Observation 支援版本](https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app)

| 層次                 | 建議責任                                   |
| -------------------- | ------------------------------------------ |
| `App/`               | App 入口、依賴組裝、導覽與帳號生命週期     |
| `Features/Library/`  | 教材、篩選、下載狀態與繼續閱讀             |
| `Features/Reader/`   | 原生標準教材 Reader 與自訂 Markdown Reader |
| `Features/Review/`   | 本機複習清單與揭示答案的 session           |
| `Features/Settings/` | 外觀、語音、帳號與下載管理                 |
| `Domain/`            | 經驗證的教材、Reader 投影與穩定識別        |
| `Data/`              | JSON 匯入、SQLite 交易儲存與 Drive adapter |
| `Services/`          | Google 登入、系統朗讀與外部連結            |

資料流由檔案或 Drive 輸入，先驗證成領域模型，再產生 Reader 投影，最後交給 SwiftUI。SwiftUI view 不直接查詢 Drive，也不處理 JSON schema 分支。先用明確的服務與依賴注入，暫不引入額外大型架構框架。

依使用者要求，實作採系統 SQLite。原始 JSON／Markdown 位元組保存在匯入 envelope 的 BLOB，摘要、位置、複習與帳號目錄同存在 Application Support 的 `library.sqlite`。匯入、更新及清理在同一資料庫交易內完成，使用 WAL、外鍵、參數綁定及明確 schema 版本。詳細資料表與恢復規則見 [App README](../apps/ios/README.md)。

明確下載的內容不能當成可隨時清除的 Cache。首版提供逐份移除下載及空間資訊，刪除下載不刪除 Drive 原件。本機匯入資料與 Google 帳號資料分開命名空間。Drive 帳號資料在登出時清除，介面事先說明；本機匯入教材保留。

檔案匯入透過系統 Files picker，僅在讀取期間取得 security-scoped resource 存取權，完成後釋放。驗證成功後複製進 App 自己的目錄，不把外部檔案 URL 當成永久可用的教材儲存位置。

## 先證明 Swift 能正確讀取現有教材

現有核心是 TypeScript 與 Zod。實作設計採建置時打包既有驗證與 Reader 投影，透過 JavaScriptCore 離線執行，再以 `Codable` 解碼成原生展示模型。所有畫面、儲存及互動仍使用 Swift 與 SwiftUI。這取代初版提案中的完整 Swift 驗證器移植，避免維護兩套不斷變動的資料規則。比較與實驗依據見 [實作架構決策](../.audit/ios-ipados-app/architecture.md)。

以下規則是移植的首要驗收條件。

- 標準教材透過與 `readLearningDocument` 對齊的相容判斷讀取。只支援明列的 V7 組合，不能看到 `schemaVersion = 7` 就接受所有 workflow。
- `sourceSpans` 的起訖位置是 UTF-16 code unit offset，且不能切開字素。Swift 的 `String.count` 不等於這個位置。中文、日文、組合音標、旗幟與 ZWJ emoji 都要有對照案例。
- Reader 保留跨字幕關聯、來源分組、解說去重及空欄位隱藏。缺少讀音時省略，不自行猜測。
- 標準教材以 JSON 為準。Drive 自訂教材使用 metadata 與 Markdown 配對，驗證 hash、文件 ID 及 `markdownHash`。本機也允許獨立 `.md`，但將其標成一般本機 Markdown，不冒充既有 `custom-v1` 教材。
- 匯入採檔案大小限制、嚴格 UTF-8、schema 及來源驗證。格式不相容時保留舊教材，顯示可理解的錯誤。
- 自訂 Markdown 支援標題、段落、清單、引用、程式區塊、連結與表格。阻擋 raw HTML、可執行 URL 與遠端圖片。不能只用 `Text(AttributedString)` 就宣稱完整支援既有 Markdown。
- 既有收藏的 hash 涉及 JavaScript JSON 序列化。Swift `JSONEncoder` 的輸出順序不能直接當成相同位元組。即使首版唯讀，仍需跨語言 golden fixtures 驗證 hash 與投影。

相容案例來自現有 core、Web 及 Host 測試，補上 Swift 端的負向案例。錯誤輸入不能因解碼成功而進入教材庫。標準教材的讀取上限先對齊現有 25,000,000 bytes，再以實機記憶體量測調整。

## Drive 下載採原生登入，先保持教材與收藏唯讀

使用 Google Sign-In 的 iOS SDK，透過 Swift Package Manager 管理。建立 iOS OAuth client，設定 Bundle ID 與 URL scheme，沿用現有 Google Cloud project。Web 的 token 登入與桌面 loopback callback 不直接移植。[Google iOS 設定](https://developers.google.com/identity/sign-in/ios/start-integrating)

權限先對齊現有 `openid email drive.file`。`drive.file` 只涵蓋 App 可存取的檔案，不能假設新 iOS client 自動看到全部舊備份。開發早期用真實帳號驗證桌面既有 JSON、Markdown、收藏 operation 與 catalog 的可見性。若看不到，先研究既有 project 設定與明確的檔案授權路徑，不自動擴大為整個 Drive 的權限。[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

登入、Drive 授權、下載與離線閱讀分別呈現狀態。使用 SDK 更新 access token，憑證由 SDK 與系統 Keychain 管理，不存入教材、UserDefaults 或日誌。[Google API 存取](https://developers.google.com/identity/sign-in/ios/api-access)

以帳號識別、文件 ID、kind 與 revision 隔離資料。查詢依既有 `appProperties`，不依可改名的資料夾。目錄不完整、重複文件、hash 不符或自訂內容缺檔時，不用部分新結果覆蓋上一次有效內容。切換帳號或登出要取消工作，過期回覆不能寫入另一帳號。

同步在前景、重新連線或使用者重新整理時進行。首版不承諾 iOS 持續背景同步。雲端新版本下載完成並驗證後才替換舊版本，盡量保留仍存在的場景位置。

## 語音先使用可用的系統能力

使用 `AVSpeechSynthesizer` 讀取教材文字。播放由單一 speech service 管理，避免連點造成無限排隊，離開 session 時依明確規則停止。系統會在裝置上產生語音。[Apple speech synthesis](https://developer.apple.com/documentation/avfoundation/speech-synthesis)

語音選單列出裝置實際可用的 voice，記錄 voice identifier 並處理不可用時的回退。先驗證日文、英文及中文，不承諾能直接使用桌面 macOS helper 的 Siri 語音或下載功能。離線朗讀需有可用 voice，沒有時提示改用閱讀。

## 分四個可驗收階段交付首版

| 階段   | 交付結果                                                  | 進入下一階段的條件                                           |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| IOS-01 | Universal App、跨語言 fixture、檔案匯入、教材庫與可靠儲存 | 標準與自訂教材可匯入，重開後仍可讀，損壞資料不覆蓋舊版       |
| IOS-02 | iPhone 與 iPad 原生 Reader、本機閱讀位置、複習清單與 TTS  | 手機完成一段閱讀與回想，平板縮放視窗後保留位置，實機朗讀正常 |
| IOS-03 | 原生 Google 登入、Drive 唯讀教材及收藏下載                | 真實桌面備份能在兩種裝置下載，飛航模式與強制重開仍可閱讀     |
| IOS-04 | 無障礙、效能、失敗恢復與 TestFlight 候選包                | 支援範圍內的系統與裝置驗收通過，簽署及隱私資料準備完成       |

IOS-03 的 OAuth 與檔案可見性實驗放在 IOS-01 開始前或同時進行，儘早發現整合障礙。完整登入 UI 與下載功能仍在 IOS-03 交付。若 Drive 尚未接通，IOS-01 與 IOS-02 仍提供可用的本機閱讀版本。

估計開發量為 4 至 6 個人週，假設由一位熟悉 SwiftUI 的工程師專注開發、資料契約不大改，且有可用 iPhone、iPad 與 Apple Developer 帳號。這是規劃估算，不是已量測的工期。OAuth 外部審核、商店審核與後續雙向同步另計。先以 IOS-01 的實際完成速度重估，不先鎖定上架日期。

詳細變更邊界、驗收場景及交付條件列在 [執行檢查表](../.audit/ios-ipados-app/implementation-plan.md)。已開始並完成本機首版與可設定的 Drive 接入；四階段的實機、OAuth 與發布條件仍需各自驗收。未建立 PR、排程或發布。

## 後續同步先定義資料語意

雲端收藏寫入沿用 immutable operations、catalog 與 vector clock，並行新增與取消依目前 remove-wins 規則處理。離線新增需要持久 outbox、穩定 writer ID、可重試操作及完整跨語言序列化驗證，不能改成同步單一書籤布林值。

閱讀位置與複習紀錄目前沒有現成的跨裝置協定。後續另訂版本化格式，分開處理目前位置、看過場景、複習事件及排程。先證明時鐘偏差、兩裝置並行及刪除後重連的合併規則，再擴充桌面、Web 與 App。首版不使用 CloudKit 建立另一份進度來源。

AI 生成、Netflix 字幕攔截、YouTube 內嵌、SRS、筆記、Share Extension 與付費功能均為後續候選，不是首版完成條件。

## 現況證據與尚未驗證項目

資料契約入口為 `packages/core/src/schema.ts`、`jobs.ts`、`source-units.ts`、`reader-model.ts`、`favorites.ts` 及 `favorite-catalog.ts`。雲端讀取與相容行為見 `apps/web/src/library.ts`、`repository.ts`、`favorite-writer.ts`、`drive.ts`，以及 `apps/local-host/src/drive/api.ts`。

本機位置的現況見 `apps/extension/src/lib/study-progress.ts` 與 `apps/web/src/shared-reader.tsx`。現有位置資料只在裝置本機，不能以 Drive 備份成功推定位置已同步。

Xcode 27.1 已用於建置。取得模擬器存取權後，已在 iOS 26.5 執行原生測試；目前證據與限制見 [實作紀錄](./ios-ipados-implementation.md)。實機 TTS、最低支援系統、Google OAuth 與桌面 Drive 資料可見性仍待驗證。
