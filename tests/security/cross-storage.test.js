import {it,expect} from 'vitest'
import native from '../fixtures/cross-storage-native-v1.json'
import browser from '../fixtures/cross-storage-browser-v1.json'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
import {createCompleteBackup,readCompleteBackup,readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {convertSettingRows,settingValue} from '../../electron/settingEncoding.mjs'
import {convertLogicalBook} from '../../electron/storageConversion.mjs'
import {browserToBook,bookToBrowser} from '../../electron/recoveryRules.mjs'
import {recoveryBoundaryMatches} from '../../electron/recoveryBook.mjs'
import {validateRecoveryGraph,mergeRecoveryGraphs,portableRecoveryGraph} from '../../electron/recoveryGraph.mjs'
const seal=p=>{const {checksum,...body}=p;return {...body,checksum:stockLedgerDigest(body)}}
it.each([['native reference',native.reference.packet,'sqlite','browser'],['native cost',native.cost.packet,'sqlite','browser'],['browser typed',browser.packet,'browser','sqlite']])('%s converts both ways without rewriting original source bytes, IDs, boundaries or receipts',(_name,packet,from,to)=>{
 const before=structuredClone(packet),converted=readPortableBackup(packet,to),again=createCompleteBackup(converted.book,converted.protection,to,{features:converted.features}),back=readPortableBackup(again,from)
 expect(converted.converted).toBe(true);expect(converted.features).toContain('cross-storage-v1');expect(converted.protection.version).toBe(3)
 const expected=structuredClone(packet.book);delete expected._revision;expect(back.book).toEqual(expected)
 for(const row of packet.protection.books)expect(converted.protection.books.find(r=>r.id===row.id)).toEqual({...row,storage:from})
 for(const key of ['snapshots','originalIds','events'])expect(converted.protection[key]).toEqual(packet.protection[key])
 expect(packet).toEqual(before);expect(()=>readCompleteBackup(packet,to)).toThrow();validateRecoveryGraph(back.protection,from)
})
it('preserves zero, false, empty, numeric-looking text, JSON whitespace and nested values with explicit reversible encodings',()=>{
 const nativeRows=[...native.reference.packet.book.settings],encoded=convertSettingRows(nativeRows,'sqlite','browser');expect(convertSettingRows(encoded,'browser','sqlite')).toEqual(nativeRows)
 for(const row of encoded)expect(settingValue(row,'browser')).toBe(nativeRows.find(r=>r.key===row.key).value)
 const values=[0,false,'','001.20',{nested:[0,false,'2']},null],rows=values.map((v,i)=>({key:'typed'+i,value:JSON.stringify(v),id:'legacy-setting-'+i}));rows.push({key:'spaces',value:' { "x": 0 } '})
 const sql=convertSettingRows(rows,'browser','sqlite');expect(sql.map(r=>settingValue(r,'sqlite'))).toEqual([...values,{x:0}]);expect(convertSettingRows(sql,'sqlite','browser')).toEqual(rows)
})
it('compares the unchanged destination through the original source representation and rejects a real business change',()=>{
 for(const [packet,from,to]of [[native.reference.packet,'sqlite','browser'],[browser.packet,'browser','sqlite']]){
  const incoming=readPortableBackup(packet,to),current=to==='browser'?browserToBook(incoming.book):incoming.book,graph=validateRecoveryGraph(incoming.protection,to),source=[...graph.snapshots.values()].find(row=>row.source.book.cashLog.length===60)
  expect(recoveryBoundaryMatches(source.afterMaterial,current,to,stockLedgerDigest,from)).toBe(true)
  const changed=structuredClone(current);changed.products[0].price+=1;expect(recoveryBoundaryMatches(source.afterMaterial,changed,to,stockLedgerDigest,from)).toBe(false)
 }
})
it('merges mixed-storage protection without collapsing same-content origins or rewriting v1 IDs',()=>{
 const nativeGraph=portableRecoveryGraph(native.reference.packet.protection,'sqlite'),browserGraph=portableRecoveryGraph(browser.packet.protection,'browser'),mixed=mergeRecoveryGraphs(nativeGraph,browserGraph,'sqlite')
 expect(new Set(mixed.books.map(row=>row.storage))).toEqual(new Set(['sqlite','browser']));expect(mixed.originalIds.length).toBe(nativeGraph.originalIds.length+browserGraph.originalIds.length);expect(mergeRecoveryGraphs(mixed,mixed,'browser')).toEqual(mixed)
 const conflict=structuredClone(nativeGraph);conflict.snapshots[0].createdAt='2026-10-17T00:00:00Z';expect(()=>mergeRecoveryGraphs(mixed,conflict,'sqlite')).toThrow(/保護紀錄/)
 const changed=structuredClone(mixed);changed.books[0].storage=changed.books[0].storage==='sqlite'?'browser':'sqlite';expect(()=>validateRecoveryGraph(changed,'browser')).toThrow(/保護紀錄/)
})
it.each([
 ['unknown source',p=>{p.storage='other'}],['missing history',p=>{p.protection.originalIds.pop()}],['missing event',p=>{p.protection.events=[]}],['unsupported row encoding',p=>{p.book.settings[0].encoding='guess-number'}],['unknown collection',p=>{p.book.unrecognized=[]}],['partial cost book',p=>{delete p.book.stockCostOperations}],['diagnostic format',p=>{p.format='pos-recovery-diagnostics/v1'}],
])('rejects %s even with a new outer checksum',(_name,mutate)=>{const p=structuredClone(native.cost.packet);mutate(p);expect(()=>readPortableBackup(seal(p),'browser')).toThrow()})
it('recognizes legacy collection namespaces without guessing ambiguous or half-cost books',()=>{
 expect(readPortableBackup(native.reference.baseline,'browser').legacy).toBe(true)
 expect(readPortableBackup(browser.baseline,'sqlite').legacy).toBe(true)
 expect(()=>readPortableBackup({...native.reference.baseline,pos2_products:[]},'browser')).toThrow()
 const partial=structuredClone(native.cost.original);delete partial.stockCostOperations;expect(()=>readPortableBackup(partial,'browser')).toThrow()
})
it.each(['0','false','null','{}'])('refuses a typed store identity %s before conversion, while retaining typed zero in ordinary settings',value=>{
 const packet=structuredClone(browser.packet);packet.book.pos_business_settings.find(row=>row.key==='sharedStoreId').value=value;packet.storeId=value;expect(()=>readPortableBackup(seal(packet),'sqlite')).toThrow(/設定格式/);expect(()=>readPortableBackup(seal(packet),'browser')).toThrow(/設定格式/)
 expect(readPortableBackup(browser.packet,'sqlite').book.settings.find(row=>row.key==='browserZero').value).toBe('0')
})
