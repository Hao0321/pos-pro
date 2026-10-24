const h=require('./tableKitchenHarness.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{canonicalSignature}=require('../../electron/operationRules.mjs'),{salesDate}=require('../../electron/salesRules.mjs'),{summarizeRestaurantFunds}=require('../../electron/restaurantFunds.mjs')
const checks=[],observations=[],pass=label=>{checks.push(label);console.log('PASS '+label)},now=()=>new Date().toISOString(),card=id=>'article[data-restaurant-id='+h.q(id)+']';let phone,stage='setup'
const keys=(w,key,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers})}
async function open(w,id,mode='receive'){
 if(mode==='refund')await h.tap(w,card(id)+' > details > summary')
 await h.tap(w,card(id)+(mode==='receive'?' [data-kitchen-pay]':mode==='cancel'?' [data-kitchen-cancel]':' [data-funds-open-refund]'))
 await h.wait(w,'document.querySelector("[data-restaurant-funds-form]")?.getAttribute("data-funds-entry")==='+h.q(id),'matching matrix form')
}
async function confirm(w){await h.wait(w,'!!document.querySelector("[data-funds-confirm]")&&!document.querySelector("[data-funds-confirm]").disabled','saved valid matrix form');await h.tap(w,'[data-funds-confirm]');await h.tap(w,'[data-funds-submit]')}
async function finished(w){await h.wait(w,'!document.querySelector("[data-restaurant-funds-form]")&&localStorage.getItem("pos_pending_financial_v1")===null','matrix original acknowledged')}
async function capture(w,locale,style,mode){
 await h.wait(w,'!document.querySelector("[data-funds-confirm]").disabled','matrix draft persisted')
 assert.equal(await h.js(w,'document.querySelector("[data-funds-confirm]").checked'),false)
 assert.equal(await h.js(w,'document.documentElement.scrollWidth<=innerWidth+1'),true)
 assert.equal(await h.js(w,'!!document.querySelector("[role=dialog] [role=alert]")'),false,'fresh financial review has no old error')
 assert.ok(await h.js(w,'[...document.querySelectorAll("[role=dialog] input:not([type=checkbox]),[role=dialog] select,[role=dialog] button,[role=dialog] label")].every(node=>node.getBoundingClientRect().height>=47)'))
 await h.js(w,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await h.capture(w,h.out,'funds-'+mode+'-'+locale+'-'+style)
}
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup();db.addProduct({id:'matrix-meal',name:'Meal',price:80,cost:30,stock:100,unit:'份'})
 const config=db.getRestaurantState().config,configured=db.applyRestaurantOperation({id:'matrix-config',kind:'restaurant',action:'configure',time:now(),expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true,dailyCapacity:200,slotCapacity:100}},h.owner);assert.equal(configured.success,true,configured.error)
 const act=(id,action,entryId,fields={})=>{const state=db.getRestaurantState(),entry=state.entries.find(row=>row.id===entryId),result=db.applyRestaurantOperation({id,kind:'restaurant',action,time:now(),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,...(action==='create'?{channel:'walkin',day:salesDate(new Date()),slot:'12:00',customer:'Matrix guest',contact:'',note:''}:{entryId,expectedVersion:entry.version}),...fields},h.owner);assert.equal(result.success,true,result.error);return result}
 let index=0
 for(const locale of ['zh-TW','en','ja','zh-CN'])for(const style of ['simple','poster']){
  stage=locale+'/'+style;const id='matrix-'+index,shift=db.getOpenShift().id
  act(id,'create',null,{items:[{id:'matrix-meal',qty:3,price:80}]});act(id+'-cash','funds-receive',id,{amount:100,paid:100,payMethod:'cash',shiftId:shift});act(id+'-card','funds-receive',id,{amount:100,paid:100,payMethod:'card',shiftId:shift})
  await h.nativePrefs(locale,style);let device=pc
  if(index===0){phone=await h.paired(h.owner);device=phone}
  if(index===5)await h.js(device,'(()=>{window.__fundsActualDate=Date;window.Date=class extends window.__fundsActualDate{constructor(...args){super(...(args.length?args:["2031-01-01T23:59:00Z"]))}static now(){return new window.__fundsActualDate("2031-01-01T23:59:00Z").getTime()}};return true})()')
  await open(device,id);assert.equal(await h.js(device,'document.querySelector("[data-funds-amount]").value'),'40')
  await h.wait(device,'!document.querySelector("[data-funds-confirm]").disabled','initial review usable')
  if(index===0){
   await h.wait(device,'document.activeElement.matches("[data-funds-amount]")','initial amount focus');keys(device,'TAB',['shift']);await h.wait(device,'document.activeElement.matches("[data-funds-discard]")','backward financial focus trap');keys(device,'TAB');await h.wait(device,'document.activeElement.matches("[data-funds-amount]")','forward financial focus trap');keys(device,'F3');assert.equal(await h.js(device,'document.querySelectorAll("[data-restaurant-funds-form]").length'),1)
   pass('the actual pinned-HTTPS owner phone uses saved raw fields, keyboard focus trapping and48px controls without invoking cashier shortcuts')
  }
  await capture(device,locale,style,'receive');await confirm(device);await finished(device)
  await open(device,id,'cancel');await h.tap(device,'[data-funds-cancel-all]');await h.input(device,'[data-funds-cancel-qty=matrix-meal]','1')
  if(index===2){
   phone.webContents.reload();await h.wait(phone,'!!document.querySelector(".easy-home")','other-device owner restarted');await h.nav(phone);await open(phone,id,'cancel');await h.tap(phone,'[data-funds-cancel-all]');await h.input(phone,'[data-funds-cancel-qty=matrix-meal]','1');await confirm(phone);await finished(phone)
   await h.wait(pc,'!!document.querySelector("[data-funds-preview-error]")','other-device source change visible');assert.equal(await h.js(pc,'document.querySelector("[data-funds-cancel-qty]").value'),'1');assert.equal(await h.js(pc,'document.querySelector("[data-funds-submit]").disabled'),true)
   await h.tap(pc,'[data-funds-refresh]');await h.wait(pc,'!document.querySelector("[data-funds-preview-error]")','explicit current source rebound');await h.input(pc,'[data-funds-cancel-qty=matrix-meal]','1')
   pass('a real owner-phone cancellation invalidates the desktop preview while retaining typed portions until explicit current-source review')
  }
  await capture(device,locale,style,'cancel');await confirm(device);await finished(device)
  const entry=()=>db.getRestaurantState().entries.find(row=>row.id===id),beforeRefund=entry().funds.events.length,expectedQuantity=index===2?1:2;assert.equal(entry().quantity,expectedQuantity);assert.equal(entry().funds.events.at(-1).amountCents,8000)
  await open(device,id,'refund');await h.input(device,'[data-funds-amount]','1.10');await capture(device,locale,style,'refund')
  if(index===0)h.loseSharedRestaurant()
  await confirm(device)
  if(index===0){
   await h.wait(device,'!!document.querySelector("[data-funds-recover]")&&!!localStorage.getItem("pos_pending_financial_v1")','unknown HTTPS original retained');const pending=await h.js(device,'JSON.parse(localStorage.getItem("pos_pending_financial_v1"))');assert.equal(pending.request.amount,1.1);assert.equal(entry().funds.events.length,beforeRefund+1)
   device.webContents.reload();await h.wait(device,'!!document.querySelector(".easy-home")','HTTPS original renderer restart');await h.nav(device);await h.wait(device,'!!document.querySelector("[data-funds-recover]")','HTTPS original form recovered');assert.equal(await h.js(device,'JSON.parse(localStorage.getItem("pos_pending_financial_v1")).request.id'),pending.request.id);await h.tap(device,'[data-funds-recover]')
   pass('actual pinned-HTTPS refund reply loss and renderer restart recover the exact1.10 original without another refund')
  }
  await finished(device);const summary=summarizeRestaurantFunds(entry().funds);assert.equal(summary.dueCents,110);assert.equal(entry().funds.events.length,beforeRefund+1)
  if(index===5){for(const event of entry().funds.events.filter(row=>row.id.startsWith('restaurant-'))){assert.equal(new Date(event.time).getFullYear(),new Date().getFullYear());assert.equal(event.date,salesDate(new Date()))}await h.js(device,'(()=>{window.Date=window.__fundsActualDate;return true})()');pass('an incorrect client clock does not change actual collection, cancellation or refund timestamps and business dates')}
  observations.push({locale,style,entryId:id,transport:index===0?'pinned-https':'ipc',quantity:entry().quantity,retainedCents:summary.retainedCents,dueCents:summary.dueCents});pass(locale+'/'+style+' actual collection, selected cancellation and refund preserve exact sources and acknowledgments');index++
 }
 const state=db.getRestaurantState(),remaining=state.entries.filter(row=>row.id.startsWith('matrix-')).reduce((sum,row)=>sum+row.quantity,0);assert.equal(db.getProducts().find(row=>row.id==='matrix-meal').stock,100-remaining);assert.equal(db.exportFullBackup(h.owner).protection.version,6);assert.deepEqual(h.errors,[])
 fs.writeFileSync(path.join(h.out,'funds-locale-observations.json'),JSON.stringify({schemaVersion:1,checks,observations,screenshots:24,realSQLite:true,realIPC:true,pinnedHTTPS:true,financialMutationViaForms:true,costMode:'reference',physicalPhone:false,physicalPrinter:false,realHumanAcceptance:false},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_FUNDS_LOCALE_UI_PASS',tests:checks.length,screenshots:24,scope:'Four-language/two-style360px actual financial forms; physical/human acceptance separate'}))
}catch(error){console.error(stage,error.stack);try{fs.writeFileSync(path.join(h.out,'funds-locale-failure.txt'),stage+'\n'+error.stack+'\n'+await h.js(h.pc,'document.body.innerText'));await h.capture(h.pc,h.out,'funds-locale-failure')}catch{}process.exitCode=1}finally{try{await h.finish()}catch(error){console.error(error.stack);process.exitCode=1}h.app.exit(process.exitCode||0)}})
