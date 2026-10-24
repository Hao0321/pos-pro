// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {render,fireEvent,waitFor,cleanup} from '@testing-library/react'
import fixture from '../fixtures/stock-setup-native-v1.json'
import StockSetupPage from '../../src/pages/StockSetupPage'
import {RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {bookToBrowser,browserToBook} from '../../electron/recoveryRules.mjs'
import {getBrowserStockSetupState,previewBrowserStockSetup,commitBrowserStockSetup} from '../../src/utils/browserStockSetup'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {stockSetupDraftKey,readStockSetupDraft,writeStockSetupDraft,clearStockSetupDraft} from '../../src/utils/stockSetupDraft'
const owner=fixture.owner,scope=state=>{const {now,...context}=state.context;return context}
beforeEach(()=>{localStorage.clear();vi.stubEnv('VITE_POS_STOCK_SETUP','isolated-fixture');Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name,action)=>action()}});const book=structuredClone(fixture.book);book.settings=book.settings.map(row=>({...row,value:['stockCostVersionFence','stockCostBookHead'].includes(row.key)?row.value:JSON.stringify(row.value)}));localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:fixture.preview.epoch,data:bookToBrowser(book)}))})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllEnvs()})
const click=text=>{const button=[...document.querySelectorAll('button')].find(row=>row.textContent===text);expect(button).toBeTruthy();fireEvent.click(button)}
const store=()=>({setView:vi.fn(),stockSetupEnabled:true,commitStockSetup:input=>executeFinancial('stock-cost',input,request=>commitBrowserStockSetup(request,owner)),retryFinancial:()=>{const pending=readPendingFinancial();return executeFinancial('stock-cost',JSON.parse(pending.signature).input,request=>commitBrowserStockSetup(request,owner))}})
async function open(){render(<StockSetupPage store={store()} session={owner} loadState={getBrowserStockSetupState} previewOperation={previewBrowserStockSetup}/>);await waitFor(()=>expect(document.body.textContent).toContain('庫存對了，下一步'));click('庫存對了，下一步')}
it('fills exact fractional cost through an actual FileReader Agent draft and saves the reviewed original once',async()=>{
  await open();const current=await getBrowserStockSetupState(owner),row=current.rows.find(item=>item.stage==='consumed'),reply={protocol:'pos-stock-opening-draft/v1',context:scope(current),entries:[{key:row.key,unit:row.unit,mode:'unit',raw:'1.16'}]}
  fireEvent.change(document.querySelector('[data-setup-agent-file]'),{target:{files:[new File([JSON.stringify(reply)],'cost.json',{type:'application/json'})]}})
  await waitFor(()=>expect(document.body.textContent).toContain('成本草稿已帶入'))
  const card=[...document.querySelectorAll('[data-setup-key]')].find(element=>element.dataset.setupKey===row.key)
  expect(card.querySelector('input').value).toBe('1.16');expect(card.querySelector('[data-setup-line-total]').textContent).toContain('0.15')
  click('帶入目前成本');click('看成本結果');await waitFor(()=>expect(document.body.textContent).toContain('3 看結果，再確認'));expect(document.querySelector('[data-setup-summary] details').open).toBe(false)
  expect(readRecords().data.pos_stock_cost_entries).toHaveLength(0);fireEvent.click(document.querySelector('.setup-confirm input'));click('確認保存成本');await waitFor(()=>expect(document.querySelector('h1').textContent).toBe('成本已保存'))
  expect(readPendingFinancial()).toBeNull();expect(readRecords().data.pos_stock_cost_entries).toHaveLength(1);expect(readRecords().data.pos2_orders).toEqual(fixture.book.orders)
})
it('retains the original financial command after a lost reply, then resumes while new activation is disabled',async()=>{
  const base=store(),ports={...base,commitStockSetup:input=>executeFinancial('stock-cost',input,async request=>{const saved=await commitBrowserStockSetup(request,owner);expect(saved.success,saved.error).toBe(true);throw Error('injected reply loss')})}
  const mounted=render(<StockSetupPage store={ports} session={owner} loadState={getBrowserStockSetupState} previewOperation={previewBrowserStockSetup}/>);await waitFor(()=>expect(document.body.textContent).toContain('庫存對了，下一步'));click('庫存對了，下一步');click('看成本結果');await waitFor(()=>expect(document.querySelector('.setup-confirm input')).toBeTruthy());fireEvent.click(document.querySelector('.setup-confirm input'));click('確認保存成本');await waitFor(()=>expect(document.querySelector('h1').textContent).toBe('核對上次成本設定'))
  const original=readPendingFinancial(),raw=localStorage.getItem(RECORD_KEY);mounted.unmount();vi.stubEnv('VITE_POS_STOCK_SETUP','disabled');const load=vi.fn(()=>Promise.reject(Error('new setup disabled')))
  render(<StockSetupPage store={{...base,stockSetupEnabled:false}} session={owner} loadState={load} previewOperation={previewBrowserStockSetup}/>);await waitFor(()=>expect(document.querySelector('h1').textContent).toBe('核對上次成本設定'));expect(load).not.toHaveBeenCalled();click('核對上次成本設定');await waitFor(()=>expect(document.querySelector('h1').textContent).toBe('成本已保存'));expect(readPendingFinancial()).toBeNull();expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect(original.request.id).toBe(JSON.parse(raw).data.pos_stock_cost_entries[0].input.id)
})
it('keeps other source drafts when confirming one batch and preserves corrupt or unsaved bytes',()=>{
  const context={storeId:'draft-scope'},key=stockSetupDraftKey(context,owner,'pricing'),draft={protocol:'pos-stock-setup-draft/v1',reviewId:'sha256:'+'0'.repeat(64),useReferences:false,choices:{first:{mode:'total',raw:'1.16'},second:{mode:'total',raw:'9.99'}},selectedKey:'first',agentText:''}
  const raw=writeStockSetupDraft(localStorage,key,draft),command={action:'price',review:{selection:{entries:[{key:'first'}]}}};clearStockSetupDraft(localStorage,key,raw,command);expect(readStockSetupDraft(localStorage,key).value.choices).toEqual({second:{mode:'total',raw:'9.99'}})
  const bad=stockSetupDraftKey({storeId:'corrupt'},owner,'opening');localStorage.setItem(bad,'{raw');expect(()=>readStockSetupDraft(localStorage,bad)).toThrow();expect(localStorage.getItem(bad)).toBe('{raw')
  const fail=stockSetupDraftKey({storeId:'quota'},owner,'opening'),write=Storage.prototype.setItem;let full=true;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,value){if(k===fail&&full)throw Error('quota');return write.call(this,k,value)})
  expect(()=>writeStockSetupDraft(localStorage,fail,draft)).toThrow();expect(readStockSetupDraft(localStorage,fail).value.choices.first.raw).toBe('1.16');full=false;writeStockSetupDraft(localStorage,fail,draft);expect(readStockSetupDraft(localStorage,fail).notSaved).toBeUndefined()
})
it('does not clear the financial original when the saved cost acknowledgement is incomplete',async()=>{
  const state=await getBrowserStockSetupState(owner),preview=await previewBrowserStockSetup({context:scope(state),entries:[],useReferences:false},owner)
  await expect(executeFinancial('stock-cost',preview.input,async request=>{const result=await commitBrowserStockSetup(request,owner);return {...result,receipt:{...result.receipt,valuation:null}}})).rejects.toThrow(/回覆尚未確認/)
  expect(readPendingFinancial()).toBeTruthy();expect(browserToBook(readRecords().data).stockCostEntries).toHaveLength(1)
})
