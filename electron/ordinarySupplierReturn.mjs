import {draftObject,privateDraftDigest,assertPrivateDraftContext} from './privateDrafts.mjs'
import {expenseScope} from './expenseEntry.mjs'
import {operationHeader,canonicalSignature} from './operationRules.mjs'
import {invoiceQuantity} from './purchaseInvoice.mjs'
import {availableForReturn} from './procurementValuation.mjs'
import {planInventory} from './inventoryOperations.mjs'
import {planProcurement,procurementEvent,validateProcurement} from './procurementRules.mjs'
import {supplierInventoryReceipt} from './supplierInventory.mjs'

export const ORDINARY_RETURN_FAMILY='ordinary-supplier-return'
const same=(a,b)=>privateDraftDigest(a)===privateDraftDigest(b)
const uncertain=()=>Object.assign(Error('退貨原紀錄需要核對，請保留輸入，勿重複退貨。'),{historyUncertain:true})
export const isOrdinaryReturn=input=>typeof input?.id==='string'&&input.id.startsWith('ordinary-return-')||Object.hasOwn(input||{},'ordinaryReturnReview')
export const ordinaryReturnItemsDigest=po=>privateDraftDigest(po.items.map(({received,...item})=>item))
export function ordinaryReturnBasis({po,supplier,products,costActive,lotsActive}){
 const ids=[...new Set(po.items.map(item=>item.productId).filter(Boolean))]
 const facts=ids.map(id=>{const p=products.find(row=>row.id===id);if(!p||!Number.isFinite(p.stock)||p.stock<0)throw Error('原採購商品或單位已變更，請保留退貨輸入核對。');return {id:p.id,name:p.name,unit:p.unit||'個',stock:p.stock}})
 return privateDraftDigest({purchase:privateDraftDigest(po),supplier:{id:supplier.id,name:supplier.name},products:facts,costActive:!!costActive,lotsActive:!!lotsActive})
}
export function ordinaryReturnQuote(snapshot,raw,invoiceId,reason='preview'){
 const {po,products}=snapshot,quantities=raw.map(q=>q===''?0:invoiceQuantity(q))
 const request={id:'ordinary-preview',kind:'purchase-return',time:new Date().toISOString(),purchaseId:po.id,expectedPurchase:canonicalSignature(po),invoiceId,quantities,reason}
 const planned=planInventory(request,{products,purchases:[po]},{}),entry=planned.purchase.procurement.returns.at(-1)
 // planInventory aggregates repeated product lines before checking shop stock.
 for(const [i,item] of po.items.entries()){if(!quantities[i])continue;const product=products.find(p=>p.id===item.productId);if(!product||(product.unit||'個')!==(item.unit||'個'))throw Error('原採購商品或單位已變更，請保留退貨輸入核對。')}
 return {quantities,amount:entry.amount}
}
export function ordinaryReturnSources(po){return [{id:'',reference:''},...po.procurement.bills.map(b=>({id:b.id,reference:b.reference}))].map(s=>({...s,quantities:availableForReturn(po,s.id).quantities}))}
export function assertOrdinaryReturnHeader(input,current){
 operationHeader(input);const r=input.ordinaryReturnReview;draftObject(r,['context','basisDigest','costActive']);expenseScope(r.context,current)
 if(input.kind!=='purchase-return'||!/^ordinary-return-[-a-f0-9]{36}$/.test(input.id)||!/^[a-f0-9]{64}$/.test(r.basisDigest)||typeof r.costActive!=='boolean')throw uncertain()
 return r
}
export function admitOrdinaryReturn(input,current,snapshot){
 const r=assertOrdinaryReturnHeader(input,current)
 if(snapshot.lotsActive)throw Error('這間店已使用批次，請保留輸入，改由批次退貨核對。')
 if(!same(snapshot.po,input.expectedPurchase?JSON.parse(input.expectedPurchase):null)||r.costActive!==!!snapshot.costActive||r.basisDigest!==ordinaryReturnBasis(snapshot))throw Error('採購或相關庫存已變更，請先核對最新資料。')
 ordinaryReturnQuote(snapshot,input.quantities.map(String),input.invoiceId,input.reason)
 return input
}
export function assertOrdinaryReturnLookup(input,current){
 draftObject(input,['family','context','id','digest','document']);expenseScope(input.context,current);const d=input.document
 draftObject(d,['purchaseId','invoiceId','quantities','reason','expectedPurchaseDigest','review'])
 if(input.family!==ORDINARY_RETURN_FAMILY||!/^ordinary-return-[-a-f0-9]{36}$/.test(input.id)||!/^[a-f0-9]{64}$/.test(input.digest)||!/^[a-f0-9]{64}$/.test(d.expectedPurchaseDigest)||typeof d.purchaseId!=='string'||!d.purchaseId||d.purchaseId.length>128||typeof d.invoiceId!=='string'||d.invoiceId.length>128||typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>500||!Array.isArray(d.quantities)||!d.quantities.length||d.quantities.length>1000)throw uncertain()
 for(const q of d.quantities)if(typeof q!=='number'||invoiceQuantity(String(q))!==q)throw uncertain()
 assertOrdinaryReturnHeader({id:input.id,kind:'purchase-return',time:'2026-01-01T00:00:00.000Z',ordinaryReturnReview:d.review},current);return input
}
function admittedMaterial(input,request,result,actor){
 assertOrdinaryReturnHeader(request,input.context);const d=input.document,c=request.supplierContext
 if(request.id!==input.id||privateDraftDigest(request)!==input.digest||!c||c.storeId!==input.context.storeId||c.epoch!==input.context.epoch||!Number.isSafeInteger(c.revision)||c.revision<0||['purchaseId','invoiceId','reason'].some(k=>request[k]!==d[k])||!same(request.quantities,d.quantities)||!same(request.ordinaryReturnReview,d.review))throw uncertain()
 let before;try{before=JSON.parse(request.expectedPurchase)}catch{throw uncertain()}
 if(canonicalSignature(before)!==request.expectedPurchase||before.id!==d.purchaseId||privateDraftDigest(before)!==d.expectedPurchaseDigest)throw uncertain()
 const row=result?.receipt,po=result?.purchase
 if(actor?.userId!==input.context.userId||actor.role!=='owner'||typeof actor.username!=='string'||result?.success!==true||row?.id!==input.id||row.kind!=='purchase-return'||row.signature!==canonicalSignature(request)||row.purchaseId!==request.purchaseId||!Array.isArray(result.products)||row.cashLogId||result.cashLog)throw uncertain()
 validateProcurement(po);const actual=po.procurement.returns.find(r=>r.id===input.id),expected=planProcurement(request,{purchases:[before]},actor).purchase.procurement.returns.find(r=>r.id===input.id),ids=[...new Set(before.items.filter((_,i)=>request.quantities[i]>0).map(item=>item.productId))]
 if(!actual||!same(actual,expected)||!same(procurementEvent(po,request),row.document)||!Number.isSafeInteger(row.purchaseVersion)||po.procurement.revision<row.purchaseVersion||!Array.isArray(row.productIds)||row.productIds.length!==ids.length||result.products.length!==ids.length||ids.some(id=>!row.productIds.includes(id)||!result.products.some(p=>p.id===id&&Number.isFinite(p.stock)&&p.stock>=0)))throw uncertain()
 return result
}
export function ordinaryReturnOriginal(input,current,data){
 assertOrdinaryReturnLookup(input,current);const rows=data.inventoryAudits.filter(row=>row.action==='INVENTORY_OPERATION'&&row.id==='stock-operation:'+input.id)
 if(rows.length>1)throw uncertain()
 if(!rows.length){if(data.purchases.some(po=>po.procurement?.returns?.some(r=>r.id===input.id)))throw uncertain();return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}}
 const source=rows[0];let receipt,request;try{receipt=typeof source.detail==='string'?JSON.parse(source.detail):source.detail;request=JSON.parse(receipt.signature)}catch{throw uncertain()}
 const actor={userId:source.userId,username:source.username,role:source.role},result=supplierInventoryReceipt(request,receipt,data);admittedMaterial(input,request,result,actor)
 return {protocol:'pos-private-draft-original/v1',status:'matched',action:'create',id:input.id,digest:input.digest,request,actor,result}
}
export function verifyOrdinaryReturnProof(input,proof){
 assertPrivateDraftContext(input.context);assertOrdinaryReturnLookup(input,input.context)
 if(proof?.protocol!=='pos-private-draft-original/v1'||proof.status!=='matched'||proof.action!=='create'||proof.id!==input.id||proof.digest!==input.digest)throw uncertain()
 const result=admittedMaterial(input,proof.request,proof.result,proof.actor);assertOrdinaryReturnCost(proof.request,result);return result
}
export function assertOrdinaryReturnCost(request,result){const cost=result?.costReceipt;if(request.ordinaryReturnReview?.costActive&&!cost||cost&&(cost.protocol!=='pos-stock-cost/v1'||cost.success!==true||cost.id!==request.id||cost.sourceMethod!=='applyInventoryOperation'||!Number.isSafeInteger(cost.sequence)||cost.sequence<2||typeof cost.eventId!=='string'||!cost.eventId||['eventHash','stateDigest'].some(k=>!/^sha256:[a-f0-9]{64}$/.test(cost[k]))))throw uncertain()}
