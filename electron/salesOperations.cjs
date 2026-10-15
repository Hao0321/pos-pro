const {planSales,salesReceipt,validateSalesRecords}=require('./salesPlan.mjs')
const {salesDate}=require('./salesRules.mjs')
module.exports=function(db,stmts){
  const read=require('./tradingState.cjs')(db,stmts)
  return {
    getSalesState(actor){
      if(actor?.role!=='owner')throw Error('權限不足')
      const data=read()
      return {storeId:data.storeId,epoch:data.epoch,today:salesDate(new Date()),customerLedger:data.customerLedger,documents:data.documents.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id))}
    },
    applySalesOperation(request,actor){
      if(actor?.role!=='owner')throw Error('權限不足')
      let replay=false,checked=false
      try{return db.transaction(()=>{
        const data=read(),old=data.operations.find(row=>row.id===request?.id);replay=!!old;checked=true
        if(old)return salesReceipt(request,old,data)
        const plan=planSales(request,data,actor)
        for(const product of plan.products)stmts.updateProductStock.run({id:product.id,delta:product.stock-data.products.find(p=>p.id===product.id).stock})
        db.prepare('INSERT INTO sales_documents (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(plan.document.id,JSON.stringify(plan.document))
        if(plan.cashLog)stmts.insertCashLog.run(plan.cashLog)
        db.prepare('INSERT INTO sales_operations (id,data) VALUES (?,?)').run(request.id,JSON.stringify(plan.receipt))
        const next={...data,documents:[plan.document,...data.documents.filter(d=>d.id!==plan.document.id)],operations:[...data.operations,plan.receipt],products:data.products.map(p=>plan.products.find(n=>n.id===p.id)||p),cashLogs:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]}
        validateSalesRecords(next.documents,next.operations,next.cashLogs,next.storeId,next.products,next.quotes)
        require('./customerLedger.mjs').validateCustomerLedgerRecords(next.customerEntries,next.customerOperations,{...next,salesOperations:next.operations})
        return salesReceipt(request,plan.receipt,next)
      })()}catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,error:error.message}}
    },
  }
}
