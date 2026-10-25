# 記錄供應商付款

在「進貨管理」選一張已登錄請款的進貨單，按「記錄付款」。畫面先帶入這張請款單的未付餘額，確認這次實際付多少、使用銀行或本班次現金，再按「已付款，記好這筆」。備註放在選填區。這只保存已發生的付款，不執行銀行轉帳。

金額保留原文，接受全形數字、正確千分位及最多兩位小數。`1e2`、負數、多餘小數及混雜文字不會默默轉成另一個金額。小額分次付款也會依原有精確分幣規則計算餘額。

未保存的金額、方式與備註，按店面、還原世代及帳號保存在目前裝置。「先保留輸入」可稍後繼續；重新載入也能接回。同一份輸入受 Web Lock 保護。銀行、請款單、供應商或班次的實際內容改變時，先核對最新資料；明確更新餘額與班次後，原金額與備註仍保留。

保存前先固定原編號與完整命令摘要。完整命令沿用原本的統一待確認交易保存，私人草稿只存小型來源摘要與原文，避免把大型進貨單再複製一份。真正送出前，再核對兩者完全一致。

回覆不明時按「核對原付款」，系統唯讀核對已保存的原始操作、實際採購付款文件及現金流水；有結果才清除這筆輸入。原付款已被沖銷，會如實顯示，不能藉舊輸入重新建立。另一筆待確認交易不會被這次核對清除。確定原筆尚未保存且完整命令仍在本機，才可明確沿用原編號繼續。完整命令或原紀錄損壞時保留輸入核對，不推測付款是否成功。

沿用原有採購付款、供應商核准、應付餘額、現金班次、庫存成本與備份規則，不另建付款台帳，也不改寫已關班的資料。唯讀核對使用完整現金資料，不受畫面 500 筆上限影響。還原後的舊世代草稿不能直接套用到新帳。

隔離驗證：

```sh
npx vitest run tests/security/purchase-payment-draft.test.jsx tests/security/procurement.test.js tests/security/procurement-ui.test.jsx tests/security/procurement-ledger.test.js tests/security/purchase-draft.test.js tests/security/expense-drawer.test.jsx
node scripts/run-native-security.cjs --purchase-payment
npm run build
node scripts/run-native-security.cjs --purchase-payment-ui
node scripts/run-native-security.cjs --purchase-payment-browser-ui
node scripts/run-native-security.cjs --procurement-ui
```

覆蓋原生 SQLite／preload／IPC、已驗證 HTTPS 共用店面、獨立瀏覽器、重啟、真實回覆遺失、交易及私人容量不足、後段回滾、唯一原筆、後續沖銷、兩台裝置競爭餘額、班次改變、備份與另一筆待確認交易。付款視窗有四語、兩風格、360px 與至少 48px 控制的實際畫面。驗證屬原始碼的隔離流程，老人與小孩真人、實體手機及公開安裝版仍未驗收；請款登錄、預付款與其他日常表單各自保留原流程及待驗收範圍。
