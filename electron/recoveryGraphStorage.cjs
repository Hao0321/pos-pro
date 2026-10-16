const {createHash}=require('node:crypto')
const {canonicalSignature}=require('./operationRules.mjs')
const {packRecoveryGraph,unpackRecoveryGraph,mergeRecoveryGraphs}=require('./recoveryGraph.mjs')
const {RECOVERY_FEATURES,recoveryDataError}=require('./recoveryBook.mjs')
const digest=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:canonicalSignature(value)).digest('hex')
module.exports=function recoveryGraphStorage(db){
 const options={digest},prefixes={'kitchen-print-v1':'pos_kitchen_guard_','restaurant-intake-v1':'pos_intake_guard_','record-shapes-v1':'pos_shape_guard_','cross-storage-v1':'pos_recovery_cross_guard_','customer-ledger-v1':'pos_customer_guard_','supplier-ledger-v1':'pos_supplier_guard_','stock-cost-v1':'pos_stock_guard_'}
 function read(){return packRecoveryGraph({
  snapshots:db.prepare('SELECT s.*,f.storage FROM recovery_snapshots s LEFT JOIN recovery_source_formats f ON f.snapshot_id=s.id ORDER BY s.id').all().map(row=>({id:row.id,createdAt:row.created_at,actorId:row.actor_id,storeId:row.store_id,data:row.data,contentSignature:row.sha256,afterMaterial:row.after_material,...(row.storage?{storage:row.storage}:{})})),
  originalIds:db.prepare('SELECT * FROM recovery_original_ids ORDER BY method,operation_id,snapshot_id').all().map(row=>[row.method,row.operation_id,row.snapshot_id]),
  events:db.prepare('SELECT * FROM recovery_events ORDER BY id').all().map(row=>({id:row.id,actorId:row.actor_id,signature:row.signature,receipt:row.receipt})),
 },'sqlite',{...options,version:require('./databaseFeatureFence.cjs').hasKitchenPrintFence(db)?5:require('./databaseFeatureFence.cjs').hasIntakeFence(db)?4:require('./databaseFeatureFence.cjs').hasShapeFence(db)?3:require('./databaseFeatureFence.cjs').hasCrossStorageFence(db)?2:undefined})}
 function merge(incoming){
  if(!db.inTransaction)throw recoveryDataError()
  const graph=mergeRecoveryGraphs(read(),incoming,'sqlite',options),rows=unpackRecoveryGraph(graph,'sqlite',options)
  for(const row of rows.snapshots){
   db.prepare('INSERT OR IGNORE INTO recovery_snapshots VALUES (?,?,?,?,?,?,?)').run(row.id,row.createdAt,row.actorId,row.storeId,row.data,row.contentSignature,row.afterMaterial)
   if(row.storage)db.prepare('INSERT OR IGNORE INTO recovery_source_formats VALUES (?,?)').run(row.id,row.storage)
  }
  for(const row of rows.originalIds)db.prepare('INSERT OR IGNORE INTO recovery_original_ids VALUES (?,?,?)').run(...row)
  for(const row of rows.events)db.prepare('INSERT OR IGNORE INTO recovery_events VALUES (?,?,?,?)').run(row.id,row.actorId,row.signature,row.receipt)
  return graph
 }
 const features=()=>RECOVERY_FEATURES.filter(value=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(prefixes[value]+'sales_runtime_insert'))
 function install(values){const fence=require('./databaseFeatureFence.cjs');for(const value of values){if(value==='kitchen-print-v1')fence.installKitchenPrintFence(db);else if(value==='restaurant-intake-v1')fence.installIntakeFence(db);else if(value==='record-shapes-v1')fence.installShapeFence(db);else if(value==='cross-storage-v1')fence.installCrossStorageFence(db);else if(value==='customer-ledger-v1')fence.installCustomerFence(db);else if(value==='supplier-ledger-v1')fence.installSupplierFence(db);else if(value==='stock-cost-v1')fence.installStockFence(db);else throw recoveryDataError()}}
 return {read,merge,features,install,digest,options,revision:()=>digest(read())}
}
