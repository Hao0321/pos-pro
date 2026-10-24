import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {warehouseState} from '../../electron/warehousePlan.mjs'
import {WAREHOUSE_METHOD,warehouseCommand,warehouseError} from '../../electron/warehouseRules.mjs'
import {warehouseActor,warehouseSavedResult,assertWarehouseResult} from '../../electron/browserWarehouse.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {expireBrowserLotsLocked} from './browserLots'
export function getBrowserWarehouseState(actor){return withSalesLock(()=>{const old=readRecords(),who=warehouseActor(browserToBook(old.data),actor),record=expireBrowserLotsLocked(old),book=browserToBook(record.data);return warehouseState(validateStockCostBook(book),book.products,{storeId:readExchangeTextSetting(book.settings,'sharedStoreId'),epoch:record.salesEpoch||'',now:new Date().toISOString()},{showCosts:who.role==='owner'})})}
export function assertStoredBrowserWarehouse(request,result){
 const book=browserToBook(readRecords().data),state=validateStockCostBook(book),saved=state.operations.find(row=>row.method===WAREHOUSE_METHOD&&row.operationId===request.id)
 if(!saved||saved.signature!==canonicalSignature(request)||canonicalSignature(saved.receipt)!==canonicalSignature(result.receipt))throw warehouseError('HISTORY')
}
export function commitBrowserWarehouse(raw,actor){return withSalesLock(()=>{
 let checked=false,existing=false,writing=false,beforeRaw,input
 try{
  let record=readRecords();const book=browserToBook(record.data);warehouseActor(book,actor);input=warehouseCommand(raw);if(actor.role!=='owner'&&input.action!=='transfer')throw Error('權限不足')
  assertOriginalOperationAvailable(WAREHOUSE_METHOD,input.id,record,input)
  const saved=warehouseSavedResult(book,input,actor);existing=!!saved;checked=true
  if(saved)return assertWarehouseResult(input,saved)
  record=expireBrowserLotsLocked(record)
  beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
  const next=writeRecords({},record.revision,{warehouse:{request:input,actor,timestamp:new Date().toISOString()}})
  return assertWarehouseResult(input,warehouseSavedResult(browserToBook(next.data),input,actor))
 }catch(error){
  if(writing)try{if(localStorage.getItem(RECORD_KEY)!==beforeRaw)return assertWarehouseResult(input,warehouseSavedResult(browserToBook(readRecords().data),input,actor))}catch{return {success:false,committed:null,error:error.message}}
  return {success:false,committed:!checked||existing||error.historyUncertain?null:false,error:error.message,errorCode:error.historyUncertain?'RECOVERY_REQUIRED':error.code||null}
 }
})}
