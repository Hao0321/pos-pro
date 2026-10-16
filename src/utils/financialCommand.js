import { browserStorage } from './browserStorage'
import {assertStoredBrowserCostReceipt} from './browserStockBusiness'
import {PROCUREMENT_KINDS,isProcurement,procurementEvent,validateProcurement} from '../../electron/procurementRules.mjs'
import {operationHeader} from '../../electron/operationRules.mjs'
import {assertExchangeReceipt} from '../../electron/businessExchange.mjs'
import {assertSalesResult} from '../../electron/salesPlan.mjs'
import {assertCustomerLedgerResult} from '../../electron/customerLedger.mjs'
import {assertSupplierLedgerResult} from '../../electron/supplierLedger.mjs'
import {assertSupplierInventoryResult} from '../../electron/supplierInventory.mjs'
import {PHYSICAL_STOCKTAKE,assertPhysicalStocktakeResult} from '../../electron/physicalStocktake.mjs'
export const FINANCIAL_PENDING='pos_pending_financial_v1'
const fields={refund:'order',topup:'topup',cashlog:'cashLog',waste:'waste',stocktake:'receipt',receive:'receipt',restaurant:'receipt',exchange:'receipt',sales:'receipt','customer-ledger':'receipt','supplier-ledger':'receipt'}
for(const kind of PROCUREMENT_KINDS)fields[kind]='receipt'
let running=false
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value
function finiteTree(value,depth=0){if(depth>16)throw Error('異動紀錄需要核對');if(typeof value==='number'&&!Number.isFinite(value))throw Error('異動紀錄含無效數字');if(value&&typeof value==='object')for(const v of Object.values(value))finiteTree(v,depth+1)}
export function readPendingFinancial(){
  const raw=browserStorage.getItem(FINANCIAL_PENDING);if(!raw)return null
  const p=JSON.parse(raw),s=JSON.parse(p.signature);finiteTree(p)
  if(!Object.hasOwn(fields,p.kind)||s.kind!==p.kind||!s.input||typeof p.request?.id!=='string'||!p.request.id||!Number.isFinite(Date.parse(p.request.time)))throw Error('待確認異動紀錄損壞，請保留紀錄核對')
  const input={...p.request};delete input.id;delete input.time
  if(JSON.stringify(canonical(input))!==JSON.stringify(canonical(s.input)))throw Error('待確認異動內容不一致，請保留紀錄核對')
  return p
}
function assertReceipt(kind,request,result){
  finiteTree(result)
  const row=result?.[fields[kind]]
  if(result?.success!==true||row?.id!==request.id)throw Error('保存結果尚未確認：回覆缺少正確的異動編號')
  if(kind==='exchange')assertExchangeReceipt(request,result)
  if(kind==='sales')assertSalesResult(request,result)
  if(kind==='customer-ledger')assertCustomerLedgerResult(request,result)
  if(kind==='supplier-ledger')assertSupplierLedgerResult(request,result)
  if(kind==='topup'&&(['memberId','amount','bonus','payMethod','shiftId'].some(k=>(row[k]??'')!==(request[k]??''))||result.member?.id!==request.memberId))throw Error('儲值保存結果尚未確認：回覆內容不符')
  if(kind==='refund'&&(row.refundOf!==request.refundOf||result.original?.id!==request.refundOf))throw Error('退款保存結果尚未確認：原單不符')
  if(kind==='cashlog'&&['shiftId','type','amount','reason'].some(k=>(row[k]??'')!==(request[k]??'')))throw Error('現金流水保存結果尚未確認：回覆內容不符')
  if(kind==='waste'&&(row.productId!==request.productId||row.qty!==request.qty||result.product?.id!==request.productId))throw Error('損耗保存結果尚未確認：回覆內容不符')
  if(kind==='restaurant'){
    if(row.kind!==kind||row.action!==request.action||row.signature!==JSON.stringify(canonical(request))||!Array.isArray(row.productIds)||new Set(row.productIds).size!==row.productIds.length||!Array.isArray(result.products)||row.productIds.length!==result.products.length||row.productIds.some(id=>!result.products.some(p=>p.id===id))||!result.config)throw Error('預訂保存結果尚未確認：回覆內容不符')
    if(request.action!=='configure'&&result.entry?.id!==(request.action==='create'?request.id:request.entryId))throw Error('預訂回覆缺少原單')
    if(request.action!=='configure'&&(!Number.isSafeInteger(row.entityVersion)||row.entityVersion<1||result.entry.version<row.entityVersion))throw Error('預訂回覆缺少保存版本')
    if(request.action==='pay'&&(!row.saleId||result.order?.id!==row.saleId))throw Error('預訂回覆缺少收款流水')
    if(request.action==='pay'&&(result.order.shiftId!==request.shiftId||result.order.total!==result.entry.total||result.order.payMethod!==request.payMethod))throw Error('預訂回覆收款內容不符')
    if(request.action==='cancel'&&row.refundId&&(result.refund?.id!==row.refundId||result.refund.shiftId!==request.shiftId||result.refund.total!==-result.entry.total))throw Error('預訂回覆缺少退款流水')
  }
  if(['stocktake','receive',...PROCUREMENT_KINDS].includes(kind)){
    assertSupplierInventoryResult(request,result)
    if(row.kind!==kind||row.signature!==JSON.stringify(canonical(request))||!Array.isArray(row.productIds)||!row.productIds.length&&!PROCUREMENT_KINDS.includes(kind)||!Array.isArray(result.products)||result.products.length!==row.productIds.length||new Set(row.productIds).size!==row.productIds.length||row.productIds.some(id=>!result.products.some(p=>p.id===id)))throw Error('庫存保存結果尚未確認：回覆內容不符')
    if(kind==='stocktake'&&(row.productIds.length!==request.counts.length||request.counts.some(c=>!row.productIds.includes(c.id))))throw Error('盤點回覆缺少原品項')
    if(kind==='stocktake'&&request.protocol===PHYSICAL_STOCKTAKE)assertPhysicalStocktakeResult(request,result)
    if(kind==='receive'&&(row.purchaseId!==request.purchaseId||result.purchase?.id!==request.purchaseId))throw Error('到貨回覆缺少原進貨單')
    if(PROCUREMENT_KINDS.includes(kind)||row.document){
      const po=result.purchase
      if(!isProcurement(po)||po.id!==(kind==='purchase-create'?request.purchase.id:request.purchaseId)||row.purchaseId!==po.id||!Number.isSafeInteger(row.purchaseVersion)||po.procurement.revision<row.purchaseVersion)throw Error('採購回覆缺少原進貨單或保存版本')
      validateProcurement(po)
      if(kind==='purchase-create'&&JSON.stringify(canonical(po.procurement.sourceQuote??null))!==JSON.stringify(canonical(request.sourceQuote??null)))throw Error('採購回覆缺少正確的報價來源')
      if(JSON.stringify(canonical(procurementEvent(po,request)))!==JSON.stringify(canonical(row.document)))throw Error('採購回覆缺少正確的保存文件')
      if(kind==='purchase-return'){
        const expected=[...new Set(po.items.filter((_,i)=>request.quantities?.[i]>0).map(item=>item.productId))]
        if(!expected.length||expected.length!==row.productIds.length||expected.some(id=>!id||!row.productIds.includes(id))||result.products.some(p=>!Number.isFinite(p.stock)||p.stock<0))throw Error('退貨回覆缺少完整的庫存結果，請保留原編號核對')
      }
      if(row.cashLogId&&result.cashLog?.id!==row.cashLogId)throw Error('採購回覆缺少現金流水')
    }
  }
  if(!globalThis.window?.electronAPI){
    const method={refund:'refundOrder',waste:'addWaste',restaurant:'applyRestaurantOperation',sales:'applySalesOperation',stocktake:'applyInventoryOperation',receive:'applyInventoryOperation'}[kind]||(PROCUREMENT_KINDS.includes(kind)?'applyInventoryOperation':null)
    if(method)assertStoredBrowserCostReceipt(method,request,result)
  }
}
function clearOriginal(pending){
  const current=readPendingFinancial()
  if(current?.request.id!==pending.request.id||current.signature!==pending.signature)throw Error('待確認異動編號已改變，請保留紀錄核對')
  browserStorage.removeItem(FINANCIAL_PENDING)
}
// A lost reply retains the original ID. Retrying identical input is safe only
// because every participating persistence adapter deduplicates that ID.
export async function executeFinancial(kind, input, persist,onState=()=>{},identity=null,verifyLegacy=null,prepare=null) {
  if(running)throw Error('正在保存異動，請勿重複提交')
  if(!Object.hasOwn(fields,kind))throw Error('異動類型不正確')
  finiteTree(input);running=true;let pending,createdPending=false
  const notify=(phase,message='')=>onState({phase,kind:pending?.kind||kind,id:pending?.request.id||null,message})
  try{
  const signature=JSON.stringify({kind,input})
  pending=readPendingFinancial()
  if (pending && JSON.stringify(canonical(JSON.parse(pending.signature)))!==JSON.stringify(canonical({kind,input}))) throw new Error('上一筆異動結果尚未確認。請以原內容重試並核對紀錄，勿建立另一筆。')
  if (!pending) {
    if(identity)operationHeader(identity)
    pending={signature,kind,recoveryProtocol:'pos-recovery-v1',request:{...input,id:identity?.id||kind+'-'+crypto.randomUUID(),time:identity?.time||new Date().toISOString()}}
    browserStorage.setItem(FINANCIAL_PENDING,JSON.stringify(pending))
    createdPending=true
  }else if(pending.recoveryProtocol!=='pos-recovery-v1'){
    // An old release may have already replaced the book. Never silently create
    // a missing historical operation just because its old pending ID is absent.
    if(!verifyLegacy||await verifyLegacy(pending)!==true)throw Error('舊版原紀錄仍需要核對，請店主使用復原引導確認，勿重新收款')
  }
  if(prepare){
    try{await prepare(pending)}catch(error){
      if(createdPending){const rejectedId=pending.request.id;clearOriginal(pending);pending=null;notify('idle');throw Object.assign(error,{notCommitted:true,operationId:rejectedId})}
      throw error
    }
  }
  notify('saving','保存中，請勿重複異動')
  let result
  try {result=await persist(pending.request)} catch {throw new Error(kind==='exchange'?'報價保存結果尚未確認。請用原編號確認，先不要再開一張。':'保存結果尚未確認。請以原內容重試；系統會沿用原單號，勿重複付款或退款。')}
  if (result?.success===false && result.committed===false) {
    const rejectedId=pending.request.id
    clearOriginal(pending)
    pending=null;notify('idle')
    throw Object.assign(new Error(result.error||'資料保存失敗'),{notCommitted:true,operationId:rejectedId})
  }
  if(result?.success===false&&result.committed===null&&result.errorCode==='RECOVERY_REQUIRED')throw new Error(result.error)
  assertReceipt(kind,pending.request,result)
  clearOriginal(pending)
  notify('idle')
  return result
  }catch(error){
    if(browserStorage.getItem(FINANCIAL_PENDING))notify('uncertain',kind==='exchange'?'報價保存結果尚未確認。請用原編號確認，先不要再開一張。':'異動結果尚未確認，請以原編號核對或重試；不要重新收款或扣庫存')
    else notify('idle')
    throw error
  }finally{running=false}
}
