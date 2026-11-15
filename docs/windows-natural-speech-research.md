# Windows 離線自然語音可行性

> 後續實作：使用者選擇將 Narrator 作為實驗功能。現已加入需另行安裝相容 NaturalVoiceSAPIAdapter 的本機 token 整合與實驗標示；尚無 Windows 實機合成驗證。以下保留選型時的研究結論，最新行為與驗收見 [系統朗讀](./system-speech.md#windows-narrator實驗性)。

查核日期：2026-10-16。**Windows 有可離線使用的 Narrator 自然語音，但本輪未找到可穩定承諾給一般第三方應用的公開存取路線；目前不能宣稱本專案已支援 Windows 自然語音。** 正式支援建議先評估額外下載的離線模型，確認語言、音質與散布條件；內建聲音保留為實驗候選。[官方離線說明](https://blogs.windows.com/windows-insider/2023/06/08/announcing-windows-11-insider-preview-build-22621-1835-and-22631-1835/)、[WinRT API](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer.allvoices?view=winrt-26100)

初次研究僅新增本文；後續實作另見上方註記。沒有下載語音包、安裝 adapter 或變更 Windows 設定。
需求已確認為「離線自然語音」；使用者對內建或額外模型尚無技術偏好結論。本文件提出工程建議，尚未選定或加入模型。
以下把官方事實、維護者說明與本專案的工程建議分開。

## 專案現況

查核工作目錄：`/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`，
HEAD `21969bc52c1ca59bf2779a8749c03b62a77650b4`，包含未提交工作；HEAD 不是完整實作快照。

- [Windows 後端](../apps/local-host/src/platform/speech.ts) 使用固定 PowerShell 腳本與 `System.Speech`；`GetInstalledVoices()` 只回傳 ID、名稱及語言，沒有品質證據。
- [閱讀器選音規則](../packages/core/src/speech.ts) 只接受 `neural`、`enhanced` 或 `premium`，所以目前未分類的 Windows 聲音會被排除。這不等於 Windows 沒有語音或所有 SAPI 聲音都不能使用。
- [現行規格](./system-speech.md) 要求 zh-TW／zh-CN 不跨區域回退，也不回退基本或未分類聲音。單純放寬篩選不能滿足自然語音目標。
- `SystemVoiceSchema.engine` 研究當時只有 `siri`／`av`（後續實驗整合新增 `narrator`）；[Host 語音路由](../apps/local-host/src/host/speech.ts) 和平台服務已有查詢、播放及停止邊界，可作未來整合切點。

## Microsoft 提供哪些能力

| 路線                           | 已查證事實                                                                                                                                                                                              | 對本案的判斷                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Narrator 自然語音              | 官方說明為裝置端 TTS，下載後可無網路使用。[來源](https://blogs.windows.com/windows-insider/2023/06/08/announcing-windows-11-insider-preview-build-22621-1835-and-22631-1835/)                           | 符合離線方向，但 Narrator 能用不代表 Native Host 可用。                             |
| 公開 WinRT `SpeechSynthesizer` | `AllVoices` 列出已安裝聲音，限 Microsoft 簽署聲音；聲音具有國家／區域語言。[來源](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer.allvoices?view=winrt-26100) | 文件未承諾 Narrator natural 會出現在此集合；改用 WinRT 是實驗，不能先承諾自然音質。 |
| Azure Embedded Speech          | 官方離線合成 SDK，需另下載模型／聲音及模型授權；目前 Windows 要求為 Windows 11+、x64／Arm64。[來源](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/embedded-speech)                 | 是官方候選，但不是直接使用 Windows 已裝 Narrator 聲音。                             |

Embedded Speech 為 Limited Access，須登記且限定用途；官方目前只允許與 Microsoft 帳戶團隊直接合作的受管理客戶申請。
因此不能把一般 Azure 訂閱或可安裝 SDK 當作已取得模型、使用及散布資格。[存取條件](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/embedded-speech/limited-access-embedded-speech)

本輪結論不是「Windows 絕對沒有其他 API」；只表示上述公開文件不足以證明一般 Native Host 能穩定使用 Narrator 自然聲音。
如果實驗發現可用，也必須記錄 Windows build、API、聲音包版本和授權依據，避免將單機結果泛化。

## 繁體中文的界線

官方 Narrator 自然聲音表列出的中文為 Xiaoxiao／Yunxi，日語為 Keita／Nanami，英語則有多個區域。
一般 TTS 表雖列出台灣中文 Zhiwei／Yating／Hanhan，不能因此將它們標成自然聲音。[官方聲音表](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices)

Adapter 維護者的包清單明確將 Xiaoxiao／Yunxi 標為「Chinese (Simplified, China)」。本輪未找到 Narrator zh-TW 自然聲音的可用證據；不能把能讀繁體字視為台灣口音支援。[維護者清單](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/wiki/Narrator-natural-voice-download-links)

Azure 雲端語音表另外列有 `zh-TW-HsiaoChenNeural`、`zh-TW-YunJheNeural`、`zh-TW-HsiaoYuNeural`。
這證明 Azure 的 zh-TW 品項存在，不能證明它們已內建 Windows 或都可取得離線模型。[Azure 語言表](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)
Embedded 文件稱 TTS locale 廣泛涵蓋該表（排除 fa-IR），但每個 locale 只有選定聲音；具體 zh-TW 模型及權利仍需獲准後確認。[Embedded 模型說明](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/embedded-speech#models-and-voices)

## NaturalVoiceSAPIAdapter 的適用範圍

維護者提供 SAPI 5 橋接，可接本地 Narrator，以及 Edge／Azure 線上聲音；只有本地路徑符合本案離線目標。
README 說明使用自系統檔案取得的加密金鑰，屬非正式方式，可能隨更新失效；也提到最新聲音包已不相容及可能干擾 Narrator。
這是維護者對自身方案的說明，不是 Microsoft 對第三方使用的授權承諾。[README](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/blob/master/README.md)

2026-07-12 更新的 wiki 指出 Store 最新聲音包因解密金鑰改變而無法配合 adapter，改列最後可工作的舊版 MSIX，檔案由第三方網站保存。
所以「安裝最新 Narrator 聲音加 adapter 就可用」目前不成立；舊包實驗成功也不足以成為自動更新環境的穩定支援。[維護者相容性說明](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/wiki/Narrator-natural-voice-download-links)

工程建議：若使用者仍選內建優先，只將此方案列為明確標示的實驗候選。
不得預設啟用其線上來源、默默降級到基本聲音，或在產品安裝器中自動安裝 adapter／鏡像舊包。
若要散布，須另外確認聲音包與相依 runtime 的使用及散布條款；本研究沒有完成此確認。

## 建議決策與實作切點

建議正式支援優先評估額外下載離線模型，避免把會隨 Store 更新失效的舊 Narrator 包設為預設依賴。
這是對維護性與交付風險的工程判斷，並非已證明某個替代模型音質達標。
若保留內建候選，先做一個不改產品選音規則的 Windows 診斷實驗：

1. 在乾淨 Windows 11，記錄 build、架構及經官方介面安裝的自然聲音包版本。
2. 以同一使用者分別列 SAPI／WinRT 聲音 ID、語言及可取得的來源資訊，確認 natural 是否可被指定。
3. 若可指定，封鎖網路後對新文字合成 WAV，記錄實際聲音 ID；不能僅依名稱含 Natural 標記 `neural: true`。
4. 若兩者均無合格聲音，保留不可用狀態；另行決定是否接受 adapter 實驗或額外離線模型評估。

若後續可行，整合工作應依現有邊界推進：

| 切點            | 需要處理的工作                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------- |
| 平台服務        | 將 Windows 後端獨立成 helper／provider；保留 JSON stdin、無 shell 插值、取消及程序隔離。           |
| Core 聲音合約   | 依實證加入 Windows provider 身分及穩定 ID；品質、離線能力、安裝狀態分開表達，未知值不冒充 neural。 |
| Host／Extension | 查詢、選單與實際播放共用同一資格判斷；保留明確區域，不把 zh-CN 冒充 zh-TW。                        |
| 安裝與更新      | 依 x64／Arm64 決定 helper 打包、版本與必要 runtime；先證明目標架構，不假設跨架構相容。             |
| 設定提示        | 區分無合格聲音、未安裝、後端不支援、查詢失敗；能力不足時清楚顯示。                                 |

額外模型的第一階段只做可行性比較，不預設某個開源引擎或模型適用。
比較範圍可含 Embedded Speech 與其他可合法散布的離線模型；Embedded 須先確認取得資格。

### 第一批候選與淘汰條件

- **優先評估 sherpa-onnx 作為推論層：** 官方提供 Node native addon、TTS 範例及 Windows x64 套件，與現有 Node Host 的整合方向較接近；這是整合成本判斷，不是音質結論。其 Node 套件文件未列 Windows Arm64，不能直接承諾該架構。[Node API](https://k2-fsa.github.io/sherpa/onnx/javascript-api/index.html)、[套件平台](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html)
- **Kokoro 只當部分語言候選：** 原始模型列英、日、Mandarin 等聲音，未列韓語，也未提供 zh-TW 保證；作者另外提醒短句及非英語品質限制。教材的單字、片語和日語是必要驗收情境，不能只聽長英文範例就採用。[模型聲音與限制](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)
- **Chatterbox Multilingual 作較重的比較候選：** 官方列為 500M、23 語言，含日／韓／中文；這不是安裝體積或 zh-TW 品質保證。官方 Python 安裝路線增加 runtime 打包工作，先比較 CPU 延遲與記憶體再決定是否值得整合。[官方 README](https://github.com/resemble-ai/chatterbox)

目前未下載或跑過上述模型。先取得相同測試句的音質、速度與完整模型體積，再決定模型；不先把任何候選標成已支援。

| 比較項目   | 通過條件                                                          |
| ---------- | ----------------------------------------------------------------- |
| 語言與音質 | zh-TW／日／英有實際候選及人耳樣本；缺少 zh-TW 不冒充完整涵蓋。    |
| 操作成本   | 記錄下載體積、CPU／記憶體、首次與後續延遲、取消時間及目標裝置。   |
| 散布與更新 | 模型及 runtime 授權允許預期用途；可驗證完整性、版本、更新與卸載。 |
| 離線能力   | 新文字在冷啟動、無網路條件可合成，不靠雲端 fallback。             |

本輪沒有選定模型、執行下載或改動 runtime。模型通過此階段後才進入產品整合。

## 發布前必須通過的驗收

- **資格與聲音身分：** 每個宣稱支援語言都具可追溯 provider／模型證據；基本及未知聲音仍不進入自然聲音選單。
- **真正離線：** 首次安裝完成後關閉網路，冷啟動並朗讀未快取新句；監測程序不得建立雲端合成連線。
- **音質與語言：** 人耳檢查單字、片語、原句、長對話、數字及中英混合；由相應語言使用者確認口音和自然度。
- **生命週期：** 新朗讀中斷舊朗讀；停止、換頁、關閉閱讀器及影片恢復播放後不殘留音訊或程序。
- **內容完整：** 保留 Unicode 與字幕邊界 300ms 停頓；整段例句每句結束後的節奏仍由既有 Extension 管理。
- **部署：** 在未裝開發工具的 Windows 裝置，驗證安裝、更新、卸載、聲音移除及包更新後重新偵測；逐一確認支援架構。
- **故障：** 聲音缺失或失效有可理解提示；查詢／合成失敗不冒稱成功，也不將教材文字或本機敏感路徑送入錯誤回覆。

## 本輪驗證邊界

目前執行環境為 macOS，沒有在本輪操作 Windows 實機。原始碼檢查及 injected／mock Windows 測試只能驗證分支、輸入與取消邏輯。
既有 Windows CI 的 Host 安裝／stdio smoke 不等於 Windows 語音合成驗收；`speech-smoke.ts` 目前限定 macOS。
此文件確認了限制、候選路線與驗收條件，沒有證明 Windows 自然語音已可用、達到 Siri 音質或可供公開發布。
