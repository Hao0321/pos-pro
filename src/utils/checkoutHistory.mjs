// A refunded sale still proves its original collection. Keep the current sale
// status and require the complete cumulative refund ledger before acknowledging
// an old pending checkout. This never applies sale/refund deltas.
export function assertFullRefund(original,refunds){
  const invalid=()=>{throw Error('已退款訂單缺少完整的退款紀錄，請保留原單號核對。')}
  if(original?.status!=='refunded'||original.refundOf||original.source&&original.source!=='pos'||!Array.isArray(refunds)||!refunds.length||refunds.length>10000)invalid()
  const cents=n=>Math.round(n*100),milli=n=>Math.round(n*1000)
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9
  const items=new Map(original.items.map(i=>[i.id,{item:i,qty:0}]))
  const fields=['subtotal','total','discount','manualDiscount','balanceUsed','pointsUsed','pointsEarned'],sums=Object.fromEntries(fields.map(k=>[k,0]))
  const payments=new Map(original.payments.map(p=>[p.method,0])),ids=new Set()
  for(const refund of refunds){
    if(!refund||typeof refund.id!=='string'||ids.has(refund.id)||refund.id===original.id||refund.refundOf!==original.id||refund.status!=='completed'||refund.source&&refund.source!=='pos'||!Array.isArray(refund.items)||!refund.items.length||!Array.isArray(refund.payments))invalid()
    ids.add(refund.id);const seen=new Set()
    for(const item of refund.items){
      const row=items.get(item.id)
      if(!row||seen.has(item.id)||!finite(item.qty)||item.qty>=0||Math.abs(item.qty*1000-milli(item.qty))>1e-6||item.price!==row.item.price||item.name!==row.item.name)invalid()
      seen.add(item.id);row.qty-=milli(item.qty)
    }
    for(const key of fields){const value=refund[key]??0;if(!finite(value)||value>0||key.startsWith('points')&&!Number.isSafeInteger(value))invalid();sums[key]+=key.startsWith('points')?value:cents(value)}
    const methods=new Set()
    for(const payment of refund.payments){if(!payments.has(payment.method)||methods.has(payment.method)||!finite(payment.amount)||payment.amount>0)invalid();methods.add(payment.method);payments.set(payment.method,payments.get(payment.method)+cents(payment.amount))}
  }
  if([...items.values()].some(row=>row.qty!==milli(row.item.qty))||fields.some(key=>sums[key]!==-(key.startsWith('points')?(original[key]??0):cents(original[key]??0)))||original.payments.some(p=>payments.get(p.method)!==-cents(p.amount)))invalid()
}
