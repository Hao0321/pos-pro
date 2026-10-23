const {readOpeningCutoverHistory}=require('./openingCutoverHistory.mjs')
module.exports=function(db){
 const rows=table=>db.prepare('SELECT data FROM '+table+' ORDER BY id').all().map(row=>JSON.parse(row.data))
 return function read(){
  const marker=db.prepare("SELECT 1 FROM settings WHERE key IN ('financialFileMigrationVersionFence','openingCutoverVersionFence','openingCutoverHead') LIMIT 1").get()
  const audit=marker?null:db.prepare("SELECT 1 FROM audit_log WHERE action='AGENT_OPENING_CUTOVER' OR id LIKE 'opening-cutover:%' OR (action='AGENT_MASTER_MIGRATION' AND json_extract(detail,'$.signature') LIKE '%pos-opening-master-migration/v2%' OR action='AGENT_MASTER_MIGRATION' AND json_extract(detail,'$.signature') LIKE '%pos-opening-master-migration/v3%') LIMIT 1").get()
  const activation=marker||audit?null:db.prepare("SELECT 1 FROM customer_entries WHERE json_extract(data,'$.action')='opening-import' UNION ALL SELECT 1 FROM supplier_entries WHERE json_extract(data,'$.action')='opening-import' LIMIT 1").get()
  if(!marker&&!audit&&!activation)return undefined
  const book={settings:db.prepare('SELECT * FROM settings').all(),auditLog:db.prepare('SELECT * FROM audit_log').all(),suppliers:db.prepare('SELECT * FROM suppliers').all(),customerEntries:rows('customer_entries'),customerOperations:rows('customer_operations'),supplierEntries:rows('supplier_entries'),supplierOperations:rows('supplier_operations'),stockCostEntries:rows('stock_cost_entries'),stockCostOperations:rows('stock_cost_operations')}
  return readOpeningCutoverHistory(book).context
 }
}
