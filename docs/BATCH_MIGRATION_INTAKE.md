# 一次交齊搬家資料

首頁 →「Agent 幫我搬家」→ 一次選擇或拖入原始 CSV、TSV、XLSX。畫面會顯示檔案總數，展開可核對每份檔名。單份 Agent JSON 或既有單檔表格仍沿用原入口。

系統完整保留原始文字、Excel 檔案與工作表，再依內容帶到商品／供應商／客戶主檔，或庫存／未收／未付的整批期初核對。只有主檔的批次不需要填造一筆欠款。來源店名、幣別、欄位或日期不明時須補充實際資料，不能猜成零或新台幣。確認前不會改動營運資料。

一次最多 20 份原始表格；CSV／TSV 單份最多 80,000 bytes、XLSX 單份最多 120,000 bytes。整批原文與 Base64 合計最多 200,000 bytes，完整草稿最多 250,000 bytes、50 張表、5,000 列。重複、無法讀取或超限的批次會整批拒絕，保留原草稿。成功換入另一批時，舊草稿可從「Agent 與備份」下載。

保存回覆中斷，沿用原編號核對上次結果，不要再搬一批。原始來源、核對選擇與回執會保留在完整備份。新整批來源提交後使用相容性保護版本 21；舊格式單檔仍維持原保護版本。舊程式無法解讀新來源或帳本時應使用相容版本，不能繼續覆寫。

此功能沿用既有主檔、庫存成本與往來帳交易。儲值、點數、任意歷史資料、其他幣別換算與所有廠商的完整換機仍未驗收。真人、實體手機、完整安全與安裝檔交付另列未完成項目。

Agent 格式：[批次 Schema](../public/agent/migration-batch-v1.schema.json)、[原檔保留與核對規則](../public/agent/guides/batch-migration.txt)。Schema 通過不等於保存成功，也不授權 Agent 自行送單。

開發驗證使用 scripts/run-native-security.cjs 的 --migration-batch-state、--migration-batch-ui、--migration-batch-browser-ui。相容性測試需提供 POS_PRECEDING_BATCH_SOURCE_COPY（保留的 M45 原始碼與雜湊清單），瀏覽器測試需 POS_BATCH_MIGRATION_PHASE（含原建置收據與 preceding-dist）。瀏覽器可用 POS_MIGRATION_BATCH_MODE=masters|stock|mixed 選情境，預設 mixed。缺少真實前版資料時會拒絕宣稱相容性通過。
