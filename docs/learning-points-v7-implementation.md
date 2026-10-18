# V7 教材與歷史驗收

目前 V7 仍是教材格式。生成的 prompt 與流程版本由 [核心契約](../packages/core/src/schema.ts) 定義；歷史 V7 結果不能直接作為目前生成品質的通過依據。

舊 prompts-12／13 的完整 N3／N1 教材、模型審查紀錄、28 組歷史接受結果及原版文件，已於 2026-10-18 隨驗收資料歸檔至儲存庫外。原始文件完整保留於 ZIP 的同一路徑。

- 現行生成流程：[生成主流程](../apps/local-host/src/generation/learning-points-pipeline.ts)。
- 固定測試輸入、新一輪準備指令與歸檔位置：[品質驗收資料](./quality/README.md)。
- App、Host 與教材資料流：[架構](./architecture.md)。

本次整理沒有重新生成或重新接受教材，也沒有搬移產品 `data-v7` 中的教材與任務。
