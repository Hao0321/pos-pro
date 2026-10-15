import {salesCents,salesAmount,validateSalesDocument} from './salesRules.mjs'
const line=(account,debit=0,credit=0)=>({account,debit,credit})
export function salesToJournalEntries(doc){
  validateSalesDocument(doc)
  const entries=[],push=(event,suffix,description,lines)=>{
    if(!lines.some(l=>l.debit||l.credit))return
    if(lines.reduce((n,l)=>n+salesCents(l.debit)-salesCents(l.credit),0)!==0)throw Error('銷售分錄借貸不平衡')
    entries.push({id:'JS-'+event.id+'-'+suffix,orderId:doc.id,date:event.date,description:description+' · '+doc.customer.name+' · '+doc.id,descriptionKey:description+' · {0} · {1}',descriptionValues:{0:doc.customer.name,1:doc.id},type:'auto_business_sale',lines})
  }
  for(const d of doc.deliveries){
    push(d,'revenue','交付與客戶應收',[line('1141',d.amount),line('4101',0,d.amount)])
    push(d,'cost','交付成本',[line('5101',d.costTotal),line('1211',0,d.costTotal)])
  }
  for(const p of doc.payments)push(p,'payment','客戶收款',[line(p.method==='cash'?'1101':'1103',p.amount),line('1141',0,p.amount)])
  for(const r of doc.paymentReversals)push(r,'reverse','客戶收款更正',[line('1141',r.amount),line(r.method==='cash'?'1101':'1103',0,r.amount)])
  for(const r of doc.returns){
    push(r,'credit','客戶退貨折抵',[line('4101',r.amount),line('1141',0,r.amount)])
    if(r.restock)push(r,'cost-return','退貨回庫原成本',[line('1211',r.costTotal),line('5101',0,r.costTotal)])
  }
  for(const a of doc.allowances)push(a,'allowance','客戶折讓',[line('4101',a.amount),line('1141',0,a.amount)])
  for(const r of doc.refunds)push(r,'refund','退回客戶多收款',[line('1141',r.amount),line(r.method==='cash'?'1101':'1103',0,r.amount)])
  for(const r of doc.refundReversals)push(r,'refund-reverse','客戶退款更正',[line(r.method==='cash'?'1101':'1103',r.amount),line('1141',0,r.amount)])
  return entries
}
export function salesDayMetrics(documents,day){
  const rows=documents.flatMap(salesToJournalEntries).filter(entry=>entry.date===day)
  const balance=account=>rows.flatMap(row=>row.lines).filter(line=>line.account===account).reduce((n,line)=>n+salesCents(line.credit)-salesCents(line.debit),0)
  const revenue=balance('4101'),cost=-balance('5101')
  return {revenue:salesAmount(Math.abs(revenue))*Math.sign(revenue),profit:Math.round((revenue-cost))/100,deliveries:documents.reduce((n,doc)=>n+doc.deliveries.filter(d=>d.date===day).length,0)}
}
