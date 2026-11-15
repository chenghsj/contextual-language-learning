# iOS / iPadOS 首版實作紀錄

2026-10-27 更新。實作位於 [apps/ios](../apps/ios/README.md)，使用 SwiftUI，最低 deployment target 為 iOS / iPadOS 17。這是本機可建置的閱讀／複習首版，尚未發布。

## 已實作

- 教材庫、搜尋與語言篩選、最近閱讀、本機刪除與內容大小。
- Files 匯入標準 V7 JSON、自訂 JSON／Markdown 配對及獨立 Markdown；嚴格驗證後才寫入。
- 原生場景 Reader、翻譯與讀音顯示、解析展開、文字選取、安全來源連結與系統朗讀控制。
- iPad 分欄導覽、Dynamic Type、本機閱讀位置及重開保存。
- 本機複習清單、先回想再揭示答案、逐組閱讀及可重複安全移除。
- SQLite 儲存原始輸入、索引、位置、複習及帳號目錄。匯入與清理使用交易、外鍵及 SHA-256 revision；錯誤寫入回滾。
- 可設定的 Google iOS 登入、前景 Drive 唯讀教材／收藏目錄及下載、離線讀取與登出清除帳號資料。

SwiftUI 渲染與互動、SQLite 及語音均為原生。資料驗證與 Reader／收藏投影沿用建置時打包的 TypeScript core，透過離線 JavaScriptCore 邊界回傳 Swift 模型。沒有 WebView 畫面，也不執行匯入文件中的程式碼。

## 驗證證據

使用 Xcode 27.1。實際 XCTest 在 iOS 26.5 模擬器執行，並非僅以編譯代替操作。

| 檢查            | 結果與證據                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| iPhone 單元測試 | 45 個通過、0 失敗。最終 `/private/tmp/cll-ios-clean-iphone.xcresult`，整包結果成功                                               |
| iPhone 原生操作 | 5 個通過、0 失敗。同一最終 bundle；涵蓋 Files 匯入／取消、橫直向 Reader／解析／Drive 設定、最大 Dynamic Type、複習揭示與重開保存 |
| iPad 原生操作   | 5 個通過、0 失敗。最終 `/private/tmp/cll-ios-clean-ipad.xcresult`，使用同一版操作腳本且整包結果成功                              |
| 契約資源        | `build-contract.mjs --check` 與 `verify-contract.py` 通過，資源及權威來源指紋一致                                                |
| TypeScript 邊界 | `tsc --noEmit --strict` 通過                                                                                                     |
| Swift 格式      | `swift-format lint --recursive --strict` 通過                                                                                    |

iPhone 最終驗證使用新建專用裝置 `A4F951EE-5DE1-4EE4-9792-D2E554F4CEF3`，iPhone 17 Pro／iOS 26.5。原有裝置在方向事件後仍保持直向，新裝置的同一 App 可通過實際視窗尺寸斷言；未改動原裝置的系統偏好。修改操作腳本後曾觀察到 runner 繼續執行舊流程，移除並重新安裝 runner 後才確認新版腳本執行。原始失敗紀錄保留，最終綠燈結果以 `clean-iphone` bundle 為準。

實際 iPad 測試 App 重開後，以唯讀 SQLite CLI 核對 `user_version = 1`、`journal_mode = wal`、`quick_check = ok`，且 documents、materials、positions、review 各有一列。讀回證據見 [sqlite-readback.txt](../.audit/ios-ipados-app/sqlite-readback.txt)。這個小型範例不能代表大型資料庫效能。

單元測試分為 Contract 7、Drive transport 16、Favorite contract 4、Google authorization 4、Library repository 12、SQLite 2。逐項通過紀錄與最終檔案 SHA-256 見 [verification.json](../.audit/ios-ipados-app/verification.json)。

單元測試計數是 XCTest methods；43 筆契約 corpus 在其中一個測試逐筆驗證，不另加總為 XCTest 數量。Drive 測試使用受控 transport／回應，不代表真實帳號已接通。

獨立正確性審查由 `gpt-6-astra` 檢查 `/private/tmp/cll-ios-review-20261026/ios`，並於修正快照 `/private/tmp/cll-ios-fixreview-20261026/ios` 複查。其兩項 P2 已修正：TTS 停止／閒置時釋放 audio session；複習刪除改用冪等 SQL DELETE，重複刪除不會重新加入。複查同時確認空 BLOB、內嵌 NUL 與位置清理修正。另一個獨立註解審查已完成，移除一處無助理解的註解。2026-10-27 的最後增量亦經獨立審查，檢查 DEBUG 範例檔注入、Files Documents 暴露設定及場景選單 binding，未提出具體問題；模擬器驗證另行記錄。

## 尚待外部條件與裝置驗收

使用者尚未建立 iOS Bundle ID 與 Google iOS OAuth Client ID，依授權先交付可設定的接入。預設設定頁清楚顯示 Drive 尚未設定。設定方法見 [App README](../apps/ios/README.md#configure-google-drive)。真實登入、權限同意、桌面既有備份／收藏可見性及跨裝置下載仍未驗證。

實機朗讀、音訊路由／中斷、VoiceOver 手動操作、最低 iOS 17 執行及大型真實教材記憶體量測仍未驗收。模擬器大字級／旋轉不能取代這些證據。

尚未設定正式 App icon、production signing，亦未建立 TestFlight／App Store 候選包。沒有發布、提交 PR 或更動真實 Drive。SRS、雲端收藏寫入、跨裝置進度、AI 生成與內嵌影片均不在首版交付範圍。

## 畫面證據

畫面使用隨 App 附送的範例教材，不含真實 Google 帳號資料。閱讀圖為橫向畫面，PNG 的方向 metadata 可能影響部分預覽器；複習圖為直向。

- [iPad 分欄 Reader](./quality/ios-ipados/initial/ipad-reader.png)
- [iPad 複習揭示答案](./quality/ios-ipados/initial/ipad-review.png)
- [iPad 大字級 Reader](./quality/ios-ipados/initial/ipad-large-type.png)
- [iPhone 大字級 Reader](./quality/ios-ipados/initial/iphone-large-type.png)
- [iPhone 複習揭示答案](./quality/ios-ipados/initial/iphone-review.png)

## 2026-11-01：iPad 分割視窗與逐句影片播放

教材載入改由 `MaterialLoadModel` 持有讀取工作，避免 compact navigation 取消畫面任務後丟棄結果、永久停在「正在開啟教材」。相同教材的重入會沿用工作，重試及切換教材會隔離過期結果。

場景與原始字幕的時間按鈕，現在預設於 App 內的 YouTube IFrame API 播放器播放；複習頁沿用相同控制。每次點擊都發送新的播放請求，對相同影片明確呼叫 `seekTo`，並沿用原有時間校正投影。播放器保留「在 YouTube 開啟」、關閉及失敗重試。進入背景或離開頁面會暫停，未允許嵌入的影片可使用外開。

實機 iPadOS 27.0.1 已確認半寬教材重入、相同時間重播及不同句子跳轉。原生 YouTube App 對同一影片後續時間連結的處理由它自行控制，因此可靠逐句跳轉使用 App 內播放器。此變更未調整 Google OAuth、SQLite 格式或 Extension/Web 播放行為。驗證紀錄位於 `.audit/ipad-multitask-fixes-20261101/verification.md`。

### 自適應播放器與固定場景選單

播放器改以實際內容區域的寬高配置：窄視窗上下排列並限制影片高度，寬視窗或較矮的橫向畫面採影片／原文並排。使用 AnyLayout 保留播放器與閱讀狀態，不再把整個影片放進頂部 safeAreaInset。閱讀與複習共用此配置。

「切換場景」固定在頂部導覽列，顯示目前場景名稱，捲動原文或開啟影片時仍可操作。實機 iPad 全螢幕、半螢幕及切換場景已驗證；詳細測試與另列的 Files 選檔測試限制見 `.audit/ipad-player-layout-20261101/verification.md`。

### 可調整分欄與語音比較

影片／原文並排時可拖動中間把手調整寬度，記住比例；點兩下恢復預設。原文保留最低閱讀寬度，窄視窗仍上下排列。模擬器已驗證拖曳、重開後比例保存、場景切換及複習。

設定頁列出 App 實際可取得的語音、語言與品質，提供試聽。最初直接選取 O-ren 標準版未達成系統 Speak 同聲的需求，當時紀錄見 `.audit/ipad-resize-speech-20261101/verification.md`；此限制已由下述 2026-11-02 實機調查與修正取代。

### 2026-11-02：沿用系統 Speak 的朗讀設定

使用者已在 iPad 本機確認「指定教材語言的預設語音，並開啟 prefersAssistiveTechnologySettings」的試聽有聲音，且與其日文 Siri Voice 2／系統 Speak 相同。閱讀、複習與設定試聽共用此流程，App 不再把實際覆寫後的聲音標為 O-ren 或 Kyoko。

先前完全不指定語音的日文近乎無聲，可由實機 PCM 重現；英文對照正常，因此保留明確的教材語言是必要條件。僅把輔助設定旗標加到明確選取的 O-ren 也未得到相同候選輸出。這次符合的是此 iPad 實際設定與使用者聽感，不保證所有系統版本或所有聲音同樣可用。完整對照、音檔及最終 57 項單元測試與設定頁 UI 驗證見 `.audit/ipad-siri-voice2-20261102/verification.md`。

### 語音與語速統一由輔助使用管理

依使用者確認的設計，App 已移除手動聲音、App 語速與其偏好讀寫，所有朗讀一律沿用系統輔助使用設定。原先儲存的全域聲音與語速不再影響任何教材，避免切到英文時仍套用日文聲音。

設定頁保留管理方式說明、14 種學習語言的試聽選單與系統設定操作指引；試聽語言僅影響試聽，閱讀與複習仍使用各自教材的語言。教材語言保留地區代碼，未標示語言時顯示提示，避免默認英文。未加入私有系統設定 URL。

驗證通過 57 項單元測試與 iPad、iPhone 各 1 項原生 UI 測試，包括跨語言與地區、舊語音偏好不干擾，以及日文／英文試聽切換。新版已在實機 iPad 原地安裝並成功啟動，教材保留。各語言與系統 Speak 的實際聽感仍只驗收了先前的日文；其他語言的 UI 與語言傳遞驗證不等於逐語同聲驗收。詳細紀錄見 `.audit/ios-system-managed-speech-20261102/verification.md`。

## 2026-11-02：分欄拖曳與影片縮放回歸修正

寬畫面的影片不再套用窄視窗的 200–300 點高度上限；拖動分隔線時會隨欄寬放大，僅在可用高度不足時限縮。窄視窗仍保留原本的影片高度限制，避免擠掉閱讀內容。

拖曳改用固定容器座標與自動清理的 GestureState，並為分隔線及兩側內容加入背景與裁切，避免移動過程的重疊殘留。保留同一個 WKWebView、時間跳轉、外開、比例保存與點兩下重設。模擬器已目視確認大幅拉寬和縮回的影片畫面、單一分隔線；最終實機驗收仍需解鎖 iPad。

場景選單移至左側工具區，限制長標題寬度；閱讀設定保留在右側。保留原生分頁與既有導覽結構，全螢幕系統分頁／導覽列仍是兩排，並未宣稱消除這一排高度。詳細測試與安裝狀態見 `.audit/ipad-divider-fix-20261101/verification.md`。

### 直立與窄區域的影片位置

並排條件現在同時要求實際內容區域夠寬且寬大於高，修正直立 iPad 收起教材側欄後仍將影片留在左側的問題。直立或窄區域改為上方影片、下方原文；適合的橫向寬區域才左右排列。保留同一播放工作階段及既有分欄比例。

新增「直立＋側欄收起」的失敗重現與回歸測試，並將原本只檢查不重疊的測試改為明確檢查上下或左右位置。Simulator 已驗證直立／橫向／轉回直立、窄複習頁、拖曳及閱讀位置；新版已更新至 iPad。詳細驗證邊界見 `.audit/ipad-portrait-player-20261102/verification.md`。

### 單一穩定教材列表

教材庫移除重複的「繼續閱讀」區，每份教材只保留一個入口，點選後沿用原有閱讀位置。列表維持既有匯入順序，閱讀進度與「上次閱讀」在同一列原位更新；未讀時顯示「尚未開始」，預留相同的進度行與標記空間，避免第一次閱讀後增加列高。

iPad 原生 UI 測試確認首次閱讀及切換複習後返回時，教材只有一列、位置與高度穩定，選取狀態保留；iPhone 確認返回列表、再次開啟、重開 App 的續讀。兩個平台的既有閱讀／複習／重開回歸亦通過。iPhone 首次返回會收起原生搜尋列，因此該項驗證使用教材相對於列表區段的位置，另檢查後續返回的絕對位置。新版已原地安裝至實機 iPad 並成功啟動；實機操作動畫與 VoiceOver 焦點尚未驗收。詳細證據見 `.audit/ios-library-stability-20261102/verification.md`。

### 片段播放模式

播放器提供模式選單、起訖時間、重播與播放／暫停控制。模式選單只顯示文字與系統勾選，不使用容易誤解成影片或播放清單的裝飾圖示。每個閱讀或複習工作階段預設「播放一次」，播到選定句子或場景的結束時間即暫停並保留畫面；「重複此片段」在片段間停頓 0.5 秒後重播；「繼續播放影片」則繼續同一支影片的後續內容。模式切換不會自行重播或恢復暫停的音訊，下一個片段沿用本工作階段選擇的模式。

原生投影現在保留既有校正規則算出的 endMs，開始與結束均以毫秒傳遞，不再把 App 內的開始時間取整秒。舊複習快照若沒有有效結束時間，仍可播放，但會在選單內說明缺少結束時間並停用「播放一次／重複此片段」；從教材重新加入複習可取得完整時間範圍。沒有資料庫遷移或改寫使用者舊紀錄。

切換到不同場景、下一個複習項目或關閉播放器會結束原片段；離開畫面／進入背景會暫停並取消待重播工作，返回後由使用者恢復。低高度畫面的播放器面板可獨立捲動以取得控制，不縮小到 YouTube 的最小視窗尺寸以下。外開 YouTube 保留，但 App 的片段模式僅控制內嵌播放器。

原生單元、投影、控制器及真實 YouTube UI 驗證詳見 `.audit/ios-segment-playback-20261102/verification.md`。YouTube IFrame 的時間回報、跳轉及暫停不是逐影格精準控制，不宣稱完全沒有句尾誤差。

### 可設定主題與外觀

「設定」首頁直接提供主題與外觀：跟隨系統／淺色／深色，以及暖陶／海藍／森綠／經典靛藍配色選單，不再開啟獨立子頁。預設為海藍、跟隨系統，以本機 UserDefaults 保存；缺少或未知值顯示安全預設，合法選擇保留。右上角「重設外觀」只恢復這兩個偏好，不變更教材、文字大小、語音或進度。

依使用者確認的方向，頁面改為中性灰白／深灰，移除米黃與棕灰底。主色僅用於操作與少量狀態；主要播放鍵較突出，次要控制保持中性，翻譯與必要狀態使用可讀的文字色。設定內容最大寬度 720 點並置中，窄視窗沿用可用寬度。

原先原生側欄以主色填滿選取列，與自訂灰字衝突，已改用柔和選取表面與明確的標題、語言和進度文字色。側欄具有獨立底色，與右側閱讀區分層；仍保留原生 NavigationLink 選取、續讀和鍵盤操作。教材與複習的移除滑動按鈕明確使用原生破壞性角色與紅色。

完整驗證、配色對比、主動選取畫面及實機安裝結果見 .audit/ios-theme-settings-20261102/verification.md。
