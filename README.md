<p align="center">
  <img src="docs/cover.png" alt="POS Pro" width="760">
</p>

<h1 align="center">POS Pro</h1>

<p align="center">
  全功能免費、離線優先的 POS 收銀系統 — 收銀 · 庫存 · 會員儲值 · 進貨訂貨 · 複式記帳 · 報表<br>
  <i>A free, offline-first POS for every merchant · Windows desktop (Electron) + PWA · 繁體中文</i>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-2.6.0-b8895a">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20PWA-555">
  <img alt="tests" src="https://img.shields.io/badge/tests-vitest%20%2B%20native-3f9c5e">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## 這是什麼

目前版本：v2.6.0（原始碼版本；本次安全修正尚未建立新的正式安裝檔）。

POS Pro 的產品原則是**所有店家、全部功能免費**，不限規模與店型，不設訂閱或進階功能解鎖費。資料預設存在本機（桌面版走 SQLite、瀏覽器版走 localStorage），雲端同步是選用。

目前程式以零售流程為基礎；攤販、餐飲外帶、零售／手作的起步範本，以及 LINE 接單，已列入後續規格。所有新模組沿用相同免費政策，外部平台的費用與配額另行清楚標示。

## 產品方向與開發依據

- [全功能免費產品規格](docs/FREE_POS_PRODUCT_SPEC.md)：免費政策、各店型流程、離線與資料保存要求。
- [開發與驗收清單](docs/FREE_POS_BACKLOG.md)：先確保交易保存與復原，再完成各店型起步及接單能力。
- [order-linebot 學習紀錄](docs/ORDER_LINEBOT_LEARNING.md)：來源版本、可採用設計、實驗結果與第三方成本查核。

上述文件描述後續實作方向；新模式與 LINE 串接尚未完成。

## ✨ 功能

- 🧾 **收銀** — 條碼掃描、混合付款、找零、退貨（自動沖庫存/點數）、掛單、收據
- 📦 **庫存** — 即時扣庫、安全庫存提醒、批量改價、CSV 匯入匯出、商品變動歷史、過期警示
- 👥 **會員** — 點數、分級、儲值卡、生日贈點、RFM 自動分群
- 🚚 **進貨訂貨** — 廠商管理、依供應商一鍵建單、AI 智慧補貨建議、歷史單價
- 🧮 **複式記帳** — 銷售/成本/儲值自動入帳、損益表、資產負債表、日記帳、CSV 匯出
- 📊 **報表** — 每日營收、毛利、熱賣滯銷、客單價、員工績效
- 📱 **顧客掃碼點餐**　☁️ **雲端同步（Supabase，選用）**　🔔 **Discord / Slack 通知（選用）**

## 📸 截圖

![功能總覽](docs/features.png)

## 🚀 安裝

### 一般使用者
到 [Releases](https://github.com/Hao0321/pos-pro/releases) 下載 `POS Pro Setup x.x.x.exe`，安裝即可（Windows 10 / 11）。

舊 Releases 的安裝檔未經程式碼簽章。這次修正的原始碼與歷史安裝檔需分開驗證；不要只憑檔名判斷版本或來源。

首次啟動由你建立管理員名稱與至少 8 字元密碼。既有帳號會保留；舊的短密碼必須在驗證後更換，登入流程不再重建預設帳號。

### 自行編譯 / 開發

需要 Node.js 24 或更新的受支援版本。桌面版原生 SQLite 套件會依 Electron 版本重建。

```bash
npm install
npm run dev            # 瀏覽器開發伺服器 (localhost:5173)
npm run electron:dev   # 桌面版（Electron）開發
npm run electron:build # 打包 Windows 安裝檔 → release/
npm test               # 單元測試 (vitest)
npm run test:native    # 隔離的真實 SQLite 交易／備份驗證
npm run test:desktop   # 隱藏測試視窗，驗證實際 preload／IPC／收款畫面
```

## ☁️ 雲端同步（選用）

讓手機 / 平板 / 多台電腦共用同一份資料。申請免費 Supabase 後，依 [SETUP_SUPABASE.md](SETUP_SUPABASE.md) 設定。

## ⚠️ 安全須知

- 桌面版在主程序驗證帳號、IPC 來源和角色。瀏覽器版角色控制適用於受信任的本機使用者，無法防止有權操作開發者工具或本機檔案的人修改資料。
- [`supabase/schema.sql`](supabase/schema.sql) 啟用 Auth 身份與 RLS；公開 key 本身不授權讀寫資料。員工密碼留在本機，不再同步到雲端。已有雲端專案需依 [設定指南](SETUP_SUPABASE.md) 更新後驗收。
- 收款需開班、資料核算及保存回覆；結果不明時請查詢原單號。電子付款只是記錄付款方式，沒有代替銀行或支付平台扣款。
- 瀏覽器資料使用一份原子紀錄，單一編輯分頁與交易鎖；需新版瀏覽器及 HTTPS／localhost。定期匯出完整備份到裝置之外。
- 對外點餐通道預設關閉；區網菜單只公開商品展示欄位，每筆顧客訂單須帶自己的追蹤憑證查詢。
- 本次驗證範圍與尚未測量的部分見 [弱點掃描與修正紀錄](docs/SECURITY_SCAN_20261007.md)。

## 🧱 技術

Electron 44 · better-sqlite3 13 · React 18 · Vite 8 · Supabase（選用）· Vitest 5

資料層由 [`src/utils/dataAccess.js`](src/utils/dataAccess.js) 抽象：桌面走 SQLite、瀏覽器走 localStorage，UI 共用一套。

## 📝 授權

[MIT](LICENSE) © 2026 Chroma Street Studio
