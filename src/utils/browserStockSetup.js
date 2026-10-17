import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {stockSetupOwner,prepareBrowserStockOpening} from '../../electron/browserStockSetup.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {stockCostCommand} from '../../electron/stockOpeningPlan.mjs'
import {makeStockSetupState,previewStockSetup} from '../../electron/stockSetup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {assertStockSetupResult} from '../../electron/stockSetupReview.mjs'
import {stockSetupBrowserEnabled} from './stockSetupAvailability.mjs'
import {readBrowserTrading} from './browserSalesDocuments'
import {readBrowserSupplier} from './browserSupplierLedger'

export function browserStockSetupData(record,actor){
  const book=browserToBook(record.data);stockSetupOwner(book,actor)
  readBrowserTrading(record);readBrowserSupplier(record)
  const state=validateStockCostBook(book),opening=state.projection?null:prepareBrowserStockOpening(book,record.salesEpoch)
  return {state,preview:opening?.preview,products:book.products,storeId:readExchangeTextSetting(book.settings,'sharedStoreId'),epoch:record.salesEpoch}
}
export function getBrowserStockSetupState(actor){return withSalesLock(()=>{
  if(!stockSetupBrowserEnabled())throw Error('成本設定尚未開放新保存，請保留原編號核對')
  let record=readRecords();stockSetupOwner(browserToBook(record.data),actor)
  const storeId=readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId')
  if(!storeId||!record.salesEpoch)record=writeRecords(!storeId?{pos_business_settings:[...record.data.pos_business_settings,{key:'sharedStoreId',value:JSON.stringify(crypto.randomUUID())}]}:{},record.revision,{ensureSalesEpoch:true})
  return makeStockSetupState(browserStockSetupData(record,actor))
})}
export function previewBrowserStockSetup(input,actor){return withSalesLock(()=>{
  if(!stockSetupBrowserEnabled())throw Error('成本設定尚未開放新保存，請保留原編號核對')
  return previewStockSetup(input,browserStockSetupData(readRecords(),actor))
})}
export function browserStockSetupResult(input,record,actor){
  const book=browserToBook(record.data);stockSetupOwner(book,actor);const state=validateStockCostBook(book),saved=state.operations.find(row=>row.id===canonicalSignature(['applyStockCostOperation',input.id]))
  if(!saved||saved.signature!==canonicalSignature(input))throw Error('庫存成本回覆尚未確認，請保留原編號核對')
  return assertStockSetupResult(input,{success:true,command:structuredClone(input),receipt:structuredClone(saved.receipt)})
}
export function assertStoredBrowserStockSetupResult(input,result){
  const state=validateStockCostBook(browserToBook(readRecords().data)),saved=state.operations.find(row=>row.id===canonicalSignature(['applyStockCostOperation',input.id]))
  if(!saved||saved.signature!==canonicalSignature(input)||canonicalSignature(saved.receipt)!==canonicalSignature(result?.receipt))throw Error('庫存成本回覆尚未確認，請保留原編號核對')
}
export function commitBrowserStockSetup(raw,actor){return withSalesLock(()=>{
  let checked=false,existing=false,writing=false,beforeRaw=null,input
  try{
    const record=readRecords(),book=browserToBook(record.data);stockSetupOwner(book,actor);input=stockCostCommand(raw)
    if(!input.review)throw Error('請先看成本結果，再確認保存')
    assertOriginalOperationAvailable('applyStockCostOperation',input.id,record,input)
    existing=book.stockCostOperations.some(row=>row.id===canonicalSignature(['applyStockCostOperation',input.id]));checked=true
    if(existing)return browserStockSetupResult(input,record,actor)
    if(!stockSetupBrowserEnabled())return {success:false,committed:null,errorCode:'RECOVERY_REQUIRED',error:'成本設定尚未開放新保存，請保留原編號核對'}
    beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
    const next=writeRecords({},record.revision,{stockSetup:{request:input,actor,timestamp:new Date().toISOString()}})
    return browserStockSetupResult(input,next,actor)
  }catch(error){
    if(writing)try{if(localStorage.getItem(RECORD_KEY)!==beforeRaw)return browserStockSetupResult(input,readRecords(),actor)}catch{return {success:false,committed:null,error:error.message}}
    return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{})}
  }
})}
