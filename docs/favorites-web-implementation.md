# 跨裝置教材與收藏網站

2026-10-24。網站直接連結使用者自己的 Google Drive，提供「所有教材」與「收藏」，可新增／取消收藏；使用裝置不需要 Extension 或 Native Host。測試站：<https://contextual-favorites-preview.shawnchengchs.workers.dev>。目前部署 `2c47efa5-9cc9-4fee-9bb3-491d693754a9`。

## 教材與閱讀操作

標準教材只列出 schema 7，開啟時由 core 驗證完整 JSON。舊 schema 5／6 不再出現在清單；雲端原檔保留，不以 Markdown 替代標準教材。原有收藏快照仍可閱讀。自訂內容保留完整 JSON／Markdown 配對、身分與 hash 驗證，使用安全 Markdown 呈現，亦可收藏。

網站直接使用 Extension 的 `ContextualSceneReader`，包含場景切換、原始對話、翻譯切換、解析展開、發音標註與播放控制。透過可選的 storage、favorite control、open-video 注入點適配瀏覽器；Extension 預設仍使用 Chrome storage 與原操作。網站停用時間校正與儲存播放範圍，不提供 Host 系統語音功能。

YouTube 在桌面位於教材左側，窄螢幕在教材上方。IFrame API adapter 提供選句、播放／暫停、速度、片段循環與跳轉；離線只讀教材。標準／情境收藏共用此控制器，自訂 Markdown 使用內嵌 YouTube 的原生播放控制。全站維持 `no-referrer`，只有 YouTube iframe 明確使用 `strict-origin-when-cross-origin`，傳送站點 origin 作為播放器身分。嵌入被影片擁有者禁止時，顯示原因並提供 YouTube 原站連結。

`packages/ui` 是 Extension 與網站共用的 shadcn 元件來源，包含 Button、Card、Input、Badge、Alert、Select、Tabs、Popover、Dialog、Command 及搜尋選單。原元件路徑 re-export 同一來源。語言長清單使用可搜尋的 combobox，支援中文、英文、原文及語言代碼。`packages/reader-ui` 共用安全 Markdown，不執行 HTML 或載入遠端圖片。

## 收藏資料契約與寫入

沿用 Desktop 的不可變 operation、snapshot v1／v2、account collection hash、identity hash、因果版本向量及同時取消優先規則。收藏保存內容快照，原教材刪除不會破壞收藏。Drive 的 `Favorites/operations` 放完整操作，`Favorites/catalog` 放輕量投影，兩者均有操作識別與 SHA-256。查詢依帳號集合與 appProperties，不依賴資料夾名稱唯一。

瀏覽器先讀最新完整索引，再產生新操作、預留兩個 Drive ID，將操作與 ID 存入 IndexedDB outbox，依序上傳 operation、catalog，成功後刪除該待同步工作。每個工作各用獨立 key，避免不同分頁覆寫共享陣列。每個 writer 使用獨立 UUID，版本向量繼承已知同一收藏的操作；網路重試使用相同預留 ID，409 必須核對 metadata 與完整 bytes，不能覆寫不同內容。

小檔案使用 multipart；超過 5 MiB 使用 resumable upload，PUT 中斷後查詢已接收 Range 並續傳。若重載頁面，上傳 session 不保存；outbox 保留預留 ID 與內容，重新建立 session 或驗證已完成的相同檔案。單筆操作沿用 core 的 20 MiB 上限。不把 token 寫入 localStorage／IndexedDB，也不保存上傳 session URL。

若 operation 已上傳但 catalog 缺失，網站只在驗證原操作的格式、身分、集合與 hash 後補投影。未知格式、毀損索引、來源遺失或部分 metadata 查詢仍回報錯誤，保留上次完整清單；不把不完整結果當成空收藏。一般清單只讀 metadata 與輕量索引，開啟內容才下載完整快照；修復孤立操作是明確例外。

收藏書籤可直接新增，取消先使用與 Extension 相同的簡短 popover 確認。失敗保留待同步工作，提供重試。離線或未連結帳號時可閱讀已下載內容，不能建立新收藏操作；重新連結並更新時會嘗試送出已持久化的工作。

## 本機資料、偏好與 PWA

Desktop repository 未改成 SQLite；網站使用 IndexedDB `cll-favorite-reader`。`catalog` store 保存帳號索引、`:library` 教材清單及 `:mutation:<operationId>` 待同步工作；`content` store 保存依帳號及 hash 區隔的已驗證內容。快取限制最近 20 份、總共 100 MiB 且不超過瀏覽器回報 quota 的 10%；outbox 不受閱讀快取 LRU 淘汰。

頁首可選淺色／深色／跟隨系統；教材與收藏共用卡片／緊湊列表切換。主題與列表偏好存在 localStorage，跨同源分頁更新。

教材快取識別固定排序 Drive appProperties，檔案欄位以固定結構序列化，再計算 SHA-256；不依賴 Google JSON 物件欄位的回傳順序。內容 hash 或檔案版本改變仍使舊副本失效。相同 metadata 的舊格式快取可在開啟時讀取並保存為穩定鍵；無法核對的舊副本需連線重新下載一次。真實 Drive 連續四次列舉的證據在 `.audit/web-open-recovery/cache-identity*.log`：修正前相同教材鍵每次不同，修正後相同。

教材清單載入時只查詢本帳號的 IndexedDB 內容鍵，預先區分已有離線副本與尚需下載的教材。網頁重開且沒有有效分頁授權時，已下載教材直接開啟；未下載教材的主操作是「連結並開啟」，在點擊手勢內啟動 Google 授權，成功後繼續開啟原教材，不先顯示錯誤再要求第二次點擊。授權取消或真正下載失敗才顯示重試提示。卡片按鈕高度隨內容排版，提示不再讓 overflow 容器偷偷捲動、遮住標題。閱讀偏好與進度按帳號加前綴儲存，未同步 Drive。

PWA 提供 manifest、192／512 圖示、maskable 圖示、安裝入口及 iOS 安裝說明。Service Worker 只快取本網站靜態資產，Google API 回應與 token 不進 Cache Storage。已下載教材可在離線重開後閱讀；首次開站、未下載教材與 YouTube 播放需連線。瀏覽器可能回收網站資料，因此離線快取不是唯一備份。

登出中止請求並使 repository／writer 失效，清除該帳號 IndexedDB 及帳號記錄，通知其他分頁登出；晚到回應不能重新保存內容。登出會清掉尚未送完的本機工作，已上雲端的孤立操作可在下次同步修復。Access token 依 Google 回傳的 expires_in 保存於同一分頁的 sessionStorage；距離到期不足 30 秒、帳號或 Client ID 不符時不能恢復。重整可繼續使用有效授權，不在 localStorage／IndexedDB／Service Worker 保存 token，也不取得 refresh token。登出（含跨分頁通知）或 Drive 401 清除分頁授權；舊 session 的晚到回應不能清除新連線。新分頁／已到期授權仍需使用者點擊連結；續連以已知 Google account ID 作 login_hint、prompt 留空，避免強制顯示帳號選單。popup 被阻擋與被關閉分別顯示可操作的原因。

## OAuth 與部署

Web OAuth Client 與 Desktop Client 必須在同一 Google Cloud 專案。根目錄 `.env` 設定公開的 `VITE_GOOGLE_WEB_CLIENT_ID`，不放 Web Client Secret。Google Identity Services token model 請求 `openid email drive.file`。Authorized JavaScript origins：

```text
https://contextual-favorites-preview.shawnchengchs.workers.dev
http://localhost:5178
```

專案無 Wrangler 設定，使用 `cf` CLI。`build-cloudflare.mjs` 產生 Build Output v0，部署至現有 Workers Static Assets。網站沒有應用程式 API 伺服器、伺服器資料庫或 Google secret。

```sh
pnpm web:dev
pnpm typecheck
pnpm test
pnpm web:build
node apps/web/scripts/acceptance.mjs
node --import tsx apps/web/scripts/offline-acceptance.mjs
node apps/web/scripts/pwa-acceptance.mjs
pnpm web:deploy
```

## 驗證證據與界線

最新共用閱讀器／收藏寫入證據保存在 `.audit/web-reader/`。瀏覽器矩陣使用合成 Drive 與可控 YouTube API，驗證 320／480／1100px × 深淺色、翻譯／解析／播放／速度／循環／選句、標準與自訂收藏、取消確認、搜尋、偏好、跨分頁登出及無 Native API。正式產物離線驗證不依賴 dev fixture。

2026-10-24 真實 Drive 測試使用指定帳號的 Desktop token 與網站 transport，在獨立 namespace 新增情境／自訂收藏，獨立 portable reader 及 Host service 均成功讀回，網站取消可傳播至兩者。本次 6 個合成檔案已清理。這項測試不是 Web OAuth 或已安裝 Extension 的端到端驗收；證據 `live-write.json`／`live-write.log`。

先前公開站已通過 Web OAuth，但舊站的 8 份清單與 Markdown 標準閱讀屬歷史行為。按最新 schema 7 篩選後，原帳號的 5 份舊標準教材排除，3 份自訂內容仍可讀；支援的新標準教材需由 Extension 備份。最新公開站已以真實 Web OAuth 通過合成情境收藏的取消／重加／再次取消，並實際播放 YouTube、循環、暫停及切換翻譯。暫時 UI 測試收藏已清理，原1份收藏保留；截圖 `public-shared-reader.png`。公開正式產物的離線與 PWA installability 亦通過。另一台實體裝置與實際 PWA 安裝尚未驗收。公開站最新版本及驗收以 `.audit/web-reader/HANDOFF.md` 為準。

參考：[Drive upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads)、[GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)、[YouTube player identity](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity)。

### 2026-10-24 Google 分頁授權保留修正

`.audit/web-open-recovery/auth-tests.log`：28 Web tests 通過（新增授權恢復、到期、帳號／client 隔離、儲存拒絕與 401 清除）。`auth-browser.log`：320／480／1100px × 深淺色六種既有閱讀操作通過。`auth-offline.log`、`auth-public-offline.log`：本機正式產物與已部署網站均通過合成 Google 流程，驗證兩份不同的未下載教材沿用授權、重整後下載、到期才續連、login_hint 及跨分頁登出清除。

實際網站用既有帳號連結一次，切換兩份原有教材後重整，仍顯示「已連結 · Google Drive」；重新整理教材可讀取真實 Drive，無帳號選擇視窗或錯誤。這些原有教材當時已有本機副本；強制未下載教材的覆蓋由隔離合成測試提供。未新增／刪除／更改真實 Drive 教材或收藏。截圖：`.audit/web-open-recovery/public-auth-restored.jpg`。

### 2026-10-24 本機副本狀態的帳號清理操作

未連結 Drive、只有記住帳號與本機副本時，原有清理按鈕改用垃圾桶圖示與「清除此帳號的本機資料」提示；有有效連線時才使用登出圖示與「登出並清除本機副本」。資料清理、跨分頁登出與雲端資料保持原有行為。本機與已部署正式產物的離線／OAuth 驗證皆確認未連結時沒有登出按鈕，連線後仍可正常登出（`.audit/web-open-recovery/local-copy-action-*.log`）。

### 2026-10-25 閱讀工作區與瀏覽器導覽

閱讀頁用滿視窗，桌面影片在左、教材在右；教材預設 400px，可拖曳或使用方向鍵調寬，影片及工具列不隨教材捲走。小於 1024px 改為影片在上、教材在下；高度不足 560px 的小螢幕預設收合影片，避免教材只剩一條狹窄區域。收合保留 iframe 與播放狀態。頁首只有一列返回、標題、收藏及主題操作，沒有內容庫的品牌／安裝頁首重複佔高。

教材、收藏與清單切換會產生 hash URL 和瀏覽紀錄；瀏覽器上一頁、下一頁及重整可恢復選取教材與捲動位置，並保留該頁的影片收合狀態。場景進度沿用按帳號隔離的 reader storage，history 不保存完整教材或 token。詳細契約見 [web-reader-layout.md](web-reader-layout.md)。

`.audit/web-reader-layout/`：30 Web tests、root typecheck、最終 Web build 通過。320／480／900／1024／1165／1600px 與手機橫向 844×390，各深淺色，共 14 場景通過；實際操作拖曳／鍵盤調寬、播放保留、收藏及 browser back/forward/reload，並驗證長教材位置恢復。既有 6 場景閱讀互動回歸通過。已部署正式產物也通過大影片在左、400px 教材在右、免新 OAuth 的快取深連結重整、離線與跨分頁登出驗證（`public-production.log`）。Drive／YouTube 使用合成回應，未重做真實 Google OAuth、影片串流或實體裝置驗收。

### 2026-10-25 播放句與展開按鈕底色

網站與 Extension 共用的 SentenceDialogue 將展開按鈕縮為編號＋箭頭，鍵盤焦點改為內框，與播放句保留 4px 間距。12 項句子分析測試、8 組瀏覽器情境及雙端建置通過；已部署網站的合成播放／展開／hover／鍵盤焦點檢查亦通過。最新部署 `60c44814-988f-41d4-8d34-edcd9b900fd4`，詳見 `.audit/reader-highlight/HANDOFF.md`。尚未觀察已安裝 Extension 的實際 UI。

後續依使用者確認，恢復展開按鈕整列 hover／點擊，底色左緣對齊播放句底色，編號左緣對齊句子文字；保留 4px 間距與內縮焦點框。最新部署 `a2719cd2-65fc-4f15-b681-4c58d6592c13`，12 項測試、8 組含整列右端 hover／點擊的瀏覽器情境與雙端建置通過。驗收見 `.audit/reader-row-hover/HANDOFF.md`。

### 2026-10-25 shadcn Resizable

網站影片／教材分欄改用共用 UI 套件的官方 shadcn ResizablePanelGroup、ResizablePanel、ResizableHandle（react-resizable-panels 4.15.0），移除自製拖曳計算與鍵盤操作。保留右側教材 320–600px、欄寬記憶、手機上下排列、收合及 iframe 播放狀態；Home／End 採元件標準邊界行為，雙擊回到開啟時欄寬並記住。Root typecheck、Web build、30 Web tests、14 組尺寸／主題檢查及本機正式產物驗收通過。最新部署 `536ff99e-0691-4c09-bbe4-e9cadd4609f5`；詳細見 `.audit/shadcn-resizable/HANDOFF.md`。

### 2026-10-25 主題圖示按鈕

網站各處的主題切換統一為 36px 方形圖示控制，移除可見文字與下拉箭頭，保留三種選項、輔助標籤、提示與設定記憶。六組尺寸／主題互動檢查及 Web build 通過。部署 `a4da5044-4aa5-4fb8-b48c-9f2d95783b6c`，見 `.audit/theme-icon/HANDOFF.md`。

### 2026-10-25 閱讀區邊界對齊

影片操作移到下方同一列，影片舞台與標準教材卡片上緣對齊；分隔線兩側各留 12px，移除標準教材外層多留的捲軸空間，讓內容左右外緣與頁首一致。手機高度依單列影片操作調整，保留收合、播放及內層捲動。14 組尺寸／主題操作、邊界量測與 Web build 通過；部署 `4eaa8a98-a785-409b-9f25-94f56b120f97`，見 `.audit/reader-boundary/HANDOFF.md`。
