import {useEffect,useMemo,useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {browserStorage} from '../utils/browserStorage'
import {readPendingFinancial} from '../utils/financialCommand'
import {readKitchenPrintPending,retryKitchenPrint,KITCHEN_PRINT_PENDING} from '../utils/kitchenPrintClient'
import {getRecoveryState,applyProtectedRecovery,readRecoveryCommand,retryRecoveryCommand,exportRecoverySource,exportRecoveryDiagnostics,downloadRecoveryData} from '../utils/recoveryClient'
import {exportBackupFile} from '../utils/security'
import RecoverySummary from '../components/RecoverySummary'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {RECOVERY_PROTOCOL} from '../../electron/recoveryRules.mjs'
import '../styles/recovery.css'

function originals(){
  const rows=[],financial=readPendingFinancial(),checkout=browserStorage.getItem('pos_pending_checkout_v1')
  if(financial)rows.push(financial)
  if(checkout){const value=JSON.parse(checkout);if(typeof value.plan?.order?.id!=='string')throw Error('待確認單號需要核對');rows.push({...value,kind:'checkout'})}
  try{const printing=readKitchenPrintPending();if(printing)rows.push(printing)}catch(error){rows.printError=error.message}
  return rows
}
const operationId=pending=>pending.kind==='checkout'?pending.plan.order.id:pending.request.id
export default function RecoveryPage({store,session}){
  const [refresh,setRefresh]=useState(0),[selected,setSelected]=useState(''),[state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[ack,setAck]=useState('')
  const running=useRef(false)
  const root=useRef(null),status=useRef(null)
  useEffect(()=>{if(notice){root.current?.scrollTo?.({top:0,behavior:'auto'});status.current?.focus({preventScroll:true})}},[notice])
  const loaded=useMemo(()=>{try{const rows=originals();return {rows,commands:['restore','recover'].map(readRecoveryCommand).filter(Boolean),error:rows.printError}}catch(error){return {rows:[],commands:[],error:error.message}}},[refresh,store.financialState.phase,store.checkoutState.phase])
  useEffect(()=>{const update=()=>setRefresh(v=>v+1);window.addEventListener('pos-kitchen-print-pending-changed',update);return()=>window.removeEventListener('pos-kitchen-print-pending-changed',update)},[])
  const pending=loaded.rows.find(p=>operationId(p)===selected)||loaded.rows[0],pendingId=pending&&operationId(pending)
  useEffect(()=>{
    let cancelled=false;setState(null);setAck('')
    if(pending)getRecoveryState(pending,session).then(value=>{if(!cancelled)setState(value)}).catch(error=>{if(!cancelled)setError(error.message)})
    return()=>{cancelled=true}
  },[pendingId,refresh,session.userId])
  async function confirmOriginal(allowWaiting=false){
    const proof=await getRecoveryState(pending,session)
    if(proof?.protocol!==RECOVERY_PROTOCOL||proof.operationId!==pendingId||!['matched','missing','different'].includes(proof.active))throw Error('原紀錄仍需要核對，請保留原單號')
    if(proof.active!=='matched'){if(allowWaiting)return false;throw Error('原紀錄仍需要核對，請保留原單號')}
    const current=originals().find(row=>operationId(row)===pendingId)
    if(!current){await store.reloadAfterRecovery();setNotice('原紀錄已確認，可以繼續營業');setRefresh(v=>v+1);return true}
    if(canonicalSignature(current)!==canonicalSignature(pending))throw Error('原單號內容已改變，請保留紀錄核對')

    if(pending?.kind==='checkout')await store.retryCheckout()
    else if(readKitchenPrintPending()?.request.id===pendingId)await retryKitchenPrint(session,{recovered:true})
    else if(pending)await store.retryFinancial()
    await store.reloadAfterRecovery();setNotice('原紀錄已確認，可以繼續營業');setRefresh(v=>v+1)
    return true
  }
  async function perform(action){
    if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('')
    try{await action()}catch(error){setError(error.message);setRefresh(v=>v+1)}finally{running.current=false;setBusy(false)}
  }
  async function recover(source){
    await applyProtectedRecovery(state,source,pending,session)
    await store.reloadAfterRecovery();await confirmOriginal()
  }
  async function retry(entry){
    await retryRecoveryCommand(entry,session);await store.reloadAfterRecovery()
    if(pending)await confirmOriginal(true)
    const waiting=originals().length>0||['restore','recover'].some(kind=>readRecoveryCommand(kind))
    if(waiting)setNotice('這筆已確認，還有紀錄待核對。')
    else if(!pending)setNotice('復原已確認，資料已重新載入')
    setRefresh(v=>v+1)
  }
  function exportPending(){downloadRecoveryData({financial:browserStorage.getItem('pos_pending_financial_v1'),checkout:browserStorage.getItem('pos_pending_checkout_v1'),printing:browserStorage.getItem(KITCHEN_PRINT_PENDING),restore:browserStorage.getItem('pos_pending_restore_v1'),recovery:browserStorage.getItem('pos_pending_recovery_v1')},'pending-original-records');setNotice('已開啟備份下載，請確認檔案實際保存完成')}
  return <section className="recovery-page" ref={root}><header><div><p className="recovery-eyebrow">{tr('保留原單號，安心核對')}</p><h1>{tr('一步一步找回資料')}</h1><p>{tr('先核對原單號，再看保護副本。找回後會核對原紀錄。')}</p></div><button className="btn btn-ghost" onClick={()=>store.setView('dashboard')}>{tr('回首頁')}</button></header>
    {(loaded.error||error)&&<p role="alert" className="recovery-error">{trMessage(loaded.error||error)}</p>}
    {notice&&<p role="status" ref={status} tabIndex={-1} className="recovery-notice">{tr(notice)}</p>}
    {loaded.commands.map(entry=><section className="card" key={entry.kind}><h2>{tr('上次復原結果尚未確認')}</h2><p>{tr('先確認這次復原的結果，再選擇其他副本。')}</p><code>{entry.id}</code><button className="btn btn-primary" disabled={busy} onClick={()=>perform(()=>retry(entry))}>{tr('核對上次復原')}</button></section>)}
    {loaded.rows.length>1&&<label>{tr('選擇要核對的原單')}<select className="field" value={pendingId} onChange={event=>setSelected(event.target.value)}>{loaded.rows.map(row=><option key={operationId(row)} value={operationId(row)}>{operationId(row)}</option>)}</select></label>}
    {pending&&<section className="card"><h2>{tr('先核對這個原單號')}</h2><code data-recovery-original>{pendingId}</code><p>{tr('待確認的交易會保留原編號，請先核對紀錄再繼續操作。')}</p>{state?.active==='matched'&&<button className="btn btn-primary" disabled={busy||loaded.commands.length>0} onClick={()=>perform(confirmOriginal)}>{tr('核對目前的原紀錄')}</button>}</section>}
    {pending&&!state&&!error&&<p role="status">{tr('正在核對保護副本…')}</p>}
    {state?.sources.map(source=><section className="card recovery-source" key={source.id} data-recovery-source><h2>{tr(source.canRecover?'可以找回原紀錄':'這份副本需要核對')}</h2><p>{new Date(source.createdAt).toLocaleString(getLocale())}</p><code>{source.operationId}</code><p>{tr(source.reason)}</p><RecoverySummary current={state.summary} target={source.summary}/>
      {source.canRecover&&state.active==='missing'&&<><p>{tr('系統會找回這份完整帳本，再核對原單號。請先確認現場尚未開始新的營業操作。')}</p><label className="recovery-check"><input type="checkbox" data-recovery-ack checked={ack===source.id} disabled={busy||loaded.commands.length>0} onChange={event=>setAck(event.target.checked?source.id:'')}/><span>{tr('我已核對店面、原單號與副本，確認找回這份資料。')}</span></label><button className="btn btn-primary" data-recovery-restore disabled={busy||ack!==source.id||loaded.commands.length>0} onClick={()=>perform(()=>recover(source))}>{tr('找回資料並核對原紀錄')}</button></>}
      <button className="btn btn-ghost" disabled={busy} onClick={()=>perform(async()=>{await exportRecoverySource(source.id,session);setNotice('已開啟備份下載，請確認檔案實際保存完成')})}>{tr('下載這份保護副本')}</button></section>)}
    {state?.active==='missing'&&!state.sources.length&&<section className="card"><h2>{tr('還沒有找到包含原紀錄的保護副本')}</h2><p>{tr('請保留原單號與目前帳本，到店面電腦核對其他備份及實際收付款紀錄。')}</p></section>}
    {!pending&&!loaded.error&&!loaded.commands.length&&<section className="card"><h2>{tr('目前沒有待核對的交易')}</h2><p>{tr('備份還原可在「設定 → 備份還原」查看預覽後執行。')}</p><button className="btn btn-primary" onClick={()=>store.setView('settings')}>{tr('前往備份還原')}</button></section>}
    <section className="card recovery-exports"><h2>{tr('先保留可以核對的資料')}</h2><p>{tr('有新營運資料時，系統會保留兩份帳本供核對。請另存到安全位置。')}</p><div><button className="btn btn-ghost" disabled={busy} onClick={()=>perform(async()=>{await exportBackupFile(session);setNotice('已開啟備份下載，請確認檔案實際保存完成')})}>{tr('下載目前帳本')}</button><button className="btn btn-ghost" disabled={busy} onClick={()=>perform(exportPending)}>{tr('下載待核對紀錄')}</button></div><details><summary>{tr('資料讀不到時，先保留原始資料')}</summary><p>{tr('這份檔案供協助核對使用，包含店面資料，請安全保存並勿直接匯入。')}</p><button className="btn btn-ghost" disabled={busy} onClick={()=>perform(async()=>{await exportRecoveryDiagnostics(session);setNotice('已開啟備份下載，請確認檔案實際保存完成')})}>{tr('下載原始保留資料')}</button></details></section>
  </section>
}
