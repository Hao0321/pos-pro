import { browserStorage } from './browserStorage'
export const FINANCIAL_PENDING='pos_pending_financial_v1'
const fields={refund:'order',topup:'topup',cashlog:'cashLog',waste:'waste',stocktake:'receipt',receive:'receipt',restaurant:'receipt'}
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
  if(['stocktake','receive'].includes(kind)){
    if(row.kind!==kind||row.signature!==JSON.stringify(canonical(request))||!Array.isArray(row.productIds)||!row.productIds.length||!Array.isArray(result.products)||result.products.length!==row.productIds.length||new Set(row.productIds).size!==row.productIds.length||row.productIds.some(id=>!result.products.some(p=>p.id===id)))throw Error('庫存保存結果尚未確認：回覆內容不符')
    if(kind==='stocktake'&&(row.productIds.length!==request.counts.length||request.counts.some(c=>!row.productIds.includes(c.id))))throw Error('盤點回覆缺少原品項')
    if(kind==='receive'&&(row.purchaseId!==request.purchaseId||result.purchase?.id!==request.purchaseId))throw Error('到貨回覆缺少原進貨單')
  }
}
function clearOriginal(pending){
  const current=readPendingFinancial()
  if(current?.request.id!==pending.request.id||current.signature!==pending.signature)throw Error('待確認異動編號已改變，請保留紀錄核對')
  browserStorage.removeItem(FINANCIAL_PENDING)
}
// A lost reply retains the original ID. Retrying identical input is safe only
// because every participating persistence adapter deduplicates that ID.
export async function executeFinancial(kind, input, persist,onState=()=>{}) {
  if(running)throw Error('正在保存異動，請勿重複提交')
  if(!Object.hasOwn(fields,kind))throw Error('異動類型不正確')
  finiteTree(input);running=true;let pending
  const notify=(phase,message='')=>onState({phase,kind:pending?.kind||kind,id:pending?.request.id||null,message})
  try{
  const signature=JSON.stringify({kind,input})
  pending=readPendingFinancial()
  if (pending && JSON.stringify(canonical(JSON.parse(pending.signature)))!==JSON.stringify(canonical({kind,input}))) throw new Error('上一筆異動結果尚未確認。請以原內容重試並核對紀錄，勿建立另一筆。')
  if (!pending) {
    pending={signature,kind,request:{...input,id:kind+'-'+crypto.randomUUID(),time:new Date().toISOString()}}
    browserStorage.setItem(FINANCIAL_PENDING,JSON.stringify(pending))
  }
  notify('saving','保存中，請勿重複異動')
  let result
  try {result=await persist(pending.request)} catch {throw new Error('保存結果尚未確認。請以原內容重試；系統會沿用原單號，勿重複付款或退款。')}
  if (result?.success===false && result.committed===false) {
    clearOriginal(pending)
    pending=null;notify('idle')
    throw new Error(result.error||'資料保存失敗')
  }
  assertReceipt(kind,pending.request,result)
  clearOriginal(pending)
  notify('idle')
  return result
  }catch(error){
    if(browserStorage.getItem(FINANCIAL_PENDING))notify('uncertain','異動結果尚未確認，請以原編號核對或重試；不要重新收款或扣庫存')
    else notify('idle')
    throw error
  }finally{running=false}
}
