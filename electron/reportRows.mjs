import {validateSalesDocument,salesDate} from './salesRules.mjs'
import {isProcurement,validateProcurement} from './procurementRules.mjs'
import {reservationDepositsToCashFlows} from './reservationDepositJournal.mjs'
import {summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {journalLineCents,centsNumber} from './journalAmounts.mjs'

// Read-only report projections. These are never saved as POS checkouts, used
// for member rewards, sent to a payment provider or written back to inventory.
export function businessReportRows(documents=[]){
  return documents.flatMap(doc=>{
    validateSalesDocument(doc)
    return [...doc.deliveries,...doc.returns,...doc.allowances].map(event=>{
      const delivery=event.action==='deliver',sign=delivery?1:-1
      const items=doc.items.map((item,index)=>({id:item.productId,name:item.name,unit:item.unit,
        qty:delivery?event.quantities[index]:event.action==='return'?-event.quantities[index]:0,
        price:item.unitPrice,reportRevenue:sign*event.amounts[index]}))
      const itemCosts=Object.fromEntries(items.map((item,index)=>[item.id,item.qty===0||event.action==='allowance'||event.action==='return'&&!event.restock?0:event.costAmounts[index]/Math.abs(item.qty)]))
      return {id:'business-report:'+event.id,source:'business-report',businessDocumentId:doc.id,businessDate:event.date,time:event.time,
        total:sign*event.amount,balanceUsed:0,payMethod:'receivable',status:'completed',cashier:event.actor.username,items,itemCosts,
        ...(delivery?{}:{refundOf:'business-report:'+event.deliveryId})}
    })
  })
}
export const reportDay=row=>row.businessDate||salesDate(row.time)
export const reportLineRevenue=item=>Number.isFinite(item.reportRevenue)?item.reportRevenue:item.price*item.qty
export function cashFlowTotals(rows){
 const values={cash:0n,card:0n,bank:0n}
 for(const row of rows){const method=row.method==='cash'?'cash':row.method==='bank'?'bank':'card';values[method]+=journalLineCents({}, {debit:row.amount},'debit')}
 const total=values.cash+values.card+values.bank
 // Approximate Number values are for chart proportions only; rendered money
 // uses the exact cent strings, including totals above numeric precision.
 return {...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,centsNumber(value)])),total:centsNumber(total),exact:{...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.toString()])),total:total.toString()}}
}
export function businessCashFlows(documents=[],customerEntries=[],purchases=[],supplierEntries=[],reservationEntries=[],restaurantEntries=[]){
  return [...documents.flatMap(doc=>{
    validateSalesDocument(doc)
    return [...doc.payments,...doc.paymentReversals,...doc.refunds,...doc.refundReversals].map(event=>({
      id:event.id,date:event.date,time:event.time,method:event.method,
      amount:(['pay','refund-reverse'].includes(event.action)?1:-1)*event.amount,
    }))
  }),...customerEntries.filter(event=>['receive','refund','refund-reverse','receipt-reverse'].includes(event.action)).map(event=>({id:event.id,date:event.date,time:event.time,method:event.method,amount:(['receive','refund-reverse'].includes(event.action)?1:-1)*event.amount})),
  ...purchases.filter(isProcurement).flatMap(po=>{validateProcurement(po);return [['payments',-1],['reversals',1],['refunds',1],['refundReversals',-1]].flatMap(([group,sign])=>(po.procurement[group]||[]).map(event=>({id:event.id,date:event.date,time:event.time,method:event.method,amount:sign*event.amount})))}),
  ...supplierEntries.filter(event=>['pay','refund','refund-reverse','pay-reverse'].includes(event.action)).map(event=>({id:event.id,date:event.date,time:event.time,method:event.method,amount:(['refund','pay-reverse'].includes(event.action)?1:-1)*event.amount})),
  ...reservationDepositsToCashFlows(reservationEntries),
  ...restaurantEntries.flatMap(entry=>{if(!entry.funds)return [];summarizeRestaurantFunds(entry.funds);return entry.funds.events.flatMap(event=>event.input.action==='funds-receive'?[{id:event.id,date:event.date,time:event.time,method:event.input.payMethod,amount:event.amountCents/100}]:event.refunds.map((source,index)=>({id:event.id+':'+index,date:event.date,time:event.time,method:source.method,amount:-source.amountCents/100})))})]
}
