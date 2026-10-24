import {useEffect,useRef,useState} from 'react'
import {getLocale,tr,trMessage} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import KitchenPrintStatus from './KitchenPrintStatus'

export default function KitchenPrintPanel({printing,store,session,entries=[],settingsDirty=false}){
 const {state,pending,pendingError,busy,error,message}=printing,owner=session.role==='owner',dirty=useRef(false)
 const [enabled,setEnabled]=useState(false),[locale,setLocale]=useState(getLocale),[paper,setPaper]=useState(false)
 const policySignature=canonicalSignature(state?.policy||null)
 useEffect(()=>{if(state&&!dirty.current){setEnabled(state.policy.enabled);setLocale(state.policy.format?.locale||getLocale());setPaper(false)}},[policySignature])
 const blocked=busy||!!pending||!!pendingError,connected=!!window.electronAPI?.db.applyKitchenPrintOperation
 const open=(state?.jobs||[]).filter(j=>!['confirmed','voided'].includes(j.displayState||j.state))
 const native=connected&&!window.electronAPI.sharedStore
 async function save(e){
  e.preventDefault();if(settingsDirty)return
  const policy=state.setup?{version:1,enabled,destination:state.setup.destination,format:{version:1,locale,columns:state.setup.columns}}:{...state.policy,enabled:false}
  const result=await printing.act({action:'configure',policy,kitchenPaperAcknowledged:paper});if(result){dirty.current=false;setPaper(false)}
 }
 const needsPaper=!!state?.setup&&(!state.binding.ready||enabled&&!state.policy.enabled||locale!==state.policy.format?.locale||canonicalSignature(state.setup.destination)!==canonicalSignature(state.policy.destination)||state.setup.columns!==state.policy.format?.columns)
 return <details className="card" data-kitchen-print-panel style={{padding:14,marginBottom:16,overflowWrap:'anywhere'}}><summary>{tr('廚房列印')}{open.length?' · '+tr('{0} 張待核對',{0:open.length}):''}{pending||pendingError?' · '+tr('請核對上次列印'):''}</summary>
  {error&&<p role="alert">{trMessage(error)}</p>}{pendingError&&<p role="alert">{trMessage(pendingError)}</p>}{message&&<p role="status">{tr(message)}</p>}
  {pending&&<div data-print-pending><p>{tr('上一筆結果尚未確認，請沿用原編號核對。')}</p><button className="btn btn-primary" data-print-retry style={button} disabled={busy} onClick={printing.retry}>{busy?tr('核對中…'):tr('核對上次列印')}</button></div>}
  {(pending||pendingError)&&owner&&<button className="btn btn-ghost" style={button} onClick={()=>store.setView('recovery')}>{tr('資料復原')}</button>}
  {!state&&!error&&<p>{tr('載入列印進度中…')}</p>}
  {state&&!connected&&<p>{tr('此裝置可核對搬入的列印紀錄；送印請使用店面電腦或配對手機。')}</p>}
  {state&&owner&&connected&&<form onSubmit={save} data-print-settings>
   <label style={{display:'flex',gap:10,alignItems:'center',minHeight:48}}><input type="checkbox" data-print-auto checked={enabled} disabled={blocked||settingsDirty} onChange={e=>{dirty.current=true;setEnabled(e.target.checked);setPaper(false)}}/>{tr('接單後自動印')}</label>
   {settingsDirty&&<p>{tr('請先儲存出餐設定')}</p>}
   {(enabled||state.setup)&&<>
    {state.setup?<><p>{tr('印表機')}：{state.setup.destination.type==='windows'?state.setup.destination.name:state.setup.destination.ip+':'+state.setup.destination.port}</p><label style={{display:'grid',gap:6}}>{tr('備餐單語言')}<select className="field" data-print-locale value={locale} disabled={blocked} onChange={e=>{dirty.current=true;setLocale(e.target.value);setPaper(false)}}><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option><option value="zh-CN">简体中文</option></select></label></>:<p>{tr('請先在店面電腦選好印表機並試印。')}</p>}
    {needsPaper&&state.setup&&<label style={{display:'flex',gap:10,alignItems:'center',minHeight:48,marginTop:8}}><input type="checkbox" data-print-paper checked={paper} disabled={blocked} onChange={e=>setPaper(e.target.checked)}/>{tr('已試印，紙張與文字正確')}</label>}
   </>}
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}><button className="btn btn-primary" type="submit" data-print-save disabled={blocked||settingsDirty||enabled&&!state.setup||needsPaper&&!paper} style={button}>{tr('保存列印設定')}</button>{native&&<button className="btn btn-ghost" type="button" disabled={busy} style={button} onClick={()=>store.openHardwareSettings()}>{tr('選印表機、試印')}</button>}</div>
   {state.policy.enabled&&!state.binding.ready&&<p>{tr('自動送印暫停：請重新核對這台電腦的紙張。')}</p>}
  </form>}
  {!!open.length&&<details style={{marginTop:12}}><summary>{tr('需要核對的紙張')}</summary>{open.map(job=><KitchenPrintStatus key={job.id} printing={printing} entry={entries.find(e=>e.id===job.entryId)} job={job} compact/>)}</details>}
 </details>
}
const button={minHeight:48,whiteSpace:'normal'}
