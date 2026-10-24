const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Database=require('better-sqlite3')
const init=require('../../electron/database.js'),fixture=require('../fixtures/table-kitchen-v1.json'),{canonicalSignature}=require('../../electron/operationRules.mjs')
const {summarizeRestaurantFunds}=require('../../electron/restaurantFunds.mjs'),{restaurantFundsToJournalEntries,restaurantFundedOrderToJournalEntries}=require('../../electron/restaurantFundsJournal.mjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated funds fixture root required')
const out=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(out,{recursive:true})
const file=path.join(root,'restaurant-funds.db'),owner=fixture.owner,checks=[],observations=[];let db
const ok=result=>{assert.equal(result.success,true,result.error);return result}
function pass(message){checks.push(message);console.log('PASS '+message)}
function command(id,action,extra={}){const state=db.getRestaurantState();return {id,kind:'restaurant',action,time:new Date().toISOString(),storeId:state.storeId,epoch:state.epoch,...extra}}
function act(id,action,entry,extra={},who=owner){return db.applyRestaurantOperation(command(id,action,{entryId:entry.id,expectedVersion:entry.version,...extra}),who)}
function current(id){return db.getRestaurantState().entries.find(entry=>entry.id===id)}
function journal(){const state=db.getRestaurantState();return [...restaurantFundsToJournalEntries(state.entries),...db.getOrders().filter(order=>order.source==='restaurant-funded').flatMap(order=>restaurantFundedOrderToJournalEntries(order,state.entries.find(entry=>entry.saleId===order.id||entry.saleId===order.refundOf)))]}
function balance(rows,account){return Math.round(rows.flatMap(row=>row.lines).filter(line=>line.account===account).reduce((sum,line)=>sum+line.debit-line.credit,0)*100)/100}
try{
 db=init(file);for(const user of fixture.before.users)db.addUser(user)
 const preview=db.previewRestore({kind:'import',data:structuredClone(fixture.before)},owner);ok(db.applyRestorePreview(preview.id,owner))
 const config=db.getRestaurantState().config
 ok(db.applyRestaurantOperation(command('funds-configure','configure',{expectedConfig:canonicalSignature(config),config:{...config,fundsEnabled:true,dailyCapacity:20,slotCapacity:10}}),owner))
 const state=db.getRestaurantState();assert.ok(state.storeId&&state.epoch)
 let booking=ok(db.applyRestaurantOperation(command('funds-booking','create',{channel:'walkin',day:state.today,slot:'12:00',customer:'Native funds',contact:'',note:'',items:[{id:'bowl',qty:2,price:100}]}),owner)).entry
 assert.equal(db.getProducts().find(row=>row.id==='rice').stock,2.5)
 const depositRequest=command('funds-deposit','funds-receive',{entryId:booking.id,expectedVersion:booking.version,amount:50,paid:100,payMethod:'cash',shiftId:'table-shift'})
 const received=ok(db.applyRestaurantOperation(depositRequest,owner));assert.equal(received.fundsEvent.changeCents,5000)
 assert.equal(db.getOrders().filter(row=>row.source==='restaurant-funded').length,0);assert.equal(balance(journal(),'1101'),50);assert.equal(balance(journal(),'2193'),-50);assert.equal(balance(journal(),'4101'),0)
 pass('actual SQLite deposit saves one immutable source and actual cash movement with a contract liability, without recognizing a sale')
 const once=db.exportData();ok(db.applyRestaurantOperation(depositRequest,owner));assert.deepEqual(db.exportData(),once)
 const changed=db.applyRestaurantOperation({...depositRequest,amount:51},owner);assert.equal(changed.success,false);assert.deepEqual(db.exportData(),once)
 const wrong=db.applyRestaurantOperation({...command('funds-wrong-store','funds-receive',{entryId:booking.id,expectedVersion:received.entry.version,amount:1,paid:1,payMethod:'cash',shiftId:'table-shift'}),storeId:'foreign-store'},owner)
 assert.equal(wrong.success,false);assert.equal(wrong.committed,null);assert.deepEqual(db.exportData(),once)
 pass('same original replays once, changed content cannot replace it, and a wrong store remains uncertain without changing any book')
 const sqlite=new Database(file);require('../../electron/databaseFeatureFence.cjs').register(sqlite)
 sqlite.exec("CREATE TRIGGER funds_late_failure BEFORE INSERT ON restaurant_operations WHEN NEW.id='funds-late-failure' BEGIN SELECT RAISE(ABORT,'fixture late funds failure'); END")
 const beforeFailure=db.exportData()
 const failed=act('funds-late-failure','funds-receive',current(booking.id),{amount:10,paid:10,payMethod:'cash',shiftId:'table-shift'})
 assert.equal(failed.success,false);assert.equal(failed.committed,false);assert.deepEqual(db.exportData(),beforeFailure)
 sqlite.exec('DROP TRIGGER funds_late_failure');sqlite.close()
 pass('a real late SQL trigger failure rolls back funds, entry version and cash row together')
 booking=ok(act('funds-cancel-one','cancel-part',current(booking.id),{quantities:[{id:'bowl',qty:1}],reason:'one fewer'})).entry
 assert.equal(booking.total,100);assert.equal(db.getProducts().find(row=>row.id==='rice').stock,3.75);assert.equal(summarizeRestaurantFunds(booking.funds).dueCents,5000)
 const firstExpected=db.getOpenShift().openCash+50,closed=ok(db.closeShift('table-shift',{closeCash:firstExpected,note:'fixture first shift'}))
 assert.equal(closed.expected,firstExpected);assert.equal(closed.diff,0)
 ok(db.openShift({id:'funds-second-shift',cashier:owner.username,openCash:0}))
 const tail=ok(act('funds-tail','funds-receive',booking,{amount:50,paid:50,payMethod:'card',shiftId:'funds-second-shift'}))
 assert.equal(tail.funding.dueCents,0);assert.equal(db.getCashLog('table-shift').filter(row=>row.reason.startsWith('預訂實收款')).length,1)
 pass('partial cancellation releases exactly one frozen ingredient portion; a different open shift records only the remaining tender')
 ok(act('funds-cook','advance',current(booking.id),{status:'cooking'}));ok(act('funds-ready','advance',current(booking.id),{status:'ready'}))
 const complete=ok(act('funds-complete','advance',current(booking.id),{status:'completed'}))
 assert.equal(complete.order.total,100);assert.equal(complete.order.source,'restaurant-funded');assert.equal(complete.order.shiftId,'')
 assert.equal(balance(journal(),'1101'),50);assert.equal(balance(journal(),'1103'),50);assert.equal(balance(journal(),'2193'),0);assert.equal(balance(journal(),'4101'),-100)
 const afterDelivery=db.exportData();db.close();db=init(file)
 assert.deepEqual(db.exportData(),afterDelivery)
 const old=ok(db.applyRestaurantOperation(depositRequest,owner));assert.equal(old.fundsEvent.amountCents,5000);assert.equal(old.entry.status,'completed');assert.deepEqual(db.exportData(),afterDelivery)
 pass('fulfilment creates one separate source recognition; real database close/reopen and late deposit replay preserve the original without collecting cash again')
 const cancelled=ok(act('funds-cancel-rest','cancel',current(booking.id),{reason:'prepared return',shiftId:'funds-second-shift'}))
 assert.equal(cancelled.entry.status,'cancelled');assert.equal(cancelled.refund.total,-100);assert.equal(db.getProducts().find(row=>row.id==='rice').stock,3.75)
 assert.equal(db.getWasteLog().filter(row=>row.reason==='預訂部分取消：prepared return').reduce((sum,row)=>sum+row.qty,0),1.25)
 assert.equal(balance(journal(),'1101'),0);assert.equal(balance(journal(),'1103'),0);assert.equal(balance(journal(),'2193'),0);assert.equal(balance(journal(),'4101'),0)
 const packet=db.exportFullBackup(owner);assert.equal(packet.protection.version,6);assert.equal(packet.features.includes('restaurant-funds-v1'),true)
 observations.push({entryId:booking.id,depositId:depositRequest.id,saleId:complete.order.id,refundId:cancelled.refund.id,features:packet.features,protectionVersion:packet.protection.version})
 pass('prepared cancellation returns only real retained tenders, retains ingredient loss and exports the complete new protection format6')
 fs.writeFileSync(path.join(out,'restaurant-funds-observations.json'),JSON.stringify({schemaVersion:1,checks,observations,realSQLite:true,accountingScope:'production funds journal functions over actual persisted sources; application accounting/cost UI integration is separately required',realMerchantData:false},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_FUNDS_PASS',tests:checks.length}));db.close()
}catch(error){console.error(error.stack);try{db?.close()}catch{}process.exitCode=1}
