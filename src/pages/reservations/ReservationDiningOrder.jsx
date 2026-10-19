import {useEffect,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import {getReservationDiningContext} from '../../utils/dataAccess'
import {diningDraftSource,diningForm,assertDiningDraftCurrent,diningParent,diningParentIdentity} from '../../utils/reservationDiningDraft.mjs'
import {RESERVATION_DINING_PROTOCOL,reservationDiningOperationId,reservationDiningSchedule} from '../../../electron/reservationDining.mjs'
import RestaurantMenuOrder from '../restaurant/RestaurantMenuOrder'
import OrdinaryRestaurantOrder from '../restaurant/OrdinaryRestaurantOrder'
import './reservationDining.css'

export default function ReservationDiningOrder({bookingId,session,store,onClose}){
 const [context,setContext]=useState(null),[mode,setMode]=useState('menu'),[error,setError]=useState('')
 const load=()=>getReservationDiningContext({bookingId},session)
 useEffect(()=>{let alive=true;load().then(value=>{if(alive){setContext(value);if(!value.restaurant.config.menu)setMode('ordinary')}}).catch(cause=>{if(alive)setError(cause.message)});return()=>{alive=false}},[bookingId,session.userId,session.role])
 if(!context)return <section className="card reservation-dining" role="dialog" aria-modal="false" aria-label={tr('開始點餐')}><p role={error?'alert':'status'}>{trMessage(error||'讀取中…')}</p><button className="btn btn-ghost" onClick={onClose}>{tr('關閉')}</button></section>
 const services={source:diningDraftSource(context),members:context.members,async fields(source){const current=assertDiningDraftCurrent(source,await load()),{note,...fields}=diningForm(source,current.now);return fields},async refreshSource(source){const current=await load();if(current.storeId!==source.storeId||current.epoch!==source.epoch||current.booking.id!==source.bookingId)throw Error('店面或帳號已變更，請保留原輸入核對。');setContext(current);return {...diningDraftSource(current),memberId:current.booking.memberId||current.members.find(row=>row.id===source.memberId)?.id||null}},async prepareRequest(child,source){const current=assertDiningDraftCurrent(source,await load()),schedule=reservationDiningSchedule(child.time,source.timeZone);if(!child.menuReview&&(child.day!==schedule.day||child.slot!==schedule.slot))throw Error('點餐時間已更新，請保留餐點重新核對。');return {...child,...schedule,channel:'walkin',customer:source.customer.name,contact:source.customer.contact,reservationDining:{protocol:RESERVATION_DINING_PROTOCOL,parentId:reservationDiningOperationId(child.storeId,child.id),bookingId:source.bookingId,bookingRevision:source.bookingRevision,tableIds:[...source.tableIds],tableNames:[...source.tableNames],memberId:source.memberId}}}}
 const facade={...store,async commitRestaurant(input,identity,prepare){const child={...input,...identity},current=await load();if(child.reservationDining.bookingRevision!==current.booking.revision)throw Error('桌位或客人資料已更新，請保留餐點並重新核對。');const result=await store.commitReservation(diningParent(child,current.revision),diningParentIdentity(child),prepare?pending=>prepare({request:pending.request.order}):null);return result.dining},async retryFinancial(){const result=await store.retryFinancial();return result?.dining||result}}
 const completed=entryId=>{if(entryId)store.openRestaurantEntry(entryId,bookingId);onClose()}
 return <section className="card reservation-dining" data-reservation-dining={bookingId} role="dialog" aria-modal="false" aria-label={tr('開始點餐')}>
  <div className="reservation-title"><div><h2>{tr('為這一桌點餐')}</h2><p>{context.booking.customer.name} · {context.tableNames.join(' + ')}</p></div><button type="button" className="btn btn-ghost" onClick={onClose}>{tr('先保留，稍後繼續')}</button></div>
  {!context.restaurant.config.enabled?<p role="alert">{tr('請先由老闆啟用餐點與配方。')}</p>:<>
   {context.restaurant.config.menu&&<div className="reservation-actions"><button className="btn btn-ghost" aria-pressed={mode==='menu'} data-reservation-dining-mode="menu" onClick={()=>setMode('menu')}>{tr('餐點選項')}</button><button className="btn btn-ghost" aria-pressed={mode==='ordinary'} data-reservation-dining-mode="ordinary" onClick={()=>setMode('ordinary')}>{tr('一般品項')}</button></div>}
   {context.restaurant.config.menu&&<RestaurantMenuOrder data={context.restaurant} session={session} store={facade} dining={services} active={mode==='menu'} onResume={()=>setMode('menu')} onComplete={completed}/>}
   <OrdinaryRestaurantOrder data={context.restaurant} session={session} store={facade} dining={services} active={mode==='ordinary'} onResume={()=>setMode('ordinary')} onComplete={completed}/>
  </>}
 </section>
}
