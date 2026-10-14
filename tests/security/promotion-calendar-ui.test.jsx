// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,act} from '@testing-library/react'
import PromotionsPage,{applyPromotions} from '../../src/pages/PromotionsPage'
import {readRecords} from '../../src/utils/browserStorage'
vi.mock('../../src/utils/dataAccess',()=>({isElectron:false,loadPromotions:async()=>[],dbAddPromotion:vi.fn(),dbUpdatePromotion:vi.fn(),dbDeletePromotion:vi.fn()}))
const promotion=(startAt,endAt)=>({id:'period',name:'fixture',type:'threshold',enabled:true,startAt,endAt,condition:{threshold:10,discount:5}})
beforeEach(()=>{localStorage.clear();vi.useFakeTimers({toFake:['Date']}).setSystemTime(new Date('2026-09-30T16:30:00Z'))})
afterEach(()=>{cleanup();vi.useRealTimers()})
async function form(){await act(async()=>render(<PromotionsPage store={{products:[]}} session={{id:'fixture',username:'fixture',role:'owner'}}/>));fireEvent.click(screen.getByRole('button',{name:/滿額折扣/}));return [...document.querySelectorAll('input[type=datetime-local]')]}
test('a stored local activity window is active at the actual local instant',()=>{
  expect(applyPromotions([], [promotion('2026-10-01T00:00:00','2026-10-01T01:00:00')],20).totalDiscount).toBe(5)
})
test('an offset-bearing historical window is evaluated at the same instant',()=>{
  expect(applyPromotions([], [promotion('2026-09-30T16:00:00Z','2026-09-30T17:00:00Z')],20).totalDiscount).toBe(5)
})
test('an expired activity does not become active due to string format',()=>{
  expect(applyPromotions([], [promotion('2026-09-30T00:00:00Z','2026-09-30T16:29:59Z')],20).totalDiscount).toBe(0)
})
test('new activity date inputs show the local midnight date and time',async()=>{
  const fields=await form()
  expect(fields.map(i=>i.value)).toEqual(['2026-10-01T00:30','2026-10-31T00:30'])
})
test('a reversed activity period preserves inputs and rejects saving',async()=>{
  const fields=await form();fireEvent.change(screen.getByPlaceholderText('例：週末特賣'),{target:{value:'fixture'}})
  fireEvent.change(fields[0],{target:{value:'2026-10-01T01:00'}});fireEvent.change(fields[1],{target:{value:'2026-10-01T00:00'}})
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:/儲存|保存/})))
  expect(readRecords().data.pos_promotions).toHaveLength(0)
  expect(screen.getByRole('alert').textContent).toMatch(/時間|日期/)
  expect(fields[0].value).toBe('2026-10-01T01:00')
})
test('a valid local activity persists normalized instants',async()=>{
  const fields=await form();fireEvent.change(screen.getByPlaceholderText('例：週末特賣'),{target:{value:'fixture'}})
  fireEvent.change(fields[0],{target:{value:'2026-10-01T00:00'}});fireEvent.change(fields[1],{target:{value:'2026-10-01T01:00'}})
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:/儲存|保存/})))
  expect(readRecords().data.pos_promotions[0]).toMatchObject({startAt:'2026-09-30T16:00:00.000Z',endAt:'2026-09-30T17:00:00.000Z'})
})
