import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import source from '../fixtures/opening-whole-source-v1.json'
import financial from '../fixtures/opening-balances-source-v1.json'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {previewOpeningCutover,verifyOpeningCutover,projectOpeningCutoverBook} from '../../electron/openingCutoverModel.mjs'
import {readOpeningCutoverHistory} from '../../electron/openingCutoverHistory.mjs'
import {readOpeningMigrationHistory} from '../../electron/openingMigrationHistory.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {makeStockAccountingReport,stockPeriodDisclosure} from '../../electron/stockAccounting.mjs'

const time='2026-10-19T04:00:00.000Z',actor={userId:'owner',username:'Lot fixture',role:'owner'},book=()=>browserToBook(structuredClone(readPortableBackup(fixture,'browser').book)),scope=b=>privateDraftContext(fixture.storeId,'cutover-model-epoch',actor,b.users),input=(b,s=source)=>makeOpeningCutoverInput(JSON.stringify(s),scope(b),'2026-10-19')
function prepared(b,s=source){const command=input(b,s),view=previewOpeningCutover(command,b,scope(b),actor);expect(view.ready,JSON.stringify(view.trial||view.plan)).toBe(true);return {command:{...command,review:view.review},view}}

describe('OB6 shared original source cutover postimage',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(time))})
 afterEach(()=>vi.useRealTimers())
 it('projects the actual combined master, stock and financial postimage before a write',()=>{
  const b=book(),before=canonicalSignature(b),{view}=prepared(b);expect(canonicalSignature(b)).toBe(before);expect(view.trial.status).toBe('projected-not-posted');expect(view.trial.customerClaims[0].owed).toBe(600);expect(view.trial.supplierClaims[0].owed).toBe(900)
 })
 it('preserves all source roles and returns the same verified receipt on exact retries',()=>{
  const b=book(),{command,view}=prepared(b),verified=verifyOpeningCutover(command,b,scope(b),actor),saved=projectOpeningCutoverBook(command,verified.preview.plan,b,scope(b),actor,time),history=readOpeningCutoverHistory(saved.book)
  expect(saved.economicDigest).toBe(command.review.trialDigest);expect(saved.receipt.signature).toBe(canonicalSignature(command));expect(history.byId.get(command.id)).toEqual(saved.receipt);expect(history.context.batches).toHaveLength(1);expect(readOpeningMigrationHistory(saved.book).byProduct.size).toBe(1)
  expect(saved.book.products.find(p=>p.id===saved.receipt.rows[0].productId).stock).toBe(12.5);expect(saved.views.customer.openingClaims[0].owed).toBe(600);expect(saved.views.customer.receipts.find(r=>r.fundingKind==='opening-credit').available).toBe(100);expect(saved.views.supplier.payments.find(r=>r.fundingKind==='opening-credit').available).toBe(200)
  for(const key of ['orders','purchases','cashLog','manualJournal','memberTopups'])expect(saved.book[key]).toEqual(b[key])
  expect(verifyOpeningCutover(command,saved.book,scope(b),actor).receipt).toEqual(saved.receipt);expect(validateStockCostBook(saved.book).valuation.ownedKnownValueCents-validateStockCostBook(b).valuation.ownedKnownValueCents).toBe(25001)
 })
 it('can import a financial-only original source without opening or changing inventory',()=>{
  const b=book(),{command,view}=prepared(b,financial),saved=projectOpeningCutoverBook(command,view.plan,b,scope(b),actor,time)
  expect(saved.book.stockCostEntries).toEqual(b.stockCostEntries);expect(saved.book.stockCostOperations).toEqual(b.stockCostOperations);expect(saved.book.products).toEqual(b.products);expect(saved.receipt.stockReceipt).toBe(null);expect(saved.receipt.bootstrapId).toBe(null)
 })
 it('rejects an unconfirmed or changed snapshot and refuses a missing parent or activation proof',()=>{
  const b=book(),{command,view}=prepared(b),changed=structuredClone(b);changed.products[0].name+=' changed';expect(()=>verifyOpeningCutover(command,changed,scope(b),actor)).toThrow();expect(()=>verifyOpeningCutover({...command,review:undefined},b,scope(b),actor)).toThrow()
  const saved=projectOpeningCutoverBook(command,view.plan,b,scope(b),actor,time);saved.book.auditLog=saved.book.auditLog.filter(r=>r.action!=='AGENT_OPENING_CUTOVER');expect(()=>readOpeningCutoverHistory(saved.book)).toThrow();expect(()=>validateStockCostBook(saved.book)).toThrow()
 })
 it.each(['customerOperations','supplierOperations'])('requires the actual %s barrier receipt even when reading the other ledger',key=>{
  const b=book(),{command,view}=prepared(b),saved=projectOpeningCutoverBook(command,view.plan,b,scope(b),actor,time),id=key==='customerOperations'?saved.receipt.customerBarrierId:saved.receipt.supplierBarrierId
  for(const damage of ['missing','duplicate','changed']){
   const altered=structuredClone(saved.book),receipt=altered[key].find(row=>row.id===id)
   if(damage==='missing')altered[key]=altered[key].filter(row=>row.id!==id)
   if(damage==='duplicate')altered[key].push(structuredClone(receipt))
   if(damage==='changed')receipt.signature+=' '
   expect(()=>readOpeningCutoverHistory(altered),damage).toThrow()
  }
 })
 it.each([['mixed',source],['financial-only',financial]])('shows original AR/AP in the %s accounting snapshot without claiming a complete opening trial balance',(_,original)=>{
  const b=book(),{command,view}=prepared(b,original),saved=projectOpeningCutoverBook(command,view.plan,b,scope(b),actor,time),customer=saved.views.customer,supplier=saved.views.supplier,data={...saved.book,topups:saved.book.memberTopups,openingJournals:[...customer.openingJournals,...supplier.openingJournals],openingSourceCutoffs:[...customer.openingCutoffDates,...supplier.openingCutoffDates]},report=makeStockAccountingReport(validateStockCostBook(saved.book),data)
  const balance=account=>report.journals.flatMap(row=>row.lines).filter(row=>row.account===account).reduce((total,row)=>total+Math.round(row.debit*100)-Math.round(row.credit*100),0)
  expect(balance('1141')).toBe(50000);expect(balance('2101')).toBe(-70000);expect(balance('1101')).toBe(0);expect(balance('1103')).toBe(0);expect(report.journals.filter(row=>row.type==='auto_opening_balance')).toHaveLength(4);expect(new Set(report.journals.map(row=>row.id)).size).toBe(report.journals.length)
  expect(stockPeriodDisclosure(report,'2026-10-01','2026-10-31')).toMatchObject({profitComplete:false,assetsComplete:false,openingReviewPending:true,openingHistoryIncomplete:true})
  expect(stockPeriodDisclosure(report,'2026-10-19','2026-10-31')).toMatchObject({profitComplete:true,assetsComplete:false,openingReviewPending:true,openingHistoryIncomplete:false})
 })
})
