import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable,RECORD_KEY} from './browserStorage'
import {INVENTORY_PREFIX,INVENTORY_ACTION} from '../../electron/inventoryOperations.mjs'
import {planSupplierInventory,supplierInventoryReceipt} from '../../electron/supplierInventory.mjs'
import {readBrowserSupplier} from './browserSupplierLedger'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {PHYSICAL_STOCKTAKE,physicalStocktakeState,assertPhysicalStocktakeResult} from '../../electron/physicalStocktake.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {hasBrowserStockCost,commitBrowserStockBusiness} from './browserStockBusiness'
const countData=record=>({storeId:readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),epoch:record.salesEpoch,costMode:record.data.pos_stock_cost_entries.length?'active':'reference',restaurantEntries:record.data.pos_restaurant_orders})
const verify=(actor,record)=>{if(!actor||!['owner','staff'].includes(actor.role)||!record.data.pos_users.some(row=>row.id===actor.userId&&row.username===actor.username&&row.role===actor.role))throw Error('權限不足')}
export function getBrowserStocktakeState(actor){return withSalesLock(()=>{let record=readRecords();verify(actor,record);const storeId=countData(record).storeId;if(!storeId||!record.salesEpoch)record=writeRecords(!storeId?{pos_business_settings:[...record.data.pos_business_settings,{key:'sharedStoreId',value:JSON.stringify(crypto.randomUUID())}]}:{},record.revision,{ensureSalesEpoch:true});return physicalStocktakeState({products:record.data.pos2_products,...countData(record)})})}
function physicalResult(request,result,record,actor){
 if(request.protocol!==PHYSICAL_STOCKTAKE)return result
 if(request.context.costMode==='active'){
  const state=validateStockCostBook(browserToBook(record.data)),original=state.operations.find(row=>row.id===canonicalSignature(['applyInventoryOperation',request.id]))
  if(!original||original.signature!==canonicalSignature(request)||original.actorId!==actor.userId&&actor.role!=='owner')throw Error('盤點成本回覆尚未確認，請保留原編號核對')
  result={...result,costReceipt:structuredClone(original.receipt)}
 }
 return assertPhysicalStocktakeResult(request,result)
}
export function commitBrowserInventory(request,actor){
  if(!actor||!['owner','staff'].includes(actor.role)||request.kind!=='stocktake'&&actor.role!=='owner')throw Error('權限不足')
  return withSalesLock(()=>{
    let replay=false,historyChecked=false,writing=false,beforeRaw=null
    try{
      const saved=readRecords(),r=saved.data,key=INVENTORY_PREFIX+request.id
      if(request.protocol!==PHYSICAL_STOCKTAKE&&hasBrowserStockCost(saved))return commitBrowserStockBusiness('applyInventoryOperation',request,actor,saved)
      if(request.protocol===PHYSICAL_STOCKTAKE)verify(actor,saved)
      assertOriginalOperationAvailable('applyInventoryOperation',request.id,saved,request)
      const base=request.supplierContext||saved.supplierFence?readBrowserSupplier(saved):{products:r.pos2_products,purchases:r.pos_purchases,suppliers:r.pos_suppliers,openShift:r.pos2_shifts.find(s=>s.status==='open'),cashLogs:r.pos2_cash_log,storeId:readExchangeTextSetting(r.pos_business_settings,'sharedStoreId')},data=request.kind==='stocktake'?{...base,...countData(saved)}:base
      const old=r.pos_audit_log.find(l=>l.id===key)
      replay=!!old;historyChecked=true
      if(old){if(old.action!==INVENTORY_ACTION)throw Error('庫存回執需要核對');if(request.protocol===PHYSICAL_STOCKTAKE&&old.userId!==actor.userId&&actor.role!=='owner')throw Error('權限不足');return physicalResult(request,supplierInventoryReceipt(request,typeof old.detail==='string'?JSON.parse(old.detail):old.detail,data),saved,actor)}
      const plan=planSupplierInventory(request,data,actor)
      const products=[...r.pos2_products.map(p=>plan.products.find(n=>n.id===p.id)||p),...plan.products.filter(p=>plan.created.includes(p.id))]
      const purchases=plan.createPurchase?[plan.purchase,...r.pos_purchases]:r.pos_purchases.map(p=>p.id===plan.purchase?.id?plan.purchase:p),suppliers=r.pos_suppliers.map(s=>s.id===plan.supplier?.id?plan.supplier:s),cashLogs=plan.cashLog?[plan.cashLog,...r.pos2_cash_log]:r.pos2_cash_log
      const registration=plan.supplierRegistration
      beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
      const next=writeRecords({pos2_products:products,pos_purchases:purchases,pos_suppliers:suppliers,pos2_cash_log:cashLogs,pos_audit_log:[{id:key,action:INVENTORY_ACTION,detail:plan.receipt,timestamp:new Date().toISOString(),userId:actor.userId||'',username:actor.username||'',role:actor.role},...r.pos_audit_log],...(registration?{pos_supplier_entries:[...data.supplierEntries,registration.event],pos_supplier_operations:[...data.supplierOperations,registration.receipt]}:{})},saved.revision,request.protocol===PHYSICAL_STOCKTAKE?{physicalStocktake:{request,actor}}:{})
      return physicalResult(request,supplierInventoryReceipt(request,plan.receipt,request.supplierContext||next.supplierFence?readBrowserSupplier(next):{products,purchases,suppliers,cashLogs}),next,actor)
    }catch(error){
      if(writing&&request.protocol===PHYSICAL_STOCKTAKE)try{if(localStorage.getItem(RECORD_KEY)!==beforeRaw){const record=readRecords(),data=record.data,old=data.pos_audit_log.find(row=>row.id===INVENTORY_PREFIX+request.id);if(old)return physicalResult(request,supplierInventoryReceipt(request,typeof old.detail==='string'?JSON.parse(old.detail):old.detail,{products:data.pos2_products,purchases:data.pos_purchases,suppliers:data.pos_suppliers,cashLogs:data.pos2_cash_log}),record,actor);return {success:false,committed:null,error:error.message}}}catch{return {success:false,committed:null,error:error.message}}
      return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||historyChecked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}
    }
  })
}
