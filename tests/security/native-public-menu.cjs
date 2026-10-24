const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),Database=require('better-sqlite3')
const productionRoot=path.resolve(process.env.POS_PUBLIC_MENU_SOURCE_ROOT||path.join(__dirname,'../..')),init=require(path.join(productionRoot,'electron/database.js')),start=require(path.join(productionRoot,'electron/orderServer.cjs'))
const legacy=require('../fixtures/table-kitchen-v1.json'),{restaurantMenuFixture,bowl,choose}=require('../fixtures/restaurant-menu-v1.mjs'),{canonicalSignature}=require('../../electron/operationRules.mjs')
const {validateCustomerMenuOrder,assertCustomerMenuAuthentication}=require('../../electron/restaurantCustomerMenu.mjs'),{assertPublicMenuQuote,PUBLIC_MENU_PROTOCOL}=require('../../public/menu/menuProtocol.mjs'),{makeCustomerIntake}=require('../../electron/tableOrdering.mjs')
const {validateStockCostBook}=require('../../electron/stockBackup.mjs'),{readCompleteBackup,createCompleteBackup}=require('../../electron/backupEnvelope.mjs'),{stockLedgerDigest}=require('../../electron/stockLedgerModel.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated public menu root required')
const out=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(out,{recursive:true});const owner=legacy.owner,checks=[],fixtures=[],hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
let ordinal=0,stage='setup';const ok=value=>{assert.equal(value.success,true,value.error);return value},pass=label=>{checks.push(label);console.log('PASS '+label)},cart=()=>[bowl(),bowl(1,{selections:[choose('extras','egg')]}),{offerId:'bowl-set',qty:2}]
if(process.env.POS_PUBLIC_MENU_SOURCE_ROOT){const frozen=JSON.parse(fs.readFileSync(process.env.POS_PUBLIC_MENU_SOURCE_MANIFEST,'utf8'));assert.equal(path.resolve(frozen.destination),productionRoot);for(const row of frozen.manifest)assert.equal(hash(path.join(productionRoot,row.path)),row.sha256);fs.writeFileSync(path.join(out,'frozen-source.json'),JSON.stringify({productionRoot,files:frozen.manifest.length,manifestSha256:hash(process.env.POS_PUBLIC_MENU_SOURCE_MANIFEST),verified:true},null,2))}
async function fixture(name,active){
 const f={file:path.join(root,name+'.db'),server:null},seed=restaurantMenuFixture();fixtures.push(f);f.db=init(f.file)
 for(const user of legacy.before.users)f.db.addUser(user);for(const product of seed.products)f.db.addProduct(product);f.db.openShift({id:'shift',cashier:owner.username,openCash:0})
 f.state=()=>f.db.getRestaurantState();f.command=(action,fields={})=>{const s=f.state();return {id:name+'-'+(++ordinal),kind:'restaurant',action,time:s.now||new Date().toISOString(),storeId:s.storeId,epoch:s.epoch,...fields}}
 f.configure=config=>ok(f.db.applyRestaurantOperation(f.command('configure',{expectedConfig:canonicalSignature(f.state().config),config}),owner))
 f.configure({...f.state().config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes})
 f.listen=async()=>{f.server=start(0,f.db,()=>null,{host:'127.0.0.1',disableTunnel:true});await f.server.ready;f.base='http://127.0.0.1:'+f.server.getActualPort()}
 f.post=(route,body)=>fetch(f.base+route,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify(body)})
 await f.listen();const plain=ok(await(await f.post('/api/order',{requestId:randomUUID(),items:[{id:'tea',qty:1}],note:'ordinary positive control'})).json());assert.equal(plain.total,20)
 pass(name+': actual same-origin ordinary customer order still creates one pending20 original before selected-menu activation')
 if(active){const s=f.db.getSalesState(owner);ok(f.db.applyStockCostOperation({id:name+'-opening',protocol:'pos-stock-cost/v1',action:'open',time:new Date().toISOString(),storeId:s.storeId,epoch:s.epoch,reviewed:true,snapshotDigest:f.db.getStockCostPreview(owner).snapshotDigest,overrides:[]},owner))}
 f.configure({...f.state().config,menu:seed.menu,tableOrdering:{version:1,enabled:true,tables:[{id:'table-1',label:'1'}]}});f.table=f.db.getTableOrderingContext(owner).tables[0]
 f.review=async(items=cart())=>ok(await(await f.post('/api/menu/quote',{items,table:f.table.id,key:f.table.key})).json()).menuReview
 f.request=q=>({requestId:randomUUID(),menuProtocol:PUBLIC_MENU_PROTOCOL,items:q.input,menuReview:q,table:f.table.id,key:f.table.key,tableNum:'1',customerName:'Guest',note:'less salt'})
 f.entry=()=>f.state().entries.find(row=>row.id===f.entryId)
 f.apply=(action,fields={})=>{const e=f.entry();return f.db.applyRestaurantOperation(f.command(action,{entryId:e.id,expectedVersion:e.version,...fields}),owner)}
 return f
}
;(async()=>{try{
 for(const active of [false,true]){
  const name=active?'fifo':'reference',f=await fixture(name,active);stage=name+' public projection'
  const query=new URLSearchParams({table:f.table.id,key:f.table.key}),menu=await(await fetch(f.base+'/api/menu?'+query)).json()
  assert.equal(menu.menu?.protocol,PUBLIC_MENU_PROTOCOL);assert.deepEqual(menu.products,[]);const before=f.db.exportData(),review=await f.review();assertPublicMenuQuote(review);assert.equal(review.totalCents,44500)
  for(const key of ['recipes','components','unitCost','costMode','epoch','configurationId','source','scope'])assert.equal(JSON.stringify(menu).includes('"'+key+'"'),false);assert.deepEqual(f.db.exportData(),before)
  pass(name+': real HTTP menu and review expose only public choices/prices; SQLite catalogue, stock, money and source records remain unchanged during quoting')

  stage=name+' source and native admission';const request=f.request(review),response=ok(await(await f.post('/api/order',request)).json()),source=f.db.getOrder(response.orderId)
  assert.equal(response.total,445);validateCustomerMenuOrder(source);assertCustomerMenuAuthentication(source,f.db.getSetting('orderReceiptSecret'));assert.equal(source.trackingProof.version,2);assert.equal(source.tableNum,'1');assert.equal(source.items.length,3)
  const saved=f.db.exportData();assert.throws(()=>f.db.addOrder({...source,id:'CO'+randomUUID()}),/正式點餐/);assert.deepEqual(f.db.exportData(),saved)
  const packet=f.db.exportFullBackup(owner);assert.equal(packet.protection.version,8);assert.ok(packet.features.includes('restaurant-public-menu-v1'));assert.deepEqual(readCompleteBackup(packet,'sqlite').book,saved)
  fs.writeFileSync(path.join(out,name+'-pending-backup.json'),JSON.stringify(packet))
  pass(name+': reviewed HTTP input writes one real SQLite source with authenticated private provenance and a version2 tracking proof; direct native injection is refused and complete backup uses protection8')

  stage=name+' complete packet floor';for(const version of [6,7]){
   const graph={...structuredClone(packet.protection),version};assert.throws(()=>createCompleteBackup(saved,graph,'sqlite'))
   const {checksum,...body}=structuredClone(packet);body.protection=graph;const lowered={...body,checksum:stockLedgerDigest(body)}
   assert.throws(()=>readCompleteBackup(lowered,'sqlite'));assert.throws(()=>f.db.previewRestore({kind:'import',data:lowered},owner));assert.deepEqual(f.db.exportData(),saved)
  }
  const {checksum,...withoutFeature}=structuredClone(packet);withoutFeature.features=withoutFeature.features.filter(value=>value!=='restaurant-public-menu-v1');const stripped={...withoutFeature,checksum:stockLedgerDigest(withoutFeature)}
  assert.throws(()=>readCompleteBackup(stripped,'sqlite'));assert.throws(()=>f.db.previewRestore({kind:'import',data:stripped},owner));assert.deepEqual(f.db.exportData(),saved)
  pass(name+': producer and reader reject protection6/7 or missing public-source feature even with a recomputed checksum, preserving the complete original book')

  stage=name+' pending restore and intake';await f.server.close();f.db.close();f.db=init(f.file);assert.deepEqual(f.db.exportData(),saved)
  const oldEpoch=f.state().epoch,restore=f.db.previewRestore({kind:'import',data:packet},owner);ok(f.db.applyRestorePreview(restore.id,owner));assert.notEqual(f.state().epoch,oldEpoch);await f.listen()
  const replayed=ok(await(await f.post('/api/order',request)).json());assert.deepEqual(replayed,response)
  const context=f.db.getCustomerIntakeContext(source.id,owner),s=f.state(),accept={...makeCustomerIntake(context.order,new Date(context.now)),menuReview:context.menuReview,id:name+'-intake',kind:'restaurant',time:context.now,day:context.day,slot:context.slot,storeId:s.storeId,epoch:s.epoch,costMode:s.costMode,fundsProtocol:'pos-restaurant-funds/v1'}
  const accepted=ok(f.db.applyRestaurantOperation(accept,owner));f.entryId=accepted.entry.id
  assert.equal(accepted.entry.total,445);assert.equal(accepted.entry.customerOrderId,source.id);assert.equal(accepted.entry.tableNum,'1');assert.notEqual(accepted.entry.menu.quote.scope.epoch,source.customerMenu.menuReview.quote.scope.epoch)
  const once=f.db.exportData();ok(f.db.applyRestaurantOperation(accept,owner));assert.deepEqual(f.db.exportData(),once)
  pass(name+': pending selected original survives actual SQLite reopen/complete restore and old HTTP replay; a fresh authenticated intake rebases only recovery/time while preserving the exact customer choices/prices once')

  stage=name+' collect and kitchen';ok(f.apply('funds-receive',{amount:400,paid:400,payMethod:'cash',shiftId:'shift'}));ok(f.apply('funds-receive',{amount:45,paid:45,payMethod:'card',shiftId:'shift'}));ok(f.apply('advance',{status:'cooking'}));ok(f.apply('advance',{status:'ready'}));const delivered=ok(f.apply('advance',{status:'completed'}));assert.equal(delivered.order.total,445)
  const egg=f.entry().menu.quote.lineFacts.find(row=>row.offerId==='bowl-offer'&&row.selections.some(group=>group.groupId==='extras'&&group.choices.length)).lineId
  const originalStock=f.db.getProducts();ok(f.apply('cancel-part',{quantities:[{id:egg,qty:1}],reason:'selected prepared return',shiftId:'shift'}));assert.equal(f.entry().total,330);assert.deepEqual(f.db.getProducts(),originalStock)
  const tracked=await(await fetch(f.base+'/api/order/'+response.orderId,{headers:{Authorization:'Bearer '+response.trackingToken}})).json();assert.equal(tracked.order.total,445);assert.equal(tracked.order.fulfilmentStatus,'completed');assert.equal(JSON.stringify(tracked).includes('customerMenu'),false)
  if(active)validateStockCostBook(f.db.exportData())
  pass(name+': the same selected original reaches real funds, kitchen stages, fulfilment and a selected prepared refund without returning used stock or exposing private source in tracking')

  stage=name+' tampered original restore';const authoritative=f.db.exportData()
  for(const mutate of [order=>delete order.customerMenu,order=>order.trackingProof.menuSignature='0'.repeat(64),order=>{order.customerMenu.request.note='forged';order.note='Guest: forged';order.requestSignature=require('../../electron/restaurantCustomerMenu.mjs').customerMenuRequestSignature(order.customerMenu.request)}]){
   const bad=structuredClone(authoritative);mutate(bad.orders.find(row=>row.id===source.id));assert.throws(()=>f.db.previewRestore({kind:'import',data:bad},owner));assert.deepEqual(f.db.exportData(),authoritative)
  }
  const lateRequest=f.request(await f.review([bowl()])),sql=new Database(f.file);require('../../electron/databaseFeatureFence.cjs').register(sql)
  sql.exec("CREATE TRIGGER public_menu_late_failure BEFORE INSERT ON order_items WHEN NEW.orderId='CO"+lateRequest.requestId+"' BEGIN SELECT RAISE(ABORT,'fixture late selected original'); END")
  const beforeLate=f.db.exportData(),late=await f.post('/api/order',lateRequest);assert.equal(late.status,400);assert.deepEqual(f.db.exportData(),beforeLate);sql.exec('DROP TRIGGER public_menu_late_failure');sql.close()
  fs.writeFileSync(path.join(out,name+'-public-menu-backup.json'),JSON.stringify(f.db.exportFullBackup(owner)))
  pass(name+': missing sources, forged authenticated originals and a late actual SQL insert failure preserve the complete current financial/inventory/backup book')
 }
 fs.writeFileSync(path.join(out,'public-menu-observations.json'),JSON.stringify({checks,realHTTP:true,realSQLite:true,reference:true,activeFIFO:true,completeBackup:true,realMenuUI:false,physicalDevices:false},null,2));console.log(JSON.stringify({success:true,marker:'POS_PUBLIC_MENU_PASS',tests:checks.length,physicalDevices:false}))
 for(const f of fixtures){await f.server.close();f.db.close()}
}catch(error){console.error(stage,error.stack);for(const f of fixtures)try{await f.server?.close();f.db?.close()}catch{}process.exitCode=1}})()
