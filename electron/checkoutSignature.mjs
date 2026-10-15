// Pure original-payment identity shared by native and browser recovery.
export function signature(o) {
  if (!o || !Array.isArray(o.items)) throw new Error('訂單明細格式不正確')
  const pays = typeof o.payments === 'string' ? JSON.parse(o.payments) : o.payments
  if (!Array.isArray(pays)) throw new Error('付款明細格式不正確')
  return JSON.stringify({
    id:o.id, subtotal:o.subtotal, discount:o.discount ?? 0, manualDiscount:o.manualDiscount ?? 0,
    balanceUsed:o.balanceUsed ?? 0, total:o.total, paid:o.paid, change:o.change ?? o.change_amount ?? 0,
    payMethod:o.payMethod, memberId:o.memberId||'', pointsUsed:o.pointsUsed ?? 0, pointsEarned:o.pointsEarned ?? 0,
    time:o.time, taxId:o.taxId||'', cashier:o.cashier||'', shiftId:o.shiftId||'',
    items:o.items.map(i=>({id:i.id || i.productId,name:i.name,price:i.price,qty:i.qty})).sort((a,b)=>a.id.localeCompare(b.id)),
    payments:pays.map(p=>({method:p.method,amount:p.amount})).sort((a,b)=>a.method.localeCompare(b.method)),
  })
}
