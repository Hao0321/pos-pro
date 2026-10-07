# 選用的 Supabase 雲端同步

POS 所有功能對所有使用者免費。核心資料存在本機，不需要付費雲端或指定硬體；選擇外部雲端時，其價格、配額與服務條款依 [Supabase 官方說明](https://supabase.com/pricing)。

目前同步是手動上傳／拉取完整資料，尚未提供多台裝置同時編輯的合併演算法。建議選一台主要編輯裝置，拉取前確認本機備份；登入 POS 不會自動從雲端覆蓋資料。

## 新專案

1. 在 Supabase 建立專案，資料庫密碼存於密碼管理員。
2. 在 SQL Editor 執行本專案 [supabase/schema.sql](supabase/schema.sql)。13 張業務資料表會啟用 RLS，資料列的 `owner_id` 取自登入的雲端身份；員工 `users` 表拒絕前端存取。
3. 使用 Supabase Auth 建立自己的雲端使用者，依專案的 Email 驗證設定完成驗證。不同裝置登入相同雲端身份才會看見同一份資料。POS 本機員工帳號與這個身份分開管理。
4. 老闆登入 POS → 設定 → 雲端同步，填入 HTTPS Project URL 和公開 publishable／anon key，儲存後用自己的雲端 Email 和密碼登入。禁止填入 secret／service_role key。
5. 完成登入後測試連線。在具有完整資料的主要裝置手動推上雲端，再在另一台裝置拉取。

上傳與拉取都會先驗證雲端身份。拉取覆蓋前建立本機備份；若拉取期間本機資料已變動，系統取消覆蓋。上傳仍採逐表 upsert，途中中斷可能只完成部分資料，需保留主要裝置並重試、核對。

## 已有專案的更新

先從 Supabase 與 POS 分別匯出備份，再執行新的 schema。這是雲端管理者的操作，本次本機修正沒有替你連線或修改任何正式雲端專案。

舊資料的 `owner_id` 可能為空。系統會保留它們並拒絕前端讀取，直到資料庫管理者確認資料歸屬後逐批遷移。請以已確認的 Auth UUID 和明確資料列 ID 設定歸屬；不要把所有店家的舊資料一律交給同一個身份。

新的 restrictive policy 限制舊 permissive policy 擴大授權。仍需在自己的專案驗證：已登入者能讀寫自己的資料；匿名者與另一個雲端身份不能讀取或改寫；前端不能讀取員工密碼雜湊。不要關閉 RLS 解決連線問題。

## 同步與備份範圍

同步商品、會員、訂單、供應商、進貨、促銷、會計分錄、掛單、班別、現金流水、損耗、儲值和稽核日誌。員工帳號、印表機等本機設定與備份檔不會上傳。

完整本機備份包含 14 類業務資料與員工帳號。桌面與瀏覽器各自匯出適用於該儲存模式的 JSON；請保管包含個資與密碼雜湊的備份。還原會取代指定的資料集合，匯入格式或資料不正確時原資料會保留。

公開 publishable／anon key 用於識別專案；資料權限必須由 Auth 和 RLS 管控，不能把隱藏公開 key 當作存取控制。[API key 說明](https://supabase.com/docs/guides/api/api-keys)、[RLS 說明](https://supabase.com/docs/guides/database/postgres/row-level-security)。
