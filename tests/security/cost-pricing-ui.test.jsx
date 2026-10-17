// @vitest-environment jsdom
import React from 'react'
import {it,expect,vi,afterEach} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import CostPricingPanel from '../../src/components/CostPricingPanel'
afterEach(()=>{cleanup();localStorage.clear()})
const fill=(label,value)=>fireEvent.change(screen.getByLabelText(label),{target:{value}})
const next=()=>fireEvent.click(document.querySelector('[data-cost-next]'))
const step=index=>fireEvent.click(document.querySelector('[data-cost-step="'+index+'"]'))
const purchasePrice=value=>{step(0);fill('這批總價（NT$）',value);if(value){next();next()}}
function complete(){fill('食材或包材名稱','白米');fill('這批總價（NT$）','200');fill('每包內容量','2');fill('購入單位','kg');next();fill('每份用量','200');fill('用量單位','g');next();fill('每賣 100 元，想留下幾元','30')}
it('three short steps calculate, require current-input review, and only fill a product draft',()=>{
 const apply=vi.fn();render(<CostPricingPanel unit="碗" cacheKey="fixture" onApply={apply}/>);complete();expect(document.querySelector('[data-cost-total]').textContent).toBe('NT$ 20');expect(document.querySelector('[data-cost-price]').textContent).toBe('NT$ 29')
 let button=screen.getByRole('button',{name:'帶入商品'});expect(button.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));expect(button.disabled).toBe(false)
 purchasePrice('201');button=screen.getByRole('button',{name:'帶入商品'});expect(button.disabled).toBe(true);expect(apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);expect(apply).toHaveBeenCalledExactlyOnceWith({cost:'20.10',price:'29.00'},expect.any(String));expect(screen.getByText('已帶入，下方按「儲存」就好。')).toBeTruthy()
 purchasePrice('');expect(screen.queryByRole('button',{name:'帶入商品'})).toBeNull();expect(apply).toHaveBeenCalledTimes(1)
})
it('restores device-local input without restoring acceptance, and changing output unit requires review again',()=>{
 const apply=vi.fn(),view=render(<CostPricingPanel unit="碗" cacheKey="fixture" onApply={apply}/>);complete();fireEvent.click(screen.getByRole('checkbox'));view.rerender(<CostPricingPanel unit="盒" cacheKey="fixture" onApply={apply}/>);expect(screen.getByRole('button',{name:'帶入商品'}).disabled).toBe(true)
 view.unmount();render(<CostPricingPanel unit="盒" cacheKey="fixture" onApply={apply}/>);expect(screen.getByRole('checkbox').checked).toBe(false);step(0);expect(screen.getByLabelText('這批總價（NT$）').value).toBe('200');expect(apply).not.toHaveBeenCalled()
})
it('corrupt or full local storage is visible and cannot erase or fake the saved calculation',()=>{
 localStorage.setItem('fixture','broken');render(<CostPricingPanel unit="碗" cacheKey="fixture" onApply={vi.fn()}/>);expect(screen.getByRole('alert').textContent).toContain('試算草稿讀不到');complete();expect(localStorage.getItem('fixture')).toBe('broken');fireEvent.click(screen.getByRole('button',{name:'重新建立試算草稿'}));expect(screen.getByLabelText('這批總價（NT$）').value).toBe('')
})
it('changing stores cannot write the previous store draft into the newly selected scope',()=>{
 const view=render(<CostPricingPanel unit="碗" cacheKey="store-a" onApply={vi.fn()}/>);complete();const old=localStorage.getItem('store-a');view.rerender(<CostPricingPanel unit="碗" cacheKey="store-b" onApply={vi.fn()}/>);expect(screen.getByLabelText('這批總價（NT$）').value).toBe('');expect(localStorage.getItem('store-a')).toBe(old);expect(JSON.parse(localStorage.getItem('store-b')).lines[0].packagePrice).toBe('')
})
it('editing and reverting a number does not silently restore the old review',()=>{
 render(<CostPricingPanel unit="碗" cacheKey="fixture" onApply={vi.fn()}/>);complete();fireEvent.click(screen.getByRole('checkbox'));purchasePrice('201');purchasePrice('200');expect(screen.getByRole('checkbox').checked).toBe(false);expect(screen.getByRole('button',{name:'帶入商品'}).disabled).toBe(true)
})
it('quota failure is visible and keeps the entered values available for download',()=>{
 const original=Storage.prototype.setItem,spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')})
 try{render(<CostPricingPanel unit="碗" cacheKey="full" onApply={vi.fn()}/>);complete();expect(screen.getByRole('alert').textContent).toContain('試算草稿尚未保存');step(0);expect(screen.getByLabelText('這批總價（NT$）').value).toBe('200');expect(screen.getByRole('button',{name:'下載計算紀錄',hidden:true})).toBeTruthy()}finally{spy.mockRestore();expect(Storage.prototype.setItem).toBe(original)}
})
it('shows only the current step, keeps details folded, and does not invent a price before a target is entered',()=>{
 render(<CostPricingPanel unit="碗" cacheKey="fixture" onApply={vi.fn()}/>);expect(screen.queryByLabelText('每份用量')).toBeNull();next();expect(screen.getByRole('alert')).toBeTruthy();expect(document.querySelector('[data-cost-step="0"]').getAttribute('aria-current')).toBe('step')
 fill('食材或包材名稱','米');fill('這批總價（NT$）','200');fill('每包內容量','2');fill('購入單位','kg');next();expect(screen.queryByLabelText('這批總價（NT$）')).toBeNull();fill('每份用量','200');fill('用量單位','g');next();expect(document.querySelector('[data-cost-total]').textContent).toBe('NT$ 20');expect(document.querySelector('[data-cost-price]').textContent).toBe('—');expect(document.querySelector('.cost-pricing-details').open).toBe(false);expect(screen.queryByRole('checkbox')).toBeNull()
})
