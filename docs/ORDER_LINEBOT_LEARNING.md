# order-linebot 學習與採用決策

日期：2026-10-07。用途：保存來源查核、可採用的設計及後續實作依據。本次是研究與規格整理，沒有修改 POS 收銀程式或部署 LINE Bot。

參考專案：[macpaul/order-linebot](https://github.com/macpaul/order-linebot)。本機查核凍結於 commit `b44ed9fca0d5ff556ff7025a513bf35dcb0476fa`，避免日後用新版 README 回推本次結果。

## 採用的設計

| 觀察 | POS Pro 的採用方式 | 優先順序 |
| --- | --- | --- |
| 在使用者熟悉的 LINE 裡完成操作 | 客人可從 LINE 或 QR 開菜單；店員仍在同一個 POS 接單。LINE 是選用入口 | 交易核心可靠後 |
| 快捷按鈕、預填範例、分頁菜單 | 起步畫面用少量大按鈕；商品多時提供搜尋與分頁；引導直接帶到下一步 | 起步流程 |
| 簡短點餐語法 | 可研究「雞腿飯 +2」等確定性解析；未知商品、歧義、負數數量均要求修正或確認 | 接單功能 |
| 截止時間與取消範圍 | 預訂、接單、付款、出貨分開建模；依本人／店員權限核對，保留取消理由 | 訂單功能 |
| 成功後回傳清楚收據 | 以已保存交易回執產生訂單與找零結果；未確認不得顯示成功 | 第一優先 |
| 店家可用熟悉的表格維護菜單 | 提供 CSV 範本、匯入預覽、錯誤列提示；Sheets 可作選用交換格式 | 商品與匯出 |
| 無外部 AI 才能完成的依賴 | 基本收銀、商品、報表、點餐解析都可用一般程式完成，維持零 API 費的核心路徑 | 全程 |

來源：[專案 README](https://github.com/macpaul/order-linebot/blob/b44ed9fca0d5ff556ff7025a513bf35dcb0476fa/README.md)、[互動菜單](https://github.com/macpaul/order-linebot/blob/b44ed9fca0d5ff556ff7025a513bf35dcb0476fa/src/FlexMessage.js)、[指令處理](https://github.com/macpaul/order-linebot/blob/b44ed9fca0d5ff556ff7025a513bf35dcb0476fa/src/OrderService.js)。以上是設計採用決策，尚未完成 POS 整合。

## 免費能力的查核

截至 2026-10-07，LINE Reply API 不計入訊息費用；Push 等主動發送計入訊息數。參考專案的 `notifyOrganizer` 與部分回覆失敗後的 fallback 使用 Push，因此實際成本仍受帳號配額影響。

台灣 LINE 官方公告：2026-11-01 起中、高用量月費將調整；輕用量仍為月費 0 元、每月 200 則計費訊息額度。因此不可把「使用 Reply API」延伸成所有主動通知永遠不限量免費。實作時需區分回覆、店內查詢與主動通知，並以即時供應商配額為準。

來源：[LINE 訊息計費規則](https://developers.line.biz/en/faq/tags/line-official-account/)、[台灣 2026 方案公告](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)。

Google Apps Script 亦有執行與每日配額。官方目前列出個人帳號每日 20,000 次 URL Fetch、每次執行 6 分鐘及每人同時 30 個執行，並保留變動配額的可能。它適合評估低量接單與交換資料；沒有可據此保證的無限容量或離線交易能力。

來源：[Google Apps Script 配額](https://developers.google.com/apps-script/guides/services/quotas)。

## 實際執行結果與採用界線

1. 凍結版本的原有 Node 測試套件，在禁止外部 fetch 的條件下 exit code 0。這是模擬環境結果，沒有驗證 GAS 部署、真實 LINE 回覆、尖峰流量或 POS 金流。
2. 對實際 `Code.js` 的 `doPost` 做合成資料實驗，設定測試用 channel secret、替換資料寫入端：缺少簽章的請求回傳 200，進入異動 handler 1 次；無效簽章回傳 403，handler 0 次；有效簽章進入 handler 1 次。
3. 相同有效 `webhookEventId`、相同內容提交兩次，handler 被呼叫 2 次。這證明此入口未替上述測試事件去重，並不等於測量了正式試算表訂單或所有執行環境。
4. 使用同一組輸入校準檢查：要求有效 HMAC 與唯一事件編號的記憶體正控制只處理 1 次，拒絕無簽章；原入口作負控制。正控制只驗證量測方式，並非交付的正式耐久去重實作。

決策：學習互動設計；未來 LINE 接線另行實作「先驗證原始內容簽章、再解析、再耐久去重、再保存、最後回覆」的流程。

來源：[受測入口](https://github.com/macpaul/order-linebot/blob/b44ed9fca0d5ff556ff7025a513bf35dcb0476fa/src/Code.js#L342-L438)、[LINE 簽章要求](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)。實驗腳本、輸入、runtime、hash、stdout 及結果保存在專案本機 `.rd/micro-merchant-20261007/`。

## 對現有 POS 的影響

| 現有程式觀察 | 後續應完成的閉環 | 證據狀態 |
| --- | --- | --- |
| `useStore.checkout` 在呼叫 `dbCheckout` 前更新狀態並清空購物車 | 保存成功才發布庫存、會員及收據；拒絕、斷線或結果不明時保留原單身份與購物車 | 已讀取原始碼；尚未完成 UI 故障重播 |
| `dataAccess.saveLS` 捕捉寫入錯誤後不回傳失敗 | 持久化失敗必須傳到交易入口及畫面，禁止顯示已保存 | 已讀取原始碼；手機實機未測 |
| `LoginScreen.initUsers` 依版本標記重建帳號，桌面分支會刪除舊帳號 | 初次建立與既有帳號遷移分開；更新保留自訂帳號，遷移先驗證及保留回復能力 | 已讀取原始碼；未存取營業帳號 |
| App 登入可自動 pull 雲端並重新載入 | 明確記錄未同步異動與世代；解決衝突後才套用，不依登入動作覆蓋本機 | 已讀取原始碼；未測正式雲端 |
| 顧客點餐資料層主要綁 Electron | 免費手機模式要有共用、可驗證的接單契約與本機交易核心 | 架構觀察；尚未實作 |

本次沒有把 R6 模組測試通過當成主程式已接線，也沒有把 R10 缺少的配套模組視為可直接套用。

## 授權與保存

參考專案 `package.json` 宣告 `AGPL-3.0-or-later`，並附 AGPLv3 LICENSE。本次沒有把它的業務程式碼複製進 POS Pro；已保存來源版本、設計觀察和獨立實驗。若之後採用實際程式碼，須另核對適用授權及交付方式。

來源：[授權文件](https://github.com/macpaul/order-linebot/blob/b44ed9fca0d5ff556ff7025a513bf35dcb0476fa/LICENSE)。專案內可持續維護的產品規格見 [全功能免費產品規格](FREE_POS_PRODUCT_SPEC.md)，開發次序見 [開發與驗收清單](FREE_POS_BACKLOG.md)。
