const {app,BrowserWindow,ipcMain,session}=require('electron')
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pbkdf2Sync,X509Certificate}=require('node:crypto')
const {js,wait,input,select,tap,button,capture:rawCapture}=require('./rendererHarness.cjs')
const {tr}=require('../../public/i18n/core.mjs'),{productReference}=require('../../electron/businessExchange.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated fixture required')
const rendererPath=path.resolve(process.env.POS_RECOVERY_RENDERER||'dist/index.html'),owner={role:'owner',userId:'owner',username:'Recovery Owner'}
app.setPath('userData',root);app.disableHardwareAcceleration()
let db,pc,phone,shared,tests=0;const observations={},q=JSON.stringify,en=source=>tr(source,{},'en')
const pass=name=>{tests++;console.log('PASS '+name)}
async function capture(target,folder,name){await js(target,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await new Promise(resolve=>setTimeout(resolve,150));await rawCapture(target,folder,name)}
const doc=()=>db.getSalesState(owner).documents[0]
async function login(target){await wait(target,'[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Recovery Owner"))','account chooser');await js(target,'[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Recovery Owner")).click()');await input(target,'input[type=password]','fixture-password');await js(target,'document.querySelector("form").requestSubmit()');await wait(target,'!!document.querySelector(".easy-home")','signed-in home')}
async function task(target,query,label){await input(target,'.easy-search input',query);await wait(target,'[...document.querySelectorAll(".easy-task strong")].some(e=>e.textContent==='+q(en(label))+')','task '+label);await js(target,'[...document.querySelectorAll(".easy-task")].find(e=>e.querySelector("strong")?.textContent==='+q(en(label))+').setAttribute("data-recovery-task","")');await tap(target,'[data-recovery-task]')}
async function display(target,locale,style){
  if(!await js(target,'document.querySelector("[data-mobile-display]").open'))await tap(target,'[data-mobile-display] summary')
  await wait(target,'document.querySelector("[data-mobile-display]").open','display menu opened')
  await select(target,'[data-mobile-display] [data-display-locale]',locale);await wait(target,'document.documentElement.lang==='+q(locale),'locale applied')
  await tap(target,'[data-mobile-display] [data-style-choice='+style+']');await wait(target,'document.documentElement.dataset.uiStyle==='+q(style),'style applied')
  target.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});target.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(target,'!document.querySelector("[data-mobile-display]").open','preference menu dismissed')
}
async function finish(){phone?.destroy();pc?.destroy();await shared?.stop();db?.close()}
app.whenReady().then(async()=>{try{
  db=require(process.env.POS_RECOVERY_BACKEND||'../../electron/database.js')(path.join(root,'recovery-ui.db'))
  const password=JSON.stringify({salt:Array(32).fill(1),iter:1000,hash:[...pbkdf2Sync('fixture-password',Buffer.alloc(32,1),1000,32,'sha256')]})
  db.addUser({id:'owner',username:owner.username,password,role:'owner'});db.setSettings({storeName:'Recovery Fixture',sharedStoreId:'recovery-store'});db.addProduct({id:'p',name:'Recovery product',unit:'個',stock:5,cost:4,price:10});db.openShift({id:'shift',openCash:100,cashier:owner.username})
  const context=db.getSalesState(owner),header={kind:'sales',storeId:context.storeId,epoch:context.epoch,date:context.today}
  let result=db.applySalesOperation({...header,id:'recovery-sale',time:new Date().toISOString(),action:'create',document:{customer:{id:'buyer',name:'Recovery customer'},date:context.today,items:[{productId:'p',qty:2,unitPrice:10,expectedProduct:productReference(db.getProducts()[0])}],note:''}},owner);assert.equal(result.success,true,result.error)
  result=db.applySalesOperation({...header,id:'recovery-delivery',time:new Date().toISOString(),action:'deliver',orderId:'recovery-sale',expectedRevision:1,quantities:[2],dueDate:context.today,handedOver:true},owner);assert.equal(result.success,true,result.error)
  const backup=db.createBackup('Before customer payment',owner.username)
  pc=new BrowserWindow({show:false,width:1380,height:1000,webPreferences:{preload:path.resolve('electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}})
  pc.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}))
  const security=require('../../electron/ipcSecurity.cjs').createIpcSecurity({db,getWindow:()=>pc,rendererPath}),persist=db.applySalesOperation;let lost=false,paymentCalls=0
  db.applySalesOperation=function(...args){if(args[0].action==='pay')paymentCalls++;const saved=persist.apply(db,args);if(saved.success&&args[0].action==='pay'&&!lost){lost=true;throw Error('fixture response lost after real cash collection')}return saved}
  require('../../electron/ipcHandlers.cjs')({ipcMain,db,ipcSecurity:security,getOrderServer:()=>null,getLocalIP:()=> '127.0.0.1',sharedStore:{status:()=>({running:false,addresses:[]})}})
  await pc.loadFile(rendererPath);await wait(pc,'!!document.querySelector("[data-display-locale]")','display preferences');await select(pc,'[data-display-locale]','en');await tap(pc,'[data-style-choice="simple"]');await login(pc)
  shared=require('../../electron/sharedStoreServer.cjs')({db,distRoot:path.resolve(process.env.POS_RECOVERY_DIST||'dist'),certificateRoot:path.join(root,'certificate'),allowLoopback:true});const status=await shared.start({host:'127.0.0.1',port:0}),origin='https://127.0.0.1:'+status.port,certificate=new X509Certificate(Buffer.from(shared.certificate(),'base64'))
  const phoneSession=session.fromPartition('recovery-phone-fixture');phoneSession.setCertificateVerifyProc((request,done)=>done(new X509Certificate(request.certificate.data).fingerprint256===certificate.fingerprint256?0:-2));phoneSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>done({cancel:!details.url.startsWith(origin+'/')}))
  phone=new BrowserWindow({show:false,width:360,height:850,webPreferences:{session:phoneSession,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}})
  await phone.loadURL(shared.pair().url);await wait(phone,'!!document.querySelector("[data-display-locale]")','paired login');await select(phone,'[data-display-locale]','en');await tap(phone,'[data-style-choice="simple"]');await login(phone)
  await task(phone,'receivables','接客戶訂單、收欠款');await wait(phone,'!!document.querySelector("[data-sales-document]")','same store sales order');await tap(phone,'[data-sales-document]');await wait(phone,'!!document.querySelector("[data-sales-pay]")','selected sales document ready');await tap(phone,'[data-sales-pay]');await wait(phone,'!!document.querySelector("[data-sales-amount]")','partial cash form');await input(phone,'[data-sales-amount]','5');await tap(phone,'[data-sales-op-save]');await wait(phone,'!!localStorage.getItem("pos_pending_financial_v1")&&!!document.querySelector("[data-sales-retry]:not(:disabled)")','lost cash reply')
  assert.equal(lost,true,"the real commit and deliberately lost reply must finish before reading its receipt");const pending=await js(phone,'JSON.parse(localStorage.getItem("pos_pending_financial_v1"))');assert.equal(doc().payments[0].id,pending.request.id);assert.equal(db.exportData().cashLog[0].amount,5);observations.originalPaymentId=pending.request.id;observations.beforeRestore={cashLogs:db.exportData().cashLog.length,payments:doc().payments.length,stock:db.getProducts()[0].stock};pass('real HTTPS phone commits cash once while a lost response retains the original durable journal')
  await task(pc,'settings','設定、備份還原');await button(pc,en('備份還原'));await wait(pc,'document.body.innerText.includes("Before customer payment")','original backup shown')
  await js(pc,'(()=>{const card=[...document.querySelectorAll(".card")].find(e=>e.innerText.includes("Before customer payment")&&[...e.querySelectorAll("button")].some(b=>b.textContent.trim()==='+q(en('還原'))+'));if(!card)throw Error("missing exact backup");[...card.querySelectorAll("button")].find(b=>b.textContent.trim()==='+q(en('還原'))+').setAttribute("data-restore-fixture","")})()');await tap(pc,'[data-restore-fixture]')
  await wait(pc,'[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==='+q(en('確認還原'))+')','restore review dialog ready')
  let extraCash=0
  if(await js(pc,'!!document.querySelector("[data-restore-ack]")')){
    await capture(pc,root,'recovery-restore-preview-pc')
    const before=db.exportData(),cash={id:'cash-after-preview',time:new Date().toISOString(),shiftId:'shift',type:'in',amount:1,reason:'Actual cash after preview',cashier:owner.username}
    assert.equal((await js(phone,'window.electronAPI.db.addCashLog('+q(cash)+')')).success,true);extraCash=1
    await tap(pc,'[data-restore-ack]');await button(pc,en('確認還原'));await wait(pc,'!!document.querySelector("[data-restore-preview] [role=alert]")','stale preview rejected')
    assert.equal(doc().payments.length,before.salesDocuments[0].payments.length);assert.equal(db.exportData().cashLog.length,2);assert.equal(await js(pc,'!!document.querySelector("[data-restore-ack]:disabled")'),true)
    await capture(pc,root,'recovery-stale-preview-pc');await button(pc,en('重新查看還原預覽'));await wait(pc,'!!document.querySelector("[data-restore-ack]:not(:disabled)")','new preview required');await tap(pc,'[data-restore-ack]')
    pass('real private phone cash after the desktop preview invalidates confirmation and keeps both payments until a new preview is acknowledged')
  }
  await button(pc,en('確認還原'));await wait(pc,'(async()=>!(await window.electronAPI.db.getSalesState()).documents[0].payments.length)()','intentional older snapshot restore')
  observations.afterRestore={cashLogs:db.exportData().cashLog.length,payments:doc().payments.length,stock:db.getProducts()[0].stock,backupCount:db.getBackups().length};assert.equal(doc().payments.length,0);assert.equal(db.exportData().cashLog.length,0)
  await tap(phone,'[data-sales-retry]');const retryDeadline=Date.now()+12000;while(paymentCalls<2&&Date.now()<retryDeadline)await new Promise(resolve=>setTimeout(resolve,40));assert.equal(paymentCalls,2);await wait(phone,'!!document.querySelector("[data-sales-retry]:not(:disabled)")','original retry finished')
  assert.equal(await js(phone,'JSON.parse(localStorage.getItem("pos_pending_financial_v1")).request.id'),pending.request.id);assert.equal(doc().payments.length,0)
  observations.hasRecoveryEntry=await js(phone,'!!document.querySelector("[data-recovery-open]")');await capture(phone,root,'recovery-missing-record-phone');fs.writeFileSync(path.join(root,'recovery-observations.json'),JSON.stringify(observations,null,2));console.log('RECOVERY_OBSERVATIONS '+JSON.stringify(observations))
  assert.equal(observations.hasRecoveryEntry,true,'an uncertain original payment after restore must have an actionable owner recovery guide')
  await tap(phone,'[data-recovery-open]');await wait(phone,'!!document.querySelector("[data-recovery-source]")','protected original payment source')
  const book=db.exportData(),journal=await js(phone,'localStorage.getItem("pos_pending_financial_v1")');observations.locales=[]
  for(const locale of ['en','ja','zh-TW','zh-CN'])for(const style of ['simple','poster']){
    await display(phone,locale,style)
    await wait(phone,'document.documentElement.lang==='+q(locale)+'&&document.documentElement.dataset.uiStyle==='+q(style),'recovery display preference')
    const measured=await js(phone,'({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,heading:document.querySelector(".recovery-page h1").textContent,labels:[...document.querySelectorAll("[data-recovery-source] h2,[data-recovery-source] button")].map(e=>e.textContent),minimum:[...document.querySelectorAll("[data-recovery-source] button")].map(e=>e.getBoundingClientRect().height)})')
    assert.equal(measured.overflow,false);assert.equal(measured.heading,tr('一步一步找回資料',{},locale));assert.ok(measured.minimum.every(h=>h>=48));if(locale==='en')assert.ok(measured.labels.every(text=>!/[\u3400-\u9fff]/u.test(text)),q(measured))
    assert.equal(await js(phone,'localStorage.getItem("pos_pending_financial_v1")'),journal);assert.deepEqual(db.exportData(),book);observations.locales.push({locale,style,...measured});await js(phone,'document.querySelector("[data-recovery-source]").scrollIntoView({block:"start"})');await capture(phone,root,'recovery-preview-'+locale+'-'+style)
  }
  await display(phone,'en','simple')
  pass('360px recovery preview, original ID and 48px actions remain usable in four languages and both styles without altering any book or pending journal')
  assert.ok(await js(phone,'document.querySelector("[data-recovery-source]").innerText.includes('+q(pending.request.id)+')'));await tap(phone,'[data-recovery-ack]');await wait(phone,'document.querySelector("[data-recovery-ack]").checked&&!!document.querySelector("[data-recovery-restore]:not(:disabled)")','recovery consent applied before scrolling to restore');await tap(phone,'[data-recovery-restore]');await wait(phone,'!localStorage.getItem("pos_pending_financial_v1")&&!!document.querySelector(".recovery-notice")&&!document.querySelector("[data-recovery-original]")','original operation confirmed and final UI rendered')
  await js(phone,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(doc().payments.length,1);assert.equal(doc().payments[0].id,pending.request.id);assert.equal(db.exportData().cashLog.length,1+extraCash);assert.equal(db.exportData().cashLog.reduce((sum,row)=>sum+row.amount,0),5+extraCash);assert.equal(db.getProducts()[0].stock,3);await capture(phone,root,'recovery-original-confirmed-phone');pass('owner-guided protected recovery restores the complete original book, including the later cash entry, and clears the same journal after the final success UI renders')
  fs.writeFileSync(path.join(root,'recovery-observations.json'),JSON.stringify(observations,null,2))
  console.log(JSON.stringify({success:true,marker:'POS_RECOVERY_UI_PASS',tests,realPhone:false,externalNetwork:false,backupId:backup.id}));await finish();app.exit(0)
}catch(error){console.error(error.stack);try{if(phone&&!phone.isDestroyed())await capture(phone,root,'recovery-failed-phone')}catch{}await finish();app.exit(1)}})
