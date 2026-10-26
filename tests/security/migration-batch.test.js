import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import data from './migrationBatchFixture.cjs'
import fixture from '../fixtures/lot-count-native-v1.json'
import {makeMigrationBatchDraft,readMigrationBatchDraft,migrationBatchIdentity,MIGRATION_BATCH_FENCE} from '../../electron/migrationBatchDraft.mjs'
import {projectMigrationBatchSource,migrationBatchRoute} from '../../electron/migrationBatchSource.mjs'
import {makeFinancialFileDraft} from '../../electron/financialFileDraft.mjs'
import {projectFinancialFileSource} from '../../electron/financialFileSource.mjs'
import {makeMasterMigrationInput,previewMasterMigration,readMasterMigrationHistory,verifyMasterMigration} from '../../electron/masterMigration.mjs'
import {appendBrowserMasterMigration} from '../../electron/browserMasterMigration.mjs'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {previewOpeningCutover,projectOpeningCutoverBook,verifyOpeningCutover} from '../../electron/openingCutoverModel.mjs'
import {readOpeningCutoverHistory} from '../../electron/openingCutoverHistory.mjs'
import {makeOpeningCutoverLookup,lookupOpeningCutover} from '../../electron/openingCutoverLookup.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {recoveryFeatureFloor} from '../../electron/recoveryBook.mjs'

const owner={userId:'owner',username:'Lot fixture',role:'owner'},time='2026-10-19T06:00:00.000Z',book=()=>browserToBook(structuredClone(readPortableBackup(fixture,'browser').book)),scope=b=>privateDraftContext(fixture.storeId,'batch-model',owner,b.users),batch=files=>makeMigrationBatchDraft(data.source,'TWD',files);
function opening(files){const b=book(),raw=batch(files),input=makeOpeningCutoverInput(JSON.stringify(raw),scope(b),'2026-10-19'),view=previewOpeningCutover(input,b,scope(b),owner);expect(view.ready,JSON.stringify(view.trial||view.plan)).toBe(true);return {b,raw,input:{...input,review:view.review},view}}
describe('M46 complete raw source batches',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(time))});afterEach(()=>vi.useRealTimers());
 it('keeps every exact source and leading zero, rejects changed IDs/unknown authority and preserves raw-only identity across order or plan changes',()=>{
  const files=data.mixed(),value=batch(files);expect(readMigrationBatchDraft(value)).toBe(value);expect(value.files).toEqual(files);expect(projectMigrationBatchSource(value).source.tables.some(table=>table.rows.some(row=>row.externalId==='000C'))).toBe(true);expect(()=>readMigrationBatchDraft(batch([files[0],files[0]]))).toThrow('同一份檔案')
  const reordered=batch([...files].reverse());expect(reordered.id).toBe(value.id);expect(migrationBatchIdentity(reordered)).toEqual(migrationBatchIdentity(value));expect(()=>readMigrationBatchDraft({...value,actor:owner})).toThrow();const changed=structuredClone(value);changed.files[1].file.text+='x';expect(()=>readMigrationBatchDraft(changed)).toThrow()
 });
 it('routes a complete master-only batch to the existing single master transaction without demanding a financial table or opening date',()=>{
  const b=book(),raw=batch(data.masters());expect(migrationBatchRoute(raw)).toBe('masters');const before=canonicalSignature(b),request=makeMasterMigrationInput(JSON.stringify(raw),scope(b)),view=previewMasterMigration(request,b,scope(b),owner);expect(view.ready,JSON.stringify(view)).toBe(true);const input={...request,review:view.review},saved=appendBrowserMasterMigration(b,input,scope(b),owner,time);expect(canonicalSignature(b)).toBe(before);expect(saved.receipt.counts.create).toBe(3);expect(JSON.parse(saved.receipt.signature).sourceText).toBe(JSON.stringify(raw));expect(readMasterMigrationHistory(saved.book).batch).toBe(true);expect(verifyMasterMigration(input,saved.book,scope(b),owner).receipt).toEqual(saved.receipt);expect(saved.book.products.find(row=>row.name==='Original batch product')).toMatchObject({stock:0,price:150,cost:25.5});for(const key of ['cashLog','orders','purchases'])expect(saved.book[key]).toEqual(b[key]);const noFence=structuredClone(saved.book);noFence.settings=noFence.settings.filter(row=>row.key!==MIGRATION_BATCH_FENCE);expect(()=>readMasterMigrationHistory(noFence)).toThrow()
 });
 it('routes stock-only original files through one whole-opening review with actual value and no invented cash or claims',()=>{
  const {b,raw,input,view}=opening(data.stock());expect(migrationBatchRoute(raw)).toBe('opening-cutover');const saved=projectOpeningCutoverBook(input,view.plan,b,scope(b),owner,time);expect(saved.views.customer.openingClaims||[]).toHaveLength(0);expect(saved.views.supplier.openingClaims||[]).toHaveLength(0);expect(validateStockCostBook(saved.book).valuation.ownedKnownValueCents-validateStockCostBook(b).valuation.ownedKnownValueCents).toBe(25001);for(const key of ['cashLog','orders','purchases'])expect(saved.book[key]).toEqual(b[key]);expect(readOpeningCutoverHistory(saved.book).receipts).toHaveLength(1);expect(saved.book.settings.find(row=>row.key===MIGRATION_BATCH_FENCE).value).toBe('1')
 });
 it('commits a mixed original XLSX/TSV/CSV batch once with precise stock, both financial sides and the complete original binary',()=>{
  const {b,raw,input,view}=opening(data.mixed()),saved=projectOpeningCutoverBook(input,view.plan,b,scope(b),owner,time);expect(JSON.parse(JSON.parse(saved.receipt.signature).sourceText).files).toEqual(raw.files);expect(saved.views.customer.openingClaims[0].owed).toBe(600);expect(saved.views.supplier.openingClaims[0].owed).toBe(900);expect(verifyOpeningCutover(input,saved.book,scope(b),owner).receipt).toEqual(saved.receipt);const changed=structuredClone(saved.book);changed.settings=changed.settings.filter(row=>row.key!==MIGRATION_BATCH_FENCE);expect(()=>readOpeningCutoverHistory(changed)).toThrow()
 });
 it('finds the exact original readonly after source reordering and loss of optional mapping facts, without accepting a changed write or foreign scope',()=>{
  const {b,raw,input,view}=opening(data.mixed()),saved=projectOpeningCutoverBook(input,view.plan,b,scope(b),owner,time),again=structuredClone(raw);again.files.reverse();again.currency='';for(const entry of again.files)for(const sheet of entry.sheets)sheet.plan={...sheet.plan,entity:'',mapping:[],externalId:-1,repairs:[]};const query=makeOpeningCutoverLookup(JSON.stringify(again),scope(b)),before=canonicalSignature(saved.book);expect(lookupOpeningCutover(query,saved.book,scope(b),owner).receipt).toEqual(saved.receipt);expect(canonicalSignature(saved.book)).toBe(before);expect(()=>makeOpeningCutoverInput(JSON.stringify(again),scope(b),'2026-10-19')).toThrow();expect(()=>lookupOpeningCutover({...query,scope:{...query.scope,epoch:'other'}},saved.book,scope(b),owner)).toThrow()
 });
 it('keeps the existing financial-file contract strict and rejects unclassified or invented-currency batch data',()=>{
  expect(()=>projectFinancialFileSource(makeFinancialFileDraft(data.source,'TWD',data.masters()))).toThrow('沒有未收或未付款');const raw=batch(data.mixed());raw.files[1].sheets[0].plan.entity='';expect(()=>projectMigrationBatchSource(raw)).toThrow('未分類');expect(()=>readMigrationBatchDraft({...raw,currency:'USD'})).toThrow();expect(recoveryFeatureFloor(['migration-source-batch-v1'])).toBe(21)
 });
})
