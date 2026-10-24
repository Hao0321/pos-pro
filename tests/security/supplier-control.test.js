import {beforeEach,test,expect} from 'vitest'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {createProcurement} from '../../electron/procurementRules.mjs'
import {planInventory} from '../../electron/inventoryOperations.mjs'
import {makeReceiptReview} from '../../electron/receiptReview.mjs'
import {emptySupplierControl,deriveSupplierControl,projectSupplierControl,assertProcurementApproval,validateSupplierPaymentApproval,consumeSupplierPaymentApproval,procurementApprovalMaterial,purchaseMatchesApproval} from '../../electron/supplierControl.mjs'
import {supplierAppliedCents,supplierClaimKey} from '../../electron/supplierCredit.mjs'
const maker={userId:'maker',username:'Fixture Maker',role:'owner'},checker={userId:'checker',username:'Fixture Checker',role:'owner'},time='2026-10-16T02:00:00Z'
let control,data,index,po
function apply(action,request={},actor=maker,options={}){const event=deriveSupplierControl(action,{reviewed:true,...request},data,actor,control,{version:1,id:'control-'+(++index),time,date:'2026-10-16',revision:index,storeId:'store'},options);projectSupplierControl(control,event);return event}
const mode=value=>apply('policy-set',{mode:value,reason:'Owner reviewed setting'})
const enroll=()=>apply('purchase-enroll',{purchaseId:po.id,expectedPurchaseRevision:po.procurement.revision})
const approve=(actor=checker)=>apply('purchase-approve',{purchaseId:po.id,expectedPurchaseRevision:po.procurement.revision},actor)
const proposal=()=>apply('payment-propose',{supplierId:'supplier',amount:500,method:'bank',note:'Future goods, no transfer yet'})
beforeEach(()=>{index=0;control=emptySupplierControl();data={ownerIds:['maker','checker'],suppliers:[{id:'supplier',name:'Fixture Supplier',catalog:[{id:'catalog',name:'Rice'}]}],products:[{id:'p',name:'Rice',stock:0,cost:100,price:150}],purchases:[]};po=createProcurement({id:'create-op',kind:'purchase-create',time,purchase:{id:'po',supplierId:'supplier',date:'2026-10-16',items:[{productId:'p',name:'Rice',unit:'袋',qty:2,unitCost:100}],note:''}},data);data.purchases.push(po)})

test('simple mode adds no second-account step and internal registration stays tied to the real inventory request',()=>{
  expect(()=>assertProcurementApproval({kind:'receive',purchaseId:po.id},data,control)).not.toThrow()
  const event=apply('purchase-register',{id:'create-op',kind:'purchase-create'},maker,{registerPurchase:po});expect(event.inventoryOperationId).toBe('create-op');expect(event.requiredApproval).toBe(false);expect(control.purchases.get(po.id)).toMatchObject({status:'approved',approvedBy:null,submittedBy:maker})
  expect(()=>assertProcurementApproval({kind:'purchase-pay',purchaseId:po.id},data,control)).not.toThrow();expect(validateSupplierPaymentApproval({supplierId:'supplier',amount:500,method:'bank'},control)).toBe(null)
})
test('enabling dual mode requires two owner accounts, explicit review and an authenticated owner',()=>{
  data.ownerIds=['maker'];expect(()=>mode('dual-owner')).toThrow('另一個管理員');data.ownerIds=['maker','checker']
  expect(()=>apply('policy-set',{mode:'dual-owner',reason:'Reason',reviewed:false})).toThrow('核對')
  expect(()=>apply('policy-set',{mode:'dual-owner',reason:'Reason'},{...maker,role:'staff'})).toThrow('身份')
  expect(()=>apply('policy-set',{mode:'dual-owner',reason:''})).toThrow();expect(control.policy.mode).toBe('simple')
})
test('the maker cannot approve its own purchase and a different authenticated account opens the protected actions',()=>{
  mode('dual-owner');enroll();for(const kind of ['receive','receive-reviewed','purchase-bill','purchase-pay'])expect(()=>assertProcurementApproval({kind,purchaseId:po.id},data,control)).toThrow('未核准')
  expect(()=>approve(maker)).toThrow('自己的提案');expect(control.purchases.get(po.id).status).toBe('pending');approve();expect(control.purchases.get(po.id).approvedBy).toEqual(checker)
  for(const kind of ['receive','receive-reviewed','purchase-bill','purchase-pay'])expect(()=>assertProcurementApproval({kind,purchaseId:po.id},data,control)).not.toThrow()
})
test('switching back to simple mode never frees a previously submitted dual-account purchase',()=>{
  mode('dual-owner');enroll();mode('simple');expect(()=>assertProcurementApproval({kind:'receive',purchaseId:po.id},data,control)).toThrow('未核准');expect(()=>enroll()).toThrow('原採購');approve();expect(control.purchases.get(po.id).requiredApproval).toBe(true)
})
test('untracked historical purchases must be enrolled in dual mode and corrective/cancellation operations remain possible',()=>{
  mode('dual-owner');expect(()=>assertProcurementApproval({kind:'purchase-pay',purchaseId:po.id},data,control)).toThrow('先納入核准')
  for(const kind of ['purchase-cancel','purchase-reverse','purchase-return','purchase-refund','purchase-refund-reverse'])expect(()=>assertProcurementApproval({kind,purchaseId:po.id},data,control)).not.toThrow()
})
test('rejected or withdrawn purchases cannot be silently re-enrolled under a different mode',()=>{
  mode('dual-owner');enroll();apply('purchase-reject',{purchaseId:po.id,expectedPurchaseRevision:1,reason:'Wrong goods'},checker);mode('simple');expect(()=>assertProcurementApproval({kind:'purchase-bill',purchaseId:po.id},data,control)).toThrow('退回');expect(()=>enroll()).toThrow('原採購')
})
test('stale or changed purchase terms cannot borrow the old approval',()=>{
  mode('dual-owner');enroll();expect(()=>apply('purchase-approve',{purchaseId:po.id,expectedPurchaseRevision:0},checker)).toThrow('已更新');approve()
  const changed=structuredClone(po);changed.items[0].qty=3;changed.total=300;data.purchases=[changed];expect(()=>assertProcurementApproval({kind:'receive',purchaseId:po.id},data,control)).toThrow('原核准')
})
test('catalogue-to-stock linkage on actual receiving preserves the original approved catalogue terms',()=>{
  po=createProcurement({id:'catalog-create',kind:'purchase-create',time,purchase:{id:'catalog-po',supplierId:'supplier',date:'2026-10-16',items:[{catalogId:'catalog',name:'Rice',unit:'袋',qty:2,unitCost:100}]}},data);data.purchases=[po]
  const material=procurementApprovalMaterial(po),request={id:'catalog-receive',kind:'receive-reviewed',time,purchaseId:po.id,expectedPurchase:canonicalSignature(po),quantities:[1],newItems:[{lineIndex:0,priceCents:15000}]},reviewData={...data,storeId:'supplier-fixture',epoch:'supplier-epoch'};request.receiptReview=makeReceiptReview(request,reviewData)
  const received=planInventory(request,reviewData,maker).purchase
  expect(received.items[0].productId).toBeTruthy();expect(purchaseMatchesApproval(received,material)).toBe(true);received.items[0].catalogId='other';expect(purchaseMatchesApproval(received,material)).toBe(false)
})
test('a payment proposal and its review move no money, and the maker cannot approve it',()=>{
  mode('dual-owner');const event=proposal();expect(event).not.toHaveProperty('cashLogId');expect(control.proposals.get(event.id).status).toBe('pending');expect(()=>apply('payment-approve',{proposalId:event.id},maker)).toThrow('自己的提案')
  apply('payment-approve',{proposalId:event.id},checker);expect(validateSupplierPaymentApproval({proposalId:event.id,supplierId:'supplier',amount:500,method:'bank'},control).approvedBy).toEqual(checker)
})
test.each(['amount','supplierId','method'])('an approved payment cannot change %s or be used for a second payment',field=>{
  mode('dual-owner');const proposed=proposal();apply('payment-approve',{proposalId:proposed.id},checker)
  const request={proposalId:proposed.id,supplierId:'supplier',amount:500,method:'bank'},changed={...request,[field]:{amount:501,supplierId:'other',method:'cash'}[field]};expect(()=>validateSupplierPaymentApproval(changed,control)).toThrow('內容不同')
  consumeSupplierPaymentApproval(control,{id:'actual-original-payment',proposalId:proposed.id});expect(control.proposals.get(proposed.id)).toMatchObject({status:'paid',paymentId:'actual-original-payment'});expect(()=>validateSupplierPaymentApproval(request,control)).toThrow('已使用')
})
test('withdrawing an unused approved proposal keeps its review history and blocks later payment even in simple mode',()=>{
  mode('dual-owner');const proposed=proposal(),review=apply('payment-approve',{proposalId:proposed.id},checker);apply('payment-withdraw',{proposalId:proposed.id,reason:'Supplier cancelled delivery'});mode('simple')
  expect(control.proposals.get(proposed.id)).toMatchObject({status:'withdrawn',approvalId:review.id});expect(()=>validateSupplierPaymentApproval({proposalId:proposed.id,supplierId:'supplier',amount:500,method:'bank'},control)).toThrow('已使用')
})
test('supplier credit keys do not collide, preserve integer cents and reject negative or invalid projections',()=>{
  const entries=[{action:'allocate',items:[{purchaseId:'a:b',invoiceId:'c',amount:125.5}]},{action:'unallocate',items:[{purchaseId:'a:b',invoiceId:'c',amount:25.5}]}]
  expect(supplierAppliedCents(entries,'a:b','c')).toBe(10000);expect(supplierAppliedCents(entries,'a','b:c')).toBe(0);expect(supplierClaimKey('a:b','c')).not.toBe(supplierClaimKey('a','b:c'))
  expect(()=>supplierAppliedCents(new Map([[supplierClaimKey('a','b'),-1]]),'a','b')).toThrow();expect(()=>supplierAppliedCents([{action:'allocate',items:[{purchaseId:'a',invoiceId:'b',amount:.001}]}],'a','b')).toThrow()
})
