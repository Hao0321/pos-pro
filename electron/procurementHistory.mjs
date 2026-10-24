import {RECEIPT_REVIEW_KIND,assertReceiptReviewHistory} from './receiptReview.mjs'
import {PURCHASE_UNITS_KIND,assertPurchaseUnitReview} from './purchaseUnitPricing.mjs'
import {canonicalSignature,operationHeader} from './operationRules.mjs'
import {INVENTORY_ACTION,INVENTORY_PREFIX} from './inventoryOperations.mjs'
import {isProcurement,validateProcurement,procurementEvent,planProcurement,recordProcurementReceipt,procurementDate,PROCUREMENT_KINDS,isPurchaseCreate} from './procurementRules.mjs'
import {procurementApprovalMaterial,purchaseMatchesApproval,supplierActor} from './supplierControl.mjs'
import {only,businessId} from './businessExchange.mjs'
import {assertPrivateQuickPurchase} from './privateDrafts.mjs'
const groups=['receipts','bills','payments','reversals','returns','refunds','refundReversals']
const collection={receive:'receipts','receive-lots':'receipts','receive-reviewed':'receipts','purchase-bill':'bills','purchase-pay':'payments','purchase-reverse':'reversals','purchase-return':'returns','purchase-return-lots':'returns','purchase-refund':'refunds','purchase-refund-reverse':'refundReversals'}
export function supplierInventoryContext(request){
  const context=request.supplierContext
  if(context===undefined)return null
  only(context,['storeId','epoch','revision'],'供應商帳版本');businessId(context.storeId)
  if(typeof context.epoch!=='string'||!context.epoch||context.epoch.length>128||!Number.isSafeInteger(context.revision)||context.revision<0)throw Error('供應商帳版本或還原識別不正確')
  return context
}
export function procurementCreationRequests(audits=[],purchases=[]){
 const ids=new Set(purchases.filter(isProcurement).map(po=>po.procurement.createdOperationId).filter(id=>typeof id==='string'&&id.startsWith('agent-'))),seen=new Set(),requests=[]
 for(const audit of audits){
  if(audit.action!==INVENTORY_ACTION||!ids.has(String(audit.id).slice(INVENTORY_PREFIX.length)))continue
  try{
   const receipt=typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail,request=JSON.parse(receipt.signature);operationHeader(request)
   const po=purchases.find(row=>row.procurement?.createdOperationId===request.id)
   if(audit.id!==INVENTORY_PREFIX+request.id||seen.has(request.id)||receipt.id!==request.id||!isPurchaseCreate(request.kind)||receipt.kind!==request.kind||receipt.signature!==canonicalSignature(request)||!po||po.id!==request.purchase?.id||po.procurement.createdAt!==request.time||receipt.purchaseVersion!==1||canonicalSignature(receipt.document)!==canonicalSignature(procurementEvent(po,request)))throw Error()
   supplierInventoryContext(request);assertPrivateQuickPurchase(request,{receiptActor:audit});seen.add(request.id);requests.push(request)
  }catch{throw Error('採購原始回執需要核對')}
 }
 return requests
}
export function readSupplierInventoryOperations(audits=[]){
  return audits.filter(row=>row.action===INVENTORY_ACTION).flatMap(row=>{
    const receipt=typeof row.detail==='string'?JSON.parse(row.detail):row.detail
    if(!receipt||typeof receipt.signature!=='string')throw Error('採購原始回執需要核對')
    const request=JSON.parse(receipt.signature);operationHeader(request)
    if(row.id!==INVENTORY_PREFIX+request.id||receipt.id!==request.id||receipt.kind!==request.kind||receipt.signature!==canonicalSignature(request))throw Error('採購回執與原操作不一致')
    if(!['receive','receive-lots','receive-reviewed',...PROCUREMENT_KINDS].includes(request.kind))return []
    const purchaseId=isPurchaseCreate(request.kind)?request.purchase?.id:request.purchaseId;businessId(purchaseId)
    const context=supplierInventoryContext(request),actor={userId:row.userId||'',username:row.username||'',role:row.role}
    assertPrivateQuickPurchase(request,{receiptActor:actor})
    if(context)supplierActor(actor)
    return [{request,receipt,actor,purchaseId,seenRevision:context?.revision||0,context}]
  })
}
function prefix(before,current){
  validateProcurement(before)
  if(!purchaseMatchesApproval(current,procurementApprovalMaterial(before)))throw Error('採購歷史的訂購條件不一致')
  for(const group of groups){const rows=before.procurement[group]||[],whole=current.procurement[group]||[];if(rows.length>whole.length||rows.some((row,index)=>canonicalSignature(row)!==canonicalSignature(whole[index])))throw Error('採購歷史不是原文件的前綴')}
  if(before.procurement.cancel&&canonicalSignature(before.procurement.cancel)!==canonicalSignature(current.procurement.cancel))throw Error('採購取消歷史不一致')
}
function validateCreation(request,after){
  if(request.kind===PURCHASE_UNITS_KIND)assertPurchaseUnitReview(request)
  if(after.procurement.version!==(request.kind===PURCHASE_UNITS_KIND?2:request.sourceCatalogue?3:1))throw Error('採購版本與建立原單不符')
  const input=request.purchase
  if(!input||request.id!==after.procurement.createdOperationId||request.time!==after.procurement.createdAt||input.id!==after.id||input.supplierId!==after.supplierId||input.date!==after.date||String(input.note||'').slice(0,2000)!==after.note||input.items?.length!==after.items.length)throw Error('採購建立回執缺少原始條件')
  if(canonicalSignature(request.sourceQuote??null)!==canonicalSignature(after.procurement.sourceQuote??null))throw Error('採購建立回執缺少原報價')
  if(canonicalSignature(request.sourceCatalogue??null)!==canonicalSignature(after.procurement.sourceCatalogue??null))throw Error('採購建立回執缺少原目錄與選品。')
  input.items.forEach((item,index)=>{const row=after.items[index];if((item.productId||null)!==row.productId||(item.catalogId||null)!==row.catalogId||String(item.name).trim()!==row.name||(item.unit||'個')!==row.unit||item.qty!==row.qty||item.unitCost!==row.unitCost||canonicalSignature(item.costBasis??null)!==canonicalSignature(row.costBasis??null)||row.received!==0)throw Error('採購建立的品項或單價不一致')})
}
export function buildSupplierPurchaseTimelines(data,needed){
  const operations=readSupplierInventoryOperations(data.inventoryAudits||[]),timelines=new Map()
  for(const purchaseId of needed){
    const po=data.purchases.find(row=>row.id===purchaseId);if(!isProcurement(po))throw Error('供應商抵付缺少可追溯的原採購')
    validateProcurement(po)
    const rows=operations.filter(row=>row.purchaseId===purchaseId).sort((a,b)=>a.receipt.purchaseVersion-b.receipt.purchaseVersion),snapshots=new Map([[po.procurement.revision,po]])
    if(rows.length!==po.procurement.revision)throw Error('採購歷史回執不完整，請保留原資料核對')
    let seen=-1
    for(let index=0;index<rows.length;index++){
      const row=rows[index],version=index+1
      if(row.receipt.purchaseVersion!==version||row.seenRevision<seen||row.seenRevision>(data.supplierEntries?.length||0)||row.context&&row.context.storeId!==data.storeId)throw Error('採購引用的供應商帳版本或先後不正確')
      seen=row.seenRevision
      if(version===1&&!isPurchaseCreate(row.request.kind)||version>1&&isPurchaseCreate(row.request.kind))throw Error('採購建立回執順序不正確')
      if(row.receipt.purchaseId!==po.id||canonicalSignature(row.receipt.document)!==canonicalSignature(procurementEvent(po,row.request)))throw Error('採購回執與原保存文件不符')
      if(version>1){
        if(typeof row.request.expectedPurchase!=='string')throw Error('採購歷史缺少操作前文件')
        const before=JSON.parse(row.request.expectedPurchase)
        if(before.id!==po.id||before.procurement?.revision!==version-1||canonicalSignature(before)!==row.request.expectedPurchase)throw Error('採購操作前版本不正確')
        prefix(before,po);snapshots.set(version-1,before)
      }
    }
    validateCreation(rows[0].request,snapshots.get(1))
    timelines.set(purchaseId,{purchase:po,rows,snapshots})
  }
  return {operations,timelines}
}
export function supplierPurchaseAt(timelines,purchaseId,revision,ledgerRevision){
  const timeline=timelines.get(purchaseId),po=timeline?.snapshots.get(revision)
  if(!Number.isSafeInteger(revision)||revision<1||!po)throw Error('找不到抵付當時的採購版本')
  const before=timeline.rows[revision-1],after=timeline.rows[revision]
  if(before.seenRevision>=ledgerRevision||after&&after.seenRevision<ledgerRevision)throw Error('供應商抵付與採購歷史先後不一致')
  return po
}
export function assertSupplierInventoryTransition(row,timeline,credits,data){
  const version=row.receipt.purchaseVersion,after=timeline.snapshots.get(version)
  if(version===1)return
  const before=timeline.snapshots.get(version-1),event=collection[row.request.kind]?after.procurement[collection[row.request.kind]].find(entry=>entry.id===row.request.id):after.procurement.cancel
  if(!event)throw Error('採購回執缺少該次保存文件')
  let planned,cashLog=null
  if(['receive','receive-lots','receive-reviewed'].includes(row.request.kind)){
    if(row.request.kind===RECEIPT_REVIEW_KIND)assertReceiptReviewHistory(row.request,after,row.receipt.productIds)
    const quantities=row.request.quantities
    if(!Array.isArray(quantities)||quantities.length!==before.items.length)throw Error('採購收貨歷史數量不完整')
    const items=before.items.map((item,index)=>{
      const current=after.items[index],received=Math.round(((item.received||0)+quantities[index])*1000)/1000
      if(item.productId&&item.productId!==current.productId||quantities[index]>0&&!current.productId||quantities[index]===0&&item.productId!==current.productId)throw Error('採購收貨的原商品連結不一致')
      return {...item,productId:current.productId,received}
    })
    planned=recordProcurementReceipt(before,{...before,items,status:items.every(item=>item.received>=item.qty)?'received':'partial',receivedDate:procurementDate(row.request.time)},row.request)
    const ids=[...new Set(items.filter((_,index)=>quantities[index]>0).map(item=>item.productId))]
    if(!Array.isArray(row.receipt.productIds)||ids.length!==row.receipt.productIds.length||ids.some(id=>!row.receipt.productIds.includes(id)))throw Error('採購收貨回執缺少原庫存品項')
  }else{
    const result=planProcurement(row.request,{...data,purchases:[before,...data.purchases.filter(po=>po.id!==before.id)],supplierCredits:credits,openShift:event.method==='cash'?{id:row.request.shiftId,status:'open'}:null},row.actor)
    planned=result.purchase;cashLog=result.cashLog
  }
  if(canonicalSignature(planned)!==canonicalSignature(after))throw Error('採購歷史金額或來源與原操作不符')
  if(cashLog){const actual=data.cashLogs?.find(log=>log.id===cashLog.id);if(canonicalSignature(actual)!==canonicalSignature(cashLog)||row.receipt.cashLogId!==cashLog.id)throw Error('採購歷史與原現金流水不符')}
  else if(row.receipt.cashLogId)throw Error('採購歷史回執含有不明現金流水')
}
