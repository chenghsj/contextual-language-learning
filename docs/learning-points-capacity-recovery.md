# 推理輸出預算與截斷恢復

2026-10-11。這次只修正 Host 的輸出容量與失敗恢復，保留使用者選擇的推理強度、來源、已完成結果與凍結模型。

## 實際症狀

任務 `b205ebf3-1d7a-4293-a8e8-74df4491bc41` 使用 Antigravity / Gemini 3.7 Flash、`high`、提示詞 v8、309 條字幕。耗時 84 分 42 秒，91 次模型呼叫，其中 31 次修復；60 次輸出接近 8,192 token 上限，總輸出用量約 94% 為 reasoning。最後 `s2` 與 `s2-repair` 分別回報 output 8,188 / 8,187、reasoning 7,864 / 7,865，最後保存為 JSON 格式錯誤。

Antigravity SDK 將 candidatesTokenCount + thoughtsTokenCount 計入 usage.output。原流程固定從 8,192 開始；明確截斷的多句批次仍先以同額度修復一次，JSON 解析失敗則完全走結構修復，即使已用完額度。這是本次可以在離線測試重現並修正的重複呼叫問題。先前同一集的 33 分 30 秒任務有 93 次呼叫；服務回應間隔也有差異，因此不能將全部耗時歸因於重試或承諾修正後的整集速度。

## 修正

- 起始預算：high / xhigh 32,768、medium 16,384，其餘 8,192。仍取模型 max output 與 context / 4 的最小值，並保留 1,024 input safety tokens。預估與實際生成使用相同政策，沒有改動推理強度。
- 明確截斷的候選與多句教學批次直接拆批；單句教學仍以倍增額度恢復，直到模型、context 或 input 空間上限，不消耗新的結構修復額度。
- 若 JSON 無法解析且回報 output 達本次額度的 98%，分類為疑似截斷並進入容量恢復。這是有用量依據的判斷，不是 provider stop reason 的證明。完整有效 JSON 即使接近上限仍正常接受；一般解析／結構錯誤仍只有一次修復。
- 舊 checkpoint 若保存為 validation_error，但對應模型呼叫是近上限的 invalid lesson JSON，也使用相同恢復路徑。保存的倍增預算在中斷後沿用；成功批次跳過。
- 明確支援提示詞 v8 續跑，封存 v8 規則與輸出契約，不把既有結果標成 v10。新任務仍使用 v10；其他未支援版本、改動的來源／模型／工作流程／策略仍拒絕續跑。
- 呼叫證據新增有效 outputTokenBudget、provider stopReason、durationMs，沒有記錄原始回應或憑證。舊紀錄缺少這些欄位時仍可讀取。

v8 封存檔取自修正前實際安裝的 Host，SHA256：`23d30a1257192ed65c4f40be441194e3fb3128796d3e49cda48af27544ca3899`。封存的 system 與四個 stage prompt，在 8,192 / 32,768 預算下，與原 bundle 產生的完整字串逐位元比對一致。

## 驗證界線

修正前的三項測試皆失敗：多句截斷呼叫 2 次而非 1 次；high 起始 8,192 而非 32,768；未回報 length 的近上限 JSON 錯誤走入同額度修復。修正後通過，並涵蓋有效 JSON、一般格式錯誤、模型／context 上限、中斷預算保存、舊 v8 與既有修復額度。

真實任務只讀取後複製到暫存庫，再以離線 generator 在下一次推論前停止。確認下一個呼叫已從 8 個 utterances / 8,192 token 改為 4 個 / 32,768，保留 high 與 v8；15 個已完成批次、選材、來源、91 筆歷史呼叫完全相同。凍結 request fingerprint 驗證通過，原使用者 checkpoint 檔案 SHA256 前後相同。沒有替使用者送出整集或宣稱整集續跑已完成。

定向 pipeline / core / job / estimate 47 項、SDK 5 項、installer 16 項通過。SDK 的兩個 localhost OAuth 測試在沙箱失敗；取得 loopback 權限後重跑通過。三個 workspace 的 TypeScript 檢查通過。Host build、bundle smoke 與安裝結果另記於下方。

## 安裝

Host build、standalone SDK bundle 測試與隔離庫的 Native Host protocol 10 smoke 通過。已安裝到 Chrome 開發版 ID `agkdfdbgkoeooffhfkonpdkgfeldjifi`；manifest、launcher 與 bundle 路徑核對一致，本機與已安裝 bundle SHA256 相同：`e5f61aa51e936164372c313f82d59c3f7c4a952efcac546d4033151d9ca864ac`。新任務用 v10，支援 v8 原任務續跑。既有連線程序需重新連線；未操作使用者畫面的續跑按鈕，尚無修正後整集推論的速度與完成結果。
