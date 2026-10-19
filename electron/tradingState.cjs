const {randomUUID}=require('node:crypto')
const {validateSalesRecords}=require('./salesPlan.mjs')
const {validateCustomerLedgerRecords}=require('./customerLedger.mjs')
const {readExchangeStore,EXCHANGE_SETTING}=require('./businessExchange.mjs')
module.exports=function(db,stmts){
  const openingContext=require('./openingCutoverState.cjs')(db)
  const rows=table=>db.prepare('SELECT data FROM '+table+' ORDER BY id').all().map(row=>JSON.parse(row.data))
  return function read(){
    let storeId=stmts.getSetting.get('sharedStoreId')?.value
    if(!storeId){storeId=randomUUID();stmts.setSetting.run('sharedStoreId',storeId)}
    const data={storeId,epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch').value,
      products:stmts.getAllProducts.all().map(p=>({...p,noBarcode:!!p.noBarcode})),documents:rows('sales_documents'),operations:rows('sales_operations'),
      customerEntries:rows('customer_entries').sort((a,b)=>a.revision-b.revision),customerOperations:rows('customer_operations'),
      cashLogs:db.prepare('SELECT * FROM cash_log').all(),openShift:stmts.getOpenShift.get(),quotes:readExchangeStore(stmts.getSetting.get(EXCHANGE_SETTING)?.value).quotes}
    data.salesOperations=data.operations
    data.openingBalanceContext=openingContext()
    validateSalesRecords(data.documents,data.operations,data.cashLogs,data.storeId,data.products,data.quotes)
    data.customerLedger=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data)
    return data
  }
}
