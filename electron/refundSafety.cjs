// Refund amounts come from the persisted sale and cumulative previous refunds.
// Round cumulative allocations, then subtract amounts already returned.
function amount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) throw new Error('退款金額資料不正確')
  return Math.round(value * 100)
}
function quantity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e6 || Math.abs(value*1000-Math.round(value*1000))>1e-6) throw new Error('退貨數量必須為正數，最多三位小數')
  return Math.round(value*1000)
}
function refundSignature(request) {
  return JSON.stringify({refundOf:request.refundOf,items:request.items.map(i=>({id:i.id,qty:i.qty})).sort((a,b)=>a.id.localeCompare(b.id)),
    reason:request.reason||'',cashier:request.cashier||'',shiftId:request.shiftId||''})
}
function prepareRefund(original, previous, request, member) {
  if (!original || original.refundOf || original.status !== 'completed' || (original.source && original.source !== 'pos')) throw new Error('原始收款訂單不存在或已退完')
  if (request.refundOf !== original.id || typeof request.id !== 'string' || !request.id || request.id.length>128 || !Array.isArray(request.items) || !request.items.length || request.items.length>1000) throw new Error('退貨要求不正確')
  const originalItems = new Map(original.items.map(i=>[i.id,i]))
  if (originalItems.size !== original.items.length) throw new Error('原始訂單明細重複，請先核對')
  const previousQty = new Map()
  for (const refund of previous) for (const item of refund.items) previousQty.set(item.id,(previousQty.get(item.id)||0)+quantity(Math.abs(item.qty)))
  const seen=new Set(), items=request.items.map(i=>{
    const orig=originalItems.get(i.id)
    if (!orig || seen.has(i.id)) throw new Error('退貨商品不存在或重複')
    seen.add(i.id)
    const q=quantity(i.qty), sold=quantity(orig.qty), returned=previousQty.get(i.id)||0
    if (q+returned>sold) throw new Error('退貨數量超過剩餘可退數量')
    return {id:orig.id,name:orig.name,price:orig.price,qty:-q/1000}
  })
  const fullRefund=original.items.every(i=>(previousQty.get(i.id)||0)+Math.round(Math.abs(items.find(x=>x.id===i.id)?.qty||0)*1000) >= quantity(i.qty))
  const originalWeight=original.items.reduce((s,i)=>s+amount(i.price*i.qty),0)
  const totalWeight=original.items.reduce((s,i)=>s+amount(i.price*((previousQty.get(i.id)||0)/1000+Math.abs(items.find(x=>x.id===i.id)?.qty||0))),0)
  const ratio=fullRefund ? 1 : originalWeight ? totalWeight/originalWeight : 0
  if (!Number.isFinite(ratio) || ratio<0 || ratio>1+1e-8) throw new Error('退款比例不正確')
  function allocate(key, integer=false) {
    const total=integer ? (original[key]||0) : amount(original[key]||0)
    if (!Number.isSafeInteger(total) || total<0) throw new Error('原始訂單金額或點數不正確')
    const returned=previous.reduce((s,o)=>s+(integer?Math.abs(o[key]||0):amount(Math.abs(o[key]||0))),0)
    const result=Math.round(total*Math.min(1,ratio))-returned
    if (result<0 || result>total-returned) throw new Error('先前退款資料不一致，請先核對')
    return integer ? result : result/100
  }
  const total=allocate('total'),balance=allocate('balanceUsed'),discount=allocate('discount'),manual=allocate('manualDiscount')
  const pointsUsed=allocate('pointsUsed',true),pointsEarned=allocate('pointsEarned',true)
  let pays=typeof original.payments==='string'?JSON.parse(original.payments):original.payments
  if (!Array.isArray(pays)||!pays.length) pays=[{method:original.payMethod,amount:original.total}]
  if (pays.some(p=>!['cash','card'].includes(p.method)) || pays.reduce((s,p)=>s+amount(p.amount),0)!==amount(original.total)) throw new Error('原始付款明細不一致')
  const payments=pays.map((p,index)=>{
    const returned=previous.reduce((s,o)=>s+(o.payments||[]).filter(x=>x.method===p.method).reduce((n,x)=>n+amount(Math.abs(x.amount)),0),0)
    const target=index===pays.length-1 ? amount(total)-pays.slice(0,index).reduce((s,q)=>s+Math.round(amount(q.amount)*Math.min(1,ratio))-previous.reduce((n,o)=>n+(o.payments||[]).filter(x=>x.method===q.method).reduce((m,x)=>m+amount(Math.abs(x.amount)),0),0),0) : Math.round(amount(p.amount)*Math.min(1,ratio))-returned
    if (target<0 || target>amount(p.amount)-returned) throw new Error('原始付款分攤不一致')
    return {method:p.method,amount:-target/100}
  })
  if (original.memberId && !member) throw new Error('原單會員已不存在，請先核對退款')
  const spent=Math.max(0,(member?.totalSpent||0)-total)
  const order={id:request.id,refundOf:original.id,items,subtotal:-(total+balance+discount+manual),discount:-discount,
    manualDiscount:-manual,balanceUsed:-balance,total:-total,paid:-total,change:0,payMethod:original.payMethod,payments,
    memberId:original.memberId||null,pointsUsed:-pointsUsed,pointsEarned:-pointsEarned,time:request.time,
    status:'completed',source:'pos',fullRefund,note:String(request.reason||'').slice(0,1000),cashier:String(request.cashier||'').slice(0,128),shiftId:request.shiftId||'',
    requestSignature:refundSignature(request),itemCosts:original.itemCosts||{}}
  if (!Number.isFinite(new Date(request.time).getTime())) throw new Error('退款時間不正確')
  return {order,stockUpdates:items.map(i=>({id:i.id,delta:-i.qty})),member:member?{...member,
    points:Math.max(0,(member.points||0)-pointsEarned+pointsUsed),balance:(member.balance||0)+balance,totalSpent:spent,
    tier:spent>=30000?'gold':spent>=10000?'silver':'normal'}:null}
}

module.exports={prepareRefund,refundSignature}
