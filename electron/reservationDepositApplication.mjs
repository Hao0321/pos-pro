import {operationHeader} from './operationRules.mjs'
import {reservationId,reservationInteger} from './reservationConfig.mjs'
import {depositError} from './reservationDepositPolicy.mjs'
import {reservationDepositSummary} from './reservationDeposits.mjs'
import {summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {assertReservationDepositApplicationReview,reservationDepositApplicationDescriptor,assertReservationDepositReturnDescriptor,reservationDepositReturnId,RESERVATION_DEPOSIT_APPLICATION} from './reservationDepositAllocation.mjs'

export const RESERVATION_DEPOSIT_APPLICATION_FIELDS={
 'deposit-apply':['bookingId','expectedBookingRevision','orderId','expectedRestaurantVersion','applicationReview','costMode','reviewed'],
 'deposit-return':['bookingId','expectedBookingRevision','orderId','restaurantOperation','returnSources','disposition','reviewed'],
}
function currentBooking(input,state){const booking=state.bookings.find(row=>row.id===input.bookingId);reservationId(input.bookingId);reservationInteger(input.expectedBookingRevision,1,Number.MAX_SAFE_INTEGER);if(!booking||booking.revision!==input.expectedBookingRevision||!['seated','completed'].includes(booking.status)||!booking.depositTerms)throw depositError('STALE');return booking}
export function deriveReservationDepositApplication(input,state,now,{dining=false}={}){
 const booking=currentBooking(input,state),review=input.applicationReview,orderId=input.orderId
 if(!dining&&!['active','reference'].includes(input.costMode))throw depositError('SOURCE')
 reservationId(orderId);reservationInteger(input.expectedRestaurantVersion,1,Number.MAX_SAFE_INTEGER)
 if(!dining&&!booking.restaurantOrderIds?.includes(orderId))throw depositError('SOURCE')
 const context={scope:{storeId:input.storeId,epoch:input.epoch},booking,balance:reservationDepositSummary(state,booking.id),orderId,restaurantVersion:input.expectedRestaurantVersion,totalCents:review?.totalCents,dueCents:review?.dueCents}
 assertReservationDepositApplicationReview(review,context)
 const depositApplication=reservationDepositApplicationDescriptor(input.id,review)
 return {...(dining?{}:{booking:{...structuredClone(booking),revision:booking.revision+1,updatedAt:new Date(now).toISOString()}}),depositApplication}
}
export function deriveReservationDepositReturn(input,state,actor,now){
 if(actor.role!=='owner')throw Error('只有老闆能核對訂金退回。')
 const booking=currentBooking(input,state),request=input.restaurantOperation
 reservationId(input.orderId);operationHeader(request)
 if(!booking.restaurantOrderIds?.includes(input.orderId)||input.id!==reservationDepositReturnId(input.storeId,request.id)||request.kind!=='restaurant'||!['funds-refund','cancel','cancel-part'].includes(request.action)||request.entryId!==input.orderId||request.storeId!==input.storeId||request.epoch!==input.epoch||request.depositDisposition!==input.disposition||!Array.isArray(input.returnSources))throw depositError('SOURCE')
 const total=input.returnSources.reduce((sum,row)=>{if(!Number.isSafeInteger(row?.amountCents)||row.amountCents<1)throw depositError('MONEY');return sum+BigInt(row.amountCents)},0n)
 if(total>100000000000n)throw depositError('MONEY')
 const depositReturn=assertReservationDepositReturnDescriptor({protocol:RESERVATION_DEPOSIT_APPLICATION,id:input.id,bookingId:booking.id,orderId:input.orderId,operationId:request.id,amountCents:Number(total),sources:structuredClone(input.returnSources),disposition:input.disposition})
 // The original receipt caps and per-application returns are checked again by
 // reservationDepositSummary when this event is projected/replayed.
 return {booking:{...structuredClone(booking),revision:booking.revision+1,updatedAt:new Date(now).toISOString()},depositReturn}
}
export function reservationDepositFundingRequest(input,state,entry,{costMode='reference'}={}){
 const dining=input.action==='dine',booking=currentBooking(input,state),review=dining?input.depositReview:input.applicationReview
 if(entry.reservationDining?.bookingId!==booking.id||entry.id!==(dining?input.order.id:input.orderId))throw depositError('SOURCE')
 const balance=reservationDepositSummary(state,booking.id)
 if(!review&&(!balance.availableCents||entry.total===0))return null
 if(!entry.funds)throw Error('請先由老闆啟用餐點分次收款，再核對訂金抵用。')
 const funds=summarizeRestaurantFunds(entry.funds),context={scope:{storeId:input.storeId,epoch:input.epoch},booking,balance,orderId:entry.id,restaurantVersion:entry.version,totalCents:funds.totalCents,dueCents:funds.dueCents}
 if(!review){if(context.balance.availableCents&&funds.dueCents)throw depositError('REVIEW');return null}
 assertReservationDepositApplicationReview(review,context)
 const application=reservationDepositApplicationDescriptor(input.id,review)
 return reservationDepositFundingInput(input,application,input.order?.costMode||costMode)
}
export function reservationDepositFundingInput(input,application,costMode){return {id:application.operationId,time:input.time,kind:'restaurant',action:'funds-deposit-apply',entryId:application.orderId,expectedVersion:(input.action==='dine'?input.depositReview:input.applicationReview).restaurantVersion,storeId:input.storeId,epoch:input.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode,depositApplication:structuredClone(application)}}
