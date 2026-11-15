# 全產品介面規範：本輪驗證

日期：2026-10-16。工作目錄為 `/Users/cheng/Desktop/immersive-language-learning`，分支 `codex/core-redesign`、HEAD `21969bc`，包含大量先前已有的本地變更。

## 交付與範圍

- [DESIGN.md](../../../DESIGN.md) 定義全產品文字角色、色彩、間距、版面、控制尺寸及各頁套用方式；含已遷移／待對齊清單。
- 共用字體與正文基準設定在 `styles.css` 的 body，涵蓋 Portal 浮層。App、PageSection、活動標題與主要閱讀內容使用新增的 `text-ui-*` 角色。
- 保留共享 shadcn 元件預設；本輪沒有修改 `components/ui/select.tsx` 等共享控制。

## 預覽實測

使用內建瀏覽器與既有開發預覽，資料、儲存及 Host 為模擬；並非已安裝擴充功能驗收。

| 表面                     | 實際 viewport | 確認結果                                                                     |
| ------------------------ | ------------- | ---------------------------------------------------------------------------- |
| 建立內容                 | 1280px        | body 與 PageSection h2 為 14px；頁面無水平溢出                               |
| 設定首頁及一般設定 Sheet | 1280px        | Portal 繼承 14px body；類別名稱 14px；設定導航、返回與關閉可操作；無水平溢出 |
| 內容庫                   | 1280px        | 主欄 640px，body 14px；無水平溢出                                            |
| 活動預覽                 | 1280px        | 任務標題及 body 為 14px；無水平溢出                                          |
| 標準閱讀器               | 320px         | 原文與 AI 例句 15px、解說 14px；無水平溢出                                   |

同一個 viewport 設定未套用到另一個預覽 tab；以上記錄實際量測值，不能將設定 320px 的操作當成所有頁面的 320px 驗收。設定頁截圖為 [settings.jpg](settings.jpg)。尚未完成全產品深色、200% 縮放與每個設定子頁的視覺驗收。

## 自動檢查

初次驗證：Extension typecheck 與 build 通過。選定的跨頁測試共 49 項，45 通過、4 未通過：

1. `learning-settings.test.ts` 的語言選項檢查仍比對舊的單一 `learningLanguageOptions(uiLocale)` 呼叫。
2. 同檔活動列樣式檢查期待 `gap-[7px]`；現有活動列表使用 `gap-1`。
3. `shadcn-original-styles.test.ts` 的 `select.tsx` 原始樣式 hash 不符；該共享檔本輪未修改。
4. `sidepanel-polish.test.ts` 仍期待舊的 `<strong ... truncate>` 活動標題，現有標題使用兩行 span。

修正後驗證：以上四項已處理，並補跑共享控制的互動測試，共 **61 項通過、0 項失敗**。Extension typecheck 與本次修改檔案的 Prettier 檢查通過；本次只修改測試與此驗證紀錄，未重跑 build。

- 語言選項檢查涵蓋附加字幕說明的選項，並實際確認五種介面語言下的選項 ID 完整且名稱正確。
- 活動列表檢查對齊 4px 間距及兩行標題的文字角色，保留完整標題的 title 檢查。
- 原始樣式 hash 改為只收集 JSX `className` 與 `cva` 定義中的字串，排除 Select 內部識別字。六個元件的新基準均由原始整合 commit `7b9249afa90dea8d5d2b525660c7dea26b9ecefc` 計算，與現有樣式一致；新增測試確認改變 class／variant 仍會被偵測。
- 補跑時發現 Host 按鈕測試仍以包含隱藏狀態文字的整段 textContent 定位；已改用無障礙名稱定位及可見的 live 區域檢查，保留忙碌狀態、防重複點擊與成功／失敗完成時間的驗證。

通過範圍為 `sentence-analysis-ui`、`contextual-reader`、`custom-content`、`task-history`、`side-panel-navigation`、`sidepanel-polish`、`shadcn-original-styles`、`learning-settings`、`shadcn-interactions` 九個測試檔。未執行完整 repository 測試套件。

機械設計檢查已執行一次，提示殘留的 13px 及 8px／10px 注音例外。已將 App 重複教材摘要改為正文角色，並把注音例外加入 DESIGN.md 的機器可讀字級表；未重跑機械檢查，也不宣稱零項提示。

## Layout 修正與驗證（2026-10-16）

本次修改實際 UI，完成以下項目：

- 標準及自訂閱讀器的標頭、正文以 720px 為上限；標準播放器保持相同上限。
- 寬版傳統捲軸曾使正文向左偏 7.5px，已在寬度至少 774px 的閱讀器容器內對正文使用雙側捲軸留位；窄版保留文字可用空間。
- 建立頁局部 6px 間距改為 8px；活動列的 3／5／7／10px 局部間距改用 4／8／12px，操作按鈕至少 32px 並允許文字換行。
- Sheet 標頭新增分隔線，首個內容區統一距標頭 16px；AI／儲存設定主要群組間距 24px，欄位內距維持較緊密的 4–16px。
- 活動詳情的教材標題與主要說明使用 14px，執行 metadata 與用量保留 12px；移除活動列強制將所有段落縮成 12px 的規則。設定分區標題及必要錯誤訊息套用對應文字角色。

### 本次實際預覽

使用 `http://127.0.0.1:5196` 的現有 Vite 預覽，以實際 App／元件及模擬 Host、影片和資料操作。沒有呼叫真實生成服務或寫入使用者教材。

| 表面                         | 實際 viewport            | 確認結果                                                              |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------- |
| 標準閱讀器                   | 320／390／555／900 × 560 | 頁面無水平溢出；900px 時標頭兩列、正文及播放器均為 x=90、寬度=720px   |
| 自訂閱讀器                   | 320／390／555／900 × 560 | 正文為 296／366／531／720px；900px 時 x=90；無水平溢出                |
| 建立頁                       | 320 × 320                | 主要捲動區仍有 106px 高；Footer 位於 y=259 至 320，下一步可達         |
| 一般／AI／儲存／本機服務設定 | 320 × 560，淺色          | 單一內容捲動區、固定標頭；頁面與 Sheet 無水平溢出；導航及返回可操作   |
| 活動列表及執行詳情           | 320 × 320，深色          | 可展開活動、開啟詳情；詳情內容捲動區 235px 高，返回及關閉位於固定標頭 |
| 儲存設定長路徑、Drive 帳號   | 320 × 320，深色          | Sheet 內容捲動區 263px 高，無水平溢出，Header 不隨內容捲動            |
| 標準閱讀器短視窗             | 320 × 320                | Header、內容及播放器分離；播放器維持約 94px 高並處於視窗內            |

量測記錄見 [layout-measurements.json](layout-measurements.json)；`reader-*` 是第一次量測，`final-reader-*` 是修正捲軸偏移後的結果。動畫期間的 Sheet x 值不作定位驗收。

截圖：[寬版閱讀器](reader-layout-900.png)、[短視窗閱讀器](reader-layout-320-short.png)、[深色儲存設定](settings-layout-320-dark.png)。

### 本次自動檢查與限制

- 原九個跨頁測試檔加上 `drive-backup-settings`、`pi-auth-ui`、`notification-settings`，最終以 `--test-concurrency=1` 逐檔執行，共 **87 項通過、0 項失敗**。此前一次並行重跑的 `shadcn-interactions` 程序收到 SIGKILL；沒有確認終止原因，逐檔重跑未重現。
- Extension typecheck、production build、修改檔案的 Prettier 與 diff whitespace 檢查通過。Build 仍有大於 500kB 的 bundle 提示。
- Layout detector 在修改前與修正後各執行一次，均回傳空陣列；這只表示該掃描未發現機械規則問題。
- 未執行完整 repository suite、200% 瀏覽器縮放、所有語言／所有設定狀態或已安裝 Extension 的真實影片驗收。窄版正文仍會因傳統捲軸少 15px 可用寬度；與播放器共用左側內距，不為對齊額外縮小文字。

## 設定首頁 shadcn Item 試版（2026-10-16，已撤回）

使用者比較後偏好原版，已恢復文字列表、細分隔線與右側箭頭；保留「本機儲存、Google Drive 備份」的統一描述。移除試版專用的 Item／Separator 檔案與新增依賴。以下測量及截圖保留為試版歷史紀錄，並非目前介面。

後續的全產品過場與「動畫效果」設定已實作，詳見 [動畫驗證紀錄](../ui-motion/verification.md)。

- 四個入口採用 `ItemGroup`、`Item variant="outline"`、前置分類圖示與尾端箭頭，項目間距 8px；整列為原生 button，保留既有 Sheet 子頁切換。
- 新增 `components/ui/item.tsx` 與其依賴 `separator.tsx`。來源為 [shadcn Item 官方 registry](https://ui.shadcn.com/r/styles/new-york-v4/item.json) 及 [Separator registry](https://ui.shadcn.com/r/styles/new-york-v4/separator.json)；只調整 utils／Separator 相對匯入與 Radix 個別套件匯入，視覺差異在 App 使用處指定。已同步 package.json 與 lockfile。
- 模擬預覽實測 320×320、390×760、555×760：四個 Item 皆為 outline button、間距 8px，頁面與項目沒有水平溢出。320×560 深色日文中，長描述可使項目從約 69px 增高至 88px，沒有裁切文字。
- 四個入口可點擊進入子頁並返回；Tab 可聚焦第一個 Item，Enter 可開啟一般設定。
- Typecheck、build、相關四個測試檔共 **22 項**與格式檢查通過。未執行完整 repository suite 或安裝版 Extension 驗收。
- 證據：[淺色繁中](settings-items-390.png)、[深色日文窄版](settings-items-320-dark-ja.png)、[量測](settings-items-measurements.json)。
