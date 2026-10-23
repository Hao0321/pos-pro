import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {canSaveOriginalCheckout,confirmPendingOriginal} from '../utils/pendingOperationUi.mjs'
import '../styles/pending-transaction.css'

export default function PendingTransactionNotice({store,owner=false,onRecovery,view}){
 const financial=store.financialState,checkout=store.checkoutState
 const financialPending=!!financial?.phase&&financial.phase!=='idle',checkoutPending=!!checkout?.phase&&checkout.phase!=='idle',pendingCount=Number(financialPending)+Number(checkoutPending)
 const active=checkoutPending?{family:'checkout',id:checkout.orderId,phase:checkout.phase,message:checkout.message}:financialPending?{family:'financial',kind:financial.kind,id:financial.id,phase:financial.phase,message:financial.message}:null
 const key=active?active.family+':'+(active.kind||'checkout')+':'+(active.id||''):null,current=useRef(key),running=useRef(false),mounted=useRef(true),notice=useRef(null),lastView=useRef(view)
 if(key)current.current=key
 const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(null),[saveKey,setSaveKey]=useState(null)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{if(lastView.current!==view){lastView.current=view;if(!active){setFeedback(null);setSaveKey(null)}}},[view])
 useEffect(()=>{if(feedback&&notice.current){notice.current.scrollIntoView?.({block:'nearest'});notice.current.focus({preventScroll:true})}},[feedback])
 const outcome=feedback&&(!active||feedback.key===key)?feedback:null,display=active||outcome?.original
 if(!display)return null
 const confirmed=!active&&outcome?.status==='confirmed',rejected=!active&&outcome?.status==='rejected',settled=confirmed||rejected,saving=busy||display.phase==='saving',blocked=display.phase==='blocked'||typeof display.id!=='string'||!display.id
 const canSave=display.family==='checkout'&&canSaveOriginalCheckout(display.id),saveOffered=canSave&&saveKey===key
 async function perform(save=false){
  if(running.current||!active||active.phase!=='uncertain'||!active.id)return
  const original={...active},originalKey=key;running.current=true;setBusy(true);setFeedback(null)
  try{
   const result=await confirmPendingOriginal(original,store,save)
   if(mounted.current&&current.current===originalKey)setFeedback({key:originalKey,original,status:'confirmed',...result})
  }catch(error){
   if(mounted.current&&current.current===originalKey){if(error?.canSaveOriginal)setSaveKey(originalKey);setFeedback({key:originalKey,original,status:error?.notCommitted===true&&error.operationId===original.id?'rejected':'error',message:error?.message||String(error||''),changed:error?.code==='PENDING_ORIGINAL_CHANGED'})}
  }finally{running.current=false;if(mounted.current)setBusy(false)}
 }
 function proceed(){
  if(!settled)return
  if(confirmed&&owner&&outcome.openPurchaseId&&store.openPurchaseDocument)store.openPurchaseDocument(outcome.openPurchaseId)
  else if(confirmed&&display.family==='checkout')store.setView?.('pos')
  setFeedback(null);setSaveKey(null)
 }
 const title=confirmed?'這筆已確認':rejected?'這次沒有保存':blocked?'剛才那筆需要協助核對':saving?'正在確認這筆資料':pendingCount>1?'有 {0} 筆結果待核對':'剛才那筆還沒確認'
 const hint=confirmed?'可以繼續剛才的工作了。':rejected?'請先查看原因，再回原來的工作畫面修改。':blocked?'請店主協助核對，原資料已保留。':saving?'請稍候，先不要重做或再次收款。':saveOffered?'還沒找到保存結果，可以沿用原單號繼續保存。':display.family==='checkout'?'先核對剛才的收款結果，請勿再收款。':'先不要重做或再收款，系統會接續原來那筆。'
 return <section className={'pending-transaction-notice'+(confirmed?' pending-transaction-confirmed':'')} role={settled||saving?'status':'alert'} aria-busy={saving} data-original-notice data-financial-pending={active?.family==='financial'?'':undefined} data-checkout-pending={active?.family==='checkout'?'':undefined} data-original-confirmed={confirmed?display.id:undefined} data-original-rejected={rejected?display.id:undefined}>
  <h2 tabIndex={-1} ref={notice}>{tr(title,{0:pendingCount})}</h2><p>{tr(hint)}</p>
  {outcome?.status==='error'&&<p className="pending-transaction-error">{tr(outcome.changed?'待核對的紀錄已變更，請重新核對。':'還沒確認完成，原資料已保留，請勿重做。')}</p>}
  {rejected&&<p className="pending-transaction-error">{trMessage(outcome.message)}</p>}
  {settled?<button className="btn btn-primary" data-original-continue onClick={proceed}>{tr(confirmed&&owner&&outcome.openPurchaseId?'查看單據':confirmed&&display.family==='checkout'?'繼續收銀':'繼續操作')}</button>:blocked?owner&&onRecovery&&<button className="btn btn-primary" data-recovery-open onClick={onRecovery}>{tr('一步一步找回資料')}</button>:<button className="btn btn-primary" data-original-check={!saveOffered?'':undefined} data-original-save={saveOffered?'':undefined} disabled={saving} onClick={()=>perform(saveOffered)}>{tr(saving?'正在核對…':saveOffered?'繼續保存這張單':'核對上次結果')}</button>}
  {!settled&&!blocked&&owner&&onRecovery&&<button className="btn btn-ghost" data-recovery-open disabled={saving} onClick={onRecovery}>{tr('需要協助？')}</button>}
  <details data-original-details><summary>{tr('查看原單資訊')}</summary>{display.id&&<code data-original-id>{display.id}</code>}{!settled&&display.message&&<p>{trMessage(display.message)}</p>}{outcome?.status==='error'&&<p>{trMessage(outcome.message)}</p>}
   {!settled&&!saving&&display.phase==='uncertain'&&display.family==='checkout'&&<>{canSave&&!saveOffered&&<button className="btn btn-ghost" data-original-save onClick={()=>perform(true)}>{tr('繼續保存這張單')}</button>}{saveOffered&&<button className="btn btn-ghost" data-original-check onClick={()=>perform(false)}>{tr('再次核對結果')}</button>}</>}
  </details>
 </section>
}
