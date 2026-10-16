// @vitest-environment jsdom
import {afterEach,beforeEach,test,expect,vi} from 'vitest'
import {renderHook,act,waitFor,cleanup} from '@testing-library/react'
import {supplierDraftKey,supplierDraftRequest,matchingSupplierDraftEntry,finalizeSupplierDraft} from '../../src/utils/supplierDraftReceipt.mjs'
import useSupplierDraft,{validSupplierDraft} from '../../src/pages/suppliers/useSupplierDraft'
import {SUPPLIER_PAYMENT_DRAFT,readSupplierPaymentDraft,suggestSupplierAllocation,remainingSupplierAllocation,supplierAgentInstructions} from '../../src/utils/supplierLedgerUi.mjs'
import {tr} from '../../public/i18n/core.mjs'
const form=()=>({action:'pay',supplierId:'supplier',expectedSupplierName:'原供應商 <script>',storeId:'store',epoch:'epoch',ledgerRevision:0,date:'2026-10-16',amount:'125.50',method:'cash',reference:'original reference',note:'原備註 TWD <script>',reason:'',confirmed:false})
const actor={userId:'owner',username:'Fixture Owner',role:'owner'},state={storeId:'store'},entry=draft=>({id:draft.operationIdentity.id,storeId:'store',actor,input:{...supplierDraftRequest(draft),...draft.operationIdentity}})
let values,rejectSave
beforeEach(()=>{values=new Map();rejectSave=false;vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(rejectSave)throw Error('fixture draft quota');values.set(key,String(value))},removeItem:key=>values.delete(key)})})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
test('supplier drafts are scoped by store/account and synchronous pin freezes amount, original ID and shift',async()=>{
 const key=supplierDraftKey('store','owner');expect(key).not.toBe(supplierDraftKey('store:owner',''));expect(key).not.toBe(supplierDraftKey('store','other'))
 const hook=renderHook(()=>useSupplierDraft(state,actor));await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.setDraft(form()))
 let pinned;act(()=>{pinned=hook.result.current.saveNow({...form(),confirmed:true,operationIdentity:{id:'supplier-original',time:'2026-10-16T02:00:00Z'},submittedShiftId:'original-shift'})})
 expect(JSON.parse(values.get(key)).form).toEqual(pinned);expect(supplierDraftRequest(pinned,'later-shift')).toMatchObject({amount:125.5,shiftId:'original-shift',confirmed:true,reference:'original reference',note:'原備註 TWD <script>'})
 const original=entry(pinned);expect(matchingSupplierDraftEntry(pinned,[original])).toBe(original);expect(matchingSupplierDraftEntry({...pinned,amount:'125.51'},[original])).toBe(null)
 hook.unmount();const reopened=renderHook(()=>useSupplierDraft(state,actor));await waitFor(()=>expect(reopened.result.current.draft?.operationIdentity.id).toBe('supplier-original'));expect(reopened.result.current.draft.submittedShiftId).toBe('original-shift')
})
test('global completion clears only the matching original cached supplier draft after its page is gone',()=>{
 const pinned={...form(),confirmed:true,operationIdentity:{id:'original',time:'2026-10-16T02:00:00Z'},submittedShiftId:'shift'},key=supplierDraftKey('store','owner'),other=supplierDraftKey('store','other')
 values.set(key,JSON.stringify({version:1,form:pinned}));values.set(other,JSON.stringify({version:1,form:{...pinned,amount:'99'}}));const event=entry(pinned)
 expect(finalizeSupplierDraft({event},'other')).toBe('');expect(values.has(key)).toBe(false);expect(values.has(other)).toBe(true)
})
test('unreadable supplier draft remains archived rather than being overwritten by a blank form',async()=>{
 const key=supplierDraftKey('store','owner');values.set(key,'{ original corrupt bytes');const hook=renderHook(()=>useSupplierDraft(state,actor));await waitFor(()=>expect(hook.result.current.ready).toBe(true))
 expect([...values.values()]).toContain('{ original corrupt bytes');expect(hook.result.current.warning).toContain('原內容已保留');expect(hook.result.current.draft).toBe(null)
 act(()=>hook.result.current.saveNow(form()));expect(JSON.parse(values.get(key)).form).toEqual(form());expect([...values].some(([name,value])=>name.startsWith(key+':unreadable:')&&value==='{ original corrupt bytes')).toBe(true)
})
test('draft quota blocks synchronous pin and preserves the previously saved original intent',async()=>{
 const hook=renderHook(()=>useSupplierDraft(state,actor));await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.saveNow(form()));const before=values.get(supplierDraftKey('store','owner'));rejectSave=true
 expect(()=>hook.result.current.saveNow({...form(),amount:'999',operationIdentity:{id:'new',time:new Date().toISOString()}})).toThrow();expect(values.get(supplierDraftKey('store','owner'))).toBe(before)
})
test('supplier draft validation rejects injected actor/unknown actions/missing supplier identity but preserves unfinished fields',()=>{
 expect(validSupplierDraft(form())).toBe(true);expect(validSupplierDraft({...form(),amount:''})).toBe(true)
 for(const value of [{...form(),actor},{...form(),action:'purchase-register'},{...form(),expectedSupplierName:undefined},{...form(),ledgerRevision:-1},{...form(),operationIdentity:{id:'bad:colon',time:new Date().toISOString()}}])expect(validSupplierDraft(value)).toBe(false)
})
test('proposals retain Agent references and approvals carry no money confirmation or caller-selected actor',()=>{
 const proposal=supplierDraftRequest({...form(),action:'payment-propose',confirmed:true},'shift');expect(proposal).toMatchObject({amount:125.5,reference:'original reference',reviewed:true});expect(proposal).not.toHaveProperty('confirmed');expect(proposal).not.toHaveProperty('shiftId')
 const approval=supplierDraftRequest({...form(),action:'payment-approve',proposalId:'original-proposal',confirmed:true});expect(approval).toMatchObject({proposalId:'original-proposal',reviewed:true});expect(approval).not.toHaveProperty('amount');expect(approval).not.toHaveProperty('supplierId');expect(approval).not.toHaveProperty('actor')
})
test('Agent payment drafts remain data-only and validate store, original supplier, precise money, timestamp and duplicate IDs',()=>{
 const now=Date.now(),draft={protocol:SUPPLIER_PAYMENT_DRAFT,id:'agent-payment',issuedAt:new Date(now).toISOString(),storeId:'store',supplierId:'supplier',amount:25.5,method:'bank',reference:'invoice original',note:'Keep TWD <script>'},options={storeId:'store',suppliers:[{id:'supplier',name:'Same name'},{id:'other',name:'Same name'}],entries:[],now}
 expect(readSupplierPaymentDraft(JSON.stringify(draft),options)).toEqual(draft)
 for(const changed of [{confirmed:true},{actor},{approvedBy:'owner'},{currency:'USD'},{supplierId:'unknown'},{storeId:'elsewhere'},{amount:0},{amount:.001},{method:'card'},{issuedAt:'2026-02-30T01:00:00Z'},{issuedAt:new Date(now-86400001).toISOString()},{issuedAt:new Date(now+300001).toISOString()},{id:'bad:colon'}])expect(()=>readSupplierPaymentDraft(JSON.stringify({...draft,...changed}),options)).toThrow()
 expect(()=>readSupplierPaymentDraft(JSON.stringify(draft),{...options,entries:[{id:draft.id}]})).toThrow('已有紀錄');expect(()=>readSupplierPaymentDraft(' '.repeat(16385),options)).toThrow('過大')
})
test('oldest-due suggestions cap total in integer cents and partial release always refers to its own original allocation',()=>{
 const claims=[{purchaseId:'a:b',invoiceId:'c',expectedRevision:3,owed:100.01},{purchaseId:'a',invoiceId:'b:c',expectedRevision:4,owed:100}]
 expect(suggestSupplierAllocation({available:125.5},claims)).toEqual([{purchaseId:'a:b',invoiceId:'c',expectedRevision:3,amount:100.01},{purchaseId:'a',invoiceId:'b:c',expectedRevision:4,amount:25.49}])
 const original={id:'alloc',items:suggestSupplierAllocation({available:125.5},claims)},entries=[{action:'unallocate',allocationId:'alloc',items:[{purchaseId:'a:b',invoiceId:'c',amount:40.01}]},{action:'unallocate',allocationId:'other',items:[{purchaseId:'a',invoiceId:'b:c',amount:25.49}]}]
 expect(remainingSupplierAllocation(original,entries).map(row=>row.amount)).toEqual([60,25.49]);expect(suggestSupplierAllocation({available:1000},Array.from({length:101},(_,i)=>({purchaseId:'p'+i,invoiceId:'b'+i,expectedRevision:3,owed:1})))).toHaveLength(100)
})
test('Agent instructions use the selected language while preserving supplier names/IDs and excluding credentials and ledger balances',()=>{
 const raw=supplierAgentInstructions({storeId:'store',suppliers:[{id:'supplier',name:'中文 <script>',password:'private'}],supplierLedger:{balance:999}},{translate:source=>tr(source,{},'en')})
 expect(raw).toContain('Prepare a supplier advance draft');expect(raw).toContain('中文 <script>');expect(raw).toContain('pos-supplier-payment-draft/v1');expect(raw).not.toContain('private');expect(raw).not.toContain('999')
})
