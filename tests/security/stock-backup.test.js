import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import fixture from '../fixtures/stock-cost-native-v1.json'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {stockLedgerDigest,replayStockLedger} from '../../electron/stockLedgerModel.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {operationRecords,protectedRestoreBook} from '../../electron/recoveryRules.mjs'

it('verifies a real old native fixture against its frozen canonical baseline and Node SHA-256',()=>{
 expect(createHash('sha256').update(canonicalSignature(fixture.book)).digest('hex')).toBe(fixture.provenance.canonicalBookSha256)
 for(const text of ['', 'abc','原文🍚\u0000', 'x'.repeat(65537)])expect(stockLedgerDigest(text)).toBe('sha256:'+createHash('sha256').update(text).digest('hex'))
 const state=validateStockCostBook(fixture.book)
 expect(state.valuation.ownedValueCents).toBe(27000);expect(state.projection.business.find(row=>row.id==='sale').effects[0].cost.valueCents).toBe(23000)
 expect(state.entries.map(row=>row.sequence)).toEqual([1,2,3]);expect(state.operations).toHaveLength(3)
})
it('replays sequence order rather than export ID order, retaining every original receipt',()=>{
 const state=replayStockLedger([...fixture.book.stockCostEntries].reverse(),[...fixture.book.stockCostOperations].reverse())
 expect(state.entries[0].input.action).toBe('open');expect(state.valuation.ownedValueCents).toBe(27000)
 expect(state.operations.map(row=>row.receipt).sort((a,b)=>a.sequence-b.sequence)).toEqual([...fixture.book.stockCostOperations].map(row=>row.receipt).sort((a,b)=>a.sequence-b.sequence))
})
it('native Node crypto and portable browser SHA produce the same complete verified book',()=>{
 const native=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:canonicalSignature(value)).digest('hex')
 expect(replayStockLedger(fixture.book.stockCostEntries,fixture.book.stockCostOperations,native)).toEqual(replayStockLedger(fixture.book.stockCostEntries,fixture.book.stockCostOperations))
 expect(()=>replayStockLedger(fixture.book.stockCostEntries,fixture.book.stockCostOperations,()=> 'sha256:wrong')).toThrow(/成本回執/)
})
it.each([
 ['missing half',book=>{delete book.stockCostOperations}],
 ['null arrays',book=>{book.stockCostEntries=null;book.stockCostOperations=null}],
 ['duplicate event',book=>book.stockCostEntries.push(structuredClone(book.stockCostEntries[0]))],
 ['duplicate acknowledgement',book=>{book.stockCostOperations[1]=structuredClone(book.stockCostOperations[0])}],
 ['changed hash',book=>{book.stockCostEntries[0].hash='bad'}],
 ['changed receipt',book=>{book.stockCostOperations[0].receipt.eventId='changed'}],
 ['changed price',book=>{book.orders[0].total+=1}],
 ['changed order line',book=>{book.orders[0].items[0].qty+=1}],
 ['missing order',book=>{book.orders=[]}],
 ['wrong custody',book=>{book.products[0].stock+=1}],
 ['wrong store',book=>{book.settings.find(row=>row.key==='sharedStoreId').value='different-store'}],
 ['missing receiving source',book=>{book.auditLog=book.auditLog.filter(row=>row.id!=='stock-operation:receive')}],
 ['future compatibility version',book=>book.settings.push({key:'stockCostVersionFence',value:'2'})],
])('rejects %s without mutating the selected source',(_name,mutate)=>{const book=structuredClone(fixture.book);mutate(book);const raw=JSON.stringify(book);expect(()=>validateStockCostBook(book)).toThrow(/成本回執/);expect(JSON.stringify(book)).toBe(raw)})
it('retains the compatibility fence after a complete old-book restore and indexes cost opening IDs',()=>{
 const current=structuredClone(fixture.book);current.settings.push({key:'stockCostVersionFence',value:'1'})
 const old={...structuredClone(current),stockCostEntries:[],stockCostOperations:[],orders:[],purchases:[],auditLog:[],products:[{...current.products[0],stock:10}],settings:current.settings.filter(row=>row.key!=='stockCostVersionFence')}
 const next=protectedRestoreBook(current,old);expect(next.stockCostEntries).toEqual([]);expect(next.settings.find(row=>row.key==='stockCostVersionFence').value).toBe('1');expect(operationRecords(current).find(row=>row.method==='applyStockCostOperation').id).toBe('opening')
})
