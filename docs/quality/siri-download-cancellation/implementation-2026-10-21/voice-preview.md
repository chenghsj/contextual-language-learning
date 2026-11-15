# 已下載聲音因缺少試聽句而停用

2026-10-21。使用者回報已下載的 Else 顯示「此聲音目前無法試聽」。

`SiriVoiceManagerPage` 的 canPreview 同時要求語音可用、服務就緒，以及對應語言的 speechSamples。Else 的 da-DK 與 Tilde 的 sv-SE 沒有試聽句，按鈕因此在發送任何 speak 前就被停用。實際 Native catalog 確認兩者均 installed true、resourceAvailable true。

現已在既有試聽句 map 補上12種缺少的語言。維持 exactVoiceId、使用當前語速、不保存語音偏好，以及不退回其他聲音的原有契約。沒有變更 UI 停用條件或使用其他聲音掩蓋問題。

新增 coverage 測試在修改前回報 `Missing Siri preview sentence for ar-SA`。補齊後，sample、speech controller 與 download-copy 相關23個測試通過。Typecheck、extension build、格式與 diff 檢查通過。

[`preview-language-coverage.json`](preview-language-coverage.json) 是最新實際 Siri helper catalog 比對結果。98個 Siri 語音涵蓋34個語言代碼變體，沒有缺少試聽句的語言。這是本機目前目錄快照，不代表未來新增語言自動已有試聽句。

[`preview-language-audio.json`](preview-language-audio.json) 保存實際已安裝 helper 對 Else 丹麥文與 Tilde 瑞典文的 render 結果，均產生非靜音 WAV。合成驗證不下載、取消或移除語音。

實際 Chrome 側欄中，Else 與 Tilde 的試聽均已啟用。點選 Else 後按鈕進入「停止朗讀」且 pressed1，結束後回到試聽 pressed0，沒有語音錯誤。[播放中的 AX 紀錄](else-preview-playing.txt) 與[實際頁面截圖](../ui/actual-else-preview-enabled.jpg) 保存此結果。頁面重新開啟與篩選選擇不會更動已保存語音偏好。

Fix Root Causes 原則使修正落在缺少的原語言試聽句，而不是跳過 exact voice 檢查。Prove It Works 原則使驗證同時包含實際 Native 音訊與實際側欄播放。

[獨立 gpt-6.1-sol 複查](native-preview-review.md) 沒有重大未解決項目，另獨立跑過 sample 測試與9項 Swift 原生測試。此次複查也補足先前因額度不足而中斷的 canonical version 比對審閱。審閱者沒有操作 UI 或播放音訊，實機結果由 root 驗證。
