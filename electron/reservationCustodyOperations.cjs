const {RESERVATION_CUSTODY_METHODS,reservationRequiresCompleteRecovery,assertReservationBusinessChange}=require('./reservationCustody.mjs')
const {operationRecords}=require('./recoveryRules.mjs')
const {reservationError,RESERVATION_METHOD}=require('./reservationConfig.mjs')
const typed=new Set(['checkout','refundOrder','applyInventoryOperation','applyRestaurantOperation','applySalesOperation','applyOpeningMigration','addWaste','addTopup','addCashLog','applyCustomerLedgerOperation','applySupplierLedgerOperation','applyWarehouseOperation','applyLotOperation','applyStockCostOperation'])
module.exports=function(db,api,{book,known}){
 const hasKnown=()=>!!db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? LIMIT 1').get(RESERVATION_METHOD)
 for(const method of RESERVATION_CUSTODY_METHODS){
  const original=api[method];if(typeof original!=='function')throw Error('缺少正式資料保護入口：'+method)
  api[method]=function(...args){
   if(!hasKnown())return original.apply(this,args)
   let checked=false,retained=false;const request=method==='refundOrder'?args[1]:args[0],id=typeof request==='string'?request:request?.id
   let allowed=false
   try{db.transaction(()=>{
    const before=book(),retainedHistory=known({storeId:api.getSetting('sharedStoreId')})
    if(!reservationRequiresCompleteRecovery(before,retainedHistory)){allowed=true;return}
    checked=true;retained=!!db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(method,id||'')
    const full=api.exportData()
    if(['addMember','updateMember','deleteMember'].includes(method)){
     const patch=Object.fromEntries(Object.entries(method==='updateMember'?args[1]||{}:request||{}).filter(([,value])=>value!=null)),members=method==='addMember'?[...full.members,{points:0,balance:0,totalSpent:0,tier:'normal',...patch}]:method==='deleteMember'?full.members.filter(row=>row.id!==id):full.members.map(row=>row.id===id?{...row,...patch}:row),after={...full,members}
     require('./reservationCommit.mjs').assertReservationMemberRemoval(full,after,retainedHistory);assertReservationBusinessChange(full,after,retainedHistory);allowed=true;return
    }
    const active=operationRecords(full).find(row=>row.method===method&&row.id===id)
    if(active&&(method!=='checkout'||['completed','refunded'].includes(active.receipt.status))){allowed=true;return}
    throw reservationError('DINING_RECOVERY')
   }).immediate()}catch(error){if(!typed.has(method))throw error;return {success:false,committed:!checked||retained?null:false,error:error.message,errorCode:error.code||'RESERVATION_CUSTODY',...(['checkout','refundOrder'].includes(method)?{protocol:'pos-checkout-v5',orderId:id}:{} )}}
   // The shared native authority executes these synchronous calls in one event
   // loop. Preserve the existing command's own transaction, automatic expiry
   // and postcommit printer wake; no business mutation occurs in the gate.
   if(allowed)return original.apply(this,args)
  }
 }
}
