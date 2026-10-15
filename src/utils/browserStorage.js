// One atomic record replaces coordinated writes to separate localStorage keys.
// Legacy keys remain intact for recovery; reads use this record after migration.
import {validateRestaurantRecords,readRestaurantConfig} from '../../electron/restaurantRules.mjs'
import {validateProcurementRecords} from '../../electron/procurementRules.mjs'
export const RECORD_KEY = 'pos_atomic_records_v1'
export const DATA_KEYS = ['pos2_products','pos2_members','pos2_orders','pos2_manual_j',
  'pos_users','pos_suppliers','pos_purchases','pos_promotions','pos2_held_orders',
  'pos2_shifts','pos2_cash_log','pos2_waste','pos2_topups','pos_audit_log','pos_business_settings','pos_restaurant_orders','pos_restaurant_operations']
const keys = new Set(DATA_KEYS)
const SETTINGS_PREFIX='pos_settings_'
const legacySettings=['pointsEarnRate','pointsRedeemRate','birthdayBonus','dailySalesGoal','storeName','storePhone','storeAddress','receiptFooter','serverPort']
function readLegacySettings(){return legacySettings.flatMap(key=>{const value=nativeStorage().getItem(SETTINGS_PREFIX+key);return value===null?[]:[{key,value}]})}
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
    // Only this newly added collection may be absent in older atomic records.
    if(!Object.hasOwn(record.data,'pos_business_settings'))record.data.pos_business_settings=readLegacySettings()
    for(const key of ['pos_restaurant_orders','pos_restaurant_operations'])if(!Object.hasOwn(record.data,key))record.data[key]=[]
    for (const key of DATA_KEYS) validArray(record.data[key])
    return record
  }
  const data = {}
  for (const key of DATA_KEYS) {
    const old = nativeStorage().getItem(key)
    data[key] = old == null ? key==='pos_business_settings'?readLegacySettings():[] : validArray(JSON.parse(old))
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
  validateProcurementRecords(next.data.pos_purchases,next.data.pos2_cash_log)
  validateRestaurantRecords(next.data.pos_restaurant_orders,next.data.pos_restaurant_operations,next.data.pos2_orders,next.data.pos2_products)
  const rawConfig=next.data.pos_business_settings.find(s=>s.key==='restaurantConfig')?.value
  readRestaurantConfig(rawConfig==null?null:JSON.parse(rawConfig),next.data.pos2_products)
  // setItem is atomic: quota/security failure keeps the previous complete record.
  nativeStorage().setItem(RECORD_KEY, JSON.stringify(next))
  return next
}
export const browserStorage = {
  getItem(key) {if(key.startsWith(SETTINGS_PREFIX))return readRecords().data.pos_business_settings.find(s=>s.key===key.slice(SETTINGS_PREFIX.length))?.value??null;return keys.has(key) ? JSON.stringify(readRecords().data[key]) : nativeStorage().getItem(key) },
  setItem(key, value) {if(key.startsWith(SETTINGS_PREFIX)){writeBusinessSettings({[key.slice(SETTINGS_PREFIX.length)]:value});return}if (keys.has(key)) writeRecords({[key]:validArray(JSON.parse(value))}); else nativeStorage().setItem(key,value) },
  removeItem(key) {if(key.startsWith(SETTINGS_PREFIX)){writeRecords({pos_business_settings:readRecords().data.pos_business_settings.filter(s=>s.key!==key.slice(SETTINGS_PREFIX.length))});return}if (keys.has(key)) writeRecords({[key]:[]}); else nativeStorage().removeItem(key) },
}
export function writeBusinessSettings(values){const current=readRecords();const data=new Map(current.data.pos_business_settings.map(s=>[s.key,s.value]));for(const [key,value]of Object.entries(values))data.set(key,String(value));return writeRecords({pos_business_settings:[...data].map(([key,value])=>({key,value}))},current.revision)}
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
