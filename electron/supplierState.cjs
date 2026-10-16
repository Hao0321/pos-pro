const {randomUUID}=require('node:crypto')
const {parsePurchase}=require('./procurementRules.mjs')
const {validateSupplierLedgerRecords}=require('./supplierLedger.mjs')
const {hasSupplierFence}=require('./databaseFeatureFence.cjs')
module.exports=function(db,stmts){
 const rows=table=>db.prepare('SELECT data FROM '+table+' ORDER BY id').all().map(row=>JSON.parse(row.data))
 return function read({ensureIdentity=false}={}){
  let storeId=stmts.getSetting.get('sharedStoreId')?.value
  if(!storeId&&ensureIdentity){storeId=randomUUID();stmts.setSetting.run('sharedStoreId',storeId)}
  const data={storeId,epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch').value,
   products:stmts.getAllProducts.all().map(row=>({...row,noBarcode:!!row.noBarcode})),purchases:stmts.getAllPurchases.all().map(parsePurchase),suppliers:stmts.getAllSuppliers.all().map(row=>({...row,catalog:JSON.parse(row.catalog||'[]')})),
   supplierEntries:rows('supplier_entries').sort((a,b)=>a.revision-b.revision),supplierOperations:rows('supplier_operations'),supplierFence:hasSupplierFence(db),
   inventoryAudits:db.prepare("SELECT * FROM audit_log WHERE action='INVENTORY_OPERATION'").all(),cashLogs:db.prepare('SELECT * FROM cash_log').all(),openShift:stmts.getOpenShift.get(),ownerIds:stmts.getAllUsers.all().filter(row=>row.role==='owner').map(row=>row.id)}
  data.supplierLedger=validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)
  return data
 }
}
