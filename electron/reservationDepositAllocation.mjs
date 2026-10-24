import {canonicalSignature} from './operationRules.mjs'
import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {reservationId,reservationInteger} from './reservationConfig.mjs'
import {depositCents,depositError} from './reservationDepositPolicy.mjs'
import {pendingReservationDepositEvent,pendingReservationDepositParent} from './reservationDepositTransition.mjs'

export const RESERVATION_DEPOSIT_APPLICATION='pos-reservation-deposit-application/v1'
export const RESERVATION_DEPOSIT_APPLICATION_FEATURE='reservation-deposit-application-v1'
export const RESERVATION_DEPOSIT_APPLICATION_FENCE='reservationDepositApplicationVersionFence'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),bad=()=>{throw depositError('SOURCE')},digest=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))bad();return value}
export const reservationDepositFundingId=id=>'reservation-deposit-use-'+privateDraftDigest(id).slice(0,48)
export const reservationDepositReturnId=(storeId,id)=>'reservation-deposit-return-'+privateDraftDigest([storeId,id]).slice(0,48)
export const reservationDepositRefundId=(returnId,receiptId)=>'reservation-deposit-refund-'+privateDraftDigest([returnId,receiptId]).slice(0,48)
export const reservationDepositPaymentId=(operationId,index)=>operationId+':'+index
function sourceRows(rows,{payments=false,returns=false}={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)bad()
 const seen=new Set();let total=0n
 for(const row of rows){
  draftObject(row,['receiptId','method','amountCents',...(payments?['paymentId']:[]),...(returns?['applicationId']:[])])
  reservationId(row.receiptId);if(!['cash','bank'].includes(row.method))bad();depositCents(row.amountCents,{positive:true});if(payments)reservationId(row.paymentId);if(returns)reservationId(row.applicationId)
  const key=returns?row.applicationId+':'+row.paymentId:row.receiptId;if(seen.has(key))bad();seen.add(key);total+=BigInt(row.amountCents);if(total>100000000000n)bad()
 }
 return Number(total)
}
export function quoteReservationDepositApplication({scope,booking,balance,orderId,restaurantVersion,totalCents,dueCents}){
 reservationId(scope.storeId);reservationId(scope.epoch);reservationId(orderId);reservationInteger(restaurantVersion,1,Number.MAX_SAFE_INTEGER);depositCents(totalCents);depositCents(dueCents);if(dueCents>totalCents||booking?.storeId!==scope.storeId||balance?.bookingId!==booking.id||!Array.isArray(balance.receipts))bad()
 reservationId(booking.id);reservationInteger(booking.revision,1,Number.MAX_SAFE_INTEGER);depositCents(balance.availableCents)
 const normalized=[],ids=new Set();let available=0n
 for(const receipt of balance.receipts){reservationId(receipt.id);if(ids.has(receipt.id)||!['cash','bank'].includes(receipt.method))bad();ids.add(receipt.id);for(const key of ['amountCents','refundedCents','allocatedCents','availableCents'])depositCents(receipt[key]);if(receipt.amountCents-receipt.refundedCents-receipt.allocatedCents!==receipt.availableCents)bad();normalized.push({receiptId:receipt.id,method:receipt.method,availableCents:receipt.availableCents});available+=BigInt(receipt.availableCents)}
 if(available!==BigInt(balance.availableCents)||available>100000000000n)bad()
 let remaining=Math.min(balance.availableCents,dueCents);const appliedCents=remaining,sources=[]
 for(const receipt of normalized){const amountCents=Math.min(remaining,receipt.availableCents);if(amountCents){sources.push({receiptId:receipt.receiptId,method:receipt.method,amountCents});remaining-=amountCents}}
 const termsHash=booking.depositTerms?.hash||null;if(appliedCents&&!termsHash)bad();if(termsHash)digest(termsHash)
 const body={protocol:RESERVATION_DEPOSIT_APPLICATION,storeId:scope.storeId,epoch:scope.epoch,bookingId:booking.id,bookingRevision:booking.revision,termsHash,currency:'TWD',orderId,restaurantVersion,totalCents,dueCents,availableCents:balance.availableCents,balanceDigest:privateDraftDigest(normalized),sources,appliedCents,remainingMealCents:dueCents-appliedCents}
 return {...body,hash:privateDraftDigest(body)}
}
export function assertReservationDepositApplicationReview(value,context){
 const expected=quoteReservationDepositApplication(context);if(!same(value,expected))throw depositError('REVIEW');return expected
}
export function reservationDepositApplicationDescriptor(id,review){
 reservationId(id);if(review?.protocol!==RESERVATION_DEPOSIT_APPLICATION||review.appliedCents<=0)bad();digest(review.hash);digest(review.termsHash)
 if(sourceRows(review.sources)!==review.appliedCents)bad()
 const operationId=reservationDepositFundingId(id),descriptor={protocol:RESERVATION_DEPOSIT_APPLICATION,id,bookingId:review.bookingId,orderId:review.orderId,operationId,reviewHash:review.hash,termsHash:review.termsHash,amountCents:review.appliedCents,sources:review.sources.map((row,index)=>({...row,paymentId:reservationDepositPaymentId(operationId,index)}))}
 return assertReservationDepositApplicationDescriptor(descriptor)
}
export function assertReservationDepositApplicationDescriptor(value){
 draftObject(value,['protocol','id','bookingId','orderId','operationId','reviewHash','termsHash','amountCents','sources']);if(value.protocol!==RESERVATION_DEPOSIT_APPLICATION)bad();for(const key of ['id','bookingId','orderId','operationId'])reservationId(value[key]);digest(value.reviewHash);digest(value.termsHash);depositCents(value.amountCents,{positive:true})
 if(value.operationId!==reservationDepositFundingId(value.id)||sourceRows(value.sources,{payments:true})!==value.amountCents||value.sources.some((row,index)=>row.paymentId!==reservationDepositPaymentId(value.operationId,index)))bad();return value
}
export function assertReservationDepositReturnDescriptor(value){
 draftObject(value,['protocol','id','bookingId','orderId','operationId','amountCents','sources','disposition']);if(value.protocol!==RESERVATION_DEPOSIT_APPLICATION||!['retain','refund'].includes(value.disposition))bad();for(const key of ['id','bookingId','orderId','operationId'])reservationId(value[key]);depositCents(value.amountCents,{positive:true});if(sourceRows(value.sources,{payments:true,returns:true})!==value.amountCents)bad();return value
}
// These mutable maps are local replay accumulators, never a second persisted
// balance. The root reservation receipts remain the sole source of this view.
export function applyReservationDepositAllocation(event,receipts,applications,{bookingId,termsHash,storeId}){
 const application=event.change.depositApplication,returned=event.change.depositReturn
 if(application&&returned)bad()
 if(application){
  assertReservationDepositApplicationDescriptor(application);if(application.id!==event.id||application.bookingId!==bookingId||application.termsHash!==termsHash||applications.has(application.id))bad()
  for(const source of application.sources){const receipt=receipts.get(source.receiptId);if(!receipt||receipt.method!==source.method||receipt.availableCents<source.amountCents)bad()}
  for(const source of application.sources){const receipt=receipts.get(source.receiptId);receipt.allocatedCents+=source.amountCents;receipt.availableCents-=source.amountCents}
  applications.set(application.id,{...structuredClone(application),returnedCents:0,sources:application.sources.map(row=>({...row,returnedCents:0}))});return {appliedCents:application.amountCents,returnedCents:0}
 }
 if(returned){
  assertReservationDepositReturnDescriptor(returned);if(returned.id!==event.id||returned.bookingId!==bookingId||returned.id!==reservationDepositReturnId(storeId,returned.operationId))bad()
  for(const source of returned.sources){const prior=applications.get(source.applicationId),portion=prior?.sources.find(row=>row.paymentId===source.paymentId),receipt=receipts.get(source.receiptId);if(!prior||prior.bookingId!==returned.bookingId||prior.orderId!==returned.orderId||prior.termsHash!==termsHash||!portion||portion.receiptId!==source.receiptId||portion.method!==source.method||!receipt||receipt.method!==source.method||source.amountCents>portion.amountCents-portion.returnedCents||receipt.allocatedCents<source.amountCents)bad()}
  for(const source of returned.sources){const prior=applications.get(source.applicationId),portion=prior.sources.find(row=>row.paymentId===source.paymentId),receipt=receipts.get(source.receiptId);portion.returnedCents+=source.amountCents;prior.returnedCents+=source.amountCents;receipt.allocatedCents-=source.amountCents;receipt.availableCents+=source.amountCents}
  return {appliedCents:0,returnedCents:returned.amountCents}
 }
 return {appliedCents:0,returnedCents:0}
}
export const isReservationDepositFundingRow=row=>row?.reservationDeposit!==undefined
export const actualRestaurantRefundSources=event=>(event.refunds||[]).filter(row=>!isReservationDepositFundingRow(row))
export function reservationDepositReturnSources(event){return (event.refunds||[]).filter(isReservationDepositFundingRow).map(row=>({receiptId:row.reservationDeposit.receiptId,method:row.method,amountCents:row.amountCents,paymentId:row.paymentId,applicationId:row.reservationDeposit.applicationId}))}
export function reservationDepositReturnRefundSources(returned){
 assertReservationDepositReturnDescriptor(returned)
 const rows=new Map()
 for(const source of returned.sources){const prior=rows.get(source.receiptId);if(prior&&prior.method!==source.method)bad();rows.set(source.receiptId,{receiptId:source.receiptId,method:source.method,amountCents:(prior?.amountCents||0)+source.amountCents})}
 return [...rows.values()]
}
// Complete books bind every liability transfer and release to both originals.
// Partial internal restaurant reads do not contain the complete meal collection;
// their callers still use the common writer/custody and complete-book validator.
export function reservationDepositAllocationMissing(state,book){
 if(!Array.isArray(book.restaurantOrders)||!Array.isArray(book.restaurantOperations))return []
 const applications=new Map(),returns=new Map(),meals=new Map(book.restaurantOrders.map(row=>[row.id,row])),operations=new Map(book.restaurantOperations.map(row=>[row.id,row])),missing=[]
 const childReceipt=(entry,event)=>{const receipt=operations.get(event.id);return receipt&&receipt.entityId===entry.id&&receipt.entityVersion===event.version&&receipt.signature===canonicalSignature(event.input)&&receipt.eventSignature===canonicalSignature(event)}
 for(const root of state.events){
  const application=root.change.depositApplication,returned=root.change.depositReturn
  if(application){
   assertReservationDepositApplicationDescriptor(application);if(applications.has(application.id))bad();applications.set(application.id,{root,application})
   const entry=meals.get(application.orderId),event=entry?.funds?.events.find(row=>row.id===application.operationId)
   if(!entry||!event||!childReceipt(entry,event)){missing.push(root.id);continue}
   if(entry.reservationDining?.bookingId!==application.bookingId||event.input.action!=='funds-deposit-apply'||event.input.entryId!==entry.id||event.input.storeId!==root.storeId||event.input.epoch!==root.input.epoch||!same(event.input.depositApplication,application)||!same(event.actor,root.actor)||event.amountCents!==application.amountCents)bad()
  }
  if(returned){
   assertReservationDepositReturnDescriptor(returned);const key=returned.orderId+':'+returned.operationId;if(returns.has(key))bad();returns.set(key,{root,returned})
   const entry=meals.get(returned.orderId),event=entry?.funds?.events.find(row=>row.id===returned.operationId)
   if(!entry||!event||!childReceipt(entry,event)){missing.push(root.id);continue}
   if(entry.reservationDining?.bookingId!==returned.bookingId||!['funds-refund','cancel','cancel-part'].includes(event.input.action)||!same(event.input,root.input.restaurantOperation)||event.input.entryId!==entry.id||event.input.storeId!==root.storeId||event.input.epoch!==root.input.epoch||!same(reservationDepositReturnSources(event),returned.sources)||event.input.depositDisposition!==returned.disposition||!same(event.actor,root.actor))bad()
   if(returned.disposition==='refund'){
    let sequence=root.sequence,bookingRevision=root.change.booking.revision
    for(const source of reservationDepositReturnRefundSources(returned)){
     const refund=state.events.find(row=>row.id===reservationDepositRefundId(root.id,source.receiptId))
     if(!refund){if(!pendingReservationDepositParent(root))missing.push(root.id);sequence++;bookingRevision++;continue}
     const money=refund.change.deposit,input=refund.input
     if(refund.sequence!==++sequence||input.action!=='deposit-refund'||input.expectedRevision!==sequence-1||input.expectedBookingRevision!==bookingRevision++||input.time!==root.input.time||refund.time!==root.time||refund.storeId!==root.storeId||input.epoch!==root.input.epoch||!same(refund.actor,root.actor)||input.confirmed!==true||!money||money.action!=='refund'||money.bookingId!==returned.bookingId||money.receiptId!==source.receiptId||money.method!==source.method||money.amountCents!==source.amountCents||money.shiftId!==(source.method==='cash'?event.input.shiftId:''))bad()
    }
   }
  }
 }
 for(const entry of book.restaurantOrders)for(const event of entry.funds?.events||[]){
  if(event.input.action==='funds-deposit-apply'&&!applications.has(event.input.depositApplication?.id)&&!pendingReservationDepositEvent(entry.id,event))bad()
  if((event.refunds||[]).some(isReservationDepositFundingRow)&&!returns.has(entry.id+':'+event.id)&&!pendingReservationDepositEvent(entry.id,event))bad()
 }
 return missing
}
