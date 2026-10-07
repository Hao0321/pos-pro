// One atomic record replaces coordinated writes to separate localStorage keys.
// Legacy keys remain intact for recovery; reads use this record after migration.
export const RECORD_KEY = 'pos_atomic_records_v1'
export const DATA_KEYS = ['pos2_products','pos2_members','pos2_orders','pos2_manual_j',
  'pos_users','pos_suppliers','pos_purchases','pos_promotions','pos2_held_orders',
  'pos2_shifts','pos2_cash_log','pos2_waste','pos2_topups','pos_audit_log']
const keys = new Set(DATA_KEYS)
function nativeStorage() { return globalThis.localStorage }
function validArray(value) {
  if (!Array.isArray(value)) throw new Error('資料格式錯誤，已保留原始紀錄，請先備份。')
  return value
}
export function readRecords() {
  const raw = nativeStorage().getItem(RECORD_KEY)
  if (raw != null) {
    const record = JSON.parse(raw)
    if (record?.version !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 || !record.data)
      throw new Error('本機資料紀錄損壞，請保留資料並還原備份。')
    for (const key of DATA_KEYS) validArray(record.data[key])
    return record
  }
  const data = {}
  for (const key of DATA_KEYS) {
    const old = nativeStorage().getItem(key)
    data[key] = old == null ? [] : validArray(JSON.parse(old))
  }
  return {version:1,revision:0,data}
}
export function writeRecords(updates, expectedRevision) {
  const current = readRecords()
  if (expectedRevision != null && current.revision !== expectedRevision)
    throw new Error('本機資料已改變，請重新載入後再操作。')
  for (const [key, value] of Object.entries(updates)) {
    if (!keys.has(key)) throw new Error('未知資料集合')
    validArray(value)
  }
  const next = {version:1,revision:current.revision+1,data:{...current.data,...updates}}
  // setItem is atomic: quota/security failure keeps the previous complete record.
  nativeStorage().setItem(RECORD_KEY, JSON.stringify(next))
  return next
}
export const browserStorage = {
  getItem(key) { return keys.has(key) ? JSON.stringify(readRecords().data[key]) : nativeStorage().getItem(key) },
  setItem(key, value) { if (keys.has(key)) writeRecords({[key]:validArray(JSON.parse(value))}); else nativeStorage().setItem(key,value) },
  removeItem(key) { if (keys.has(key)) writeRecords({[key]:[]}); else nativeStorage().removeItem(key) },
}
export async function withSalesLock(action) {
  if (!globalThis.navigator?.locks?.request)
    throw new Error('此瀏覽器缺少安全交易鎖。請使用新版瀏覽器的 HTTPS／localhost，或桌面版。')
  return navigator.locks.request('pos-sales-write-v1', action)
}
export function acquireBrowserEditor() {
  if (!globalThis.navigator?.locks?.request) return Promise.reject(new Error('瀏覽器缺少交易鎖，請使用新版瀏覽器的 HTTPS／localhost 或桌面版。'))
  return new Promise((resolve,reject)=>{
    navigator.locks.request('pos-editor-v1',{ifAvailable:true},lock=>{
      if (!lock) {reject(new Error('另一個 POS 分頁正在操作。請先關閉該分頁，再重新載入。'));return}
      return new Promise(release=>resolve(release))
    }).catch(reject)
  })
}
