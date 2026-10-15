import {test,expect} from 'vitest'
import {productPerformance} from '../../src/utils/analytics'
const products=[{id:'bowl',name:'牛丼',price:999,cost:500,stock:8}]
const business=(id,revenue,qty,cost)=>({id,source:'business-report',time:new Date().toISOString(),status:'completed',total:revenue,items:[{id:'bowl',qty,price:150,reportRevenue:revenue}],itemCosts:{bowl:cost}})
test('thirty-day product revenue and profit use the two actual agreed prices and frozen handover costs',()=>{
  const rows=[business('first',150,1,40),business('second',250,1,40)]
  expect(productPerformance(products,rows).enriched[0]).toMatchObject({totalSold:2,revenue:400,profit:320,margin:80})
})
test('actual return, damaged return and allowance amounts retain their own cost reversal rules',()=>{
  const rows=[business('handover',400,2,40),business('restocked',-100,-.5,40),business('damaged',-50,-.25,0),business('allowance',-10,0,0)]
  expect(productPerformance(products,rows).enriched[0]).toMatchObject({totalSold:1.25,revenue:240,profit:180,margin:75})
})
test('POS discounts, stored-balance tender and dated refunds use recorded net sales and cost snapshots',()=>{
  const rows=[{id:'sale',time:new Date().toISOString(),status:'completed',total:80,balanceUsed:10,items:[{id:'bowl',qty:1,price:100}],itemCosts:{bowl:40}},
    {id:'refund',refundOf:'sale',time:new Date().toISOString(),status:'completed',total:-45,items:[{id:'bowl',qty:-.5,price:100}],itemCosts:{bowl:40}}]
  expect(productPerformance(products,rows).enriched[0]).toMatchObject({totalSold:.5,revenue:45,profit:25})
})
