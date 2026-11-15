# 系統朗讀

閱讀器透過既有 Extension → Background → Native Host 通道呼叫作業系統語音。
macOS 13 以上透過 `macos-speech` 呼叫 Apple `AVSpeechSynthesizer`；Windows 的實驗性 Narrator 後端使用 Windows PowerShell 5.1 與 SAPI COM，透過另行安裝的相容 NaturalVoiceSAPIAdapter 呼叫本機自然語音。Apple Silicon／macOS 26+ 另提供 Siri 專用後端。
朗讀在本機執行，Siri 聲音資源由 macOS 下載；沒有瀏覽器 speechSynthesis 或雲端 TTS。

- 原句右側的喇叭朗讀完整原句；V6 完整原句可跨多行字幕。播放三角形仍操作影片原音。
- 選取語塊的解析提供片語朗讀；非連續 spans 依保存的來源順序組合。
- AI 延伸例句提供每句朗讀與整段對話朗讀，使用 `dialogue[].text`，不念翻譯、情境文字、假名或音標標註。
  整段朗讀依例句的 dialogue 行逐句送出，每句完成後等待 0.5 秒再送出下一句；不按文字內部換行拆句，最後一句後不追加等待。
  等待期間仍顯示停止控制，停止、換場景、切換朗讀或關閉閱讀器會取消後續句子。
  此節奏由 Extension 管理，沿用現有 Native Host 朗讀請求，原字幕群組的 300ms 停頓保留。
- 「設定 → 一般 → 系統朗讀」提供各語言的聲音選擇、速度、試聽與重新整理。
  朗讀語言選單獨立於教材生成的學習語言清單，包含繁體中文與簡體中文。
  明確選擇區域語言時只使用同區域語音（zh-TW／zh-CN）；沒有高品質聲音時不跨區域回退。
  只提供該語言實際可用且標示為 neural、enhanced 或 premium 的聲音；基本及未分類聲音不列入選項。
  沒有高品質聲音時隱藏聲音、速度、試聽控制，只保留語言選擇、重新整理與提示，
  不回退基本聲音或其他語言。
  Windows 只列出來源標記為 `Narrator;Local` 的橋接聲音，不以聲音名稱猜測品質，也不列出 Edge／Azure 雲端來源。
  macOS 以完整 `AVSpeechSynthesisVoice.identifier` 辨識聲音，保留系統品質 metadata；
  neural 標示來自 identifier 中的 neural 家族名稱，不代表保證與 Siri 完全同聲。
  依朗讀語言選擇後端：該語言已有可用的高品質 Siri 聲音時，朗讀選單只列 Siri；
  否則使用一般介面的高品質聲音。各後端內仍依 neural、premium、enhanced 排序，
  保留明確選擇的有效聲音。未安裝的目錄聲音不進入朗讀選單。
  Apple `gryphon-neural` 公開識別碼若能對應已確認的 Siri 資源 ID，會保留為選單別名，
  因此「聲音1／2」的舊偏好可繼續選中 Chenghan／Shufen，不改寫偏好或語速。
  無法確認對應時依自動選擇規則處理，不以顯示名稱猜測聲音身份。
  以前保存的基本聲音也不再用於閱讀器朗讀，改選可用的高品質聲音或顯示不可用。
  未提供可辨識本機 Narrator 來源的 Windows 聲音仍不進入閱讀器選單。
  舊版 `say` 的名稱偏好不再匹配時，自動採用新版優先順序，不以名稱猜測同名變體。
  同名、同語言已有 compact 時隱藏 super-compact，避免重複選項。

設定頁與教材共用語音可用狀態：首次進入先查詢系統語音；不支援的平台或
macOS 13 以下只顯示說明，隱藏朗讀控制。教材原句、語塊、例句和整段對話的
喇叭只在該語言有合格聲音時出現；原影片播放及文字發音標示保留。
語音查詢失敗或通道中斷顯示本機服務恢復提示與重試入口；重試成功會恢復控制。
單次音訊播放失敗不會撤銷已確認的語音能力。Siri 下載／資源管理入口只在
Siri 目錄可用時顯示，與一般 macOS 朗讀能力分開判斷。
`speechVoices.supported` 為選用的相容欄位；舊 Host 未提供時仍依查詢結果處理，
因此完整的平台／版本辨識需要更新 Host JavaScript。
目前 `listSpeechVoices` 一次回傳所有語言，仍查詢一般介面來取得其他語言及 Siri
不可用時的備援。設定、教材按鈕與實際朗讀選擇共用同一個按語言選擇後端的函式，
不將 Siri 可用語言的公開介面聲音混入選單。下載目錄與資源管理不受此呈現規則影響。

新朗讀會停止上一段；換場景、離開閱讀器或關閉頁面會停止對應朗讀。
朗讀前暫停可控制的影片，操作閱讀器影片控制或偵測到影片恢復播放時停止朗讀。
沒有影片連線仍可朗讀。朗讀停止後不自動恢復影片。

整組原句的朗讀在每條原字幕之間加入約 300ms 停頓；字幕內的換行、原字與標點保留。
Extension 使用 Unicode paragraph separator（U+2029）標示字幕邊界，不按畫面折行切斷句子。
macOS AV 語音以 [preUtteranceDelay](https://developer.apple.com/documentation/avfaudio/avspeechutterance/preutterancedelay) 排程各段；檔案驗收另寫入等長靜音。
Siri 逐段合成後在同一音訊中插入 300ms PCM 靜音，Windows 實驗後端以固定 SAPI `<silence msec="300"/>` 加入停頓；教材文字使用 `SVSFIsNotXML`，不解析為 XML。
每次仍是單一可停止的朗讀請求，不在最後一條字幕之後追加停頓。這項行為需要新版語音 helper。

Native Messaging 協定目前為 **12**，Extension 和 Native Host 必須一起更新。
新增 `listSpeechVoices`、`speak`、`stopSpeech` 請求及 `speechVoices`、
`speechFinished`、`speechStopped` 回覆。停止以 speech request ID 定位，Background 驗證頁面所有權。
語音服務與 AI 生成佇列分開；關閉頁面只停止語音，不中斷生成工作。

### Windows Narrator（實驗性）

此整合需另行安裝與執行 Host 位元架構相符的 **NaturalVoiceSAPIAdapter** 及相容的本機 Narrator 自然聲音包；不是直接控制 Narrator 視窗。
不需要申請 Azure Embedded Speech，但安裝最新版 Windows Narrator 聲音並不保證橋接可用。
上游目前說明最新 Store 聲音包不相容，安裝或系統更新後可能失效；沒有可用聲音時不回退基本或雲端語音。
[設定與相容性](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter)、[聲音包版本限制](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/wiki/Narrator-natural-voice-download-links)。

Host 以 SAPI token 的 `NaturalVoiceType=Narrator;Local` 識別來源、讀取 `Locale`，回傳 `engine: narrator`、`neural: true`、`installed: true`。
這個標記代表引擎家族與來源，不代表已經試聽驗收。`Edge;Cloud`、`Azure;Cloud` 與未知來源全部排除。
聲音 ID 為 `narrator:<完整 SAPI token ID>`；每次播放重新列出本機 tokens，核對 ID 及區域語言再指定，避免同名線上聲音被誤選。
所有文字經 JSON stdin 傳遞，以 SAPI 的 literal-text flag 合成。只有程式固定的停頓字串使用 XML，不解析教材提供的標籤。
播放失敗會顯示實驗語音的恢復提示，停止仍以終止單一語音程序處理。

橋接元件枚舉聲音時本身可能查詢線上來源；要讓查詢也離線，請在橋接設定中關閉 Edge 與 Azure online voices。
本專案不自動安裝橋接元件、不修改其登錄設定、不下載或隨產品散布舊 MSIX／模型／金鑰。
目前沒有 zh-TW 自然聲音的可用保證，zh-CN 不會代替 zh-TW。

`speechVoices.experimentalBackend: windows-narrator` 為可選能力欄位，沒有任何合格聲音時也會回傳，
讓設定頁顯示燒杯圖示、「實驗性」文字、缺少聲音狀態及設定連結。每個 Narrator 聲音選項也標示實驗性。
欄位缺少時保留既有介面；Extension 與 Host 應一併更新以辨識新增的 engine 值。

Windows 實機可執行以下工具：先完成相容聲音安裝，再斷網執行嚴格模式，使用未快取的新文字合成非靜音 WAV。
工具只寫暫存音檔，不播放喇叭，也不取代已安裝 Extension 的端到端操作驗收。
一般模式無聲音會明確回報跳過；`--require-voice` 缺少聲音則失敗，不能把跳過當成功合成。

```sh
node --import tsx apps/local-host/scripts/windows-narrator-smoke.ts --require-voice --language ja
node apps/extension/scripts/windows-narrator-acceptance.mjs
```

此輪在 macOS 驗證 mock Host 的 320／480px 淺色／深色介面、空清單、選音、失敗與停止，以及注入程序測試與型別／建置。
既有 `speech-acceptance.mjs` 停在舊版閱讀器的收合解析 DOM 斷言（期待 0，實際 2），未全數通過；沒有修改閱讀器或該舊腳本。
新增驗收另外確認現行閱讀器在朗讀前後都是 2 個解析區塊，且非 Windows 模式不顯示 Narrator 實驗標示。
已設定 Windows CI 執行真實 SAPI 查詢，尚未於本輪執行該 CI；runner 沒有相容聲音時會回報跳過合成。尚未驗證 Windows 實機自然語音、斷網合成或人耳音質。

### Siri 聲音目錄與下載

朗讀設定保留語言、聲音、速度與試聽，透過「管理 Siri 聲音」進入設定子頁。
子頁預設篩選目前朗讀語言，也可切換「所有語言」；「已下載」與「可下載」分頁分開呈現。
「已下載」每列提供試聽與停止，使用該聲音語言的範例句與目前語速，直接指定該列聲音，
不改寫朗讀偏好，也不在聲音不可用時改用其他聲音。尚無法朗讀或沒有範例句的資源停用試聽。
切換語言、分頁、重新整理、開啟刪除確認或離開子頁會停止試聽；播放失敗在該列顯示提示。
目錄透過 `listSpeechVoiceCatalog` 查詢；在「可下載」展開聲音並按「下載」才傳送
`installSpeechVoice`。下載請求被接受後，
UI 以 `getSpeechVoiceInstallation` 查詢最多五分鐘；本地資源能提供合成識別，
或本地可用目錄與 Siri daemon 都回報可用時，顯示安裝完成並重新整理朗讀清單。
確認安裝完成後切換到「已下載」。逾時或離開子頁會停止 UI 輪詢，但不取消 macOS 的下載。
返回一般設定會恢復原本捲動位置，並將鍵盤焦點放回管理入口。
下載清單排除 `resourceAvailable` 為 true 的資源，即使舊 helper 尚未辨識為可朗讀。
Host 及 helper 也會重新檢查本地資源，拒絕因辨識失敗而重送下載訂閱。
helper 對已確認存在的實體資源回傳 `resourceId`；Host 依 Siri 引擎、語言及
資源 ID 合併目錄別名，優先保留符合實體技術的聲音。朗讀選單、下載檢查與
資源管理共用這份對應。原始目錄 ID 保留於 `aliases`，舊偏好及 API 請求
仍可使用，不強制改寫使用者設定。無法確認資源 ID 時不以顯示名稱猜測合併。
查詢失敗／平台不支援會顯示不可用，既有 AVFoundation 朗讀仍可使用。

### 已下載 Siri 資源管理

「管理 Siri 聲音」的「已下載」分頁列出符合語言篩選的本地 Siri 資源。
聲音列展開後才顯示開啟資料夾與刪除操作，背景、焦點外框與操作按鈕保留間距。
`resourceAvailable` 依實體 manifest 判定，與可提供合成識別的 `installed` 分開，
讓仍占空間但尚未能朗讀的資源也能管理。
「開啟資源資料夾」傳送 `openSpeechVoiceFolder`，helper 依聲音的系統 manifest
解析確切 `.asset` 資料夾（fmvoice 可映射到其 natural 資源），Host 驗證真實路徑
位於 UAF Siri `purpose_auto` 根目錄且具有 Info.plist／AssetData，再交給 Finder。
不將系統資源加入教材資料夾的寫入授權，也不接受 Extension 提供任意檔案路徑。

「刪除下載資源」需確認所選聲音，才傳送 `removeSpeechVoice`。
只對可定位且 TTSAsset 標記 purgeable、MobileAsset selector ABI 符合的資源開放。
helper 經 MobileAsset 移除單一聲音的資源，不直接刪除受保護的系統檔案；
最多等待十五秒，確認原 AssetData 已不存在才回覆成功，之後刷新朗讀／下載清單。
訂閱保持不變，因此 Siri 或其他程式仍使用此聲音時，macOS 可能重新下載。
確認介面會提醒這是共用系統資源。私有 API 不可用或拒絕移除會顯示失敗。

2026-10-11 已在本機定位 Aaron 的實際 UAF 資料夾並通過路徑驗證；
320／480px 預覽測試確認跨語言管理、開啟請求、取消刪除與模擬成功／失敗。
未刪除任何真實 Siri 資源；真實刪除及已安裝擴充功能仍待使用者操作驗收。
這些新增入口需一併更新 Extension、Host JavaScript 和 Siri helper。

此後端參考 siri-tts-cli，透過私有 `SiriTTSService` 查詢、訂閱和合成；
不把 Siri ID 交給公開 AVSpeechSynthesizer。只接受已識別的 `neural`、
`neuralAX`、`natural`、`fmvoice` 家族，排除 vocalizer 等舊技術。
這是系統技術分類，並非人耳音質評分。Siri ID 使用 `siri:<catalog identifier>`，
與公開介面的 ID 分開。PCM／Opus 回呼經轉換後播放；停止會取消 daemon 請求並結束 helper。
私有介面變更或程序崩潰不會讓 Native Host 一起崩潰。

2026-10-10 在這台 Apple Silicon／macOS 27.0.1／Xcode 27.0 的沙箱內驗證：
helper 成功編譯；受限查詢僅回傳 11 個 en-US／en-GB 的 fmvoice 聲音，
不能據此推論實際系統只提供英語。2026-10-11 在實際系統環境查到 98 個目錄項目，
包括日語 Hattori、Hiro、O-Ren、Sakura，以及繁體、簡體中文聲音。
fmvoice 的下載大小未提供，UI 不顯示虛構大小。

2026-10-11 真實下載診斷發現，未嵌入 Info.plist 的命令列 helper 雖能查詢目錄，
訂閱會被 `SiriTTSService.TTSError:1` 拒絕，原因為 missing bundle identifier。
建置現在將穩定的 `CFBundleIdentifier` 嵌入 Mach-O `__TEXT,__info_plist`；
不需要把 helper 改成 .app 或在安裝目錄另放 plist。
補上識別後，Aaron 的真實訂閱已獲 macOS 接受並完成下載。
另外修正 UAF manifest 的 `ttsContentVersion` 字串解析，避免下載後仍誤判未安裝；
macOS 27 的 fmvoice 訂閱若安裝對應 natural UAF 資源，會以其實體檔案與 daemon
識別確認安裝，合成時使用該已安裝的 natural 聲音，回覆保留原來的目錄 ID。
已實際驗證 Aaron 回報 installed，並合成固定英文測試句到 48kHz 單聲道 WAV
（128070 frames，約 2.67 秒，PCM 非靜音）；未以人耳評分音質。
後續查到 macOS 27 的 `downloadedVoices` 不一定包含已有 UAF 資源的聲音：
Catherine 資源版本 5050 已存在，但 daemon 沒回報其 natural 聲音。
helper 現在可依已驗證的實體 manifest、語言、技術、性別及內容版本建立合成識別，
不透過 subscribe 重新下載。fmvoice 別名使用對應 natural 資源的實際版本，
而非目錄的版本 0。Catherine、Aaron 及 Aaron fmvoice 別名皆已實際合成非靜音 WAV；
測試前後 UAF manifest 清單及內容一致。這項檢查證明合成可行，未以人耳評分音質。
本機目錄另確認 Aaron／aaron 與 Nora／nora 各自共用一個 natural 資源 ID；
98 個原始目錄項目合併為 96 項。320／480px 模擬 Host 驗收確認各顯示一次，
舊偏好仍選中正確聲音並保留語速，資源管理也不重複列出。未測試真實資源刪除。
其他語言未逐一測試下載。接受請求仍不等於安裝完成。
下載拒絕及逾時以有限的錯誤代碼回傳，介面提供對應提示，
不把任意系統錯誤文字或本機路徑送進擴充功能。

語音偏好存於 `preferencesV2.speech`，缺少欄位的舊偏好保持相容。
不改教材 V5/V6、checkpoint 或備份格式，不預生成或保存音檔。
macOS 1× 使用 Apple 的預設語速，倍速乘上預設值並限制在系統支援範圍；Windows 換算為系統速度刻度，實際速度依聲音而異。
文字經 stdin 傳入，不插入 shell 或 PowerShell 程式碼；Windows 使用固定腳本與 JSON stdin。

## 驗證

```sh
node --import tsx --test packages/core/src/speech.test.ts apps/local-host/src/platform/speech.test.ts apps/local-host/src/platform/siri-speech.test.ts apps/extension/src/native/speech-controller.test.ts
node apps/extension/scripts/speech-acceptance.mjs
node --import tsx apps/local-host/scripts/speech-smoke.ts
node apps/local-host/scripts/subtitle-speech-acceptance.mjs
```

預覽使用模擬 Host；檢查 320px／480px、跨字幕原句、例句、停止與完成、錯誤、影片暫停、聲音／速度儲存與缺少聲音。
也檢查 Siri 目錄、下載中狀態，以及安裝確認前不出現於朗讀選單。
另檢查繁體中文只列 Chenghan／Shufen、舊公開介面偏好仍選中 Shufen、日語可使用
一般介面備援，Siri 消失後可恢復公開介面，以及基本聲音不進入選單。
Mac smoke 使用實際 `AVSpeechSynthesizer` 合成英文與日文到暫存 WAV，檢查唯一 ID、品質選擇與程序停止；不播放喇叭。
字幕停頓驗收使用實際 macOS AV／Siri helper 產生兩段單句與組合 WAV，比較音訊長度並確認靜音段，不播放喇叭。
Windows 路由、輸入安全與取消由注入程序測試驗證，仍需 Windows 裝置驗證。
這些檢查不等於已安裝擴充功能／Native Host 的端到端驗收。

Windows API 依據：[SAPI SpVoice](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms723602(v=vs.85)>)、[Speak 與 XML／literal flags](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms723609(v=vs.85)>)。來源標記依據：[NaturalVoiceSAPIAdapter token 建立程式](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/blob/master/NaturalVoiceSAPIAdapter/VoiceTokenEnumerator.cpp)。

## 建置與安裝

Swift 原始碼在 `apps/local-host/src/platform/macos-speech.swift`。
macOS 的 `pnpm build` 編譯 arm64／x86_64 universal binary 到 `apps/local-host/dist/macos-speech`，
並放入同版 `macos-speech.swift`。基本朗讀不需要 Swift／Xcode。
若 `xcode-select -p` 指向已安裝且可執行的 Apple Swift 工具鏈，Host 以 Apple 的 Swift 執行同版原始碼。
這台 Mac 的實測中，該方式列出並成功合成 neural 語音；一般編譯程式得到的聲音清單會過濾這些語音。
這不是保證所有 OS／工具鏈版本都能使用 Siri；僅標示實際列出的聲音，不硬寫 Siri ID。
不呼叫會彈出安裝提示的 Swift stub，不安裝或下載工具；工具鏈不可用時改用編譯版。
第一次使用解譯路徑會建立安裝目錄下的 `speech-module-cache`，之後重用模組快取。
安裝器將它與 `native-host.mjs` 放在同一個安裝目錄；版本化安裝則同放在 `native-host/versions/<revision>/`。
Host setup ZIP 包含 `dist/macos-speech` 和 `.swift`，revision hash 同時涵蓋兩者，更新不會沿用舊 helper。
CI／Release 先在 macOS runner 編譯，再交給 Ubuntu 的跨平台打包流程。
缺少 helper 會在寫入註冊前報錯，不靜默退回 `say`。

Siri 原始碼位於 `apps/local-host/src/platform/siri/`，上游版本與 MIT 授權見
`UPSTREAM.md`、`LICENSE`。macOS 26+ SDK 建置時另編譯 arm64 的
`dist/macos-speech-siri`，附帶 `.LICENSE`；舊 SDK 不產生此可選後端。
Host setup ZIP、安裝器與版本 revision hash 均包含此 helper 與授權；
安裝後與 `native-host.mjs` 同目錄，更新依完整 bundle revision 切換。
執行 Siri 後端不需要 Xcode。Intel Mac／舊 macOS 使用既有一般語音後端；Windows 使用前述實驗性 Narrator 後端。
