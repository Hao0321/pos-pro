# ERP、CRM 與系統搬家：工程知識索引

查核日期：2026-10-18。以下是官方文件的重點與本專案採用決策，不是複製對方程式、取得對方認證，或宣稱已學完所有 ERP。所有功能維持免費。原有完整 ERP 範圍繼續保留；閱讀文件不等於功能驗收完成。

## 要學的是資料如何接起來

| 領域 | 採用到 POS Pro 的規則 | 要驗證的反例 |
| --- | --- | --- |
| 商品、客戶與供應商身份 | 保留來源系統、來源公司、類型及原編號；顯示名稱與永久身份分開 | 兩家系統都有 `001`、同名商品、條碼前導零 |
| 關聯資料 | 先建對照，再接單據明細；缺對照列為待核對 | 目錄重新連到別的商品，不能跟著加錯庫存 |
| 採購與銷售 | 訂購、交付、請款、收付款分開；用原單引用串接 | 收一半、付一半、退一部分，不能用一個「完成」抹平 |
| 原價與單位 | 保存原包裝價格、基本單位及明確比例，計算沿用整數分與毫單位 | 一箱三瓶一百元分三次收貨不能變成 99.99 元 |
| 庫存與成本 | 現有、預留、隔離、在途分開；期初數量與成本分別核對 | 下單就加庫存、未知效期直接可售、售價當成本 |
| 財務與更正 | 可追溯原單；已入帳錯誤用反向紀錄處理，避免刪掉歷史 | 匯入欠款同時再認列一次舊銷售 |
| 客戶與 CRM | 人、公司、聯絡人、會員、商機分層；相似不等於同一人 | 共用電話的家人、自動把同名會員合併 |
| 互動與服務 | 記錄負責人、下一步、期限、結果；會員點數與實際款項分開 | 將商機金額直接當成已收營收 |
| 聯絡偏好 | 保存來源、用途、渠道與拒絕狀態；搬家不新增同意 | 有電話就自動同意行銷、還原後復活退訂 |
| 權限與稽核 | 由實際登入身份驗證；Agent 建議不能自授權或自行核准 | 檔案夾帶 owner、confirmed 或付款指令 |
| 備份與換版 | 先試搬與對帳，保存原檔、回執與可還原副本 | 中途斷線重跑造成重複，舊版忽略新資料 |
| 易用性與規模 | 前台只顯示本次工作與必要差異；大量資料分批、有進度、有原編號 | 千列資料全塞成一張密密麻麻的表，失敗後從頭重做 |

前四項身份／關聯／匯入預檢的依據是 [Odoo 匯入匯出](https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html)、[NetSuite 欄位與單據識別](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1534420642.html) 與 [NetSuite CSV 慣例](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N453326.html)。我們推導的做法是保留外部編號、明確欄位對照、先預檢再寫入，不用名稱猜身份。

帳款搬移參考 [ERPNext 期初未付單據](https://docs.frappe.io/erpnext/opening-invoice-creation-tool)：搬移切換日尚欠的逐張單據，保留到期日、幣別與來源，核對筆數、客戶／供應商小計及總額。設計上必須防止期初總帳與未付明細重複計入；這是待實作與驗證要求，不表示目前已能匯入任意會計帳。

CRM 參考 [Microsoft 匯入對照與替代鍵](https://learn.microsoft.com/en-us/power-apps/user/import-data)、[重複客戶檢視與合併](https://learn.microsoft.com/en-us/power-apps/user/merge-duplicate-records)、[客戶聯絡同意](https://learn.microsoft.com/en-us/dynamics365/customer-insights/data/consent-management) 及 [同意紀錄搬移](https://learn.microsoft.com/en-us/dynamics365/customer-insights/journeys/real-time-marketing-migrate-consent)。我們採取「提示可能重複、店主決定保留欄位、拒絕優先保留、未知不補成同意」的產品政策。這些官方文件不是各地法律認定。

商機追蹤參考 [Odoo 未成交原因](https://www.odoo.com/documentation/19.0/applications/sales/crm/pipeline/lost_opportunities.html)：未成交也需要留下原因與可追回的紀錄。完整商機／服務流程仍在 CRM 義務內，不能用會員列表宣稱完成。

## 兩個 Agent 入口

**Agent 幫我建單**：提供本店可用商品的必要對照與任務協議 → Agent 回傳已知事實 → 保留原文字的草稿 → 店主核對商品、數量、價格 → 用同一原編號保存。建採購單不等於收貨或付款。

**Agent 幫我搬家**：目前可複製協議、選檔／拖入／貼上 Agent 整理的原文字草稿，查看來源內的欄位建議、重複與數值問題，並保留未完成輸入。正式搬家目標是「對照本店 → 試搬與對帳 → 店主確認 → 原子保存批次與回執」，這段尚未接通。無法確定的單位、成本、身份或欠款保留待核對，不猜測填零。詳細驗收見 [搬家協議規格](AGENT_MIGRATION_SPEC.md)。

CSV／JSON 是第一批交換格式；Excel、其他廠牌及外部 Agent 逐一建立實際匯出 fixture 與互通測試後才列為支援。原系統資料仍可保留查詢，搬家不能要求先刪除原帳。欄位整理可以自動化，業務確認與不確定事實仍須清楚交代。

## 學習如何留下來

每項知識以「來源 → 採用規則 → 程式權威 → 正反測試 → 尚未驗收」追蹤。專案 `.rd/` 保留研究與 Cleanup／R&D 的證據；不把閱讀來源、測試數或暫定規格當成模型訓練或產品完成。
