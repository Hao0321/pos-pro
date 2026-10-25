# 損耗記錄

到「損耗管理」按「新增損耗」，選商品、填數量、選原因，再按「確認記錄」。畫面會顯示商品單位與記錄後的可用庫存。數量可用小數、全形或正確千分位，最多三位小數；例如 `0.125`、`.125` 或 `１,０００.１２５`。

到期商品的「報廢」會先帶入商品與一個庫存單位，仍須在表單核對實際數量後確認。若這個商品須依批次處理，沿用「批次與效期」的報廢流程。

成本由既有庫存與成本紀錄自動計算，不需要手填成本。已記錄的原始來源成本，不會因為後來修改商品參考價格而被改寫。

尚未完成時按「稍後再填」，回來按「接著完成損耗記錄」，重新載入也能接續。草稿依店面、登入帳號與還原世代隔離；另一個視窗須等原視窗離開損耗頁後再接手。

保存途中斷訊時，按「核對原損耗」。尚未找到時再「用原編號再核對」，不要另記一筆。原庫存異動與成本回執確認後才會清掉草稿，避免再次扣庫存。商品或單位改動時，先明確核對，再確認數量。

若裝置無法保留草稿，系統會停止送出並保留目前畫面。已扣庫並入帳的損耗，沿用原有盤點與會計更正流程。

## 工程驗證

```text
node node_modules/vite/bin/vite.js build
node node_modules/vitest/vitest.mjs run tests/security/waste-entry-draft.test.js tests/security/waste-ui.test.jsx tests/security/stock-waste-costs.test.js
node scripts/run-native-security.cjs --waste-entry-state
node scripts/run-native-security.cjs --waste-entry-ui
node scripts/run-native-security.cjs --waste-entry-browser-ui
```

驗證使用隔離資料，分別檢查原生、HTTPS 配對及獨立瀏覽器。手機尺寸的 Chromium 與自動流程不代表實體手機、長者或兒童真人已完成驗收。
