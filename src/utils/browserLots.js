import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {lotActor,lotSavedResult,needsLotExpiry,makeLotExpiryInput,assertLotResult} from '../../electron/browserLots.mjs'
import {LOT_METHOD,lotCommand,lotError} from '../../electron/lotRules.mjs'
import {makeLotState} from '../../electron/lotState.mjs'
const context=(record,book)=>({storeId:readExchangeTextSetting(book.settings,'sharedStoreId'),epoch:record.salesEpoch||'',now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})
// Caller holds the existing single business lock. One record stores the entire
// automatic event, product quantities, version fence and source-cost receipt.
export function expireBrowserLotsLocked(record=readRecords()){
 const book=browserToBook(record.data),state=validateStockCostBook(book),scope=context(record,book)
 if(!needsLotExpiry(state.projection,scope.now))return record
 return writeRecords({},record.revision,{lots:{request:makeLotExpiryInput(state,scope),timestamp:scope.now,system:true}})
}
export function getBrowserLotState(actor){return withSalesLock(()=>{const old=readRecords(),who=lotActor(browserToBook(old.data),actor),record=expireBrowserLotsLocked(old),book=browserToBook(record.data);return makeLotState(validateStockCostBook(book),book.products,context(record,book),{showCosts:who.role==='owner',wasteLog:book.wasteLog})})}
export const hasBrowserLots=record=>record.data.pos_stock_cost_entries.some(row=>row.method===LOT_METHOD)
export function prepareBrowserLotRead(actor,ownerOnly=false){const before=readRecords();if(!hasBrowserLots(before))return Promise.resolve(before);return withSalesLock(()=>{const record=readRecords(),who=lotActor(browserToBook(record.data),actor);if(ownerOnly&&who.role!=='owner')throw Error('權限不足');return expireBrowserLotsLocked(record)})}
export function assertStoredBrowserLot(request,result){const state=validateStockCostBook(browserToBook(readRecords().data)),saved=state.operations.find(row=>row.method===LOT_METHOD&&row.operationId===request.id);if(!saved||saved.signature!==canonicalSignature(request)||canonicalSignature(saved.receipt)!==canonicalSignature(result.receipt))throw lotError('HISTORY')}
export function commitBrowserLot(raw,actor){return withSalesLock(()=>{
 let checked=false,existing=false,writing=false,beforeRaw,input
 try{
  let record=readRecords();const book=browserToBook(record.data);input=lotCommand(raw);lotActor(book,actor,input.action);checked=true
  assertOriginalOperationAvailable(LOT_METHOD,input.id,record,input)
  const saved=lotSavedResult(book,input,actor);existing=!!saved;if(saved)return assertLotResult(input,saved)
  record=expireBrowserLotsLocked(record);beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
  const next=writeRecords({},record.revision,{lots:{request:input,actor,timestamp:new Date().toISOString()}})
  return assertLotResult(input,lotSavedResult(browserToBook(next.data),input,actor))
 }catch(error){
  if(writing)try{if(localStorage.getItem(RECORD_KEY)!==beforeRaw)return assertLotResult(input,lotSavedResult(browserToBook(readRecords().data),input,actor))}catch{return {success:false,committed:null,error:error.message}}
  return {success:false,committed:!checked||existing||error.historyUncertain?null:false,error:error.message,errorCode:error.historyUncertain?'RECOVERY_REQUIRED':error.code||null}
 }
})}
