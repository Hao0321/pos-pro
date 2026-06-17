# 雲端同步設定教學 (Supabase)

POS Pro v2.3.0 起支援用 Supabase 做跨裝置同步。本指南帶你 10 分鐘設定完成。

## 為什麼用 Supabase？

- **免費額度足夠單店家**：500MB 資料庫、不限 API 呼叫次數、50,000 月活用戶
- **零維運**：託管在雲端，不用自己架伺服器
- **跨裝置一致**：iPhone 改一筆 → 桌機點「拉取」就同步

## 設定步驟

### 1. 註冊 Supabase 帳號

1. 開 [https://supabase.com](https://supabase.com)
2. 點右上 **Start your project** → 用 GitHub 或 Email 登入

### 2. 建一個新專案

1. 登入後點 **New Project**
2. 選一個 Organization（沒有就建一個，名字隨便取，例如 "personal"）
3. 填寫：
   - **Name**：`pos-pro`（隨便）
   - **Database Password**：隨機產生並**存到密碼管理員**（之後找不回）
   - **Region**：選 `Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)`，台灣連線最快
   - **Pricing Plan**：Free
4. 點 **Create new project**，等 1-2 分鐘建立完成

### 3. 建立資料表 Schema

1. 進入專案後，左側選 **SQL Editor**
2. 點 **+ New query**
3. 開啟本專案 `supabase/schema.sql` 檔，整個複製貼上
4. 點右下 **Run**（或 Ctrl+Enter）
5. 看到 `Success. No rows returned` 就成功了

### 4. 複製連線資訊

1. 左側 **Settings** (齒輪圖示) → **API**
2. 複製：
   - **Project URL**：類似 `https://xxxxx.supabase.co`
   - **Project API keys → anon / public**：一段很長的 `eyJhbGciOi...` 字串

   ⚠️ **不要用 service_role**，那是 server 端用的、有完整權限會洩漏資料

### 5. 在 POS 系統設定

1. 打開 POS Pro（桌機 Electron 或 iPad PWA 都可以）
2. 老闆登入 → 設定 → **雲端同步**
3. 填入剛剛複製的 URL 和 anon key
4. 點 **儲存設定**
5. 點 **測試連線** → 看到 ✓ 表示成功

### 6. 第一次同步

**從哪台裝置開始？**

- 如果你**桌機 Electron 已有完整資料** → 在桌機按「⬆ 推上雲端」，把資料推上去
- 然後在 iPad/手機按「⬇ 從雲端拉下來」，會把桌機資料下載過來

之後每次：
- 哪台裝置改了東西 → 點「推上雲端」
- 另一台要看到最新 → 點「從雲端拉下來」（會覆蓋本機）

## 注意事項

### 安全 ⚠️ 重要

**預設設定（schema.sql）關閉 RLS，這代表：**
- 任何拿到 anon key 的人都可以**讀寫所有資料**，包含：
  - 訂單、會員、員工**密碼 hash**（PBKDF2-SHA256）
  - 進貨單、會計分錄
- anon key 設計上是「公開」金鑰（可以放前端），但「公開」≠「任何人都可拿」
- **不要把 anon key 貼到 GitHub / 公開 Discord / 截圖到網路**
- 適用：單店家、自己的裝置、家人或值得信任的店員
- 不適用：多店家共用一個雲端、店員不全可信、資料對外有合規要求

**如果擔心員工密碼洩漏（建議加固）：**

在 Supabase SQL Editor 跑：
```sql
-- 對 users 表加 RLS，只讓 service_role 讀寫（前端 anon 看不到密碼）
alter table users enable row level security;
-- 注意：之後 cloudSync 推/拉 users 表會失敗，需要員工資料同步請改用 Supabase Dashboard 手動管理
```

或更完整的：申請 Supabase Auth + RLS policies 做角色控管（超出本指南範圍）。

**其他建議：**
- 定期到 Supabase Dashboard → Settings → API → **Reset anon key** 換 key（之後在 POS 重新設定）
- 重要資料定期「設定 → 備份還原 → 匯出 JSON 檔」做本機離線備份

### 衝突
- 兩台裝置同時改不同筆資料 → 都 push 後雲端會同時保留兩邊新增的，但**同一筆 id 的修改後 push 會蓋掉前 push**
- 對家庭/小型店家來說：盡量「一台主裝置編輯、其他裝置查詢」可避免衝突
- 真的衝突了，從備份還原即可（**設定 → 備份還原** 有自動備份）

### 容量
- Supabase 免費 500MB 對 POS 來說超充足
- 估算：1 萬筆訂單 + 1000 商品 + 500 會員大約 50MB 不到
- 若超過：可以定期清舊資料、或升級 Pro plan ($25/月)

### 同步什麼？
- 同步：商品、會員、訂單、供應商、進貨單、促銷、員工、會計、掛單、班別、現金流水、損耗、會員儲值、稽核日誌
- **不同步**：本機設定（主題、印表機 IP）、備份檔（這些本來就是裝置特定）

## 常見問題

**Q: 不設定雲端同步可以嗎？**
A: 可以。不設定就跟以前一樣，每台裝置各自存資料。雲端同步是選用功能。

**Q: 雲端可以多店家共用嗎？**
A: 目前一個 Supabase 專案就是一個店家的資料。多店家請建多個專案，或進階做 RLS 隔離（需要技術）。

**Q: Supabase 倒了我的資料怎麼辦？**
A: 平時還是有本機 SQLite/localStorage，雲端只是同步副本。建議定期到「設定 → 備份還原 → 匯出 JSON」做離線備份。

**Q: 我能直接編輯雲端資料嗎？**
A: 可以。Supabase Dashboard → Table Editor 可以直接改。但改完記得在 POS 端「從雲端拉下來」才會同步到本機。
