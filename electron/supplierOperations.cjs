const {planSupplierLedger,supplierLedgerReceipt,validateSupplierLedgerRecords}=require('./supplierLedger.mjs')
const {salesDate}=require('./salesRules.mjs')
module.exports=function(db,stmts){
 const read=require('./supplierState.cjs')(db,stmts)
 return {
  getSupplierState(actor){
   if(actor?.role!=='owner')throw Error('權限不足')
   return db.transaction(()=>{const data=read({ensureIdentity:true});return {version:1,storeId:data.storeId,epoch:data.epoch,today:salesDate(new Date()),suppliers:data.suppliers,purchases:data.purchases,supplierLedger:data.supplierLedger,ownerCount:data.ownerIds.length,legacyReadOnly:data.supplierFence,creationRequests:require('./procurementHistory.mjs').procurementCreationRequests(data.inventoryAudits,data.purchases)}})()
  },
  applySupplierLedgerOperation(request,actor){
   if(actor?.role!=='owner')throw Error('權限不足')
   let checked=false,replay=false
   try{return db.transaction(()=>{
    const data=read(),old=data.supplierOperations.find(row=>row.id===request?.id);checked=true;replay=!!old
    if(old)return supplierLedgerReceipt(request,old,data)
    const plan=planSupplierLedger(request,data,actor)
    require('./databaseFeatureFence.cjs').installSupplierFence(db)
    db.prepare('INSERT INTO supplier_entries (id,data) VALUES (?,?)').run(plan.event.id,JSON.stringify(plan.event))
    if(plan.cashLog)stmts.insertCashLog.run(plan.cashLog)
    db.prepare('INSERT INTO supplier_operations (id,data) VALUES (?,?)').run(plan.receipt.id,JSON.stringify(plan.receipt))
    const next={...data,supplierEntries:[...data.supplierEntries,plan.event],supplierOperations:[...data.supplierOperations,plan.receipt],cashLogs:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]}
    validateSupplierLedgerRecords(next.supplierEntries,next.supplierOperations,next)
    return supplierLedgerReceipt(request,plan.receipt,next)
   })()}catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  },
 }
}
