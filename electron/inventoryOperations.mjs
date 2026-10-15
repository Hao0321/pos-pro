import {canonicalSignature,operationHeader,quantityValue,moneyValue} from './operationRules.mjs'
import {PROCUREMENT_KINDS,isProcurement,planProcurement,recordProcurementReceipt,procurementEvent,validateProcurement,procurementDate} from './procurementRules.mjs'
export const INVENTORY_ACTION='INVENTORY_OPERATION'
export const INVENTORY_PREFIX='stock-operation:'
export function planInventory(request,data,actor){
  operationHeader(request)
  const products=new Map(data.products.map(p=>[p.id,{...p}])),changed=new Set(),created=new Set()
  let purchase=null,supplier=null,cashLog=null
  if(request.kind==='stocktake'){
    if(!Array.isArray(request.counts)||!request.counts.length||request.counts.length>10000)throw Error('請確認盤點品項')
    for(const count of request.counts){
      const p=products.get(count.id)
      if(!p||changed.has(count.id))throw Error('盤點商品不存在或重複')
      quantityValue(count.stock,'實盤數量');quantityValue(count.expectedStock,'盤點時庫存')
      if(p.stock!==count.expectedStock)throw Error('盤點期間庫存已變更，請重新核對 '+p.name)
      p.stock=count.stock;changed.add(p.id)
    }
  }else if(request.kind==='receive'){
    const original=data.purchases.find(p=>p.id===request.purchaseId)
    if(!original||!['ordered','partial'].includes(original.status))throw Error('進貨單已到貨或不存在')
    if(request.expectedPurchase!==canonicalSignature(original))throw Error('進貨單已變更，請重新核對')
    if(!Array.isArray(request.quantities)||request.quantities.length!==original.items.length||!request.quantities.some(q=>q>0))throw Error('請填本次到貨量')
    supplier=data.suppliers.find(s=>s.id===original.supplierId);supplier=supplier?structuredClone(supplier):null
    const links=[]
    const items=original.items.map((item,index)=>{
      const qty=request.quantities[index];quantityValue(qty,'本次到貨量');quantityValue(item.qty,'叫貨量',.001);quantityValue(item.received??0,'已到貨量');moneyValue(item.unitCost,'進貨單價')
      if(Math.round(qty*1000)>Math.round(item.qty*1000)-Math.round((item.received||0)*1000))throw Error('本次到貨超過可接收數量，請核對進貨單')
      let id=item.productId
      if(qty>0){
        if(id){
          const p=products.get(id);if(!p)throw Error('進貨商品已不存在，請核對 '+item.name)
          p.stock=Math.round((quantityValue(p.stock,'商品庫存')+qty)*1000)/1000;quantityValue(p.stock,'到貨後庫存');changed.add(id)
        }else{
          const linked=item.catalogId&&supplier?.catalog?.find(c=>c.id===item.catalogId)?.productId
          if(linked&&products.has(linked)){
            id=linked;const p=products.get(id);p.stock=Math.round((quantityValue(p.stock,'商品庫存')+qty)*1000)/1000;quantityValue(p.stock,'到貨後庫存');changed.add(id)
          }else{
            id='p-'+request.id+'-'+index;if(products.has(id))throw Error('新商品編號衝突，請核對')
            const p={id,name:item.name,category:item.category||'未分類',price:Math.round(item.unitCost*1.3),cost:item.unitCost,stock:qty,unit:item.unit||'個',supplierId:original.supplierId||'',noBarcode:true,barcode:'',imageUrl:'',expiryDate:'',reorderLevel:0}
            if(typeof p.name!=='string'||!p.name.trim())throw Error('進貨品項缺少名稱')
            products.set(id,p);changed.add(id);created.add(id)
          }
          if(item.catalogId)links.push({catalogId:item.catalogId,productId:id})
        }
      }
      return {...item,productId:id,received:Math.round(((item.received||0)+qty)*1000)/1000}
    })
    if(supplier&&links.length)supplier.catalog=(supplier.catalog||[]).map(c=>({...c,...(links.find(l=>l.catalogId===c.id)?{productId:links.find(l=>l.catalogId===c.id).productId}:{})}))
    else supplier=null
    const full=items.every(i=>i.received>=i.qty)
    purchase=recordProcurementReceipt(original,{...original,items,status:full?(isProcurement(original)?'received':original.paidDate?'paid':'received'):'partial',receivedDate:procurementDate(request.time)},request)
  }else if(PROCUREMENT_KINDS.includes(request.kind)){
    ;({purchase,cashLog}=planProcurement(request,data,actor))
  }else throw Error('庫存異動類型不正確')
  const receipt={id:request.id,kind:request.kind,signature:canonicalSignature(request),productIds:[...changed],purchaseId:purchase?.id||null,supplierId:supplier?.id||null,time:request.time}
  if(isProcurement(purchase)){receipt.purchaseVersion=purchase.procurement.revision;receipt.document=procurementEvent(purchase,request)}
  if(cashLog)receipt.cashLogId=cashLog.id
  return {receipt,products:[...changed].map(id=>products.get(id)),created:[...created],purchase,supplier,cashLog,createPurchase:request.kind==='purchase-create'}
}
export function inventoryReceipt(request,row,data){
  if(row.signature!==canonicalSignature(request))throw Object.assign(Error('原操作編號已存在且內容不同，請核對已建立單據；新單請重新整理草稿'),{operationConflict:true})
  if(!Array.isArray(row.productIds)||!row.productIds.length&&!PROCUREMENT_KINDS.includes(request.kind))throw Error('庫存異動編號內容不一致')
  const products=row.productIds.map(id=>data.products.find(p=>p.id===id))
  if(products.some(p=>!p))throw Error('原異動商品已不存在，請先核對')
  if(row.purchaseId&&!data.purchases.some(p=>p.id===row.purchaseId)||row.supplierId&&!data.suppliers.some(s=>s.id===row.supplierId))throw Error('原異動進貨單或供應商已不存在，請先核對')
  const purchase=row.purchaseId?data.purchases.find(p=>p.id===row.purchaseId):null
  if(row.document){validateProcurement(purchase);if(!isProcurement(purchase)||purchase.procurement.revision<row.purchaseVersion||canonicalSignature(procurementEvent(purchase,request))!==canonicalSignature(row.document))throw Error('採購歷史文件缺失，請保留原編號核對')}
  const cashLog=row.cashLogId?data.cashLogs?.find(l=>l.id===row.cashLogId):null
  if(row.cashLogId&&!cashLog)throw Error('原付款現金流水已不存在，請保留原編號核對')
  return {success:true,receipt:row,products,purchase,supplier:row.supplierId?data.suppliers.find(s=>s.id===row.supplierId):null,cashLog}
}
