# Chrome worker 計時器錯誤與恢復

2026-10-21。使用者回報 Samer 的下載與取消顯示 `Illegal invocation`。實際 Chrome Dev 側欄也出現 Martin 與 Carmen 的同類工作。

## 原因與修正

`SpeechDownloadController` 的預設計時器為 `{ set: setTimeout, clear: clearTimeout }`。`maintainPolling` 呼叫 `this.timers.set` 時，Chrome Worker 的 Web API 收到 timers 物件作為 receiver，因而拒絕執行。保存工作之後的 publish 會啟動輪詢，所以錯誤阻止後續 Native dispatch，留下正在申請或正在取消的持久化紀錄。

根據實際 Service Worker DevTools 的重現，以下呼叫回報 `TypeError: Illegal invocation at <anonymous>:1:91`。

```js
const timers = { set: setTimeout, clear: clearTimeout };
const id = timers.set(() => {}, 0);
timers.clear(id);
```

預設計時器改為 callback wrapper，讓兩個 Web API 以全域函式方式呼叫。沒有改動工作 schema、取消契約或保存資料。

```js
const timers = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: id => clearTimeout(id),
};
const id = timers.set(() => {}, 0);
timers.clear(id);
```

同一實際 Service Worker 執行修正版探針通過。這是實際 Web API receiver 驗證，Node 與注入假的 timer 並不具有此限制。沒有新增只模仿該限制的 Node mock 測試。

## 已保存工作的恢復

修正版載入後，實際 Chrome storage 唯讀查詢回報以下三筆工作均為 `cancelled`，`dispatch` 為 `intent`，`cancelRequested` 與 `withdrawalSettled` 均為 true。

- Samer，`e7f83af6-3501-4580-85bd-a71a7e17df01`。
- Martin，`bdb51721-813b-4663-a2e6-371f21863635`。
- Carmen，`5633586d-b6a1-4d4a-a95c-b160f2a0be4c`。

這些工作在開始 dispatch 前就被計時器錯誤打斷。恢復會保留使用者的取消要求，建立取消阻擋紀錄，不重播開始下載。這不表示三個資源曾有實際傳輸。

## 實際側欄驗證

之後實際活動頁顯示 Nora 等待 macOS 下載，三筆舊工作顯示已取消。關閉整個 Chrome 側欄，重新開啟並進入活動頁後，Nora 工作保留並變成已下載，沒有 `Illegal invocation`。Nora 的下載由使用者啟動，驗證未取消這筆工作，也未移除完成的資源。

[`actual-sidebar-reopen.txt`](actual-sidebar-reopen.txt) 保存重新開啟後的 AX 狀態。[實際活動頁截圖](../ui/actual-activity-recovered.jpg) 保存下載完成與取消工作。先前記錄為未完成的實際側欄下載中關閉再開啟驗收，現已有這次實際觀察補足。最新 helper 的完整並行下載實驗仍未重跑，本次沒有變更 helper。

Controller 測試 10/10 通過，`pnpm typecheck`、格式與 diff 檢查通過。[獨立 gpt-6.1-sol 審閱](timer-review.md) 沒有重大未解決項目。審閱者未操作 UI，實際 Chrome 驗證由 root 執行。
