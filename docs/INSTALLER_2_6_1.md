# Windows 安裝檔 2.6.1

此版包含交易保存、帳號權限、點餐服務與離線保存的安全修正。所有店家、全部功能免費；詳細測量範圍見 [安全修正紀錄](SECURITY_SCAN_20261007.md)。

本機產物位於 `release/POS Pro Setup 2.6.1.exe`，適用於 Windows x64。此版未簽章，Windows 可能顯示來源／信譽提示。更新前先透過程式匯出完整備份，再關閉 POS 後執行安裝檔。安裝檔版本不取代資料備份。

首次使用需建立管理員名稱與至少 8 字元密碼。既有帳號與本機資料保留，舊短密碼需通過驗證後更換。登入畫面的版本直接取自專案版本，避免與安裝檔版本不同。

## 建置與檢查

使用 Node.js 24 或更新的受支援版本：

```powershell
npm ci
npm test
npm run test:native
npm run test:desktop
npm run test:offline
npm run electron:build
Get-FileHash -Algorithm SHA256 'release/POS Pro Setup 2.6.1.exe'
```

建置使用已安裝並固定為 44.6.0 的 Electron runtime，重建 SQLite 原生依賴，產生 NSIS 安裝檔及 blockmap。安裝內容包含 `resources/sbom.cdx.json`、`resources/THIRD_PARTY_NOTICES.txt` 與 `resources/build-receipt.json`；另保留 Electron／Chromium 的授權文件。receipt 記錄實際輸入與封包雜湊，SBOM 依封包內的套件內容產生。程式來源對照紀錄另外寫入 `.rd/build/installer-build-receipt.json`。

目前透過手動下載與安裝更新；此版不提供經身分驗證的自動更新通道。GitHub Releases 的歷史檔案與本機最新產物須各自核對，建立本機安裝檔不代表已公開發布到 Releases。
