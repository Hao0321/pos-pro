const {planCustomerLedger,customerLedgerReceipt,validateCustomerLedgerRecords}=require('./customerLedger.mjs')
module.exports=function(db,stmts){
  const read=require('./tradingState.cjs')(db,stmts)
  return {applyCustomerLedgerOperation(request,actor){
    if(actor?.role!=='owner')throw Error('權限不足')
    let checked=false,replay=false
    try{return db.transaction(()=>{
      const data=read(),old=data.customerOperations.find(row=>row.id===request?.id);checked=true;replay=!!old
      if(old)return customerLedgerReceipt(request,old,data)
      const plan=planCustomerLedger(request,data,actor)
      require('./databaseFeatureFence.cjs').installCustomerFence(db)
      db.prepare('INSERT INTO customer_entries (id,data) VALUES (?,?)').run(plan.event.id,JSON.stringify(plan.event))
      if(plan.cashLog)stmts.insertCashLog.run(plan.cashLog)
      db.prepare('INSERT INTO customer_operations (id,data) VALUES (?,?)').run(plan.receipt.id,JSON.stringify(plan.receipt))
      const next={...data,customerEntries:[...data.customerEntries,plan.event],customerOperations:[...data.customerOperations,plan.receipt],cashLogs:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]}
      validateCustomerLedgerRecords(next.customerEntries,next.customerOperations,next)
      return customerLedgerReceipt(request,plan.receipt,next)
    })()}catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  }}
}
