// @vitest-environment jsdom
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { useStore } from '../../src/store/useStore'
import { writeRecords, readRecords, RECORD_KEY } from '../../src/utils/browserStorage'
import { settledOrders, netSale, orderCost } from '../../src/utils/orderLedger'
import { orderToJournalEntries } from '../../src/utils/accounting'
import { profitAnalysis } from '../../src/utils/analytics'
let map,rejectRecord
beforeEach(()=>{
  map=new Map();rejectRecord=false
  vi.stubGlobal('localStorage',{getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(rejectRecord&&k===RECORD_KEY)throw new Error('容量不足');map.set(k,String(v))},removeItem:k=>map.delete(k)})
  vi.stubGlobal('navigator',{locks:{request:async(_name,options,cb)=>typeof options==='function'?options({}):cb({})}})
  writeRecords({pos2_products:[{id:'p',name:'商品',price:30,stock:10,cost:10}],pos2_members:[],pos2_shifts:[{id:'s',status:'open'}]})
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
async function store(){const hook=renderHook(()=>useStore({userId:'owner',role:'owner'}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));return hook}
test('real store commits a sale, updates canonical stock and clears the cart only after acknowledgement',async()=>{
  const {result}=await store();act(()=>result.current.addToCart(result.current.products[0],2))
  let order;await act(async()=>{order=await result.current.checkout('cash',100)})
  expect(result.current.cart).toHaveLength(0);expect(result.current.products[0].stock).toBe(8);expect(result.current.orders[0].id).toBe(order.id)
  expect(result.current.checkoutState.phase).toBe('idle');expect(readRecords().data.pos2_orders).toHaveLength(1)
})
test('real store preserves cart, stock and orders when persistence rejects an atomic transaction',async()=>{
  const {result}=await store();act(()=>result.current.addToCart(result.current.products[0],2));rejectRecord=true
  await act(async()=>{await expect(result.current.checkout('cash',100)).rejects.toThrow()})
  expect(result.current.cart[0].qty).toBe(2);expect(result.current.products[0].stock).toBe(10);expect(result.current.orders).toHaveLength(0)
  expect(readRecords().data.pos2_orders).toHaveLength(0)
})
test('failed held-cart persistence cannot discard a sale in progress',async()=>{
  const {result}=await store();act(()=>result.current.addToCart(result.current.products[0]));rejectRecord=true
  await act(async()=>{await expect(result.current.holdCart('顧客')).rejects.toThrow('容量不足')})
  expect(result.current.cart).toHaveLength(1);expect(result.current.heldOrders).toHaveLength(0)
})
test('customer fulfilment is never treated as collected revenue or a journal entry',()=>{
  const unpaid={source:'customer',status:'completed',payMethod:'pending',total:100,items:[{id:'p',qty:1}]}
  expect(settledOrders([unpaid])).toEqual([]);expect(orderToJournalEntries(unpaid,[])).toEqual([])
})
test('cumulative partial refunds remain balanced when the last refund completes the original order',()=>{
  const entries=[{id:'o',status:'refunded',total:100,balanceUsed:10},{id:'r1',status:'completed',refundOf:'o',total:-40,balanceUsed:-4},{id:'r2',status:'completed',refundOf:'o',fullRefund:true,total:-60,balanceUsed:-6}]
  expect(settledOrders(entries).reduce((s,o)=>s+netSale(o),0)).toBe(0)
})
test('prepaid consumption counts as earned revenue and saved costs do not change with current product costs',()=>{
  const order={id:'o',status:'completed',total:10,balanceUsed:20,itemCosts:{p:5},items:[{id:'p',qty:1,price:30}],time:new Date().toISOString()}
  expect(netSale(order)).toBe(30);expect(orderCost(order,[{id:'p',cost:25}])).toBe(5)
  expect(profitAnalysis([order],[{id:'p',cost:25}],30)).toMatchObject({revenue:30,cost:5,profit:25})
})
