# 抽屜支出與現金退回

開班後，到「會計帳務 → 記錄費用」，填金額與用途。錢從收銀抽屜拿出時按「從抽屜付出並記帳」；用其他現金付款時選「用抽屜以外的錢付，僅記費用」。銀行、尚未付款及舊支出草稿沿用原有記帳方式。

抽屜支出一次保存費用分錄、現金支出與原操作回執。原有現金流水不再產生另一筆費用，所以支出 10 元只認列 10 元費用、抽屜預計現金減 10 元。店主權限、目前班次、店面與還原世代、實際當日日期及抽屜預計餘額都在同一交易內核對；資料使用完整班次流水，包含超過畫面 500 筆上限的歷史。

錢真的退回時，在「日記帳」按該筆的「記錄現金退回」，核對金額與目前班次，再按「現金已退回，記好退回」。原支出與原抽屜支出保留，系統另記實際退回日的反向分錄，並把現金收進退回當時的班次。已關班的紀錄不會被改寫。沒有實際退回可按「還沒退回，先保留」；尚未開班時先前往開班。日期或班次改變會要求重新確認。

本流程記錄已發生的現金移動，不執行銀行付款或退款。每筆支出限全額退回一次；部分退回尚未支援。重複按鈕、另一台裝置競爭及回覆不明都沿用固定原編號核對。別台已記錄退回時，會顯示對方已保存的證明，請核對實體現金，避免實際重複退錢。退回有獨立草稿，不會蓋掉另一份支出輸入。

SQLite 使用一個交易保存兩個財務來源與不可直接改寫的回執。獨立瀏覽器使用一個原子資料紀錄與 Web Lock。配對的原始分錄或現金缺失、內容改動或無法核對時會保留待確認輸入，禁止直接刪改及錯誤關班。完整備份保留關聯；還原後舊世代的未完成寫入不能直接套用，仍可重新核對現有支出並記錄實際退回。

第一次使用抽屜支出會安裝 SQLite `expense-drawer-v1` 版本保護，或升級瀏覽器原子紀錄至 version3。前一版程式無法覆寫這些資料。瀏覽器還原到功能使用前的備份，也保留新版寫入限制。需回滾程式時，先保留完整備份與相容版本，不能移除版本保護後讓舊版寫入。

隔離驗證命令：

```sh
npx vitest run tests/security/expense-drawer.test.jsx tests/security/expense-entry.test.jsx tests/security/cash-count.test.js tests/security/cash-movement-draft.test.js tests/security/stock-accounting.test.js
node scripts/run-native-security.cjs --expense-drawer
npm run build
node scripts/run-native-security.cjs --expense-drawer-ui
```

舊版相容性檢查需先準備 M39 來源與由同一來源建置的靜態頁面，分別設定 `POS_EXPENSE_DRAWER_PRECEDING_SOURCE`、`POS_EXPENSE_DRAWER_PRECEDING_DIST`。預設目錄為 `.rd/expense-drawer-previous-source`、`.rd/expense-drawer-previous-dist`；缺少基準檔案會失敗，不會以通過代替。

```sh
node scripts/run-native-security.cjs --expense-drawer-compat
node scripts/run-native-security.cjs --expense-drawer-browser-ui
```

涵蓋原生 SQLite／preload／IPC、已驗證 HTTPS 身分的共用店面、獨立瀏覽器、原子寫入中斷、容量與讀取失敗、原筆重啟復原、兩裝置現金競爭與唯一退回、跨日與新班次、完整備份、前一版原生／瀏覽器寫入控制，以及四語、兩風格、360px、48px 控制。這些是原始碼的隔離自動測試；實體手機、老人與小孩的真人使用、所有歷史版本、公開安裝版及全系統驗收仍未完成。
