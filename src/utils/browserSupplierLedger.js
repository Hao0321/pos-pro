import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {salesDate} from '../../electron/salesRules.mjs'
import {planSupplierLedger,supplierLedgerReceipt,validateSupplierLedgerRecords} from '../../electron/supplierLedger.mjs'
import {procurementCreationRequests} from '../../electron/procurementHistory.mjs'

export function readBrowserSupplier(record){
 const rows=record.data,data={storeId:readExchangeTextSetting(rows.pos_business_settings,'sharedStoreId'),epoch:record.salesEpoch,
  products:rows.pos2_products,purchases:rows.pos_purchases,suppliers:rows.pos_suppliers,supplierEntries:rows.pos_supplier_entries,supplierOperations:rows.pos_supplier_operations,
  inventoryAudits:rows.pos_audit_log,cashLogs:rows.pos2_cash_log,openShift:rows.pos2_shifts.find(row=>row.status==='open')||null,ownerIds:rows.pos_users.filter(row=>row.role==='owner').map(row=>row.id),supplierFence:record.supplierFence}
 data.supplierLedger=validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)
 return data
}
export function getBrowserSupplierState(actor){
 if(actor?.role!=='owner')throw Error('權限不足')
 return withSalesLock(()=>{
  let record=readRecords(),storeId=readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId')
  if(!storeId||!record.salesEpoch)record=writeRecords(!storeId?{pos_business_settings:[...record.data.pos_business_settings,{key:'sharedStoreId',value:JSON.stringify(crypto.randomUUID())}]}:{},record.revision,{ensureSalesEpoch:true})
  const data=readBrowserSupplier(record)
  return {version:1,storeId:data.storeId,epoch:data.epoch,today:salesDate(new Date()),suppliers:data.suppliers,purchases:data.purchases,supplierLedger:data.supplierLedger,ownerCount:data.ownerIds.length,legacyReadOnly:!!data.supplierFence,creationRequests:procurementCreationRequests(data.inventoryAudits,data.purchases)}
 })
}
export function commitBrowserSupplierLedger(request,actor){
 if(actor?.role!=='owner')throw Error('權限不足')
 return withSalesLock(()=>{
  let checked=false,replay=false
  try{
   const record=readRecords(),data=readBrowserSupplier(record),old=data.supplierOperations.find(row=>row.id===request?.id);checked=true;replay=!!old
   assertOriginalOperationAvailable('applySupplierLedgerOperation',request.id,record,request)
   if(old)return supplierLedgerReceipt(request,old,data)
   const plan=planSupplierLedger(request,data,actor)
   const next=writeRecords({pos_supplier_entries:[...data.supplierEntries,plan.event],pos_supplier_operations:[...data.supplierOperations,plan.receipt],pos2_cash_log:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]},record.revision,{ensureSalesEpoch:true})
   return supplierLedgerReceipt(request,plan.receipt,readBrowserSupplier(next))
  }catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||checked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
 })
}
