const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),Database=require('better-sqlite3')
const root=process.env.POS_SECURITY_FIXTURE_ROOT,input=process.env.POS_PUBLIC_MENU_PACKET,oldRoot=process.env.POS_PUBLIC_MENU_OLD_ROOT,manifestFile=process.env.POS_PUBLIC_MENU_OLD_MANIFEST
if(!root||!input||!oldRoot||!manifestFile)throw Error('isolated source packet and genuine preceding source/manifest required')
const out=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(out,{recursive:true});const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),frozen=JSON.parse(fs.readFileSync(manifestFile,'utf8'))
assert.equal(path.resolve(frozen.destination),path.resolve(oldRoot));for(const row of frozen.manifest)assert.equal(hash(path.join(oldRoot,row.path)),row.sha256)
const init=require('../../electron/database.js'),old=require(path.join(path.resolve(oldRoot),'electron/database.js')),legacy=require('../fixtures/table-kitchen-v1.json'),{restaurantMenuFixture,bowl}=require('../fixtures/restaurant-menu-v1.mjs'),{canonicalSignature}=require('../../electron/operationRules.mjs'),owner=legacy.owner
let db,positive;const checks=[],pass=label=>{checks.push(label);console.log('PASS '+label)},ok=value=>{assert.equal(value.success,true,value.error);return value}
try{
 const file=path.join(root,'protected-public.db');db=init(file);for(const user of legacy.before.users)db.addUser(user);const preview=db.previewRestore({kind:'import',data:JSON.parse(fs.readFileSync(input,'utf8'))},owner);ok(db.applyRestorePreview(preview.id,owner));const before=db.exportData();db.close();db=null
 let rejection='',unexpected;try{unexpected=old(file);unexpected.setSetting('mustNotChange','old')}catch(error){rejection=error.message}finally{unexpected?.close()}
 assert.ok(rejection);db=init(file);assert.deepEqual(db.exportData(),before)
 pass('the genuine preceding menu-v1 writer refuses the protection8 public original and cannot silently drop its new source/proof or write settings')
 const raw=new Database(file);require(path.join(path.resolve(oldRoot),'electron/databaseFeatureFence.cjs')).register(raw)
 const protectedUser=raw.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();assert.ok(protectedUser)
 assert.throws(()=>raw.prepare("SELECT pos_require_feature('restaurant-public-menu-v1')").get(),/相容版本/);assert.throws(()=>raw.prepare('UPDATE users SET role=role WHERE id=?').run(protectedUser.id),/相容版本/);raw.close();assert.deepEqual(db.exportData(),before)
 pass('the actual old feature function and persistent triggers reject public-menu writes independently of selected-order parsing')
 positive=old(path.join(root,'supported-menu7.db'));for(const user of legacy.before.users)positive.addUser(user);const seed=restaurantMenuFixture();for(const product of seed.products)positive.addProduct(product)
 const config=positive.getRestaurantState().config;ok(positive.applyRestaurantOperation({id:'known-menu-config',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true,recipes:seed.config.recipes,menu:seed.menu}},owner))
 const review=positive.getRestaurantMenuQuote({items:[bowl()]},owner),state=positive.getRestaurantState(),request={id:'known-menu-original',kind:'restaurant',action:'create',time:state.now,storeId:state.storeId,epoch:state.epoch,costMode:state.costMode,fundsProtocol:'pos-restaurant-funds/v1',menuProtocol:'pos-restaurant-menu/v1',menuReview:review.menuReview,day:state.today,slot:'12:00',channel:'walkin',customer:'',contact:'',note:''}
 assert.equal(ok(positive.applyRestaurantOperation(request,owner)).entry.total,100);const once=positive.exportData();ok(positive.applyRestaurantOperation(request,owner));assert.deepEqual(positive.exportData(),once);assert.equal(positive.exportFullBackup(owner).protection.version,7)
 pass('the same genuine preceding runtime still configures, quotes and commits/replays an actual supported menu-v1/protection7 original, calibrating a public8-specific refusal')
 for(const row of frozen.manifest)assert.equal(hash(path.join(oldRoot,row.path)),row.sha256)
 fs.writeFileSync(path.join(out,'public-menu-old-writer-observations.json'),JSON.stringify({checks,input,inputSha256:hash(input),oldRoot,manifestSha256:hash(manifestFile),files:frozen.manifest.length,sourceUnchanged:true,genuinePrecedingWriter:true,rejection},null,2));console.log(JSON.stringify({success:true,marker:'POS_PUBLIC_MENU_OLD_WRITER_PASS',tests:checks.length,genuinePrecedingWriter:true}));db.close();positive.close()
}catch(error){console.error(error.stack);try{db?.close();positive?.close()}catch{}process.exitCode=1}
