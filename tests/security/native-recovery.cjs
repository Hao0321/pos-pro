const assert=require('node:assert/strict'),path=require('node:path'),Database=require('better-sqlite3'),{pbkdf2Sync}=require('node:crypto')
const init=require('../../electron/database.js'),{productReference}=require('../../electron/businessExchange.mjs')
const {canonicalSignature}=require('../../electron/operationRules.mjs'),{prepareCheckout}=require('../../electron/checkoutSafety.cjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated fixture required')
const owner={userId:'owner',username:'Recovery owner',role:'owner'},time=new Date().toISOString()
const password=value=>JSON.stringify({salt:Array(32).fill(1),iter:1000,hash:[...pbkdf2Sync(value,Buffer.alloc(32,1),1000,32,'sha256')]})
let tests=0,db,raw;const pass=name=>{tests++;console.log('PASS '+name)}
function seed(name){
  db=init(path.join(root,name+'.db'));raw=new Database(path.join(root,name+'.db'))
  db.addUser({id:'owner',username:owner.username,password:password('fixture-password'),role:'owner'})
  db.setSettings({sharedStoreId:'recovery-store',storeName:'Recovery fixture'})
  db.addProduct({id:'p',name:'Fixture',unit:'個',stock:5,price:10,cost:4});db.addMember({id:'m',name:'Member',balance:0,points:0})
  db.openShift({id:'shift',cashier:owner.username,openCash:100})
}
function close(){raw?.close();db?.close();raw=null;db=null}
const backup=()=>db.createBackup('before operation',owner.username).id
const restore=id=>{const preview=db.previewRestore({kind:'backup',id},owner);return db.applyRestorePreview(preview.id,owner)}
const recover=(pending,id='recovery-original')=>{
  const state=db.getRecoveryState(pending,owner),source=state.sources.find(s=>s.canRecover)
  assert.ok(source,'a matching protected original must be offered')
  const request={id,sourceId:source.id,expectedRevision:state.revision,pending}
  return {result:db.applyRecoveryOperation(request,owner),request}
}
function roundTrip(pending,commit){
  const saved=backup();let result=commit();assert.equal(result.success,true,result.error)
  const original=db.exportData();restore(saved);const before=db.exportData()
  result=commit();assert.equal(result.committed,null,JSON.stringify(result));assert.deepEqual(db.exportData(),before)
  recover(pending,'recovery-'+pending.request.id);assert.deepEqual(db.exportData(),original)
  assert.equal(commit().success,true);assert.deepEqual(db.exportData(),original)
}
;(async()=>{try{
  seed('cash');let saved=backup();const cash={id:'cash-original',shiftId:'shift',time,type:'in',amount:5,reason:'Fixture actual cash',cashier:owner.username}
  assert.equal(db.addCashLog(cash).success,true);const original=db.exportData();restore(saved)
  assert.equal(db.getCashLog().length,0);assert.equal(db.addCashLog(cash).committed,null);assert.equal(db.getCashLog().length,0)
  const pending={kind:'cashlog',request:cash},recovered=recover(pending)
  assert.equal(recovered.result.success,true);assert.equal(db.getCashLog().length,1);assert.equal(db.getCashLog()[0].amount,5)
  assert.equal(db.applyRecoveryOperation(recovered.request,owner).id,recovered.result.id);assert.equal(db.getCashLog().length,1)
  assert.equal(db.addCashLog(cash).success,true);assert.equal(db.getCashLog().length,1)
  pass('a restored-away original cash receipt stays uncertain and protected recovery restores it once, including a lost recovery reply replay')
  assert.throws(()=>db.applyRecoveryOperation({...recovered.request,pending:{kind:'cashlog',request:{...cash,amount:8}}},owner),/內容不同/)
  assert.throws(()=>db.getRecoveryState(pending,{...owner,role:'staff'}),/權限不足/)
  assert.throws(()=>db.getRecoveryState(pending,{...owner,userId:'forged-owner'}),/權限不足/)
  pass('changed-content recovery IDs, staff and non-existent owner identities cannot recover a book')
  close();seed('preview');saved=backup();const preview=db.previewRestore({kind:'backup',id:saved},owner)
  assert.equal(db.addCashLog(cash).success,true);let before=db.exportData()
  assert.throws(()=>db.applyRestorePreview(preview.id,owner),/帳本已更新/);assert.deepEqual(db.exportData(),before)
  assert.equal(raw.prepare('SELECT count(*) AS n FROM recovery_snapshots').get().n,0)
  pass('a payment after the confirmation preview invalidates that preview without replacing any data')
  const next=db.previewRestore({kind:'backup',id:saved},owner),epoch=db.getSalesState(owner).epoch
  raw.exec("CREATE TRIGGER recovery_late_failure BEFORE INSERT ON recovery_events BEGIN SELECT RAISE(ABORT,'fixture late recovery receipt failure'); END")
  assert.throws(()=>db.applyRestorePreview(next.id,owner),/fixture late recovery/);assert.deepEqual(db.exportData(),before)
  assert.equal(raw.prepare('SELECT count(*) AS n FROM recovery_snapshots').get().n,0);assert.equal(db.getSalesState(owner).epoch,epoch)
  raw.exec('DROP TRIGGER recovery_late_failure');pass('a late recovery receipt failure rolls back the preimage, entire book and restore epoch atomically')
  close();seed('drift');saved=backup();db.addCashLog(cash);restore(saved)
  db.updateProduct('p',{...db.getProducts()[0],name:'New actual product name'})
  let state=db.getRecoveryState(pending,owner);assert.equal(state.sources.length,1);assert.equal(state.sources[0].canRecover,false);before=db.exportData()
  assert.throws(()=>db.applyRecoveryOperation({id:'recovery-drift',sourceId:state.sources[0].id,expectedRevision:state.revision,pending},owner),/已有新資料/)
  assert.deepEqual(db.exportData(),before);pass('new business data after restore blocks automatic recovery and remains untouched')
  close();seed('audit');saved=backup();db.addCashLog(cash);restore(saved)
  db.writeAuditLog({id:'login-after-restore',timestamp:time,action:'LOGIN',username:owner.username,role:'owner'})
  assert.equal(db.getRecoveryState(pending,owner).sources[0].canRecover,true);recover(pending)
  assert.ok(db.getAuditLogs({}).some(row=>row.id==='login-after-restore'))
  pass('ordinary login audit records do not block recovery and are preserved with the recovered book')
  close();seed('credentials');saved=backup();const changed=password('new-fixture-password');db.updateUser('owner',{password:changed})
  restore(saved);assert.equal(db.getUsers()[0].password,changed)
  const foreign={...db.exportData(),settings:db.exportData().settings.map(row=>row.key==='sharedStoreId'?{...row,value:'another-store'}:row)}
  assert.throws(()=>db.previewRestore({kind:'import',data:foreign},owner),/另一間店/)
  pass('restore retains current account credentials and rejects a known different store')
  close();seed('stock');saved=backup();const waste={id:'waste-original',time,productId:'p',qty:.25,reason:'actual damaged stock',cashier:owner.username}
  const topup={id:'topup-original',time,memberId:'m',amount:10,bonus:0,payMethod:'cash',shiftId:'shift',cashier:owner.username,note:''}
  assert.equal(db.addWaste(waste).success,true);assert.equal(db.addTopup(topup).success,true);restore(saved)
  assert.equal(db.addWaste(waste).committed,null);assert.equal(db.addTopup(topup).committed,null);assert.equal(db.getProducts()[0].stock,5);assert.equal(db.getMembers()[0].balance,0)
  recover({kind:'waste',request:waste});assert.equal(db.getProducts()[0].stock,4.75);assert.equal(db.getMembers()[0].balance,10)
  assert.equal(db.addTopup(topup).success,true);assert.equal(db.getMembers()[0].balance,10)
  pass('legacy stock-loss and member-topup original IDs cannot silently recreate restored-away effects')
  close();seed('sales');const context=db.getSalesState(owner),header={kind:'sales',storeId:context.storeId,epoch:context.epoch,date:context.today}
  let result=db.applySalesOperation({...header,id:'sale',time,action:'create',document:{customer:{id:'buyer',name:'Buyer'},date:context.today,items:[{productId:'p',qty:2,unitPrice:10,expectedProduct:productReference(db.getProducts()[0])}],note:''}},owner);assert.equal(result.success,true,result.error)
  result=db.applySalesOperation({...header,id:'delivery',time,action:'deliver',orderId:'sale',expectedRevision:1,quantities:[2],dueDate:context.today,handedOver:true},owner);assert.equal(result.success,true,result.error)
  saved=backup();const payment={...header,id:'sales-payment',time,action:'pay',orderId:'sale',expectedRevision:2,deliveryId:'delivery',amount:5,method:'cash',shiftId:'shift',reference:''}
  assert.equal(db.applySalesOperation(payment,owner).success,true);restore(saved)
  assert.equal(db.applySalesOperation(payment,owner).committed,null);assert.equal(db.getCashLog().length,0)
  const salesRecovery=recover({kind:'sales',request:payment});assert.equal(db.getCashLog().length,1);assert.equal(db.getProducts()[0].stock,3)
  assert.equal(db.applySalesOperation(payment,owner).success,true);assert.equal(db.getSalesState(owner).documents[0].payments.length,1)
  const recoveryId=salesRecovery.request.id;close();db=init(path.join(root,'sales.db'));raw=new Database(path.join(root,'sales.db'))
  assert.equal(db.applyRecoveryOperation(salesRecovery.request,owner).id,recoveryId);assert.equal(db.getCashLog().length,1)
  pass('a real original sales payment and its recovery acknowledgement survive restart without a second collection')
  close();seed('pos-refunds');saved=backup()
  const plan=prepareCheckout({cart:[{...db.getProducts()[0],qty:1}],products:db.getProducts(),members:[],activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:0,openShift:db.getOpenShift(),payMethod:'cash',paid:10,pointsUsed:0,opts:{cashier:owner.username},id:'pos-original',now:new Date(time)})
  assert.equal(db.checkout(plan.order).success,true)
  const quarter={id:'refund-quarter',time,refundOf:plan.order.id,items:[{id:'p',qty:.25}],reason:'actual partial return',shiftId:'shift',cashier:owner.username}
  assert.equal(db.refundOrder(plan.order.id,quarter).success,true);restore(saved)
  before=db.exportData();assert.equal(db.checkout(plan.order).committed,null);assert.equal(db.refundOrder(plan.order.id,quarter).committed,null);assert.deepEqual(db.exportData(),before)
  recover({kind:'checkout',plan});assert.equal(db.getProducts()[0].stock,4.25);assert.equal(db.checkout(plan.order).success,true);assert.equal(db.refundOrder(plan.order.id,quarter).success,true)
  const rest={...quarter,id:'refund-rest',items:[{id:'p',qty:.75}]};assert.equal(db.refundOrder(plan.order.id,rest).success,true)
  let journal={version:1,protocol:'pos-checkout-v5',plan},applied
  const {createCheckoutCoordinator}=require('../../src/utils/checkoutCoordinator.mjs'),coordinator=createCheckoutCoordinator({prepare:()=>{throw Error('no new sale')},persist:()=>{throw Error('read only')},lookup:id=>db.checkoutReceipt(id),readPending:()=>journal,writePending:()=>{},clearPending:()=>{journal=null},apply:result=>{applied=result}})
  coordinator.restore();before=db.exportData()
  // The fixture runs synchronously except this genuine async controller lookup.
  const checked=await coordinator.reconcile();assert.equal(checked.status,'refunded');assert.equal(applied.order.status,'refunded');assert.equal(journal,null);assert.deepEqual(db.exportData(),before)
  assert.equal(db.getProducts()[0].stock,5);pass('POS partial/full refunds, restored-away checkout IDs and an old lost payment reconcile without another stock or money movement')

  close();seed('procurement');db.addSupplier({id:'supplier',name:'Supplier'})
  let request={id:'po-create',kind:'purchase-create',time,purchase:{id:'po',supplierId:'supplier',date:time.slice(0,10),items:[{productId:'p',name:'Fixture',unit:'個',qty:2,unitCost:4}]}}
  roundTrip({kind:request.kind,request},()=>db.applyInventoryOperation(request,owner))
  for(const [kind,id,extra]of [['receive','po-receive',{quantities:[2]}],['purchase-bill','po-bill',{reference:'SUP-001',quantities:[2],dueDate:time.slice(0,10)}],['purchase-pay','po-pay',{invoiceId:'po-bill',amount:8,method:'cash',shiftId:'shift'}],['purchase-return','po-return',{invoiceId:'po-bill',quantities:[1],reason:'actual damaged delivery'}],['purchase-refund','po-refund',{invoiceId:'po-bill',amount:4,method:'cash',shiftId:'shift'}],['purchase-refund-reverse','po-refund-correction',{refundId:'po-refund',reason:'actual correction',shiftId:'shift'}]]){
    request={id,kind,time,purchaseId:'po',expectedPurchase:canonicalSignature(db.getPurchases().find(p=>p.id==='po')),...extra}
    roundTrip({kind,request},()=>db.applyInventoryOperation(request,owner))
  }
  request={id:'count-original',kind:'stocktake',time,counts:[{id:'p',expectedStock:6,stock:5.5}],reason:'actual count'}
  roundTrip({kind:'stocktake',request},()=>db.applyInventoryOperation(request,owner))
  pass('protected originals cover procurement creation, receiving, supplier bill/pay/return/refund and fractional stocktaking through their real SQLite adapters')

  close();seed('restaurant');const config=db.getRestaurantState().config
  request={id:'configure',kind:'restaurant',action:'configure',time,expectedConfig:canonicalSignature(config),config:{...config,enabled:true}}
  assert.equal(db.applyRestaurantOperation(request,owner).success,true)
  request={id:'reservation',kind:'restaurant',action:'create',time,day:time.slice(0,10),slot:'12:00',channel:'walkin',customer:'Customer',contact:'',note:'',items:[{id:'p',qty:1,price:10}]}
  roundTrip({kind:'restaurant',request},()=>db.applyRestaurantOperation(request,owner))
  for(const [id,action,extra]of [['restaurant-payment','pay',{shiftId:'shift',payMethod:'cash',paid:10}],['restaurant-cancel','cancel',{reason:'actual cancellation',shiftId:'shift'}]]){
    request={id,kind:'restaurant',action,time,entryId:'reservation',expectedVersion:db.getRestaurantState().entries[0].version,...extra}
    roundTrip({kind:'restaurant',request},()=>db.applyRestaurantOperation(request,owner))
  }
  pass('restaurant reservation, payment and cancellation retain their original effects across deliberate older restores')

  close();seed('quote');let quoteContext=await db.getExchangeContext(owner)
  request={id:'quote-original',kind:'exchange',time,storeId:quoteContext.storeId,expectedRevision:quoteContext.state.revision,quoteId:'',expectedQuoteRevision:0,recipient:{id:'buyer',name:'Buyer'},validUntil:new Date(Date.now()+86400000).toISOString(),items:[{productId:'p',qty:1,unitPrice:10,expectedProduct:productReference(db.getProducts()[0])}],rememberPrices:true,note:'',pricing:require('../../electron/businessExchange.mjs').QUOTE_PRICING}
  roundTrip({kind:'exchange',request},()=>db.applyExchangeOperation(request,owner));pass('a restored-away private quote original cannot silently recreate its customer prices or immutable quote')

  close();seed('conflicting');db.addCashLog(cash);const changedBook=db.exportData();changedBook.cashLog[0].amount=3;db.importData(changedBook)
  before=db.exportData();assert.equal(db.addCashLog(cash).committed,null);assert.equal(db.getRecoveryState(pending,owner).active,'different');assert.ok(db.getRecoveryState(pending,owner).sources.every(s=>!s.canRecover));assert.deepEqual(db.exportData(),before)
  pass('a conflicting active original ID never confirms another amount and does not automatically overwrite either branch')

  before=db.exportData();assert.throws(()=>db.migrateFromLocalStorage({settings:[{key:'storeName',value:'overwrite'}]},owner),/備份還原預覽/);assert.deepEqual(db.exportData(),before)
  const unknown={...before,newerERPCollection:[{id:'do-not-drop'}]};assert.throws(()=>db.previewRestore({kind:'import',data:unknown},owner),/不支援/)
  for(const settings of [[{key:'x',value:3}],[{key:'x',value:'1'},{key:'x',value:'2'}]])assert.throws(()=>db.previewRestore({kind:'import',data:{...before,settings}},owner),/設定格式/)
  assert.deepEqual(db.exportData(),before);pass('live migration, unknown newer collections and malformed duplicate settings cannot bypass protected restore')

  saved=backup();restore(saved);const retained=raw.prepare('SELECT id,data FROM recovery_snapshots ORDER BY created_at LIMIT 1').get()
  for(let i=0;i<12;i++)db.createBackup('rolling-'+i,owner.username)
  assert.equal(db.getBackups().length,10);const protectedFile=db.exportRecoverySource(retained.id,owner);assert.equal(protectedFile.format,'pos-complete-backup/v1');assert.equal(protectedFile.book.cashLog[0].amount,5);assert.ok(protectedFile.protection.originalIds.some(row=>row[1]===protectedFile.book.cashLog[0].id))
  raw.prepare('UPDATE recovery_snapshots SET data=? WHERE id=?').run(retained.data+' ',retained.id)
  before=db.exportData();assert.throws(()=>db.exportRecoverySource(retained.id,owner),/保護副本需要核對/);assert.deepEqual(db.exportData(),before)
  const diagnostic=db.exportRecoveryDiagnostics(owner);assert.equal(diagnostic.importable,false);assert.equal(diagnostic.tables.find(t=>t.name==='recovery_snapshots').rows.find(r=>r.id===retained.id).data,retained.data+' ')
  assert.throws(()=>db.previewRestore({kind:'import',data:diagnostic},owner),/不支援/);assert.deepEqual(db.exportData(),before)
  pass('protected history survives rolling backup deletion and corrupted source bytes are never silently accepted')
  const knownSource=before;close();seed('originals-beyond-lists');saved=backup()
  const history=Array.from({length:2105},(_,i)=>({...cash,id:'cash-history-'+i,time:new Date(Date.parse(time)+i).toISOString()}))
  db.migrateFromLocalStorage({cashLog:history});assert.equal(db.exportData().cashLog.length,2105);restore(saved)
  assert.equal(db.addCashLog(history[0]).committed,null);const fullSource=db.getRecoveryState({kind:'cashlog',request:history[0]},owner).sources.find(s=>s.canRecover)
  assert.equal(db.exportRecoverySource(fullSource.id,owner).book.cashLog.length,2105);recover({kind:'cashlog',request:history[0]});assert.equal(db.exportData().cashLog.length,2105)
  pass('the oldest original ID and complete protected history remain available beyond 2100 cash rows, independent of display limits')
  close();db=init(path.join(root,'fresh-store.db'));raw=new Database(path.join(root,'fresh-store.db'))
  const freshPassword=password('new-device-password');db.addUser({id:'owner',username:'New device owner',password:freshPassword,role:'owner'});db.setSetting('sharedStoreId','fresh-device-generated-id')
  const freshOwner={...owner,username:'New device owner'},freshPreview=db.previewRestore({kind:'import',data:knownSource},freshOwner);assert.equal(db.applyRestorePreview(freshPreview.id,freshOwner).storeId,'recovery-store');assert.equal(db.getUsers()[0].password,freshPassword);assert.equal(db.getUsers()[0].username,'New device owner')
  pass('a genuinely empty new device adopts its original store identity while preserving the new device owner credentials')
  close();seed('scenario-fence');saved=backup()
  const template={templateId:'donburi-takeaway-v1',operationId:'recovery_template_original',items:{pork:{price:95,cost:40,stock:10},beef:{price:115,cost:50,stock:10},tea:{price:10,cost:4,stock:20}}}
  assert.equal(db.applyScenarioTemplate(template,owner).success,true);restore(saved);before=db.exportData();assert.equal(db.applyScenarioTemplate(template,owner).committed,null);assert.deepEqual(db.exportData(),before)
  pass('a restored-away scenario template cannot silently recreate its original stock or template receipt')
  close();seed('non-journal-fences');saved=backup()
  db.addManualEntry({id:'manual-original',date:time.slice(0,10),description:'Actual entry',lines:[{account:'1000',debit:5,credit:0},{account:'4000',debit:0,credit:5}]})
  db.addPurchase({id:'legacy-po',date:time.slice(0,10),supplierName:'Supplier',status:'draft',items:[{productId:'p',name:'Fixture',qty:1,cost:4}],total:4})
  assert.equal(db.closeShift('shift',{closeCash:100}).expected,100);db.openShift({id:'next-shift',openCash:100,cashier:owner.username});restore(saved);before=db.exportData()
  for(const call of [()=>db.addManualEntry({id:'manual-original'}),()=>db.addPurchase({id:'legacy-po'}),()=>db.closeShift('shift',{closeCash:100}),()=>db.openShift({id:'next-shift',openCash:100,cashier:owner.username})])assert.equal(call().committed,null)
  assert.deepEqual(db.exportData(),before);pass('manual journals, legacy purchase IDs and open/close shift originals cannot bypass the restore history fence')
  console.log(JSON.stringify({success:true,marker:'POS_RECOVERY_PASS',tests}));close()
}catch(error){console.error(error.stack);close();process.exitCode=1}})()
