const {createHash}=require('node:crypto'),{prepareStockOpening}=require('./stockOpening.mjs')
function readStockOpening(api,actor,db){
 const account=actor?.userId&&api.getUsers().find(user=>user.id===actor.userId)
 if(actor?.role!=='owner'||!account||account.role!=='owner'||account.username!==actor.username)throw Error('權限不足')
 const supplier=api.getSupplierState(actor),sales=api.getSalesState(actor)
 const result=prepareStockOpening({storeId:sales.storeId,epoch:sales.epoch,products:api.getProducts(),orders:api.getOrders(),topups:api.getTopups(),wasteLog:api.getWasteLog(),purchases:api.getPurchases(),salesDocuments:sales.documents,customerEntries:sales.customerLedger.entries,supplierEntries:supplier.supplierLedger.entries,manualJournal:api.getManualJournal(),restaurantEntries:api.getRestaurantState().entries})
 if(db){
  const ids=table=>db.prepare('SELECT id FROM '+table+' ORDER BY id').all().map(row=>row.id)
  const legacyOperationIds={checkout:api.getOrders().filter(row=>!row.refundOf).map(row=>row.id).sort(),refundOrder:api.getOrders().filter(row=>row.refundOf).map(row=>row.id).sort(),addProduct:ids('products'),addWaste:ids('waste_log'),applyRestaurantOperation:ids('restaurant_operations'),applySalesOperation:ids('sales_operations'),applyInventoryOperation:db.prepare("SELECT id FROM audit_log WHERE action='INVENTORY_OPERATION' ORDER BY id").all().map(row=>row.id.slice('stock-operation:'.length))}
  result.material=require('./operationRules.mjs').canonicalSignature({...JSON.parse(result.material),legacyOperationIds})
 }
 return result
}
module.exports=function(db,api,store){
 return {
  getStockCostPreview(actor){
   return db.transaction(()=>{
    const {preview,material}=readStockOpening(api,actor,db)
    if(store?.active())throw require('./stockOpeningPlan.mjs').stockLedgerError('ACTIVE')
    return {...preview,snapshotDigest:'sha256:'+createHash('sha256').update(material).digest('hex')}
   })()
  },
 }
}
module.exports.readStockOpening=readStockOpening
