import {SUPPLIER_REFUND_FAMILY,supplierRefundOriginal} from '../../electron/supplierRefund.mjs'
import {PURCHASE_INVOICE_FAMILY,purchaseInvoiceOriginal} from '../../electron/purchaseInvoice.mjs'
import {browserDrawerOriginal} from './browserExpenseDrawer'
import {PURCHASE_PAYMENT_FAMILY,purchasePaymentOriginal} from '../../electron/purchasePayment.mjs'
import {browserExpenseOriginal} from './browserExpenseEntry'
import {wasteEntryLookup} from '../../electron/wasteEntryDraft.mjs'
import {heldOriginal} from '../../electron/heldCart.mjs'
import {browserHeldJournal} from './browserHeldCart'
import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import {privateDraftContext,assertDraftLookup,privateDraftOriginal,privateQuickOriginal,privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {assertImportedPurchaseSource} from '../../electron/quickPurchaseOriginal.mjs'
import {browserRestaurantState} from './browserRestaurant'
import {browserStockBusinessResult} from './browserStockBusiness'
import {readBrowserSupplier} from './browserSupplierLedger'
import {PRODUCT_EDIT_JOURNAL,readProductEditJournal,productEditOriginal} from '../../electron/productEditDraft.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {LOYALTY_PROGRAMS,readLoyaltyPrograms,loyaltyProgramOriginal,readLoyaltyRules,loyaltyFacts,issuedLoyaltyValue} from '../../electron/loyaltyProgram.mjs'
import {MEMBER_PROFILE_JOURNAL,readMemberProfileJournal,memberProfileOriginal} from '../../electron/memberProfile.mjs'
function context(saved,actor){const raw=saved.data.pos_business_settings.find(row=>row.key==='sharedStoreId')?.value;return privateDraftContext(raw===undefined?'':JSON.parse(raw),saved.salesEpoch,actor,saved.data.pos_users)}
export function getBrowserPrivateDraftContext(actor){return withSalesLock(()=>{
 let saved=readRecords();const users=saved.data.pos_users
 if(!actor||!users.some(row=>row.id===actor.userId&&row.username===actor.username&&row.role===actor.role)||!['owner','staff'].includes(actor.role))throw Error('請先登入，或重新驗證身份')
 const raw=saved.data.pos_business_settings.find(row=>row.key==='sharedStoreId')?.value,storeId=raw===undefined?'':JSON.parse(raw)
 if(!saved.salesEpoch||!storeId){writeRecords({pos_business_settings:updateBrowserSettings(saved.data.pos_business_settings,{sharedStoreId:JSON.stringify(storeId||crypto.randomUUID())})},saved.revision,{ensureSalesEpoch:true});saved=readRecords()}
 return context(saved,actor)
})}
export async function lookupBrowserPrivateDraftOriginal(input,actor){await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{
 const saved=readRecords(),current=context(saved,actor);if(input.family===SUPPLIER_REFUND_FAMILY){const proof=supplierRefundOriginal(input,current,readBrowserSupplier(saved));if(proof.status==='missing')assertOriginalOperationAvailable('applyInventoryOperation',input.id,saved);return proof}if(input.family===PURCHASE_INVOICE_FAMILY){const proof=purchaseInvoiceOriginal(input,current,readBrowserSupplier(saved));if(proof.status==='missing')assertOriginalOperationAvailable('applyInventoryOperation',input.id,saved);return proof}if(input.family===PURCHASE_PAYMENT_FAMILY){const proof=purchasePaymentOriginal(input,current,readBrowserSupplier(saved));if(proof.status==='missing')assertOriginalOperationAvailable('applyInventoryOperation',input.id,saved);return proof}if(['expense-drawer','expense-drawer-return'].includes(input.family))return browserDrawerOriginal(input,saved,actor);if(input.family==='expense-entry')return browserExpenseOriginal(input,saved,actor);if(input.family==='held-cart')return heldOriginal(input,current,browserHeldJournal(saved),saved.data.pos2_held_orders);assertDraftLookup(input,current)
 if(input.family==='loyalty-program'){const get=key=>readExchangeTextSetting(saved.data.pos_business_settings,key);return loyaltyProgramOriginal(input,loyaltyFacts(current,readLoyaltyRules(get),readLoyaltyPrograms(get(LOYALTY_PROGRAMS)),issuedLoyaltyValue(saved.data.pos2_members,saved.data.pos2_orders)))}
 if(input.family==='product-edit')return productEditOriginal(input,current,readProductEditJournal(readExchangeTextSetting(saved.data.pos_business_settings,PRODUCT_EDIT_JOURNAL)))
 if(input.family==='member-profile')return memberProfileOriginal(input,current,readMemberProfileJournal(readExchangeTextSetting(saved.data.pos_business_settings,MEMBER_PROFILE_JOURNAL)))
 if(input.family==='waste-entry'){
  const {core,digest}=wasteEntryLookup(input.document,current,actor);if(core.id!==input.id||digest!==input.digest)throw Error('原損耗資料需要核對，請保留輸入。')
  if(!saved.data.pos2_waste.some(row=>row.id===core.id))return {protocol:'pos-private-draft-original/v1',status:'missing',id:core.id}
  const result=browserStockBusinessResult('addWaste',core,saved,actor);return {protocol:'pos-private-draft-original/v1',status:'matched',id:core.id,digest,action:'create',entryId:core.id,result:{...result,product:result.product||{id:core.productId}}}
 }

 if(input.family){
  const imported=input.family==='quick-purchase-import',purchase=imported||input.family==='quick-purchase';if(purchase)readBrowserSupplier(saved);else browserRestaurantState()
  const row=purchase?saved.data.pos_audit_log.find(row=>row.id==='stock-operation:'+input.id):saved.data.pos_restaurant_operations.find(row=>row.id===input.id),receipt=purchase?(row?(typeof row.detail==='string'?JSON.parse(row.detail):row.detail):null):row
  const lookup=imported&&receipt?{context:input.context,id:input.id,family:'quick-purchase',digest:privateDraftDigest(JSON.parse(receipt.signature))}:input
  const original=privateQuickOriginal(lookup,receipt,purchase?row:receipt?.actor,actor)
  if(original.status==='missing')return original
  const request=JSON.parse(receipt.signature),sourceMatch=imported?assertImportedPurchaseSource(input.document,request):null,result=browserStockBusinessResult(purchase?'applyInventoryOperation':'applyRestaurantOperation',request,saved,actor)
  if(result?.success!==true||result.receipt?.signature!==receipt.signature)throw Error('保存結果尚未確認，請保留原編號核對。')
  return {...original,...(sourceMatch?{sourceMatch}:{}),result}
 }
 browserRestaurantState()
 const receipt=saved.data.pos_restaurant_operations.find(row=>row.id===input.id),original=privateDraftOriginal(input,receipt,actor)
 if(original.status!=='matched'||original.action!=='configure'&&!JSON.parse(receipt.signature).reservationDining)return original
 const result=browserStockBusinessResult('applyRestaurantOperation',JSON.parse(receipt.signature),saved,actor)
 if(result?.success!==true||result.receipt?.signature!==receipt.signature)throw Error('保存結果尚未確認，請保留原編號核對。')
 return {...original,result}
})}
