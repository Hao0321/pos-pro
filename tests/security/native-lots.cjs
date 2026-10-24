const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pbkdf2Sync}=require('node:crypto')
const RealDate=Date;let clock=RealDate.parse('2026-10-17T15:55:00.000Z')
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
const Database=require('better-sqlite3'),init=require('../../electron/database.js'),{prepareCheckout,localDate}=require('../../electron/checkoutSafety.cjs'),{canonicalSignature}=require('../../electron/operationRules.mjs'),{readPortableBackup}=require('../../electron/backupEnvelope.mjs'),{newStockHistoryQuery,assertStockHistoryResult}=require('../../electron/stockHistory.mjs'),{stockPeriodDisclosure}=require('../../electron/stockAccounting.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated lot fixture required')
const file=path.join(root,'lots.db'),owner={userId:'owner',username:'Lot fixture',role:'owner'},staff={userId:'staff',username:'Lot staff',role:'staff'}
let db,raw,checks=0,serial=0
const ok=value=>{assert.equal(value.success,true,value.error);return value},pass=text=>{checks++;console.log('PASS '+text)},state=()=>db.getStockCostState(owner),book=()=>db.exportData(),stock=()=>db.getProducts().find(row=>row.id==='rice').stock
const lot=(action,fields={})=>{const {context}=db.getLotState(owner);return {protocol:'pos-stock-lots/v1',id:'lot-fixture-'+(++serial),time:context.now,storeId:context.storeId,epoch:context.epoch,expectedStateDigest:context.stateDigest,action,...fields}}
const apply=(action,fields={},actor=owner)=>ok(db.applyLotOperation(lot(action,fields),actor))
const restaurant=(action,fields={})=>({kind:'restaurant',id:'restaurant-'+(++serial),time:new Date().toISOString(),action,...fields})
const warehouse=(action,fields={})=>{const {context}=db.getWarehouseState(owner);return {protocol:'pos-warehouse/v1',id:'lot-warehouse-'+(++serial),time:context.now,storeId:context.storeId,epoch:context.epoch,expectedStateDigest:context.stateDigest,action,...fields}}
const physicalSnapshot=()=>Object.fromEntries(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,raw.prepare('SELECT * FROM "'+name+'"').all().sort((a,b)=>canonicalSignature(a).localeCompare(canonicalSignature(b)))]))
try{
 db=init(file);raw=new Database(file)
 const salt=Buffer.alloc(32,31),password=JSON.stringify({salt:[...salt],iter:1000,hash:[...pbkdf2Sync('lot-fixture-password',salt,1000,32,'sha256')]})
 for(const actor of [owner,staff])db.addUser({id:actor.userId,username:actor.username,role:actor.role,password})
 db.setSetting('sharedStoreId','lot-fixture');ok(db.addProduct({id:'rice',name:'Rice',unit:'公斤',stock:3,cost:1.01,price:10}));db.addSupplier({id:'supplier',name:'Fixture supplier'});db.openShift({id:'shift',openCash:100,cashier:owner.username})
 const beforeInactive=book();assert.equal(db.getLotState(staff).active,false);assert.deepEqual(book(),beforeInactive)
 for(const actor of [null,{...owner,username:'forged'},{...owner,userId:staff.userId}])assert.throws(()=>db.getLotState(actor),/權限/)
 const scope=db.getSalesState(owner);ok(db.applyStockCostOperation({protocol:'pos-stock-cost/v1',id:'opening',time:new Date().toISOString(),storeId:scope.storeId,epoch:scope.epoch,action:'open',reviewed:true,snapshotDigest:db.getStockCostPreview(owner).snapshotDigest,overrides:[]},owner))
 ok(db.applyInventoryOperation({kind:'purchase-create',id:'purchase-create',time:new Date().toISOString(),purchase:{id:'purchase',supplierId:'supplier',date:localDate(),items:[{productId:'rice',name:'Rice',unit:'公斤',qty:3,unitCost:2.02,received:0}]}},owner))
 ok(db.applyInventoryOperation({kind:'receive',id:'receipt',time:new Date().toISOString(),purchaseId:'purchase',expectedPurchase:canonicalSignature(db.getPurchases().find(row=>row.id==='purchase')),quantities:[3]},owner))
 const originalSources=state().projection.custody.sources;assert.deepEqual(originalSources.map(row=>row.valueCents),[303,606]);assert.equal(stock(),6);assert.equal(state().valuation.ownedKnownValueCents,909)
 pass('inactive reads and forged account controls preserve the book; native opening and actual purchase receiving retain two original 303/606-cent sources')

 const activation=lot('activate',{timeZone:'Asia/Taipei'}),beforeActivation=book()
 fs.writeFileSync(path.join(root,'lots-before.json'),JSON.stringify(beforeActivation))
 raw.exec("CREATE TRIGGER fixture_lot_late BEFORE INSERT ON stock_cost_operations BEGIN SELECT RAISE(ABORT,'fixture lot late failure'); END;")
 const rejected=db.applyLotOperation(activation,owner);assert.equal(rejected.success,false);assert.equal(rejected.committed,false);assert.deepEqual(book(),beforeActivation);assert.equal(raw.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'pos_lot_guard_%'").get().n,0)
 raw.exec('DROP TRIGGER fixture_lot_late');const activated=ok(db.applyLotOperation(activation,owner));assert.deepEqual(state().projection.custody.sources,originalSources);assert.equal(state().projection.custody.version,2)
 pass('late first activation failure rolls back the lot fence, marker, stock and every collection before the exact original succeeds once')

 const beforeRoles=book();assert.equal(db.applyLotOperation(lot('track',{productId:'rice',required:true}),staff).success,false);assert.deepEqual(book(),beforeRoles)
 apply('label',{sourceId:originalSources[0].id,quantityUnits:3000,code:'later',expiryDate:'2026-10-19',receivedAt:null});apply('label',{sourceId:originalSources[1].id,quantityUnits:3000,code:'soon',expiryDate:'2026-10-18',receivedAt:null});apply('track',{productId:'rice',required:true})
 const soon=db.getLotState(owner).lots.find(row=>row.code==='soon');assert.ok(soon);assert.equal(stock(),6);assert.equal(db.getLotState(staff).lots[0].heldCost,null)
 const config=db.getRestaurantState().config;ok(db.applyRestaurantOperation(restaurant('configure',{expectedConfig:canonicalSignature(config),config:{...config,enabled:true}}),owner))
 clock=RealDate.parse('2026-10-17T16:05:00.000Z')
 ok(db.applyWarehouseOperation(warehouse('location',{locationId:'backroom',label:'備貨區'}),owner));ok(db.applyWarehouseOperation(warehouse('transfer',{productId:'rice',unit:'公斤',quantity:'1',fromLocationId:'main',toLocationId:'backroom'}),staff));const back=state().projection.custody.positions.find(row=>row.owner.stage==='available'&&row.owner.locationId==='backroom');assert.equal(back.segments[0].sourceId,originalSources[1].id);assert.equal(back.segments[0].queueOrder,2)
 const sale=prepareCheckout({id:'sale',cart:[{id:'rice',qty:1,price:10}],products:db.getProducts(),members:[],activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:0,openShift:db.getOpenShift(),payMethod:'cash',paid:10,opts:{cashier:owner.username},now:new Date()})
 const sold=ok(db.checkout(sale.order,sale.stockUpdates,sale.memberUpdate,owner)),saleEffect=state().projection.business.find(row=>row.id==='sale').effects[0]
 assert.equal(saleEffect.segments[0].sourceId,originalSources[1].id);assert.equal(saleEffect.cost.knownValueCents,202)
 const reserved=ok(db.applyRestaurantOperation(restaurant('create',{channel:'walkin',day:localDate(),slot:'12:00',customer:'Fixture',contact:'',note:'',items:[{id:'rice',qty:1,price:10}]}),owner)).entry
 assert.equal(stock(),3);assert.equal(state().valuation.ownedKnownValueCents,707)
 pass('native two-warehouse transfer, checkout and reservation choose the newer sooner-expiring original source at 202 cents, preserving its FIFO age and the inclusive local expiry day')

 clock=RealDate.parse('2026-10-18T16:01:00.000Z');const beforeSweep=physicalSnapshot()
 raw.exec("CREATE TRIGGER fixture_lot_late BEFORE INSERT ON stock_cost_operations BEGIN SELECT RAISE(ABORT,'fixture expiry late failure'); END;")
 assert.throws(()=>db.getProducts());assert.deepEqual(physicalSnapshot(),beforeSweep)
 raw.exec('DROP TRIGGER fixture_lot_late');assert.equal(stock(),3);assert.equal(state().valuation.ownedKnownValueCents,707);assert.equal(state().valuation.categories.quarantined.knownValueCents,202);assert.equal(state().projection.custody.positions.find(row=>row.owner.stage==='quarantined').owner.locationId,'backroom')
 const beforeExpiredAction=book(),cooking=restaurant('advance',{entryId:reserved.id,expectedVersion:reserved.version,status:'cooking'}),expiredAction=db.applyRestaurantOperation(cooking,owner)
 assert.equal(expiredAction.success,false);assert.equal(expiredAction.errorCode,'STOCK_LOT_RESERVED');assert.deepEqual(book(),beforeExpiredAction)
 pass('next-day authoritative expiry atomically removes only unsold expired stock without a write-off; a late failure leaves every table unchanged and expired reservations cannot start cooking')

 const refund={id:'refund',refundOf:'sale',items:[{id:'rice',qty:1}],time:new Date().toISOString(),reason:'Original return',cashier:owner.username,shiftId:'shift'}
 ok(db.refundOrder('sale',refund,owner));assert.equal(stock(),3);assert.equal(state().valuation.categories.quarantined.knownValueCents,404)
 ok(db.applyRestaurantOperation(restaurant('cancel',{entryId:reserved.id,expectedVersion:reserved.version,reason:'Unused expired batch'}),owner));assert.equal(stock(),3);assert.equal(state().valuation.categories.quarantined.knownValueCents,606);assert.equal(state().valuation.ownedKnownValueCents,909)
 const returned=state().projection.business.find(row=>row.id==='refund').effects[0];assert.equal(returned.segments[0].sourceId,originalSources[1].id);assert.equal(returned.to.stage,'quarantined')
 pass('original-sale refund and unused-reservation cancellation return their exact expired original intervals to quarantine without reviving sellable quantity or losing asset value')

 ok(db.updateProduct('rice',{cost:.50},owner));const disposal=lot('dispose',{lotId:soon.id,locationId:'main',quantityUnits:1000,reason:'Checked and discarded expired package'}),disposed=ok(db.applyLotOperation(disposal,staff))
 assert.equal(stock(),3);assert.equal(state().valuation.ownedKnownValueCents,707);const journal=state().projection.journals.find(row=>row.id==='stock-lot:'+disposal.id);assert.deepEqual(journal.lines,[{account:'5208',debitCents:202,creditCents:0},{account:'1211',debitCents:0,creditCents:202}]);assert.equal(db.getWasteLog()[0].cost,.5)
 assert.equal(db.getLotState(owner).wasteCosts.find(row=>row.wasteId==='lot-waste-'+disposal.id).valueCents,202);assert.equal(db.getLotState(staff).wasteCosts,null)
 const afterDisposal=book();assert.deepEqual(db.applyLotOperation(disposal,staff),disposed);assert.equal(db.applyLotOperation({...disposal,quantityUnits:2000},staff).success,false);assert.deepEqual(book(),afterDisposal)
 pass('staff disposal records 202-cent original source cost once, independently of the changed 50-cent reference, and changed same-ID contents preserve all data')

 const report=db.getStockAccountingState(owner);assert.equal(report.valuation.ownedKnownValueCents,707);assert.equal(report.journals.filter(row=>row.id==='JWlot-waste-'+disposal.id).length,0);assert.equal(stockPeriodDisclosure(report,'2026-10-17','2026-10-19').assetsComplete,true);assert.equal(db.getStockSalesState(owner).status,'active');assert.equal(db.getStockSalesState(staff).status,'active')
 const query={...newStockHistoryQuery(),productId:'rice',sourceId:soon.sourceId},history=assertStockHistoryResult(db.getStockHistory(query,owner),query);assert.equal(history.protocol,'pos-stock-history/v2');assert.equal(history.source.states.quarantined.quantityUnits,2000);assert.equal(history.product.heldCost.knownValueCents,707);assert.ok(history.rows.some(row=>row.parts.some(part=>part.to==='quarantined')))
 assert.throws(()=>assertStockHistoryResult({...history,protocol:'pos-stock-history/v1'},query));pass('actual accounting and source-history reports retain quarantined assets, replace the reference write-off once, and reject a six-state reply mislabeled as the old protocol')

 const backup=db.exportFullBackup(owner);assert.ok(backup.features.includes('stock-lots-v1'));assert.deepEqual(readPortableBackup(backup,'sqlite').book.stockCostEntries,afterDisposal.stockCostEntries);fs.writeFileSync(path.join(root,'lots-backup.json'),JSON.stringify(backup));const final=book();raw.close();raw=null;db.close();db=init(file)
 assert.deepEqual(book(),final);assert.deepEqual(db.applyLotOperation(activation,owner),activated);assert.deepEqual(db.applyLotOperation(disposal,staff),disposed);assert.deepEqual(ok(db.checkout(sale.order,sale.stockUpdates,sale.memberUpdate,owner)).costReceipt,sold.costReceipt);assert.deepEqual(book(),final)
 const restore=db.previewRestore({kind:'import',data:backup},owner);ok(db.applyRestorePreview(restore.id,owner));assert.deepEqual(book(),final);assert.deepEqual(db.applyLotOperation(disposal,staff),disposed)
 pass('complete feature-declared backup, actual cold reopen and protected restore preserve lot intervals, six-state costs, and original acknowledgements across runtime epochs')
 clock=RealDate.parse('2026-10-17T16:05:00.000Z');assert.equal(stock(),3);assert.equal(db.getLotState(owner).context.day,'2026-10-19');assert.equal(state().valuation.categories.quarantined.knownValueCents,404)
 pass('clock rollback keeps the last observed store day and cannot revive quarantined originals')
 const earlier=db.previewRestore({kind:'import',data:beforeActivation},owner);ok(db.applyRestorePreview(earlier.id,owner));const earlierBook=book(),archived=db.applyLotOperation(disposal,staff);assert.equal(archived.success,false);assert.equal(archived.committed,null);assert.equal(archived.errorCode,'RECOVERY_REQUIRED');assert.deepEqual(book(),earlierBook);assert.equal(earlierBook.settings.find(row=>row.key==='stockLotVersionFence').value,'1');assert.equal(db.getRecoveryState({kind:'lots',request:disposal},owner).active,'missing');assert.ok(db.exportFullBackup(owner).features.includes('stock-lots-v1'));const modern=db.previewRestore({kind:'import',data:backup},owner);ok(db.applyRestorePreview(modern.id,owner));assert.deepEqual(book(),final);assert.deepEqual(db.applyLotOperation(disposal,staff),disposed)
 pass('restoring the actual preceding book retains the lot version fence and archived original, refuses a second historical disposal, and restores the modern original without re-execution')
 console.log(JSON.stringify({success:true,marker:'POS_LOTS_NATIVE_PASS',tests:checks,scope:'isolated actual SQLite with controlled store clock; no production merchant data or physical-device claim'}));db.close();global.Date=RealDate;process.exit(0)
}catch(error){console.error(error.stack);try{raw?.close();db?.close()}catch{}global.Date=RealDate;process.exit(1)}
