import {amount,amountUnits,cents,units,allocateCents} from './procurementAmounts.mjs'
import {purchaseLineCents} from './purchaseUnitPricing.mjs'

export function beginProcurementValuation(po){
  const p=po.procurement
  if(!p.valuation){
    const order=[...p.receipts,...p.bills].map(r=>r.id)
    p.valuation={version:1,legacyCount:order.length,order}
  }
  p.returns??=[]
}
export function appendValuation(po,id){if(po.procurement.valuation)po.procurement.valuation.order.push(id)}
export function allocationFor(bucket,quantities){
  if(!Array.isArray(quantities)||quantities.length!==bucket.qty.length||!quantities.some(q=>q>0))throw Error('請填寫本次數量')
  return quantities.map((q,i)=>allocateCents(q,bucket.qty[i],bucket.value[i]))
}
export function valuationState(po){
  const p=po.procurement,v=p.valuation,size=po.items.length,zero=()=>Array(size).fill(0)
  if(!v||v.version!==1||!Array.isArray(v.order)||!Number.isSafeInteger(v.legacyCount)||v.legacyCount<0||v.legacyCount>v.order.length)throw Error('採購成本分配順序不正確')
  const groups=['receipts','bills','returns'],events=new Map()
  for(const group of groups)for(const r of p[group]||[]){if(events.has(r.id))throw Error('採購文件編號重複');events.set(r.id,{group,r})}
  if(new Set(v.order).size!==v.order.length||v.order.length!==events.size)throw Error('採購成本分配文件缺失或重複')
  const legacy=[...p.receipts.filter(r=>v.order.indexOf(r.id)<v.legacyCount),...p.bills.filter(r=>v.order.indexOf(r.id)<v.legacyCount)].map(r=>r.id)
  if(legacy.length!==v.legacyCount||legacy.some((id,i)=>id!==v.order[i]))throw Error('歷史採購成本分配順序不正確')
  const gross=zero(),legacyBilled=zero(),unbilled={qty:zero(),value:zero()},bills=new Map(),amounts=new Map()
  for(const [position,id] of v.order.entries()){
    const event=events.get(id);if(!event)throw Error('採購成本分配文件不存在')
    const {group,r}=event,qs=r.quantities
    if(!Array.isArray(qs)||qs.length!==size||!qs.some(q=>q>0))throw Error('採購文件數量不正確')
    let values
    if(group==='receipts'){
      values=qs.map((q,i)=>{const total=units(gross[i])+units(q);if(total>units(po.items[i].qty))throw Error('採購收貨超額');const value=purchaseLineCents(po.items[i],amountUnits(total))-purchaseLineCents(po.items[i],gross[i]);gross[i]=amountUnits(total);unbilled.qty[i]=amountUnits(units(unbilled.qty[i])+units(q));unbilled.value[i]+=value;return value})
    }else{
      const bucket=group==='bills'||!r.invoiceId?unbilled:bills.get(r.invoiceId)
      if(!bucket)throw Error('退貨缺少原請款單')
      values=allocationFor(bucket,qs)
      if(position<v.legacyCount){
        if(group!=='bills')throw Error('歷史分配不可包含退貨')
        values=qs.map((q,i)=>{const total=amountUnits(units(legacyBilled[i])+units(q)),value=purchaseLineCents(po.items[i],total)-purchaseLineCents(po.items[i],legacyBilled[i]);legacyBilled[i]=total;return value})
      }
      values.forEach((value,i)=>{if(value>bucket.value[i])throw Error('採購成本分配超額');bucket.qty[i]=amountUnits(units(bucket.qty[i])-units(qs[i]));bucket.value[i]-=value})
      if(group==='bills')bills.set(id,{qty:[...qs],value:[...values]})
    }
    if(cents(r.amount)!==values.reduce((n,value)=>n+value,0))throw Error('採購文件金額與成本分配不符')
    amounts.set(id,values)
  }
  return {gross,unbilled,bills,amounts}
}
export function availableForReturn(po,invoiceId=''){
  // Work on a copy so merely showing a dialog cannot migrate or mutate history.
  const copy=structuredClone(po);beginProcurementValuation(copy)
  const state=valuationState(copy),bucket=invoiceId?state.bills.get(invoiceId):state.unbilled
  if(!bucket)throw Error('退貨缺少原請款單')
  return {quantities:[...bucket.qty],amount:amount(bucket.value.reduce((n,v)=>n+v,0))}
}
export function quoteProcurementAllocation(po,quantities,invoiceId=''){
  const copy=structuredClone(po);beginProcurementValuation(copy)
  const state=valuationState(copy),bucket=invoiceId?state.bills.get(invoiceId):state.unbilled
  if(!bucket)throw Error('退貨缺少原請款單')
  return amount(allocationFor(bucket,quantities).reduce((n,v)=>n+v,0))
}
