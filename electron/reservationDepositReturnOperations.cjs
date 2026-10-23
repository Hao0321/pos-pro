const {reservationData,reservationView}=require('./reservationCommit.mjs')
const {assertReservationResult}=require('./reservationHistory.mjs')
const {prepareReservationDepositReturn,verifyReservationDepositReturnPlan}=require('./reservationDepositReturnPlan.mjs')
const {withReservationDepositTransition}=require('./reservationDepositTransition.mjs')
const {reservationDepositReturnId}=require('./reservationDepositAllocation.mjs')
const {withReservationDepositReturnResult,assertReservationDepositReturnRootResult}=require('./reservationDepositReturnResult.mjs')
const {canonicalSignature}=require('./operationRules.mjs')
const {reservationError,RESERVATION_METHOD}=require('./reservationConfig.mjs')

module.exports=function(db,api,stockStore,kitchen,{book,known,commit,restaurant}){
 const reject=result=>{if(result?.success!==true)throw Object.assign(Error(result?.error||'退款原單尚未確認'),{historyUncertain:result?.committed!==false})}
 function apply(value,actor,{restaurantInput=false}={}){
  let checked=false,existing=false,uncertain=false
  try{return kitchen.deferWake(()=>db.transaction(()=>stockStore.scope(()=>{
   const scope=api.getPrivateDraftContext(actor),before=book(),retained=known(scope),time=new Date().toISOString(),{history,data}=reservationData(before,scope,Date.parse(time),retained,{costMode:stockStore.active()?'active':'reference'})
   const id=restaurantInput?reservationDepositReturnId(scope.storeId,value.id):value.id,old=history.byId.get(id)
   checked=true;existing=!!old
   let input=restaurantInput?old?.event.input:value,planned=null
   if(restaurantInput&&old&&canonicalSignature(input.restaurantOperation)!==canonicalSignature(value))throw Object.assign(reservationError('HISTORY'),{operationConflict:true})
   if(history.state.needsRecovery){uncertain=true;throw reservationError('DINING_RECOVERY')}
   if(!old){
    if(db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(RESERVATION_METHOD,id)||db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get('applyRestaurantOperation',restaurantInput?value.id:input.restaurantOperation.id)){uncertain=true;throw reservationError('DINING_RECOVERY')}
    const entry=before.restaurantOrders.find(row=>row.id===(restaurantInput?value.entryId:input.orderId))
    planned=restaurantInput?prepareReservationDepositReturn(value,data,entry,actor):verifyReservationDepositReturnPlan(input,data,entry,actor)
    if(!planned)return restaurant(value,actor)
    input=planned.input
    withReservationDepositTransition({request:input.restaurantOperation,actor:planned.actor,plannedEvent:planned.plannedEvent,parentReceipt:planned.parent.receipt},()=>{
     reject(restaurant(input.restaurantOperation,actor))
     reject(commit(input,actor,scope,{costMode:data.costMode,timestamp:time}))
     for(const refund of planned.refundInputs)reject(commit(refund,actor,scope,{costMode:data.costMode,timestamp:time}))
    })
   }
   const parent=commit(input,actor,scope,{costMode:data.costMode});reject(parent)
   const child=restaurant(input.restaurantOperation,actor);reject(child)
   const result={...parent,restaurantReturn:child,state:reservationView(book(),scope,Date.parse(time),retained)}
   require('./stockBackup.mjs').validateStockCostBook(api.exportData())
   assertReservationDepositReturnRootResult(input,assertReservationResult(input,result))
   return restaurantInput?withReservationDepositReturnResult(child,result):result
  })).immediate())}catch(error){return {success:false,committed:!checked||existing||uncertain||error.historyUncertain?null:false,error:error.message,errorCode:error.code||'RESERVATION_DEPOSIT_RETURN_WRITE'}}
 }
 return {applyRoot:(input,actor)=>apply(input,actor),applyRestaurant:(input,actor)=>apply(input,actor,{restaurantInput:true})}
}
