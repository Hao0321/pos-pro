const h=require('./tableKitchenHarness.cjs'),assert=require('node:assert/strict'),{canonicalSignature}=require('../../electron/operationRules.mjs')
const race=process.env.POS_FUNDS_SETUP_RACE==='1',checks=[],pass=label=>{checks.push(label);console.log('PASS '+label)};let stage='setup'
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup({empty:true});await h.nativePrefs('zh-TW','simple');await h.wait(pc,'!!document.querySelector("[data-funds-enable]")','new store deposit option')
 assert.equal(db.getRestaurantState().fundsSetup.newStore,true);assert.equal(db.getRestaurantState().config.fundsEnabled,undefined);assert.equal(await h.js(pc,'document.querySelector("[data-funds-enable]").checked'),true)
 pass('a real first-use owner sees a proposed deposit option while the authoritative configuration remains unchanged')
 await h.tap(pc,'input[aria-label=啟用正式預訂]')
 if(race){
  stage='race';const config=db.getRestaurantState().config,result=db.applyRestaurantOperation({id:'other-setup-window',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(config),config},h.owner);assert.equal(result.success,true,result.error)
  const original=db.exportData().restaurantOperations.find(row=>row.id==='other-setup-window');await h.button(pc,'儲存預訂設定');await h.wait(pc,'!!document.querySelector(".restaurant-page [role=alert]")&&localStorage.getItem("pos_pending_financial_v1")===null','stale proposal explicitly rejected');assert.equal(db.getRestaurantState().config.fundsEnabled,undefined)
  await h.tap(pc,'[data-funds-enable]');await h.tap(pc,'[data-funds-enable]');assert.deepEqual(db.exportData().restaurantOperations.find(row=>row.id==='other-setup-window'),original)
  pass('a real unchanged-config other-window race prevents implicit activation; the original record is preserved before deliberate owner opt-in')
 }
 stage='save';await h.button(pc,'儲存預訂設定');await h.wait(pc,'!!document.querySelector(".restaurant-page [role=status]")&&localStorage.getItem("pos_pending_financial_v1")===null','first settings acknowledgment');assert.equal(db.getRestaurantState().config.fundsEnabled,true);assert.equal(db.getRestaurantState().config.enabled,true);assert.equal(db.getRestaurantState().fundsSetup.newStore,false)
 pass(race?'explicit owner choice activates only the new booking mode after the rejected proposal':'the owner saves the first proposed configuration once through authenticated IPC')
 assert.deepEqual(h.errors,[]);console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_FUNDS_SETUP_UI_PASS',tests:checks.length,race,realSQLite:true,realIPC:true,physicalPhone:false}))
}catch(error){console.error(stage,error.stack);try{await h.capture(h.pc,h.out,'funds-setup-failure')}catch{}process.exitCode=1}finally{try{await h.finish()}catch(error){console.error(error.stack);process.exitCode=1}h.app.exit(process.exitCode||0)}})
