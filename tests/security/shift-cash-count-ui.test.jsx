// @vitest-environment jsdom
import React from 'react'
import {test,expect,vi,beforeEach,afterEach} from 'vitest'
import {render,screen,within,fireEvent,waitFor,cleanup,act} from '@testing-library/react'
import ShiftPage from '../../src/pages/ShiftPage'
const load=vi.hoisted(()=>({shifts:vi.fn(),cash:vi.fn()}))
vi.mock('../../src/utils/dataAccess',()=>({loadShifts:load.shifts,loadCashLog:load.cash}))
const session={userId:'owner',username:'Original owner',role:'owner'},shift={id:'original-shift',cashier:'Original owner',openTime:'2026-10-24T01:00:00.000Z',openCash:200,status:'open'}
const fixture=(open=true)=>({openShift:open?{...shift}:null,orders:[],topups:[],startShift:vi.fn(async(_cashier,amount)=>({id:'new-original',openCash:amount})),endShift:vi.fn(async amount=>({success:true,expected:200,diff:Math.round((amount-200)*100)/100})),logCash:vi.fn()})
async function dialog(kind='close'){fireEvent.click(await screen.findByRole('button',{name:kind==='close'?'交班':'開班'}));return screen.findByRole('dialog',{name:kind==='close'?'交班':'開班'})}
function quantity(amount,value){fireEvent.change(document.querySelector('[data-cash-quantity="'+amount+'"]'),{target:{value}})}
beforeEach(()=>{localStorage.clear();load.shifts.mockResolvedValue([shift]);load.cash.mockResolvedValue([])})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
test('opening cash starts unknown even when the old last-opening total exists, and zero must be explicitly selected',async()=>{
 localStorage.setItem('pos_last_open_cash','777');const store=fixture(false);render(<ShiftPage store={store} session={session}/>);const modal=await dialog('open'),input=within(modal).getByRole('textbox',{name:'開班零用金'}),save=within(modal).getByRole('button',{name:'確認開班'});expect(input.value).toBe('');expect(save.disabled).toBe(true);fireEvent.click(save);expect(store.startShift).not.toHaveBeenCalled();fireEvent.click(within(modal).getByRole('button',{name:'沒有現金（0 元）'}));expect(input.value).toBe('0');fireEvent.click(save);await screen.findByText('開班已保存。');expect(store.startShift).toHaveBeenCalledExactlyOnceWith(session.username,0,'')
})
test('closing never substitutes expected cash for a count; the actual zero records a real negative discrepancy',async()=>{
 const store=fixture();render(<ShiftPage store={store} session={session}/>);const modal=await dialog(),input=within(modal).getByRole('textbox',{name:'實際交班現金'}),save=within(modal).getByRole('button',{name:'確認交班'});expect(input.value).toBe('');expect(save.disabled).toBe(true);expect(modal.querySelector('[data-cash-difference]')).toBeNull();fireEvent.click(within(modal).getByRole('button',{name:'沒有現金（0 元）'}));expect(await within(modal).findByText('比帳上少 NT$ 200')).toBeTruthy();fireEvent.click(save);await waitFor(()=>expect(store.endShift).toHaveBeenCalledExactlyOnceWith(0,''))
})
test('note and coin quantities automatically fill the exact opening amount and cannot write before explicit confirmation',async()=>{
 const store=fixture(false);render(<ShiftPage store={store} session={session}/>);const modal=await dialog('open');fireEvent.click(within(modal).getByRole('button',{name:'幫我數現金'}));expect(within(modal).getByRole('button',{name:'確認開班'}).disabled).toBe(true);quantity(100,'2');quantity(10,'3');quantity(5,'1');quantity(1,'2');expect(modal.querySelector('[data-cash-count-total]').textContent).toContain('237');expect(store.startShift).not.toHaveBeenCalled();fireEvent.click(within(modal).getByRole('button',{name:'確認開班'}));await waitFor(()=>expect(store.startShift).toHaveBeenCalledExactlyOnceWith(session.username,237,''))
})
test('invalid quantities retain the entered source and prevent a cash save instead of falling back to expected money',async()=>{
 const store=fixture();render(<ShiftPage store={store} session={session}/>);const modal=await dialog();fireEvent.click(within(modal).getByRole('button',{name:'幫我數現金'}));quantity(100,'-1');expect(document.querySelector('[data-cash-quantity="100"]').value).toBe('-1');expect(within(modal).getByRole('button',{name:'確認交班'}).disabled).toBe(true);expect(within(modal).getByText('數量請填 0 或正整數。')).toBeTruthy();expect(store.endShift).not.toHaveBeenCalled()
})
test('the difference shown and submitted manual amount retain exact cents',async()=>{
 const store={...fixture(),openShift:{...shift,openCash:.1}};render(<ShiftPage store={store} session={session}/>);const modal=await dialog();fireEvent.change(within(modal).getByRole('textbox',{name:'實際交班現金'}),{target:{value:'0.3'}});expect(modal.querySelector('[data-cash-difference]').dataset.cashDifference).toBe('20');expect(within(modal).getByText('比帳上多 NT$ 0.2')).toBeTruthy();fireEvent.click(within(modal).getByRole('button',{name:'確認交班'}));await waitFor(()=>expect(store.endShift).toHaveBeenCalledExactlyOnceWith(.3,''))
})
test('closing and reopening the same live form retains the counted quantities without saving a shift',async()=>{
 const store=fixture();render(<ShiftPage store={store} session={session}/>);let modal=await dialog();fireEvent.click(within(modal).getByRole('button',{name:'幫我數現金'}));quantity(100,'2');fireEvent.click(within(modal).getByRole('button',{name:'關閉視窗'}));modal=await dialog();expect(document.querySelector('[data-cash-quantity="100"]').value).toBe('2');expect(store.endShift).not.toHaveBeenCalled()
})
test('an old close form cannot close a replacement shift or reuse the old drawer count for it',async()=>{
 const store=fixture(),view=render(<ShiftPage store={store} session={session}/>);let modal=await dialog();fireEvent.change(within(modal).getByRole('textbox',{name:'實際交班現金'}),{target:{value:'200'}});view.rerender(<ShiftPage store={{...store,openShift:{...shift,id:'replacement-shift',openCash:500}}} session={session}/>);modal=await screen.findByRole('dialog',{name:'交班'});await within(modal).findByText('這一班已變更，請關閉後重新點算。');const save=within(modal).getByRole('button',{name:'確認交班'});expect(save.disabled).toBe(true);fireEvent.click(save);expect(store.endShift).not.toHaveBeenCalled()
})
test('cash confirmation waits for the existing controller and repeated clicks cannot create two openings',async()=>{
 let release;const store=fixture(false);store.startShift=vi.fn((_cashier,amount)=>new Promise(resolve=>{release=()=>resolve({id:'saved-original',openCash:amount})}));render(<ShiftPage store={store} session={session}/>);const modal=await dialog('open');fireEvent.change(within(modal).getByRole('textbox',{name:'開班零用金'}),{target:{value:'237'}});const save=within(modal).getByRole('button',{name:'確認開班'});fireEvent.click(save);fireEvent.click(save);expect(store.startShift).toHaveBeenCalledTimes(1);expect(save.disabled).toBe(true);expect(screen.queryByText('開班已保存。')).toBeNull();await act(async()=>release());await screen.findByText('開班已保存。')
})
test('an unconfirmed opening keeps its entered source and does not announce success',async()=>{
 const store=fixture(false);store.startShift.mockResolvedValue(undefined);render(<ShiftPage store={store} session={session}/>);const modal=await dialog('open');fireEvent.change(within(modal).getByRole('textbox',{name:'開班零用金'}),{target:{value:'237'}});fireEvent.click(within(modal).getByRole('button',{name:'確認開班'}));await within(modal).findByText('開班保存尚未確認，請核對原班別。');expect(within(modal).getByRole('textbox',{name:'開班零用金'}).value).toBe('237');expect(screen.queryByText('開班已保存。')).toBeNull()
})
