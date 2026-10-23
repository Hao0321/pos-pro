import {tr,trMessage} from '../i18n'
import {useCallback,useEffect,useRef,useState} from 'react'
import {isElectron,isSharedStore,loadProducts,getOpenShift,loadRestaurantState} from '../utils/dataAccess'
import {browserStorage} from '../utils/browserStorage'
import {inspectBrowserDevice} from '../utils/deviceReadiness'
import {createBackup,getBackupList,exportBackupFile,hasPermission} from '../utils/security'
import {FINANCIAL_PENDING} from '../utils/financialCommand'
import {openingGuide,recentOpeningBackup} from '../utils/openingGuide.mjs'
import '../styles/opening-guide.css'

const labels={pass:'已確認',review:'需核對',blocked:'請先處理'}
export default function ReadinessPage({store,session,backupIssue='',onBackupVerified}){
 const [observation,setObservation]=useState(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[backupRetry,setBackupRetry]=useState(false),[backupPending,setBackupPending]=useState(false)
 const sequence=useRef(0),live=useRef(false),work=useRef(null),pendingBackup=useRef(null),latest=useRef(null),actor=useRef('')
 const actorKey=session.userId+':'+session.role,canBackup=hasPermission(session,'backup.manage');actor.current=actorKey;latest.current={store,session,backupIssue}
 const inspect=useCallback(async()=>{
  if(!live.current||actor.current!==actorKey)return null
  const ticket=++sequence.current;setChecking(true);setError('')
  try{
   const [device,products,shift,restaurant,backups]=await Promise.all([
    (async()=>{if(isSharedStore){const d={...(await inspectBrowserDevice()),mode:'shared-store'};try{await window.electronAPI.db.getStoreSnapshot();d.connected=true}catch{d.connected=false}return d}return isElectron?{mode:'desktop-local'}:inspectBrowserDevice()})(),
    loadProducts(),getOpenShift(),loadRestaurantState(),canBackup?getBackupList().then(rows=>({rows,error:''})).catch(cause=>({rows:[],error:cause.message})):Promise.resolve({rows:[],error:''})
   ])
   if(!Array.isArray(products)||!restaurant?.config||shift!=null&&(typeof shift!=='object'||typeof shift.id!=='string'))throw Error('店裡的資料回覆不完整，請重新檢查。')
   const value={actorKey,device,products,openShift:shift??null,restaurantConfig:restaurant.config,backups:backups.rows,backupError:backups.error,checkedAt:Date.now()}
   if(!live.current||ticket!==sequence.current||actor.current!==actorKey)return null
   setObservation(value);setChecking(false);return value
  }catch(cause){if(live.current&&ticket===sequence.current&&actor.current===actorKey){setObservation({actorKey,error:cause.message});setError(cause.message);setChecking(false)}return null}
 },[actorKey,canBackup])
 useEffect(()=>{
  live.current=true;work.current=null;pendingBackup.current=null;setObservation(null);setMessage('');setBusy(false);setBackupRetry(false);setBackupPending(false);inspect();let timer
  const changed=()=>{if(work.current)return;clearTimeout(timer);timer=setTimeout(()=>{if(!work.current)inspect()},80)}
  for(const event of ['focus','pageshow','pos-data-refreshed','pos-inventory-operation','pos-cash-operation','pos-restaurant-operation'])window.addEventListener(event,changed)
  return()=>{live.current=false;sequence.current++;clearTimeout(timer);for(const event of ['focus','pageshow','pos-data-refreshed','pos-inventory-operation','pos-cash-operation','pos-restaurant-operation'])window.removeEventListener(event,changed)}
 },[inspect])
 function pending(){let found=false,problem='';try{found=!!browserStorage.getItem('pos_pending_checkout_v1')||!!browserStorage.getItem(FINANCIAL_PENDING)}catch{problem='待核對紀錄還沒讀到，請保留原資料。'}const current=latest.current.store;return {pending:found||current.financialState?.phase!=='idle'||current.checkoutState?.phase!=='idle',pendingError:problem}}
 function choose(value,isChecking=false){const current=latest.current,who=current.session;return openingGuide(value,{ready:current.store.ready===true,dataError:current.store.dataError||'',...pending(),canEdit:hasPermission(who,'inventory.edit'),canCost:hasPermission(who,'inventory.cost'),canBackup:hasPermission(who,'backup.manage'),owner:who.role==='owner',stockSetupEnabled:current.store.stockSetupEnabled,backupIssue:current.backupIssue,checking:isChecking})}
 const current=observation?.actorKey===actorKey?observation:null,step=choose(current,checking),reminders=step.reminders??step.checks.filter(row=>row.status==='review').length
 async function action(job){if(work.current)return;const token={actorKey};work.current=token;setBusy(true);setError('');setMessage('');const active=()=>live.current&&actor.current===actorKey&&work.current===token;try{await job(active)}catch(cause){if(active())setError(cause.message||String(cause))}finally{if(active()){work.current=null;setBusy(false)}}}
 async function verifiedBackup(value,active){
  if(!canBackup)throw Error('請店主協助這一步。')
  let proof=pendingBackup.current
  if(!proof){setBackupRetry(true);const result=await createBackup(session,tr('營業前備份'));if(!active())return false;if(typeof result?.id!=='string'||!result.id)throw Error('備份結果還沒確認，請保留原資料並重新檢查。');proof={id:result.id,beforeIds:new Set(Array.isArray(value?.backups)?value.backups.map(row=>row.id):[])};pendingBackup.current=proof;setBackupPending(true)}
  const rows=await getBackupList();if(!active())return false;const saved=Array.isArray(rows)&&rows.find(row=>row.id===proof.id)
  if(!saved||proof.beforeIds.has(proof.id)||!recentOpeningBackup(saved))throw Error('備份結果還沒確認，請保留原資料並重新檢查。')
  pendingBackup.current=null;setBackupPending(false);setBackupRetry(false);onBackupVerified?.();return true
 }
 async function next(){const requested=step.action,requestedTask=step.task,requestedProduct=step.productId;await action(async active=>{
  if(requested==='inspect'){await inspect();return}
  if(requested==='recovery'){if(session.role==='owner'&&active())store.setView('recovery');return}
  if(!['task','pos','backup-start'].includes(requested))return
  const value=await inspect();if(!value||!active())return;const fresh=choose(value)
  if(fresh.action!==requested||requested==='task'&&(fresh.task!==requestedTask||fresh.productId!==requestedProduct)){setMessage('狀態已更新，請依新的下一步繼續。');return}
  if(requested==='task'){store.startReadinessTask(fresh.task,fresh.productId||'');return}
  if(requested==='backup-start'&&!await verifiedBackup(value,active))return
  const checked=await inspect();if(!checked||!active())return
  if(choose(checked).canOperate)store.setView('pos');else setMessage('狀態已更新，請依新的下一步繼續。')
 })}
 async function goToPOS(){await action(async active=>{const value=await inspect();if(value&&active()&&choose(value).canOperate)store.setView('pos')})}
 const primary=step.action==='backup-start'&&(backupPending||backupRetry)?backupPending?'核對剛才的備份並收銀':'重新備份並開始收銀':step.label
 return <div className="opening-guide" data-opening-guide><div className="opening-guide-inner">
  <h1 className="page-title">{tr('營業前檢查')}</h1>
  <section className="card opening-next" data-opening-next={step.kind} aria-busy={checking||busy}>
   <span className="opening-next-eyebrow">{tr('先做這一步')}</span><h2>{tr(step.title)}</h2><p>{trMessage(tr(step.detail,step.values||{}))}</p>
   <button type="button" className="btn btn-primary" data-opening-next-action={step.action} disabled={step.disabled||checking||busy} onClick={next}>{tr(busy?'正在核對…':primary)}</button>
  </section>
  <p className="opening-identity">{isSharedStore?tr('手機與店面電腦共用資料，請保持連線。'):isElectron?tr('資料存在這台電腦，手機可用配對網址加入。'):tr('獨立瀏覽器的資料只在這台裝置。')}</p>
  {error&&<p role="alert" data-opening-error>{trMessage(error)}</p>}{message&&<p role="status">{trMessage(message)}</p>}
  <div className="opening-options"><button type="button" className="btn btn-ghost" disabled={busy||checking} onClick={()=>action(async()=>{await inspect()})}>{tr('重新檢查')}</button>{canBackup&&step.canOperate&&<button type="button" className="btn btn-ghost" data-opening-skip-backup disabled={busy||checking} onClick={goToPOS}>{tr('先去收銀')}</button>}</div>
  <details className="opening-details" data-opening-details><summary>{tr('查看檢查結果（{0} 項提醒）',{0:reminders})}</summary>
   <div className="opening-checks">{step.checks.map(check=><section className="card" data-check={check.id} data-status={check.status} key={check.id}><div className="opening-check-title"><strong>{tr(check.title)}</strong><span>{tr(labels[check.status])}</span></div><p>{trMessage(check.detail)}</p></section>)}</div>
   {current?.backupError&&<p role="alert">{trMessage(current.backupError)}</p>}
   <div className="opening-options">{canBackup&&<><button type="button" className="btn btn-ghost" disabled={busy||checking||pending().pending||!!pending().pendingError} onClick={()=>action(async active=>{const value=await inspect();if(value&&active()&&await verifiedBackup(value,active)){await inspect();if(active())setMessage('本機備份已建立。請再下載一份到裝置外保存。')}})}>{tr('建立本機備份')}</button><button type="button" className="btn btn-ghost" disabled={busy||checking||pending().pending||!!pending().pendingError} onClick={()=>action(async active=>{await exportBackupFile(session);if(active())setMessage('已產生備份下載，請確認檔案已存入「下載項目」，再另存到其他裝置。')})}>{tr('下載備份檔')}</button></>}
    {!isElectron&&!isSharedStore&&<button type="button" className="btn btn-ghost" disabled={busy||checking} onClick={()=>action(async active=>{if(!navigator.storage?.persist)throw Error('此瀏覽器不提供持續保存，請下載備份。');const granted=await navigator.storage.persist();await inspect();if(active())setMessage(granted?'持續保存已獲允許，仍請另外下載備份。':'瀏覽器尚未允許持續保存，請另外下載備份。')})}>{tr('允許持續保存')}</button>}
    <button type="button" className="btn btn-ghost" disabled={busy||checking||!step.canOperate} onClick={goToPOS}>{tr('前往收銀台')}</button>
   </div>
   <p>{tr('正式接單請使用「預訂出餐」，可預留成品或配方原料、收款、交付與取消退款。情境模板內的試賣演練另行保存。')}</p>
   <p>{tr('試賣前先用測試空間跑一筆接單、收款、交付、取消退款與交班，再把自己會用的手機、網路和印表機實際試過。手機離線準備完成後，不要更換網址或清除網站資料。')}</p>
  </details>
 </div></div>
}
