import {useEffect,useMemo,useRef,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import {getDisplayPreferences} from '../../../public/i18n/preferences.mjs'
import useReservationDraft,{assertReservationDraftResult} from '../../hooks/useReservationDraft'
import {getReservationState,getOpenShift,loadRestaurantState} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {reservationDepositMoneyContext,reservationDepositMoneyDraft,previewReservationDepositMoney,reservationDepositFormFields} from '../../utils/reservationDepositForms.mjs'
import {fundsAmountText,parseFundsAmount} from '../../utils/restaurantFundsView.mjs'
import WorkspaceDraftNotice from '../../components/WorkspaceDraftNotice'

const methodLabel=method=>tr(method==='cash'?'現金':'銀行轉帳'),money=value=>'NT$ '+fundsAmountText(value)
function initial(context,action){const value=reservationDepositMoneyDraft(context,action,'reservation-'+crypto.randomUUID());if(action==='deposit-refund')value.reason=tr('退回未使用訂金');return value}
export default function ReservationDepositMoney(props){
 const context=useMemo(()=>{try{return reservationDepositMoneyContext(props.state,props.bookingId)}catch(error){return {error:error.message}}},[props.state,props.bookingId])
 if(context.error)return <section className="card reservation-action" data-deposit-money-error><h2>{tr('訂位訂金')}</h2><p role="alert">{trMessage(context.error)}</p><button className="btn btn-ghost" onClick={props.onClose}>{tr('關閉')}</button></section>
 return <MoneyForm {...props} context={context}/>
}
function MoneyForm({state,context,bookingId,action,session,store,onSaved,onClose,onReload}){
 const [value,setValue]=useState(()=>initial(context,action)),[error,setError]=useState(''),[busy,setBusy]=useState(false),[shift,setShift]=useState(store.openShift||null),lock=useRef(false),receiving=value.action==='deposit-receive'
 const draft=useReservationDraft({kind:'reservation-deposit:'+action.slice(8)+':'+bookingId,session,value,hasContent:true,onRestore:source=>setValue(source||initial(context,action)),onSaved:async(result,source)=>{if(readPendingFinancial()?.request.id===source.id)result=await store.retryFinancial();assertReservationDraftResult(source,result,session);draft.complete();onSaved(result);onClose()}})
 useEffect(()=>{const frame=requestAnimationFrame(()=>document.querySelector('[data-deposit-money-form]')?.scrollIntoView({block:'start'}));return()=>cancelAnimationFrame(frame)},[])
 useEffect(()=>{let alive=true;const load=()=>getOpenShift().then(current=>{if(alive)setShift(current)}).catch(e=>{if(alive)setError(e.message)});load();window.addEventListener('focus',load);return()=>{alive=false;window.removeEventListener('focus',load)}},[state.revision,session.userId])
 const pending=readPendingFinancial(),ownPending=pending?.kind==='reservation'&&pending.request.id===value.id,disabled=busy||draft.blocked||!!pending||state.needsRecovery,stale=canonicalSignature(value.review)!==canonicalSignature(context.review),available=context.sources.filter(row=>row.availableCents>0),source=context.sources.find(row=>row.id===value.receiptId),maximum=receiving?context.review.remainingCents:source?.availableCents||0
 let preview=null,hint='';try{preview=previewReservationDepositMoney(value,context,session.role,shift?.id||'')}catch(e){hint=e.message}
 let fullAmount=false;try{fullAmount=parseFundsAmount(value.amount)===maximum}catch{}
 function field(key,next){draft.begin();setError('');setValue(old=>({...old,[key]:next,confirmed:key==='confirmed'?next:false,...(key==='customPaid'?{paid:''}:{}),...(key==='method'?{customPaid:false,paid:''}:{})}))}
 function selectSource(receiptId){const selected=context.sources.find(row=>row.id===receiptId);draft.begin();setError('');setValue(old=>({...old,receiptId,method:selected?.method||old.method,amount:selected?.availableCents?fundsAmountText(selected.availableCents):'',confirmed:false}))}
 function refresh(){draft.begin();setError('');setValue(old=>({...old,review:structuredClone(context.review),receiptId:receiving?'':available.some(row=>row.id===old.receiptId)?old.receiptId:'',confirmed:false}))}
 async function save(event){event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{draft.persist();const current=await getReservationState(session);draft.assertScope(current);const live=reservationDepositMoneyContext(current,bookingId),actualShift=await getOpenShift();setShift(actualShift);const checked=previewReservationDepositMoney(value,live,session.role,actualShift?.id||'');if(receiving&&!(await loadRestaurantState()).config.fundsEnabled)throw Error('請先讓老闆準備餐點收款。');const fields=reservationDepositFormFields(value,{shiftId:checked.shiftId}),result=await store.commitReservation({protocol:'pos-reservation/v1',storeId:current.storeId,epoch:current.epoch,expectedRevision:current.revision,action:value.action,reviewed:true,...fields},{id:value.id,time:current.now});draft.complete();onSaved(result);onClose()}catch(e){setError(e.message);await onReload?.()}finally{lock.current=false;setBusy(false)}}
 const sourceLabel=row=>{const stamp=row.time?new Intl.DateTimeFormat(getDisplayPreferences().locale,{timeZone:state.config.timeZone,dateStyle:'short',timeStyle:'short'}).format(new Date(row.time)):'';return methodLabel(row.method)+' · '+stamp+' · '+tr('可退 {0}',{0:money(row.availableCents)})}
 let originalAmount=null;try{originalAmount=parseFundsAmount(value.amount)}catch{}
 return <form className="card reservation-action" data-deposit-money-form={receiving?'receive':'refund'} onSubmit={save}>
  <div className="reservation-title"><h2>{context.booking.customer.name} · {tr(receiving?'登記訂金實收':'退回未使用訂金')}</h2><button type="button" className="btn btn-ghost" disabled={busy} data-deposit-money-close onClick={onClose}>{tr('關閉')}</button></div>
  {error&&<p role="alert">{trMessage(error)}</p>}<WorkspaceDraftNotice draft={draft}/>
  {ownPending?<section className="reservation-deposit-terms"><p>{tr('正在核對原來這筆款項。')}</p>{originalAmount!==null&&<strong>{money(originalAmount)}</strong>}<p>{methodLabel(value.method)}</p><button className="btn btn-primary" type="button" data-deposit-original-retry disabled={busy} onClick={async()=>{setBusy(true);try{const result=assertReservationDraftResult(value,await store.retryFinancial(),session);draft.complete();onSaved(result);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}}>{tr('確認原訂位')}</button></section>:<>
   {(!fullAmount||!receiving&&context.review.availableCents!==maximum)&&<p>{tr(receiving?'還能收訂金 {0}':'未使用訂金 {0}',{0:money(receiving?context.review.remainingCents:context.review.availableCents)})}</p>}
   <fieldset disabled={disabled}>
    {receiving?<fieldset className="reservation-mode"><legend>{tr('收到哪種款項')}</legend>{['cash','bank'].map(method=><label key={method}><input type="radio" name="deposit-method" data-deposit-method={method} checked={value.method===method} onChange={()=>field('method',method)}/>{methodLabel(method)}</label>)}</fieldset>:<label>{tr('退哪筆原收款')}<select className="field" data-deposit-source value={value.receiptId} onChange={event=>selectSource(event.target.value)}><option value="">{tr('選擇原收款')}</option>{available.map((row,index)=><option key={row.id} value={row.id}>{index+1}. {methodLabel(row.method)} · {money(row.availableCents)}</option>)}</select></label>}
    <label>{tr(receiving?'這次實收訂金（NT$）':'這次已退金額（NT$）')}<input className="field" data-deposit-amount inputMode="decimal" maxLength={32} value={value.amount} onChange={event=>field('amount',event.target.value)} required/></label>
    {!fullAmount&&<button className="btn btn-ghost" type="button" data-deposit-fill-maximum disabled={!maximum||stale} onClick={()=>field('amount',fundsAmountText(maximum))}>{tr(receiving?'填入可收金額':'填入可退金額')}</button>}
    {receiving&&value.method==='cash'&&<><label className="reservation-deposit-accept"><input type="checkbox" data-deposit-custom-paid checked={value.customPaid} onChange={event=>field('customPaid',event.target.checked)}/><span>{tr('需要找零')}</span></label>{value.customPaid&&<label>{tr('客人付了多少（NT$）')}<input className="field" data-deposit-paid inputMode="decimal" value={value.paid} maxLength={32} onChange={event=>field('paid',event.target.value)} required/></label>}</>}
    <details><summary>{tr('加個款項備註')}</summary><label>{tr('轉帳或收退款備註')}<input className="field" data-deposit-reference value={value.reference} maxLength={120} onChange={event=>field('reference',event.target.value)}/></label>{!receiving&&<label>{tr('退款原因')}<input className="field" data-deposit-reason value={value.reason} maxLength={500} onChange={event=>field('reason',event.target.value)} required/></label>}{source&&<p>{sourceLabel(source)}</p>}{source?.reference&&<p>{tr('原收款備註：{0}',{0:source.reference})}</p>}</details>
   </fieldset>
   {stale?<><p role="status">{tr('訂金資料已更新，原輸入仍保留。')}</p><button className="btn btn-ghost" type="button" data-deposit-money-refresh disabled={disabled} onClick={refresh}>{tr('重新核對金額')}</button></>:preview?<section className="reservation-deposit-terms" data-deposit-money-preview><strong>{tr(receiving?'本次實收 {0}':'本次退款 {0}',{0:money(preview.amountCents)})}</strong>{receiving&&value.method==='cash'&&<p data-deposit-change>{tr('找零 {0}',{0:money(preview.changeCents)})}</p>}{!receiving&&<p>{methodLabel(preview.method)}</p>}</section>:hint&&<p role="status">{trMessage(hint)}</p>}
   {value.method==='cash'&&!shift&&<button className="btn btn-ghost" type="button" data-deposit-open-shift disabled={disabled} onClick={()=>store.setView('shifts')}>{tr('先去開班')}</button>}
   {value.method==='bank'&&<p className="reservation-caption">{tr(receiving?'請先核對銀行確實入帳，再登記。':'請先完成銀行退款，再登記；系統不會代為轉帳。')}</p>}
   <label className="reservation-deposit-accept"><input type="checkbox" data-deposit-money-confirmed disabled={disabled||stale||!preview} checked={value.confirmed} onChange={event=>field('confirmed',event.target.checked)}/><span>{tr(receiving?'我已確認實際收到這筆款項':'我已實際退回這筆款項')}</span></label>
   <button className="btn btn-primary" data-deposit-money-save disabled={disabled||stale||!preview||!value.confirmed}>{busy?tr('保存中…'):tr(receiving?'記錄這筆收款':'記錄這筆退款')}</button>
  </>}
 </form>
}
