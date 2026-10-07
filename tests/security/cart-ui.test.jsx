// @vitest-environment jsdom
import React from 'react'
import { afterEach, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import CartPanel from '../../src/components/CartPanel'
afterEach(cleanup)
function checkout(onCheckout){
  render(<CartPanel cart={[{id:'p',name:'商品',price:50,qty:1}]} cartSubtotal={50} onCheckout={onCheckout}/>)
  fireEvent.click(screen.getByText('前往結帳 →'))
  fireEvent.change(screen.getByPlaceholderText('輸入金額'),{target:{value:'100'}})
  return screen.getByText('確認收款').closest('button')
}
test('actual payment UI waits for durable acknowledgement and ignores double clicks',async()=>{
  let resolve;const onCheckout=vi.fn(()=>new Promise(r=>{resolve=r})),button=checkout(onCheckout)
  fireEvent.click(button);fireEvent.click(button);expect(onCheckout).toHaveBeenCalledTimes(1);expect(screen.queryByText('結帳完成')).toBeNull()
  expect(button.disabled).toBe(true)
  await act(async()=>resolve({id:'sale',total:50,change:50,payMethod:'cash'}))
  expect(screen.getByText('結帳完成')).toBeTruthy()
})
test('failed payment persistence retains the payment screen and reports the error',async()=>{
  const onCheckout=vi.fn(async()=>{throw new Error('保存結果不明，勿再收款')});const button=checkout(onCheckout)
  await act(async()=>fireEvent.click(button))
  expect(screen.queryByText('結帳完成')).toBeNull();expect(screen.getByRole('alert').textContent).toContain('勿再收款');expect(button.disabled).toBe(false)
})
