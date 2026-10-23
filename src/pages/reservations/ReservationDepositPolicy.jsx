import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import useReservationDraft,{assertReservationDraftResult} from '../../hooks/useReservationDraft'
import {getReservationState,loadRestaurantState} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {reservationDepositPolicyDraft,assertCurrentDepositPolicyDraft} from '../../utils/reservationDepositForms.mjs'
import WorkspaceDraftNotice from '../../components/WorkspaceDraftNotice'

const initial=state=>reservationDepositPolicyDraft(state,'reservation-'+crypto.randomUUID())
export default function ReservationDepositPolicy({state,session,store,onSaved,onClose,onReload}){
 const [value,setValue]=useState(()=>initial(state)),[error,setError]=useState(''),[busy,setBusy]=useState(false),[fundsReady,setFundsReady]=useState(null),lock=useRef(false)
 const draft=useReservationDraft({kind:'reservation-deposit-policy',session,value,hasContent:true,onRestore:source=>setValue(source||initial(state)),onSaved:async(result,source)=>{if(readPendingFinancial()?.request.id===source.id)result=await store.retryFinancial();assertReservationDraftResult(source,result,session);draft.complete();onSaved(result);onClose()}})
 useEffect(()=>{const frame=requestAnimationFrame(()=>document.querySelector('[data-deposit-policy-form]')?.scrollIntoView({block:'start'}));return()=>cancelAnimationFrame(frame)},[])
 useEffect(()=>{let alive=true;loadRestaurantState().then(result=>{if(alive)setFundsReady(result.config.fundsEnabled===true)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[session.userId,state.revision])
 const pending=readPendingFinancial(),ownPending=pending?.kind==='reservation'&&pending.request.id===value.id,disabled=busy||draft.blocked||!!pending||state.needsRecovery,stale=(state.depositPolicy?.version||0)!==value.policyVersion||(state.depositPolicy?.hash||null)!==value.policyHash,requiresFunds=value.enabled&&(value.basis!=='none'||value.base.rules.some(row=>row.basis!=='none'))
 function field(key,next){draft.begin();setError('');setValue(old=>({...old,[key]:next}))}
 function refresh(){draft.begin();setValue(old=>({...old,...Object.fromEntries(Object.entries(initial(state)).filter(([key])=>['base','policyVersion','policyHash'].includes(key)))}));setError('')}
 async function prepareFunds(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{draft.persist();const current=await getReservationState(session);draft.assertScope(current);const restaurant=await loadRestaurantState();if(!restaurant.config.fundsEnabled)await store.commitRestaurant({action:'configure',config:{...restaurant.config,fundsEnabled:true},expectedConfig:canonicalSignature(restaurant.config),storeId:current.storeId,epoch:current.epoch,...(restaurant.fundsSetup?.newStore===true?{fundsSetupProposal:true}:{})},{id:'deposit-setup-'+value.id,time:current.now});const confirmed=await loadRestaurantState();if(!confirmed.config.fundsEnabled)throw Error('餐點收款設定仍需核對。');setFundsReady(true)}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}}
 async function save(event){event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{draft.persist();const current=await getReservationState(session);draft.assertScope(current);const fields=assertCurrentDepositPolicyDraft(current,value);if(requiresFunds){const restaurant=await loadRestaurantState();setFundsReady(restaurant.config.fundsEnabled===true);if(!restaurant.config.fundsEnabled)throw Error('先準備餐點收款，再啟用訂金。')}const result=await store.commitReservation({protocol:'pos-reservation/v1',storeId:current.storeId,epoch:current.epoch,expectedRevision:current.revision,action:'deposit-policy',reviewed:true,...fields},{id:value.id,time:current.now});draft.complete();onSaved(result);onClose()}catch(e){setError(e.message);await onReload?.()}finally{lock.current=false;setBusy(false)}}
 return <form className="card reservation-action" data-deposit-policy-form onSubmit={save}>
  <div className="reservation-title"><h2>{tr('訂金設定')}</h2><button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>{tr('關閉')}</button></div>
  {error&&<p role="alert">{trMessage(error)}</p>}<WorkspaceDraftNotice draft={draft}/>
  <p>{tr('只影響新訂位，原訂位條件照舊。')}</p>
  <fieldset disabled={disabled}><label className="reservation-deposit-accept"><input type="checkbox" data-deposit-policy-enabled checked={value.enabled} onChange={event=>field('enabled',event.target.checked)}/><span>{tr('新訂位收訂金')}</span></label>
   {value.enabled&&<><label>{tr('怎麼計算訂金')}<select className="field" data-deposit-policy-basis value={value.basis} onChange={event=>field('basis',event.target.value)}>{value.basis==='none'||value.base.rules.length>0?<option value="none">{tr('一般訂位免訂金')}</option>:null}<option value="per-booking">{tr('每筆訂位一個金額')}</option><option value="per-guest">{tr('依用餐人數計算')}</option></select></label>{value.basis!=='none'&&<label>{tr(value.basis==='per-guest'?'每位訂金（NT$）':'每筆訂金（NT$）')}<input className="field" data-deposit-policy-amount inputMode="decimal" value={value.amount} maxLength={32} onChange={event=>field('amount',event.target.value)} required/></label>}<p>{tr('訂金可抵餐費，未使用部分可退回。')}</p></>}
  </fieldset>
  {!!value.base.rules.length&&<p>{tr('保留既有 {0} 條特殊條件。',{0:value.base.rules.length})}</p>}
  {stale&&!ownPending&&<><p role="status">{tr('訂金設定已更新，你填的金額仍保留。')}</p><button className="btn btn-ghost" type="button" data-deposit-policy-refresh disabled={disabled} onClick={refresh}>{tr('重新核對訂金設定')}</button></>}
  {requiresFunds&&fundsReady===false&&!ownPending&&<section className="reservation-deposit-terms"><p>{tr('先準備餐點收款，再啟用訂金。')}</p><button className="btn btn-primary" data-deposit-prepare-funds type="button" disabled={disabled} onClick={prepareFunds}>{tr('一鍵準備餐點收款')}</button></section>}
  {ownPending?<button className="btn btn-primary" data-deposit-original-retry type="button" disabled={busy} onClick={async()=>{setBusy(true);try{const result=assertReservationDraftResult(value,await store.retryFinancial(),session);draft.complete();onSaved(result);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}}>{tr('確認原訂位')}</button>:<button className="btn btn-primary" data-deposit-policy-save disabled={disabled||stale||requiresFunds&&fundsReady!==true}>{busy?tr('保存中…'):tr('儲存訂金設定')}</button>}
 </form>
}
