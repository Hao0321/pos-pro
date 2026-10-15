const {randomUUID}=require('node:crypto')
const {planSales,salesReceipt,validateSalesRecords}=require('./salesPlan.mjs')
const {readExchangeStore,EXCHANGE_SETTING}=require('./businessExchange.mjs')
const {salesDate}=require('./salesRules.mjs')
module.exports=function(db,stmts){
  function identity(){
    let storeId=stmts.getSetting.get('sharedStoreId')?.value
    if(!storeId){storeId=randomUUID();stmts.setSetting.run('sharedStoreId',storeId)}
    return storeId
  }
  const readTable=table=>db.prepare('SELECT data FROM '+table+' ORDER BY id').all().map(row=>JSON.parse(row.data))
  function read(){
    const data={storeId:identity(),epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch').value,
      products:stmts.getAllProducts.all().map(p=>({...p,noBarcode:!!p.noBarcode})),documents:readTable('sales_documents'),operations:readTable('sales_operations'),
      cashLogs:db.prepare('SELECT * FROM cash_log').all(),openShift:stmts.getOpenShift.get(),quotes:readExchangeStore(stmts.getSetting.get(EXCHANGE_SETTING)?.value).quotes}
    validateSalesRecords(data.documents,data.operations,data.cashLogs,data.storeId,data.products,data.quotes)
    return data
  }
  return {
    getSalesState(actor){
      if(actor?.role!=='owner')throw Error('權限不足')
      const data=read()
      return {storeId:data.storeId,epoch:data.epoch,today:salesDate(new Date()),documents:data.documents.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id))}
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
        return salesReceipt(request,plan.receipt,next)
      })()}catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,error:error.message}}
    },
  }
}
