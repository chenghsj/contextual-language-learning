# 已停用的 AI 全案接受判定

`editorial-gate/` 原樣保存本次政策調整前的 AI 判定、接受案數、待審文件與舊離線工具，供追溯當時做法。它們不再是目前產品或 Chrome 測試的前置條件。

- [原接受紀錄](./editorial-gate/acceptance.json)
- [原審查目錄](./editorial-gate/reviews/)
- [原完整核對結果](./editorial-gate/generation-verification.json)
- [歷史檔案雜湊](./editorial-gate/manifest.json)

檔案中的相對教材／trace 路徑仍以原 prompts-20 目錄為根，不是此歷史目錄。舊工具僅保存來源，不應在此目錄執行。原始生成教材、請求與回傳仍留在原位置，沒有更動。

目前使用 [validation.json](../validation.json) 和 [新核對工具](../verify.mts)，只核對證據與報告覆蓋；不將歷史判定重寫為全部內容通過。
