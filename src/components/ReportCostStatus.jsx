import {tr,trMessage} from '../i18n'
export default function ReportCostStatus({view}){
 const report=view.report
 return <div data-report-cost-status style={{fontSize:13,color:'var(--text-secondary)',marginBottom:12,overflowWrap:'anywhere'}}>
  {view.loading?tr('讀取中…'):view.error?<><span role="alert">{tr('報表暫時無法讀取')}</span> <button className="btn btn-ghost" style={{minHeight:48}} onClick={view.retry}>{tr('重試')}</button><details><summary>{tr('看原因')}</summary>{trMessage(view.error)}</details></>:<span>{tr(report?.status==='active'?'實際成本':'參考成本')}{report?.scope==='pos'?' · '+tr('收銀與餐飲'):''}</span>}
 </div>
}
