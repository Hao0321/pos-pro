import {canonicalSignature} from './operationRules.mjs'

// One model for native SQLite, the standalone browser and refund previews.
// Allocate cumulative integer cents/points, then subtract actual old refunds.
function cents(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9)throw Error('退款金額資料不正確')
  return Math.round(value*100)
}
function units(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e6||Math.abs(value*1000-Math.round(value*1000))>1e-6)throw Error('退貨數量必須為正數，最多三位小數')
  return Math.round(value*1000)
}
const roundRatio=(value,numerator,denominator)=>Number((2n*BigInt(value)*numerator+denominator)/(2n*denominator))
// The common 1/1000 denominator cancels in the ratio. Do not round a
// fractional line's weight before allocating the final financial cents.
const lineCents=(price,quantityUnits)=>BigInt(cents(price))*BigInt(quantityUnits)
export function refundSignature(request){
  return JSON.stringify({refundOf:request.refundOf,items:request.items.map(row=>({id:row.id,qty:row.qty})).sort((a,b)=>a.id.localeCompare(b.id)),
    reason:request.reason||'',cashier:request.cashier||'',shiftId:request.shiftId||'',...(request.review===undefined?{}:{review:JSON.parse(canonicalSignature(request.review))})})
}
export function prepareRefund(original,previous,request,member){
  if(!original||original.refundOf||original.status!=='completed'||original.source&&original.source!=='pos')throw Error('原始收款訂單不存在或已退完')
  if(request.refundOf!==original.id||typeof request.id!=='string'||!request.id||request.id.length>128||!Array.isArray(request.items)||!request.items.length||request.items.length>1000)throw Error('退貨要求不正確')
  const originals=new Map(original.items.map(row=>[row.id,row])),sold=new Map(original.items.map(row=>[row.id,units(row.qty)])),returned=new Map()
  if(originals.size!==original.items.length)throw Error('原始訂單明細重複，請先核對')
  for(const refund of previous)for(const row of refund.items)returned.set(row.id,(returned.get(row.id)||0)+units(Math.abs(row.qty)))
  for(const [id,count]of returned)if(!sold.has(id)||count>sold.get(id))throw Error('先前退款資料不一致，請先核對')
  const selected=new Map(),items=request.items.map(row=>{
    const source=originals.get(row.id),count=units(row.qty)
    if(!source||selected.has(row.id))throw Error('退貨商品不存在或重複')
    if(count+(returned.get(row.id)||0)>sold.get(row.id))throw Error('退貨數量超過剩餘可退數量')
    selected.set(row.id,count);return {id:source.id,name:source.name,price:source.price,qty:-count/1000}
  })
  const fullRefund=original.items.every(row=>(returned.get(row.id)||0)+(selected.get(row.id)||0)===sold.get(row.id))
  const originalWeight=original.items.reduce((sum,row)=>sum+lineCents(row.price,sold.get(row.id)),0n)
  const totalWeight=original.items.reduce((sum,row)=>sum+lineCents(row.price,(returned.get(row.id)||0)+(selected.get(row.id)||0)),0n)
  const numerator=fullRefund?1n:totalWeight,denominator=fullRefund?1n:originalWeight||1n
  if(numerator<0n||numerator>denominator)throw Error('退款比例不正確')
  function allocated(key,points=false){
    const total=points?(original[key]||0):cents(original[key]||0)
    if(!Number.isSafeInteger(total)||total<0)throw Error('原始訂單金額或點數不正確')
    const old=previous.reduce((sum,row)=>sum+(points?Math.abs(row[key]||0):cents(Math.abs(row[key]||0))),0)
    const result=roundRatio(total,numerator,denominator)-old
    if(!Number.isSafeInteger(old)||result<0||result>total-old)throw Error('先前退款資料不一致，請先核對')
    return result
  }
  const total=allocated('total'),balance=allocated('balanceUsed'),discount=allocated('discount'),manual=allocated('manualDiscount'),pointsUsed=allocated('pointsUsed',true),pointsEarned=allocated('pointsEarned',true)
  let originalPayments=typeof original.payments==='string'?JSON.parse(original.payments):original.payments
  if(!Array.isArray(originalPayments)||!originalPayments.length)originalPayments=[{method:original.payMethod,amount:original.total}]
  if(originalPayments.some(row=>!['cash','card'].includes(row.method))||new Set(originalPayments.map(row=>row.method)).size!==originalPayments.length||originalPayments.reduce((sum,row)=>sum+cents(row.amount),0)!==cents(original.total))throw Error('原始付款明細不一致')
  const already=method=>previous.reduce((sum,refund)=>sum+(refund.payments||[]).filter(p=>p.method===method).reduce((n,p)=>n+cents(Math.abs(p.amount)),0),0)
  let allocatedPayments=0
  const payments=originalPayments.map((row,index)=>{
    const old=already(row.method),available=cents(row.amount)-old,left=total-allocatedPayments,following=originalPayments.slice(index+1).reduce((sum,p)=>sum+cents(p.amount)-already(p.method),0)
    // Independent tender rounding can otherwise make one cumulative tender
    // decrease while total cents stay flat. Keep every actual tender monotone.
    const desired=roundRatio(cents(row.amount),numerator,denominator)-old
    const target=index===originalPayments.length-1?left:Math.max(Math.max(0,left-following),Math.min(desired,available,left))
    if(target<0||target>cents(row.amount)-old)throw Error('原始付款分攤不一致')
    allocatedPayments+=target;return {method:row.method,amount:-target/100}
  })
  if(original.memberId&&!member)throw Error('原單會員已不存在，請先核對退款')
  if(member&&(!Number.isSafeInteger(member.points??0)||(member.points??0)<0))throw Error('會員點數必須為零或正整數')
  const spent=member?Math.max(0,cents(member.totalSpent??0)-total)/100:0
  const order={id:request.id,refundOf:original.id,items,subtotal:-(total+balance+discount+manual)/100,discount:-discount/100,manualDiscount:-manual/100,balanceUsed:-balance/100,total:-total/100,paid:-total/100,change:0,payMethod:original.payMethod,payments,
    memberId:original.memberId||null,pointsUsed:-pointsUsed,pointsEarned:-pointsEarned,time:request.time,status:'completed',source:'pos',fullRefund,note:String(request.reason||'').slice(0,1000),cashier:String(request.cashier||'').slice(0,128),shiftId:request.shiftId||'',requestSignature:refundSignature(request),itemCosts:original.itemCosts||{}}
  if(!Number.isFinite(Date.parse(request.time)))throw Error('退款時間不正確')
  return {order,stockUpdates:items.map(row=>({id:row.id,delta:-row.qty})),member:member?{...member,points:Math.max(0,(member.points||0)-pointsEarned+pointsUsed),balance:(cents(member.balance??0)+balance)/100,totalSpent:spent,tier:spent>=30000?'gold':spent>=10000?'silver':'normal'}:null}
}
