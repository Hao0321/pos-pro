const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
// A caller may supply a physically retained prior source snapshot. Without it
// this optional family is explicitly unmeasured, never a simulated old build.
module.exports=function(file,root,owner,pass,snapshot){
 const manifestFile=process.env.POS_PRECEDING_CUTOVER_SOURCE_COPY
 if(!manifestFile)return {files:0,close(){},after(){},positive(){}}
 const copy=JSON.parse(fs.readFileSync(manifestFile))
 for(const row of copy.manifest)assert.equal(hash(path.join(copy.destination,row.path)),row.sha256)
 const entry=path.join(copy.destination,'electron/database.js'),preceding=require(entry),warm=preceding(file)
 assert.equal(warm.getSalesState(owner).customerLedger.entries.length,0)
 assert.equal(warm.getSupplierState(owner).supplierLedger.entries.length,0)
 pass('genuine retained predecessor opens the same shop before cutover and reads both empty ledgers')
 return {files:copy.manifest.length,close(){warm.close()},after(productId){
  const before=snapshot()
  assert.throws(()=>warm.getSalesState(owner));assert.throws(()=>warm.getSupplierState(owner));assert.throws(()=>warm.getStockCostState(owner))
  assert.throws(()=>warm.setSetting('old-cutover-write','forbidden'))
  assert.throws(()=>warm.updateProduct(productId,{name:'forbidden old edit'}))
  assert.equal(snapshot(),before)
  let cold
  try{cold=preceding(file);assert.throws(()=>cold.getSalesState(owner));assert.throws(()=>cold.getSupplierState(owner));assert.throws(()=>cold.setSetting('old-cold-cutover-write','forbidden'))}catch(error){assert.match(error.message,/較新功能|相容版本|pos_require_feature|款項|庫存成本|回執|備份保護/)}finally{cold?.close()}
  assert.equal(snapshot(),before)
  fs.writeFileSync(path.join(root,'cutover-previous-reader.json'),JSON.stringify({files:copy.manifest.length,manifestSha256:hash(manifestFile),entry,entrySha256:hash(entry),warmReadRefused:true,warmWriteRefused:true,coldRefused:true,allTablesAndSchemaUnchanged:true},null,2))
  pass('an already-open and cold genuine predecessor refuses the new source ledger and cannot change any SQLite table or schema')
 },positive(){
  const positiveFile=path.join(root,'cutover-supported13.db'),old=preceding(positiveFile)
  try{
   for(const user of require('../fixtures/lot-count-native-v1.json').book.users)old.addUser(user)
   old.setSetting('sharedStoreId','cutover-positive13')
   const {makeOpeningMigrationInput}=require(path.join(copy.destination,'electron/openingMigrationSource.mjs')),{salesDate}=require(path.join(copy.destination,'electron/salesRules.mjs')),date=salesDate(new Date()),input=makeOpeningMigrationInput(JSON.stringify(require('../fixtures/opening-migration-source-v1.json')),old.getPrivateDraftContext(owner),date),view=old.previewOpeningMigration(input,owner)
   assert.equal(view.ready,true);assert.equal(old.applyOpeningMigration({...input,review:view.review},owner).success,true)
   let state=old.getSalesState(owner)
   const request=fields=>({id:'supported13-'+fields.action,kind:'customer-ledger',storeId:state.storeId,epoch:state.epoch,expectedRevision:state.customerLedger.revision,time:new Date().toISOString(),date,...fields})
   assert.equal(old.applyCustomerLedgerOperation(request({action:'customer-create',customer:{id:'positive13-customer',name:'Supported prior customer'}}),owner).success,true)
   state=old.getSalesState(owner)
   assert.equal(old.applyCustomerLedgerOperation(request({action:'receive',customerId:'positive13-customer',method:'bank',amount:17,confirmed:true}),owner).success,true)
   assert.equal(old.exportFullBackup(owner).protection.version,13)
  }finally{old.close()}
  const current=require('../../electron/database.js')(positiveFile)
  try{assert.equal(current.exportFullBackup(owner).protection.version,13);assert.equal(current.getSalesState(owner).customerLedger.receipts[0].available,17);assert.equal(current.getStockCostState(owner).valuation.ownedKnownValueCents,25002)}finally{current.close()}
  pass('the same genuine predecessor still creates version13 stock and a bank receipt that the current reader preserves')
 }}
}
