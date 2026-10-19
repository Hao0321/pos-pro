import {canonicalSignature} from './operationRules.mjs'
import {reservationError} from './reservationConfig.mjs'
import {validateReservationDiningEntry} from './reservationDining.mjs'
import {needsRestaurantFundsResult,assertRestaurantFundsResult} from './restaurantFundsResult.mjs'

// The parent alone cannot acknowledge a meal, stock allocation or kitchen job.
// Both original signatures and the permanent table relationship must agree.
export function assertReservationDiningResult(request,result){
 if(request.action!=='dine')return result
 const child=request.order,saved=result?.dining,row=saved?.receipt,entry=saved?.entry,link=result?.state?.diningLinks?.find(value=>value.parentId===request.id),booking=result?.state?.bookings?.find(value=>value.id===request.bookingId)
 if(saved?.success!==true||row?.id!==child.id||row.kind!=='restaurant'||row.action!=='create'||row.signature!==canonicalSignature(child)||!Array.isArray(row.productIds)||new Set(row.productIds).size!==row.productIds.length||!Array.isArray(saved.products)||saved.products.length!==row.productIds.length||row.productIds.some(id=>!saved.products.some(product=>product.id===id))||!saved.config||entry?.id!==child.id||!Number.isSafeInteger(row.entityVersion)||row.entityVersion<1||!Number.isSafeInteger(entry.version)||entry.version<row.entityVersion||!link||link.orderId!==child.id||link.requestSignature!==row.signature||!booking?.restaurantOrderIds?.includes(child.id))throw reservationError('HISTORY')
 validateReservationDiningEntry(entry,child)
 if(needsRestaurantFundsResult(child,saved))assertRestaurantFundsResult(child,saved)
 if(child.costMode==='active'){
  const cost=saved.costReceipt
  if(cost?.protocol!=='pos-stock-cost/v1'||cost.success!==true||cost.id!==child.id||cost.sourceMethod!=='applyRestaurantOperation'||!Number.isSafeInteger(cost.sequence)||cost.sequence<2||typeof cost.eventId!=='string'||!cost.eventId||['eventHash','stateDigest'].some(key=>!/^sha256:[a-f0-9]{64}$/.test(cost[key])))throw reservationError('HISTORY')
 }
 return result
}
