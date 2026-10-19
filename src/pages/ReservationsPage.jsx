import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {getReservationState} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import ReservationForm from './reservations/ReservationForm'
import ReservationSettings from './reservations/ReservationSettings'
import './reservations/reservations.css'

const labels={waiting:'候位中',confirmed:'已訂位',arrived:'已報到',seated:'用餐中',completed:'已離席',cancelled:'已取消', 'no-show':'未到店'}
function Action({dialog,state,disabled,onClose,onSave}){
 const [date,setDate]=useState(dialog.booking.date),[slot,setSlot]=useState(dialog.booking.slot),[reason,setReason]=useState(''),moving=['move','promote'].includes(dialog.action)
 return <form className="card reservation-action" role="dialog" aria-modal="false" aria-label={tr(moving?'安排訂位時間':'確認訂位異動')} onSubmit={e=>{e.preventDefault();onSave(moving?{date,slot,partySize:dialog.booking.partySize,tableIds:[],reason}:{status:dialog.status,reason})}}>
  <h2>{dialog.booking.customer.name} · {tr(moving?'安排訂位時間':'確認訂位異動')}</h2>
  {moving&&<div className="reservation-fields"><label>{tr('訂位日期')}<input className="field" type="date" min={state.today} value={date} disabled={disabled} onChange={e=>setDate(e.target.value)} required/></label><label>{tr('希望用餐時間')}<input className="field" type="time" step={state.config.slotMinutes*60} value={slot} disabled={disabled} onChange={e=>setSlot(e.target.value)} required/></label></div>}
  {!moving&&<p>{tr('改為：{0}',{0:tr(labels[dialog.status])})}</p>}
  <label>{tr('簡單記一下原因')}<input className="field" data-reservation-reason autoFocus maxLength={500} value={reason} disabled={disabled} onChange={e=>setReason(e.target.value)} required/></label>
  <div className="reservation-actions"><button className="btn btn-primary" data-reservation-action-save disabled={disabled||!reason.trim()}>{tr('確認這次異動')}</button><button type="button" className="btn btn-ghost" disabled={disabled} onClick={onClose}>{tr('關閉')}</button></div>
 </form>
}
export default function ReservationsPage({session,store}){
 const [state,setState]=useState(null),[date,setDate]=useState(''),[showForm,setShowForm]=useState(false),[showSettings,setShowSettings]=useState(false),[dialog,setDialog]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),sequence=useRef(0),lock=useRef(false),refresh=useRef(null)
 useEffect(()=>{
  let alive=true;const load=async()=>{const ticket=++sequence.current;try{const value=await getReservationState(session);if(alive&&ticket===sequence.current){setState(value);setDate(old=>old||value.today);return value}}catch(e){if(alive&&ticket===sequence.current)setError(e.message)}return null};refresh.current=load;load()
  const updated=()=>load(),timer=setInterval(()=>{if(document.visibilityState==='visible')load()},15000);window.addEventListener('pos-data-refreshed',updated);window.addEventListener('focus',updated);window.addEventListener('pos-reservation-operation',updated)
  return()=>{alive=false;sequence.current++;clearInterval(timer);window.removeEventListener('pos-data-refreshed',updated);window.removeEventListener('focus',updated);window.removeEventListener('pos-reservation-operation',updated);refresh.current=null}
 },[session.userId,session.role])
 function saved(result){sequence.current++;setState(result.state);setError('');setNotice(result.receipt.event.input.action==='waitlist'?'已加入候位，尚未保留桌位。':result.receipt.event.input.action==='book'?'訂位已保存。':'訂位異動已保存。');const entry=result.receipt.event.change.booking;if(entry)setDate(entry.date)}
 async function operation(action,fields={}){
  if(lock.current||!state)return;lock.current=true;setBusy(true);setError('')
  try{const current=await getReservationState(session);if(current.storeId!==state.storeId||current.epoch!==state.epoch)throw Error('訂位資料已更新，請重新核對。');const result=await store.commitReservation({protocol:'pos-reservation/v1',storeId:current.storeId,epoch:current.epoch,expectedRevision:current.revision,action,reviewed:true,...fields},{id:'reservation-'+crypto.randomUUID(),time:current.now});saved(result);setDialog(null)}catch(e){setError(e.message);await refresh.current?.()}finally{lock.current=false;setBusy(false)}
 }
 if(!state)return <main className="reservations-page"><h1>{tr('訂位與候位')}</h1><p role={error?'alert':'status'}>{trMessage(error||'讀取中…')}</p><button className="btn btn-ghost" onClick={()=>refresh.current?.()}>{tr('重新整理')}</button></main>
 const pending=!!readPendingFinancial(),disabled=busy||pending||state.needsRecovery,bookings=state.bookings.filter(row=>row.date===date),active=bookings.filter(row=>['waiting','confirmed','arrived','seated'].includes(row.status)),closed=bookings.filter(row=>!active.includes(row)),now=Date.parse(state.now),actionDisabled=disabled||showForm||showSettings||!!dialog
 const card=booking=><article className="card reservation-booking" key={booking.id} data-reservation-booking={booking.id}>
  <div className="reservation-title"><h2><span className="mono">{booking.slot}</span> {booking.customer.name}</h2><span className={'reservation-status status-'+booking.status}>{tr(labels[booking.status])}</span></div>
  <p>{tr('{0} 位',{0:booking.partySize})} · {booking.tableIds.length?booking.tableIds.map(id=>state.config.tables.find(row=>row.id===id)?.name||id).join(' + '):tr('等待空桌')}</p>
  {booking.customer.contact&&<p className="reservation-contact">{booking.customer.contact}</p>}{booking.note&&<p className="reservation-note">{booking.note}</p>}
  <div className="reservation-actions">
   {booking.status==='confirmed'&&<button className="btn btn-primary" disabled={actionDisabled||now<booking.startMs-120*60000} onClick={()=>operation('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status:'arrived',reason:tr('現場報到')})}>{tr('客人到了')}</button>}
   {booking.status==='arrived'&&<button className="btn btn-primary" disabled={actionDisabled||now<booking.startMs-30*60000} onClick={()=>operation('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status:'seated',reason:tr('安排入座')})}>{tr('安排入座')}</button>}
   {booking.status==='seated'&&<button className="btn btn-primary" disabled={actionDisabled} onClick={()=>operation('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status:'completed',reason:tr('客人已離席')})}>{tr('客人已離席')}</button>}
   {booking.status==='waiting'&&<button className="btn btn-primary" disabled={actionDisabled} onClick={()=>setDialog({action:'promote',booking})}>{tr('有位了，安排桌位')}</button>}
   {['waiting','confirmed','arrived'].includes(booking.status)&&<><button className="btn btn-ghost" disabled={actionDisabled} onClick={()=>setDialog({action:'move',booking})}>{tr('改時間')}</button><button className="btn btn-ghost" disabled={actionDisabled} onClick={()=>setDialog({action:'status',status:'cancelled',booking})}>{tr('取消訂位')}</button></>}
   {booking.status==='confirmed'&&now>=booking.startMs&&<button className="btn btn-ghost" disabled={actionDisabled} onClick={()=>setDialog({action:'status',status:'no-show',booking})}>{tr('客人未到')}</button>}
  </div>
 </article>
 return <main className="reservations-page" data-reservations-page>
  <header className="reservation-title"><div><h1>{tr('訂位與候位')}</h1><p>{tr('選日期、看空桌、安心接待。')}</p></div><div className="reservation-actions"><button className="btn btn-primary" data-reservation-create disabled={disabled||!state.config.enabled||showSettings||showForm||!!dialog} onClick={()=>{setNotice('');setShowForm(true)}}>{tr('新增訂位')}</button>{session.role==='owner'&&<button className="btn btn-ghost" data-reservation-open-settings disabled={busy||pending||showForm||showSettings||!!dialog} onClick={()=>setShowSettings(true)}>{tr('訂位設定')}</button>}</div></header>
  {error&&<p role="alert">{trMessage(error)}</p>}{notice&&<p role="status">{tr(notice)}</p>}
  {state.needsRecovery&&<section className="card reservation-recovery"><h2>{tr('先找回未來訂位')}</h2><p>{tr('這份備份較舊，已知訂位仍會顯示。核對後再恢復接單。')}</p>{session.role==='owner'?<button className="btn btn-primary" data-reservation-recover disabled={busy||pending} onClick={()=>operation('recover')}>{tr('已核對，找回訂位並繼續接單')}</button>:<p>{tr('請老闆核對後恢復接單。')}</p>}</section>}
  {!state.config.enabled&&!state.needsRecovery&&<p className="reservation-caption">{tr(state.revision?'已暫停接受新訂位。':'先設定桌位與時間，就能開始接訂位。')}</p>}
  {showSettings&&session.role==='owner'&&<ReservationSettings state={state} session={session} store={store} onSaved={saved} onClose={()=>setShowSettings(false)}/>}
  {showForm&&<ReservationForm state={state} session={session} store={store} onSaved={saved} onClose={()=>setShowForm(false)}/>}
  {dialog&&<Action key={dialog.booking.id+dialog.action+dialog.status} dialog={dialog} state={state} disabled={disabled} onClose={()=>setDialog(null)} onSave={fields=>operation(dialog.action,{bookingId:dialog.booking.id,expectedBookingRevision:dialog.booking.revision,...fields})}/>}
  <label className="reservation-date-filter">{tr('查看哪一天')}<input className="field" data-reservation-filter type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  <div className="reservation-list">{active.map(card)}</div>{!active.length&&<p>{tr('這天還沒有待接待的客人。')}</p>}
  {!!closed.length&&<details><summary>{tr('查看已結束的訂位')}</summary><div className="reservation-list">{closed.map(card)}</div></details>}
  <details className="reservation-privacy"><summary>{tr('訂位接單方式')}</summary><p>{tr('目前由店員登記電話與現場訂位；配對手機與電腦共用同一份資料。')}</p></details>
 </main>
}
