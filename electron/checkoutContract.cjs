// Checkout request validation is repeated against SQLite inside the transaction.
const { prepareCheckout } = require('./checkoutSafety.cjs')
const PROTOCOL = 'pos-checkout-v5'
const {signature}=require('./checkoutSignature.mjs')

function prepareDatabaseCheckout(request, reader) {
  if (!request || typeof request.id !== 'string' || !request.id || request.id.length > 128 ||
      request.refundOf || (request.source && request.source !== 'pos') || request.status !== 'completed')
    throw new Error('不是有效的收銀結帳要求')
  if (!Array.isArray(request.items)) throw new Error('商品明細格式不正確')
  for (const key of ['subtotal','total','discount','manualDiscount','balanceUsed','paid','change','pointsUsed','pointsEarned']) {
    const value = request[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9)
      throw new Error(`結帳金額欄位不正確：${key}`)
  }
  const products = request.items.map(i=>reader.product(i?.id)).filter(Boolean)
  const member = request.memberId ? reader.member(request.memberId) : null
  const setting = (key, fallback) => {
    const raw = reader.setting(key)
    return raw == null || raw === '' ? fallback : Number(raw)
  }
  const prepared = prepareCheckout({
    cart:request.items, products, members:member ? [member] : [],
    activeMember:request.memberId ? {id:request.memberId} : null,
    pointsRule:{earn:setting('pointsEarnRate',10),redeem:setting('pointsRedeemRate',1)},
    birthdayBonus:setting('birthdayBonus',100), openShift:reader.shift(request.shiftId),
    payMethod:request.payMethod, paid:request.paid, pointsUsed:request.pointsUsed,
    opts:{taxId:request.taxId,cashier:request.cashier,manualDiscountAmt:request.manualDiscount ?? 0,
      balanceUsed:request.balanceUsed ?? 0,...(request.payMethod === 'mixed' ? {payments:request.payments} : {})},
    id:request.id, now:new Date(request.time),
  })
  if (signature(prepared.order) !== signature(request))
    throw new Error('商品、會員或集點規則與結帳資料不一致，請重新確認金額。')
  return prepared
}
module.exports = { PROTOCOL, signature, prepareDatabaseCheckout }
