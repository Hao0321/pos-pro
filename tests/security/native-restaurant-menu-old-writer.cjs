const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),Database=require('better-sqlite3')
const current=require('../../electron/database.js'),fixture=require('../fixtures/table-kitchen-v1.json'),{restaurantMenuFixture,bowl}=require('../fixtures/restaurant-menu-v1.mjs'),{canonicalSignature}=require('../../electron/operationRules.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT,oldRoot=process.env.POS_MENU_OLD_SOURCE_ROOT,manifestFile=process.env.POS_MENU_OLD_MANIFEST
if(!root||!oldRoot||!manifestFile)throw Error('isolated root and verified genuine old source/manifest are required')
const out=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(out,{recursive:true})
const sha=value=>createHash('sha256').update(value).digest('hex'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'))
for(const row of manifest){const file=path.resolve(oldRoot,row.path);assert.ok(file.startsWith(path.resolve(oldRoot)+path.sep));assert.equal(sha(fs.readFileSync(file)),row.sha256,'genuine source changed: '+row.path)}
const old=require(path.join(path.resolve(oldRoot),'electron/database.js')),owner=fixture.owner,seed=restaurantMenuFixture(),checks=[]
const ok=value=>{assert.equal(value.success,true,value.error);return value},pass=label=>{checks.push(label);console.log('PASS '+label)}
let db,legacy
function make(file,menu){
 const api=current(file);for(const user of fixture.before.users)api.addUser(user);for(const product of seed.products)api.addProduct(product)
 const config=api.getRestaurantState().config
 ok(api.applyRestaurantOperation({id:'configure-'+menu,kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true,recipes:seed.config.recipes,...(menu?{menu:seed.menu}:{})}},owner))
 return api
}
try{
 const file=path.join(root,'menu-protected.db');db=make(file,true)
 const preview=db.getRestaurantMenuQuote({items:[bowl()]},owner),s=db.getRestaurantState(),request={id:'protected-menu-original',kind:'restaurant',action:'create',time:s.now,storeId:s.storeId,epoch:s.epoch,costMode:s.costMode,fundsProtocol:'pos-restaurant-funds/v1',menuProtocol:'pos-restaurant-menu/v1',menuReview:preview.menuReview,day:s.today,slot:'12:00',channel:'walkin',customer:'',contact:'',note:''}
 ok(db.applyRestaurantOperation(request,owner));const before=db.exportData();db.close();db=null
 let error='',unexpected
 try{unexpected=old(file);unexpected.addProduct({id:'must-not-write',name:'Old writer',price:1,cost:1,stock:1})}catch(e){error=e.message}finally{unexpected?.close()}
 assert.ok(error,'genuine old writer must refuse the menu original')
 db=current(file);assert.deepEqual(db.exportData(),before);ok(db.applyRestaurantOperation(request,owner))
 pass('the genuine frozen funds-capable writer refuses a menu-v1 SQLite store before it can ignore selections or mutate the saved original')
 const rawOld=new Database(file);require(path.join(path.resolve(oldRoot),'electron/databaseFeatureFence.cjs')).register(rawOld)
 assert.throws(()=>rawOld.prepare("SELECT pos_require_feature('restaurant-menu-v1')").get(),/相容版本/)
 assert.throws(()=>rawOld.prepare('UPDATE products SET stock=stock+1 WHERE id=?').run('rice'),/版本|支援|compatible|runtime/i)
 rawOld.close();assert.deepEqual(db.exportData(),before)
 pass('the actual old runtime support function rejects menu-v1 and persistent triggers block even an ordinary stock update independently of order parsing')

 const legacyFile=path.join(root,'supported-funds.db');legacy=make(legacyFile,false);legacy.close();legacy=old(legacyFile)
 const state=legacy.getRestaurantState(),ordinary={id:'old-funded-positive',kind:'restaurant',action:'create',time:state.now,storeId:state.storeId,epoch:state.epoch,costMode:state.costMode,fundsProtocol:'pos-restaurant-funds/v1',day:state.today,slot:'12:00',channel:'walkin',customer:'',contact:'',note:'',items:[{id:'bowl',price:100,qty:1}]}
 const created=ok(legacy.applyRestaurantOperation(ordinary,owner));assert.equal(created.entry.total,100);const once=legacy.exportData();ok(legacy.applyRestaurantOperation(ordinary,owner));assert.deepEqual(legacy.exportData(),once)
 pass('the same genuine old runtime still opens a supported funds-only store and creates/replays an ordinary100 order, calibrating that the refusal is specifically the menu boundary')
 for(const row of manifest)assert.equal(sha(fs.readFileSync(path.resolve(oldRoot,row.path))),row.sha256)
 fs.writeFileSync(path.join(out,'menu-old-writer-observations.json'),JSON.stringify({checks,oldRoot,manifestSha256:sha(fs.readFileSync(manifestFile)),sourceFiles:manifest.length,error,sourceUnchanged:true,genuineOldWriter:true,syntheticStore:true},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_MENU_OLD_WRITER_PASS',tests:checks.length,genuineOldWriter:true}));db.close();legacy.close()
}catch(error){console.error(error.stack);try{db?.close();legacy?.close()}catch{}process.exitCode=1}
