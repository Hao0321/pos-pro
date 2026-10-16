const {canonicalSignature}=require('./operationRules.mjs'),{createHash}=require('node:crypto')
const tables={products:'products',members:'members',orders:'orders',suppliers:'suppliers',purchases:'purchases',promotions:'promotions',users:'users',manualJournal:'manual_journal',heldOrders:'held_orders',shifts:'shifts',cashLog:'cash_log',wasteLog:'waste_log',memberTopups:'member_topups',auditLog:'audit_log'}
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),hash=value=>createHash('sha256').update(canonicalSignature(value)).digest('hex'),invalid=(collection,field)=>Object.assign(Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本'),{code:'BACKUP_RECORD_SHAPE',collection,field})
function equivalent(collection,key,a,b){
 if(same(a,b))return true
 if((collection==='products'&&key==='noBarcode'||collection==='promotions'&&key==='enabled'||collection==='orders'&&key==='fullRefund')&&[0,1,false,true].includes(a)&&!!a===b)return true
 if(collection==='auditLog'&&key==='detail'||collection==='promotions'&&key==='condition_data'){
  try{return same(typeof a==='string'?JSON.parse(a):a,typeof b==='string'?JSON.parse(b):b)}catch{return false}
 }
 return false
}
module.exports=function recordShapeStorage(db){
 db.exec('CREATE TABLE IF NOT EXISTS recovery_record_shapes (collection TEXT NOT NULL,record_id TEXT NOT NULL,original_data TEXT NOT NULL,baseline_data TEXT NOT NULL,checksum TEXT NOT NULL,PRIMARY KEY(collection,record_id))')
 const allowed=new Map(Object.entries(tables).map(([key,table])=>[key,new Set(db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name))]));allowed.get('orders').add('items');allowed.get('orders').add('change');allowed.get('promotions').add('condition')
 allowed.get('orders').add('tableId');allowed.get('orders').add('tableSignature');allowed.get('orders').add('trackingProof')
 const list=db.prepare('SELECT * FROM recovery_record_shapes ORDER BY collection,record_id'),one=db.prepare('SELECT * FROM recovery_record_shapes WHERE collection=? AND record_id=?'),insert=db.prepare('INSERT INTO recovery_record_shapes VALUES (?,?,?,?,?)')
 let rawDepth=0
 function assertSupported(book){for(const [collection,keys]of allowed)for(const row of book[collection]||[]){if(!row||typeof row.id!=='string')throw invalid(collection,'id');const unknown=Object.keys(row).find(key=>!keys.has(key));if(unknown)throw invalid(collection,unknown)}}
 function decoded(row){
  const original=JSON.parse(row.original_data),baseline=JSON.parse(row.baseline_data)
  if(!allowed.has(row.collection)||row.checksum!==hash({collection:row.collection,id:row.record_id,original,baseline})||original.id!==row.record_id||baseline.id!==row.record_id||Object.keys(original).some(key=>!Object.hasOwn(baseline,key)||!equivalent(row.collection,key,original[key],baseline[key])))throw invalid()
  assertSupported({[row.collection]:[original]});return {original,baseline}
 }
 function projectRow(collection,row){
  if(rawDepth||!row||!allowed.has(collection))return row
  const saved=one.get(collection,row.id);if(!saved)return row
  const {original,baseline}=decoded(saved);return same(row,baseline)?structuredClone(original):row
 }
 function project(book){
  if(rawDepth)return book
  const result={...book}
  for(const row of list.all()){
   const {original,baseline}=decoded(row),rows=result[row.collection]
   if(!Array.isArray(rows))throw invalid()
   result[row.collection]=rows.map(current=>current.id===row.record_id&&same(current,baseline)?structuredClone(original):current)
  }
  return result
 }
 function capture(expected,actual){
  if(!db.inTransaction)throw invalid()
  assertSupported(expected);db.prepare('DELETE FROM recovery_record_shapes').run()
  let count=0
  for(const collection of allowed.keys()){
   const source=expected[collection]||[],target=actual[collection]||[],byId=new Map(target.map(row=>[row.id,row]))
   if(source.length!==target.length)throw invalid(collection,'count')
   for(const original of source){const baseline=byId.get(original.id);if(!baseline)throw invalid(collection,'id');const mismatch=Object.keys(original).find(key=>!Object.hasOwn(baseline,key)||!equivalent(collection,key,original[key],baseline[key]));if(mismatch)throw invalid(collection,mismatch);if(!same(original,baseline)){insert.run(collection,original.id,JSON.stringify(original),JSON.stringify(baseline),hash({collection,id:original.id,original,baseline}));count++}}
  }
  if(count){const fence=require('./databaseFeatureFence.cjs');fence.installCrossStorageFence(db);fence.installShapeFence(db)}
 }
 function attachReads(api){
  const methods={getProducts:'products',findByBarcode:'products',getMembers:'members',getSuppliers:'suppliers',getPurchases:'purchases',getPromotions:'promotions',getManualJournal:'manualJournal',getHeldOrders:'heldOrders',getShifts:'shifts',getOpenShift:'shifts',getCashLog:'cashLog',getWasteLog:'wasteLog',getTopups:'memberTopups',getAuditLogs:'auditLog'}
  for(const [name,collection]of Object.entries(methods))if(typeof api[name]==='function'){const read=api[name];api[name]=function(...args){const value=read.apply(this,args);return Array.isArray(value)?value.map(row=>projectRow(collection,row)):projectRow(collection,value)}}
 }
 function attachFinancial(api){
  const fieldCollections={order:'orders',original:'orders',product:'products',products:'products',member:'members',cashLog:'cashLog',waste:'wasteLog',topup:'memberTopups'}
  const row=(collection,value)=>projectRow(collection,collection==='products'&&value&&Object.hasOwn(value,'noBarcode')?{...value,noBarcode:!!value.noBarcode}:value)
  for(const name of ['checkout','refundOrder','addTopup','addWaste','addCashLog','applyRestaurantOperation']){
   const original=api[name]
   api[name]=function(...args){return db.transaction(()=>{
    for(const saved of list.all())decoded(saved)
    const result=original.apply(this,args)
    if(!result||result.success===false)return result
    const output={...result}
    for(const [key,collection]of Object.entries(fieldCollections))if(Object.hasOwn(output,key))output[key]=Array.isArray(output[key])?output[key].map(value=>row(collection,value)):row(collection,output[key])
    return output
   })()}
  }
 }
 return {assertSupported,capture,project,projectRow,attachReads,attachFinancial,raw(fn){rawDepth++;try{return fn()}finally{rawDepth--}}}
}
