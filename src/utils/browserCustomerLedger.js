import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {readBrowserTrading} from './browserSalesDocuments'
import {planCustomerLedger,customerLedgerReceipt} from '../../electron/customerLedger.mjs'

export function commitBrowserCustomerLedger(request,actor){
  if(actor?.role!=='owner')throw Error('權限不足')
  return withSalesLock(()=>{
    let checked=false,replay=false
    try{
      const record=readRecords(),data=readBrowserTrading(record),old=data.customerOperations.find(row=>row.id===request?.id);checked=true;replay=!!old
      assertOriginalOperationAvailable('applyCustomerLedgerOperation',request.id,record,request)
      if(old)return customerLedgerReceipt(request,old,data)
      const plan=planCustomerLedger(request,data,actor)
      const next=writeRecords({pos_customer_entries:[...data.customerEntries,plan.event],pos_customer_operations:[...data.customerOperations,plan.receipt],pos2_cash_log:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]},record.revision,{ensureSalesEpoch:true})
      return customerLedgerReceipt(request,plan.receipt,readBrowserTrading(next))
    }catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  })
}
