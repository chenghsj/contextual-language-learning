# 元件字級檢查

日期：2026-09-30。範圍：`apps/extension/src/App.tsx`、全部 31 個 `.tsx` 元件、`styles.css` 與已安裝 Tailwind / Sonner 的字級定義。`pronunciation.ts`、`scene-navigation.ts` 是資料／邏輯模組，沒有自己的可見文字樣式。

檢查來源：`/Users/cheng/Desktop/immersive-language-learning`，`main`，HEAD `96ca3c9c0e88c7cf1fa6f6047263e88bdb6b554a`，包含現有未提交及未追蹤檔案。這是原始碼檢查；未驗證已載入 Chrome 擴充套件、實際 computed style、窄版畫面或 200% 縮放。既有 dist 不作為目前來源的驗收證據。本次沒有修改 UI。

## 結論

共用控制元件的 14px 大致合理，但學習正文、發音註記與重要狀態偏小。字級層級混用 8、10、11、12、13、14、16、17、18、21px；主要問題是重要內容使用輔助字級，並非所有元件都需要放大。

以下 px 換算假設瀏覽器預設根字級 16px。專案未覆寫 Tailwind 字級：`text-xs` = 0.75rem、`text-sm` = 0.875rem、`text-base` = 1rem、`text-lg` = 1.125rem。任意 `text-[Npx]` 為固定 px。建議字級是此產品閱讀用途的設計判斷，不將小字直接判定為 WCAG 違規。

## 優先調整

| 優先 | 位置 | 發現與影響 | 建議 |
| --- | --- | --- | --- |
| P1 | `contextual-scene-reader.tsx:137,146` | 日文 ruby 8px，其他讀音 10px；學習所需的發音難以辨識，與淡色疊加時更吃力 | 註記提升至 11–12px，配合正文與 ruby 行距驗證多行排列 |
| P2 | `scene-focus-items.tsx:25–52` | 意義 13px、解說與單字註解 12px、情境 11px、例句 13px、翻譯 12px；需反覆閱讀的核心內容過小 | 原文例句 16px，意義／解說／翻譯 14px，情境 12–14px |
| P2 | `contextual-scene-reader.tsx:666,717–723` | 對話原文繼承 Button 14px，翻譯 12px、場景描述 13px；原文與例句的閱讀尺度不一致 | 原文 16px，翻譯與場景描述 14px；列號、時間保留 12px |
| P2 | `task-history.tsx:55–64`、`video-library.tsx:79–81` | 父層 `[&_p]:text-[11px]` 的 selector specificity 高於段落 `text-xs`，把段落壓成 11px；錯誤、恢復引導與任務進度一起受影響 | 移除廣泛段落覆寫；錯誤與操作引導 14px，日期／純計數 12px |
| P2 | `App.tsx:1628,1799` | Drive 錯誤文字 11px，使用者需要閱讀它才能修復問題 | 錯誤訊息 14px |
| P2 | `App.tsx`、`ai-model-selection.tsx`、`pi-settings.tsx`、`custom-agent-settings.tsx`、`host-connection-settings.tsx` | 多數欄位標籤、登入步驟、連線修復說明與狀態 12px | 標籤、必要說明、登入提示與錯誤 14px；短版號、日期等次要資訊 12px |
| P3 | `contextual-scene-reader.tsx:652`、`scene-focus-items.tsx:22` | 外層 `[&_h3]:text-sm` 與子層 `[&>h3]:text-lg` 同時命中重點表達 h3；同 specificity，依生成 CSS 排序決定，造成閱讀標題層級不明確 | 縮小外層 selector 範圍，讓重點表達明確使用 18px；實際勝出的大小需 computed style 確認 |

## 全部元件清單

| 元件 | 目前字級（預設根字級下） | 判斷 |
| --- | --- | --- |
| App | 品牌 12、版本 11、標籤／hint 12、部分文字 13、錯誤 11 | 標籤、必要提示與錯誤偏小；版本 11 可提升到 12 |
| AppPanel | h1 21、h2 16、h3 12；正文繼承 | h1/h2 合理；內容區標題 h3 可用 14，次要分類 12 可保留 |
| ContextualSceneReader | 標題 17、對話 14、翻譯 12、ruby 8/10、羅馬字 11、時間 11、校準說明 12 | 發音與正文優先調整；校準操作說明 14，次要時間 12 |
| SceneFocusItems | 重點表達宣告 18、有外層 14 覆寫競爭；正文 11–13 | 核心學習內容偏小 |
| TaskHistory | 標題 12、段落 11、Badge 11、sm 按鈕 12 | 必要訊息偏小；任務標題建議 14 |
| VideoLibrary | 影片標題 14、教材標題 12、段落 11、Badge 12、sm 按鈕 12 | 教材標題建議 14；段落應依用途區分 |
| AiModelSelection | 標籤／狀態 12、選項 14 | 控制文字合理，標籤與必要狀態建議 14 |
| PiSettings | 供應商名稱 14、登入提示／狀態／安全說明 12 | 供應商名稱合理；登入必要內容建議 14 |
| CustomAgentSettings | 名稱／編輯標題 14、解說／標籤／預覽／狀態 12、編輯輸入 14 | 編輯文字合理；長說明與錯誤建議 14 |
| HostConnectionSettings | 標題 14、狀態／步驟／命令／錯誤 12，Alert 說明 14 | 安裝與修復步驟建議 14；版號 12 可保留 |
| SettingInfo | 解說／項目標題 14、項目描述 12 | 短描述可保留；較長解說可統一 14 |
| SidePanelNavigation | 14 | 合理；長翻譯使用 truncate，需窄版驗證 |
| SearchableSelectField | 觸發／搜尋／選項 14 | 合理 |
| Disclosure | 標題／內容預設 14，內部可覆寫 | 合理；需避免子內容再縮成 11–12 |
| NoticeViewport | 使用 Sonner 預設主文字 13 | 可提升 14，尤其持續顯示的錯誤 |
| ui/button | 預設 14、sm 12、icon 無可見文字 | 預設合理；sm 可留給次要操作，主要文字操作建議 14 |
| ui/input | 14 | 合理；上傳欄位被 App 明確覆寫為 12 |
| ui/textarea | 14 | 合理 |
| ui/select | 觸發與選項 14 | 合理；播放控制觸發被 reader 覆寫為 12，選項仍 14 |
| ui/badge | 12 | 次要標籤合理；TaskHistory 覆寫 11 偏小 |
| ui/accordion | 標題／內容 14 | 合理 |
| ui/alert | 標題／描述 14 | 合理 |
| ui/command | 輸入／項目／空結果 14、群組與快捷鍵 12 | 合理 |
| ui/dialog | 標題 18、描述 14 | 合理 |
| ui/tabs | 14 | 合理 |
| ui/toggle | 14，尺寸 sm 不縮字 | 合理；和 Button sm 的 12 不一致，可依語意統一 |
| ui/toggle-group | 繼承 Toggle 14 | 合理 |
| ui/sonner | 第三方主文字 13、action button 12；未覆寫字級 | 主文字建議 14；目前 NoticeViewport 未使用 action button |
| ui/card | 沒有字級設定，繼承使用處 | 無独立字級問題；檢查消費者覆寫 |
| ui/popover | 沒有字級設定；Portal 內容依 body 與子元件 | 無独立字級問題；SettingInfo / Command 已明確設定內容字級 |
| ui/progress | 無可見文字 | 字級不適用；進度描述由使用處決定 |
| ui/switch | 無可見文字 | 字級不適用；外部標籤由使用處決定 |

## 建議尺度與驗收

- 主要學習原文：16px；重點表達／場景標題：18px 左右。
- 翻譯、解說、表單標籤、一般按鈕、錯誤與操作提示：14px。
- 日期、數量、版號與次要 metadata：12px。
- 發音註記：11–12px，跟著正文與多行排列驗證。

既有 1.5–1.65 行距對多行正文方向合理；ruby 使用 2.2，保留足夠註記空間。放大時應保留既有主題色系，不能用顏色替代文字可讀性。

後續實際修改應一次檢查 320／355／480px 側欄、中英文與日韓含 ruby 內容、長錯誤和登入提示，再確認 200% 縮放。這些實際畫面驗收尚未進行，因此本報告不宣稱無溢出或通過可及性標準。
