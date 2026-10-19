import {useEffect,useRef,useState} from 'react'
import QRCode from 'qrcode'
import {getReservationState} from '../../utils/dataAccess'
import {tr,trMessage,getLocale} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {readPendingFinancial} from '../../utils/financialCommand'

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export default function TableOrderingPanel({config,session,store,reload,settingsDirty=false}){
 const [count,setCount]=useState(String(config.tableOrdering?.tables.length||5)),[error,setError]=useState(''),[busy,setBusy]=useState(false),[codes,setCodes]=useState([]),[reservationTables,setReservationTables]=useState([]),lock=useRef(false)
 useEffect(()=>{setCount(String(config.tableOrdering?.tables.length||5))},[config.tableOrdering?.tables.length])
 useEffect(()=>{let alive=true;getReservationState(session).then(value=>{if(alive){setReservationTables(value.config.tables);if(value.config.tables.length)setCount(String(value.config.tables.length))}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[session.userId,session.role,config.tableOrdering?.tables.length])
 async function loadCodes(){
  const api=window.electronAPI;if(!api?.db.getTableOrderingContext)throw Error('桌碼請在店面電腦或配對手機產生')
  const [context,status]=await Promise.all([api.db.getTableOrderingContext(),api.server.getStatus()])
  if(!context.enabled||!status.running||!status.tunnelUrl&&(!status.ip||!status.port))throw Error('店面點餐服務尚未啟動')
  const base=status.tunnelUrl||'http://'+status.ip+':'+status.port,origin=new URL(base);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)throw Error('店面點餐服務尚未啟動')
  const result=await Promise.all(context.tables.map(async row=>{const url=new URL('/menu/',origin);url.search=new URLSearchParams({table:row.id,key:row.key}).toString();return {id:row.id,label:row.label,url:url.href,image:await QRCode.toDataURL(url.href,{width:256,margin:3})}}));setCodes(result);return result
 }
 async function produce(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{
   const pending=readPendingFinancial()
   if(pending){if(pending.kind!=='restaurant'||pending.request.action!=='configure'||!pending.request.config?.tableOrdering)throw Error('請先核對上一筆異動');await store.retryFinancial()}
   else{
    if(!config.enabled)throw Error('請先由老闆啟用出餐，再接單備餐')
    if(!/^[1-9]\d{0,2}$/.test(count)||Number(count)>200)throw Error('桌數請填 1 到 200')
    const reservations=await getReservationState(session),shared=reservations.config.tables
    const tables=shared.length?shared.map(row=>({id:row.id,label:row.name})):Array.from({length:Number(count)},(_,i)=>config.tableOrdering?.tables[i]||{id:'table-'+crypto.randomUUID(),label:String(i+1)})
    setReservationTables(shared);setCount(String(tables.length))
    await store.commitRestaurant({action:'configure',expectedConfig:canonicalSignature(config),config:{...config,tableOrdering:{version:1,enabled:true,tables}}})
   }
   await reload?.();await loadCodes()
  }catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
 }
 async function download(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{
   const rows=await loadCodes(),html='<!doctype html><html lang="'+escape(getLocale())+'"><meta charset="utf-8"><title>'+escape(tr('桌碼點餐'))+'</title><style>body{font-family:system-ui;background:white;color:black}.tables{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}.table{break-inside:avoid;text-align:center;border:1px solid black;padding:20px}img{width:220px;max-width:100%}h1{font-size:32px}@media print{.table{break-inside:avoid}}</style><main class="tables">'+rows.map(r=>'<section class="table"><h1>'+escape(tr('桌號 {0}',{0:r.label}))+'</h1><img alt="'+escape(tr('桌碼點餐'))+'" src="'+r.image+'"><p>'+escape(tr('掃碼點餐，店家確認後開始備餐'))+'</p></section>').join('')+'</main></html>'
   const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='table-codes.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
 }
 const available=!!window.electronAPI?.db.getTableOrderingContext
 return <details className="card table-ordering" style={{padding:14,marginBottom:16}} data-table-ordering><summary>{tr('桌碼點餐')}</summary>
  {error&&<p role="alert">{trMessage(error)}</p>}
  {!available?<p>{tr('桌碼請在店面電腦或配對手機產生')}</p>:<>
   <p>{tr('填桌數，產生每桌專用點餐碼。')}</p>
   {settingsDirty&&<p>{tr('請先儲存出餐設定')}</p>}
   <label>{tr('幾張桌子？')}<input data-table-count className="field" inputMode="numeric" aria-label={tr('桌數')} value={count} onChange={e=>setCount(e.target.value)} disabled={busy||!!reservationTables.length}/></label>
   {!!reservationTables.length&&<p>{tr('訂位與點餐共用桌位。')}</p>}
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}><button className="btn btn-primary" style={{minHeight:48}} disabled={busy||!config.enabled||settingsDirty} data-table-produce onClick={produce}>{busy?tr('核對中…'):tr('產生桌碼')}</button>{config.tableOrdering?.enabled&&<button className="btn btn-ghost" style={{minHeight:48}} disabled={busy||settingsDirty} data-table-download onClick={download}>{tr('下載桌碼')}</button>}</div>
   {!!codes.length&&<><p role="status">{tr('已準備 {0} 張桌碼',{0:codes.length})}</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12}}>{codes.map(row=><div key={row.id} style={{textAlign:'center'}}><strong>{tr('桌號 {0}',{0:row.label})}</strong><img alt={tr('桌號 {0}',{0:row.label})} src={row.image} style={{display:'block',width:180,maxWidth:'100%',margin:'0 auto'}}/></div>)}</div></>}
  </>}
 </details>
}
