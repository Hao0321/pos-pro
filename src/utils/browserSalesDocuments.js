import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {readExchangeTextSetting,readExchangeStore,EXCHANGE_SETTING} from '../../electron/businessExchange.mjs'
import {salesDate} from '../../electron/salesRules.mjs'
import {planSales,salesReceipt,validateSalesRecords} from '../../electron/salesPlan.mjs'
import {validateCustomerLedgerRecords} from '../../electron/customerLedger.mjs'

export function readBrowserTrading(record){
  const rows=record.data,data={storeId:readExchangeTextSetting(rows.pos_business_settings,'sharedStoreId'),epoch:record.salesEpoch,
    products:rows.pos2_products,documents:rows.pos_sales_documents,operations:rows.pos_sales_operations,cashLogs:rows.pos2_cash_log,customerEntries:rows.pos_customer_entries,customerOperations:rows.pos_customer_operations,
    openShift:rows.pos2_shifts.find(s=>s.status==='open')||null,quotes:readExchangeStore(readExchangeTextSetting(rows.pos_business_settings,EXCHANGE_SETTING)).quotes}
  validateSalesRecords(data.documents,data.operations,data.cashLogs,data.storeId,data.products,data.quotes)
  data.salesOperations=data.operations
  data.customerLedger=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data)
  return data
}
const read=readBrowserTrading
export function getBrowserSalesState(actor){
  if(actor?.role!=='owner')throw Error('權限不足')
  return withSalesLock(()=>{
    let record=readRecords(),storeId=readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId')
    if(!storeId||!record.salesEpoch){
      const settings=record.data.pos_business_settings
      record=writeRecords(!storeId?{pos_business_settings:[...settings,{key:'sharedStoreId',value:JSON.stringify(crypto.randomUUID())}]}:{},record.revision,{ensureSalesEpoch:true})
    }
    const data=read(record)
    return {storeId:data.storeId,epoch:data.epoch,today:salesDate(new Date()),customerLedger:data.customerLedger,documents:[...data.documents].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id))}
  })
}
export function commitBrowserSalesDocument(request,actor){
  if(actor?.role!=='owner')throw Error('權限不足')
  return withSalesLock(()=>{
    let replay=false,checked=false
    try{
      const record=readRecords(),data=read(record),old=data.operations.find(row=>row.id===request?.id);replay=!!old;checked=true
      assertOriginalOperationAvailable('applySalesOperation',request.id,record,request)
      if(old)return salesReceipt(request,old,data)
      const plan=planSales(request,data,actor)
      const next=writeRecords({pos_sales_documents:[plan.document,...data.documents.filter(d=>d.id!==plan.document.id)],
        pos_sales_operations:[...data.operations,plan.receipt],pos2_products:data.products.map(p=>plan.products.find(n=>n.id===p.id)||p),
        pos2_cash_log:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]},record.revision,{ensureSalesEpoch:true})
      return salesReceipt(request,plan.receipt,read(next))
    }catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  })
}
