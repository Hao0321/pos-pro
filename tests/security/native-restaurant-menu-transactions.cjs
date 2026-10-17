const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Database=require('better-sqlite3')
const productionRoot=path.resolve(process.env.POS_MENU_SOURCE_ROOT||path.join(__dirname,'../..'))
const init=require(path.join(productionRoot,'electron/database.js')),legacy=require('../fixtures/table-kitchen-v1.json')
const {restaurantMenuFixture,bowl,choose}=require('../fixtures/restaurant-menu-v1.mjs')
const {canonicalSignature}=require('../../electron/operationRules.mjs')
const {restaurantCapacityQuantity}=require('../../electron/restaurantFunds.mjs')
const {validateStockCostBook}=require('../../electron/stockBackup.mjs')
const {readCompleteBackup}=require('../../electron/backupEnvelope.mjs')
const {buildPnL}=require('../../electron/accountingCore.mjs'),{stockPeriodDisclosure}=require('../../electron/stockAccounting.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated menu transaction store required')
const out=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(out,{recursive:true})
if(process.env.POS_MENU_SOURCE_ROOT){
 const manifestPath=process.env.POS_MENU_SOURCE_MANIFEST;if(!manifestPath)throw Error('frozen alternate source manifest required')
 const frozen=JSON.parse(fs.readFileSync(manifestPath,'utf8')),hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex')
 assert.equal(path.resolve(frozen.destination),productionRoot)
 for(const row of frozen.manifest){const file=path.resolve(productionRoot,row.path);assert.ok(file.startsWith(productionRoot+path.sep));assert.equal(hash(fs.readFileSync(file)),row.sha256,'frozen source changed: '+row.path)}
 fs.writeFileSync(path.join(out,'frozen-source-observations.json'),JSON.stringify({productionRoot,files:frozen.manifest.length,manifestSha256:hash(fs.readFileSync(manifestPath)),verified:true},null,2))
}
const owner=legacy.owner,checks=[],fixtures=[],cart=()=>[bowl(),bowl(1,{selections:[choose('extras','egg')]}),{offerId:'bowl-set',qty:2}]
let ordinal=0,stage='setup'
const ok=result=>{assert.equal(result.success,true,result.error);return result},pass=label=>{checks.push(label);console.log('PASS '+label)}
function fixture(name,active){
 const f={file:path.join(root,name+'.db')};f.db=init(f.file);fixtures.push(f)
 for(const user of legacy.before.users)f.db.addUser(user)
 const seed=restaurantMenuFixture();for(const product of seed.products)f.db.addProduct(product)
 f.db.openShift({id:'shift',cashier:owner.username,openCash:0})
 f.state=()=>f.db.getRestaurantState();f.entry=()=>f.state().entries.find(row=>row.id===f.entryId)
 f.command=(action,fields={})=>{const s=f.state();return {id:name+'-'+(++ordinal),kind:'restaurant',action,time:s.now||new Date().toISOString(),storeId:s.storeId,epoch:s.epoch,...fields}}
 f.configure=config=>ok(f.db.applyRestaurantOperation(f.command('configure',{expectedConfig:canonicalSignature(f.state().config),config}),owner))
 f.configure({...f.state().config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes})
 // A supported ordinary funded positive control is preserved in both policies.
 const initial=f.state(),ordinary=f.command('create',{fundsProtocol:'pos-restaurant-funds/v1',costMode:initial.costMode,day:initial.today,slot:'11:00',channel:'walkin',customer:'',contact:'',note:'',items:[{id:'tea',price:20,qty:1}]})
 const plain=ok(f.db.applyRestaurantOperation(ordinary,owner)).entry
 ok(f.db.applyRestaurantOperation(f.command('cancel',{entryId:plain.id,expectedVersion:plain.version,reason:'positive control'}),owner))
  pass(name+': supported ordinary funded creation and cancellation work before menu configuration')
 if(active){const s=f.db.getSalesState(owner);ok(f.db.applyStockCostOperation({id:name+'-opening',protocol:'pos-stock-cost/v1',action:'open',time:new Date().toISOString(),storeId:s.storeId,epoch:s.epoch,reviewed:true,snapshotDigest:f.db.getStockCostPreview(owner).snapshotDigest,overrides:[]},owner))}
 f.configure({...f.state().config,menu:seed.menu})
  const definitionBefore=f.db.exportData();assert.throws(()=>f.db.deleteProduct('egg',owner),/保留/);assert.deepEqual(f.db.exportData(),definitionBefore)
 f.createRequest=(items=cart(),fields={})=>{const review=f.db.getRestaurantMenuQuote({items},owner),s=f.state();return f.command('create',{fundsProtocol:'pos-restaurant-funds/v1',costMode:s.costMode,menuProtocol:'pos-restaurant-menu/v1',menuReview:review.menuReview,day:s.today,slot:'12:00',channel:'walkin',customer:'Native menu',contact:'',note:'',...fields})}
 f.apply=(action,fields={})=>{const e=f.entry();return f.db.applyRestaurantOperation(f.command(action,{entryId:e.id,expectedVersion:e.version,...fields}),owner)}
 return f
}
try{
 for(const active of [false,true]){
  const name=active?'fifo':'reference',f=fixture(name,active);stage=name+' authoritative quote'
  const before=f.db.exportData(),review=f.db.getRestaurantMenuQuote({items:cart()},owner)
  assert.equal(review.menuReview.quote.totalCents,44500);assert.equal(review.menuReview.quote.referenceCostCents,15200);assert.equal(review.menuReview.quote.capacity,6)
  assert.deepEqual(f.db.exportData(),before);assert.throws(()=>f.db.getRestaurantMenuQuote({items:cart()},{...owner,userId:'forged-owner'}),/權限/)
  assert.equal(f.db.exportFullBackup(owner).protection.version,7)
  pass(name+': authenticated SQLite quote reads saved definitions and actual scope without mutation; format7 protects configuration even before menu orders exist')

  stage=name+' create and original recovery';const request=f.createRequest(),created=ok(f.db.applyRestaurantOperation(request,owner));f.entryId=request.id
  assert.equal(created.entry.total,445);assert.equal(created.entry.items.length,3);assert.equal(restaurantCapacityQuantity(created.entry),6)
  assert.ok(created.receipt.productIds.every(id=>!id.startsWith('ml-')))
  assert.deepEqual(Object.fromEntries(f.db.getProducts().map(p=>[p.id,p.stock])),{bowl:0,rice:9.2,beef:9.6,box:96,egg:19,tea:8})
  const once=f.db.exportData();ok(f.db.applyRestaurantOperation(request,owner));assert.deepEqual(f.db.exportData(),once)
  assert.equal(f.db.applyRestaurantOperation({...request,note:'changed original'},owner).success,false);assert.deepEqual(f.db.exportData(),once)
  if(active){assert.ok(created.costReceipt);validateStockCostBook(once)}
  pass(name+': three distinct selected lines reserve exact raw resources and six capacity units once; original replay and same-ID conflict preserve the entire book')

  stage=name+' late SQL rollback';const sql=new Database(f.file);require('../../electron/databaseFeatureFence.cjs').register(sql)
  sql.exec("CREATE TRIGGER menu_late_failure BEFORE INSERT ON restaurant_operations WHEN NEW.id='late-menu' BEGIN SELECT RAISE(ABORT,'fixture menu late failure'); END")
  const late={...f.createRequest([bowl()]),id:'late-menu'},beforeFailure=f.db.exportData(),failed=f.db.applyRestaurantOperation(late,owner)
  assert.equal(failed.success,false);assert.equal(failed.committed,false);assert.deepEqual(f.db.exportData(),beforeFailure)
  sql.exec('DROP TRIGGER menu_late_failure');sql.close()
  const raw={...f.createRequest([bowl()]),items:[{id:'bowl',qty:1,price:1}]};assert.equal(f.db.applyRestaurantOperation(raw,owner).success,false);assert.deepEqual(f.db.exportData(),beforeFailure)
  pass(name+': a late SQLite abort and a client-injected raw price leave stock, order, cash, source history and FIFO unchanged')

  stage=name+' selective cancellation';ok(f.apply('funds-receive',{amount:400,paid:400,payMethod:'cash',shiftId:'shift'}));ok(f.apply('funds-receive',{amount:45,paid:45,payMethod:'card',shiftId:'shift'}))
  const added=f.entry().menu.quote.lineFacts.find(row=>row.offerId==='bowl-offer'&&row.selections.some(group=>group.groupId==='extras'&&group.choices.length)).lineId
  const released=ok(f.apply('cancel-part',{quantities:[{id:added,qty:1}],reason:'cancel selected egg meal',shiftId:'shift'}))
  assert.deepEqual(released.fundsEvent.refunds.map(row=>[row.method,row.amountCents]),[['card',4500],['cash',7000]])
  assert.equal(f.entry().total,330);assert.equal(restaurantCapacityQuantity(f.entry()),5);assert.equal(f.db.getProducts().find(p=>p.id==='egg').stock,20)
  ok(f.apply('advance',{status:'cooking'}));const combo=f.entry().menu.quote.lineFacts.find(row=>row.offerId==='bowl-set').lineId,stock=f.db.getProducts()
  ok(f.apply('cancel-part',{quantities:[{id:combo,qty:1}],reason:'cancel one prepared set',shiftId:'shift'}));assert.deepEqual(f.db.getProducts(),stock)
  assert.equal(f.entry().total,215);assert.equal(restaurantCapacityQuantity(f.entry()),5);assert.equal(f.db.getWasteLog().reduce((sum,row)=>sum+row.qty*row.cost,0),38)
  ok(f.apply('advance',{status:'ready'}));const delivered=ok(f.apply('advance',{status:'completed'}));assert.equal(delivered.order.total,215)
  if(active){validateStockCostBook(f.db.exportData());const report=f.db.getStockAccountingState(owner),day=f.state().today,pnl=buildPnL(report.journals,day,day,stockPeriodDisclosure(report,day,day));assert.equal(pnl.revenue,215);assert.equal(pnl.cogs,71);assert.equal(pnl.opExpenses,38)}
  pass(name+': selected cancellations refund original mixed tenders, release only unprepared resources and keep prepared loss/capacity; one fulfilment recognizes215 and actual FIFO retains71 COGS plus38 loss when enabled')

  stage=name+' immutable source and backup';const original=structuredClone(f.entry().menu),config=structuredClone(f.state().config);config.menu.offers[0].variants[0].price=110;f.configure(config)
  const repriced=f.db.exportData();assert.equal(f.db.applyRestaurantOperation({...request,id:'stale-'+name},owner).success,false);assert.deepEqual(f.db.exportData(),repriced);ok(f.db.applyRestaurantOperation(request,owner));assert.deepEqual(f.entry().menu,original)
  const packet=f.db.exportFullBackup(owner);assert.equal(packet.protection.version,7);assert.ok(packet.features.includes('restaurant-menu-v1'))
  assert.deepEqual(readCompleteBackup(JSON.parse(JSON.stringify(packet)),'sqlite').book,repriced)
  const oldEpoch=f.state().epoch;f.db.close();f.db=init(f.file);assert.deepEqual(f.db.exportData(),repriced);ok(f.db.applyRestaurantOperation(request,owner))
  const preview=f.db.previewRestore({kind:'import',data:packet},owner);ok(f.db.applyRestorePreview(preview.id,owner));assert.notEqual(f.state().epoch,oldEpoch);assert.deepEqual(f.entry().menu,original)
  const restored=f.db.exportData();ok(f.db.applyRestaurantOperation(request,owner));assert.deepEqual(f.db.exportData(),restored)
  const fresh=ok(f.db.applyRestaurantOperation(f.createRequest([bowl()]),owner));assert.equal(fresh.entry.total,110);assert.notEqual(fresh.entry.menu.quote.scope.epoch,original.quote.scope.epoch)
  if(active)validateStockCostBook(f.db.exportData())
  fs.writeFileSync(path.join(out,name+'-full-backup.json'),JSON.stringify(f.db.exportFullBackup(owner)))
  pass(name+': source definitions survive repricing, exact SQLite reopen, complete format7 restore and old-ID replay; fresh orders use the new epoch and reviewed110 price')
 }
 stage='cancelled original product retention';const retained=fixture('retention',false),original=retained.createRequest([bowl(1,{selections:[choose('extras','egg')]})]);retained.entryId=original.id
 ok(retained.db.applyRestaurantOperation(original,owner));ok(retained.apply('cancel',{reason:'fully cancelled original'}))
 const {menu,...withoutMenu}=retained.state().config;retained.configure({...withoutMenu,recipes:{}})
 const retainedBefore=retained.db.exportData();for(const id of ['bowl','egg','rice']){assert.throws(()=>retained.db.deleteProduct(id,owner),/保留/);assert.deepEqual(retained.db.exportData(),retainedBefore)}
 retained.db.addProduct({id:'unrelated',name:'Unrelated',unit:'個',stock:0,price:1,cost:0});ok(retained.db.deleteProduct('unrelated',owner));assert.equal(retained.db.exportFullBackup(owner).protection.version,7)
 pass('actual SQLite preserves base products and raw ingredients of fully cancelled originals after the current menu/recipe is removed, while unrelated deletion remains supported')
 fs.writeFileSync(path.join(out,'menu-transactions-observations.json'),JSON.stringify({schemaVersion:1,productionRoot,checks,realSQLite:true,activeFIFO:true,referencePolicy:true,completeBackup:true,realUI:false,physicalDevices:false,fullMenuFeatureComplete:false},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_MENU_TRANSACTIONS_PASS',tests:checks.length,physicalDevices:false}))
 for(const f of fixtures)f.db.close()
}catch(error){console.error(stage,error.stack);for(const f of fixtures)try{f.db.close()}catch{}process.exitCode=1}
