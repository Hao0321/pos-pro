import {useState} from 'react'
import {tr} from '../../i18n'
import useVisibleViewport from '../../hooks/useVisibleViewport'
import {latestKitchenPrintJob} from '../../utils/kitchenPrintView'

const labels={queued:'待送印',sending:'正在送印',submitted:'已送印，請確認紙張',uncertain:'列印結果待核對',confirmed:'紙張已確認',voided:'已停止送印',review:'還原的舊單，請核對紙張'}
export const kitchenPrintLabel=job=>labels[job.displayState||job.state]||'列印結果待核對'
export default function KitchenPrintStatus({printing,entry,job:providedJob,compact=false}){
 const [reprint,setReprint]=useState(null),[ack,setAck]=useState(false),viewport=useVisibleViewport()
 const state=printing.state,job=providedJob||latestKitchenPrintJob(state?.jobs||[],entry.id),display=job?.displayState||job?.state
 const blocked=printing.busy||!!printing.pending||!!printing.pendingError,bound=state?.binding.ready===true,native=!!window.electronAPI?.db.applyKitchenPrintOperation
 const active=job?.kind==='cancel'||!!entry&&!['completed','cancelled'].includes(entry.status)
 const send=input=>printing.act({...input,entryId:job?.entryId||entry.id})
 const title=job?.kind==='cancel'?'取消通知':'備餐列印'
 if(!state)return null
 if(!job&&!active)return null
 return <section data-kitchen-print-entry={job?.entryId||entry.id} style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)',overflowWrap:'anywhere'}}>
  <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'}}>
   <span data-print-state={display||'none'}><strong>{tr(title)}</strong> · {tr(job?kitchenPrintLabel(job):'尚未要求列印')}</span>
   {job?.copy>0&&<small>{tr('補印第 {0} 份',{0:job.copy})}</small>}
  </div>
  {compact&&job&&<p style={{margin:'6px 0'}}>{job.ticket.tableNum?tr('桌號 {0}',{0:job.ticket.tableNum}):tr('取餐號 {0}',{0:String(job.ticket.pickupNumber).padStart(3,'0')})} · {job.ticket.items.map(i=>i.name+' × '+i.qty).join('、')}</p>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
   {!job&&active&&native&&<button className="btn btn-ghost" data-print-request disabled={blocked||!bound} style={button} onClick={()=>send({action:'request'})}>{tr('印備餐單')}</button>}
   {job&&display==='queued'&&active&&native&&<button className="btn btn-ghost" data-print-send disabled={blocked||!bound} style={button} onClick={()=>send({action:'send',jobId:job.id,expectedVersion:job.version})}>{tr('送出列印')}</button>}
   {job&&['submitted','uncertain'].includes(display)&&<button className="btn btn-primary" data-print-confirm disabled={blocked} style={button} onClick={()=>send({action:'confirm',jobId:job.id,expectedVersion:job.version})}>{tr('紙張正確')}</button>}
  </div>
  {!bound&&active&&native&&(!job||['queued','review','uncertain'].includes(display))&&<small>{tr('請先由老闆核對印表機')}</small>}
  {job&&<details style={{marginTop:8}}><summary>{tr('列印細節')}</summary>
   <p>{tr('原單資料')}：{job.ticket.sourceOrderId||job.ticket.entryId}</p>
   {job.attempt&&<><p>{tr('送印時間')}：{job.attempt.startedAt}</p><p>{tr('印表機')}：{job.attempt.destination.type==='windows'?job.attempt.destination.name:job.attempt.destination.ip+':'+job.attempt.destination.port}</p>{job.attempt.error&&<p>{tr('傳輸結果不明，先核對實際紙張')}</p>}</>}
   {active&&display!=='sending'&&native&&<button className="btn btn-ghost" data-print-reprint disabled={blocked||!bound} style={button} onClick={()=>{setReprint({id:job.id,version:job.version,entryId:job.entryId});setAck(false)}}>{tr('需要補印')}</button>}
  </details>}
  {reprint&&<form role="dialog" aria-modal="true" aria-label={tr('確認補印')} className="card" style={{position:'fixed',zIndex:225,left:16,right:16,top:viewport.top+16,maxHeight:Math.max(120,viewport.height-32),overflowY:'auto',maxWidth:480,margin:'0 auto',padding:20,boxShadow:'0 0 0 200vmax rgba(0,0,0,.45)'}} onSubmit={async e=>{e.preventDefault();if(!ack)return;const result=await printing.act({action:'reprint',entryId:reprint.entryId,jobId:reprint.id,expectedVersion:reprint.version,acknowledgeDuplicateRisk:true});if(result)setReprint(null)}}>
   <h3>{tr('確認補印')}</h3><p>{tr('這張可能已印過。請先查看印表機和紙張，避免廚房重做。')}</p>
   <label style={{display:'flex',gap:10,alignItems:'center',minHeight:48}}><input type="checkbox" data-print-risk checked={ack} disabled={blocked} onChange={e=>setAck(e.target.checked)}/>{tr('我已核對，需要再印一份')}</label>
   {printing.error&&<p role="alert">{tr('請查看廚房列印提示，保留此原單核對。')}</p>}
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}><button className="btn btn-primary" type="submit" data-print-copy disabled={blocked||!ack||!bound} style={button}>{tr('建立補印')}</button><button className="btn btn-ghost" type="button" disabled={printing.busy} style={button} onClick={()=>setReprint(null)}>{tr('返回工作單')}</button></div>
  </form>}
 </section>
}
const button={minHeight:48,whiteSpace:'normal'}
