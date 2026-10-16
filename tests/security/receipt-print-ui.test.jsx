// @vitest-environment jsdom
import React from 'react'
import {afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,act} from '@testing-library/react'
import ReceiptPrintControl from '../../src/components/ReceiptPrintControl'
import ReceiptHistoryModal from '../../src/components/ReceiptHistoryModal'
import CartPanel from '../../src/components/CartPanel'
import {originalPosReceipts} from '../../src/utils/receiptHistory.mjs'

afterEach(()=>{cleanup();delete window.electronAPI})
function printer(run){const printReceipt=vi.fn(run);window.electronAPI={printer:{printReceipt}};return printReceipt}
const sale={id:'original-50',time:'2026-10-17T02:00:00+08:00',source:'pos',status:'completed',total:50,paid:100,change:50,payMethod:'cash',items:[{id:'p',name:'Rice bowl',price:50,qty:1}]}
test('completed checkout survives failed receipt printing and never calls checkout again',async()=>{
  const print=printer(async()=>({success:false,error:'private native path'})),checkout=vi.fn(async()=>sale)
  render(<CartPanel cart={sale.items} cartSubtotal={50} onCheckout={checkout}/>)
  fireEvent.click(screen.getByText('前往結帳 →'));fireEvent.change(screen.getByPlaceholderText('輸入金額'),{target:{value:'100'}})
  await act(async()=>fireEvent.click(screen.getByText('確認收款')))
  await act(async()=>fireEvent.click(screen.getByText('列印收據')))
  expect(screen.getByText('結帳完成')).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('待核對')
  expect(screen.getByText('結帳已完成，不需再次收款。')).toBeTruthy();expect(screen.queryByText(/private native/)).toBeNull()
  expect(checkout).toHaveBeenCalledTimes(1);expect(print).toHaveBeenCalledExactlyOnceWith({id:sale.id})
  fireEvent.click(screen.getByText('繼續收銀'));expect(checkout).toHaveBeenCalledTimes(1)
})
test('pending receipt is single flight and transport success only asks for paper verification',async()=>{
  let resolve;const print=printer(()=>new Promise(done=>{resolve=done}))
  render(<ReceiptPrintControl orderId={sale.id}/>)
  const button=screen.getByText('列印收據').closest('button')
  fireEvent.click(button);fireEvent.click(button)
  expect(button.disabled).toBe(true);expect(screen.getByText('正在送印')).toBeTruthy();expect(print).toHaveBeenCalledTimes(1)
  await act(async()=>resolve({success:true}))
  expect(screen.getByRole('status').textContent).toBe('已送印，請確認紙張')
  expect(screen.queryByText('已自行核對紙張')).toBeNull()
})
test.each([undefined,null,true,{},[],{success:false,error:'secret'},{success:true,error:'contradictory'},{success:true,unexpected:1}])('ambiguous reply %j stays uncertain',async reply=>{
  printer(async()=>reply);render(<ReceiptPrintControl orderId={sale.id}/>)
  await act(async()=>fireEvent.click(screen.getByText('列印收據')))
  expect(screen.getByRole('alert').textContent).toContain('待核對');expect(screen.queryByText('已送印，請確認紙張')).toBeNull()
})
test('native exception is sanitized and a repeated print requires explicit confirmation',async()=>{
  const print=printer(async()=>{throw Error('C:\\private\\native IPC secret')})
  render(<ReceiptPrintControl orderId={sale.id}/>)
  await act(async()=>fireEvent.click(screen.getByText('列印收據')))
  expect(screen.queryByText(/IPC secret/)).toBeNull()
  fireEvent.click(screen.getByText('需要補印'));fireEvent.click(screen.getByText('取消'));expect(print).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('已拿到收據'));expect(screen.getByRole('status').textContent).toBe('已自行核對紙張');expect(print).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('需要補印'));expect(screen.getByText('只印收據，不再次收款。')).toBeTruthy()
  print.mockResolvedValueOnce({success:true});await act(async()=>fireEvent.click(screen.getByText('確認補印')));expect(print).toHaveBeenCalledTimes(2)
})
test('late response for a departed original cannot replace the next original state',async()=>{
  let completeOld;const print=printer(()=>new Promise(done=>{completeOld=done}))
  const view=render(<ReceiptPrintControl orderId="old"/>)
  fireEvent.click(screen.getByText('列印收據'))
  view.rerender(<ReceiptPrintControl orderId="new"/>)
  print.mockResolvedValueOnce({success:false});await act(async()=>fireEvent.click(screen.getByText('列印收據')))
  await act(async()=>completeOld({success:true}))
  expect(screen.getByRole('alert').textContent).toContain('待核對');expect(print.mock.calls).toEqual([[{id:'old'}],[{id:'new'}]])
})
test.each(['shared','standalone'])('%s shows capability guidance instead of an unavailable printer action',mode=>{
  const print=printer(async()=>({success:true}))
  if(mode==='shared')window.electronAPI.sharedStore=true
  else delete window.electronAPI
  render(<ReceiptPrintControl orderId={sale.id}/>)
  expect(screen.getByText('收據請到店面電腦列印。')).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();expect(print).not.toHaveBeenCalled()
})
test('history searches saved originals, excludes customer requests and refund rows, and preserves source order',()=>{
  const rows=[{...sale,id:'later',time:'2026-10-17T03:00:00+08:00'},{...sale,id:'refund',refundOf:sale.id,total:-50},{...sale,id:'customer',source:'customer'},{...sale,id:'pending',payMethod:'pending'},sale,{...sale,id:'older-refunded',status:'refunded',time:'2026-10-16T03:00:00+08:00'}]
  const before=structuredClone(rows)
  expect(originalPosReceipts(rows).map(row=>row.id)).toEqual(['later',sale.id,'older-refunded'])
  expect(originalPosReceipts(rows,'original-50 rice').map(row=>row.id)).toEqual([sale.id]);expect(rows).toEqual(before)
})
test('finding a receipt never prints automatically; history repeats require paper review and Escape closes',async()=>{
  const print=printer(async()=>({success:true})),close=vi.fn()
  render(<ReceiptHistoryModal orders={[sale]} onClose={close}/>)
  expect(document.activeElement).toBe(screen.getByLabelText('輸入單號或商品'))
  fireEvent.change(screen.getByLabelText('輸入單號或商品'),{target:{value:sale.id}})
  fireEvent.click(screen.getByText('查看收據'));expect(print).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('需要補印'));fireEvent.click(screen.getByText('取消'));expect(print).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('需要補印'));await act(async()=>fireEvent.click(screen.getByText('確認補印')))
  expect(print).toHaveBeenCalledExactlyOnceWith({id:sale.id})
  // Sending removes the focused confirmation button. Escape must also work
  // when focus fell back to the document instead of remaining in the dialog.
  fireEvent.keyDown(document.body,{key:'Escape'});expect(close).toHaveBeenCalledTimes(1)
})
