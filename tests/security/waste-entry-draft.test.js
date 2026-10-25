import {describe,it,expect} from 'vitest'
import {wasteEntryQuantity,wasteEntryBasis,wasteEntryInput,wasteEntryOriginal,wasteEntryCore,admitWasteEntry} from '../../electron/wasteEntryDraft.mjs'
import {newWasteEntryDraft,validWasteEntryDraft,wasteEntryRequest} from '../../src/utils/wasteEntryDraft'
import {workspaceScope} from '../../src/utils/workspaceDraft'
import {normalizeStockBusinessInput} from '../../electron/browserStockPlan.mjs'
const actor={userId:'owner',username:'Owner',role:'owner'},context={protocol:'pos-private-draft-context/v1',storeId:'store',epoch:'epoch',userId:'owner',role:'owner'},product={id:'raw',name:'原料',unit:'公斤',stock:2,cost:20},facts={products:[product],wasteLog:[]}
function value(){return {...newWasteEntryDraft(product),quantity:' ０.１２５ ',submission:{id:'waste-entry-00000000-0000-4000-8000-000000000001',time:'2026-10-25T04:00:00Z',cashier:actor.username}}}
describe('explicit stock quantity',()=>{
 it.each([['.125',.125],['0.001',.001],[' ０.１２５ ',.125],['1,000.125',1000.125],['0002.5',2.5]])('accepts %s with exact stock precision',(raw,number)=>expect(wasteEntryQuantity(raw)).toBe(number))
 it.each(['','0','-1','1e3','0x10','0.0001','1.','1,00','1 000','Infinity'])('rejects ambiguous %s',raw=>expect(()=>wasteEntryQuantity(raw)).toThrow())
 it('keeps incomplete raw input in drafts but refuses to submit it',()=>{const draft={...newWasteEntryDraft(product),quantity:' 0. '};expect(validWasteEntryDraft(draft)).toBe(true);expect(validWasteEntryDraft({...draft,submission:value().submission})).toBe(false)})
 it('retains reasons and raw text until an explicit request is prepared',()=>{const draft=value(),request=wasteEntryRequest(draft,context);expect(request.qty).toBe(.125);expect(draft.quantity).toBe(' ０.１２５ ');expect(wasteEntryCore(request)).toEqual({id:request.id,time:request.time,productId:'raw',qty:.125,reason:'過期',cashier:'Owner'})})
})
describe('existing waste ledger admission and recovery',()=>{
 it('does not accept client cost or forged product names',()=>{const request=wasteEntryRequest(value(),context);for(const field of ['cost','productName','stock','balance'])expect(()=>admitWasteEntry({...request,[field]:999},context,facts,actor)).toThrow()})
 it('reviews renamed products and changed units, and refuses excess stock',()=>{const request=wasteEntryRequest(value(),context);for(const row of [{...product,name:'新商品'},{...product,unit:'袋'},{...product,stock:.1}])expect(()=>admitWasteEntry(request,context,{...facts,products:[row]},actor)).toThrow()})
 it('confirms an existing original before checking present stock or product metadata',()=>{const request=wasteEntryRequest(value(),context),row={...wasteEntryCore(request),productName:product.name,cost:20};expect(admitWasteEntry(request,context,{products:[],wasteLog:[row]},actor).original).toEqual(row);expect(()=>wasteEntryOriginal({...row,qty:1},[row])).toThrow(/內容不同/)})
 it.each(['storeId','epoch','userId','role'])('rejects changed %s authority',field=>{expect(()=>wasteEntryInput(wasteEntryRequest(value(),context),{...context,[field]:'other'},actor)).toThrow()})
 it('rejects a forged cashier and unsupported reason',()=>{const request=wasteEntryRequest(value(),context);expect(()=>wasteEntryInput({...request,cashier:'Other'},context,actor)).toThrow();expect(()=>wasteEntryInput({...request,reason:'arbitrary'},context,actor)).toThrow()})
 it('uses the original core for browser cost receipt signatures',()=>{const request=wasteEntryRequest(value(),context);expect(normalizeStockBusinessInput('addWaste',request)).toEqual(wasteEntryCore(request));expect(normalizeStockBusinessInput('addWaste',wasteEntryCore(request))).toEqual(wasteEntryCore(request))})
 it('keeps product basis and actor/store/epoch scoped drafts separate',()=>{expect(wasteEntryBasis(product)).toEqual({id:'raw',name:'原料',unit:'公斤'});const key=workspaceScope(context,'waste-entry').key;for(const field of ['storeId','epoch','userId','role'])expect(workspaceScope({...context,[field]:field==='role'?'staff':'different'},'waste-entry').key).not.toBe(key)})
})
