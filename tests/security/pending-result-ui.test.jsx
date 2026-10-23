// @vitest-environment jsdom
import React,{useState} from 'react'
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react'
import PendingTransactionNotice from '../../src/components/PendingTransactionNotice'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {confirmPendingOriginal,canSaveOriginalCheckout} from '../../src/utils/pendingOperationUi.mjs'
import {createCheckoutCoordinator,CHECKOUT_PROTOCOL} from '../../src/utils/checkoutCoordinator.mjs'

const copy=value=>structuredClone(value),idle={phase:'idle'},cashInput={shiftId:'shift',type:'in',amount:7,reason:'Original cash record',cashier:'Owner'}
function financial(id='cash-original'){return {kind:'cashlog',recoveryProtocol:'pos-recovery-v1',signature:JSON.stringify({kind:'cashlog',input:cashInput}),request:{...cashInput,id,time:new Date().toISOString()}}}
const putFinancial=p=>localStorage.setItem('pos_pending_financial_v1',JSON.stringify(p)),cashReceipt=request=>({success:true,cashLog:copy(request)})
let control
function FinancialHost({persist=async request=>cashReceipt(request),owner=true,view='dashboard'}){
 const [state,setState]=useState(()=>{const p=readPendingFinancial();return {phase:'uncertain',kind:p.kind,id:p.request.id,message:'Original technical message'}})
 const store={financialState:state,checkoutState:idle,retryFinancial:async()=>{const pending=readPendingFinancial();return executeFinancial(pending.kind,JSON.parse(pending.signature).input,persist,setState)},setView:vi.fn(),openPurchaseDocument:vi.fn()};control={store,setState}
 return <PendingTransactionNotice store={store} owner={owner} onRecovery={vi.fn()} view={view}/>
}
const plan=()=>({order:{id:'checkout-original',items:[{id:'p',name:'Original item',price:30,qty:2}],total:60,subtotal:60,discount:0,manualDiscount:0,balanceUsed:0,paid:100,change:40,payMethod:'cash',payments:[{method:'cash',amount:60}],pointsUsed:0,pointsEarned:0,memberId:null,shiftId:'shift',status:'completed',time:'2026-10-24T01:00:00.000Z'},stockUpdates:[{id:'p',delta:-2}],memberUpdate:null})
function checkoutFixture({missing=false,legacy=false}={}){
 const value=plan(),pending={version:1,protocol:CHECKOUT_PROTOCOL,...(!legacy?{recoveryProtocol:'pos-recovery-v1'}:{}),plan:copy(value)};localStorage.setItem('pos_pending_checkout_v1',JSON.stringify(pending));const reply=()=>({protocol:CHECKOUT_PROTOCOL,success:true,found:true,orderId:value.order.id,order:copy(value.order),products:[{id:'p',stock:8}],member:null}),persist=vi.fn(async()=>reply()),lookup=vi.fn(async()=>missing?{protocol:CHECKOUT_PROTOCOL,success:true,found:false,orderId:value.order.id}:reply()),apply=vi.fn()
 let stateChanged=()=>{};const coordinator=createCheckoutCoordinator({prepare:()=>copy(value),readPending:()=>JSON.parse(localStorage.getItem('pos_pending_checkout_v1')),writePending:p=>localStorage.setItem('pos_pending_checkout_v1',JSON.stringify(p)),clearPending:id=>{if(JSON.parse(localStorage.getItem('pos_pending_checkout_v1'))?.plan.order.id!==id)throw Error('pending changed');localStorage.removeItem('pos_pending_checkout_v1')},persist,lookup,apply,onState:state=>stateChanged(state),replayVerified:true});const initial=coordinator.restore()
 return {coordinator,initial,persist,lookup,apply,onState:fn=>{stateChanged=fn}}
}
function CheckoutHost({fixture}){const [state,setState]=useState(fixture.initial);fixture.onState(setState);const store={financialState:idle,checkoutState:state,reconcileCheckout:()=>fixture.coordinator.reconcile(),retryCheckout:()=>fixture.coordinator.retry(),setView:vi.fn()};control={store,setState};return <PendingTransactionNotice store={store} owner={false} view="dashboard"/>}
beforeEach(()=>{localStorage.clear();control=null})
afterEach(()=>{cleanup();vi.restoreAllMocks()})

test('one visible financial action resumes the exact original and acknowledges an early idle state without displaying raw IDs',async()=>{
 putFinancial(financial());const persist=vi.fn(async request=>({...cashReceipt(request),purchase:{id:'unrelated-purchase'}}));render(<FinancialHost persist={persist}/>);expect(document.querySelector('[data-original-details]').open).toBe(false);expect(document.querySelector('[data-original-id]').textContent).toBe('cash-original');fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('這筆已確認');expect(persist).toHaveBeenCalledTimes(1);expect(localStorage.getItem('pos_pending_financial_v1')).toBeNull();expect(screen.getByRole('button',{name:'繼續操作'})).toBeTruthy();expect(screen.queryByRole('button',{name:'查看單據'})).toBeNull()
})
test('double clicks while a financial result is pending cannot resubmit the original',async()=>{
 putFinancial(financial());let release;const persist=vi.fn(request=>new Promise(resolve=>{release=()=>resolve(cashReceipt(request))}));render(<FinancialHost persist={persist}/>);const button=screen.getByRole('button',{name:'核對上次結果'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(persist).toHaveBeenCalledTimes(1));expect(button.disabled).toBe(true);await act(async()=>release());await screen.findByText('這筆已確認');expect(persist).toHaveBeenCalledTimes(1)
})
test('a replaced financial journal never causes the old button to submit the new source',async()=>{
 putFinancial(financial());const persist=vi.fn();render(<FinancialHost persist={persist}/>);const replacement=financial('different-original');putFinancial(replacement);const raw=localStorage.getItem('pos_pending_financial_v1');fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await waitFor(()=>expect(document.querySelector('.pending-transaction-error')?.textContent).toBe('待核對的紀錄已變更，請重新核對。'));expect(persist).not.toHaveBeenCalled();expect(localStorage.getItem('pos_pending_financial_v1')).toBe(raw);expect(screen.queryByText('這筆已確認')).toBeNull()
})
test('a malformed financial acknowledgement retains its original source and cannot become success',async()=>{
 putFinancial(financial());const raw=localStorage.getItem('pos_pending_financial_v1');render(<FinancialHost persist={async()=>({success:true,cashLog:{id:'wrong'}})}/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('還沒確認完成，原資料已保留，請勿重做。');expect(localStorage.getItem('pos_pending_financial_v1')).toBe(raw);expect(screen.queryByText('這筆已確認')).toBeNull()
})
test('a late old result cannot acknowledge another currently displayed pending source',async()=>{
 const first=financial();putFinancial(first);let release;const retryFinancial=vi.fn(()=>new Promise(resolve=>{release=resolve})),store={financialState:{phase:'uncertain',kind:first.kind,id:first.request.id},checkoutState:idle,retryFinancial};const view=render(<PendingTransactionNotice store={store} owner/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));const next=financial('next-original');putFinancial(next);view.rerender(<PendingTransactionNotice store={{...store,financialState:{phase:'uncertain',kind:next.kind,id:next.request.id}}} owner/>);await act(async()=>release(cashReceipt(first.request)));expect(screen.queryByText('這筆已確認')).toBeNull();expect(document.querySelector('[data-original-id]').textContent).toBe('next-original');expect(JSON.parse(localStorage.getItem('pos_pending_financial_v1')).request.id).toBe('next-original')
})
test('checkout recovery performs only lookup and completes the verified original once',async()=>{
 const fixture=checkoutFixture();render(<CheckoutHost fixture={fixture}/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('這筆已確認');expect(fixture.lookup).toHaveBeenCalledTimes(1);expect(fixture.persist).not.toHaveBeenCalled();expect(fixture.apply).toHaveBeenCalledTimes(1);expect(localStorage.getItem('pos_pending_checkout_v1')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'繼續收銀'}));expect(control.store.setView).toHaveBeenCalledWith('pos')
})
test('a missing checkout lookup offers a separate explicit same-ID save and never writes automatically',async()=>{
 const fixture=checkoutFixture({missing:true});render(<CheckoutHost fixture={fixture}/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));const save=await screen.findByRole('button',{name:'繼續保存這張單'});expect(fixture.persist).not.toHaveBeenCalled();expect(localStorage.getItem('pos_pending_checkout_v1')).not.toBeNull();fireEvent.click(save);await screen.findByText('這筆已確認');expect(fixture.persist).toHaveBeenCalledTimes(1);expect(fixture.persist.mock.calls[0][0].order.id).toBe('checkout-original')
})
test('an unprotected old checkout source never receives a save action after a missing lookup',async()=>{
 const fixture=checkoutFixture({missing:true,legacy:true});render(<CheckoutHost fixture={fixture}/>);expect(canSaveOriginalCheckout('checkout-original')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('還沒確認完成，原資料已保留，請勿重做。');expect(screen.queryByRole('button',{name:'繼續保存這張單'})).toBeNull();expect(fixture.persist).not.toHaveBeenCalled();expect(localStorage.getItem('pos_pending_checkout_v1')).not.toBeNull()
})
test('a replaced checkout source is retained and neither looked up nor replayed by an old action',async()=>{
 const fixture=checkoutFixture(),original={family:'checkout',id:'checkout-original'};const replacement=JSON.parse(localStorage.getItem('pos_pending_checkout_v1'));replacement.plan.order.id='new-checkout';const raw=JSON.stringify(replacement);localStorage.setItem('pos_pending_checkout_v1',raw);await expect(confirmPendingOriginal(original,{reconcileCheckout:()=>fixture.coordinator.reconcile(),retryCheckout:()=>fixture.coordinator.retry()})).rejects.toMatchObject({code:'PENDING_ORIGINAL_CHANGED'});expect(fixture.persist).not.toHaveBeenCalled();expect(fixture.lookup).not.toHaveBeenCalled();expect(localStorage.getItem('pos_pending_checkout_v1')).toBe(raw)
})
test('new work navigation dismisses an already confirmed notice without changing the journal',async()=>{
 putFinancial(financial());const persist=vi.fn(async request=>cashReceipt(request)),view=render(<FinancialHost persist={persist} view="dashboard"/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('這筆已確認');view.rerender(<FinancialHost persist={persist} view="pos"/>);await waitFor(()=>expect(screen.queryByText('這筆已確認')).toBeNull());expect(persist).toHaveBeenCalledTimes(1)
})
test('blocked staff notices preserve the original ID without exposing owner recovery or replay',()=>{
 const retryFinancial=vi.fn(),onRecovery=vi.fn();render(<PendingTransactionNotice owner={false} onRecovery={onRecovery} store={{financialState:{phase:'blocked',id:'protected-original',kind:'cashlog'},checkoutState:idle,retryFinancial}}/>);expect(screen.getByText('請店主協助核對，原資料已保留。')).toBeTruthy();expect(document.querySelector('[data-recovery-open]')).toBeNull();expect(screen.queryByRole('button',{name:'核對上次結果'})).toBeNull();expect(retryFinancial).not.toHaveBeenCalled()
})
test('an undefined controller reply cannot produce a success acknowledgement',async()=>{
 putFinancial(financial());render(<PendingTransactionNotice owner store={{financialState:{phase:'uncertain',id:'cash-original',kind:'cashlog'},checkoutState:idle,retryFinancial:async()=>undefined}}/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('還沒確認完成，原資料已保留，請勿重做。');expect(screen.queryByText('這筆已確認')).toBeNull();expect(readPendingFinancial().request.id).toBe('cash-original')
})

test('an authoritative not-committed rejection is shown as not saved, not as an unknown or successful result',async()=>{
 putFinancial(financial());const persist=vi.fn(async()=>({success:false,committed:false,error:'Actual controlled rejection'}));render(<FinancialHost persist={persist}/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await screen.findByText('這次沒有保存');expect(screen.queryByText('這筆已確認')).toBeNull();expect(localStorage.getItem('pos_pending_financial_v1')).toBeNull();expect(persist).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'繼續操作'}));expect(persist).toHaveBeenCalledTimes(1)
})

test('a controlled checkout rejection is acknowledged as not saved and never announced as a completed payment',async()=>{
 const fixture=checkoutFixture({missing:true});fixture.persist.mockResolvedValue({protocol:CHECKOUT_PROTOCOL,success:false,committed:false,orderId:'checkout-original',error:'Actual checkout rejection'});render(<CheckoutHost fixture={fixture}/>);fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));fireEvent.click(await screen.findByRole('button',{name:'繼續保存這張單'}));await screen.findByText('這次沒有保存');expect(screen.queryByText('這筆已確認')).toBeNull();expect(localStorage.getItem('pos_pending_checkout_v1')).toBeNull();expect(fixture.apply).not.toHaveBeenCalled()
})

test('two pending sources check the cash receipt first and never silently submit or clear the other source',async()=>{
 const pending=financial();putFinancial(pending);const raw=localStorage.getItem('pos_pending_financial_v1'),fixture=checkoutFixture(),retryFinancial=vi.fn()
 function Both(){const [state,setState]=useState(fixture.initial);fixture.onState(setState);return <PendingTransactionNotice owner store={{financialState:{phase:'uncertain',kind:pending.kind,id:pending.request.id},checkoutState:state,reconcileCheckout:()=>fixture.coordinator.reconcile(),retryCheckout:()=>fixture.coordinator.retry(),retryFinancial}}/>}
 render(<Both/>);expect(screen.getByText('有 2 筆結果待核對')).toBeTruthy();expect(document.querySelector('[data-checkout-pending]')).not.toBeNull();fireEvent.click(screen.getByRole('button',{name:'核對上次結果'}));await waitFor(()=>expect(document.querySelector('[data-financial-pending]')).not.toBeNull());expect(fixture.lookup).toHaveBeenCalledTimes(1);expect(fixture.persist).not.toHaveBeenCalled();expect(retryFinancial).not.toHaveBeenCalled();expect(localStorage.getItem('pos_pending_financial_v1')).toBe(raw);expect(screen.queryByText('這筆已確認')).toBeNull()
})
