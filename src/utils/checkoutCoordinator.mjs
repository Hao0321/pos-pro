// R5 commit-first coordinator. All I/O is supplied by the data-access layer.
// This records a sale; it never calls a payment processor or charges a card.
export const CHECKOUT_PROTOCOL = 'pos-checkout-v5'
export class CheckoutError extends Error {
  constructor(code, message) { super(message); this.name = 'CheckoutError'; this.code = code }
}
const failure = (code, text) => new CheckoutError(code, text)
const clone = value => JSON.parse(JSON.stringify(value))
function assertFiniteTree(value, depth = 0) {
  if (depth > 16) throw failure('JOURNAL_INVALID','待確認資料層級過深。')
  if (typeof value === 'number' && !Number.isFinite(value)) throw failure('JOURNAL_INVALID','待確認資料含無效數值。')
  if (value && typeof value === 'object') for (const v of Object.values(value)) assertFiniteTree(v,depth+1)
}
export function validatePending(value) {
  const invalid = () => { throw failure('JOURNAL_INVALID','待確認交易紀錄損壞。請保留紀錄核對，勿重新收款。') }
  assertFiniteTree(value)
  if (!value || value.version !== 1 || value.protocol !== CHECKOUT_PROTOCOL || !value.plan) invalid()
  const {order:o,stockUpdates:updates,memberUpdate:member} = value.plan
  const nonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e9
  const cents = n => Math.round(n * 100 + 1e-7)
  if (!o || typeof o.id !== 'string' || !o.id || o.id.length>128 || o.status!=='completed' ||
      typeof o.shiftId!=='string' || !o.shiftId || !Number.isFinite(Date.parse(o.time)) ||
      !Array.isArray(o.items) || !o.items.length || o.items.length>1000 ||
      !Array.isArray(updates) || updates.length!==o.items.length) invalid()
  for (const k of ['subtotal','total','discount','manualDiscount','balanceUsed','paid','change','pointsUsed','pointsEarned']) if (!nonnegative(o[k])) invalid()
  if (!Number.isSafeInteger(o.pointsUsed) || !Number.isSafeInteger(o.pointsEarned) ||
      cents(o.subtotal)!==cents(o.total)+cents(o.discount)+cents(o.manualDiscount)+cents(o.balanceUsed)) invalid()
  const ids = new Set(); let subtotal=0
  for (const i of o.items) {
    if (!i || typeof i.id!=='string' || !i.id || ids.has(i.id) || !nonnegative(i.price) ||
        !nonnegative(i.qty) || i.qty<=0 || i.qty>1e6 || Math.abs(i.qty*1000-Math.round(i.qty*1000))>1e-6) invalid()
    ids.add(i.id);subtotal+=cents(i.price*i.qty)
    if (updates.filter(u=>u?.id===i.id && u.delta===-i.qty).length!==1) invalid()
  }
  if (subtotal!==cents(o.subtotal) || !Array.isArray(o.payments) || !o.payments.length || o.payments.length>2) invalid()
  const methods = new Set(); let paid=0
  for (const p of o.payments) {
    if (!p || !['cash','card'].includes(p.method) || methods.has(p.method) || !nonnegative(p.amount)) invalid()
    methods.add(p.method);paid+=cents(p.amount)
  }
  if (paid!==cents(o.total) || o.payMethod!==(methods.size>1?'mixed':o.payments[0].method)) invalid()
  if (o.payMethod==='cash' ? cents(o.paid)-cents(o.change)!==paid : cents(o.paid)!==paid || cents(o.change)!==0) invalid()
  if (o.memberId) {
    if (!member || member.id!==o.memberId || member.pointsDelta!==o.pointsEarned-o.pointsUsed ||
        member.spentDelta!==o.total || member.balanceDelta!==-o.balanceUsed) invalid()
  } else if (member!=null || o.pointsUsed || o.pointsEarned || o.balanceUsed) invalid()
  return clone(value)
}
export function createCheckoutCoordinator(ports) {
  for (const key of ['prepare','persist','lookup','readPending','writePending','clearPending','apply'])
    if (typeof ports[key] !== 'function') throw new TypeError(`Missing checkout port: ${key}`)
  let pending = null, running = false, restored = false
  let state = {phase:'idle', orderId:null, total:null, message:''}
  function notify(phase, message = '') {
    state = {phase, orderId:pending?.order.id || null, total:pending?.order.total ?? null, message}
    try { ports.onState?.({...state}) } catch (error) { console.error('[checkout status]',error) }
  }
  function uncertain(error) {
    const message = `交易結果尚未確認${pending ? `（${pending.order.id}）` : ''}。請勿再次收款，先查詢此單號。`
    notify('uncertain', message)
    return failure('OUTCOME_UNKNOWN', `${message}${error?.message ? ` ${error.message}` : ''}`)
  }
  async function finish(result) {
    if (!result || result.protocol !== CHECKOUT_PROTOCOL || result.success !== true ||
        result.orderId !== pending.order.id || result.order?.id !== pending.order.id ||
        !Array.isArray(result.products) || !('member' in result))
      throw uncertain(failure('ACK_INVALID','存檔回覆不完整或單號不符。'))
    try {
      assertFiniteTree(result)
      validatePending({version:1,protocol:CHECKOUT_PROTOCOL,plan:{...pending,order:result.order}})
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
        ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value
      const echoed = Object.fromEntries(Object.keys(pending.order).map(k=>[k,result.order[k]]))
      if (JSON.stringify(canonical(echoed))!==JSON.stringify(canonical(pending.order)))
        throw failure('ACK_INVALID','回覆的訂單內容與待確認訂單不同。')
      const expected = new Set(pending.stockUpdates.map(u=>u.id)),seen = new Set()
      for (const product of result.products) {
        if (!product || !expected.has(product.id) || seen.has(product.id) || typeof product.stock!=='number' ||
            !Number.isFinite(product.stock) || product.stock<0 || product.stock>1e9)
          throw failure('ACK_INVALID','回覆的庫存快照不正確。')
        seen.add(product.id)
      }
      if (seen.size!==expected.size) throw failure('ACK_INVALID','回覆缺少本筆交易的商品快照。')
      if (pending.order.memberId) {
        if (!result.member || result.member.id!==pending.order.memberId ||
            !Number.isSafeInteger(result.member.points) || result.member.points<0 ||
            typeof result.member.balance!=='number' || !Number.isFinite(result.member.balance) || result.member.balance<0)
          throw failure('ACK_INVALID','回覆的會員快照不正確。')
      } else if (result.member!==null) throw failure('ACK_INVALID','非會員交易出現不符的會員資料。')
    } catch (error) { throw uncertain(error) }
    // apply must replace touched product/member values, not apply deltas a second time.
    try {
      await ports.apply(result)
      await ports.clearPending(pending.order.id)
    } catch (error) { throw uncertain(error) }
    const order = clone(result.order)
    pending = null
    notify('idle')
    return order
  }
  async function send() {
    let result
    try { result = await ports.persist(clone(pending)) }
    catch (error) { throw uncertain(error) }
    if (result?.protocol === CHECKOUT_PROTOCOL && result.success === false && result.committed === false && result.orderId === pending.order.id) {
      // Only a confirmed rolled-back transaction permits a new checkout attempt.
      try { await ports.clearPending(pending.order.id) } catch (error) { throw uncertain(error) }
      const message = String(result.error || '資料庫拒絕存檔，購物車已保留。')
      pending = null; notify('idle', message)
      throw failure('NOT_COMMITTED',message)
    }
    return finish(result)
  }
  function assertFree() {
    if (running) throw failure('BUSY','正在確認交易，請勿重複送出。')
    if (state.phase === 'blocked') throw failure('BLOCKED',state.message)
  }
  function restore() {
      assertFree()
      try {
        const saved = ports.readPending()
        if (saved && typeof saved.then === 'function') throw failure('JOURNAL_INVALID','readPending 必須同步完成。')
        pending = saved == null ? null : validatePending(saved).plan
        restored = true
        notify(pending ? 'uncertain' : 'idle', pending ? '找到上一筆未確認交易。請先查詢，不要重新收款。' : '')
      } catch (error) { notify('blocked',error.message); throw error }
      return {...state}
  }
  return {
    getState: () => ({...state}),
    getPending: () => pending ? clone(pending) : null,
    restore,
    async submit(input) {
      assertFree()
      if (!restored) restore()
      // Re-read before preparing so another existing journal is never silently overwritten.
      const saved = ports.readPending()
      if (saved != null) {
        try { pending = validatePending(saved).plan } catch (error) { notify('blocked',error.message); throw error }
      }
      if (pending) throw failure('OUTCOME_UNKNOWN','上一筆交易尚未確認；請查詢或使用同一單號重試存檔，勿再次收款。')
      running = true
      try {
        const prepared = ports.prepare(input)
        const plan = {order:prepared.order,stockUpdates:prepared.stockUpdates,memberUpdate:prepared.memberUpdate}
        const envelope = validatePending({version:1,protocol:CHECKOUT_PROTOCOL,plan})
        // If the journal cannot be written, no request is sent to the database.
        const written = ports.writePending(envelope)
        if (written && typeof written.then === 'function') throw failure('JOURNAL_INVALID','writePending 必須同步完成。')
        pending = envelope.plan
        notify('saving','正在存檔，請勿關閉程式或再次收款。')
        return await send()
      } finally { running = false }
    },
    async reconcile() {
      assertFree()
      if (!pending) return null
      running = true; notify('saving','正在查詢原單號，不會新增收款。')
      try {
        let result
        try { result = await ports.lookup(pending.order.id) } catch (error) { throw uncertain(error) }
        if (result?.protocol === CHECKOUT_PROTOCOL && result.success === true && result.found === false)
          throw uncertain(failure('NOT_FOUND','目前查無此單號。可使用同一單號重試存檔；請勿再次收款。'))
        return await finish(result)
      } finally { running = false }
    },
    async retry() {
      assertFree()
      if (!pending) return null
      if (ports.replayVerified !== true) throw failure('RETRY_UNVERIFIED','原生資料庫冪等重播尚未驗證，已停用重試；請先查詢原單號。')
      running = true; notify('saving','使用原單號重試存檔；不會再次收取款項。')
      try { return await send() } finally { running = false }
    },
  }
}
