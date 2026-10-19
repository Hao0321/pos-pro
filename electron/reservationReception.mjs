import {moneyValue,canonicalSignature} from './operationRules.mjs'
import {summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {reservationDiningLinks} from './reservationDining.mjs'
import {reservationError} from './reservationConfig.mjs'

export const RESERVATION_RECEPTION_PROTOCOL='pos-reservation-reception/v1'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
function sum(rows,key){const value=rows.reduce((n,row)=>n+row[key],0);if(!Number.isSafeInteger(value)||value<0)throw reservationError('HISTORY');return value}
export function reservationReception(state,entries,missing=[]){
 const links=reservationDiningLinks(state),orders=links.map(link=>{
  const entry=entries.find(row=>row.id===link.orderId)
  if(!entry)return {id:link.orderId,bookingId:link.bookingId,status:'missing',version:null,totalCents:null,retainedCents:null,dueCents:null}
  const funds=entry.funds?summarizeRestaurantFunds(entry.funds):null,totalCents=funds?.totalCents??(entry.status==='cancelled'?0:Math.round(moneyValue(entry.total,'訂單金額')*100)),retainedCents=funds?.retainedCents??(entry.status!=='cancelled'&&entry.saleId?totalCents:0)
  return {id:entry.id,bookingId:link.bookingId,status:entry.status,version:entry.version,totalCents,retainedCents,dueCents:totalCents-retainedCents}
 })
 const bookings=state.bookings.map(booking=>{const rows=orders.filter(row=>row.bookingId===booking.id),missingCount=rows.filter(row=>row.status==='missing').length;return {bookingId:booking.id,orderCount:rows.length,missingCount,unpaidCount:rows.filter(row=>row.dueCents>0).length,totalCents:missingCount?null:sum(rows,'totalCents'),retainedCents:missingCount?null:sum(rows,'retainedCents'),dueCents:missingCount?null:sum(rows,'dueCents')}})
 return {protocol:RESERVATION_RECEPTION_PROTOCOL,head:state.head,needsFullRestore:missing.length>0,orders,bookings}
}
export function assertReservationReception(state){
 const value=state.reception;if(!value)return state
 if(value.protocol!==RESERVATION_RECEPTION_PROTOCOL||value.head!==state.head||typeof value.needsFullRestore!=='boolean'||!Array.isArray(value.orders)||!Array.isArray(value.bookings))throw reservationError('HISTORY')
 const links=state.diningLinks,ids=new Set();if(!Array.isArray(links)||value.orders.length!==links.length)throw reservationError('HISTORY')
 for(const row of value.orders){if(ids.has(row.id)||!links.some(link=>link.orderId===row.id&&link.bookingId===row.bookingId))throw reservationError('HISTORY');ids.add(row.id);if(row.status==='missing'){if(['version','totalCents','retainedCents','dueCents'].some(key=>row[key]!==null)||!value.needsFullRestore||!state.needsRecovery)throw reservationError('HISTORY')}else if(!['reserved','cooking','ready','dispatched','completed','cancelled'].includes(row.status)||!Number.isSafeInteger(row.version)||row.version<1||['totalCents','retainedCents','dueCents'].some(key=>!Number.isSafeInteger(row[key])||row[key]<0)||row.totalCents!==row.retainedCents+row.dueCents)throw reservationError('HISTORY')}
 const expected=state.bookings.map(booking=>{const rows=value.orders.filter(row=>row.bookingId===booking.id),missingCount=rows.filter(row=>row.status==='missing').length;return {bookingId:booking.id,orderCount:rows.length,missingCount,unpaidCount:rows.filter(row=>row.dueCents>0).length,totalCents:missingCount?null:sum(rows,'totalCents'),retainedCents:missingCount?null:sum(rows,'retainedCents'),dueCents:missingCount?null:sum(rows,'dueCents')}})
 if(!same(value.bookings,expected)||value.needsFullRestore!==value.orders.some(row=>row.status==='missing'))throw reservationError('HISTORY')
 return state
}
