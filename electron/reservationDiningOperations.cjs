const {planReservation}=require('./reservationModel.mjs')
const {reservationData}=require('./reservationCommit.mjs')
const {readReservationBook,assertReservationResult}=require('./reservationHistory.mjs')
const {assertReservationDiningResult}=require('./reservationDiningResult.mjs')
const {reservationError,RESERVATION_METHOD}=require('./reservationConfig.mjs')
const {needsLotExpiry}=require('./browserLots.mjs')
const {canonicalSignature}=require('./operationRules.mjs')
const {reservationActor}=require('./reservationModel.mjs')
const {reservationDepositFundingRequest,reservationDepositFundingInput}=require('./reservationDepositApplication.mjs')
const {reservationDepositFundingId}=require('./reservationDepositAllocation.mjs')
const {withReservationDepositTransition}=require('./reservationDepositTransition.mjs')
const {planRestaurantFundsEvent}=require('./restaurantFunds.mjs')
const {salesDate}=require('./salesRules.mjs')
const {assertReservationDepositApplicationResult}=require('./reservationDepositApplicationResult.mjs')

module.exports=function(db,api,stockStore,kitchenRuntime,{book,known,commit,restaurant}){
 const unavailable=(method,id)=>db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(method,id)
 const reject=result=>{if(result?.success!==true)throw Object.assign(Error(result?.error||'訂位餐點尚未確認，請保留原編號。'),{historyUncertain:result?.committed!==false})}
 function apply(input,actor){
  let checked=false,existing=false,uncertain=false
  try{return kitchenRuntime.deferWake(()=>db.transaction(()=>stockStore.scope(()=>{
   const scope=api.getPrivateDraftContext(actor),before=book(),retained=known(scope),{history,data}=reservationData(before,scope,Date.now(),retained,{costMode:stockStore.active()?'active':'reference'})
   checked=true;existing=history.byId.has(input?.id)
   const time=new Date(Date.now()).toISOString(),dine=input.action==='dine'
   function completed(parent,funding=null){
    const result={...parent,...(funding?{depositFunding:funding}:{})}
    if(dine){result.dining=restaurant(input.order,actor);reject(result.dining)}
    return assertReservationDepositApplicationResult(input,assertReservationDiningResult(input,assertReservationResult(input,result)))
   }
   if(existing){
    // A restored parent cannot recreate an already promised meal or its stock.
    const parent=commit(input,actor,scope,{costMode:data.costMode});reject(parent)
    if(!history.recorded.some(row=>row.id===input.id)||history.diningMissing.length||history.depositMissing.length||dine&&(!before.restaurantOrders.some(row=>row.id===input.order.id)||!before.restaurantOperations.some(row=>row.id===input.order.id))){uncertain=true;throw reservationError('DINING_RECOVERY')}
    const application=parent.receipt.event.change.depositApplication
    let funding=null;if(application){funding=restaurant(reservationDepositFundingInput(input,application,dine?input.order.costMode:input.costMode),actor);reject(funding)}
    return completed(parent,funding)
   }
   if(unavailable(RESERVATION_METHOD,input.id)||dine&&unavailable('applyRestaurantOperation',input?.order?.id)||unavailable('applyRestaurantOperation',reservationDepositFundingId(input.id))){uncertain=true;throw reservationError('DINING_RECOVERY')}
   const planned=planReservation(input,{...data,now:Date.parse(time)},actor)
   if(dine&&(before.restaurantOrders.some(row=>row.id===input.order.id)||before.restaurantOperations.some(row=>row.id===input.order.id)))throw reservationError('HISTORY')
   const cost=stockStore.read()
   if(needsLotExpiry(cost.projection,time)){const expiry=api.applySystemLotExpiry();reject(expiry)}
   let entry
   if(dine){const child=restaurant(input.order,actor);reject(child);entry=child.entry}else entry=before.restaurantOrders.find(row=>row.id===input.orderId)
   if(!entry)throw reservationError('HISTORY')
   const booking=data.state.bookings.find(row=>row.id===input.bookingId),request=booking?.depositTerms?reservationDepositFundingRequest(input,data.state,entry,{costMode:data.costMode}):null
   const save=funding=>{const parent=commit(input,actor,scope,{costMode:data.costMode,timestamp:time});reject(parent);return completed(parent,funding)}
   if(!request)return save(null)
   const who=reservationActor(actor,data.users),event=planRestaurantFundsEvent(entry.funds,request,{entryId:entry.id,version:entry.version+1,date:salesDate(new Date(time)),prepared:!!entry.startedAt,actor:who}).event
   return withReservationDepositTransition({request,actor:who,plannedEvent:event,parentReceipt:planned.receipt},()=>{const funding=restaurant(request,actor);reject(funding);return save(funding)})
  })).immediate())}catch(error){return {success:false,committed:!checked||existing||uncertain||error.historyUncertain?null:false,error:error.message,errorCode:error.code||'RESERVATION_DINING_WRITE'}}
 }
 function existingChild(input,actor){
  const scope=api.getPrivateDraftContext(actor),history=readReservationBook(book(),known(scope)),parent=history.recorded.find(row=>row.id===input.reservationDining?.parentId)
  if(!parent||parent.event.input.action!=='dine'||canonicalSignature(parent.event.input.order)!==canonicalSignature(input)||history.diningMissing.length)throw reservationError('DINING_RECOVERY')
  const result=restaurant(input,actor);reject(result);return result
 }
 return {apply,existingChild}
}
