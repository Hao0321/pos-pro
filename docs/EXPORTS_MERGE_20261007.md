# POS exports 整併紀錄 — 2026-10-07

來源：`C:\Users\Hao0321\Documents\LocalWorkspace\exports`
主專案：`D:\POS\pos-system`
完整交付資料：`D:\POS\imported-exports\20261007`

26 個 POS 頂層項目（10 個資料夾、16 個檔案）已保存於主專案旁，包含 277 個原始檔案，共 3,868,958 bytes。逐檔 SHA-256 比對一致後，已將 exports 中這 26 個項目搬入完整交付資料目錄的 source-originals/，exports 中的 POS 項目已清空。永久刪除的工具呼叫被自動安全審核拒絕（blocked by policy），因此採用可還原的搬移，沒有永久刪除原檔。exports 的其他專案未由本次操作修改。

## 合併進主專案的內容

- `electron/database.js`：套用 R1 四處差異，修復舊商品表索引建立順序、進貨匯入 paidDate、備份還原外鍵刪除順序。現行 70 個原始檔案均符合交付基準，沒有覆蓋本機新增修改。
- `src/utils/checkoutSafety.mjs`、`src/utils/checkoutCoordinator.mjs`、`electron/checkoutSafety.cjs`、`electron/checkoutContract.cjs`：加入 R6 最新四個獨立模組，與 R6 交付雜湊完全相同。
- `.gitattributes`：將新 checkout 模組固定為 LF，確保 Windows Git checkout 後仍保持已驗證雜湊及 ESM／CommonJS 生成內容一致。
- `tests/exports-r6/`：合併 138 個 R6 模組與故障回歸測試。只調整測試 runner 為 Vitest，以及指向實際主專案模組的匯入路徑；測試斷言保留。
- `docs/ERP_IMPLEMENTATION_BLUEPRINT.md`、`docs/erp-contracts/`：保存 ERP 規格、資料契約、合成範例及尚未執行的業務驗收清單。

R6 模組已加入程式碼與測試，但交付內容沒有原生資料庫／React 結帳接線，因此現行收銀 UI 尚未使用新模組。未重新打包 Windows 安裝檔。

## 保留的交付與未啟用內容

所有輪次資料、壓縮包、基準快照、說明與證據均保存在完整交付資料目錄，原始內容未修改。未將各輪舊 project 快照依序覆蓋主程式。

- R3 `operationsHealth.mjs` 是尚有已知限制的草稿，留在原交付資料中。
- R4、R7、R9 的完整程式包不在 exports 中，只有交接文件／基準資料；R8 只有狀態文件。
- R10 的八份參考碼和兩份補丁完整保留，但配套 `POS_20261005_R10_Native_Checkout_Modules_and_Tests.zip` 未出現在 exports 或 Downloads。該包七個必要模組缺失，沒有套用會造成缺少 import／require 的接線補丁。

## 驗證

- 合併前既有 Vitest：76 通過。
- 合併後 Vitest：214 通過、0 失敗（原有 76 + R6 138）。
- `npm run build`：成功，已更新 `dist/`。
- 五個合併程式檔的 Node 語法檢查通過。
- Electron 33.4.11／內建 Node 20.18.3／better-sqlite3：以 `:memory:` 重現三個 R1 原版失敗情境，合併版全部通過。包含旧商品表遷移、paidDate 保留／缺值、已有訂單明細的備份還原。
- `git diff --check` 通過。`database.js` 的 Windows 換行保留，正規化換行後內容與 R1 交付一致。
- 沒有開啟實際營業資料庫。

`merge-manifest.json` 保存原始路徑、檔案大小、SHA-256、搬移清理狀態及原 Git HEAD。source-originals/ 保存移出的原檔，與先前驗證副本逐檔一致。`pre-merge/electron/database.js` 保存修改前檔案；`verification/` 保存原生 SQLite 驗證腳本與結果。
