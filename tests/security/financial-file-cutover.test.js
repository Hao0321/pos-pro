import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import workbook from './financialMigrationFixture.cjs'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {makeFinancialFileDraft,financialWorkbookSheets} from '../../electron/financialFileDraft.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {previewOpeningCutover,verifyOpeningCutover,projectOpeningCutoverBook} from '../../electron/openingCutoverModel.mjs'
import {readOpeningCutoverHistory} from '../../electron/openingCutoverHistory.mjs'
import {readOpeningMigrationHistory} from '../../electron/openingMigrationHistory.mjs'
import {readOpeningCutoverProof} from '../../electron/openingCutoverRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'

const time='2026-10-19T04:00:00.000Z',owner={userId:'owner',username:'Lot fixture',role:'owner'},source={system:'Original raw ERP',company:'Original shop'},book=()=>browserToBook(structuredClone(readPortableBackup(fixture,'browser').book)),scope=b=>privateDraftContext(fixture.storeId,'financial-file-model',owner,b.users),original=()=>{const file=workbook();return makeFinancialFileDraft(source,'TWD',[{kind:'xlsx',file,sheets:financialWorkbookSheets(file)}])}
function prepared(b){const raw=original(),input=makeOpeningCutoverInput(JSON.stringify(raw),scope(b),'2026-10-19'),view=previewOpeningCutover(input,b,scope(b),owner);expect(view.ready,JSON.stringify(view.trial||view.plan)).toBe(true);return {raw,input:{...input,review:view.review},view}}
describe('FF whole-source raw financial projection',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(time))});afterEach(()=>vi.useRealTimers())
 it('uses a distinct v3 proof and retains actual original binary plus stock, both claims and credits',()=>{
  const b=book(),before=canonicalSignature(b),{raw,input,view}=prepared(b),saved=projectOpeningCutoverBook(input,view.plan,b,scope(b),owner,time),history=readOpeningCutoverHistory(saved.book)
  expect(input.protocol).toBe('pos-opening-migration/v3');expect(saved.receipt.protocol).toBe('pos-opening-migration-receipt/v3');expect(canonicalSignature(b)).toBe(before);expect(JSON.parse(JSON.parse(saved.receipt.signature).sourceText).files[0].file.base64).toBe(raw.files[0].file.base64);expect(history.receipts).toHaveLength(1)
  expect(saved.views.customer.openingClaims[0].owed).toBe(600);expect(saved.views.supplier.openingClaims[0].owed).toBe(900);expect(saved.views.customer.receipts.find(row=>row.fundingKind==='opening-credit').available).toBe(100);expect(saved.views.supplier.payments.find(row=>row.fundingKind==='opening-credit').available).toBe(200);expect(validateStockCostBook(saved.book).valuation.ownedKnownValueCents-validateStockCostBook(b).valuation.ownedKnownValueCents).toBe(25001);expect(readOpeningMigrationHistory(saved.book).byProduct.size).toBe(1)
  expect(saved.book.settings.find(row=>row.key==='financialFileMigrationVersionFence').value).toBe('1');for(const key of ['orders','purchases','cashLog','memberTopups','manualJournal'])expect(saved.book[key]).toEqual(b[key])
 })
 it('keeps the exact same raw original on retry and rejects a v3 proof disguised as v2',()=>{
  const b=book(),{input,view}=prepared(b),saved=projectOpeningCutoverBook(input,view.plan,b,scope(b),owner,time);expect(verifyOpeningCutover(input,saved.book,scope(b),owner).receipt).toEqual(saved.receipt);expect(()=>readOpeningCutoverProof({...saved.receipt,protocol:'pos-opening-migration-receipt/v2'},scope(b).storeId)).toThrow();expect(()=>verifyOpeningCutover({...input,protocol:'pos-opening-migration/v2'},b,scope(b),owner)).toThrow()
 })
 it('requires the new raw-source protection marker, every original table and the real old stock source receipt',()=>{
  const b=book(),{input,view}=prepared(b),saved=projectOpeningCutoverBook(input,view.plan,b,scope(b),owner,time),changed=structuredClone(saved.book);changed.settings=changed.settings.filter(row=>row.key!=='financialFileMigrationVersionFence');expect(()=>readOpeningCutoverHistory(changed)).toThrow()
  const raw=JSON.parse(input.sourceText);raw.files[0].sheets.pop();expect(()=>makeOpeningCutoverInput(JSON.stringify(raw),scope(b),'2026-10-19')).toThrow();const missing=structuredClone(saved.book);missing.stockCostEntries=missing.stockCostEntries.filter(row=>row.method!=='applyOpeningMigration');expect(()=>readOpeningMigrationHistory(missing)).toThrow()
 })
})
