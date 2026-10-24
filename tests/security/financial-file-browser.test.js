// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import workbook from './financialMigrationFixture.cjs'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {makeFinancialFileDraft,financialWorkbookSheets} from '../../electron/financialFileDraft.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {makeOpeningCutoverLookup} from '../../electron/openingCutoverLookup.mjs'
import {readOpeningCutoverHistory} from '../../electron/openingCutoverHistory.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserPrivateDraftContext} from '../../src/utils/browserPrivateDrafts'
import {previewBrowserOpeningMigration,commitBrowserOpeningMigration} from '../../src/utils/browserOpeningMigration'
import {readBrowserTrading} from '../../src/utils/browserSalesDocuments'
import {readBrowserSupplier} from '../../src/utils/browserSupplierLedger'
import {exportBrowserFullBackup} from '../../src/utils/browserRecovery'

const owner={userId:'owner',username:'Lot fixture',role:'owner'},set=Storage.prototype.setItem
beforeEach(()=>{localStorage.clear();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T04:00:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_name,callback)=>callback()}});const incoming=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(incoming.protection,'browser');set.call(localStorage,RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'raw-file-browser-epoch',data:incoming.book,recovery:{version:incoming.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}))})
afterEach(()=>{Storage.prototype.setItem=set;vi.useRealTimers();vi.unstubAllGlobals()})
async function command(){const scope=await getBrowserPrivateDraftContext(owner),file=workbook(),draft=makeFinancialFileDraft({system:'Raw source ERP',company:'Original shop'},'TWD',[{kind:'xlsx',file,sheets:financialWorkbookSheets(file)}]),input=makeOpeningCutoverInput(JSON.stringify(draft),scope,'2026-10-19'),view=await previewBrowserOpeningMigration(input,owner);expect(view.ready,JSON.stringify(view.trial||view.plan)).toBe(true);return {...input,review:view.review}}

it('atomically saves one real browser version20 record with raw source and existing settlement claims',async()=>{
 const input=await command(),before=readRecords(),saved=await commitBrowserOpeningMigration(input,owner);expect(saved.success,saved.error).toBe(true);const record=readRecords(),history=readOpeningCutoverHistory(browserToBook(record.data));expect(record.recovery.version).toBe(20);expect(history.byId.get(input.id)).toEqual(saved.receipt);expect(readBrowserTrading(record).customerLedger.openingClaims[0].owed).toBe(600);expect(readBrowserSupplier(record).supplierLedger.openingClaims[0].owed).toBe(900);expect(JSON.parse(saved.receipt.signature).sourceText).toBe(input.sourceText);expect(record.data.pos2_orders).toEqual(before.data.pos2_orders);expect(record.data.pos_purchases).toEqual(before.data.pos_purchases);expect(record.data.pos2_cash_log).toEqual(before.data.pos2_cash_log);const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserOpeningMigration(input,owner)).receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('proves actual quota rejection leaves the entire original book and source uncommitted',async()=>{
 const input=await command(),before=localStorage.getItem(RECORD_KEY);let invoked=false;Storage.prototype.setItem=function(key,value){if(key===RECORD_KEY){invoked=true;throw Error('owned raw financial quota')}return set.call(this,key,value)};const result=await commitBrowserOpeningMigration(input,owner);expect(invoked).toBe(true);expect(result.success).toBe(false);expect(result.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect(JSON.parse(input.sourceText).files[0].file.base64).toBe(workbook().base64)
})
it('reconciles actual post-write reply loss using the same original receipt once',async()=>{
 const input=await command();let invoked=false;Storage.prototype.setItem=function(key,value){const result=set.call(this,key,value);if(key===RECORD_KEY&&!invoked){invoked=true;throw Error('owned raw financial committed reply loss')}return result};const result=await commitBrowserOpeningMigration(input,owner);expect(invoked).toBe(true);expect(result.success,result.error).toBe(true);const before=localStorage.getItem(RECORD_KEY);expect((await commitBrowserOpeningMigration(input,owner)).receipt).toEqual(result.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect(readOpeningCutoverHistory(browserToBook(readRecords().data)).receipts).toHaveLength(1)
})
it('finds the original raw file without retyping optional format choices but refuses changed content on a write',async()=>{
 const input=await command(),saved=await commitBrowserOpeningMigration(input,owner);expect(saved.success,saved.error).toBe(true);const raw=JSON.parse(input.sourceText);raw.files[0].sheets[1].plan.amountFormat='grouped-dot';const text=JSON.stringify(makeFinancialFileDraft(raw.source,raw.currency,raw.files)),scope=await getBrowserPrivateDraftContext(owner),lookup=makeOpeningCutoverLookup(text,scope),before=localStorage.getItem(RECORD_KEY),found=await previewBrowserOpeningMigration(lookup,owner);expect(found.found).toBe(true);expect(found.receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(before);const changed=makeOpeningCutoverInput(text,scope,'2026-10-19'),refused=await commitBrowserOpeningMigration({...changed,review:input.review},owner);expect(refused.success).toBe(false);expect(refused.committed).toBe(null);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
it('carries format20 raw source through actual complete-backup and cross-storage conversion',async()=>{
 const input=await command(),saved=await commitBrowserOpeningMigration(input,owner);expect(saved.success,saved.error).toBe(true);const packet=exportBrowserFullBackup(owner),converted=readPortableBackup(packet,'sqlite');expect(packet.protection.version).toBe(20);expect(packet.features).toContain('financial-file-migration-v1');const history=readOpeningCutoverHistory(converted.book);expect(history.byId.get(input.id)).toEqual(saved.receipt);expect(converted.book.settings.find(row=>row.key==='financialFileMigrationVersionFence').value).toBe('1')
})
it('does not let generic writes remove the raw feature or make its old-version marker readable',async()=>{
 const input=await command();expect((await commitBrowserOpeningMigration(input,owner)).success).toBe(true);const record=readRecords(),before=localStorage.getItem(RECORD_KEY);expect(()=>writeRecords({pos_business_settings:record.data.pos_business_settings.filter(row=>row.key!=='financialFileMigrationVersionFence')},record.revision)).toThrow();expect(localStorage.getItem(RECORD_KEY)).toBe(before);const changed=JSON.parse(before);changed.recovery.version=19;set.call(localStorage,RECORD_KEY,JSON.stringify(changed));expect(()=>readRecords()).toThrow()
})
