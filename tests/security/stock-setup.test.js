// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/stock-setup-native-v1.json'
import {stockSetupAmount,makeStockSetupState,previewStockSetup,verifyStockSetupReview} from '../../electron/stockSetup.mjs'
import {stockOpeningKey,planStockOpening,stockCostCommand} from '../../electron/stockOpeningPlan.mjs'
import {stockLedgerDigest,projectStockLedger} from '../../electron/stockLedgerModel.mjs'
import {planCostCustody,costCustodySummary} from '../../electron/stockCustody.mjs'
import {makeStockOpeningHandoff,readStockOpeningAgent} from '../../electron/stockOpeningAgent.mjs'
import {assertStockSetupResult} from '../../electron/stockSetupReview.mjs'
import {RECORD_KEY,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {bookToBrowser,browserToBook} from '../../electron/recoveryRules.mjs'
import {getBrowserStockSetupState,previewBrowserStockSetup,commitBrowserStockSetup} from '../../src/utils/browserStockSetup'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {getBrowserSupplierState} from '../../src/utils/browserSupplierLedger'
import {commitBrowserInventory} from '../../src/utils/browserInventory'

beforeEach(()=>{localStorage.clear();vi.stubEnv('VITE_POS_STOCK_SETUP','isolated-fixture');Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name,work)=>work()}})})
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();vi.restoreAllMocks()})
const data=()=>({state:{projection:null,stateDigest:stockLedgerDigest(null),entries:[],valuation:null},preview:fixture.preview,products:fixture.book.products,storeId:fixture.preview.storeId,epoch:fixture.preview.epoch,now:Date.parse(fixture.provenance.clock)})
const scope=state=>{const {now,...context}=state.context;return context},free=stockOpeningKey('available','free')
const command=preview=>({...preview.input,id:'setup-original',time:preview.input.review.issuedAt})
function seed(){const book=structuredClone(fixture.book);book.settings=book.settings.map(row=>({...row,value:['stockCostVersionFence','stockCostBookHead'].includes(row.key)?row.value:JSON.stringify(row.value)}));localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:fixture.preview.epoch,data:bookToBrowser(book)}))}
it('uses exact half-up final cents for a fractional unit price',()=>{
  expect(Math.round(.125*1.16*100)).toBe(14)
  expect(stockSetupAmount('1.16','unit',125)).toBe(15)
  expect(stockSetupAmount('1.16','total',125)).toBe(116)
  expect(stockSetupAmount('0.01','unit',1)).toBe(0)
})
it.each(['','0','-1','1e2','Infinity','1.001','0001','1,000',' 1'])('retains and rejects malformed or implicit-free raw cost %s',raw=>expect(()=>stockSetupAmount(raw,'total',1000)).toThrow())
it('separates available, held and consumed costs, leaving surplus and zero reference costs unknown',()=>{
  const state=makeStockSetupState(data())
  expect(state.rows.find(row=>row.key===stockOpeningKey('available','rice')).quantityUnits).toBe(9750)
  expect(state.rows.find(row=>row.stage==='reserved').quantityUnits).toBe(250)
  expect(state.rows.find(row=>row.stage==='consumed').quantityUnits).toBe(125)
  expect(state.rows.find(row=>row.productId==='counted').referenceAllowed).toBe(false)
  const preview=previewStockSetup({context:scope(state),entries:[{key:free,mode:'free',raw:''}],useReferences:true},data()),request=command(preview)
  expect(preview.summary.complete).toBe(false);expect(preview.summary.categories.available.unknownSources).toBe(2)
  expect(stockCostCommand(request)).toEqual(request);expect(()=>verifyStockSetupReview(request,data())).not.toThrow()
  expect(()=>verifyStockSetupReview({...request,overrides:request.overrides.map(row=>row.key===free?{...row,valueCents:99}:row)},data())).toThrow()
})
it('rejects stale source, expired review, unknown batch and undeclared data',()=>{
  const source=data(),state=makeStockSetupState(source),raw={context:scope(state),entries:[],useReferences:true},preview=previewStockSetup(raw,source),request=command(preview)
  expect(()=>verifyStockSetupReview(request,{...source,now:source.now+300001})).toThrow(/過期/)
  expect(()=>previewStockSetup({...raw,role:'owner'},source)).toThrow()
  expect(()=>previewStockSetup({...raw,entries:[{key:'missing',mode:'free',raw:''}]},source)).toThrow()
  expect(()=>previewStockSetup({...raw,context:{...raw.context,epoch:'restored'}},source)).toThrow(/更新/)
  expect(()=>makeStockSetupState({...source,preview:{...source.preview,referenceInventoryBalanceCents:null}})).not.toThrow()
  expect(()=>previewStockSetup(raw,{...source,preview:{...source.preview,referenceInventoryBalanceCents:null}})).toThrow(/舊存貨帳/)
})
it('reviews and applies both late supplier-return cost and the clearing journal exactly once',()=>{
  const source=data(),opening=previewStockSetup({context:scope(makeStockSetupState(source)),entries:[],useReferences:true},source),plan=planStockOpening(source.preview,command(opening),fixture.provenance.clock.slice(0,10)),owner={stage:'supplierReturned',locationId:'main',referenceId:'supplier-return-fixture'}
  const moved=planCostCustody(plan.custody,{expectedSequence:plan.custody.sequence,steps:[{kind:'move',from:{stage:'available',locationId:'main',referenceId:''},to:owner,productId:'unknown',unit:source.products.find(row=>row.id==='unknown').unit,quantityUnits:500}]})
  const previous={version:1,custody:moved.state,sourceEvidence:plan.sourceEvidence,journals:[plan.journal],business:[{eventId:'supplier-return-fixture',notes:[{kind:'supplier-return-clearing',owner,creditCents:150,cleared:false}]}]},active={...source,state:{projection:previous,stateDigest:stockLedgerDigest(previous),valuation:costCustodySummary(moved.state)}},state=makeStockSetupState(active),row=state.rows.find(row=>row.productId==='unknown')
  const preview=previewStockSetup({context:scope(state),entries:[{key:row.key,mode:'unit',raw:'1.16'}],useReferences:false},active),input={...command(preview),id:'late-return-cost'}
  expect(preview.input.review.journalLines.filter(row=>row.account==='2291')).toEqual([{account:'2291',debitCents:150,creditCents:0}])
  const body={input,time:input.time,date:input.time.slice(0,10),beforeDigest:active.state.stateDigest,openingMaterial:null},after=projectStockLedger(previous,body)
  expect(after.business[0].notes[0].cleared).toBe(true);expect(after.journals.slice(previous.journals.length).flatMap(row=>row.lines)).toEqual(input.review.journalLines)
  expect(after.custody.sources.find(item=>item.id===row.sourceId).valueCents).toBe(261);expect(previous.business[0].notes[0].cleared).toBe(false)
  expect(()=>projectStockLedger(previous,{...body,input:{...input,review:{...input.review,journalLines:input.review.journalLines.filter(line=>line.account!=='2291')}}})).toThrow()
})
it('exposes a data-only Agent packet and accepts only a matching typed cost draft',()=>{
  const state=makeStockSetupState(data()),row=state.rows.find(row=>row.stage==='consumed'),packet=JSON.parse(makeStockOpeningHandoff(state,[row.key])),reply={protocol:'pos-stock-opening-draft/v1',context:scope(state),entries:[{key:row.key,unit:row.unit,mode:'unit',raw:'1.16'}]}
  expect(packet.rows[0].quantityUnits).toBe(125);expect(Object.keys(packet)).toEqual(['protocol','context','mode','instructions','rows','responseFormat']);expect(JSON.stringify(packet)).not.toContain(fixture.book.users[0].password)
  expect(readStockOpeningAgent(JSON.stringify(reply),state)).toEqual([{key:row.key,mode:'unit',raw:'1.16'}])
  for(const patch of [{role:'owner'},{confirmed:true},{command:'open'}])expect(()=>readStockOpeningAgent(JSON.stringify({...reply,...patch}),state)).toThrow()
  expect(()=>readStockOpeningAgent(JSON.stringify({...reply,entries:[{...reply.entries[0],unit:'包'}]}),state)).toThrow(/單位/)
  expect(()=>readStockOpeningAgent(JSON.stringify({...reply,entries:[{...reply.entries[0],raw:'0'}]}),state)).toThrow(/免費/)
  expect(()=>readStockOpeningAgent(JSON.stringify({...reply,context:{...reply.context,reviewId:'sha256:'+'0'.repeat(64)}}),state)).toThrow(/更新/)
})
it('opens the actual browser record once, supports late source pricing and preserves all original business data',async()=>{
  seed();const before=browserToBook(readRecords().data),state=await getBrowserStockSetupState(fixture.owner),preview=await previewBrowserStockSetup({context:scope(state),entries:[{key:free,mode:'free',raw:''}],useReferences:true},fixture.owner),request=command(preview),result=await commitBrowserStockSetup(request,fixture.owner)
  expect(result.success,result.error).toBe(true);assertStockSetupResult(request,result)
  const after=browserToBook(readRecords().data);for(const key of Object.keys(before).filter(key=>!['stockCostEntries','stockCostOperations','settings'].includes(key)))expect(after[key],key).toEqual(before[key])
  const saved=localStorage.getItem(RECORD_KEY);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+600001));vi.stubEnv('VITE_POS_STOCK_SETUP','disabled')
  expect(await commitBrowserStockSetup(request,fixture.owner)).toEqual(result);expect(localStorage.getItem(RECORD_KEY)).toBe(saved)
  expect(()=>assertStockSetupResult(request,{...result,receipt:{...result.receipt,valuation:null}})).toThrow()
  vi.stubEnv('VITE_POS_STOCK_SETUP','isolated-fixture');const active=await getBrowserStockSetupState(fixture.owner),row=active.rows.find(row=>row.productId==='unknown'),price=await previewBrowserStockSetup({context:scope(active),entries:[{key:row.key,mode:'unit',raw:'1.16'}],useReferences:false},fixture.owner),priced=await commitBrowserStockSetup({...command(price),id:'price-original'},fixture.owner)
  expect(priced.success,priced.error).toBe(true);expect(validateStockCostBook(browserToBook(readRecords().data)).projection.custody.sources.find(row=>row.id===price.input.sourceId).valueCents).toBe(261)
})
it('clears an actual browser supplier return only after reviewed source pricing and replays its original receipt',async()=>{
  seed();const record=readRecords();writeRecords({pos_suppliers:[{id:'setup-supplier',name:'Fixture supplier'}]},record.revision)
  const state=await getBrowserStockSetupState(fixture.owner),opening=await previewBrowserStockSetup({context:scope(state),entries:[],useReferences:true},fixture.owner)
  expect((await commitBrowserStockSetup(command(opening),fixture.owner)).success).toBe(true)
  const inventory=async(kind,id,extra={})=>{const s=await getBrowserSupplierState(fixture.owner),po=s.purchases.find(row=>row.id===extra.purchaseId),request={kind,id,time:new Date().toISOString(),supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...(po?{expectedPurchase:canonicalSignature(po)}:{}),...extra},result=await commitBrowserInventory(request,fixture.owner);expect(result.success,result.error).toBe(true);return result}
  await inventory('purchase-create','setup-po-create',{purchase:{id:'setup-po',supplierId:'setup-supplier',date:'2026-10-16',items:[{productId:'counted',name:'盤盈待確認',unit:'包',qty:1,unitCost:3,received:0}]}})
  await inventory('receive','setup-receive',{purchaseId:'setup-po',quantities:[1]});await inventory('purchase-bill','setup-bill',{purchaseId:'setup-po',quantities:[1],reference:'Fixture invoice',dueDate:'2026-10-16'});await inventory('purchase-return','setup-return',{purchaseId:'setup-po',invoiceId:'setup-bill',quantities:[.5],reason:'Fixture return'})
  const before=browserToBook(readRecords().data),previous=validateStockCostBook(before).projection;expect(previous.business.find(row=>row.id==='setup-return').notes[0].cleared).toBe(false)
  const active=await getBrowserStockSetupState(fixture.owner),row=active.rows.find(row=>row.productId==='counted'),preview=await previewBrowserStockSetup({context:scope(active),entries:[{key:row.key,mode:'total',raw:'2'}],useReferences:false},fixture.owner),input={...command(preview),id:'setup-return-price'}
  expect(input.review.journalLines).toContainEqual({account:'2291',debitCents:150,creditCents:0});const result=await commitBrowserStockSetup(input,fixture.owner);expect(result.success,result.error).toBe(true)
  const after=browserToBook(readRecords().data),projection=validateStockCostBook(after).projection;expect(projection.business.find(row=>row.id==='setup-return').notes[0].cleared).toBe(true);expect(projection.journals.slice(previous.journals.length).flatMap(row=>row.lines)).toEqual(input.review.journalLines)
  for(const key of Object.keys(before).filter(key=>!['stockCostEntries','stockCostOperations','settings'].includes(key)))expect(after[key],key).toEqual(before[key])
  const saved=localStorage.getItem(RECORD_KEY);expect(await commitBrowserStockSetup(input,fixture.owner)).toEqual(result);expect(localStorage.getItem(RECORD_KEY)).toBe(saved)
})
it('rejects disabled activation, a forged owner, stale review and an unrelated storage mutation',async()=>{
  seed();const state=await getBrowserStockSetupState(fixture.owner),preview=await previewBrowserStockSetup({context:scope(state),entries:[],useReferences:true},fixture.owner),request=command(preview),raw=localStorage.getItem(RECORD_KEY)
  vi.stubEnv('VITE_POS_STOCK_SETUP','disabled');expect((await commitBrowserStockSetup(request,fixture.owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
  vi.stubEnv('VITE_POS_STOCK_SETUP','isolated-fixture');expect((await commitBrowserStockSetup(request,{...fixture.owner,username:'forged'})).success).toBe(false)
  expect(()=>writeRecords({pos2_members:[{id:'unrelated'}]},readRecords().revision,{stockSetup:{request,actor:fixture.owner,timestamp:new Date().toISOString()}})).toThrow(/其他資料/)
  const record=readRecords();writeRecords({pos2_products:record.data.pos2_products.map(row=>row.id==='rice'?{...row,cost:5}:row)},record.revision)
  expect((await commitBrowserStockSetup(request,fixture.owner)).success).toBe(false)
})
