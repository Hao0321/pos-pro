const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated native/browser stock fixture required')
const {canonicalSignature}=require('../../electron/operationRules.mjs'),{prepareCheckout,localDate}=require('../../electron/checkoutSafety.cjs')
const {validateStockCostBook}=require('../../electron/stockBackup.mjs'),{browserToBook,bookToBrowser}=require('../../electron/recoveryRules.mjs')
const fixture=require('../fixtures/stock-cost-native-v1.json'),fixed=require('../fixtures/browser-stock-command-v1.json'),init=require('../../electron/database.js')
const evidence=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(evidence,{recursive:true})
const RealDate=Date;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed.clock]))}static now(){return RealDate.parse(fixed.clock)}}
const storageFile=path.join(root,'browser-storage.json')
class FixtureStorage{
 constructor(){this.values=new Map(fs.existsSync(storageFile)?JSON.parse(fs.readFileSync(storageFile,'utf8')):[])}
 getItem(key){return this.values.get(key)??null}
 setItem(key,value){this.values.set(key,String(value));fs.writeFileSync(storageFile+'.tmp',JSON.stringify([...this.values]));fs.renameSync(storageFile+'.tmp',storageFile)}
 removeItem(key){this.values.delete(key);fs.writeFileSync(storageFile,JSON.stringify([...this.values]))}
}
global.localStorage=new FixtureStorage();Object.defineProperty(global,'navigator',{configurable:true,value:{locks:{request:async(_key,work)=>work()}}})
const resolution=require('node:module').registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!path.extname(specifier))for(const extension of ['.js','.mjs'])try{return next(specifier+extension,context)}catch{}throw error}}})
const browser=require('./browser-stock-business-entry.mjs'),owner=fixed.actor,nativeFile=path.join(root,'business.db');let db,checks=0
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),pass=name=>{checks++;console.log('PASS '+name)},ok=result=>{assert.equal(result.success,true,result.error);return result}
const bBook=()=>browserToBook(browser.readRecords().data),bState=()=>validateStockCostBook(bBook()),nState=()=>({...db.getStockCostState(owner),entries:db.exportData().stockCostEntries.sort((a,b)=>a.sequence-b.sequence)})
function normalized(state,value=state.projection){let raw=JSON.stringify(value);state.entries.forEach((row,index)=>{raw=raw.replaceAll(row.id,'event-'+index)});return JSON.parse(raw)}
function parity(label){const native=nState(),standalone=bState();assert.deepEqual(normalized(standalone,standalone.valuation),normalized(native,native.valuation),label+' valuation');assert.deepEqual(normalized(standalone),normalized(native),label+' projection');const quantities=rows=>rows.map(row=>({id:row.id,unit:row.unit,stock:row.stock})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(quantities(bBook().products),quantities(db.getProducts()),label+' products');assert.equal(bBook().orders.length,db.getOrders().length,label+' payments');assert.equal(bBook().cashLog.length,db.getCashLog().length,label+' cash');return true}
const time=()=>new Date().toISOString(),request=(kind,id,extra={})=>({kind,id,time:time(),...extra})
async function inventory(kind,id,extra={}){
 const ns=db.getSupplierState(owner),bs=await browser.getBrowserSupplierState(owner)
 const make=s=>request(kind,id,{supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...(extra.purchaseId?{expectedPurchase:canonicalSignature(s.purchases.find(row=>row.id===extra.purchaseId))}:{}),...extra})
 const nr=make(ns),br=make(bs);ok(db.applyInventoryOperation(nr,owner));const result=ok(await browser.commitBrowserInventory(br,owner));parity(id);return result
}
async function restaurant(action,id,entryId,extra={}){
 const entry=db.getRestaurantState().entries.find(row=>row.id===entryId),input=request('restaurant',id,{action,...(entry?{entryId,expectedVersion:entry.version}:{}),...extra})
 const native=ok(db.applyRestaurantOperation(input,owner)),standalone=ok(await browser.commitBrowserRestaurant(input,owner));assert.equal(standalone.costReceipt?.sourceMethod,native.costReceipt?.sourceMethod);parity(id);return {input,native,standalone}
}
async function sales(action,id,orderId,extra={}){
 const ns=db.getSalesState(owner),bs=await browser.getBrowserSalesState(owner),doc=ns.documents.find(row=>row.id===orderId)
 const nr=request('sales',id,{action,storeId:ns.storeId,epoch:ns.epoch,date:localDate(),...(doc?{orderId,expectedRevision:doc.revision}:{}),...extra}),br={...nr,epoch:bs.epoch}
 ok(db.applySalesOperation(nr,owner));ok(await browser.commitBrowserSalesDocument(br,owner));parity(id)
}
;(async()=>{try{
 db=init(nativeFile);db.addUser({...fixture.book.users[0]});const preview=db.previewRestore({kind:'import',data:structuredClone(fixture.book)},owner);ok(db.applyRestorePreview(preview.id,owner));const source=db.exportData();db.close();db=null
 const closed=path.join(evidence,'closed-source.db');fs.copyFileSync(nativeFile,closed);const closedHash=hash(closed)
 db=init(nativeFile);const epoch=db.getSalesState(owner).epoch,seed=structuredClone(source);seed.settings=seed.settings.map(row=>({...row,value:['stockCostVersionFence','stockCostBookHead'].includes(row.key)?row.value:JSON.stringify(row.value)}))
 localStorage.setItem(browser.RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:epoch,data:bookToBrowser(seed)}));parity('closed-source')
 const native=ok(db.checkout(structuredClone(fixed.request),null,null,owner)),standalone=ok(await browser.commitBrowserSale(structuredClone(fixed.request),owner));parity('identical-frozen-sale');assert.equal(nState().projection.business.at(-1).effects[0].cost.valueCents,3000);assert.equal(standalone.costReceipt.sourceMethod,native.costReceipt.sourceMethod)
 pass('the identical frozen request commits against the same closed native-derived source with matching actual FIFO cost in native SQLite and browser adapters')
 const savedNative=db.exportData(),savedBrowser=localStorage.getItem(browser.RECORD_KEY);assert.deepEqual(ok(await browser.commitBrowserSale(fixed.request,owner)),standalone);assert.deepEqual(ok(db.checkout(fixed.request,null,null,owner)).costReceipt,native.costReceipt);assert.deepEqual(db.exportData(),savedNative);assert.equal(localStorage.getItem(browser.RECORD_KEY),savedBrowser)
 for(const [id,qty]of [['partial-refund',.333],['remaining-refund',.667]]){const input={id,time:time(),refundOf:fixed.request.id,items:[{id:'p',qty}],reason:'Fixture return',cashier:owner.username,shiftId:'shift'};ok(db.refundOrder(input.refundOf,input,owner));ok(await browser.commitBrowserRefund(input,owner));parity(id)}
 pass('partial then full refunds preserve the exact original source intervals, payment counts and one immutable original acknowledgement')
 const config=db.getRestaurantState().config;await restaurant('configure','configure',null,{expectedConfig:canonicalSignature(config),config:{...config,enabled:true,dailyCapacity:100,slotCapacity:100}})
 await restaurant('create','unused',null,{day:localDate(),slot:'12:00',channel:'walkin',customer:'Fixture',contact:'',note:'',items:[{id:'p',qty:1,price:100}]});await restaurant('pay','unused-pay','unused',{shiftId:'shift',payMethod:'cash',paid:100});await restaurant('cancel','unused-cancel','unused',{shiftId:'shift',reason:'Fixture'})
 await restaurant('create','cooked',null,{day:localDate(),slot:'12:15',channel:'walkin',customer:'Fixture',contact:'',note:'',items:[{id:'p',qty:1,price:100}]});await restaurant('advance','cook','cooked',{status:'cooking'});await restaurant('cancel','cooked-cancel','cooked',{reason:'Fixture'})
 pass('actual restaurant reserve, pay, unused cancellation and unpaid cooked cancellation have identical held, consumed and wasted cost in both authorities')
 for(const product of [{id:'empty',name:'Empty',unit:'袋',stock:0,cost:0,price:1},{id:'tiny',name:'Tiny',unit:'袋',stock:.003,cost:.07,price:1},{id:'unknown',name:'Unknown',unit:'個',stock:1,cost:0,price:1}]){ok(db.addProduct(product,owner));ok(await browser.dbAddProduct(product,owner));parity('product-'+product.id)}
 for(const [method,input]of [['deleteProduct','empty'],['updateProduct',{unit:'公斤'}]]){const beforeNative=db.exportData(),beforeBrowser=localStorage.getItem(browser.RECORD_KEY);assert.throws(()=>method==='deleteProduct'?db.deleteProduct(input,owner):db.updateProduct('empty',input,owner),/保留/);assert.equal((await(method==='deleteProduct'?browser.dbDeleteProduct(input,owner):browser.dbUpdateProduct('empty',input,owner))).success,false);assert.deepEqual(db.exportData(),beforeNative);assert.equal(localStorage.getItem(browser.RECORD_KEY),beforeBrowser)}
 pass('zero-stock original product events remain readable; native and browser both reject deletion and unit changes that would invalidate their history')
 const supplier=source.suppliers[0],product=db.getProducts().find(row=>row.id==='p')
 await inventory('purchase-create','create-po',{purchase:{id:'parity-po',supplierId:supplier.id,date:localDate(),items:[{productId:'p',name:product.name,unit:product.unit,qty:2,unitCost:.07,received:0}]}})
 await inventory('receive','receive-first',{purchaseId:'parity-po',quantities:[.001]});await inventory('receive','receive-rest',{purchaseId:'parity-po',quantities:[1.999]});await inventory('purchase-bill','bill',{purchaseId:'parity-po',quantities:[2],reference:'Fixture',dueDate:localDate()});await inventory('purchase-return','supplier-return',{purchaseId:'parity-po',invoiceId:'bill',quantities:[1],reason:'Fixture'})
 pass('controlled procurement registration, split receiving, invoice and supplier return preserve exact zero-cent tails and actual-cost variance without another cash entry')
 await sales('create','sales-document',null,{document:{customer:{id:'customer',name:'Fixture customer'},date:localDate(),items:[{productId:'p',qty:2,unitPrice:100,expectedProduct:{name:product.name,unit:product.unit,price:product.price}}],note:''}})
 await sales('deliver','delivery','sales-document',{quantities:[2],dueDate:localDate(),handedOver:true});await sales('return','restock','sales-document',{deliveryId:'delivery',quantities:[1],restock:true,reason:'Fixture'});await sales('return','dispose','sales-document',{deliveryId:'delivery',quantities:[1],restock:false,reason:'Fixture'})
 pass('sales delivery and restocked/disposed returns retain the identical original actual costs and original stock choice')
 const waste=request('waste','waste',{productId:'p',qty:.333,reason:'Fixture',cashier:owner.username}),nr=ok(db.addWaste(waste,owner)),br=ok(await browser.addWaste(waste,owner));parity('waste')
 const beforeN=db.exportData(),beforeB=localStorage.getItem(browser.RECORD_KEY);db.close();db=init(nativeFile);global.localStorage=new FixtureStorage();assert.deepEqual(ok(db.addWaste(waste,owner)).costReceipt,nr.costReceipt);assert.deepEqual(ok(await browser.addWaste(waste,owner)).costReceipt,br.costReceipt);assert.deepEqual(db.exportData(),beforeN);assert.equal(localStorage.getItem(browser.RECORD_KEY),beforeB);parity('reopened')
 assert.equal(hash(closed),closedHash);fs.writeFileSync(path.join(evidence,'observations.json'),JSON.stringify({success:true,checks:checks+1,source:'native-derived synthetic fixture; no real merchant data',closedSourceSha256:closedHash,closedSourcePreserved:true,frozenCommandSha256:hash(path.resolve('tests/fixtures/browser-stock-command-v1.json')),requestConfound:'The initial checkout is byte-identical. Later purchase snapshots and runtime epochs are generated by each authority; semantic quantities/prices/original IDs and resulting complete cost projections are compared.',browserSurface:'production ESM adapters with an extension-resolution test hook and durable file-backed localStorage fixture; actual browser UI has a separate journey',finalNativeValuation:nState().valuation,finalBrowserValuation:bState().valuation},null,2))
 pass('closed native reopen and durable browser-record reload preserve the original fractional waste receipt, complete projection and untouched source file')
 db.close();resolution.deregister();global.Date=RealDate;console.log(JSON.stringify({success:true,marker:'POS_BROWSER_STOCK_BUSINESS_PASS',tests:checks,physicalDevices:false,realMerchantData:false}))
}catch(error){console.error(error.stack);try{db?.close()}catch{}resolution.deregister();global.Date=RealDate;process.exitCode=1}})()
