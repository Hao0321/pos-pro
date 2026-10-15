// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {renderHook,act,waitFor,cleanup} from '@testing-library/react'
import useCustomerDraft,{validCustomerDraft} from '../../src/pages/customers/useCustomerDraft'
import {customerDraftKey,customerDraftRequest,matchingCustomerDraftEntry,finalizeCustomerDraft} from '../../src/utils/customerDraftReceipt.mjs'
const session={role:'owner',userId:'owner'},context=id=>({storeId:id,epoch:'epoch',customerLedger:{revision:1}})
const form=()=>({action:'receive',customerId:'buyer',storeId:'store',epoch:'epoch',ledgerRevision:1,date:'2026-10-16',amount:'500',method:'cash',reference:'receipt-ref',note:'原文 <script>',reason:'',confirmed:true})
const identity={id:'original-customer-receipt',time:'2026-10-16T01:00:00Z'}
beforeEach(()=>localStorage.clear())
afterEach(()=>{cleanup();vi.restoreAllMocks()})
test('changing store never writes an old customer draft into the new store scope',async()=>{
  const spy=vi.spyOn(Storage.prototype,'setItem'),hook=renderHook(({store})=>useCustomerDraft(context(store),session),{initialProps:{store:'store'}})
  await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.setDraft(form()));await waitFor(()=>expect(JSON.parse(localStorage.getItem(customerDraftKey('store','owner'))).form.customerId).toBe('buyer'))
  hook.rerender({store:'other-store'});await waitFor(()=>expect(hook.result.current.ready).toBe(true));expect(hook.result.current.draft).toBe(null)
  for(const [key,raw]of spy.mock.calls.filter(([key])=>key===customerDraftKey('other-store','owner')))expect(JSON.parse(raw).form?.storeId).not.toBe('store')
  expect(JSON.parse(localStorage.getItem(customerDraftKey('store','owner'))).form.storeId).toBe('store')
})
test('a submitted draft is durable synchronously before its money request is sent',async()=>{
  const hook=renderHook(()=>useCustomerDraft(context('store'),session));await waitFor(()=>expect(hook.result.current.ready).toBe(true))
  const pinned={...form(),operationIdentity:identity,submittedShiftId:'original-shift'}
  act(()=>{hook.result.current.saveNow(pinned);expect(JSON.parse(localStorage.getItem(customerDraftKey('store','owner'))).form.operationIdentity).toEqual(identity)})
  act(()=>window.dispatchEvent(new Event('pagehide')));expect(JSON.parse(localStorage.getItem(customerDraftKey('store','owner'))).form.submittedShiftId).toBe('original-shift')
})
test('an unreadable old draft is preserved before a new valid submission can replace its key',async()=>{
  const key=customerDraftKey('store','owner'),broken='{"version":1,"form":{"action":"receive","amount":{"bad":true}}}';localStorage.setItem(key,broken)
  const hook=renderHook(()=>useCustomerDraft(context('store'),session));await waitFor(()=>expect(hook.result.current.ready).toBe(true));expect(hook.result.current.draft).toBe(null);expect(hook.result.current.warning).toContain('原內容已保留');expect(localStorage.getItem(key)).toBe(broken)
  act(()=>hook.result.current.saveNow({...form(),operationIdentity:identity,submittedShiftId:'shift'}))
  const archived=Object.keys(localStorage).find(k=>k.startsWith(key+':unreadable:'));expect(archived).toBeTruthy();expect(localStorage.getItem(archived)).toBe(broken)
})
test('invalid nested customer profile data is never treated as a usable saved draft',()=>{
  for(const changed of [{action:'customer-create',customer:{id:'buyer',name:{html:'unsafe'}}},{items:[{documentId:'d',deliveryId:'e',expectedRevision:1,amount:{bad:1}}]},{operationIdentity:{id:'bad:id',time:identity.time}},{ledgerRevision:-1}])expect(validCustomerDraft({...form(),...changed})).toBe(false)
})
test('a confirmed original receipt finalizes its exact draft even outside the customer page',()=>{
  const pinned={...form(),operationIdentity:identity,submittedShiftId:'old-shift'},event={id:identity.id,storeId:'store',actor:{userId:'owner'},input:{...customerDraftRequest(pinned),...identity}}
  expect(event.input.shiftId).toBe('old-shift');expect(matchingCustomerDraftEntry(pinned,[event])).toBe(event)
  const key=customerDraftKey('store','owner');localStorage.setItem(key,JSON.stringify({version:1,form:pinned}));expect(finalizeCustomerDraft({event},'owner')).toBe('');expect(localStorage.getItem(key)).toBe(null)
})
test('same IDs with different money do not clear the saved intent and missing originals remain pinned',()=>{
  const pinned={...form(),operationIdentity:identity,submittedShiftId:'shift'},event={id:identity.id,storeId:'store',actor:{userId:'owner'},input:{...customerDraftRequest(pinned),...identity,amount:600}},key=customerDraftKey('store','owner'),raw=JSON.stringify({version:1,form:pinned});localStorage.setItem(key,raw)
  expect(matchingCustomerDraftEntry(pinned,[])).toBe(null);expect(matchingCustomerDraftEntry(pinned,[event])).toBe(null);finalizeCustomerDraft({event},'owner');expect(localStorage.getItem(key)).toBe(raw)
})
