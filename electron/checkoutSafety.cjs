// Generated from src/utils/checkoutSafety.mjs; do not edit independently.
// R2: pure checkout validation. No network or storage access.
function numeric(value, label, min = 0, max = 1000000000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label}必須是有效數字，且不可小於 ${min}`)
  return value
}
function cents(value) {
  numeric(value, '金額')
  return Math.round(value * 100 + 1e-7)
}
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
function transactionId() {
  return 'O' + (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)
}
function prepareCheckout({cart, products, members, activeMember, pointsRule, birthdayBonus,
  openShift, payMethod, paid, pointsUsed = 0, opts = {}, now = new Date(), id = transactionId()}) {
  if (!openShift || typeof openShift.id !== 'string' || !openShift.id || openShift.status !== 'open') throw new Error('請先開班再結帳')
  if (!Array.isArray(cart) || !cart.length || cart.length > 1000) throw new Error('請確認購物車品項')
  if (!Array.isArray(products) || !Array.isArray(members) || !pointsRule || !opts ||
      !(now instanceof Date) || !Number.isFinite(now.getTime()) || typeof id !== 'string' || !id || id.length > 128)
    throw new Error('結帳資料格式不正確')
  const catalog = new Map(products.map(p=>[p.id,p]))
  const seen = new Set()
  const items = cart.map(i=>{
    if (!i || !catalog.has(i.id) || seen.has(i.id)) throw new Error('商品不存在或明細重複，請重新確認')
    seen.add(i.id)
    const current = catalog.get(i.id)
    numeric(i.qty, '商品數量', 0.001, 1000000)
    if (Math.abs(i.qty*1000 - Math.round(i.qty*1000)) > 0.000001) throw new Error('數量最多三位小數')
    numeric(current.stock, '商品庫存')
    if (Math.round(i.qty*1000) > Math.round(current.stock*1000)) throw new Error(`${current.name}庫存不足，剩餘 ${current.stock}`)
    numeric(i.price, '商品售價')
    if (typeof i.id !== 'string' || !i.id || typeof current.name !== 'string') throw new Error('商品資料格式不正確')
    // Keep the pending journal small; do not copy embedded product images or unrelated fields.
    return {id:i.id, name:current.name, price:cents(i.price)/100, qty:i.qty}
  })
  const member = activeMember ? members.find(m=>m.id===activeMember.id) : null
  if (activeMember && !member) throw new Error('所選會員已不存在，請重新選擇')
  if (member) {
    numeric(member.totalSpent ?? 0,'會員累計消費')
    numeric(member.balance ?? 0,'會員儲值')
    numeric(member.points ?? 0,'會員點數')
    if (!Number.isSafeInteger(member.points ?? 0)) throw new Error('會員點數必須是整數')
  }
  const earn = numeric(pointsRule.earn, '集點門檻', 0.01)
  const redeem = numeric(pointsRule.redeem, '折抵比例', 0.01)
  const bonus = numeric(birthdayBonus, '生日贈點')
  numeric(pointsUsed, '折抵點數')
  if (!Number.isSafeInteger(pointsUsed) || !Number.isSafeInteger(bonus)) throw new Error('點數必須是整數')
  const manual = cents(opts.manualDiscountAmt ?? 0)
  const balance = cents(opts.balanceUsed ?? 0)
  if (!member && (pointsUsed || balance)) throw new Error('請先選擇會員才能使用點數或儲值')
  if (member && pointsUsed > numeric(member.points ?? 0,'會員點數')) throw new Error('會員點數不足，請重新確認')
  if (member && balance > cents(member.balance ?? 0)) throw new Error('會員儲值不足，請重新確認')
  const subtotalCents = items.reduce((s,i)=>s+cents(i.price*i.qty),0)
  numeric(subtotalCents/100,'訂單小計')
  const discount = cents(pointsUsed*redeem)
  if (discount+manual+balance > subtotalCents) throw new Error('點數、折讓與儲值合計超過商品小計')
  const totalCents = subtotalCents-discount-manual-balance
  const total = totalCents/100
  let payments, tendered = total, change = 0
  if (opts.payments != null) {
    if (!Array.isArray(opts.payments) || opts.payments.length > 10) throw new Error('付款明細格式錯誤')
    const combined = new Map()
    for (const p of opts.payments) {
      if (!p || !['cash','card'].includes(p.method)) throw new Error('付款方式不正確')
      combined.set(p.method,(combined.get(p.method)||0)+cents(p.amount))
    }
    if ([...combined.values()].reduce((a,b)=>a+b,0)!==totalCents) throw new Error('混合付款合計不等於應收金額')
    payments = [...combined].map(([method,amount])=>({method,amount:amount/100}))
    if (!payments.length) payments = [{method:'cash',amount:0}]
  } else {
    if (!['cash','card'].includes(payMethod)) throw new Error('付款方式不正確')
    if (payMethod === 'cash') {
      if (cents(paid)<totalCents) throw new Error('現金實收不足')
      tendered=cents(paid)/100; change=(cents(paid)-totalCents)/100
    }
    payments=[{method:payMethod,amount:total}]
  }
  const date=localDate(now)
  const birthdayBonusGiven = member?.birthday?.slice(5,7)===date.slice(5,7) &&
    (member.lastBirthdayBonus||'').slice(0,7)!==date.slice(0,7) ? bonus : 0
  // Retain the existing earn/spend policy: external payment amount only.
  const pointsEarned=member ? Math.floor(total/earn)+birthdayBonusGiven : 0
  const newSpent=(member?.totalSpent||0)+total
  const order={id,items,subtotal:subtotalCents/100,discount:discount/100,manualDiscount:manual/100,
    balanceUsed:balance/100,total,payMethod:payments.length>1?'mixed':payments[0].method,
    paid:tendered,change,payments,memberId:member?.id||null,pointsUsed,pointsEarned,
    time:now.toISOString(),taxId:String(opts.taxId||''),cashier:String(opts.cashier||''),
    shiftId:openShift.id,status:'completed'}
  const memberUpdate=member ? {id:member.id,pointsDelta:-pointsUsed+pointsEarned,
    spentDelta:total,balanceDelta:-balance/100,
    tier:newSpent>=30000?'gold':newSpent>=10000?'silver':'normal',
    ...(birthdayBonusGiven>0?{lastBirthdayBonus:date}:{})} : null
  return {order,stockUpdates:items.map(i=>({id:i.id,delta:-i.qty})),memberUpdate,member}
}

module.exports = { numeric, cents, localDate, transactionId, prepareCheckout }
