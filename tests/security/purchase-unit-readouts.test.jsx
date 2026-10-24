// @vitest-environment jsdom
import React from 'react'
import {test,expect,afterEach,vi} from 'vitest'
import {render,screen,cleanup} from '@testing-library/react'
import {getProductHistory} from '../../src/utils/analytics'
import {PurchaseList} from '../../src/pages/purchase/PurchaseList'
afterEach(cleanup)
test('old purchase history without a stored price and old precision stays readable as before',()=>{
 const purchase={id:'legacy',date:'2020-01-01',status:'received',items:[{productId:'p',qty:1,received:1}]}
 expect(getProductHistory('p',{purchases:[purchase]})[0]).toMatchObject({delta:1,refId:'legacy',unitPrice:undefined})
 purchase.items[0].unitCost=.035;expect(getProductHistory('p',{purchases:[purchase]})[0].unitPrice).toBe(.035)
})
test('actual purchase detail shows original package amount while history marks the indivisible unit cost as approximate',()=>{
 const purchase={id:'units',date:'2026-10-18',status:'partial',supplierName:'Supplier',total:100,items:[{productId:'p',name:'Packed rice',unit:'kg',qty:3,received:1,costBasis:{protocol:'pos-purchase-units/v1',purchasedUnit:'box',purchasedQuantity:'01.000',baseQuantityPerUnit:'03.0',purchasedUnitPrice:'0100.00'}}]}
 render(<PurchaseList purchases={[purchase]} selected={purchase} onSelect={vi.fn()}/>);expect(screen.getByText('01.000 box')).toBeTruthy();expect(screen.getByText('0100.00 / box')).toBeTruthy();expect(screen.getByText('100.00')).toBeTruthy();expect(screen.getByText('換成 3 kg')).toBeTruthy();expect(document.body.textContent).not.toContain('NaN')
 expect(getProductHistory('p',{purchases:[purchase]})[0]).toMatchObject({delta:1,unitPrice:33.33,unitPriceApproximate:true})
})
