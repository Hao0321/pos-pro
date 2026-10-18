import {RECEIPT_REVIEW_KIND,isReceiving,hasReceiptLots,assertLiveReceiptReview,assertReceiptReviewHistory} from './receiptReview.mjs'
import {canonicalSignature,operationHeader,quantityValue,moneyValue} from './operationRules.mjs'
import {PROCUREMENT_KINDS,isPurchaseCreate,isProcurement,planProcurement,recordProcurementReceipt,procurementEvent,validateProcurement,procurementDate} from './procurementRules.mjs'
import {PHYSICAL_STOCKTAKE,PHYSICAL_MEANING,planPhysicalStocktake,assertPhysicalStocktakeReceipt} from './physicalStocktake.mjs'
import {receiptLots,receiptNewItemPrices,RECEIPT_LOT_KIND} from './receiptLots.mjs'
import {validatePurchaseItemPrice,purchaseReferenceCost} from './purchaseUnitPricing.mjs'
export const INVENTORY_ACTION='INVENTORY_OPERATION'
export const INVENTORY_PREFIX='stock-operation:'
export function planInventory(request,data,actor){
  operationHeader(request)
  const products=new Map(data.products.map(p=>[p.id,{...p}])),changed=new Set(),created=new Set()
  let purchase=null,supplier=null,cashLog=null,stocktake=null
  const arrival=hasReceiptLots(request)?receiptLots(request):null,acceptedPrices=new Set()
  if(request.kind==='stocktake'){
    if(request.protocol!==undefined&&request.protocol!==PHYSICAL_STOCKTAKE)throw Error('盤點版本不支援，請保留原草稿核對')
    if(request.protocol===PHYSICAL_STOCKTAKE||request.quantityMeaning===PHYSICAL_MEANING)stocktake=planPhysicalStocktake(request,data)
    else if(request.quantityMeaning!==undefined&&request.quantityMeaning!=='available'||!request.quantityMeaning&&(data.restaurantEntries||[]).some(row=>!['completed','cancelled'].includes(row.status)))throw Error('請使用實際架上數量盤點，系統會自動核對預留')
    if(!Array.isArray(request.counts)||!request.counts.length||request.counts.length>10000)throw Error('請確認盤點品項')
    for(const count of request.counts){
      const p=products.get(count.id)
      if(!p||changed.has(count.id))throw Error('盤點商品不存在或重複')
      if(stocktake){p.stock=stocktake.rows.find(row=>row.fact.product.id===p.id).availableAfterUnits/1000}
      else{quantityValue(count.stock,'實盤數量');quantityValue(count.expectedStock,'盤點時庫存');if(p.stock!==count.expectedStock)throw Error('盤點期間庫存已變更，請重新核對 '+p.name);p.stock=count.stock}
      changed.add(p.id)
    }
  }else if(isReceiving(request.kind)){
    assertLiveReceiptReview(request,data)
    const original=data.purchases.find(p=>p.id===request.purchaseId)
    if(!original||!['ordered','partial'].includes(original.status))throw Error('進貨單已到貨或不存在')
    if(request.expectedPurchase!==canonicalSignature(original))throw Error('進貨單已變更，請重新核對')
    if(!Array.isArray(request.quantities)||request.quantities.length!==original.items.length||!request.quantities.some(q=>q>0))throw Error('請填本次到貨量')
    const newPrices=arrival?.newItems||([2].includes(original.procurement?.version)||request.kind===RECEIPT_REVIEW_KIND?receiptNewItemPrices(request.newItems===undefined?[]:request.newItems,request.quantities.map(q=>Math.round(q*1000))):[])
    supplier=data.suppliers.find(s=>s.id===original.supplierId);supplier=supplier?structuredClone(supplier):null
    const links=[]
    const items=original.items.map((item,index)=>{
      const qty=request.quantities[index];quantityValue(qty,'本次到貨量');quantityValue(item.qty,'叫貨量',.001);quantityValue(item.received??0,'已到貨量');validatePurchaseItemPrice(item)
      if(qty>0&&Math.round(qty*1000)>Math.max(0,Math.round(item.qty*1000)-Math.round((item.received||0)*1000)))throw Error('本次到貨超過可接收數量，請核對進貨單')
      let id=item.productId
      if(qty>0){
        if(id){
          const p=products.get(id);if(!p)throw Error('進貨商品已不存在，請核對 '+item.name)
          if(original.procurement?.version===2&&(p.unit||'個')!==item.unit)throw Error('商品基本單位已變更，請保留原輸入重新核對')
          p.stock=Math.round((quantityValue(p.stock,'商品庫存')+qty)*1000)/1000;quantityValue(p.stock,'到貨後庫存');changed.add(id)
        }else{
          const linked=item.catalogId&&supplier?.catalog?.find(c=>c.id===item.catalogId)?.productId
          if(linked&&products.has(linked)){
            id=linked;const p=products.get(id);if(original.procurement?.version===2&&(p.unit||'個')!==item.unit)throw Error('商品基本單位已變更，請保留原輸入重新核對');p.stock=Math.round((quantityValue(p.stock,'商品庫存')+qty)*1000)/1000;quantityValue(p.stock,'到貨後庫存');changed.add(id)
          }else{
            id='p-'+request.id+'-'+index;if(products.has(id))throw Error('新商品編號衝突，請核對')
            const price=newPrices.find(row=>row.lineIndex===index)
            if((arrival||original.procurement?.version===2||request.kind===RECEIPT_REVIEW_KIND)&&!price)throw Error('請確認新商品的售價')
            if(price)acceptedPrices.add(index)
            const p={id,name:item.name,category:item.category||'未分類',price:price?price.priceCents/100:Math.round(item.unitCost*1.3),cost:purchaseReferenceCost(item).amount??0,stock:qty,unit:item.unit||'個',supplierId:original.supplierId||'',noBarcode:true,barcode:'',imageUrl:'',expiryDate:'',reorderLevel:0}
            if(typeof p.name!=='string'||!p.name.trim())throw Error('進貨品項缺少名稱')
            products.set(id,p);changed.add(id);created.add(id)
          }
          if(item.catalogId)links.push({catalogId:item.catalogId,productId:id})
        }
      }
      return {...item,productId:id,received:Math.round(((item.received||0)+qty)*1000)/1000}
    })
    if(newPrices.some(row=>!acceptedPrices.has(row.lineIndex)))throw Error('既有商品不能在收貨時改價，請重新核對品項')
    if(supplier&&links.length)supplier.catalog=(supplier.catalog||[]).map(c=>({...c,...(links.find(l=>l.catalogId===c.id)?{productId:links.find(l=>l.catalogId===c.id).productId}:{})}))
    else supplier=null
    const full=items.every(i=>i.received>=i.qty)
    purchase=recordProcurementReceipt(original,{...original,items,status:full?(isProcurement(original)?'received':original.paidDate?'paid':'received'):'partial',receivedDate:procurementDate(request.time)},request)
  }else if(PROCUREMENT_KINDS.includes(request.kind)){
    const plan=planProcurement(request,data,actor)
    ;({purchase,cashLog}=plan)
    for(const delta of plan.stockDeltas||[]){
      const product=products.get(delta.productId)
      if(!product)throw Error('退貨商品不存在，請核對原收貨紀錄')
      const remaining=Math.round(quantityValue(product.stock,'商品庫存')*1000)+Math.round(delta.qty*1000)
      if(remaining<0)throw Error('現有庫存不足，已售出或耗用的商品不能退回供應商')
      product.stock=quantityValue(remaining/1000,'退貨後庫存');changed.add(product.id)
    }
  }else throw Error('庫存異動類型不正確')
  const receipt={id:request.id,kind:request.kind,signature:canonicalSignature(request),productIds:[...changed],purchaseId:purchase?.id||null,supplierId:supplier?.id||null,time:request.time}
  if(stocktake)receipt.stocktake=stocktake
  if(isProcurement(purchase)){receipt.purchaseVersion=purchase.procurement.revision;receipt.document=procurementEvent(purchase,request)}
  if(cashLog)receipt.cashLogId=cashLog.id
  return {receipt,products:[...changed].map(id=>products.get(id)),created:[...created],purchase,supplier,cashLog,createPurchase:isPurchaseCreate(request.kind)}
}
export function inventoryReceipt(request,row,data){
  if(row.signature!==canonicalSignature(request))throw Object.assign(Error('原操作編號已存在且內容不同，請核對已建立單據；新單請重新整理草稿'),{operationConflict:true})
  if(request.protocol===PHYSICAL_STOCKTAKE)assertPhysicalStocktakeReceipt(request,row.stocktake)
  if(!Array.isArray(row.productIds)||!row.productIds.length&&!PROCUREMENT_KINDS.includes(request.kind))throw Error('庫存異動編號內容不一致')
  const products=row.productIds.map(id=>data.products.find(p=>p.id===id))
  if(products.some(p=>!p))throw Error('原異動商品已不存在，請先核對')
  if(row.purchaseId&&!data.purchases.some(p=>p.id===row.purchaseId)||row.supplierId&&!data.suppliers.some(s=>s.id===row.supplierId))throw Error('原異動進貨單或供應商已不存在，請先核對')
  const purchase=row.purchaseId?data.purchases.find(p=>p.id===row.purchaseId):null
  if(['purchase-return','purchase-return-lots'].includes(request.kind)){
    const expected=[...new Set(purchase?.items.filter((_,i)=>request.quantities?.[i]>0).map(item=>item.productId))]
    if(!expected.length||expected.length!==row.productIds.length||expected.some(id=>!id||!row.productIds.includes(id)))throw Error('原退貨庫存回執不完整，請保留原編號核對')
  }
  if(request.kind===RECEIPT_REVIEW_KIND)assertReceiptReviewHistory(request,purchase,row.productIds)
  if(row.document){validateProcurement(purchase);if(!isProcurement(purchase)||purchase.procurement.revision<row.purchaseVersion||canonicalSignature(procurementEvent(purchase,request))!==canonicalSignature(row.document))throw Error('採購歷史文件缺失，請保留原編號核對')}
  const cashLog=row.cashLogId?data.cashLogs?.find(l=>l.id===row.cashLogId):null
  if(row.cashLogId&&!cashLog)throw Error('原付款現金流水已不存在，請保留原編號核對')
  return {success:true,receipt:row,products,purchase,supplier:row.supplierId?data.suppliers.find(s=>s.id===row.supplierId):null,cashLog}
}
