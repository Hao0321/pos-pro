// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import AccountingPage from '../../src/pages/AccountingPage'
import {NewPurchase} from '../../src/pages/purchase/NewPurchase'

beforeEach(()=>vi.useFakeTimers({toFake:['Date']}).setSystemTime(new Date('2026-09-30T16:30:00Z')))
afterEach(()=>{cleanup();vi.useRealTimers()})
function accounting(){render(<AccountingPage store={{allJournal:[],manualEntries:[],addManualEntry:vi.fn(),deleteManualEntry:vi.fn()}}/>)}
test('the accounting month starts and ends within the same local calendar',()=>{
  accounting()
  expect([...document.querySelectorAll('input[type=date]')].map(i=>i.value)).toEqual(['2026-10-01','2026-10-01'])
})
test('a new manual expense defaults to the local business day',()=>{
  accounting();fireEvent.click(screen.getByText('記錄費用'))
  expect([...document.querySelectorAll('input[type=date]')].map(i=>i.value)).toEqual(['2026-10-01','2026-10-01','2026-10-01'])
})
test('a new purchase defaults to the local business day',()=>{
  render(<NewPurchase products={[]} suppliers={[]} purchases={[]} orders={[]} onSave={vi.fn()}/>)
  expect(document.querySelector('input[type=date]').value).toBe('2026-10-01')
})
test('the accounting default remains correct during a normal daytime control',()=>{
  vi.setSystemTime(new Date('2026-10-01T10:30:00Z'));accounting()
  expect([...document.querySelectorAll('input[type=date]')].map(i=>i.value)).toEqual(['2026-10-01','2026-10-01'])
})
