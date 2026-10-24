import {moneyValue,quantityValue} from './operationRules.mjs'
import {summarizeRestaurantFunds} from './restaurantFunds.mjs'

const cents=value=>BigInt(Math.round(moneyValue(value,'原料成本')*100))
const units=value=>BigInt(Math.round(quantityValue(value,'原料數量',.001)*1000))
const rounded=value=>(value+500n)/1000n
const number=value=>{if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<0n)throw Error('餐點參考成本需要核對');return Number(value)}
// Reference estimates are separate from actual FIFO. Keep the remaining order's
// rounded value; every cancellation receives only the change from that value.
// This makes successive partial refunds/losses telescope to the original cent.
export function restaurantMenuReferenceEvents(entry){
 if(!entry.menu||!entry.funds)return null
 summarizeRestaurantFunds(entry.funds)
 const counts=new Map(entry.funds.items.map(item=>[item.id,item.qty]))
 const each=new Map(entry.funds.itemAllocations.map(row=>[row.itemId,row.rows.reduce((sum,raw)=>sum+cents(raw.unitCost)*units(raw.qty),0n)]))
 const total=()=>[...counts].reduce((sum,[id,qty])=>sum+each.get(id)*BigInt(qty),0n)
 const result=new Map();let delivered=false
 for(const event of entry.funds.events){
  let recognitionCents=null,wasteCents=[]
  if(['cancel','cancel-part'].includes(event.input.action)){
   const before=rounded(total())
   for(const item of event.cancelledItems)counts.set(item.id,counts.get(item.id)-item.qty)
   const delta=before-rounded(total())
   if(delivered)recognitionCents=-number(delta)
   if(event.prepared){
    const weights=event.allocations.map(row=>cents(row.unitCost)*units(row.qty)),weight=weights.reduce((sum,row)=>sum+row,0n)
    let prefix=0n,previous=0n
    wasteCents=weights.map(row=>{prefix+=row;const next=weight?(delta*prefix+weight/2n)/weight:0n,value=next-previous;previous=next;return number(value)})
    if(wasteCents.reduce((sum,row)=>sum+row,0)!==number(delta))throw Error('餐點參考成本需要核對')
   }
  }
  if(event.fulfilment){recognitionCents=number(rounded(total()));delivered=true}
  result.set(event.id,{recognitionCents,wasteCents})
 }
 return result
}
