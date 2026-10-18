# 手機配對與點餐頁的連接埠

回歸測試曾讓共用店面在系統自動分配的 6566 啟動，伺服器顯示已啟動，但 Chromium 拒絕打開配對網址，回報 `ERR_UNSAFE_PORT`。同樣的問題也可能影響點餐 HTTP 伺服器；只檢查數字在 1 到 65535 之間不夠。

HTTP／HTTPS 共用一份瀏覽器連接埠檢查。明確指定的禁止連接埠在開監聽器之前拒絕；系統自動分配到禁止連接埠時，先完整關閉這個監聽器，再有界重試。只有確定可使用的實際監聽埠才會出現在啟動結果與配對網址。原有私人網路位址、TLS 憑證釘選、登入、權限、停止與並行啟動規則維持驗證。

依據是 [WHATWG Fetch 的 port blocking 規則](https://fetch.spec.whatwg.org/#port-blocking) 與 [Chromium 的 restricted ports](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc)，於 2026-10-18 核對；這是當時規則的快照，未來須隨支援的瀏覽器再次檢查。

單元測試涵蓋明確禁止、合法與無效值、動態分配、重試上限、監聽失敗與關閉。原生控制使用完整保留的前一版伺服器，強制實際綁定 6566，確認真正 Chromium 會拒絕；再讓候選版遇到同樣的第一次分配，驗證關閉、重選，以及實際 HTTPS 配對登入和 HTTP 頁面。測試沒有開啟忽略瀏覽器埠限制的選項。實體手機與不同瀏覽器仍須另行驗收。
