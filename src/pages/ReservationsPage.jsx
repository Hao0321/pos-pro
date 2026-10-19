import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {getReservationState} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import ReservationForm from './reservations/ReservationForm'
import ReservationSettings from './reservations/ReservationSettings'
import ReservationWebsite from './reservations/ReservationWebsite'
import ReservationLinkControl from './reservations/ReservationLinkControl'
import ReservationDiningOrder from './reservations/ReservationDiningOrder'
import './reservations/reservations.css'
import ReservationSettlement from './reservations/ReservationSettlement'
import ReservationDeparture from './reservations/ReservationDeparture'
import {assertReservationReception} from '../../electron/reservationReception.mjs'

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
 const [state,setState]=useState(null),[date,setDate]=useState(''),[unpaidFilter,setUnpaidFilter]=useState(false),[showForm,setShowForm]=useState(false),[showSettings,setShowSettings]=useState(false),[dialog,setDialog]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[hostURL,setHostURL]=useState(null),sequence=useRef(0),lock=useRef(false),refresh=useRef(null)
 useEffect(()=>{
  let alive=true;const load=async()=>{const ticket=++sequence.current;try{const value=assertReservationReception(await getReservationState(session));if(alive&&ticket===sequence.current){setState(value);setDate(old=>old||value.today);return value}}catch(e){if(alive&&ticket===sequence.current)setError(e.message)}return null};refresh.current=load;load()
  const updated=()=>load(),unsubscribe=window.electronAPI?.onReservationChanged?.(updated),timer=setInterval(()=>{if(document.visibilityState==='visible')load()},15000);window.addEventListener('pos-data-refreshed',updated);window.addEventListener('focus',updated);window.addEventListener('pos-reservation-operation',updated)
  return()=>{alive=false;sequence.current++;clearInterval(timer);unsubscribe?.();window.removeEventListener('pos-data-refreshed',updated);window.removeEventListener('focus',updated);window.removeEventListener('pos-reservation-operation',updated);refresh.current=null}
 },[session.userId,session.role])
 useEffect(()=>{const target=store.reservationTarget;if(!state||!target)return;const booking=state.bookings.find(row=>row.id===target.id);if(booking){setDate(booking.date);requestAnimationFrame(()=>document.querySelector('[data-reservation-booking="'+booking.id+'"]')?.scrollIntoView({block:'center'}))}store.consumeReservationTarget?.()},[state,store.reservationTarget])
 function saved(result){sequence.current++;setState(result.state);setError('');setNotice(result.receipt.event.input.action==='waitlist'?'已加入候位，尚未保留桌位。':result.receipt.event.input.action==='book'?'訂位已保存。':'訂位異動已保存。');const entry=result.receipt.event.change.booking;if(entry)setDate(entry.date)}
 async function operation(action,fields={}){
  if(lock.current||!state)return;lock.current=true;setBusy(true);setError('')
  try{const current=await getReservationState(session);if(current.storeId!==state.storeId||current.epoch!==state.epoch)throw Error('訂位資料已更新，請重新核對。');const result=await store.commitReservation({protocol:'pos-reservation/v1',storeId:current.storeId,epoch:current.epoch,expectedRevision:current.revision,action,reviewed:true,...fields},{id:'reservation-'+crypto.randomUUID(),time:current.now});saved(result);setDialog(null)}catch(e){setError(e.message);await refresh.current?.()}finally{lock.current=false;setBusy(false)}
 }
 if(!state)return <main className="reservations-page"><h1>{tr('訂位與候位')}</h1><p role={error?'alert':'status'}>{trMessage(error||'讀取中…')}</p><button className="btn btn-ghost" onClick={()=>refresh.current?.()}>{tr('重新整理')}</button></main>
 const pendingRequest=readPendingFinancial(),pending=!!pendingRequest,disabled=busy||pending||state.needsRecovery,settlements=new Map((state.reception?.bookings||[]).map(row=>[row.bookingId,row])),unsettled=booking=>{const summary=settlements.get(booking.id);return summary?.orderCount&&(summary.missingCount||summary.dueCents>0)},allUnsettled=state.bookings.filter(unsettled),bookings=state.bookings.filter(row=>unpaidFilter?unsettled(row):row.date===date),active=bookings.filter(row=>['waiting','confirmed','arrived','seated'].includes(row.status)),closed=bookings.filter(row=>!active.includes(row)),departedUnsettled=closed.filter(unsettled),archived=closed.filter(row=>!unsettled(row)),now=Date.parse(state.now),actionDisabled=disabled||showForm||showSettings||!!dialog
 const card=booking=><article className="card reservation-booking" key={booking.id} data-reservation-booking={booking.id}>
  <div className="reservation-title"><h2><span className="mono">{booking.slot}</span> {booking.customer.name}</h2><span className={'reservation-status status-'+booking.status}>{tr(labels[booking.status])}</span></div>
  {unpaidFilter&&<p className="reservation-caption"><time dateTime={booking.date}>{booking.date}</time></p>}
  <p>{tr('{0} 位',{0:booking.partySize})} · {booking.tableIds.length?booking.tableIds.map(id=>state.config.tables.find(row=>row.id===id)?.name||id).join(' + '):tr('等待空桌')}</p>
  {booking.customer.contact&&<p className="reservation-contact">{booking.customer.contact}</p>}{booking.note&&<p className="reservation-note">{booking.note}</p>}
  <div className="reservation-actions">
   {booking.status==='confirmed'&&<button className="btn btn-primary" disabled={actionDisabled||now<booking.startMs-120*60000} onClick={()=>operation('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status:'arrived',reason:tr('現場報到')})}>{tr('客人到了')}</button>}
   {booking.status==='arrived'&&<button className="btn btn-primary" disabled={actionDisabled||now<booking.startMs-30*60000} onClick={()=>operation('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status:'seated',reason:tr('安排入座')})}>{tr('安排入座')}</button>}
   {booking.status==='seated'&&<><button className="btn btn-primary" data-reservation-dine disabled={actionDisabled} onClick={()=>setDialog({action:'dine',booking})}>{tr(booking.restaurantOrderIds?.length?'追加餐點':'開始點餐')}</button><button className="btn btn-ghost" disabled={actionDisabled} data-reservation-depart onClick={()=>unsettled(booking)?setDialog({action:'departure',booking}):operation('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status:'completed',reason:tr('客人已離席')})}>{tr('客人已離席')}</button></>}
   {booking.status==='waiting'&&<button className="btn btn-primary" disabled={actionDisabled} onClick={()=>setDialog({action:'promote',booking})}>{tr('有位了，安排桌位')}</button>}
   {['waiting','confirmed','arrived'].includes(booking.status)&&<><button className="btn btn-ghost" disabled={actionDisabled} onClick={()=>setDialog({action:'move',booking})}>{tr('改時間')}</button><button className="btn btn-ghost" disabled={actionDisabled} onClick={()=>setDialog({action:'status',status:'cancelled',booking})}>{tr('取消訂位')}</button></>}
   {booking.status==='confirmed'&&now>=booking.startMs&&<button className="btn btn-ghost" disabled={actionDisabled} onClick={()=>setDialog({action:'status',status:'no-show',booking})}>{tr('客人未到')}</button>}
   {session.role==='owner'&&state.guestLinkPolicy&&state.entries.some(row=>row.event.input.action==='guest'&&row.event.input.request.action==='book'&&row.event.change.booking.id===booking.id)&&<details><summary>{tr('客人的私人連結')}</summary><p>{tr('停用連結不會取消訂位。')}</p><button className="btn btn-ghost" data-reservation-access-open disabled={!hostURL||busy||state.needsRecovery||showForm||showSettings||!!dialog||pending&&!(pendingRequest?.kind==='reservation'&&pendingRequest.request.action==='access'&&pendingRequest.request.bookingId===booking.id)} onClick={()=>setDialog({action:'access',booking})}>{tr('重發私人訂位連結')}</button><button className="btn btn-ghost" data-reservation-access-revoke disabled={actionDisabled||booking.guestAccess?.hash===null} onClick={()=>operation('access',{bookingId:booking.id,expectedBookingRevision:booking.revision,accessHash:null,reason:tr('店家停用私人訂位連結')})}>{tr('停用這個私人連結')}</button></details>}
  </div>
  <ReservationSettlement summary={settlements.get(booking.id)}/>
  {!!booking.restaurantOrderIds?.length&&<div className="reservation-actions">{booking.restaurantOrderIds.map((id,index)=><button type="button" className="btn btn-ghost" data-reservation-dining-entry={id} key={id} onClick={()=>store.openRestaurantEntry(id,booking.id)}>{tr('查看餐點 {0}',{0:index+1})}</button>)}</div>}
  {booking.status==='seated'&&!!booking.restaurantOrderIds?.length&&<p className="reservation-caption">{tr('離席不會結清餐點；收款在餐點單確認。')}</p>}
 </article>
 return <main className="reservations-page" data-reservations-page>
  <header className="reservation-title"><div><h1>{tr('訂位與候位')}</h1><p>{tr('選日期、看空桌、安心接待。')}</p></div><div className="reservation-actions"><button className="btn btn-primary" data-reservation-create disabled={disabled||!state.config.enabled||showSettings||showForm||!!dialog} onClick={()=>{setNotice('');setShowForm(true)}}>{tr('新增訂位')}</button>{session.role==='owner'&&<button className="btn btn-ghost" data-reservation-open-settings disabled={busy||pending||showForm||showSettings||!!dialog} onClick={()=>setShowSettings(true)}>{tr('訂位設定')}</button>}</div></header>
  {error&&<p role="alert">{trMessage(error)}</p>}{notice&&<p role="status">{tr(notice)}</p>}
  {allUnsettled.length>0&&<button type="button" className="btn btn-ghost" data-reservation-unpaid-filter aria-pressed={unpaidFilter} onClick={()=>setUnpaidFilter(value=>!value)}>{tr(unpaidFilter?'回到這一天':'{0} 桌餐點待結清',{0:allUnsettled.length})}</button>}
  {state.needsRecovery&&state.reception?.needsFullRestore?<section className="card reservation-recovery" data-reservation-full-recovery><h2>{tr('先找回餐點與款項')}</h2><p>{tr('這份備份缺少已接單的餐點。請用完整備份找回，系統不會再扣一次庫存。')}</p>{session.role==='owner'?<button type="button" className="btn btn-primary" data-reservation-open-recovery disabled={busy||pending} onClick={()=>store.setView('recovery')}>{tr('開啟完整備份復原')}</button>:<p>{tr('請老闆用完整備份找回餐點與款項。')}</p>}</section>:state.needsRecovery&&<section className="card reservation-recovery"><h2>{tr('先找回未來訂位')}</h2><p>{tr('這份備份較舊，已知訂位仍會顯示。核對後再恢復接單。')}</p>{session.role==='owner'?<button className="btn btn-primary" data-reservation-recover disabled={busy||pending} onClick={()=>operation('recover')}>{tr('已核對，找回訂位並繼續接單')}</button>:<p>{tr('請老闆核對後恢復接單。')}</p>}</section>}
  <ReservationWebsite state={state} owner={session.role==='owner'} disabled={actionDisabled||(!state.publicEnabled&&!state.config.enabled)} onURL={setHostURL} onToggle={enabled=>operation('protect',{enabled:typeof enabled==='boolean'?enabled:!state.publicEnabled})}/>
  {!state.config.enabled&&!state.needsRecovery&&<p className="reservation-caption">{tr(state.revision?'已暫停接受新訂位。':'先設定桌位與時間，就能開始接訂位。')}</p>}
  {showSettings&&session.role==='owner'&&<ReservationSettings state={state} session={session} store={store} onSaved={saved} onClose={()=>setShowSettings(false)}/>}
  {showForm&&<ReservationForm state={state} session={session} store={store} onSaved={saved} onClose={()=>setShowForm(false)}/>}
  {dialog?.action==='departure'?<ReservationDeparture booking={dialog.booking} summary={settlements.get(dialog.booking.id)} disabled={disabled} onClose={()=>setDialog(null)} onPayment={()=>{const first=state.reception.orders.find(row=>row.bookingId===dialog.booking.id&&row.dueCents>0);if(first)store.openRestaurantEntry(first.id,dialog.booking.id)}} onConfirm={()=>operation('status',{bookingId:dialog.booking.id,expectedBookingRevision:dialog.booking.revision,status:'completed',reason:tr(unsettled(dialog.booking)?'客人已走，保留待收款':'客人已離席')})}/>:dialog?.action==='dine'?<ReservationDiningOrder key={dialog.booking.id} bookingId={dialog.booking.id} session={session} store={store} onClose={()=>setDialog(null)}/>:dialog?.action==='access'?<ReservationLinkControl key={dialog.booking.id} booking={dialog.booking} state={state} session={session} store={store} hostURL={hostURL} onSaved={saved} onClose={()=>setDialog(null)}/>:dialog&&<Action key={dialog.booking.id+dialog.action+dialog.status} dialog={dialog} state={state} disabled={disabled} onClose={()=>setDialog(null)} onSave={fields=>operation(dialog.action,{bookingId:dialog.booking.id,expectedBookingRevision:dialog.booking.revision,...fields})}/>}
  <label className="reservation-date-filter">{tr('查看哪一天')}<input className="field" data-reservation-filter type="date" value={date} onChange={e=>{setDate(e.target.value);setUnpaidFilter(false)}}/></label>
  <div className="reservation-list">{active.map(card)}</div>{!active.length&&<p>{tr('這天還沒有待接待的客人。')}</p>}
  {!!departedUnsettled.length&&<section data-reservation-departed-unsettled><h2>{tr('已離席，餐點尚未結清')}</h2><div className="reservation-list">{departedUnsettled.map(card)}</div></section>}
  {!!archived.length&&<details><summary>{tr('查看已結束的訂位')}</summary><div className="reservation-list">{archived.map(card)}</div></details>}
  <details className="reservation-privacy"><summary>{tr('訂位接單方式')}</summary><p>{tr('客人從網站訂位，店員也能登記電話與現場訂位；手機與電腦共用同一份資料。')}</p></details>
 </main>
}
