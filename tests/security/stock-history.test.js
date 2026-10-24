// @vitest-environment jsdom
import {it,expect,beforeEach,afterEach,vi} from 'vitest'
import fixture from '../fixtures/stock-history-native-v1.json'
import {replayStockLedger} from '../../electron/stockLedgerModel.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {newStockHistoryQuery,makeStockHistory,stockHistoryQuery,assertStockHistoryResult} from '../../electron/stockHistory.mjs'
import {historyQuantity,historyMoney} from '../../src/utils/stockHistoryDisplay.mjs'
import {bookToBrowser} from '../../electron/recoveryRules.mjs'
import {RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserStockHistory} from '../../src/utils/browserStockHistory'

function data(){const spans=[],book=structuredClone(fixture.book),state=replayStockLedger(book.stockCostEntries,book.stockCostOperations,undefined,(sequence,start,end)=>spans.push({sequence,start,end}));validateStockCostBook(book,state);return {book,state,spans,epoch:'history-fixture-epoch'}}
const query=(patch={})=>({...newStockHistoryQuery(),...patch})
function allPages(input,source){let result=assertStockHistoryResult(makeStockHistory(input,source),input),rows=[...result.rows];while(result.nextCursor!==null){input={...input,context:result.context,cursor:result.nextCursor};result=assertStockHistoryResult(makeStockHistory(input,source),input);rows.push(...result.rows)}return rows}
beforeEach(()=>{localStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key,work)=>work()}})})
afterEach(()=>vi.restoreAllMocks())
it('paginates every original native event and preserves historical unknown cost after late confirmation',()=>{
 const source=data(),rows=allPages(query({productId:'unknown'}),source)
 expect(rows.length).toBeGreaterThan(50);expect(rows.at(-1).kind).toBe('open');expect(new Set(rows.map(r=>r.eventId)).size).toBe(rows.length)
 const first=rows.find(r=>r.operationId==='shared-history-id'&&r.method==='addWaste');expect(first.parts[0].original.valueCents).toBe(null);expect(first.parts[0].current.complete).toBe(true)
 const priced=rows.find(r=>r.operationId==='history-source-price');expect(priced.parts[0].quantityUnits).toBe(null);expect(priced.parts[0].current.valueCents).toBe(261)
 const opening=rows.at(-1);expect(opening.parts[0].original.valueCents).toBe(null);expect(opening.parts[0].current.valueCents).toBe(261)
})
it('filters original source intervals before calculating a mixed-source historical cost',()=>{
 const source=data(),sourceId=source.state.entries.find(e=>e.input.id==='history-source-price').input.sourceId,rows=allPages(query({productId:'unknown',sourceId}),source),mixed=rows.find(r=>r.operationId==='history-mixed-waste')
 expect(mixed.parts[0].quantityUnits).toBe(2194);expect(mixed.parts[0].original.valueCents).toBe(null);expect(mixed.parts[0].current.valueCents).toBe(255);expect(mixed.parts[0].segments.every(s=>s.sourceId===sourceId)).toBe(true)
 const whole=allPages(query({productId:'unknown'}),source).find(r=>r.operationId==='history-mixed-waste');expect(whole.parts[0].quantityUnits).toBe(2500);expect(whole.parts[0].current.valueCents).toBe(316)
 const result=makeStockHistory(query({productId:'unknown',sourceId}),source);expect(result.source.quantityUnits).toBe(2250);expect(result.source.originalValueCents).toBe(null);expect(result.source.valueCents).toBe(261);expect(result.source.positions.reduce((n,p)=>n+p.quantityUnits,0)).toBe(2250)
})
it('attributes every new journal to its actual event despite operation IDs reused across methods',()=>{
 const source=data(),rows=allPages(query({productId:'counted'}),source),priced=rows.find(r=>r.operationId==='shared-history-id'&&r.kind==='price')
 expect(priced.journals).toHaveLength(2);expect(priced.journals.flatMap(j=>j.lines)).toContainEqual({account:'2291',debitCents:150,creditCents:0})
 const waste=allPages(query({productId:'unknown'}),source).find(r=>r.operationId==='shared-history-id'&&r.kind==='addWaste');expect(waste.journals.flatMap(j=>j.lines).some(l=>l.account==='2291')).toBe(false)
})
it('freezes source, restore epoch and current display metadata for pagination without modifying the book',()=>{
 const source=data(),before=JSON.stringify(source.book),page=makeStockHistory(query(),source);expect(page.total).toBe(70);expect(page.rows).toHaveLength(20)
 expect(()=>makeStockHistory(query({context:page.context,cursor:20}),{...source,epoch:'restored'})).toThrow(/更新/)
 const changed=structuredClone(source);changed.book.products[0].name='Renamed';expect(()=>makeStockHistory(query({context:page.context,cursor:20}),changed)).toThrow(/更新/)
 expect(()=>makeStockHistory(query(),{...source,spans:source.spans.slice(1)})).toThrow();expect(JSON.stringify(source.book)).toBe(before)
 expect(()=>stockHistoryQuery({...query(),role:'owner'})).toThrow();expect(()=>stockHistoryQuery(query({cursor:20}))).toThrow();expect(()=>stockHistoryQuery(query({sourceId:'other'}))).toThrow()
})
it('reads actual standalone storage under the lock, rejects staff and forged owners, and preserves exact bytes',async()=>{
 const book=structuredClone(fixture.book);book.settings=book.settings.map(r=>({...r,value:['stockCostVersionFence','stockCostBookHead'].includes(r.key)?r.value:JSON.stringify(r.value)}));localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'history-fixture-epoch',data:bookToBrowser(book)}));const before=localStorage.getItem(RECORD_KEY),owner=fixture.owner
 const result=await getBrowserStockHistory(query({productId:'counted'}),owner);expect(result.status).toBe('active');expect(result.rows.some(r=>r.journals.some(j=>j.lines.some(l=>l.account==='2291')))).toBe(true)
 await expect(getBrowserStockHistory(query(),{...owner,role:'staff'})).rejects.toThrow();await expect(getBrowserStockHistory(query(),{...owner,username:'forged'})).rejects.toThrow();expect(localStorage.getItem(RECORD_KEY)).toBe(before)
 const damaged=JSON.parse(before);damaged.data.pos_stock_cost_entries[0].hash='sha256:'+'0'.repeat(64);localStorage.setItem(RECORD_KEY,JSON.stringify(damaged));await expect(getBrowserStockHistory(query(),owner)).rejects.toThrow()
})
it('rejects incomplete history replies and formats the largest exact cents without float conversion',()=>{
 const source=data(),input=query({productId:'unknown'}),result=makeStockHistory(input,source);expect(()=>assertStockHistoryResult(result,input)).not.toThrow()
 for(const patch of [{protocol:'other'},{total:0},{rows:[]},{context:null},{product:{...result.product,id:'other'}}])expect(()=>assertStockHistoryResult({...result,...patch},input)).toThrow()
 const wrong=structuredClone(result);wrong.rows[0].parts[0].current.valueCents=null;expect(()=>assertStockHistoryResult(wrong,input)).toThrow()
 for(const locale of ['zh-TW','en','ja','zh-CN']){expect(historyMoney(Number.MAX_SAFE_INTEGER,locale)).toBe('NT$ 90,071,992,547,409.91');expect(historyQuantity(Number.MAX_SAFE_INTEGER,locale)).toBe('9,007,199,254,740.991');expect(historyQuantity(125,locale)).toBe('0.125');expect(historyMoney(0,locale)).toBe('NT$ 0.00')}
})
it('observes only primitive journal bounds and cannot mutate verified replay data through callback arguments',()=>{
 const book=structuredClone(fixture.book),before=JSON.stringify(book),plain=replayStockLedger(book.stockCostEntries,book.stockCostOperations),seen=[]
 const observed=replayStockLedger(book.stockCostEntries,book.stockCostOperations,undefined,(...args)=>{expect(args).toHaveLength(3);expect(args.every(value=>typeof value==='number')).toBe(true);seen.push(args.slice());args.fill(-1)})
 expect(observed).toEqual(plain);expect(JSON.stringify(book)).toBe(before);expect(seen).toHaveLength(book.stockCostEntries.length);expect(seen[0][1]).toBe(0);expect(seen.at(-1)[2]).toBe(plain.projection.journals.length)
})
