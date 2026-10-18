// @vitest-environment jsdom
import {test,expect,beforeEach} from 'vitest'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {beginPurchaseDraft,validPurchaseDraft,purchaseChoices,purchaseRow,purchaseDraftPreview,purchaseDraftCommand,purchaseAgentHandoff,readPurchaseAgent,purchaseDraftKey,previousPurchaseRow} from '../../src/utils/purchaseDraft.mjs'
import {finalizePurchaseDraft} from '../../src/utils/purchaseDraftReceipt.mjs'
import {keepDraftArchive} from '../../src/utils/draftArchive.mjs'
const scope={storeId:'shop',epoch:'epoch',userId:'owner',role:'owner'},data={products:[{id:'p',name:'Rice <script>fetch https://invalid.example</script>',unit:'公斤',cost:99},{id:'b',name:'Bottle',unit:'瓶'}],suppliers:[{id:'supplier',name:'Supplier',catalog:[]}]},state={...scope,supplierLedger:{revision:0}},choices=purchaseChoices(data,'supplier')
const form=()=>({...beginPurchaseDraft(scope),supplierId:'supplier',note:'Owner note',items:[{...purchaseRow(choices[0]),mode:'pack',purchasedUnit:'袋',baseQuantityPerUnit:'03.0',quantity:'01.000',unitPrice:'0100.00'}]})
const agent=(f,items)=>{const h=purchaseAgentHandoff(f,scope,data);return JSON.stringify({protocol:'pos-purchase-units-draft/v1',scope,supplierId:f.supplierId,catalogueDigest:h.catalogueDigest,items})}
beforeEach(()=>localStorage.clear())
test('raw package facts create exact original money and preserve actual SKU base units',()=>{
 const f=form(),preview=purchaseDraftPreview(f,scope,data);expect(validPurchaseDraft(f)).toBe(true);expect(preview.total).toBe(100);expect(preview.purchase.items[0]).toMatchObject({unit:'公斤',qty:3,costBasis:{purchasedQuantity:'01.000',purchasedUnitPrice:'0100.00'}});expect(f.items[0].quantity).toBe('01.000')
 const basic={...f,items:[{...f.items[0],mode:'base',quantity:'.5',unitPrice:'.07'}]};expect(purchaseDraftPreview(basic,scope,data)).toMatchObject({total:.04,purchase:{items:[{unit:'公斤',qty:.5}]}})
})
test('changed source, unit, scope and invalid precision preserve the original raw draft',()=>{
 const f=form(),original=structuredClone(f);expect(()=>purchaseDraftPreview(f,{...scope,epoch:'restored'},data)).toThrow();expect(()=>purchaseDraftPreview(f,scope,{...data,products:data.products.map(p=>p.id==='p'?{...p,unit:'瓶'}:p)})).toThrow();expect(()=>purchaseDraftPreview({...f,items:[{...f.items[0],quantity:'1e0'}]},scope,data)).toThrow();expect(()=>purchaseDraftPreview({...f,items:[{...f.items[0],baseQuantityPerUnit:'.0001'}]},scope,data)).toThrow();expect(f).toEqual(original)
})
test('sparse Agent input retains owner date, note, prices and every other selected row, without confirmation',()=>{
 const f={...form(),date:'2026-10-18',items:[...form().items,{...purchaseRow(choices[1]),quantity:'2',unitPrice:'9.99'}]},text=agent(f,[{key:choices[0].key,quantity:'02.000'}]),next=readPurchaseAgent(text,f,scope,data)
 expect(next.date).toBe(f.date);expect(next.note).toBe(f.note);expect(next.items[0].unitPrice).toBe('0100.00');expect(next.items[0].baseQuantityPerUnit).toBe('03.0');expect(next.items[1]).toEqual(f.items[1]);expect(next.items[0].quantity).toBe('02.000');expect(next.command).toBe(null);expect(next.attempted).toBe(false);expect(purchaseDraftPreview(next,scope,data).total).toBe(219.98)
 const blankPrice=readPurchaseAgent(agent(f,[{key:choices[0].key,quantity:'1',unitPrice:''}]),f,scope,data);expect(blankPrice.items[0].unitPrice).toBe('0100.00')
})
test('Agent cannot supply consent, change owner context or base unit, guess fields, or turn input into code',()=>{
 const f=form(),text=agent(f,[{key:choices[0].key,quantity:'1'}]),packet=JSON.parse(text);expect(JSON.stringify(purchaseAgentHandoff(f,scope,data))).not.toContain('unitCost');expect(purchaseAgentHandoff(f,scope,data).choices[0].name).toContain('<script>')
 for(const mutate of [p=>p.confirmed=true,p=>p.scope.userId='other',p=>p.items[0].quantity=1,p=>p.items[0].baseUnit='瓶',p=>p.items[0].priceUrl='https://invalid.example',p=>p.items[0].quantity='1e2']){const bad=structuredClone(packet);mutate(bad);expect(()=>readPurchaseAgent(JSON.stringify(bad),f,scope,data)).toThrow()}expect(f.items[0].quantity).toBe('01.000')
})
test('stored original command must match raw input; global recovery clears only the exact owner and acknowledged draft',()=>{
 const f=form();f.command=purchaseDraftCommand(f,scope,data,state);f.attempted=true;expect(validPurchaseDraft(f)).toBe(true);const key=purchaseDraftKey(scope.storeId,scope.userId,scope.role),request={...f.command.input,...f.command.identity},result={purchase:{id:f.id},receipt:{kind:request.kind,id:request.id,signature:canonicalSignature(request)}}
 const tampered=structuredClone(f);tampered.command.input.purchase.items[0].costBasis.purchasedUnitPrice='999.99';expect(validPurchaseDraft(tampered)).toBe(false)
 for(const mutate of [c=>c.input.unitReview.confirmed=false,c=>c.input.unitReview.sourceSignature='changed',c=>c.input.extra=true,c=>c.identity.actor='other']){const changed=structuredClone(f);mutate(changed.command);expect(validPurchaseDraft(changed)).toBe(false)}
 const save=value=>localStorage.setItem(key,JSON.stringify({version:1,form:value}));save(f);finalizePurchaseDraft(result,{...scope,userId:'other'});expect(localStorage.getItem(key)).not.toBe(null);save({...f,note:'Owner edited after review'});finalizePurchaseDraft(result,scope);expect(localStorage.getItem(key)).not.toBe(null);save(f);finalizePurchaseDraft(result,scope);expect(localStorage.getItem(key)).toBe(null)
})
test('previous package terms keep original unit price, and archiving keeps raw bytes while uncertain originals remain held',()=>{
 const f=form(),p=purchaseDraftPreview(f,scope,data).purchase,last=previousPurchaseRow(choices[0],[{...p,date:'2026-10-18'}],'supplier');expect(last.unitPrice).toBe('0100.00');expect(last.baseQuantityPerUnit).toBe('03.0');expect(last.quantity).toBe('')
 const identity={...p,items:[{...p.items[0],qty:1,costBasis:{...p.items[0].costBasis,purchasedUnit:'公斤',purchasedQuantity:'1',baseQuantityPerUnit:'1.000'}}]};expect(previousPurchaseRow(choices[0],[identity],'supplier').mode).toBe('base')
 const key='unit-draft',raw=JSON.stringify({version:1,form:f});localStorage.setItem(key,raw);const archived=keepDraftArchive(localStorage,key,raw,f,validPurchaseDraft,4000000);expect(localStorage.getItem(archived)).toBe(raw);expect(localStorage.getItem(key)).toBe(raw);expect(()=>keepDraftArchive(localStorage,key,raw,{...f,attempted:true},validPurchaseDraft,4000000)).toThrow()
})
