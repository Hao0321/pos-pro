const h=require('./tableKitchenHarness.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{canonicalSignature}=require('../../electron/operationRules.mjs'),{salesDate}=require('../../electron/salesRules.mjs')
const observations=[];let phone,stage='setup'
const card=id=>'article[data-restaurant-id='+h.q(id)+']',now=()=>new Date().toISOString()
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup();db.addProduct({id:'funds-ui-meal',name:'Meal',price:80,cost:30,stock:20,unit:'份'})
 const config=db.getRestaurantState().config,configured=db.applyRestaurantOperation({id:'funds-ui-config',kind:'restaurant',action:'configure',time:now(),expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100}},h.owner);assert.equal(configured.success,true,configured.error)
 const act=(id,action,entryId,fields={})=>{const state=db.getRestaurantState(),entry=state.entries.find(row=>row.id===entryId),result=db.applyRestaurantOperation({id,kind:'restaurant',action,time:now(),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,...(action==='create'?{channel:'walkin',day:salesDate(new Date()),slot:'12:00',customer:'Funds guest',contact:'',note:''}:{entryId,expectedVersion:entry.version}),...fields},h.owner);assert.equal(result.success,true,result.error);return result}
 const shift=db.getOpenShift().id
 for(const [id,qty,amount]of [['deposit',3,200],['prepaid',1,80]]){
  act(id,'create',null,{items:[{id:'funds-ui-meal',qty,price:80}]});act(id+'-received','funds-receive',id,{amount,paid:amount,payMethod:'cash',shiftId:shift});act(id+'-cook','advance',id,{status:'cooking'});act(id+'-ready','advance',id,{status:'ready'})
 }
 await h.nativePrefs('zh-TW','simple');await h.wait(pc,'!!document.querySelector('+h.q(card('deposit'))+')','funded originals visible')
 const due=await h.js(pc,'document.querySelector('+h.q(card('deposit')+' [data-restaurant-funding]')+')?.getAttribute("data-funds-due")??null')
 observations.push({name:'partial collection displays authoritative remaining40',expected:'4000',actual:due,passed:due==='4000'})
 const enabled=await h.js(pc,'document.querySelector('+h.q(card('prepaid')+' [data-kitchen-action=completed]')+')?.disabled===false')
 observations.push({name:'fully paid unfulfilled original permits handover before saleId exists',expected:true,actual:enabled,passed:enabled===true})
 stage='amount';await h.tap(pc,card('deposit')+' [data-kitchen-pay]')
 await h.wait(pc,'!!(document.querySelector("[data-funds-amount]")||document.querySelector("input[aria-label=預訂實收]"))','collection form rendered')
 const amount=await h.js(pc,'(document.querySelector("[data-funds-amount]")||document.querySelector("input[aria-label=預訂實收]"))?.value??null')
 observations.push({name:'collection form defaults to remaining40 rather than original240',expected:'40',actual:amount,passed:amount==='40'})
 await h.js(pc,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await h.capture(pc,h.out,'funded-worklist-owner');await h.button(pc,'返回工作單')
 stage='staff';phone=await h.paired(h.staff);await h.wait(phone,'!!document.querySelector('+h.q(card('prepaid'))+')','staff funded original')
 const cancel=await h.js(phone,'!!document.querySelector('+h.q(card('prepaid')+' [data-kitchen-cancel]')+')')
 observations.push({name:'staff cannot offer cancellation of retained paid funds',expected:false,actual:cancel,passed:cancel===false});await h.capture(phone,h.out,'funded-worklist-staff')
 fs.writeFileSync(path.join(h.out,'funds-worklist-observations.json'),JSON.stringify({schemaVersion:1,observations,realSQLite:true,realIPC:true,pinnedHTTPS:true,physicalPhone:false,financialMutationViaForms:false},null,2))
 for(const row of observations)console.log(JSON.stringify(row));assert.ok(observations.every(row=>row.passed),'funded worklist controls failed');assert.deepEqual(h.errors,[])
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_FUNDS_WORKLIST_UI_PASS',tests:observations.length,scope:'Funded worklist and amount defaults only; full financial journeys separate'}))
}catch(error){console.error(stage,error.stack);fs.writeFileSync(path.join(h.out,'funds-worklist-failure.json'),JSON.stringify({stage,error:error.stack,observations},null,2));process.exitCode=1}finally{try{await h.finish()}catch(error){console.error(error.stack);process.exitCode=1}h.app.exit(process.exitCode||0)}})
