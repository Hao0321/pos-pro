// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,act,waitFor} from '@testing-library/react'
import WastePage from '../../src/pages/WastePage'

const product={id:'raw',name:'測試原料',stock:2,cost:100,expiryDate:'2026-10-01'}
function setup(recordWaste=vi.fn(async()=>({id:'saved'})),wasteLog=[]){
  render(<WastePage store={{products:[product],wasteLog,recordWaste}} session={{username:'fixture'}}/>)
  return recordWaste
}
function form(quantity){
  fireEvent.click(screen.getByText('新增損耗'))
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'raw'}})
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:quantity}})
  return screen.getByRole('button',{name:'記錄'})
}
beforeEach(()=>vi.useFakeTimers({toFake:['Date']}).setSystemTime(new Date('2026-09-30T16:30:00Z')))
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks()})

test('a real waste form preserves fractional ingredient units instead of truncating them',async()=>{
  const save=setup(),button=form('0.125')
  await act(async()=>fireEvent.click(button))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({productId:'raw',qty:0.125}))
  expect(screen.queryByText('記錄損耗')).toBeNull()
})
test('a normal integer loss accepts one acknowledged save',async()=>{
  const save=setup(),button=form('1')
  await act(async()=>fireEvent.click(button))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({qty:1}))
  expect(screen.queryByText('記錄損耗')).toBeNull()
})
test('one integer waste waits for the acknowledgement and ignores repeated clicks',async()=>{
  let finish;const save=setup(vi.fn(()=>new Promise(resolve=>{finish=resolve}))),button=form('1')
  fireEvent.click(button);fireEvent.click(button)
  expect(save).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  expect(screen.getByRole('spinbutton').value).toBe('1')
  await act(async()=>finish({id:'saved'}))
  expect(screen.queryByText('記錄損耗')).toBeNull()
})
test.each(['0','-1','0.0001','3'])('invalid or unavailable quantity %s stays visible without a mutation',async quantity=>{
  const save=setup(),button=form(quantity)
  await act(async()=>fireEvent.click(button))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('spinbutton').value).toBe(quantity)
  expect(screen.getByRole('alert').textContent).toMatch(/數量|庫存/)
})
test('a rejected waste save preserves the entered quantity and shows an error',async()=>{
  const save=setup(vi.fn(async()=>{throw Error('保存結果尚未確認，請核對原編號')})),button=form('1')
  await act(async()=>fireEvent.click(button))
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('原編號'))
  expect(screen.getByRole('spinbutton').value).toBe('1')
  expect(button.disabled).toBe(false)
  expect(save).toHaveBeenCalledTimes(1)
})
test('month selection uses the displayed local business month across midnight',()=>{
  setup(undefined,[
    {id:'before',productName:'上個月紀錄',qty:1,cost:100,time:'2026-09-30T15:59:00Z'},
    {id:'after',productName:'本月凌晨紀錄',qty:0.125,cost:100,time:'2026-09-30T16:01:00Z'},
  ])
  const month=document.querySelector('input[type=month]')
  fireEvent.change(month,{target:{value:'2026-10'}})
  expect(screen.getByText('本月凌晨紀錄')).toBeTruthy()
  expect(screen.queryByText('上個月紀錄')).toBeNull()
  expect(month.value).toBe('2026-10')
})
test('the default loss month is the current local month at month rollover',()=>{
  setup()
  expect(document.querySelector('input[type=month]').value).toBe('2026-10')
})
test('a missing acknowledgement leaves the entered loss visible for reconciliation',async()=>{
  setup(vi.fn(async()=>undefined));const button=form('1')
  await act(async()=>fireEvent.click(button))
  expect(screen.getByRole('spinbutton').value).toBe('1')
  expect(screen.getByRole('alert').textContent).toContain('回覆不完整')
})
test('quick disposal also waits once and prevents a second confirmation while saving',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  let finish;const save=setup(vi.fn(()=>new Promise(resolve=>{finish=resolve})))
  const button=screen.getByRole('button',{name:'報廢'})
  fireEvent.click(button);fireEvent.click(button)
  expect(save).toHaveBeenCalledTimes(1);expect(confirm).toHaveBeenCalledTimes(1)
  await act(async()=>finish({id:'quick-saved'}))
  expect(screen.getByRole('status').textContent).toContain('已保存')
})
test('original-ID recovery closes the old form after the original loss is confirmed',async()=>{
  const save=vi.fn(async()=>{throw Error('尚未確認，請以原編號重試')})
  const original={products:[product],wasteLog:[],recordWaste:save,financialState:{phase:'idle'}}
  const view=render(<WastePage store={original} session={{username:'fixture'}}/>),button=form('1')
  await act(async()=>fireEvent.click(button))
  view.rerender(<WastePage store={{...original,financialState:{phase:'uncertain',kind:'waste',id:'waste-original'}}}/>)
  const row={id:'waste-original',productName:'測試原料',qty:1,cost:100,time:new Date().toISOString()}
  view.rerender(<WastePage store={{...original,wasteLog:[row],financialState:{phase:'idle'}}}/>)
  expect(screen.queryByText('記錄損耗')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('原編號')
  expect(save).toHaveBeenCalledTimes(1)
})
