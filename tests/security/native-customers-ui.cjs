const {app,BrowserWindow,ipcMain,session}=require('electron')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pbkdf2Sync,X509Certificate,randomUUID}=require('node:crypto')
const {js,wait,input,select,tap,button,capture}=require('./rendererHarness.cjs')
const {tr}=require('../../public/i18n/core.mjs'),{salesSummary}=require('../../electron/salesRules.mjs')
const {salesToJournalEntries}=require('../../electron/salesJournal.mjs'),{customerLedgerToJournalEntries}=require('../../electron/customerJournal.mjs')
const {summarizeShift}=require('../../electron/shiftReconciliation.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated fixture required')
const evidence=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(evidence,{recursive:true})
const rendererPath=path.resolve(process.env.POS_CUSTOMERS_RENDERER||'dist/index.html'),owner={role:'owner',userId:'owner',username:'Fixture Owner'}
app.setPath('userData',root);app.disableHardwareAcceleration()
let db,w,phone,attacker,shared,checks=0,loseReceive=true;const errors=[],q=JSON.stringify,en=source=>tr(source,{},'en')
const pass=name=>{checks++;console.log('PASS '+name)},state=()=>db.getSalesState(owner),ledger=()=>state().customerLedger
const receipt=()=>ledger().receipts.find(r=>r.amount===500),cash=()=>db.exportData().cashLog
const draftKey=()=> 'Object.keys(localStorage).find(key=>key.startsWith("pos_customer_draft_v1:"))'
function observe(target){target.webContents.on('console-message',event=>{if((event.level==='error'||event.level===3)&&/TypeError|ReferenceError|Uncaught|Minified React/.test(event.message))errors.push(event.message)})}
async function login(target,name=owner.username){
  await wait(target,'[...document.querySelectorAll("button")].some(b=>b.textContent.includes('+q(name)+'))','account chooser')
  await js(target,'[...document.querySelectorAll("button")].find(b=>b.textContent.includes('+q(name)+')).click()');await input(target,'input[type=password]','fixture-password')
  await js(target,'document.querySelector("form").requestSubmit()');await wait(target,'!!document.querySelector(".easy-home")','signed-in home')
}
async function enter(target){await input(target,'.easy-search input','advance');await tap(target,'.easy-task');await wait(target,'!!document.querySelector("[data-customer-new]:not(:disabled)")','customer workspace')}
async function confirmed(target){await tap(target,'[data-customer-confirm]');await wait(target,'document.querySelector("[data-customer-confirm]").checked&&!document.querySelector("[data-customer-save]").disabled','explicit actual-money confirmation')}
async function saved(target,label){await tap(target,'[data-customer-save]');await wait(target,'!document.querySelector("[data-customer-save]")&&!localStorage.getItem("pos_pending_financial_v1")',label)}
async function newDelivered(price,customerId){
  await button(w,en('銷售與應收'));await wait(w,'!!document.querySelector("[data-sales-new]:not(:disabled)")','sales ready')
  await tap(w,'[data-sales-new]');await select(w,'[data-sales-customer-select]',customerId)
  assert.equal(await js(w,'document.querySelector("[data-sales-customer]").readOnly'),true)
  await tap(w,'[data-sales-submit]');await wait(w,'!!document.querySelector(".sales-products button")','order items');await tap(w,'.sales-products button');await input(w,'[data-sales-qty]','1');await input(w,'[data-sales-price]',String(price));await tap(w,'[data-sales-submit]')
  await wait(w,'!!document.querySelector("[data-sales-agreed]")','order agreement');await tap(w,'[data-sales-agreed]');await wait(w,'document.querySelector("[data-sales-agreed]").checked','agreement checked');await tap(w,'[data-sales-submit]')
  await wait(w,'!!document.querySelector("[data-sales-deliver]")&&!localStorage.getItem("pos_pending_financial_v1")','order accepted');await tap(w,'[data-sales-deliver]');await wait(w,'!!document.querySelector("[data-sales-handover]")','handover review');await tap(w,'[data-sales-handover]');await wait(w,'document.querySelector("[data-sales-handover]").checked','actual handover');await tap(w,'[data-sales-op-save]');await wait(w,'!!document.querySelector(".sales-detail")&&!document.querySelector("[data-sales-operation]")','handover committed')
  return state().documents.find(doc=>doc.total===price)
}
function account(number){return [...state().documents.flatMap(salesToJournalEntries),...customerLedgerToJournalEntries(ledger().entries)].flatMap(entry=>entry.lines).filter(line=>line.account===number).reduce((sum,line)=>sum+Math.round(line.debit*100)-Math.round(line.credit*100),0)/100}
async function finish(){attacker?.destroy();phone?.destroy();w?.destroy();await shared?.stop();db?.close()}
app.whenReady().then(async()=>{try{
  db=require('../../electron/database.js')(path.join(root,'customers-ui.db'))
  const password=JSON.stringify({salt:Array(32).fill(1),iter:1000,hash:[...pbkdf2Sync('fixture-password',Buffer.alloc(32,1),1000,32,'sha256')]})
  db.addUser({id:'owner',username:owner.username,password,role:'owner'});db.addUser({id:'staff',username:'Fixture Staff',password,role:'staff'})
  db.setSettings({sharedStoreId:'customers-ui-store',storeName:'Fixture Store'});db.addProduct({id:'bowl',name:'牛丼',unit:'碗',stock:10,cost:40,price:150});db.openShift({id:'shift',openCash:100,cashier:owner.username})
  w=new BrowserWindow({show:false,width:1380,height:1000,webPreferences:{preload:path.resolve('electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});observe(w)
  w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}))
  const security=require('../../electron/ipcSecurity.cjs').createIpcSecurity({db,getWindow:()=>w,rendererPath}),persist=db.applyCustomerLedgerOperation
  db.applyCustomerLedgerOperation=function(...args){const result=persist.apply(db,args);if(result.success&&args[0].action==='receive'&&loseReceive){loseReceive=false;throw Error('fixture receipt reply lost after actual commit')}return result}
  require('../../electron/ipcHandlers.cjs')({ipcMain,db,ipcSecurity:security,getOrderServer:()=>null,getLocalIP:()=> '127.0.0.1',sharedStore:{status:()=>({running:false,addresses:[]})}})
  await w.loadFile(rendererPath);await wait(w,'!!document.querySelector("[data-display-locale]")','display preferences');await select(w,'[data-display-locale]','en');await tap(w,'[data-style-choice="simple"]');await login(w);await enter(w)
  pass('actual English bright owner workspace opens the lazy customer directory from its everyday task')
  const customerName='丼飯 <script>window.__customerXss=1</script>'
  await tap(w,'[data-customer-new]');await input(w,'[data-customer-name]',customerName);await input(w,'[data-customer-phone]','0900-123-456');await saved(w,'customer registered')
  const customerId=ledger().customers[0].id;assert.equal(ledger().customers[0].name,customerName);assert.equal(ledger().customers[0].phone,'0900-123-456');assert.equal(cash().length,0);assert.equal(state().documents.length,0)
  pass('one visible customer registration stores its own stable identity and literal merchant text without moving money')
  await tap(w,'[data-customer-receive]');await input(w,'[data-customer-amount]','500');await js(w,'document.querySelector(".customer-form details").open=true');await input(w,'.customer-form textarea','原備註 TWD <script>note</script>','HTMLTextAreaElement')
  for(const locale of ['ja','zh-CN','zh-TW','en']){await select(w,'[data-display-locale]',locale);await select(w,'[data-display-style]',locale==='ja'?'poster':'simple');assert.equal(await js(w,'document.querySelector("[data-customer-amount]").value'),'500');assert.equal(await js(w,'document.querySelector(".customer-form textarea").value'),'原備註 TWD <script>note</script>')}
  assert.equal(await js(w,'document.querySelector("[data-customer-save]").disabled'),true);assert.equal(cash().length,0);assert.equal(ledger().receipts.length,0)
  await capture(w,evidence,'customers-bright-receive-en');pass('four language and two style changes preserve unfinished amount and original notes; no actual-money confirmation means no receipt')
  await confirmed(w);await tap(w,'[data-customer-save]');await wait(w,'!!document.querySelector("[data-customer-retry]")&&!!localStorage.getItem("pos_pending_financial_v1")','lost receipt acknowledgement')
  const pending=await js(w,'JSON.parse(localStorage.getItem("pos_pending_financial_v1"))'),pinned=await js(w,'JSON.parse(localStorage.getItem('+draftKey()+')).form')
  assert.equal(pinned.operationIdentity.id,pending.request.id);assert.equal(pinned.submittedShiftId,'shift');assert.equal(receipt().id,pending.request.id);assert.equal(cash().length,1);assert.equal(account('2192'),-500);assert.equal(account('4101'),0)
  w.webContents.reload();await wait(w,'!!document.querySelector("[data-customer-retry]")','receipt recovery after actual reload');await tap(w,'[data-customer-retry]');await wait(w,'!localStorage.getItem("pos_pending_financial_v1")&&!!document.querySelector("[data-customer-receive]")','same receipt confirmed')
  assert.equal(await js(w,'localStorage.getItem('+draftKey()+')'),null);assert.equal(cash().length,1);assert.equal(ledger().receipts.length,1);assert.equal(receipt().id,pending.request.id)
  w.webContents.reload();await wait(w,'!!document.querySelector(".easy-home")','ordinary restart after receipt confirmation');await enter(w);assert.equal(await js(w,'!!document.querySelector("[data-customer-amount]")'),false)
  pass('a real committed receipt with a lost IPC reply retains its original ID, survives reload, clears its exact draft and cannot reappear as a second collection')
  const first=await newDelivered(150,customerId),second=await newDelivered(250,customerId)
  assert.ok(first&&second);assert.equal(state().documents.length,2);assert.equal(db.getProducts()[0].stock,8);assert.equal(db.getOrders().length,0);assert.equal(account('1141'),400);assert.equal(account('4101'),-400);assert.equal(account('5101'),80);assert.equal(cash().length,1)
  pass('the real sales wizard reuses the directory customer and hands over two separately priced orders, keeping one cash receipt and two receivables')
  await button(w,en('客戶與款項'));await wait(w,'!!document.querySelector("[data-customer-select]")','directory ready');await tap(w,'[data-customer-select]')
  shared=require('../../electron/sharedStoreServer.cjs')({db,distRoot:path.resolve('dist'),certificateRoot:path.join(root,'cert'),allowLoopback:true,onChanged:()=>{if(w&&!w.isDestroyed())w.webContents.send('store:changed')}})
  await shared.start({host:'127.0.0.1',port:0});const certificate=new X509Certificate(Buffer.from(shared.certificate(),'base64')),phoneSession=session.fromPartition('customer-phone-fixture')
  phoneSession.setCertificateVerifyProc((request,done)=>done(new X509Certificate(request.certificate.data).fingerprint256===certificate.fingerprint256?0:-2))
  const origin=new URL(shared.status().url).origin;phoneSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>done({cancel:new URL(details.url).origin!==origin}))
  phone=new BrowserWindow({show:false,width:360,height:850,webPreferences:{session:phoneSession,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});observe(phone)
  await phone.loadURL(shared.pair().url);await wait(phone,'!!document.querySelector("[data-display-locale]")','paired phone preferences');await select(phone,'[data-display-locale]','en');await tap(phone,'[data-style-choice="simple"]');await login(phone);await enter(phone);await tap(phone,'[data-customer-select]');await select(phone,'[data-display-locale]','ja')
  await tap(phone,'[data-customer-allocate]');assert.equal(await js(phone,'document.querySelectorAll("[data-customer-allocation]").length'),2)
  assert.deepEqual(await js(phone,'[...document.querySelectorAll("[data-customer-allocation]")].map(e=>Number(e.value)).sort((a,b)=>a-b)'),[150,250])
  assert.ok(await js(phone,'document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector(".customer-page").scrollWidth<=document.querySelector(".customer-page").clientWidth+1'));await capture(phone,evidence,'customers-bright-allocation-phone-ja')
  await confirmed(phone);await saved(phone,'two claims allocated');assert.equal(receipt().available,100);assert.equal(receipt().allocated,400);assert.equal(account('1141'),0);assert.equal(account('2192'),-100);assert.equal(cash().length,1)
  await wait(w,'document.querySelector(".customer-metrics").innerText.includes("100.00")','desktop balance updated from phone');assert.ok(await js(phone,'document.body.innerText.includes('+q(customerName)+')&&!window.__customerXss'));assert.equal(await js(w,'document.documentElement.lang'),'en')
  pass('an actual private HTTPS 360px Japanese phone allocates one receipt across two documents and automatically refreshes the English desktop balance without a second cash entry')
  const allocation=ledger().entries.find(event=>event.action==='allocate')
  await tap(phone,'[data-customer-unallocate='+q(allocation.id)+']');const firstDelivery=first.deliveries[0].id,secondDelivery=second.deliveries[0].id
  await input(phone,'[data-customer-allocation='+q(firstDelivery)+']','60');await input(phone,'[data-customer-allocation='+q(secondDelivery)+']','0');await input(phone,'[data-customer-reason]','release part of original receipt');await confirmed(phone);await saved(phone,'partial allocation released')
  assert.equal(receipt().available,160);assert.equal(account('1141'),60);assert.equal(cash().length,1)
  await tap(phone,'[data-customer-refund]');await input(phone,'[data-customer-amount]','70');await input(phone,'[data-customer-reason]','actual original cash refund');await confirmed(phone);await saved(phone,'cash refund recorded')
  assert.equal(receipt().available,90);assert.equal(account('1101'),430);assert.equal(summarizeShift(db.getOpenShift(),db.getOrders(),cash(),db.getTopups()).expected,530)
  const refund=ledger().entries.find(event=>event.action==='refund');await tap(phone,'[data-customer-refund-reverse='+q(refund.id)+']');await input(phone,'[data-customer-reason]','cash correction checked');await confirmed(phone);await saved(phone,'refund corrected')
  assert.equal(receipt().available,160);assert.equal(receipt().refunded,0);assert.equal(account('1101'),500);assert.equal(summarizeShift(db.getOpenShift(),db.getOrders(),cash(),db.getTopups()).expected,600)
  pass('phone partial release, actual cash refund and original-method refund correction preserve each source and reconcile the same physical drawer expectation')
  await select(phone,'[data-display-locale]','en');await tap(phone,'[data-customer-back]');await js(phone,'document.querySelector(".customer-agent").open=true')
  const agent={protocol:'pos-customer-receipt-draft/v1',id:'agent-original-bank-receipt',issuedAt:new Date().toISOString(),storeId:state().storeId,customerId,amount:25,method:'bank',reference:'TWD original bank reference',note:'Agent 原文 <script>window.__agentReceiptXss=1</script>'}
  await input(phone,'[data-customer-agent]',JSON.stringify(agent),'HTMLTextAreaElement');await tap(phone,'[data-customer-agent-review]');await wait(phone,'!!document.querySelector("[data-customer-confirm]")','Agent owner review')
  assert.equal(await js(phone,'document.querySelector("[data-customer-confirm]").checked'),false);assert.equal(ledger().receipts.length,1);assert.equal(cash().length,3)
  await confirmed(phone);await saved(phone,'Agent bank receipt reviewed and saved');assert.equal(ledger().receipts.length,2);assert.equal(ledger().receipts.find(r=>r.id===agent.id).amount,25);assert.equal(cash().length,3);assert.equal(account('1103'),25)
  await tap(phone,'[data-customer-back]');await js(phone,'document.querySelector(".customer-agent").open=true');await input(phone,'[data-customer-agent]',JSON.stringify(agent),'HTMLTextAreaElement');await tap(phone,'[data-customer-agent-review]');await wait(phone,'!!document.querySelector(".customer-page [role=alert]")','duplicate Agent original refused');assert.equal(ledger().receipts.length,2)
  pass('the Agent protocol fills a review with confirmation unchecked, saves the exact original ID only after owner confirmation, and refuses to create that receipt again')
  await button(w,en('報表分析'));await wait(w,'!!document.querySelector("[data-business-report]")','integrated report');assert.ok(await js(w,'document.querySelector("[data-business-report]").innerText.includes('+q(tr('目前全部客戶未付款：{0}',{0:'NT$ 60'},'en'))+')'));assert.ok(await js(w,'!document.querySelector("main").innerText.includes("長尾商品，可考慮汰除")'));await capture(w,evidence,'customers-bright-report-en')
  await button(w,en('會計帳務'));await button(w,en('日記帳'));await wait(w,'document.querySelector("main").innerText.includes('+q(en('客戶預收與抵付'))+')','advance journal source');assert.equal(account('1141'),60);assert.equal(account('2192'),-185);assert.equal(account('4101'),-400)
  pass('the visible business report and general ledger include the customer ledger while retaining separate receipt cash, unsettled claims, advances and recognized sales')
  const record=(action,extra)=>{const s=state(),result=db.applyCustomerLedgerOperation({id:'history-'+randomUUID(),kind:'customer-ledger',action,storeId:s.storeId,epoch:s.epoch,date:s.today,time:new Date().toISOString(),expectedRevision:s.customerLedger.revision,customerId,...extra},owner);assert.equal(result.success,true,result.error);return result.event}
  const oldBank=record('receive',{amount:1,method:'bank',shiftId:'',confirmed:true})
  for(let index=0;index<30;index++){const r=record('refund',{receiptId:oldBank.id,amount:.01,reason:'history fixture original refund',shiftId:'',confirmed:true});record('refund-reverse',{refundId:r.id,reason:'history fixture correction',shiftId:'',confirmed:true})}
  await button(w,en('客戶與款項'));await wait(w,'!!document.querySelector("[data-customer-select]")','long-history customer directory');await tap(w,'[data-customer-select]');await wait(w,'!!document.querySelector("[data-customer-history-more]")','earlier customer history available');assert.equal(await js(w,'document.querySelectorAll("[data-customer-history]").length'),50);await tap(w,'[data-customer-history-more]');await wait(w,'!!document.querySelector('+q('[data-customer-unallocate='+q(allocation.id)+']')+')','original allocation remains actionable beyond fifty entries');assert.equal(ledger().entries.find(e=>e.id===allocation.id).items.length,2)
  pass('history beyond fifty visible rows remains complete and the owner can reveal the original allocation for a later correction')
  attacker=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});await attacker.loadFile(rendererPath)
  assert.equal(await js(attacker,'window.electronAPI.db.getSalesState().then(()=>false,()=>true)'),true);assert.equal(await js(attacker,'window.electronAPI.db.applyCustomerLedgerOperation({id:"foreign-frame"}).then(()=>false,()=>true)'),true)
  await js(phone,'window.electronAPI.auth.logout()');phone.webContents.reload();await wait(phone,'!!document.querySelector("input[type=password]")','phone account chooser');await login(phone,'Fixture Staff');const before=JSON.stringify(db.exportData())
  assert.equal(await js(phone,'window.electronAPI.db.getSalesState().then(()=>false,()=>true)'),true);assert.equal(await js(phone,'window.electronAPI.db.applyCustomerLedgerOperation({id:"forged-owner"},{role:"owner"}).then(()=>false,()=>true)'),true);assert.equal(JSON.stringify(db.exportData()),before)
  pass('actual preload frame checks and paired HTTPS staff authorization deny reading or writing private customer balances, including a forged owner argument')
  assert.deepEqual(errors,[]);pass('customer, sales, reports, receipt recovery and mobile journeys finish without uncaught renderer errors')
  console.log(JSON.stringify({success:true,marker:'POS_CUSTOMERS_UI_PASS',tests:checks,realPhone:false,externalNetwork:false,publicTunnel:false}));await finish();app.exit(0)
}catch(error){console.error(error.stack);try{if(w&&!w.isDestroyed()){await capture(w,evidence,'customers-owner-failed');fs.writeFileSync(path.join(evidence,'owner-failed.txt'),await js(w,'document.body.innerText'))}if(phone&&!phone.isDestroyed()){await capture(phone,evidence,'customers-phone-failed');fs.writeFileSync(path.join(evidence,'phone-failed.txt'),await js(phone,'document.body.innerText'))}}catch{}await finish();app.exit(1)}})
