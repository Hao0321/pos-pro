// Backup conversion is a bijection. These tags describe storage, never a
// guessed business type. Original archived settings remain byte-for-byte.
export const SQLITE_TEXT_ENCODING='sqlite-text/v1'
export const BROWSER_JSON_ENCODING='browser-json/v1'
const internal=new Set(['procurementUnitPricingVersionFence','stockCostVersionFence','stockCostBookHead','warehouseVersionFence','stockLotVersionFence','stockLotCountVersionFence','stockReceiptLotsVersionFence','stockSupplierLotReturnsVersionFence'])
const invalid=()=>Error('備份設定格式需要核對，請保留原檔')
export function validateSettingRows(rows,storage){
 if(!Array.isArray(rows)||!['sqlite','browser'].includes(storage))throw invalid()
 const keys=new Set()
 for(const row of rows){
  if(!row||typeof row.key!=='string'||!row.key||typeof row.value!=='string'||keys.has(row.key)||Object.keys(row).some(key=>!['key','value','id','encoding'].includes(key))||Object.hasOwn(row,'id')&&typeof row.id!=='string')throw invalid()
  keys.add(row.key)
  if(Object.hasOwn(row,'encoding')){
   if(internal.has(row.key)||row.encoding!==(storage==='sqlite'?BROWSER_JSON_ENCODING:SQLITE_TEXT_ENCODING))throw invalid()
   let value;try{value=JSON.parse(row.value)}catch{throw invalid()}
   if(storage==='browser'&&typeof value!=='string')throw invalid()
  }
  if(['sharedStoreId','orderTrackingSecret','orderReceiptSecret'].includes(row.key)){
   let value=row.value
   if(storage==='browser'||row.encoding===BROWSER_JSON_ENCODING){try{value=JSON.parse(row.value)}catch{if(row.encoding)throw invalid()}}
   if(typeof value!=='string')throw invalid()
  }
 }
 return rows
}
export function settingValue(row,storage){
 if(!row)return null
 return storage==='browser'||row.encoding===BROWSER_JSON_ENCODING?JSON.parse(row.value):row.value
}
export function nativeSettingText(row){
 if(!row)return null
 const value=settingValue(row,'sqlite')
 return typeof value==='string'?value:JSON.stringify(value)
}
export function settingsForValidation(rows,storage){return storage==='sqlite'?rows.map(row=>({...row,value:nativeSettingText(row)})):rows}
export function convertSettingRows(rows,from,to){
 validateSettingRows(rows,from)
 if(from===to)return structuredClone(rows)
 if(!['sqlite','browser'].includes(to))throw invalid()
 const converted=rows.map(row=>{
  if(internal.has(row.key))return {...row}
  const {encoding,...plain}=row
  if(from==='sqlite')return encoding===BROWSER_JSON_ENCODING?plain:{...plain,value:JSON.stringify(row.value),encoding:SQLITE_TEXT_ENCODING}
  if(encoding===SQLITE_TEXT_ENCODING)return {...plain,value:JSON.parse(row.value)}
  try{JSON.parse(row.value)}catch{throw invalid()}
  return {...plain,encoding:BROWSER_JSON_ENCODING}
 })
 return validateSettingRows(converted,to)
}
export function updateBrowserSettings(rows,values){
 const next=new Map(rows.map(row=>[row.key,row]))
 for(const [key,input]of Object.entries(values)){
  const value=String(input),old=next.get(key);let nativeText=false
  if(old?.encoding===SQLITE_TEXT_ENCODING){try{nativeText=typeof JSON.parse(value)==='string'}catch{}}
  next.set(key,{key,value,...(old&&Object.hasOwn(old,'id')?{id:old.id}:{}),...(nativeText?{encoding:SQLITE_TEXT_ENCODING}:{})})
 }
 return [...next.values()]
}
