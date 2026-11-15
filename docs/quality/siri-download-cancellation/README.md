# Siri 語音下載取消驗證

2026-10-20，macOS 27.0.1（26A434）、Apple Silicon。

**產品整合已完成，驗證結果更新至 2026-10-21。** 下載由背景 worker 保存，Siri 與活動頁共用狀態，支援逐項取消與重試。實機 helper 已驗證隔離訂閱撤回、延遲啟動阻擋、並行下載與既有資源保留。Chrome 側欄已確認能讀取 Siri 聲音。[產品整合驗證紀錄](implementation-2026-10-21/README.md) 分別列出 helper、模擬 UI 與實際擴充功能的驗證範圍。

以下保留 2026-10-20 的失敗候選與隔離 client 訂閱撤回實驗。最初的資源取消方法無效；撤回同一隔離 client 的訂閱後，系統回報 `MADownloadCancelled`，其他 client 訂閱保持不變。

## 訂閱撤回實驗

- 19:52:42 至 19:52:45，隔離測試 client 申請未安裝的 Axel，確認自己的訂閱存在。
- 19:52:47，另一程序將同一測試 client 的清單替換成空陣列，Siri 確認該訂閱消失，其他 client 的訂閱前後一致。
- MobileAsset 實際記錄 `CancelAssetDownload`、`Cancel of download was successful`、`MADownloadCancelled`（48）及 `OperationCanceled`（6115）。這與僅有方法回呼的失敗候選不同。
- 後續六十秒以新程序查詢，測試訂閱持續不存在，Axel 未安裝。對同一 client 重複撤回也成功。
- 並行測試中，Axel 與 Tilde 使用不同測試 client；撤回 Axel 後 Tilde 的訂閱保持存在並完成安裝，Axel 仍未安裝。結束時僅清除兩個測試 client 的訂閱，不刪除語音資源。
- 本次未修改使用中的 `dev.contextual.language_learning.siri-speech` 或 Apple 系統 client 的訂閱。

UAF 會在取消後將舊進度標成 100%。因此「100%」本身不能證明下載完成；取消判定必須結合隔離 client 的訂閱結果與實際系統操作契約。此證據只涵蓋本機 macOS 27.0.1，不宣稱其他 OS 版本已驗證。

```sh
node docs/quality/siri-download-cancellation/verify-withdrawal.mjs
```

## 實機結果

| 測試                   | 觀察                                                                                                                          | 判定                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Hattori 訂閱與狀態查詢 | 原先未安裝。系統接受現有 helper 的 `subscribe` 申請；每次以新程序讀取 `TTSAsset.downloading` 都為 false，隨後聲音仍安裝完成。 | 此 getter 不能可靠證明現有 UAF 訂閱下載是否進行中或已停止。 |
| Hiro 訂閱後取消        | 原先未安裝。使用現有 helper 申請下載，helper 結束後，由獨立程序針對相同 catalog ID 呼叫 `cancelDownloadingThen:`。            | 取消回呼有執行，實際下載未停止。                            |

Hiro 的時間以下為 Asia/Taipei。探針 NDJSON 使用 UTC，系統進度紀錄使用 UTC+08:00。

- 14:50:11，系統接受下載申請，系統進度為 downloading。
- 14:50:13，`cancelDownloadingThen:` 回呼執行，當時聲音仍未安裝。
- 14:50:15 至 14:50:21，系統進度繼續增加，包含 10%、36%、62%、94%。
- 14:50:24，系統回報 complete，63,963,136 / 63,963,136 bytes。
- 14:50:25，新程序確認 Hiro 已可在本機取得。

既有已安裝語音的 catalog ID 在初始兩次測試後均保留。初始測試新增安裝 **Hattori 與 Hiro**；後續並行對照測試另下載完成 **Tilde**。未呼叫 purge、eliminate 或檔案刪除，測試下載完成的聲音保留於系統。初始前後比對確認 catalog 可用狀態，未對所有語音檔案做內容雜湊。

## 可重跑的唯讀檢查

在 repository 根目錄執行下列指令。Swift 探針只列出實際載入的 framework、method encoding，以及選用的目錄資料；不啟動下載、取消、取消訂閱或移除資源。沙箱可能只回傳部分目錄，不能將部分結果解讀為資源不存在。

```sh
xcrun swift -module-cache-path /tmp/cll-siri-capabilities-modules apps/local-host/scripts/siri-download-capabilities.swift
xcrun swift -module-cache-path /tmp/cll-siri-capabilities-modules apps/local-host/scripts/siri-download-capabilities.swift --catalog
node docs/quality/siri-download-cancellation/verify.mjs
```

`verify.mjs` 驗證保存的反例證據；成功輸出代表「證據一致且門檻仍未通過」，不代表取消功能可用。

完整一次性實驗原型原先位於 `/tmp/cll-siri-cancellation-probe/`，暫存原型已失效。本目錄保存可核對的記錄。產品 helper 與明確指定語音的實機驗證腳本現已加入原始碼，正常測試流程不會啟動實際下載或取消。

## 程式與系統邊界

初始 helper 的 install 分支呼叫 `DaemonSession.subscribe(voices:)`，收到接受回覆後結束。當時的狀態查詢只區分 installed／not-installed，頁面內 `AbortController` 只停止輪詢。產品整合已改用每個操作獨立的 client、持久化取消阻擋紀錄，以及明確的訂閱與排序觀察值。`DaemonSession.cancel(request:)` 仍用於語音合成請求。

實機 runtime 存在 `TTSAsset.cancelDownloadingThen:`、`MAAsset.cancelDownloadSync` 和 `MAAutoAsset.cancelActivityForSelectorSync:` 等候選方法。初始失敗實驗僅測試 `TTSAssetProxyAsset.cancelDownloadingThen:` 對原有 Siri 訂閱路徑的效果。後續隔離訂閱撤回已通過本機驗證。其他候選方法、不同下載路徑與其他 macOS 版本均未驗證。

實機已驗證 `SiriTTSService.DaemonProtocol` 的 `subscribeWithVoices:clientId:accessoryId:reply:` 可替換指定 client 的訂閱清單。產品實作應使用由本應用程式產生、以操作 UUID 隔離的 client；不能清空共用應用程式 client 或直接操作全域 `siritts` UAF 訂閱。取消使用訂閱撤回，不能使用刪除共用已安裝資源代替。

## 來源

- [固定版本的上游 SiriEngine](https://github.com/maximilianromer/siri-tts-cli/blob/092cb7944e095b89ce6ad3d76277e261791dcef1/Sources/SiriTTSCore/SiriEngine.swift)：安裝輪詢與合成取消是不同操作。
- [上游的安裝與 purge 說明](https://github.com/maximilianromer/siri-tts-cli/blob/092cb7944e095b89ce6ad3d76277e261791dcef1/README.md#voice-management)：移除資源不改變訂閱，資源可能再次下載。
- [公開 runtime 標頭的 TTSAsset](https://github.com/MTACS/iOS-17-Runtime-Headers/blob/d1d960dfaa4107765dd7fcf891e4967c0930d5fd/PrivateFrameworks/SiriTTSService.framework/TTSAsset.h)：提供候選 selector 名稱；實際本機 ABI 由唯讀探針確認。

外部來源只用於定位候選介面。門檻判定依據為本目錄保存的實機探針與系統進度紀錄。
