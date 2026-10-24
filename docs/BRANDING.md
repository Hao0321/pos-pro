# POS Pro｜ERP・點餐・CRM

目前顯示名稱暫為 POS Pro，新品牌尚未定案。名稱與圖標須親切、容易記住，不使用個人名字或個人名字縮寫；定位涵蓋 ERP 日常營運、顧客點餐、CRM 與 Agent。所有店家、全部功能免費。完整 ERP、企業客戶及商機管理仍在擴充，能力界線見 [清單](../product-capabilities.json)。

## 視覺規格

依使用者提供的海報參考，採鈷藍 `#2B20F4`、碳黑 `#141414`、米白 `#F5F4EF`。用清楚的字級、大標題、細格線、平面色塊與留白建立層級；裝飾圖形只出現在非操作區，且標示為裝飾。交易的成功、警告與錯誤仍保留有意義的狀態色與文字。

- `src/index.css` 定義明暗色 tokens；`src/styles/editorial.css` 統一按鈕、表單、卡片、表格與標題。
- 登入頁、首頁兩個工作區、選單、主要模組、收款畫面、顧客點餐及丼飯演練沿用這套視覺。
- 手機保留清楚金額、可捲動畫面與主要 48px 操作；顧客頁允許縮放。實際長者、兒童與設備驗收另計。
- 暗色模式保持既有偏好；首頁標題、摘要及兩工作區的文字對比另以實際 Chromium 計算驗證，不只看 CSS 變數。

## Logo 與重建

核准原圖：[`public/brand/erp-logo.png`](../public/brand/erp-logo.png)，1254 × 1254，不透明米白底，黑色直向模組與鈷藍橫向模組形成 P 的識別。此圖為原創生成圖；使用者的參考拼貼未複製到公開專案。

`src/components/Brand.jsx` 保持字標為真實文字，標語是「所有店家，全部功能免費」。`npm run build:icons` 透過專案既有 Electron nativeImage 僅轉尺寸與 PNG／ICO 編碼，產生 Windows 512px、ICO 256／128／64／48／32／16px、PWA 192／512px 及 Apple 180px。manifest 如實標示尺寸；離線版本涵蓋 HTML、manifest 與圖示位元組。

視覺名稱更新，安裝產品名 `POS Pro`、appId `com.posPro.desktop` 與原 userData 路徑保留，避免既有店面因改名讀到不同資料目錄。

最終原圖使用內建 **imagegen** 重新生成，沒有使用 CLI 或另外付費 API。以下是最終採用圖的完整提示詞；先前金棕與透明試稿沒有採用。

## 最終提示詞

```text
Use case logo-brand. Create one new final app icon for POS Pro, an integrated ERP, ordering and CRM app. It must be an exceptionally clean flat geometric typographic symbol, inspired by Swiss modernist ultramarine/black/ivory graphic design. FULL square canvas is completely opaque, uniform warm ivory #F5F4EF, with no transparent area and no separate tile boundary. In the center make a bold abstract modular capital P: one carbon-black #141414 broad vertical shape on the left, with gently curved top and bottom; two vivid ultramarine #2B20F4 broad rounded horizontal lobes on the right, stacked to form the bowl of the P and open flowing negative-space joins. The black left piece and blue right pieces must read as one coherent strong P monogram. Emblem occupies around 65 percent of canvas width and height, perfectly balanced with generous equal ivory margins. Precise smooth vector-like edges, solid ink colors, strong silhouette readable at 16 pixels, refined contemporary identity. Only one symbol on the opaque ivory background. No text besides the abstract P shape, no caption, no wordmark, no gradients, no paper texture, no shadows, no bevels, no noise, no decorative marks, no isolated specks, no mockup or multiple variants. Every part of the square image including all outer edges must be opaque ivory.
```
