const {planReservation}=require('./reservationModel.mjs')
const {reservationData}=require('./reservationCommit.mjs')
const {readReservationBook,assertReservationResult}=require('./reservationHistory.mjs')
const {assertReservationDiningResult}=require('./reservationDiningResult.mjs')
const {reservationError,RESERVATION_METHOD}=require('./reservationConfig.mjs')
const {needsLotExpiry}=require('./browserLots.mjs')
const {canonicalSignature}=require('./operationRules.mjs')

module.exports=function(db,api,stockStore,kitchenRuntime,{book,known,commit,restaurant}){
 const unavailable=(method,id)=>db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(method,id)
 const reject=result=>{if(result?.success!==true)throw Object.assign(Error(result?.error||'訂位餐點尚未確認，請保留原編號。'),{historyUncertain:result?.committed!==false})}
 function apply(input,actor){
  let checked=false,existing=false,uncertain=false
  try{return kitchenRuntime.deferWake(()=>db.transaction(()=>stockStore.scope(()=>{
   const scope=api.getPrivateDraftContext(actor),before=book(),retained=known(scope),{history,data}=reservationData(before,scope,Date.now(),retained,{costMode:stockStore.active()?'active':'reference'})
   checked=true;existing=history.byId.has(input?.id)
   const time=new Date(Date.now()).toISOString()
   if(existing){
    // A restored parent cannot recreate an already promised meal or its stock.
    const parent=commit(input,actor,scope,{costMode:data.costMode});reject(parent)
    if(!history.recorded.some(row=>row.id===input.id)||history.diningMissing.length||!before.restaurantOrders.some(row=>row.id===input.order.id)||!before.restaurantOperations.some(row=>row.id===input.order.id)){uncertain=true;throw reservationError('DINING_RECOVERY')}
    const child=restaurant(input.order,actor);reject(child)
    return assertReservationDiningResult(input,assertReservationResult(input,{...parent,dining:child}))
   }
   if(unavailable(RESERVATION_METHOD,input.id)||unavailable('applyRestaurantOperation',input?.order?.id)){uncertain=true;throw reservationError('DINING_RECOVERY')}
   planReservation(input,{...data,now:Date.parse(time)},actor)
   if(before.restaurantOrders.some(row=>row.id===input.order.id)||before.restaurantOperations.some(row=>row.id===input.order.id))throw reservationError('HISTORY')
   const cost=stockStore.read()
   if(needsLotExpiry(cost.projection,time)){const expiry=api.applySystemLotExpiry();reject(expiry)}
   const child=restaurant(input.order,actor);reject(child)
   const parent=commit(input,actor,scope,{costMode:data.costMode});reject(parent)
   return assertReservationDiningResult(input,assertReservationResult(input,{...parent,dining:child}))
  })).immediate())}catch(error){return {success:false,committed:!checked||existing||uncertain||error.historyUncertain?null:false,error:error.message,errorCode:error.code||'RESERVATION_DINING_WRITE'}}
 }
 function existingChild(input,actor){
  const scope=api.getPrivateDraftContext(actor),history=readReservationBook(book(),known(scope)),parent=history.recorded.find(row=>row.id===input.reservationDining?.parentId)
  if(!parent||parent.event.input.action!=='dine'||canonicalSignature(parent.event.input.order)!==canonicalSignature(input)||history.diningMissing.length)throw reservationError('DINING_RECOVERY')
  const result=restaurant(input,actor);reject(result);return result
 }
 return {apply,existingChild}
}
