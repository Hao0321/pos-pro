# POS Pro 專案接手文件

## 目前進度
- 版本：v2.5.0
- 狀態：可打包成 .exe，也可作為 PWA 部署給 iPhone/iPad（Safari「加到主畫面」即可當 app 使用）
- v2.5.0（第三輪全面 audit 強化）：修 2 個會造成「本機資料整庫遺失」的雲端/還原 bug、2 個金額/點數錯誤（生日贈點重複發、部分退貨可重複超退）、會計引擎退貨沖回與折抵修正、時區/防呆/相機洩漏一批，測試 57→70
- v2.4.0 新增：相機條碼掃描、CSV 匯入匯出、商品變動歷史、通用 webhook 通知、AI 智慧補貨、會員 RFM、商品熱賣/滯銷分析、庫存批量操作、員工績效、過期警示、bundle code-split
- v2.3.0 新增：PWA 化 + 雲端同步 (Supabase) + 商品綁定主要供應商 + 一鍵低庫存補貨 + 進貨歷史單價記憶 + 行動版 RWD

## v2.5.0 第三輪 audit 修正（重點）

### 🔴 嚴重（資料/金額正確性）
- **雲端 pull / 還原備份會整庫遺失**：`electron/database.js` `migrateTx` 寫會員只帶 7 個 named param，但 `insertMember` 需要 10 個（缺 balance/birthday/lastBirthdayBonus）→ better-sqlite3 直接 throw。再加上 `importData`/`restoreBackup` 的 `DELETE FROM` 原本在 transaction 之外，匯入一失敗 → 舊資料已清空、新資料沒進 = 整庫空白。**修法**：補齊 10 個 param；新增 `replaceAllTx`（DELETE + migrate 包進單一 transaction，失敗整批 rollback）。
- **生日贈點每筆重複發**：`checkout` 的 memberUpdate 沒帶 `lastBirthdayBonus`，`checkoutTx` 一直寫回舊值 → 重開程式後同月每次結帳都再送 100 點。**修法**：發放時把月份寫進 memberUpdate + DB。
- **部分退貨可重複超退**：部分退貨後原單仍是 `completed`、退貨鈕還在，可反覆退同一張單超退現金/庫存/點數。**修法**：`refund` 加「累計退貨守衛」（依 `orders` 算每品項已退量，本次夾在剩餘可退範圍；全退完則標記 refunded）；RefundModal 同步顯示「已退 N」並鎖定退完品項。

### 🟠 會計引擎（`src/utils/accounting.js`）
- 退貨不再漏記成本：COGS 分錄條件 `cogs > 0` → `!== 0`，退貨（負 qty）正確沖回 5101/1211。
- 折抵分錄修正：舊版「貸記現金」沖點數折抵，會把現金與營收各虛減一次。改為營收認列原價（4101）、折抵走 4191 contra-revenue，現金永遠等於實收。
- **會員儲值完整入帳（預收款模型）**：加值 = `Dr 現金/銀行(實收) + Dr 促銷費 5207(贈送) / Cr 預收款 2191(實收+贈送)`；用儲值消費 = `Dr 2191 / Cr 4101 銷售收入`。`topupToJournalEntries` + orders 新增 `balanceUsed` 欄位（auto_balance 分錄）。`topups` 進 store state 並納入 `autoJournal`；`topupMember` 一律持久化（修掉 web 模式儲值紀錄完全沒存的問題）。新增科目 5207 促銷費用。
  - **資料庫遷移**：SQLite 自動 `ensureColumn('orders','balanceUsed')`；雲端 Supabase 既有資料庫需執行 `alter table orders add column if not exists "balanceUsed" numeric default 0;`（schema.sql 已含）。
- **退貨退回儲值**：用儲值付款的訂單退貨時，按比例把儲值退回會員卡（`restoredBalance = balanceUsed × 退貨比例`），其餘才退現金/原付款；產生 auto_balance 反向分錄沖回預收款。RefundModal 顯示「退回儲值卡 / 退現金」拆分，收銀員不會誤退現金。舊訂單無 balanceUsed → 全額退現金（向下相容）。

### 🟡 防呆 / 效能 / 記憶體
- `analytics.js`：到期日改本地時間解析（UTC+8「今天到期」不再被誤判昨天過期）；`suggestReorderQty` 對 undefined 日均防呆；RFM 頻次/最近購買只算銷售單（退貨不灌水）；`days<=0`、缺 qty NaN、Infinity→null（JSON 安全）一批。
- `csv.js`：`NT$1,200` 去貨幣符號千分位、整數欄位四捨五入不截斷。
- `webhook.js`：缺 total/品項缺 name 不再送出 NaN/undefined 字串。
- `BarcodeScannerModal`：修 StrictMode 兩次掛載的鏡頭洩漏（本實例專屬 + 先判 running 再鎖 stopping）。
- `StocktakePage`：把 `setScanFeedback` 移出 `setCounts` updater（用 countsRef）；input ref 卸載時清除；export 改用共用 `stringifyCSV`。
- 共用 `useIsMobile`（`src/hooks/useIsMobile.js`，matchMedia，取代 4 份各自監聽 resize 的複本）；POSPage 商品過濾 `useMemo`；CartPanel 會員選取改用 `onSelectMember` prop（移除 `onFindMember._select` 反模式）；content-visibility intrinsic-size 調準 + 手機購物車/FAB 加 safe-area。
- 測試：57 → 70（新增退貨沖回 COGS、折抵不虛減現金、時區到期、CSV 貨幣/四捨五入、RFM 退貨、webhook NaN 等回歸測試）。

## v2.4.0 新增功能

### 相機條碼掃描（`src/components/BarcodeScannerModal.jsx`，lazy load）
- POS 收銀（連續掃→加購物車）、庫存（掃→找/新增商品）、進貨單（掃→加品）、盤點（掃→+1）
- html5-qrcode，後鏡頭優先，需 HTTPS + 相機授權；Electron file:// 走 USB 條碼槍

### 進階分析（`src/utils/analytics.js` — pure functions）
- `computeSalesVelocity` 近 N 天日均銷量 → AI 補貨建議 `suggestReorderQty`（NewPurchase 用）
- `computeMemberRFM` 會員分群（VIP/核心/新會員/流失預警/沉睡）→ MembersPage tag + filter
- `productPerformance` 熱賣/滯銷/高毛利 → ReportsPage 三卡
- `getExpiringProducts` 過期/即將過期 → InventoryPage filter + Dashboard
- `getProductHistory` 從 orders/waste/purchases 反推商品變動 → InventoryPage edit drawer
- `averageTicket` / `profitAnalysis` / `customerSegmentation` → Dashboard KPI

### CSV 匯入/匯出（`src/utils/csv.js`）
- InventoryPage：匯出全部、匯入（preview 新增/更新/錯誤）、下載範本
- 匹配：ID > 條碼 > 新增；自製 parser 無外部依賴

### 通用 Webhook 通知（`src/utils/webhook.js`）
- 7 事件：低庫存/結帳/大額/退貨/開班/關班/過期；Discord/Slack 自動格式化 + 純 JSON
- throttle（低庫存 6h、過期 24h）；觸發點在 useStore（checkout/refund/shift）+ products useEffect
- Settings「通知 Webhook」分頁設定

### 庫存批量操作 + 分類系統
- InventoryPage：多選 + 批量改價/百分比/成本/安全庫存/供應商/分類
- `src/utils/categories.js`：17 個預設分類 + emoji；InventoryPage/PurchasePage/POSPage 共用

### 其他
- 員工績效（ReportsPage 依 cashier 排行）、Dashboard 第二排 KPI + 會員結構
- POS：`/` 快捷搜尋、分類 tab emoji + 數量、搜尋含條碼/分類
- 顧客 menu：售完灰/最後幾件/搜尋（`public/menu`）
- Sidebar 同步狀態徽章、登入自動 pull、bundle code-split（html5-qrcode 獨立 chunk）

## v2.3.0 新增功能

### 雲端同步 (Supabase)
- `src/utils/supabaseClient.js` Supabase 客戶端（設定存 localStorage）
- `src/utils/cloudSync.js` `pushAll()` / `pullAll()` 手動同步
- `supabase/schema.sql` Postgres schema（給使用者貼到 Supabase SQL Editor）
- `SETUP_SUPABASE.md` 設定教學
- `SettingsPage` 新增「雲端同步」分頁：URL/key 設定、測試連線、推/拉按鈕、進度顯示
- 設計：localStorage / SQLite 仍是本機資料源（離線可用），雲端為選用同步層
- 同步策略：push = upsert（不刪雲端多餘）、pull = 全覆蓋本機

### PWA / iOS / 行動版
- `public/manifest.webmanifest` PWA 設定
- `public/sw.js` Service Worker（offline cache、HTML network-first、靜態資源 cache-first）
- `index.html` 加 iOS meta（apple-touch-icon、status-bar-style、theme-color、viewport-fit=cover）
- `src/index.css` 加 iOS safe-area、44px touch target、16px input 防 zoom、standalone 模式偵測
- 使用方式：在手機/平板 Safari 開 → 分享 → 加到主畫面 → 完成

### 訂貨系統強化
- 商品可指定「主要供應商」（products.supplierId）— `InventoryPage` 表單下拉
- 商品可設「安全庫存」（products.reorderLevel）— 低於此值會出現補貨提示
- 新增進貨單選了供應商後，**只顯示該供應商商品**（過濾 dropdown）
- **一鍵帶入低庫存補貨清單**按鈕 — 自動把「該供應商 + stock ≤ reorderLevel」的商品加入，建議叫貨量 = `reorderLevel × 2 - stock`
- **歷史單價記憶** — 加入商品時自動帶入上一次跟該廠商買這個商品的單價（找不到則用商品 cost）
- 進貨單明細加 `歷史單價` / `自動補貨` 小 badge 標示來源

## 環境需求
- Node.js 18+ (建議 20)
- Windows（其他平台需修改 electron-builder 設定）
- 第一次 clone 後跑 `npm install`（會自動 rebuild better-sqlite3 native module）

## 常用指令
```bash
npm install              # 安裝依賴 + 自動 rebuild native module
npm run dev              # Vite dev server（瀏覽器模式，無 SQLite）
npm run electron:dev     # 打包前端 + 啟動 Electron（生產等效）
npm run electron:build   # 打包 .exe 到 release/
```

## 架構

```
pos-system/
├── electron/          ← Electron 主程序
│   ├── main.js        ← BrowserWindow + IPC handlers
│   ├── preload.js     ← contextBridge (window.electronAPI)
│   ├── database.js    ← better-sqlite3 schema + CRUD（核心！）
│   ├── printer.js     ← ESC/POS 熱感印表機 + 錢箱
│   ├── barcode.js     ← JsBarcode 條碼產生
│   └── server.js      ← Express + WebSocket（顧客點餐用，含 cloudflared tunnel）
│
├── src/               ← React 前端
│   ├── App.jsx        ← 路由 + 登入檢查
│   ├── main.jsx       ← 入口（initTheme + ErrorBoundary）
│   ├── store/
│   │   └── useStore.js ← 全域狀態 + 所有業務邏輯（重要！）
│   ├── pages/         ← 各頁面
│   │   ├── DashboardPage    ← 首頁儀表板
│   │   ├── POSPage          ← 收銀台
│   │   ├── ShiftPage        ← 班別交班
│   │   ├── InventoryPage    ← 庫存（含商品圖片、保存期限）
│   │   ├── WastePage        ← 損耗管理
│   │   ├── PurchasePage     ← 進貨 + 應付帳款
│   │   ├── PromotionsPage   ← 促銷
│   │   ├── MembersPage      ← 會員（含儲值/退貨）
│   │   ├── ReportsPage      ← 報表 + ABC 分類 + Excel 匯出
│   │   ├── AccountingPage   ← 會計帳務（複式記帳）
│   │   ├── OrdersPage       ← 顧客點餐管理
│   │   ├── StocktakePage    ← 每日盤點
│   │   ├── LoginScreen      ← 登入
│   │   └── SettingsPage     ← 設定（一般偏好/營運/員工/硬體/資安/備份/稽核）
│   ├── components/
│   │   ├── CartPanel        ← 購物車面板（含結帳流程：cart→member→pay→done）
│   │   ├── Sidebar          ← 左側導航
│   │   ├── RefundModal      ← 退貨對話框
│   │   ├── HeldOrdersModal  ← 掛單列表
│   │   ├── PriceLookupModal ← 快速查價 (F1)
│   │   └── ErrorBoundary    ← React 錯誤捕捉
│   └── utils/
│       ├── dataAccess.js    ← SQLite ↔ localStorage 抽象層（重要！）
│       ├── accounting.js    ← 會計引擎（複式記帳、損益表、資產負債表）
│       ├── security.js      ← PBKDF2 密碼 + RBAC + 稽核日誌 + 備份
│       ├── theme.js         ← 主題切換
│       └── exportXLS.js     ← Excel 匯出工具
│
├── public/menu/       ← 顧客手機點餐頁面（vanilla HTML/JS）
├── build/             ← App icon (icon.ico, icon.png)
├── scripts/           ← icon 產生器
├── index.html         ← Vite entry HTML（含啟動 placeholder + window.onerror）
├── vite.config.js
└── package.json       ← electron-builder 設定也在這
```

## 資料層

**雙模式設計**：
- 開發中跑 `npm run dev` → 瀏覽器 + localStorage
- 打包後跑 .exe → Electron + SQLite (`%APPDATA%/POS Pro/pos-data.db`)

**所有資料存取必須走 `src/utils/dataAccess.js`**，不要直接 `localStorage` 或直接呼叫 `window.electronAPI`。dataAccess 內部會判斷 `isElectron` 並分流。

**資料表清單**（全在 `electron/database.js`）：
- `products` 商品（含 imageUrl, expiryDate, **supplierId, reorderLevel**）
- `members` 會員（含 balance 儲值, birthday, lastBirthdayBonus）
- `orders` 訂單（含 payments JSON、taxId、shiftId、refundOf、fullRefund）
- `order_items` 訂單明細
- `held_orders` 掛單
- `shifts` 班別
- `cash_log` 現金流水
- `waste_log` 損耗紀錄
- `member_topups` 會員儲值紀錄
- `suppliers` `purchases` `promotions` `users` `audit_log` `manual_journal` `backups` `settings`

**改 schema 的標準作法**：
1. 在 `CREATE TABLE` 加新欄位（給新 DB）
2. 在 `ensureColumn()` 加 ALTER TABLE（給舊 DB 升級）
3. 更新 `insertXxx` / `updateXxx` prepared statement
4. 更新 React state 同步邏輯（useStore）

## 已知問題

### 客戶回報黑屏（v2.1.0/v2.1.1）
- 症狀：開 .exe 後純黑畫面，看不到登入畫面
- v2.1.2 加了三層防護：
  - `index.html` 寫死 body bg + 「啟動中...」placeholder
  - `window.onerror` 全域 catch
  - React `ErrorBoundary` + `Promise.allSettled` 取代 `Promise.all`
- 真正原因仍未確定，需要客戶開 DevTools (Ctrl+Shift+I) 看 Console 紅字才能精準修

### 不在範圍內（需要外部資源/硬體）
- 秤重整合（電子秤協定）
- 雙螢幕客顯
- LINE 通知（需 LINE Bot）
- 電子發票（需財政部加值中心）
- 自動更新（需更新伺服器）
- 多分店（需中央伺服器）

## 業務邏輯重點

### 結帳流程
```
POSPage.addToCart → useStore.cart
  → CartPanel.handleCheckout
    → useStore.checkout(payMethod, paid, pointsUsed, opts)
      → 計算 discount/total/pointsEarned
      → setCart([]); setProducts(扣庫存); setMembers(更新點數/累計)
      → dbCheckout (SQLite 原子性 transaction)
```

### 退貨流程
```
MembersPage.RefundModal → useStore.refund(origOrder, refundItems, opts)
  → 判斷 isFullRefund
  → 建立負數訂單 (id 開頭 'R')
  → 補回庫存、沖回會員點數/累計消費
  → 完整退貨：原訂單 status='refunded'
  → 部分退貨：原訂單保持 'completed'，靠負數訂單抵銷
```

### 報表/儀表板過濾
- 排除完整退貨配對：`o.status !== 'refunded' && !(o.refundOf && o.fullRefund)`
- 部分退貨保留：原訂單(完成) + 負數退貨訂單兩邊都計入，總額自動抵銷

## 接手後可做
1. 修黑屏 bug（最優先，需要 DevTools console 線索）
2. 加電子發票（台灣特定，建議找財政部加值中心 API）
3. 加自動更新（用 electron-updater + GitHub Releases）
4. 多分店（需架中央伺服器，中型重構）

## 技術棧
- Electron 33.2 + better-sqlite3 11.7
- React 18.3 + Vite 5.4
- lucide-react（圖示）
- jsbarcode（條碼）
- qrcode（QR Code）
- cloudflared（外網點餐用，免費 tunnel）
- 沒用 Redux/Zustand/Recoil — 自己寫 useStore hook

## 預設帳號
- 老闆：密碼 `1234`
- 員工：密碼 `0000`

第一次啟動會自動建立。改密碼從 LoginScreen 進去後到 設定 → 員工帳號。
