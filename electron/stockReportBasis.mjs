import {stockUnits} from './stockBusinessPlan.mjs'

// Prefix rounding gives every cent to one output, including negative reversals.
export function splitReportCents(value,weights){
 const amount=BigInt(value),total=weights.reduce((sum,row)=>sum+BigInt(row.weight),0n)
 if(weights.some(row=>BigInt(row.weight)<0n)||total<=0n)throw Error('成本分攤需要核對')
 let prefix=0n,previous=0n
 return weights.map(row=>{prefix+=BigInt(row.weight);const absolute=amount<0n?-amount:amount,next=(absolute*prefix+total/2n)/total,result=(next-previous)*(amount<0n?-1n:1n);previous=next;return {...row,amountCents:result.toString()}})
}

// Captured by the trusted transaction, never accepted from an Agent or renderer.
// Older multi-menu entries deliberately keep an unallocated cost.
export function captureRestaurantCostBasis(entry,config){
 const materials=new Map()
 for(const item of entry.items){
  if(!Number.isSafeInteger(item.qty)||item.qty<=0)throw Error('成本分攤需要核對')
  const recipe=entry.menu?entry.menu.quote.itemAllocations.find(row=>row.itemId===item.id)?.rows:config.recipes?.[item.id]||[{id:item.id,qty:1}]
  if(!recipe)throw Error('成本分攤需要核對')
  for(const raw of recipe){
   const quantity=BigInt(stockUnits(raw.qty))*BigInt(item.qty),row=materials.get(raw.id)||{productId:raw.id,totalUnits:0n,outputs:new Map()}
   row.totalUnits+=quantity;row.outputs.set(item.id,(row.outputs.get(item.id)||0n)+quantity);materials.set(raw.id,row)
  }
 }
 if(materials.size!==entry.allocations.length)throw Error('成本分攤需要核對')
 return {version:1,policy:'recipe-share-prefix/v1',materials:entry.allocations.map(raw=>{
  const row=materials.get(raw.id)
  if(!row||row.totalUnits!==BigInt(stockUnits(raw.qty)))throw Error('成本分攤需要核對')
  return {productId:raw.id,totalUnits:row.totalUnits.toString(),outputs:[...row.outputs].map(([productId,quantity])=>({productId,quantityUnits:quantity.toString()}))}
 })}
}

export function restaurantCostShares(entry,basis,productId,value){
 const material=basis?.version===1&&basis.policy==='recipe-share-prefix/v1'&&basis.materials.find(row=>row.productId===productId)
 if(material){
  if(material.outputs.reduce((sum,row)=>sum+BigInt(row.quantityUnits),0n)!==BigInt(material.totalUnits)||material.outputs.some(row=>!entry.items.some(item=>item.id===row.productId)))throw Error('成本分攤需要核對')
  return splitReportCents(value,material.outputs.map(row=>({productId:row.productId,weight:row.quantityUnits})))
 }
 if(entry?.items?.length===1)return [{productId:entry.items[0].id,amountCents:BigInt(value).toString()}]
 return [{productId:null,amountCents:BigInt(value).toString(),pendingTargets:entry?.items?.map(row=>row.id)||[]}]
}
