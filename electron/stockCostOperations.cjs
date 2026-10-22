const {stockCostCommand,stockLedgerError,assertStockCustodyMatchesBook}=require('./stockOpeningPlan.mjs')
const {readStockOpening}=require('./stockOpeningOperations.cjs')
const {salesDate}=require('./salesRules.mjs')
const {createHash}=require('node:crypto')
const {verifyStockSetupReview}=require('./stockSetup.mjs')
module.exports=function stockCostOperations(db,api,store){
 const owner=actor=>{const user=actor?.userId&&api.getUsers().find(row=>row.id===actor.userId);if(actor?.role!=='owner'||user?.role!=='owner'||user.username!==actor.username)throw Error('權限不足');return actor}
 function current(){const state=store.read();if(state.projection){if(!store.matchesEpoch(state))throw stockLedgerError('HISTORY');assertStockCustodyMatchesBook(state.projection.custody,api.getProducts(),api.getRestaurantState().entries,state.projection.warehousing)}return state}
 return {
  getStockHistory(input,actor){
   owner(actor);require('./stockHistory.mjs').stockHistoryQuery(input)
   return db.transaction(()=>{
    owner(actor);const spans=[],state=store.read((sequence,start,end)=>spans.push({sequence,start,end})),book=api.exportData()
    if(state.projection&&!store.matchesEpoch(state))throw stockLedgerError('HISTORY')
    require('./stockBackup.mjs').validateStockCostBook(book,state)
    const epoch=db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value||null
    return require('./stockHistory.mjs').makeStockHistory(input,{book,state,spans,epoch})
   })()
  },
  getStockSalesState(actor){
   const verify=()=>{const user=actor?.userId&&api.getUsers().find(row=>row.id===actor.userId);if(!user||!['owner','staff'].includes(user.role)||actor.role!==user.role||actor.username!==user.username)throw Error('權限不足');return user.role}
   verify()
   return db.transaction(()=>{
    const role=verify(),state=current()
    if(!state.projection)return {status:'reference-only-not-activated'}
    const data={products:api.getProducts(),orders:api.getOrders(),members:api.getMembers(),restaurantEntries:api.getRestaurantState().entries}
    if(role==='owner'){
     data.sales=api.getSalesState(actor);data.supplierState=api.getSupplierState(actor)
     Object.assign(data,{topups:api.getTopups(),wasteLog:api.getWasteLog(),purchases:api.getPurchases(),salesDocuments:data.sales.documents,customerEntries:data.sales.customerLedger.entries,supplierEntries:data.supplierState.supplierLedger.entries,manualJournal:api.getManualJournal(),reservationEntries:require('./reservationDeposits.mjs').reservationDepositReportEntries(api.getReservationState(actor))})
    }
    return require('./stockSalesReports.mjs').makeStockSalesReport(state,data,salesDate(new Date()),role)
   })()
  },
  getStockAccountingState(actor){
   owner(actor)
   return db.transaction(()=>{
    owner(actor)
    const state=current()
    if(!state.projection&&!db.prepare('SELECT 1 FROM settings WHERE key=?').get('openingCutoverVersionFence'))return {status:'reference-only-not-activated'}
    const sales=api.getSalesState(actor),supplier=api.getSupplierState(actor)
    return require('./stockAccounting.mjs').makeStockAccountingReport(state,{products:api.getProducts(),orders:api.getOrders(),topups:api.getTopups(),wasteLog:api.getWasteLog(),purchases:api.getPurchases(),salesDocuments:sales.documents,customerEntries:sales.customerLedger.entries,supplierEntries:supplier.supplierLedger.entries,openingJournals:[...(sales.customerLedger.openingJournals||[]),...(supplier.supplierLedger.openingJournals||[])],openingSourceCutoffs:[...(sales.customerLedger.openingCutoffDates||[]),...(supplier.supplierLedger.openingCutoffDates||[])],manualJournal:api.getManualJournal(),restaurantEntries:api.getRestaurantState().entries,reservationEntries:require('./reservationDeposits.mjs').reservationDepositReportEntries(api.getReservationState(actor))})
   })()
  },
  getStockCostState(actor){owner(actor);return db.transaction(()=>{owner(actor);const state=current();return {status:state.projection?'active':'reference-only-not-activated',sequence:state.entries.length,stateDigest:state.stateDigest,projection:state.projection,valuation:state.valuation}})()},
  applyStockCostOperation(raw,actor){
   owner(actor)
   let checked=false,replay=false
   try{return db.transaction(()=>{
    owner(actor)
    const input=stockCostCommand(raw),saved=store.lookup(input,actor);checked=true;replay=!!saved
    if(saved)return saved
    const state=current(),sales=api.getSalesState(actor)
    if(input.storeId!==sales.storeId||input.epoch!==sales.epoch||Math.abs(Date.now()-Date.parse(input.time))>300000)throw stockLedgerError('STALE')
    let openingMaterial=null,openingPreview=null
    if(input.action==='open'){
     if(state.projection)throw stockLedgerError('ACTIVE')
     const snapshot=readStockOpening(api,actor,db),hash='sha256:'+createHash('sha256').update(snapshot.material).digest('hex')
     if(hash!==input.snapshotDigest)throw stockLedgerError('STALE')
     openingMaterial=snapshot.material
     openingPreview={...snapshot.preview,snapshotDigest:hash}
    }else if(!state.projection)throw stockLedgerError('HISTORY')
    verifyStockSetupReview(input,{state,preview:openingPreview,products:api.getProducts(),storeId:sales.storeId,epoch:sales.epoch})
    const now=new Date(),receipt=store.append(input,actor,{openingMaterial,time:now.toISOString(),date:salesDate(now)})
    current()
    return receipt
   })()}catch(error){return {success:false,committed:error.code==='STOCK_LEDGER_HISTORY'||!checked||replay?null:false,error:error.message,errorCode:error.code||null}}
  },
 }
}
