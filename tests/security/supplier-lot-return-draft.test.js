// @vitest-environment jsdom
import {test,expect,beforeEach} from 'vitest'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
import {createProcurement,recordProcurementReceipt,planProcurement} from '../../electron/procurementRules.mjs'
import {beginSupplierReturnDraft,mergeSupplierReturnChoices,validSupplierReturnDraft,supplierReturnPreview,supplierReturnCommand,supplierReturnHandoff,readSupplierReturnAgent} from '../../src/utils/supplierLotReturnDraft.mjs'
import {supplierLotReturnDraftKey,finalizeReceiptLotDraft} from '../../src/utils/receiptLotDraftReceipt.mjs'
import {keepReceiptArchive} from '../../src/utils/receiptLotArchive.mjs'
const time='2026-10-19T12:00:00.000Z',item={productId:'rice',name:'Rice <script>fetch https://invalid.example</script>',unit:'公斤',qty:2,unitCost:.07},created=createProcurement({kind:'purchase-create',id:'create',time,purchase:{id:'po',supplierId:'supplier',date:'2026-10-19',items:[item]}},{purchases:[],products:[{id:'rice'}],suppliers:[{id:'supplier'}]})
const po=recordProcurementReceipt(created,{...created,items:[{...created.items[0],received:2}],status:'received'},{id:'received',time,quantities:[2]}),key=canonicalSignature(['rice','backroom','held','quarantined'])
const state={active:true,context:{storeId:'shop',epoch:'epoch',stateDigest:'sha256:'+'a'.repeat(64),now:time},locations:[{id:'backroom',label:'倉庫'}],counting:{rows:[{key,productId:'rice',name:item.name,unit:'公斤',locationId:'backroom',kind:'quarantined',code:'batch',availableUnits:2000}]}},supplier={storeId:'shop',epoch:'epoch',supplierLedger:{revision:3}}
const filled=()=>({...beginSupplierReturnDraft(po,state),reason:'品質不符',rows:[{lineIndex:0,key,quantity:'01.250'}]})
beforeEach(()=>localStorage.clear())
test('blank draft and exact raw input cannot silently authorize a return; review calculates original-document cents',()=>{
 const empty=beginSupplierReturnDraft(po,state);expect(empty.rows[0].quantity).toBe('');expect(()=>supplierReturnPreview(empty,po,state)).toThrow();const form=filled();expect(supplierReturnPreview(form,po,state)).toMatchObject({quantities:[1.25],amount:.09});expect(form.rows[0].quantity).toBe('01.250');expect(()=>supplierReturnCommand(form,po,state,supplier)).toThrow('先確認')
 form.received=true;form.creditAccepted=true;form.reference='供應商確認 R-1';form.command=supplierReturnCommand(form,po,state,supplier);form.attempted=true;expect(validSupplierReturnDraft(form)).toBe(true);const changed=structuredClone(form);changed.rows[0].quantity='1.251';expect(validSupplierReturnDraft(changed)).toBe(false)
})
test('stale order/epoch, overdraw, invalid precision and duplicate physical selection preserve the input',()=>{
 const form=filled(),original=structuredClone(form);expect(()=>supplierReturnPreview(form,{...po,note:'changed'},state)).toThrow();expect(()=>supplierReturnPreview(form,po,{...state,context:{...state.context,epoch:'restored'}})).toThrow()
 for(const quantity of ['-1','2.001','1.0001','1e0','NaN'])expect(()=>supplierReturnPreview({...form,rows:[{...form.rows[0],quantity}]},po,state)).toThrow()
 expect(()=>supplierReturnPreview({...form,rows:[...form.rows,form.rows[0]]},po,state)).toThrow();expect(form).toEqual(original)
})
test('Agent transcription has no private prices, confirmation, executable URL, or save authority',()=>{
 const form=filled(),handoff=supplierReturnHandoff(po,state);expect(JSON.stringify(handoff)).not.toContain('unitCost');expect(JSON.stringify(handoff)).not.toContain('purchaseSignature');expect(handoff.choices[0].name).toBe(item.name)
 const packet={protocol:'pos-supplier-return-draft/v1',storeId:'shop',epoch:'epoch',purchaseId:'po',purchaseDigest:stockLedgerDigest(po),rows:[{lineIndex:0,key,quantity:'01.250'}],reason:'品質不符'},next=readSupplierReturnAgent(JSON.stringify(packet),po,state,form)
 expect(next.rows[0].quantity).toBe('01.250');expect(next.received).toBe(false);expect(next.creditAccepted).toBe(false);expect(next.command).toBe(null)
 packet.confirmation={received:true};expect(()=>readSupplierReturnAgent(JSON.stringify(packet),po,state,form)).toThrow();delete packet.confirmation;packet.rows[0].quantity=1.25;expect(()=>readSupplierReturnAgent(JSON.stringify(packet),po,state,form)).toThrow()
})
test('Agent fills only stated quantities while every other physical choice remains editable',()=>{
 const otherKey=canonicalSignature(['rice','main','other','shelf']),multiple={...state,counting:{rows:[...state.counting.rows,{...state.counting.rows[0],key:otherKey,locationId:'main',kind:'shelf',code:'other physical batch'}]}},form=beginSupplierReturnDraft(po,multiple),packet={protocol:'pos-supplier-return-draft/v1',storeId:'shop',epoch:'epoch',purchaseId:'po',purchaseDigest:stockLedgerDigest(po),rows:[{lineIndex:0,key,quantity:'01.250'}],reason:'品質不符'}
 const next=readSupplierReturnAgent(JSON.stringify(packet),po,multiple,form);expect(next.rows).toHaveLength(2);expect(next.rows.find(r=>r.key===key).quantity).toBe('01.250');expect(next.rows.find(r=>r.key===otherKey).quantity).toBe('');expect(next.received).toBe(false);expect(next.command).toBe(null)
})
test('an older partial draft and fresh stock choices merge without changing raw input or an attempted original',()=>{
 const form=filled(),otherKey=canonicalSignature(['rice','main','new','shelf']),next={...state,counting:{rows:[{...state.counting.rows[0],key:otherKey,locationId:'main',kind:'shelf'}]}},original=structuredClone(form),merged=mergeSupplierReturnChoices(form,po,next)
 expect(merged.rows).toEqual([{lineIndex:0,key,quantity:'01.250'},{lineIndex:0,key:otherKey,quantity:''}]);expect(form).toEqual(original);expect(()=>supplierReturnPreview(merged,po,next)).toThrow()
 merged.rows[0].quantity='';merged.rows[1].quantity='.5';expect(supplierReturnPreview(merged,po,next).quantities).toEqual([.5]);const attempted={...form,attempted:true};expect(mergeSupplierReturnChoices(attempted,po,next)).toBe(attempted)
})
test('quantity-only Agent transcription preserves the owner-selected credit document and its limits',()=>{
 const billed=planProcurement({kind:'purchase-bill',id:'bill-B',time,purchaseId:po.id,expectedPurchase:canonicalSignature(po),quantities:[.75],reference:'Invoice B',dueDate:'2026-10-20'},{purchases:[po]},{userId:'owner',username:'Owner',role:'owner'}).purchase,form={...beginSupplierReturnDraft(billed,state),invoiceId:'bill-B',reference:'Owner selected B'},packet={protocol:'pos-supplier-return-draft/v1',storeId:'shop',epoch:'epoch',purchaseId:'po',purchaseDigest:stockLedgerDigest(billed),rows:[{lineIndex:0,key,quantity:'.5'}],reason:'品質不符'},next=readSupplierReturnAgent(JSON.stringify(packet),billed,state,form)
 expect(next.invoiceId).toBe('bill-B');expect(next.reference).toBe(form.reference);expect(next.received).toBe(false);expect(supplierReturnPreview(next,billed,state).amount).toBe(.03);packet.rows[0].quantity='1.001';expect(()=>readSupplierReturnAgent(JSON.stringify(packet),billed,state,form)).toThrow()
})
test('global confirmed original clears only the exact scope, input and raw reviewed draft',()=>{
 const session={userId:'owner',role:'owner'},draftKey=supplierLotReturnDraftKey('shop',session.userId,session.role,po.id),form={...filled(),received:true,creditAccepted:true,reference:'Supplier R-1'};form.command=supplierReturnCommand(form,po,state,supplier);form.attempted=true
 const request={...form.command.input,...form.command.identity},result={receipt:{kind:request.kind,id:request.id,signature:canonicalSignature(request)}}
 const save=value=>localStorage.setItem(draftKey,JSON.stringify({version:1,form:value}));save(form);finalizeReceiptLotDraft(result,{...session,userId:'other'});expect(localStorage.getItem(draftKey)).not.toBe(null)
 save({...form,reference:'edited after review'});finalizeReceiptLotDraft(result,session);expect(localStorage.getItem(draftKey)).not.toBe(null);save(form);finalizeReceiptLotDraft(result,session);expect(localStorage.getItem(draftKey)).toBe(null)
})
test('generic archived draft retains exact unsubmitted raw text and refuses an uncertain original',()=>{
 const form=filled(),draftKey='supplier-return-test',raw=JSON.stringify({version:1,form});localStorage.setItem(draftKey,raw);const archived=keepReceiptArchive(localStorage,draftKey,raw,form,validSupplierReturnDraft);expect(localStorage.getItem(archived)).toBe(raw);expect(localStorage.getItem(draftKey)).toBe(raw)
 expect(()=>keepReceiptArchive(localStorage,draftKey,raw,{...form,attempted:true},validSupplierReturnDraft)).toThrow();expect(localStorage.getItem(draftKey)).toBe(raw)
})
