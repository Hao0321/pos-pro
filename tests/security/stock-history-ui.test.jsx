// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {render,fireEvent,waitFor,cleanup} from '@testing-library/react'
import fixture from '../fixtures/stock-history-native-v1.json'
import reference from '../fixtures/stock-setup-native-v1.json'
import StockHistoryPage from '../../src/pages/StockHistoryPage'
import {bookToBrowser} from '../../electron/recoveryRules.mjs'
import {RECORD_KEY} from '../../src/utils/browserStorage'
import * as access from '../../src/utils/dataAccess'
import messages from '../../public/i18n/messages.mjs'
import catalogue from '../../public/i18n/catalogue/stock-history.mjs'
import {setDisplayPreferences} from '../../public/i18n/preferences.mjs'

function seed(original=fixture.book){const book=structuredClone(original);book.settings=book.settings.map(row=>({...row,value:['stockCostVersionFence','stockCostBookHead'].includes(row.key)?row.value:JSON.stringify(row.value)}));localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'history-ui-epoch',data:bookToBrowser(book)}))}
beforeEach(()=>{localStorage.clear();seed();setDisplayPreferences({locale:'zh-TW'});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key,work)=>work()}})})
afterEach(()=>{cleanup();vi.restoreAllMocks();setDisplayPreferences({locale:'zh-TW'})})
// Real 63-event reads are bounded per step; a complete multi-action journey gets 15 seconds.
const journey=(name,work)=>it(name,work,15000)
const store=()=>({setView:vi.fn(),stockSetupEnabled:false}),click=label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);expect(button).toBeTruthy();fireEvent.click(button)},ready=()=>waitFor(()=>expect(document.querySelector('[data-stock-history]').getAttribute('aria-busy')).toBe('false'),{timeout:5000})
async function open(){const value=store();render(<StockHistoryPage store={value} session={fixture.owner}/>);await ready();return value}
journey('lets an owner search a product, inspect the original source and reach its oldest actual record without writing',async()=>{
 const before=localStorage.getItem(RECORD_KEY);await open();const product=fixture.book.products.find(p=>p.id==='unknown');fireEvent.change(document.querySelector('.history-search input'),{target:{value:product.name}});fireEvent.submit(document.querySelector('.history-search'));await ready();expect(document.querySelectorAll('[data-history-product]')).toHaveLength(1)
 fireEvent.click(document.querySelector('[data-history-product=unknown]'));await ready();expect(document.querySelectorAll('[data-history-event]').length).toBe(20);expect(document.body.textContent).toContain('只補成本，數量不重算。')
 const sourceId=fixture.book.stockCostEntries.find(e=>e.input.id==='history-source-price').input.sourceId,sourceButton=[...document.querySelectorAll('[data-history-source-button]')].find(b=>b.dataset.historySourceButton===sourceId);fireEvent.click(sourceButton);await ready();expect(document.querySelector('[data-history-source]').textContent).toContain('2.25');expect(document.querySelector('[data-history-source]').textContent).toContain('NT$ 2.61')
 click('最早紀錄');await ready();expect(document.querySelector('.history-events').textContent).toContain('核對期初');expect(document.querySelector('.history-events').textContent).toContain('期初核對數量');expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
journey('invalidates a visible page when real metadata changes, preserving the selected product for review',async()=>{
 await open();const product=fixture.book.products.find(p=>p.id==='unknown');fireEvent.change(document.querySelector('.history-search input'),{target:{value:product.name}});fireEvent.submit(document.querySelector('.history-search'));await ready();fireEvent.click(document.querySelector('[data-history-product=unknown]'));await ready()
 const result=await access.dbUpdateProduct('unknown',{name:'Renamed history source'},fixture.owner);expect(result.success,result.error).toBe(true);window.dispatchEvent(new Event('pos-data-refreshed'));await waitFor(()=>expect(document.querySelector('[role=alert]').textContent).toContain('庫存紀錄已更新'),{timeout:5000});expect(document.querySelector('.history-events')).toBe(null)
 click('重新核對');await ready();expect(document.querySelector('.history-product-heading h2').textContent).toBe('Renamed history source')
})
journey('rejects an incomplete transport reply and recovers through the same read-only action',async()=>{
 const spy=vi.spyOn(access,'loadStockHistory').mockResolvedValueOnce({protocol:'pos-stock-history/v1',rows:[]});await open();expect(document.querySelector('[role=alert]').textContent).toContain('庫存紀錄回覆需要重新核對');expect(document.querySelector('[data-history-product]')).toBe(null);spy.mockRestore();const before=localStorage.getItem(RECORD_KEY);click('重新核對');await ready();expect(document.querySelector('[data-history-product]')).toBeTruthy();expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
journey('does not display an old reply that arrives after a real data-change event during loading',async()=>{
 const actual=access.loadStockHistory;let release,held;const spy=vi.spyOn(access,'loadStockHistory').mockImplementationOnce(async(input,actor)=>{held=await actual(input,actor);return new Promise(resolve=>{release=()=>resolve(held)})})
 render(<StockHistoryPage store={store()} session={fixture.owner}/>);await waitFor(()=>expect(release).toBeTypeOf('function'),{timeout:5000});const changed=await access.dbUpdateProduct('unknown',{name:'Changed during read'},fixture.owner);expect(changed.success,changed.error).toBe(true);window.dispatchEvent(new Event('pos-data-refreshed'));release();await ready();expect(document.querySelector('[role=alert]').textContent).toContain('庫存紀錄已更新');expect(document.querySelector('[data-history-product]')).toBe(null);spy.mockRestore();click('重新核對');await ready();expect(document.querySelector('[data-history-product]')).toBeTruthy()
})
journey('explains reference-only mode and offers current stock without inventing history or enabling cost writes',async()=>{
 seed(reference.book);const before=localStorage.getItem(RECORD_KEY),value=await open();expect(document.body.textContent).toContain('成本帳還沒啟用');expect(document.querySelector('[data-history-product]')).toBe(null);expect(document.body.textContent).not.toContain('核對庫存成本');click('看目前商品庫存');expect(value.setView).toHaveBeenCalledWith('inventory');expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
journey('renders actual English search, original-record and review controls without accepting a Chinese fallback',async()=>{
 setDisplayPreferences({locale:'en'});await open();expect(document.querySelector('.history-search button').textContent).toBe('Search');const product=fixture.book.products.find(p=>p.id==='counted');fireEvent.change(document.querySelector('.history-search input'),{target:{value:product.name}});fireEvent.submit(document.querySelector('.history-search'));await ready();fireEvent.click(document.querySelector('[data-history-product=counted]'));await ready();expect([...document.querySelectorAll('.history-record-details dt')].some(row=>row.textContent==='Original record')).toBe(true)
 const changed=await access.dbUpdateProduct('counted',{name:'English review fixture'},fixture.owner);expect(changed.success,changed.error).toBe(true);window.dispatchEvent(new Event('pos-data-refreshed'));await waitFor(()=>expect(document.querySelector('[role=alert]')).toBeTruthy(),{timeout:5000});expect([...document.querySelectorAll('button')].some(b=>b.textContent==='Review again')).toBe(true)
})
it('ships all new history messages in English, Japanese and simplified Chinese with matching placeholders',()=>{
 for(const [key,row] of Object.entries(catalogue)){expect(messages[key],key).toEqual(row.slice(0,3));for(const translation of messages[key]){expect(translation,key).toBeTruthy();expect([...translation.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),key).toEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort())}}
 const code=fs.readFileSync('src/pages/StockHistoryPage.jsx','utf8'),dynamic=code.split(/\r?\n/).filter(line=>/^const (stages|kinds)=/.test(line)).flatMap(line=>[...line.matchAll(/['"]([^'"]*\p{Script=Han}[^'"]*)['"]/gu)].map(match=>match[1]));expect(dynamic.length).toBeGreaterThanOrEqual(20);expect(dynamic.filter(key=>!Object.hasOwn(messages,key))).toEqual([])
})
