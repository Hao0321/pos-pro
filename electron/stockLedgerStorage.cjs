const {createHash,randomUUID}=require('node:crypto')
const {canonicalSignature}=require('./operationRules.mjs')
const {stockLedgerError}=require('./stockOpeningPlan.mjs')
const {projectStockLedger,stockLedgerAcknowledgement:acknowledgement,replayStockLedger}=require('./stockLedgerModel.mjs')
const {hasStockCostHistory,STOCK_COMPAT_SETTING}=require('./stockCompatibility.mjs')
const {STOCK_BOOK_HEAD,assertStockBookHead}=require('./stockBookAnchor.mjs')
const digest=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:canonicalSignature(value)).digest('hex')
const project=(previous,body)=>projectStockLedger(previous,body,digest)
const METHOD='applyStockCostOperation'

// Connection-private write scope. No renderer or shared-store route exposes it.
// Unintegrated stock writers fail closed after an internal opening; activation
// will remain absent from the public UI until every business adapter is ready.
module.exports=function stockLedgerStorage(db){
 let depth=0,restoreDepth=0
 const compatibility=db.prepare('SELECT value FROM settings WHERE key=?').get(STOCK_COMPAT_SETTING)
 if(compatibility&&compatibility.value!=='1')throw stockLedgerError('HISTORY')
 if(compatibility&&['stock_cost_entries','stock_cost_operations'].some(name=>!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)))throw stockLedgerError('HISTORY')
 db.function('pos_stock_write_allowed',()=>{if(!depth)throw stockLedgerError('FLOW');return 1})
 db.function('pos_stock_restore_allowed',()=>restoreDepth>0?1:0)
 db.exec('CREATE TABLE IF NOT EXISTS stock_cost_entries (id TEXT PRIMARY KEY,sequence INTEGER UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS stock_cost_operations (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS stock_cost_runtime (id TEXT PRIMARY KEY,opening_hash TEXT NOT NULL,epoch TEXT NOT NULL);')
 const active=()=>!!db.prepare('SELECT 1 FROM stock_cost_entries LIMIT 1').get()
 function scope(work){depth++;try{return work()}finally{depth--}}
 function restore(work){if(!db.inTransaction)throw stockLedgerError('HISTORY');restoreDepth++;try{return scope(work)}finally{restoreDepth--}}
 function fence(){
  require('./databaseFeatureFence.cjs').installStockFence(db)
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('stockCostVersionFence','1')
  const tables=['products','orders','order_items','purchases','restaurant_orders','restaurant_operations','waste_log','sales_documents','sales_operations','manual_journal','sales_runtime','stock_cost_entries','stock_cost_operations','stock_cost_runtime']
  for(const table of tables)for(const action of ['insert','update','delete']){
   const name=`pos_stock_commit_${table}_${action}`,conditional=!table.startsWith('stock_cost_'),old=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)
   if(old&&conditional&&!old.sql.includes('WHEN EXISTS'))db.exec('DROP TRIGGER '+name)
   db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${action.toUpperCase()} ON ${table}${conditional?' WHEN EXISTS (SELECT 1 FROM stock_cost_entries)':''} BEGIN SELECT pos_stock_write_allowed(); END;`)
  }
  for(const action of ['insert','update','delete']){
   const row=action==='delete'?'OLD':'NEW'
   const name=`pos_stock_identity_${action}`,old=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)
   if(old&&(!old.sql.includes('stock_cost_entries')||!old.sql.includes(STOCK_BOOK_HEAD)||!old.sql.includes('warehouseVersionFence')||!old.sql.includes('stockLotVersionFence')||!old.sql.includes('stockLotCountVersionFence')))db.exec('DROP TRIGGER '+name)
   db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${action.toUpperCase()} ON settings WHEN ${row}.key IN ('sharedStoreId','restaurantConfig','stockCostBookHead','warehouseVersionFence','stockLotVersionFence','stockLotCountVersionFence') AND EXISTS (SELECT 1 FROM stock_cost_entries) BEGIN SELECT pos_stock_write_allowed(); END;`)
  }
  for(const table of ['stock_cost_entries','stock_cost_operations'])for(const action of ['update','delete']){
   const name=`pos_stock_immutable_${table}_${action}`,old=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)
   if(old&&!old.sql.includes('pos_stock_restore_allowed'))db.exec('DROP TRIGGER '+name)
   db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${action.toUpperCase()} ON ${table} WHEN pos_stock_restore_allowed()=0 BEGIN SELECT RAISE(ABORT,'庫存成本回執需要核對，請保留原編號與資料'); END;`)
  }
 }
 const rows=table=>db.prepare('SELECT * FROM '+table+' ORDER BY id').all().map(row=>{const data=JSON.parse(row.data);if(row.id!==data.id||table==='stock_cost_entries'&&row.sequence!==data.sequence)throw stockLedgerError('HISTORY');return data})
 function read(observe=null){
  try{
   const state=replayStockLedger(rows('stock_cost_entries'),rows('stock_cost_operations'),digest,observe)
   const anchor=db.prepare('SELECT key,value FROM settings WHERE key=?').get(STOCK_BOOK_HEAD)
   assertStockBookHead({settings:anchor?[anchor]:[]},state)
   return state
  }catch(error){if(error.code==='STOCK_LEDGER_HISTORY')throw error;throw stockLedgerError('HISTORY')}
 }
 function bindEpoch(){
  const state=read()
  if(!state.projection){db.prepare('DELETE FROM stock_cost_runtime').run();return}
  const epoch=db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value
  if(!epoch)throw stockLedgerError('HISTORY')
  db.prepare('INSERT INTO stock_cost_runtime VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET opening_hash=excluded.opening_hash,epoch=excluded.epoch').run('binding',state.entries[0].hash,epoch)
 }
 function matchesEpoch(state=read()){if(!state.projection)return true;const row=db.prepare('SELECT * FROM stock_cost_runtime WHERE id=?').get('binding');return !!row&&row.opening_hash===state.entries[0].hash&&row.epoch===db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value}
 function replace(data){
  if(!restoreDepth)throw stockLedgerError('HISTORY')
  const state=require('./stockBackup.mjs').validateStockCostBook(data)
  db.prepare('DELETE FROM stock_cost_entries').run();db.prepare('DELETE FROM stock_cost_operations').run()
  if(state.projection||hasStockCostHistory(data))fence()
  for(const row of state.entries)db.prepare('INSERT INTO stock_cost_entries VALUES (?,?,?)').run(row.id,row.sequence,canonicalSignature(row))
  for(const row of state.operations)db.prepare('INSERT INTO stock_cost_operations VALUES (?,?)').run(row.id,canonicalSignature(row))
  bindEpoch();read()
 }
 function lookup(input,actor,method=METHOD){
  const key=canonicalSignature([method,input.id]),saved=db.prepare('SELECT data FROM stock_cost_operations WHERE id=?').get(key)
  if(!saved)return null
  const current=read(),row=current.operations.find(row=>row.id===key)
  if(!row||row.actorId!==actor.userId&&actor.role!=='owner'||row.signature!==canonicalSignature(input))throw stockLedgerError('HISTORY')
  return structuredClone(row.receipt)
 }
 function append(input,actor,{openingMaterial=null,time,date},method=METHOD,evidence=null,reconcile=null){
  if(!db.inTransaction)throw stockLedgerError('HISTORY')
  const before=read(),body={id:'stock-'+randomUUID(),sequence:before.entries.length+1,previousHash:before.head,beforeDigest:before.stateDigest,input,actor:{userId:actor.userId,username:actor.username,role:actor.role},time,date,openingMaterial}
  if(method!==METHOD){body.method=method;body.evidence=evidence}
  const projection=project(before.projection,body);body.afterDigest=digest(projection)
  if(reconcile)reconcile(projection)
  const hash=digest(body),receipt=acknowledgement(body,hash,projection)
  const operation={id:canonicalSignature([method,input.id]),method,operationId:input.id,actorId:actor.userId,signature:canonicalSignature(input),receipt}
  scope(()=>{
   fence()
   db.prepare('INSERT INTO stock_cost_entries (id,sequence,data) VALUES (?,?,?)').run(body.id,body.sequence,canonicalSignature({...body,hash}))
   db.prepare('INSERT INTO stock_cost_operations (id,data) VALUES (?,?)').run(operation.id,canonicalSignature(operation))
   db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(STOCK_BOOK_HEAD,JSON.stringify(hash))
   if(!before.entries.length)bindEpoch()
  })
  read()
  return receipt
 }
 const ensureCompatibility=()=>scope(fence)
 if(active()||compatibility)db.transaction(()=>{ensureCompatibility();const state=read();if(!state.projection)return;const binding=db.prepare('SELECT 1 FROM stock_cost_runtime WHERE id=?').get('binding');if(!binding){if(state.entries[0].input.epoch!==db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value)throw stockLedgerError('HISTORY');scope(bindEpoch)}if(!matchesEpoch(state))throw stockLedgerError('HISTORY')})()
 return {active,read,lookup,append,scope,restore,replace,matchesEpoch,ensureCompatibility}
}
