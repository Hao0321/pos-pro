import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import source from '../fixtures/opening-whole-source-v1.json'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {OPENING_CUTOVER_RECEIPT,openingCutoverSourceDigest,openingBarrierId,openingActivationRequest,readOpeningCutoverProof} from '../../electron/openingCutoverRules.mjs'
import {projectOpeningBalanceSource} from '../../electron/openingBalanceSource.mjs'
import {openingBalanceContextFromCutovers,openingBalanceTimeline} from '../../electron/openingBalanceLedger.mjs'
import {planCustomerLedger,planCustomerOpeningActivation,validateCustomerLedgerRecords} from '../../electron/customerLedger.mjs'
import {planSupplierLedger,planSupplierOpeningActivation,validateSupplierLedgerRecords} from '../../electron/supplierLedger.mjs'

const actor={userId:'owner',username:'Owner',role:'owner'},scope={protocol:'pos-private-draft-context/v1',storeId:'store',epoch:'epoch',userId:'owner',role:'owner'},time='2026-10-18T06:00:00.000Z',date='2026-10-18'
// A lean proof fixture exercises settlement boundaries only. Full source/stock
// custody and native persistence require the real cutover model, not this data.
function proof(){
 const input=makeOpeningCutoverInput(JSON.stringify(source),scope,date),parsed=projectOpeningBalanceSource(input.sourceText,date)
 input.review={protocol:'pos-opening-cutover-review/v1',createdAt:Date.parse(time),scope,inputDigest:openingCutoverSourceDigest(input),dataDigest:'1'.repeat(64),planDigest:'2'.repeat(64),trialDigest:'3'.repeat(64)}
 const body={protocol:OPENING_CUTOVER_RECEIPT,success:true,id:input.id,signature:canonicalSignature(input),sourceDigest:openingCutoverSourceDigest(input),sequence:1,previousHash:null,source:source.source,cutoffDate:date,rows:[],totalValueCents:25001,clearingAccount:'3902',masterId:null,stockReceipt:null,bootstrapId:null,partyMappings:parsed.parties.map(p=>({key:p.key,side:p.side,externalId:p.externalId,targetId:p.side==='receivable'?'customer':'supplier',targetName:p.name})),customerCreates:[],supplierCreates:[],customerRevision:2,supplierRevision:1,customerBarrierId:openingBarrierId(input.id,'receivable'),supplierBarrierId:openingBarrierId(input.id,'payable'),priorCustomerDigest:null,priorSupplierDigest:null,custodyDigest:'4'.repeat(64),actor,time}
 return {...body,hash:privateDraftDigest(body)}
}
function base(){
 const data={storeId:'store',epoch:'epoch',documents:[],salesOperations:[],products:[],suppliers:[{id:'supplier',name:'原供應商'}],purchases:[],cashLogs:[],customerEntries:[],customerOperations:[],supplierEntries:[],supplierOperations:[],inventoryAudits:[]},created=planCustomerLedger({id:'create-customer',kind:'customer-ledger',action:'customer-create',storeId:'store',epoch:'epoch',expectedRevision:0,date,time,customer:{id:'customer',name:'原客戶'}},data,actor)
 data.customerEntries.push(created.event);data.customerOperations.push(created.receipt);return data
}
function saved(){const data=base(),receipt=proof(),customer=planCustomerOpeningActivation(openingActivationRequest(receipt,'receivable',scope),data,actor,receipt),supplier=planSupplierOpeningActivation(openingActivationRequest(receipt,'payable',scope),data,actor,receipt);data.customerEntries.push(customer.event);data.customerOperations.push(customer.receipt);data.supplierEntries.push(supplier.event);data.supplierOperations.push(supplier.receipt);data.openingBalanceContext=openingBalanceContextFromCutovers('store',[receipt]);return {data,receipt,customer,supplier}}

describe('OB4 source-bound activation of a new persistent format',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(time))})
 afterEach(()=>vi.useRealTimers())
 it('activates after the immutable ledger markers, preserving earlier customer history and source credits without old cash',()=>{
  const {data,receipt}=saved(),ar=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data),ap=validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)
  expect(ar.openingClaims).toHaveLength(1);expect(ar.openingClaims[0]).toMatchObject({amount:600,owed:600});expect(ar.receipts[0]).toMatchObject({fundingKind:'opening-credit',amount:100,available:100});expect(ap.openingClaims[0].amount).toBe(900);expect(ap.payments[0].available).toBe(200)
  expect(openingBalanceTimeline(data.openingBalanceContext,'receivable',2,'store').at(1).digest).toBe(null);expect(openingBalanceTimeline(data.openingBalanceContext,'receivable',2,'store').at(2).digest).toBe(ar.openingDigest);expect(data.cashLogs).toEqual([]);expect(receipt.sourceDigest).toBe(openingCutoverSourceDigest(JSON.parse(receipt.signature)))
 })
 it('keeps a caller from saving or borrowing the internal activation through ordinary money planning',()=>{
  const data=base(),receipt=proof(),ar=openingActivationRequest(receipt,'receivable',scope),ap=openingActivationRequest(receipt,'payable',scope)
  expect(()=>planCustomerLedger(ar,data,actor)).toThrow('整批搬家');expect(()=>planSupplierLedger(ap,data,actor)).toThrow('整批搬家')
  expect(()=>planCustomerOpeningActivation({...ar,sourceDigest:'0'.repeat(64)},data,actor,receipt)).toThrow();expect(()=>planSupplierOpeningActivation({...ap,sourceDigest:'0'.repeat(64)},data,actor,receipt)).toThrow();expect(data.customerEntries).toHaveLength(1);expect(data.supplierEntries).toHaveLength(0)
 })
 it('refuses a marker with no source proof instead of returning a zero balance',()=>{
  const {data}=saved();delete data.openingBalanceContext
  expect(()=>validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data)).toThrow();expect(()=>validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)).toThrow()
 })
 it.each(['missing-customer-marker','missing-supplier-marker','revision','source','owner','epoch','changed-facts','unknown-field'])('rejects %s source/activation damage',kind=>{
  const {data,receipt}=saved()
  if(kind==='missing-customer-marker'){data.customerEntries.pop();data.customerOperations.pop()}
  if(kind==='missing-supplier-marker'){data.supplierEntries.pop();data.supplierOperations.pop()}
  if(kind==='revision')data.customerEntries[1].revision=3
  if(kind==='source')data.supplierEntries[0].input.sourceDigest='0'.repeat(64)
  if(kind==='owner')data.customerEntries[1].actor={...actor,userId:'other'}
  if(kind==='epoch')data.customerEntries[1].input.epoch='other'
  if(kind==='changed-facts'){const input=JSON.parse(receipt.signature);input.sourceText=input.sourceText.replace('600.00','599.00');receipt.signature=canonicalSignature(input)}
  if(kind==='unknown-field')receipt.approved=true
  if(['changed-facts','unknown-field'].includes(kind))expect(()=>openingBalanceContextFromCutovers('store',[receipt])).toThrow()
  else expect(()=>{validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data);validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)}).toThrow()
 })
 it('requires the active source digest on later money requests and permits exact collection against original claims',()=>{
  const {data}=saved(),view=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data),request={id:'after-opening-receive',kind:'customer-ledger',action:'receive',date,time,storeId:'store',epoch:'epoch',expectedRevision:2,customerId:'customer',amount:200,method:'bank',confirmed:true}
  expect(()=>planCustomerLedger(request,data,actor)).toThrow('已更新');const received=planCustomerLedger({...request,expectedOpeningDigest:view.openingDigest},data,actor);data.customerEntries.push(received.event);data.customerOperations.push(received.receipt)
  const claim=view.openingClaims[0],allocated=planCustomerLedger({id:'after-opening-allocate',kind:'customer-ledger',action:'allocate',date,time,storeId:'store',epoch:'epoch',expectedRevision:3,expectedOpeningDigest:view.openingDigest,customerId:'customer',receiptId:request.id,reviewed:true,items:[{documentId:claim.documentId,deliveryId:claim.deliveryId,expectedRevision:1,amount:200}]},data,actor);data.customerEntries.push(allocated.event);data.customerOperations.push(allocated.receipt)
  expect(validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data).openingClaims[0].owed).toBe(400);expect(data.documents).toEqual([]);expect(data.purchases).toEqual([])
 })
 it('retains the full original source while proving only this layer, not a whole-stock postimage',()=>{const receipt=proof(),parsed=readOpeningCutoverProof(receipt,'store');expect(parsed.input.sourceText).toBe(JSON.stringify(source));expect(parsed.parsed.stockRequired).toBe(true);expect(parsed.batch.sourceText).toBe(parsed.input.sourceText);expect(()=>readOpeningCutoverProof(receipt,'other')).toThrow()})
})
