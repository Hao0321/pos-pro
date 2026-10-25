# 會員建檔與資料修改

到「會員」按「新增會員」，先填姓名、手機即可。生日與備註收在「生日、備註（選填）」裡，之後再補也可以。

尚未填完時按「稍後再填」。回到會員頁按「接著新增會員」或「接著修改會員」，可接續同一份輸入；重新載入也會保留。草稿依店面、資料還原世代與登入帳號隔離，不會自動交給另一位操作人員。另一個視窗使用同一份草稿時，會等待原視窗離開會員頁後再接手。

相同手機已有人使用時，先核對姓名：按「開啟這位會員」會回到原會員；若家人共用手機，按「仍新增另一位會員」才建立不同會員。系統不會自動把兩人合併。

修改資料時，畫面會標示原會員。未改動的欄位沿用最新資料；同一欄位已被另一台裝置修改時，先比較「我的輸入」與「目前資料」，再選「採用最新資料」或「保留我的修改」。按儲存後才會生效。

保存途中斷訊時，按「核對上次會員保存」。確認尚未找到原紀錄後，才會出現「用原編號再保存」。不要另外新增一次；原編號可避免同一份要求重複建檔。

此流程只修改姓名、手機、生日與備註。點數、儲值餘額、累計消費、等級與生日加點紀錄，沿用原來的交易與會員資料，不由這份表單改動。

若裝置無法保留草稿，畫面會保留當前輸入並顯示提醒，確認保存前請先恢復儲存空間。不要把頁面仍顯示內容誤認為已保存。

## 工程驗證

需要專案支援的 Node.js 與已安裝依賴。以下檢查使用隔離資料，不使用正式店面。

```text
node node_modules/vite/bin/vite.js build
node node_modules/vitest/vitest.mjs run tests/security/member-profile.test.js tests/security/member-profile-ui.test.jsx
node scripts/run-native-security.cjs --member-profile-state
node scripts/run-native-security.cjs --member-profile-ui
node scripts/run-native-security.cjs --member-profile-browser-ui
```

桌面、配對 HTTPS 與獨立瀏覽器分別驗證。手機尺寸的 Chromium、自動測試與截圖不代表實體手機、長者或兒童真人驗收；兌換券與完整企業 CRM 也不屬於本次會員建檔的完成範圍。
