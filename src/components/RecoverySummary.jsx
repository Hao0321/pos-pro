import {tr,getLocale} from '../i18n'
const rows=[['products','商品種類'],['orders','收銀紀錄'],['stockCostEntries','成本紀錄'],['purchases','進貨單'],['salesDocuments','客戶銷售單'],['salesPayments','客戶收款紀錄'],['customerEntries','客戶款項異動'],['customerReceipts','客戶預收紀錄'],['supplierEntries','供應商款項異動'],['supplierPayments','供應商預付款紀錄'],['cashLogs','現金流水'],['members','會員人數']]
export default function RecoverySummary({current,target}){
  const table=selected=><div className="recovery-comparison" role="table" aria-label={tr('還原前後的資料')}><div role="row"><strong role="columnheader">{tr('資料')}</strong><strong role="columnheader">{tr('目前')}</strong><strong role="columnheader">{tr('選擇的副本')}</strong></div>{selected.map(([key,label])=><div key={key} role="row" data-recovery-count={key}><span role="rowheader">{tr(label)}</span><span role="cell">{Number(current?.[key]??0).toLocaleString(getLocale())}</span><span role="cell">{Number(target?.[key]??0).toLocaleString(getLocale())}</span></div>)}</div>
  return <>{table(rows.slice(0,4))}<details data-recovery-more><summary style={{minHeight:48,cursor:'pointer',padding:'12px 0'}}>{tr('其他紀錄')}</summary>{table(rows.slice(4))}</details></>
}
