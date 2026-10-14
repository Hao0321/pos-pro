// Shared drawer ledger: each receipt stays in the shift where money moved.
export function summarizeShift(shift, orders, cashLog,topups=[]) {
  const cents=(n,label)=>{
    if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1e9)throw Error(label+'紀錄需要核對')
    return Math.round(n*100)
  }
  if(!shift?.id || !Array.isArray(orders) || !Array.isArray(cashLog))throw Error('班別資料需要核對')
  const valid=orders.filter(o=>o.shiftId===shift.id && o.source!=='customer' && ['cash','card','mixed'].includes(o.payMethod) && (!o.status||['completed','refunded'].includes(o.status)))
  let cash=0,card=0,refundAmount=0,refundCount=0,orderCount=0
  for(const o of valid){
    const total=cents(o.total,'收款金額')
    if(o.refundOf){refundCount++;refundAmount+=Math.abs(total)}else orderCount++
    if(o.payMethod==='mixed'){
      let payments=o.payments
      if(typeof payments==='string')try{payments=JSON.parse(payments)}catch{throw Error('混合付款紀錄需要核對')}
      if(!Array.isArray(payments)||!payments.length||payments.length>2)throw Error('混合付款紀錄需要核對')
      let sum=0;const seen=new Set()
      for(const p of payments){
        if(!p||!['cash','card'].includes(p.method)||seen.has(p.method))throw Error('混合付款紀錄需要核對')
        seen.add(p.method);const n=cents(p.amount,'付款明細');sum+=n
        if((total>=0&&n<0)||(total<0&&n>0))throw Error('混合付款正負金額需要核對')
        if(p.method==='cash')cash+=n;else card+=n
      }
      if(sum!==total)throw Error('混合付款合計與收款金額不一致')
    }else if(o.payMethod==='cash')cash+=total
    else card+=total
  }
  let cashIn=0,cashOut=0
  for(const log of cashLog.filter(l=>l.shiftId===shift.id)){
    if(!['in','out'].includes(log.type))throw Error('現金流水類型需要核對')
    const n=cents(log.amount,'現金流水');if(n<0)throw Error('現金流水不可為負數')
    if(log.type==='in')cashIn+=n;else cashOut+=n
  }
  const open=cents(shift.openCash??0,'開班現金');if(open<0)throw Error('開班現金不可為負數')
  let cashTopups=0,cardTopups=0
  for(const t of topups.filter(t=>t.shiftId===shift.id)){
    const n=cents(t.amount,'儲值款項');if(n<0||!['cash','card'].includes(t.payMethod))throw Error('儲值款項需要核對')
    if(t.payMethod==='cash')cashTopups+=n;else cardTopups+=n
  }
  return {orderCount,refundCount,refundAmt:refundAmount/100,cash:cash/100,card:card/100,cashIn:cashIn/100,cashOut:cashOut/100,cashTopups:cashTopups/100,cardTopups:cardTopups/100,expected:(open+cash+cashIn-cashOut+cashTopups)/100}
}
