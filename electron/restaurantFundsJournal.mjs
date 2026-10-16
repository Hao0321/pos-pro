import {summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {expectedRestaurantFundedPostings,sameRestaurantFundedOrder} from './restaurantFundedPlan.mjs'

// F3: collection/refund changes cash and the contract liability. The separate
// funded fulfilment order recognizes revenue; it cannot collect cash again.
export function restaurantFundsToJournalEntries(entries=[]){
  return entries.flatMap(entry=>{
    if(!entry.funds)return []
    summarizeRestaurantFunds(entry.funds)
    return entry.funds.events.flatMap(event=>{
      const receiving=event.input.action==='funds-receive'
      if(!event.amountCents)return []
      const rows=receiving?[{method:event.input.payMethod,amountCents:event.amountCents}]:event.refunds
      const amount=event.amountCents/100
      const lines=receiving?
        [...rows.map(row=>({account:row.method==='cash'?'1101':'1103',debit:row.amountCents/100,credit:0})),{account:'2193',debit:0,credit:amount}]:
        [{account:'2193',debit:amount,credit:0},...rows.map(row=>({account:row.method==='cash'?'1101':'1103',debit:0,credit:row.amountCents/100}))]
      return [{id:'JRF-'+event.id,orderId:entry.id,date:event.date,type:'auto_restaurant_funds',description:(receiving?'餐飲預收款':'餐飲退回款')+' · '+entry.id,descriptionKey:(receiving?'餐飲預收款':'餐飲退回款')+' · {0}',descriptionValues:{0:entry.id},lines}]
    })
  })
}
export function restaurantFundedOrderToJournalEntries(order,entry){
  if(order?.source!=='restaurant-funded'||!entry?.funds)throw Error('餐飲交付分錄缺少一致的原單來源。')
  const posting=expectedRestaurantFundedPostings(entry).find(row=>row.order.id===order.id)
  if(!posting||!sameRestaurantFundedOrder(posting.order,order))throw Error('餐飲交付分錄缺少一致的原單來源。')
  const costCents=order.items.reduce((sum,item)=>sum+BigInt(Math.round(order.itemCosts[item.id]*100))*BigInt(item.qty),0n)
  const rows=[{id:'J'+order.id+'_rev',orderId:order.id,date:posting.date,type:'auto_restaurant_sale',description:'餐飲交付收入 · '+entry.id,descriptionKey:'餐飲交付收入 · {0}',descriptionValues:{0:entry.id},lines:[{account:'2193',debit:order.total,credit:0},{account:'4101',debit:0,credit:order.total}]}]
  if(costCents)rows.push({id:'J'+order.id+'_cogs',orderId:order.id,date:posting.date,type:'auto_cogs',description:'餐飲交付成本 · '+entry.id,descriptionKey:'餐飲交付成本 · {0}',descriptionValues:{0:entry.id},lines:[{account:'5101',debit:Number(costCents)/100,credit:0},{account:'1211',debit:0,credit:Number(costCents)/100}]})
  return rows
}
