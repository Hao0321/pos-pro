# 部署 PWA 給手機/平板用

build 完的 `dist/` 資料夾就是可部署的靜態檔案。PWA 需要 **HTTPS** 才會啟用（Service Worker 在 http 上不會註冊）。三個免費選擇，由快到慢：

## 選項 1：Netlify Drop（最快，5 分鐘搞定）

1. 開 [https://app.netlify.com/drop](https://app.netlify.com/drop)
2. 把 `dist/` 整個資料夾拖進去
3. 拿到一個 `https://xxx-xxx.netlify.app` 網址
4. 用 iPhone/iPad Safari 開那個網址 → 分享 → 加到主畫面 → 完成 ✓

之後改 code → `npm run build` → 重新拖一次（或在 Netlify dashboard 設 GitHub auto-deploy）。

## 選項 2：Cloudflare Pages（推薦，CDN 最快）

1. 註冊 [https://dash.cloudflare.com](https://dash.cloudflare.com)（免費）
2. 左側 **Workers & Pages** → **Create application** → **Pages** → **Upload assets**
3. 專案名稱填 `pos-pro`
4. 拖 `dist/` 整個資料夾上傳
5. 拿到 `https://pos-pro.pages.dev` 網址

優點：全球 CDN、免費額度無上限、台灣連線比 Netlify 快。

## 選項 3：Vercel

1. 註冊 [https://vercel.com](https://vercel.com)
2. **Add New → Project → Browse all templates → Other**
3. 用 GitHub 部署（要先把專案 push 上 GitHub）

如果你不想搞 GitHub，跳這個用 1 或 2。

## 自己的網域（選做）

三個平台都支援綁自己的 domain：
- Netlify / Cloudflare Pages：Settings → Custom domain → 加 CNAME 到 DNS
- 免費自動 HTTPS（Let's Encrypt）

## 部署後檢查

1. 用 iPhone Safari 開網址
2. 開「分享」→ 看到「加到主畫面」就代表 PWA 設定成功
3. 加完後桌面會有 POS Pro icon，點開全螢幕跑（沒瀏覽器列）
4. 第一次使用：登入 → 設定 → 雲端同步 → 貼 Supabase URL+key → ⬇ 從雲端拉下來

## 注意

- **iOS Safari**：「加到主畫面」必須**手動**操作，沒辦法用程式自動觸發（Apple 規定）
- **Android Chrome**：會自動跳出「安裝 App」提示，更方便
- **離線可用**：第一次載入後，Service Worker 會 cache 主要資源，飛航模式也能開
- **更新 code**：重新 build + deploy 後，使用者下次開 app 會自動拉新版（SW 自動更新）
