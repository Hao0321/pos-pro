import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import fixture from '../fixtures/stock-cost-native-v1.json'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {operationRecords,materialSignature,recoveryStoreId} from '../../electron/recoveryRules.mjs'
import {recoveryBoundaryMatches} from '../../electron/recoveryBook.mjs'
import {packRecoveryGraph,unpackRecoveryGraph,mergeRecoveryGraphs,validateRecoveryGraph,emptyRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {createCompleteBackup,readCompleteBackup,FULL_BACKUP_FORMAT} from '../../electron/backupEnvelope.mjs'

const digest=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:canonicalSignature(value)).digest('hex'),book=()=>structuredClone(fixture.book)
function graph(id='source-1'){
 const data=JSON.stringify(book()),source={id,createdAt:'2026-10-16T04:00:00Z',actorId:'owner',storeId:recoveryStoreId(book()),data,contentSignature:digest(data).slice(7),afterMaterial:digest(materialSignature(book())).slice(7)},eventId='restore-'+id
 return packRecoveryGraph({snapshots:[source],originalIds:operationRecords(book()).map(row=>[row.method,row.id,id]),events:[{id:eventId,actorId:'owner',signature:canonicalSignature({kind:'restore-preview',previewId:eventId}),receipt:JSON.stringify({protocol:'pos-recovery-v1',success:true,id:eventId,sourceId:id,storeId:source.storeId,revision:'original-revision'})}]},'sqlite')
}
function packet(){return createCompleteBackup(book(),graph(),'sqlite')}
function reseal(value){const {checksum,...body}=value;return {...body,checksum:digest(body)}}
function changeSource(value,mutate){const row=value.protection.books[0],old=row.id,data=JSON.parse(row.data);mutate(data);row.data=JSON.stringify(data);row.contentSignature=digest(row.data).slice(7);row.id=digest({storage:'sqlite',data:row.data,contentSignature:row.contentSignature});for(const source of value.protection.snapshots)if(source.bookId===old)source.bookId=row.id}
it('preserves every raw source byte, original index and acknowledgement of a native-derived book in a complete file',()=>{
 const p=packet(),copy=structuredClone(p),decoded=readCompleteBackup(p,'sqlite'),raw=unpackRecoveryGraph(decoded.protection,'sqlite');expect(p.format).toBe(FULL_BACKUP_FORMAT);expect(decoded.book).toEqual(fixture.book);expect(decoded.features).toEqual(['stock-cost-v1']);expect(raw.snapshots[0].data).toBe(JSON.stringify(fixture.book));expect(raw.originalIds).toHaveLength(operationRecords(book()).length);expect(raw.events[0].receipt).toContain('original-revision');expect(p).toEqual(copy)
 expect(createCompleteBackup(book(),graph(),'sqlite',{digest})).toEqual(p)
})
it('deduplicates identical source content while retaining distinct immutable boundaries, indices and events',()=>{
 const first=graph('one'),second=graph('two'),merged=mergeRecoveryGraphs(first,second,'sqlite');expect(merged.books).toHaveLength(1);expect(merged.snapshots).toHaveLength(2);expect(merged.events).toHaveLength(2);expect(merged.originalIds).toHaveLength(first.originalIds.length*2);expect(mergeRecoveryGraphs(merged,first,'sqlite')).toEqual(merged);expect(JSON.stringify(mergeRecoveryGraphs(merged,merged,'sqlite')).length).toBe(JSON.stringify(merged).length)
})
it('keeps a real empty graph separate from missing protection, unsupported formats and cross-storage guessing',()=>{
 expect(readCompleteBackup(createCompleteBackup(book(),emptyRecoveryGraph(),'sqlite'),'sqlite').protection.snapshots).toEqual([]);expect(readCompleteBackup(book(),'sqlite').legacy).toBe(true)
 const missing=packet();delete missing.protection;expect(()=>readCompleteBackup(missing,'sqlite')).toThrow(/保護紀錄/);expect(()=>readCompleteBackup({...packet(),format:'pos-complete-backup/v99'},'sqlite')).toThrow(/不支援/);expect(()=>readCompleteBackup(packet(),'browser')).toThrow(/桌面版|瀏覽器版/)
})
it.each([
 ['missing source book',p=>{p.protection.books=[]}],
 ['missing acknowledgement',p=>{p.protection.events=[]}],
 ['missing index',p=>{p.protection.originalIds.pop()}],
 ['extra index',p=>{p.protection.originalIds.push(['checkout','not-in-source','source-1'])}],
 ['duplicate index',p=>{p.protection.originalIds.push(p.protection.originalIds[0])}],
 ['duplicate source',p=>{p.protection.snapshots.push(p.protection.snapshots[0])}],
 ['duplicate source book',p=>{p.protection.books.push(p.protection.books[0])}],
 ['wrong source store',p=>{p.protection.snapshots[0].storeId='other-store'}],
 ['wrong current store',p=>{p.storeId='other-store'}],
 ['dropped compatibility',p=>{p.features=[]}],
 ['dangling acknowledgement',p=>{const r=p.protection.events[0];r.receipt=JSON.stringify({...JSON.parse(r.receipt),sourceId:'missing'})}],
 ['changed acknowledgement request',p=>{p.protection.events[0].signature=canonicalSignature({kind:'restore-preview',previewId:'another'})}],
 ['changed raw source',p=>{p.protection.books[0].data+=' '}],
 ['changed actual source order',p=>changeSource(p,data=>{data.orders[0].total+=1})],
 ['missing source cost half',p=>changeSource(p,data=>{delete data.stockCostOperations})],
 ['recursive backup in a source',p=>changeSource(p,data=>{data.protection={books:[]}})],
 ['missing current collection',p=>{delete p.book.orders}],
])('rejects %s even if the outer checksum is recomputed',(_name,mutate)=>{const p=packet();mutate(p);const value=reseal(p),before=JSON.stringify(value);expect(()=>readCompleteBackup(value,'sqlite')).toThrow();expect(JSON.stringify(value)).toBe(before)})
it('rejects a changed same-ID source or event instead of replacing existing protected history',()=>{
 const original=graph(),changed=structuredClone(original);changed.snapshots[0].createdAt='2026-10-17T00:00:00Z';validateRecoveryGraph(changed,'sqlite');expect(()=>mergeRecoveryGraphs(original,changed,'sqlite')).toThrow(/保護紀錄/)
 const event=structuredClone(original);event.events[0].actorId='another';event.snapshots[0].actorId='another';validateRecoveryGraph(event,'sqlite');expect(()=>mergeRecoveryGraphs(original,event,'sqlite')).toThrow(/保護紀錄/)
})
it('accepts only the known harmless retained cost marker in an old recovery boundary',()=>{
 const legacy=book();legacy.settings=legacy.settings.filter(row=>row.key!=='stockCostVersionFence');const boundary=digest(materialSignature(legacy)).slice(7),current={...structuredClone(legacy),settings:[...legacy.settings,{key:'stockCostVersionFence',value:'1'}]};expect(recoveryBoundaryMatches(boundary,current,'sqlite')).toBe(true)
 current.products[0].stock+=1;expect(recoveryBoundaryMatches(boundary,current,'sqlite')).toBe(false)
})
