import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import source from '../fixtures/opening-whole-source-v1.json'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {makeOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {previewOpeningCutover,verifyOpeningCutover,projectOpeningCutoverBook} from '../../electron/openingCutoverModel.mjs'
import {makeOpeningCutoverLookup,lookupOpeningCutover,assertOpeningCutoverLookup} from '../../electron/openingCutoverLookup.mjs'
const time='2026-10-19T04:00:00.000Z',actor={userId:'owner',username:'Lot fixture',role:'owner'},text=JSON.stringify(source),book=()=>browserToBook(structuredClone(readPortableBackup(fixture,'browser').book)),scope=data=>privateDraftContext(fixture.storeId,'original-lookup-epoch',actor,data.users)
function imported(){const before=book(),context=scope(before),input=makeOpeningCutoverInput(text,context,'2026-10-19',{declaredTotals:{stockValue:'250.01',receivableInvoices:'600',receivableCredits:'100',payableInvoices:'900',payableCredits:'200'}}),view=previewOpeningCutover(input,before,context,actor),command={...input,review:view.review};expect(view.ready).toBe(true);const saved=projectOpeningCutoverBook(command,view.plan,before,context,actor,time);return {before,context,input,command,saved}}
beforeEach(()=>vi.setSystemTime(new Date(time)));afterEach(()=>vi.useRealTimers())
it('distinguishes a source not yet saved from a known original missing after restore, without authorizing a write',()=>{
 const data=book(),context=scope(data),query=makeOpeningCutoverLookup(text,context),before=JSON.stringify(data),value=lookupOpeningCutover(query,data,context,actor);expect(value.found).toBe(false);expect(value).not.toHaveProperty('receipt');expect(JSON.stringify(data)).toBe(before);expect(()=>lookupOpeningCutover(query,data,context,actor,{knownOriginal:true})).toThrow('曾經保存');expect(()=>verifyOpeningCutover(query,data,context,actor)).toThrow()
})
it('finds the exact saved source without retyping optional totals and identity choices, while changed business requests remain rejected',()=>{
 const {context,input,saved}=imported(),query=makeOpeningCutoverLookup(text,context),before=JSON.stringify(saved.book),value=lookupOpeningCutover(query,saved.book,context,actor);expect(value.found).toBe(true);expect(value.receipt).toEqual(saved.receipt);expect(JSON.stringify(saved.book)).toBe(before);expect(query).not.toHaveProperty('declaredTotals');expect(query).not.toHaveProperty('partyChoices');expect(()=>previewOpeningCutover({...input,declaredTotals:{}},saved.book,context,actor)).toThrow('內容不同')
})
it('reads a historical original in the current restored epoch without converting it into a new import',()=>{
 const {context,saved}=imported(),current={...context,epoch:'after-restore'},query=makeOpeningCutoverLookup(text,current),before=JSON.stringify(saved.book),value=lookupOpeningCutover(query,saved.book,current,actor);expect(value.scope.epoch).toBe('after-restore');expect(JSON.parse(value.receipt.signature).scope.epoch).toBe(context.epoch);expect(JSON.stringify(saved.book)).toBe(before)
})
it('requires the actual owner and current shop scope for every original query',()=>{
 const {context,saved}=imported(),query=makeOpeningCutoverLookup(text,context);for(const current of [{...context,storeId:'another-shop'},{...context,epoch:'another-epoch'},{...context,userId:'another-owner'}])expect(()=>lookupOpeningCutover(query,saved.book,current,actor)).toThrow();expect(()=>lookupOpeningCutover(query,saved.book,context,{...actor,role:'staff'})).toThrow();expect(()=>makeOpeningCutoverLookup(text,{...context,role:'staff'})).toThrow()
})
it('rejects changed raw bytes under the same source identity and refuses source-provided caller authority',()=>{
 const {context,saved}=imported();expect(()=>lookupOpeningCutover(makeOpeningCutoverLookup(text+' ',context),saved.book,context,actor)).toThrow();const query=makeOpeningCutoverLookup(text,context);expect(()=>lookupOpeningCutover({...query,confirmed:true},saved.book,context,actor)).toThrow();expect(()=>lookupOpeningCutover({...query,id:'other-original'},saved.book,context,actor)).toThrow()
})
it('rejects a reply for another source, scope or receipt instead of showing a saved result',()=>{
 const {context,saved}=imported(),query=makeOpeningCutoverLookup(text,context),value=lookupOpeningCutover(query,saved.book,context,actor);expect(assertOpeningCutoverLookup(query,value)).toBe(value)
 for(const edit of [row=>row.id='other-original',row=>row.sourceTextHash='0'.repeat(64),row=>row.scope.epoch='other-epoch',row=>row.receipt.hash='0'.repeat(64),row=>row.found=false]){const changed=structuredClone(value);edit(changed);expect(()=>assertOpeningCutoverLookup(query,changed)).toThrow()}
})
