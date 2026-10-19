// @vitest-environment jsdom
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import source from '../fixtures/opening-whole-source-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {readOpeningCutoverHistory} from '../../electron/openingCutoverHistory.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserPrivateDraftContext} from '../../src/utils/browserPrivateDrafts'
import {previewBrowserOpeningMigration,commitBrowserOpeningMigration} from '../../src/utils/browserOpeningMigration'
import {readBrowserTrading} from '../../src/utils/browserSalesDocuments'
import {readBrowserSupplier,commitBrowserSupplierLedger} from '../../src/utils/browserSupplierLedger'
import {commitBrowserCustomerLedger} from '../../src/utils/browserCustomerLedger'
import {makeMasterMigrationInput} from '../../electron/masterMigration.mjs'
import {previewBrowserMasterMigration,commitBrowserMasterMigration} from '../../src/utils/browserMasterMigration'

const actor={userId:'owner',username:'Lot fixture',role:'owner'},set=Storage.prototype.setItem
beforeEach(()=>{localStorage.clear();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T04:00:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_name,callback)=>callback()}});const portable=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(portable.protection,'browser');set.call(localStorage,RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'browser-cutover-epoch',data:portable.book,recovery:{version:portable.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}))})
afterEach(()=>{Storage.prototype.setItem=set;vi.useRealTimers();vi.unstubAllGlobals()})
async function request(){const scope=await getBrowserPrivateDraftContext(actor),input=makeOpeningCutoverInput(JSON.stringify(source),scope,'2026-10-19'),view=await previewBrowserOpeningMigration(input,actor);expect(view.ready,JSON.stringify(view.trial||view.plan)).toBe(true);return {...input,review:view.review}}

test('one actual browser record saves the mixed original source, two activation markers and version14',async()=>{
 const input=await request(),saved=await commitBrowserOpeningMigration(input,actor);expect(saved.success,saved.error).toBe(true)
 const record=readRecords(),history=readOpeningCutoverHistory(browserToBook(record.data));expect(record.recovery.version).toBe(14);expect(history.byId.get(input.id)).toEqual(saved.receipt);expect(readBrowserTrading(record).customerLedger.openingClaims[0].owed).toBe(600);expect(readBrowserSupplier(record).supplierLedger.openingClaims[0].owed).toBe(900);expect(JSON.parse(saved.receipt.signature).sourceText).toBe(JSON.stringify(source));expect(record.data.pos2_orders).toEqual(fixture.book.orders);expect(record.data.pos_purchases).toEqual(fixture.book.purchases)
 const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserOpeningMigration(input,actor)).receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('quota failure leaves the entire original record and all source roles intact',async()=>{
 const input=await request(),before=localStorage.getItem(RECORD_KEY);Storage.prototype.setItem=function(key,value){if(key===RECORD_KEY)throw Error('owned cutover quota');return set.call(this,key,value)}
 const result=await commitBrowserOpeningMigration(input,actor);expect(result.success).toBe(false);expect(result.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before);Storage.prototype.setItem=set;expect((await commitBrowserOpeningMigration(input,actor)).success).toBe(true)
})
test('reply loss after the actual write recovers the same parent receipt and never adds debt twice',async()=>{
 const input=await request();let once=false;Storage.prototype.setItem=function(key,value){const result=set.call(this,key,value);if(key===RECORD_KEY&&!once){once=true;throw Error('owned cutover reply loss')}return result}
 const saved=await commitBrowserOpeningMigration(input,actor);expect(saved.success,saved.error).toBe(true);const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserOpeningMigration(input,actor)).receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect(readOpeningCutoverHistory(browserToBook(readRecords().data)).receipts).toHaveLength(1)
})
test('generic writes cannot remove or change the source receipt, head or persistent format',async()=>{
 const input=await request();expect((await commitBrowserOpeningMigration(input,actor)).success).toBe(true);const record=readRecords(),before=localStorage.getItem(RECORD_KEY)
 expect(()=>writeRecords({pos_audit_log:record.data.pos_audit_log.filter(row=>row.action!=='AGENT_OPENING_CUTOVER')},record.revision)).toThrow();expect(()=>writeRecords({pos_business_settings:record.data.pos_business_settings.filter(row=>row.key!=='openingCutoverVersionFence')},record.revision)).toThrow();expect(localStorage.getItem(RECORD_KEY)).toBe(before)
 const downgraded=JSON.parse(before);downgraded.recovery.version=13;set.call(localStorage,RECORD_KEY,JSON.stringify(downgraded));const altered=localStorage.getItem(RECORD_KEY);expect(()=>readRecords()).toThrow();expect(localStorage.getItem(RECORD_KEY)).toBe(altered)
})
test('a later ordinary master write preserves format14 and the original source authority',async()=>{
 const input=await request();expect((await commitBrowserOpeningMigration(input,actor)).success).toBe(true);const scope=await getBrowserPrivateDraftContext(actor),sourceText=JSON.stringify({protocol:'pos-migration-draft/v1',id:'after-cutover',source:{system:'Later source',company:'Later shop'},tables:[{entity:'products',columns:['name','unit','price'],rows:[{externalId:'LATER',values:['Later product','piece','99']}]}]}),command=makeMasterMigrationInput(sourceText,scope),view=await previewBrowserMasterMigration(command,actor);expect(view.ready).toBe(true);const saved=await commitBrowserMasterMigration({...command,review:view.review},actor);expect(saved.success,saved.error).toBe(true);expect(readRecords().recovery.version).toBe(14);expect(readOpeningCutoverHistory(browserToBook(readRecords().data)).receipts).toHaveLength(1)
})
test('existing browser receipt and payment authorities settle the saved original claims',async()=>{
 const input=await request();expect((await commitBrowserOpeningMigration(input,actor)).success).toBe(true);let record=readRecords(),ar=readBrowserTrading(record),ap=readBrowserSupplier(record);const claim=ar.customerLedger.openingClaims[0],bill=ap.supplierLedger.openingClaims[0],common={time:new Date().toISOString(),date:'2026-10-19',storeId:ar.storeId,epoch:ar.epoch}
 const receive=await commitBrowserCustomerLedger({...common,id:'browser-source-receive',kind:'customer-ledger',action:'receive',expectedRevision:ar.customerLedger.revision,expectedOpeningDigest:ar.customerLedger.openingDigest,customerId:claim.customerId,amount:200,method:'bank',confirmed:true},actor);expect(receive.success,receive.error).toBe(true)
 ar=readBrowserTrading(readRecords());const allocate=await commitBrowserCustomerLedger({...common,id:'browser-source-allocate',kind:'customer-ledger',action:'allocate',expectedRevision:ar.customerLedger.revision,expectedOpeningDigest:ar.customerLedger.openingDigest,customerId:claim.customerId,receiptId:receive.event.id,items:[{documentId:claim.documentId,deliveryId:claim.deliveryId,expectedRevision:1,amount:200}],reviewed:true},actor);expect(allocate.success,allocate.error).toBe(true)
 const pay=await commitBrowserSupplierLedger({...common,id:'browser-source-pay',kind:'supplier-ledger',action:'pay',expectedRevision:ap.supplierLedger.revision,expectedOpeningDigest:ap.supplierLedger.openingDigest,supplierId:bill.supplierId,expectedSupplierName:'原供應商',amount:300,method:'bank',confirmed:true},actor);expect(pay.success,pay.error).toBe(true)
 ap=readBrowserSupplier(readRecords());const applied=await commitBrowserSupplierLedger({...common,id:'browser-source-ap-allocate',kind:'supplier-ledger',action:'allocate',expectedRevision:ap.supplierLedger.revision,expectedOpeningDigest:ap.supplierLedger.openingDigest,supplierId:bill.supplierId,expectedSupplierName:'原供應商',paymentId:pay.event.id,items:[{purchaseId:bill.purchaseId,invoiceId:bill.invoiceId,expectedRevision:1,amount:300}],reviewed:true},actor);expect(applied.success,applied.error).toBe(true)
 record=readRecords();expect(readBrowserTrading(record).customerLedger.openingClaims[0].owed).toBe(400);expect(readBrowserSupplier(record).supplierLedger.openingClaims[0].owed).toBe(600);expect(record.data.pos2_cash_log).toEqual(fixture.book.cashLog)
})
