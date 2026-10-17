import {canonicalSignature} from './operationRules.mjs'
import {businessInstant} from './businessExchange.mjs'
import {PROCUREMENT_KINDS} from './procurementRules.mjs'
import {planInventory,inventoryReceipt} from './inventoryOperations.mjs'
import {supplierInventoryContext} from './procurementHistory.mjs'
import {supplierActor,assertProcurementApproval} from './supplierControl.mjs'
import {validateSupplierLedgerRecords,planSupplierRegistration,supplierControlFromEntries,supplierLedgerEvidence,assertSupplierLedgerView} from './supplierLedger.mjs'
import {assertPrivateQuickPurchase} from './privateDrafts.mjs'

const procurement=request=>request.kind==='receive'||PROCUREMENT_KINDS.includes(request.kind)
function checkContext(request,data){
 const context=supplierInventoryContext(request),active=data.supplierFence||(data.supplierEntries||[]).length>0
 if(!context){if(active)throw Error('採購流程已升級，請保留草稿並重新核對供應商帳');return null}
 if(context.storeId!==data.storeId||context.epoch!==data.epoch)throw Object.assign(Error('採購屬於另一間店或還原前資料，請以原編號核對'),{historyUncertain:true})
 if(context.revision!==(data.supplierEntries||[]).length)throw Error('供應商帳已更新，請重新核對採購')
 businessInstant(request.time)
 if(Math.abs((data.now??Date.now())-Date.parse(request.time))>300000)throw Error('採購操作時間已過期，請重新核對')
 return context
}
export function planSupplierInventory(request,data,actor){
 assertPrivateQuickPurchase(request,{scope:data,actor})
 if(!procurement(request))return planInventory(request,data,actor)
 const context=checkContext(request,data)
 if(!context)return planInventory(request,data,actor)
 supplierActor(actor)
 validateSupplierLedgerRecords(data.supplierEntries||[],data.supplierOperations||[],data)
 assertProcurementApproval(request,data,supplierControlFromEntries(data.supplierEntries))
 const plan=planInventory(request,{...data,supplierCredits:data.supplierEntries||[]},actor)
 if(request.kind==='purchase-create')plan.supplierRegistration=planSupplierRegistration(request,plan.purchase,data,actor)
 return plan
}
export function supplierInventoryReceipt(request,receipt,data){
 const result=inventoryReceipt(request,receipt,data)
 if(!procurement(request)||!supplierInventoryContext(request))return result
 const supplierLedger=validateSupplierLedgerRecords(data.supplierEntries||[],data.supplierOperations||[],data)
 if(request.kind==='purchase-create'){
  const registration=data.supplierEntries.find(event=>event.id===request.id)
  if(!registration||registration.action!=='purchase-register'||registration.purchaseId!==receipt.purchaseId||canonicalSignature(registration.input)!==canonicalSignature(request))throw Error('原採購回覆缺少同一操作的核准登記')
  result.supplierRegistration=registration
 }
 return {...result,supplierLedger,supplierEvidence:supplierLedgerEvidence(data)}
}
export function assertSupplierInventoryResult(request,result){
 const context=supplierInventoryContext(request)
 if(!procurement(request)||!context)return result
 assertSupplierLedgerView(result.supplierLedger,result.supplierEvidence,context.storeId)
 if(request.kind==='purchase-create'){
  const event=result.supplierLedger.entries.find(row=>row.id===request.id)
  if(!event||event.action!=='purchase-register'||event.revision!==context.revision+1||event.purchaseId!==request.purchase?.id||canonicalSignature(event.input)!==canonicalSignature(request)||canonicalSignature(event)!==canonicalSignature(result.supplierRegistration))throw Error('採購保存結果尚未確認：原核准登記不符')
 }
 return result
}
