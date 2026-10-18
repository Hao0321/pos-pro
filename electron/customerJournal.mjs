import {salesCents,salesAmount} from './salesRules.mjs'
const line=(account,debit=0,credit=0)=>({account,debit,credit})
export function customerLedgerToJournalEntries(entries=[]){
  return entries.flatMap(event=>{
    if(['customer-create','customer-update'].includes(event.action))return []
    const money=event.amount,cash=event.method==='cash'?'1101':'1103'
    // A carried credit already reduced AR at cut-over. Its allocation only
    // links two claims in the same control account; it is not a cash advance.
    if(event.fundingKind==='opening-credit'&&['allocate','unallocate'].includes(event.action)){if(salesCents(money)<=0)throw Error('原單貸項抵付金額不正確');return []}
    const descriptions={receive:'客戶預收款',allocate:'預收款抵付應收',unallocate:'解除客戶抵付',refund:'退回客戶預收款','refund-reverse':'客戶預收退款更正','receipt-reverse':'客戶預收款沖銷'}
    const pairs={receive:[line(cash,money),line('2192',0,money)],allocate:[line('2192',money),line('1141',0,money)],unallocate:[line('1141',money),line('2192',0,money)],refund:[line('2192',money),line(cash,0,money)],'refund-reverse':[line(cash,money),line('2192',0,money)],'receipt-reverse':[line('2192',money),line(cash,0,money)]}
    const lines=pairs[event.action]
    if(event.fundingKind==='opening-credit'){
      if(!['refund','refund-reverse'].includes(event.action)||!['cash','bank'].includes(event.method))throw Error('原單貸項退款分錄不正確')
      for(const row of lines||[])if(row.account==='2192')row.account='1141'
    }
    if(!lines||!Number.isFinite(money)||money<=0||lines.reduce((n,row)=>n+salesCents(row.debit)-salesCents(row.credit),0)!==0)throw Error('客戶款項分錄不正確')
    return [{id:'JC-'+event.id,customerId:event.customerId,date:event.date,type:'auto_customer_ledger',description:descriptions[event.action]+' · '+event.customerName+' · '+event.customerId,descriptionKey:descriptions[event.action]+' · {0} · {1}',descriptionValues:{0:event.customerName,1:event.customerId},lines}]
  })
}
