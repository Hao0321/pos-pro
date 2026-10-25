// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {act,renderHook,waitFor,cleanup,render,screen,fireEvent} from '@testing-library/react'
import {useStore} from '../../src/store/useStore'
import * as access from '../../src/utils/dataAccess'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserPrivateDraftContext} from '../../src/utils/browserPrivateDrafts'
import {commitBrowserHeldCart,browserHeldJournal} from '../../src/utils/browserHeldCart'
import {commitBrowserSale} from '../../src/utils/browserSales'
import {HELD_CART_PROTOCOL,HELD_CART_JOURNAL,snapshotCart,heldDigest,readHeldJournal} from '../../electron/heldCart.mjs'
import {prepareCheckout} from '../../src/utils/checkoutSafety.mjs'
import HeldOrdersModal from '../../src/components/HeldOrdersModal'
import catalogue from '../../public/i18n/catalogue/held-cart.mjs'
import {tr} from '../../public/i18n/core.mjs'
const owner={userId:'owner',username:'店主',role:'owner'},staff={userId:'staff',username:'店員',role:'staff'},product={id:'p',name:'商品',price:30,stock:20,cost:10,unit:'個'},snapshot=()=>snapshotCart([({...product,qty:2})])
let map,fault
beforeEach(()=>{
 map=new Map();fault=null
 vi.stubGlobal('localStorage',{getItem:k=>map.get(k)??null,setItem:(k,v)=>{const mode=fault?.(k,String(v),'set');if(mode==='before')throw Error('fixture quota');map.set(k,String(v));if(mode==='after')throw Error('fixture reply lost')},removeItem:k=>{if(fault?.(k,'','remove'))throw Error('fixture cleanup');map.delete(k)}})
 vi.stubGlobal('navigator',{locks:{request:async(_name,options,cb)=>typeof options==='function'?options({}):cb({})}})
 writeRecords({pos_users:[{id:owner.userId,username:owner.username,role:owner.role},{id:staff.userId,username:staff.username,role:staff.role}],pos2_products:[product],pos2_members:[{id:'m',name:'會員',points:0,totalSpent:0,balance:0}],pos2_shifts:[{id:'s',status:'open'}]})
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function store(){const h=renderHook(()=>useStore(owner));await waitFor(()=>expect(h.result.current.cartWorkspace.ready).toBe(true));return h}
async function command(action='hold',current=snapshot(),row=null,actor=owner){return {protocol:HELD_CART_PROTOCOL,id:'held-op-'+crypto.randomUUID(),action,time:new Date().toISOString(),draftContext:await getBrowserPrivateDraftContext(actor),cartId:'cart-'+crypto.randomUUID(),current,label:'原標籤',heldId:'held-'+crypto.randomUUID(),expected:row?{id:row.id,digest:heldDigest(row)}:null}}
const held=()=>readRecords().data.pos2_held_orders
const unchanged=()=>{const data=structuredClone(readRecords().data);delete data.pos2_held_orders;delete data.pos_business_settings;return data}
test('the actual store restores cart price, fractional quantity, member, discount and raw label after unmount',async()=>{
 let h=await store();act(()=>{h.result.current.addToCart(product,.125);h.result.current.setActiveMember(h.result.current.members[0]);h.result.current.setManualDiscount(1);h.result.current.cartWorkspace.setHoldLabel('  桌 7  ')});h.unmount();h=await store();expect(h.result.current.cart[0]).toMatchObject({id:'p',price:30,qty:.125,unit:'個'});expect(h.result.current.activeMember.id).toBe('m');expect(h.result.current.manualDiscount).toBe(1);expect(h.result.current.cartWorkspace.value.holdLabel).toBe('  桌 7  ')
})
test('a rejected local cart write never replaces the last saved cart or mutates the store',async()=>{
 const h=await store();act(()=>h.result.current.addToCart(product));const before=JSON.stringify(readRecords());fault=(k)=>k.startsWith('pos_workspace_draft_v1:')?'before':null;act(()=>expect(()=>h.result.current.addToCart(product)).toThrow('fixture quota'));expect(h.result.current.cart[0].qty).toBe(1);expect(JSON.stringify(readRecords())).toBe(before)
})
test('lost hold reply keeps the fixed command and read-only recovery clears the cart without another hold',async()=>{
 const h=await store();act(()=>h.result.current.addToCart(product,2));const before=unchanged(),real=access.addHeldOrder;vi.spyOn(access,'lookupPrivateDraftOriginal').mockRejectedValueOnce(Error('fixture original offline'));vi.spyOn(access,'addHeldOrder').mockImplementationOnce(async(...args)=>{await real(...args);throw Error('fixture transport reply lost')});await act(async()=>expect(h.result.current.holdCart('顧客')).rejects.toThrow('reply lost'));expect(held()).toHaveLength(1);expect(h.result.current.cart).toHaveLength(1);const id=h.result.current.cartWorkspace.pending.id,raw=JSON.stringify(readRecords());await act(async()=>h.result.current.cartWorkspace.recover());expect(JSON.stringify(readRecords())).toBe(raw);expect(h.result.current.cart).toHaveLength(0);expect(h.result.current.cartWorkspace.pending).toBeNull();expect(browserHeldJournal(readRecords()).entries[0].id).toBe(id);expect(unchanged()).toEqual(before)
})
test('server claim followed by local quota preserves pending data and reload resolves the original exactly once',async()=>{
 let h=await store();act(()=>h.result.current.addToCart(product));fault=(key,value)=>{if(key.startsWith('pos_workspace_draft_v1:')){const state=JSON.parse(value).state;if(!state.pending&&!state.cart.length){return 'before'}}return null};await act(async()=>expect(h.result.current.holdCart('A')).rejects.toThrow('fixture quota'));expect(held()).toHaveLength(1);expect(h.result.current.cartWorkspace.pending).not.toBeNull();fault=null;h.unmount();h=await store();await waitFor(()=>expect(h.result.current.cartWorkspace.pending).toBeNull());expect(h.result.current.cart).toHaveLength(0);expect(held()).toHaveLength(1);expect(browserHeldJournal(readRecords()).entries).toHaveLength(1)
})
test('post-write storage exceptions confirm the actual committed hold instead of declaring rejection',async()=>{
 const request=await command();let once=true;fault=key=>key===RECORD_KEY&&once?(once=false,'after'):null;const result=await commitBrowserHeldCart(request,owner);expect(result.success).toBe(true);expect(held()).toHaveLength(1);expect(browserHeldJournal(readRecords()).entries).toHaveLength(1)
})
test('two clients claiming one held order produce one winner and preserve the loser cart',async()=>{
 const first=await command();expect((await commitBrowserHeldCart(first,owner)).success).toBe(true);const row=held()[0],a=await command('recall',snapshotCart([]),row),b=await command('recall',snapshotCart([{...product,qty:3}]),row,staff),before=unchanged();const results=await Promise.all([commitBrowserHeldCart(a,owner),commitBrowserHeldCart(b,staff)]);expect(results.map(r=>r.success).sort()).toEqual([false,true]);expect(held()).toHaveLength(0);expect(results[1].committed).toBe(false);expect(unchanged()).toEqual(before)
})
test('recalling with a working cart atomically preserves the outgoing cart and returns original price and member',async()=>{
 const h=await store();act(()=>{h.result.current.addToCart(product,2);h.result.current.setActiveMember(h.result.current.members[0]);h.result.current.setManualDiscount(1)});await act(async()=>h.result.current.holdCart('原單'));const row=held()[0];act(()=>h.result.current.addToCart(product,3));const before=unchanged();await act(async()=>h.result.current.recallHeld(row));expect(h.result.current.cart[0].qty).toBe(2);expect(h.result.current.activeMember.id).toBe('m');expect(h.result.current.manualDiscount).toBe(1);expect(held()).toHaveLength(1);expect(held()[0].cart[0].qty).toBe(3);expect(unchanged()).toEqual(before)
})
test('changed operation contents, a forged actor, stale epoch and changed held contents cannot mutate records',async()=>{
 const request=await command();expect((await commitBrowserHeldCart(request,owner)).success).toBe(true);const row=held()[0],changed=await command('recall',snapshotCart([]),row);const before=JSON.stringify(readRecords());for(const [input,actor] of [[{...request,label:'different'},owner],[request,staff],[{...changed,draftContext:{...changed.draftContext,epoch:'stale'}},owner],[{...changed,expected:{...changed.expected,digest:'0'.repeat(64)}},owner]]){expect((await commitBrowserHeldCart(input,actor)).success).toBe(false);expect(JSON.stringify(readRecords())).toBe(before)}
})
test('staff price or discount overrides, changed units and malformed historical carts are rejected before claim',async()=>{
 const base=await command('hold',snapshot(),null,staff);for(const input of [{...base,current:{...base.current,manualDiscount:1}},{...base,current:{...base.current,cart:[{...base.current.cart[0],price:1}]}},{...base,current:{...base.current,cart:[{...base.current.cart[0],unit:'公斤'}]}}]){const before=JSON.stringify(readRecords());expect((await commitBrowserHeldCart(input,staff)).success).toBe(false);expect(JSON.stringify(readRecords())).toBe(before)}
 const malformed={id:'broken',label:'broken',cart:[],createdAt:new Date().toISOString()};writeRecords({pos2_held_orders:[malformed]});const bad={...await command(),action:'recall',expected:{id:'broken',digest:'0'.repeat(64)}};const before=JSON.stringify(readRecords());expect((await commitBrowserHeldCart(bad,owner)).success).toBe(false);expect(JSON.stringify(readRecords())).toBe(before)
})
test('the receipt validator rejects changed incoming, outgoing or continuation even if request digest is retained',async()=>{
 const request=await command(),result=await commitBrowserHeldCart(request,owner),journal={version:1,entries:[result.receipt]};expect(readHeldJournal(journal).entries).toHaveLength(1);for(const change of [r=>r.outgoing.cart[0].qty=999,r=>r.output.cart=[{...product,qty:1}],r=>r.incoming=r.outgoing]){const altered=structuredClone(journal);change(altered.entries[0]);expect(()=>readHeldJournal(altered)).toThrow()}
})
test('generic settings APIs reject the private hold journal even when mixed with loyalty settings',async()=>{
 await expect(access.setSetting(HELD_CART_JOURNAL,'{}')).rejects.toThrow();await expect(access.setSettings({pointsEarnRate:1,[HELD_CART_JOURNAL]:'{}'})).rejects.toThrow();expect(browserHeldJournal(readRecords()).entries).toHaveLength(0)
})
test('a checkout whose global journal hits quota retains the exact local plan and resumes with that sale ID',async()=>{
 const h=await store();act(()=>h.result.current.addToCart(product,2));fault=key=>key==='pos_pending_checkout_v1'?'before':null;await act(async()=>expect(h.result.current.checkout('cash',100)).rejects.toThrow('fixture quota'));const id=h.result.current.cartWorkspace.value.checkout.plan.order.id;expect(readRecords().data.pos2_orders).toHaveLength(0);fault=null;await act(async()=>h.result.current.retryCheckout());expect(readRecords().data.pos2_orders[0].id).toBe(id);expect(h.result.current.cart).toHaveLength(0);expect(h.result.current.products[0].stock).toBe(18)
})
test('a paid sale followed by local acknowledgement quota is read back without reselling its restored cart',async()=>{
 let h=await store();act(()=>h.result.current.addToCart(product,2));let once=true;fault=(key,value)=>{if(once&&key.startsWith('pos_workspace_draft_v1:')&&JSON.parse(value).state.lastCompleted){once=false;return 'before'}return null};await act(async()=>expect(h.result.current.checkout('cash',100)).rejects.toThrow());const id=readRecords().data.pos2_orders[0].id;h.unmount();h=await store();expect(h.result.current.cart[0].qty).toBe(2);await act(async()=>h.result.current.reconcileCheckout());expect(h.result.current.cart).toHaveLength(0);expect(readRecords().data.pos2_orders).toHaveLength(1);expect(h.result.current.cartWorkspace.value.lastCompleted).toBe(id);h.unmount();h=await store();expect(h.result.current.cart).toHaveLength(0);expect(h.result.current.products[0].stock).toBe(18)
})
test('cleanup failure after a paid acknowledgement cannot resurrect the already completed cart',async()=>{
 const h=await store();act(()=>h.result.current.addToCart(product));fault=(key,_v,action)=>key==='pos_pending_checkout_v1'&&action==='remove';await act(async()=>expect(h.result.current.checkout('cash',30)).rejects.toThrow());expect(h.result.current.cart).toHaveLength(0);fault=null;await act(async()=>h.result.current.reconcileCheckout());expect(h.result.current.cart).toHaveLength(0);expect(readRecords().data.pos2_orders).toHaveLength(1)
})
test('a legacy paid receipt never erases an unrelated current cart',async()=>{
 const h=await store();act(()=>h.result.current.addToCart(product,2));const plan=prepareCheckout({cart:[{...product,qty:1}],products:[product],members:[],activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:0,openShift:{id:'s',status:'open'},payMethod:'cash',paid:30,opts:{},id:'legacy-sale'});expect((await commitBrowserSale(plan.order,owner)).success).toBe(true);localStorage.setItem('pos_pending_checkout_v1',JSON.stringify({version:1,protocol:'pos-checkout-v5',recoveryProtocol:'pos-recovery-v1',plan}));await act(async()=>h.result.current.reconcileCheckout());expect(h.result.current.cart[0].qty).toBe(2);expect(h.result.current.products[0].stock).toBe(19)
})
test('a post-write storage failure cannot report an already paid sale as uncommitted',async()=>{
 const h=await store();act(()=>h.result.current.addToCart(product));let once=true;fault=key=>key===RECORD_KEY&&once?(once=false,'after'):null;await act(async()=>h.result.current.checkout('cash',30));expect(h.result.current.cart).toHaveLength(0);expect(readRecords().data.pos2_orders).toHaveLength(1);expect(readRecords().data.pos2_products[0].stock).toBe(19)
})
test('held modal awaits actual recall, retains itself on failure, and asks explicitly before cancellation',async()=>{
 const row={id:'held',label:'桌 7',cart:[{...product,qty:1}],memberId:'',manualDiscount:2,createdAt:new Date().toISOString()},onClose=vi.fn(),onRecall=vi.fn().mockRejectedValue(Error('fixture refusal')),onRemove=vi.fn();render(<HeldOrdersModal heldOrders={[row]} members={[]} onRecall={onRecall} onRemove={onRemove} onClose={onClose} hasCart/>);fireEvent.click(screen.getByText('先暫放，再取回'));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('fixture refusal'));expect(onClose).not.toHaveBeenCalled();fireEvent.click(screen.getByText('其他操作'));fireEvent.click(screen.getByText('取消這張掛單'));expect(onRemove).not.toHaveBeenCalled();fireEvent.click(screen.getByText('確認取消掛單'));await waitFor(()=>expect(onRemove).toHaveBeenCalledWith('held'));expect(onClose).not.toHaveBeenCalled()
})
test('all new cart-flow messages have explicit English, Japanese and simplified Chinese translations',()=>{
 for(const [key,row] of Object.entries(catalogue))for(const [index,locale] of ['en','ja','zh-CN'].entries()){expect(row[index]).toBeTruthy();expect(tr(key,{},locale)).toBe(row[index])}
})
