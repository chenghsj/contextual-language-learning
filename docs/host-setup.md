# 本機服務安裝包

一般使用者完整解壓縮 ZIP，雙擊 macOS 的 `CLL 本機服務.app`、Windows 的 `Setup.exe`，或 Linux 的 `CLL Setup.desktop`。在開啟的圖形設定頁選擇瀏覽器並安裝；完成後回到擴充功能檢查連線。更新與解除安裝使用同一個設定程式。教材、登入、設定與其他瀏覽器的註冊會保留。

安裝包包含固定版本的官方 Node runtime 與 LICENSE；下載時核對程式碼中固定的 SHA256。安裝將 runtime 與 Host 複製到使用者資料夾，安裝後不依賴 ZIP 的解壓縮位置或使用者的 PATH。程式檔案依內容版本分開，避免更新時覆寫仍在運作的 Windows 執行檔。Windows 啟動器在建置時編譯，使用者端不編譯程式。

設定頁伺服器只綁定 `127.0.0.1` 的隨機埠。每次啟動產生一次性 token，寫入操作檢查 token、Origin 與 Host；未提供 CORS，也不允許其他網站嵌入設定頁。完成時結束伺服器；閒置 15 分鐘自動結束。這不是常駐 Host daemon。

## 從舊名稱升級

重新建置並載入擴充功能，再透過新版 Setup 安裝本機服務。Native Host 改為 `dev.contextual.language_learning`；舊版註冊無法供新版擴充功能使用。已開啟的影片分頁也需重新載入。

新版 Host 首次啟動會將舊 `Immersive Learning` 資料與設定複製至 `Contextual Language Learning`，保留原件供恢復，完成後不會重複複製。相同相對路徑若有不同檔案，會停止並指出衝突位置，不覆寫任何一份。既有 Google 憑證與 Drive 備份有相容讀取；資料 schema 與舊 CLI 任務不會轉換。詳細政策見 README 的品牌升級說明。

## 開發者建置本機測試包

先建置 Host，再指定目前手動載入的擴充功能 ID：

```sh
pnpm --filter @contextual/local-host build
pnpm package:host-setup --extension-id YOUR_EXTENSION_ID
```

預設只產生目前 OS／CPU 的 ZIP，輸出在 `release-assets/`。可用 `--platform darwin|win32|linux --arch arm64|x64` 指定目標。macOS/Linux 跨平台建置 Windows 啟動器需要 Mono 的 `mcs`；Windows 原生建置使用系統 .NET Framework 編譯器。這些是建置機需求，不是一般使用者的安裝要求。

本機包預先設定傳入的 ID；只有本機模式才有可展開的測試 ID 欄位。ZIP 重新載入到不同路徑可能產生不同的開發版 ID，此時在測試設定更換 ID。正式模式只允許建置時配置的瀏覽器 ID。

```sh
node apps/extension/scripts/host-setup-acceptance.mjs PATH_TO_SETUP_ZIP
```

驗收使用解壓縮包內的 runtime、獨立測試 HOME、真正的設定 UI 與安裝後 Host，驗證安裝、更新、協定、解除安裝、資料保留，以及刪除原解壓縮 runtime 後仍能運作。Windows 測試只在一次性的 CI runner 執行，避免改動真實 HKCU。

## 後續正式發佈

`package:release` 產生擴充功能 ZIP 與三個 OS × 兩種 CPU 的安裝 ZIP，並產生 `SHA256SUMS`。建置前設定 `CLL_CHROME_EXTENSION_ID`、`CLL_EDGE_EXTENSION_ID`、`CLL_CHROMIUM_EXTENSION_ID` 中支援的正式 ID；缺少有效 ID 時停止打包。預覽包另設 `CLL_SETUP_MODE=local`。

擴充功能的本機建置不連結舊的線上安裝包；release 建置設定 `VITE_HOST_SETUP_DOWNLOAD_URL` 後才顯示下載按鈕。正式上線前需完成各 OS／CPU 的執行驗收與簽章、公證。Linux ZIP 目前需要圖形桌面與 `xdg-open`，尚非 `.deb`／`.rpm`。本次本機測試不等於公開 release 驗收，也不會自動發布。
