import {tr,getLocale} from '../i18n'
const rows=[['products','商品種類'],['orders','收銀紀錄'],['salesDocuments','客戶銷售單'],['salesPayments','客戶收款紀錄'],['cashLogs','現金流水'],['purchases','進貨單'],['members','會員人數']]
export default function RecoverySummary({current,target}){
  return <div className="recovery-comparison" role="table" aria-label={tr('還原前後的資料')}><div role="row"><strong role="columnheader">{tr('資料')}</strong><strong role="columnheader">{tr('目前')}</strong><strong role="columnheader">{tr('選擇的副本')}</strong></div>{rows.map(([key,label])=><div key={key} role="row"><span role="rowheader">{tr(label)}</span><span role="cell">{Number(current?.[key]??0).toLocaleString(getLocale())}</span><span role="cell">{Number(target?.[key]??0).toLocaleString(getLocale())}</span></div>)}</div>
}
