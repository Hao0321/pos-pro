const h=require('./tableKitchenHarness.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{BrowserWindow,session}=require('electron')
const {restaurantMenuFixture,bowl,choose}=require('../fixtures/restaurant-menu-v1.mjs'),{canonicalSignature}=require('../../electron/operationRules.mjs')
let forged,checks=0
const pass=label=>{checks++;console.log('PASS '+label)},ok=result=>{assert.equal(result.success,true,result.error);return result}
const reject=(window,expression)=>h.js(window,'('+expression+').then(()=>false).catch(e=>e.message)')
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup(),seed=restaurantMenuFixture(),cart=[bowl(),bowl(1,{selections:[choose('extras','egg')]})]
 for(const product of seed.products){if(db.getProducts().some(row=>row.id===product.id))ok(db.updateProduct(product.id,product));else db.addProduct(product)}
 const config=db.getRestaurantState().config
 ok(await h.js(pc,'window.electronAPI.db.applyRestaurantOperation('+h.q({id:'ipc-menu-config',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes,menu:seed.menu}})+')'))
 const before=db.exportData(),quoted=await h.js(pc,'window.electronAPI.db.getRestaurantMenuQuote('+h.q({items:cart})+')')
 assert.equal(quoted.menuReview.quote.totalCents,21500);assert.deepEqual(db.exportData(),before)
 pass('the real owner renderer/preload/authorized IPC quote reads acknowledged owner definitions and actual SQLite without writing an order')

 await h.js(pc,'window.electronAPI.auth.logout()');pc.webContents.reload();await h.login(pc,h.staff);await h.nav(pc)
 const staffQuote=await h.js(pc,'window.electronAPI.db.getRestaurantMenuQuote('+h.q({items:cart})+','+h.q(h.owner)+')'),s=db.getRestaurantState(),request={id:'ipc-staff-menu',kind:'restaurant',action:'create',time:s.now,storeId:s.storeId,epoch:s.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:s.costMode,menuProtocol:'pos-restaurant-menu/v1',menuReview:staffQuote.menuReview,day:s.today,slot:'12:00',channel:'walkin',customer:'Staff quote',contact:'',note:''}
 const made=ok(await h.js(pc,'window.electronAPI.db.applyRestaurantOperation('+h.q(request)+','+h.q(h.owner)+')'));assert.equal(made.receipt.actor.userId,h.staff.userId);assert.equal(made.entry.total,215)
 const once=db.exportData();ok(await h.js(pc,'window.electronAPI.db.applyRestaurantOperation('+h.q(request)+')'));assert.deepEqual(db.exportData(),once)
 const cfg=db.getRestaurantState().config;assert.match(await reject(pc,'window.electronAPI.db.applyRestaurantOperation('+h.q({id:'staff-menu-config',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(cfg),config:cfg})+','+h.q(h.owner)+')'),/權限/)
 pass('staff can quote and save the selected meal through real IPC; supplied owner data cannot replace the real actor or grant configuration access, and replay creates no second original')

 forged=new BrowserWindow({show:false,webPreferences:{session:session.fromPartition('menu-forged-native'),preload:path.resolve('electron/preload.js'),sandbox:true,nodeIntegration:false,contextIsolation:true}})
 await forged.loadFile(h.rendererPath);assert.match(await reject(forged,'window.electronAPI.db.getRestaurantMenuQuote('+h.q({items:cart})+')'),/IPC|來源|source/);forged.destroy();forged=null
 await h.js(pc,'window.electronAPI.auth.logout()');assert.ok(await reject(pc,'window.electronAPI.db.getRestaurantMenuQuote('+h.q({items:cart})+')'));assert.deepEqual(db.exportData(),once)
 pass('a real untrusted native window and a logged-out trusted window cannot obtain the private recipe/cost quote or mutate the book')

 const phone=await h.paired(h.staff),input={items:[bowl(1,{variantId:'large'})]},remote=await h.js(phone,'window.electronAPI.db.getRestaurantMenuQuote('+h.q(input)+')')
 assert.equal(remote.menuReview.quote.totalCents,12000);const state=db.getRestaurantState(),sharedRequest={...request,id:'https-menu-original',time:state.now,menuReview:remote.menuReview,customer:'Paired original'}
 h.loseSharedRestaurant();assert.ok(await reject(phone,'window.electronAPI.db.applyRestaurantOperation('+h.q(sharedRequest)+')'))
 const committed=db.exportData();assert.equal(committed.restaurantOrders.find(row=>row.id===sharedRequest.id).total,120)
 const recovered=ok(await h.js(phone,'window.electronAPI.db.applyRestaurantOperation('+h.q(sharedRequest)+')'));assert.equal(recovered.receipt.actor.userId,h.staff.userId);assert.deepEqual(db.exportData(),committed)
 phone.webContents.reload();await h.wait(phone,'!!window.electronAPI?.sharedStore','paired bridge restart');const fresh=await h.js(phone,'window.electronAPI.db.getRestaurantMenuQuote('+h.q(input)+')');assert.equal(fresh.menuReview.configurationId,remote.menuReview.configurationId)
 pass('certificate-pinned paired HTTPS quotes and commits the same authoritative menu; a reply lost after commit recovers the original once, and reloading retains the shared authority')
 assert.equal(h.errors.length,0,h.errors.join('\n'))
 fs.writeFileSync(path.join(h.out,'menu-ipc-observations.json'),JSON.stringify({checks,authenticatedIPC:true,pinnedHTTPS:true,realSelectedOrder:true,realMenuForm:false,physicalPhone:false},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_MENU_IPC_PASS',tests:checks,physicalPhone:false}));await h.finish();h.app.exit(0)
}catch(error){console.error(error.stack);try{forged?.destroy();await h.finish()}catch{}h.app.exit(1)}})
