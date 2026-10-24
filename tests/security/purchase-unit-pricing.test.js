import {test,expect} from 'vitest'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {purchaseUnitFacts,purchaseLineCents,purchaseReferenceCost,purchaseSourceSignature} from '../../electron/purchaseUnitPricing.mjs'
import {createProcurement,recordProcurementReceipt,planProcurement,validateProcurement,procurementSummary} from '../../electron/procurementRules.mjs'
import {valuationState,quoteProcurementAllocation} from '../../electron/procurementValuation.mjs'
import {readBaseUnits} from '../../src/utils/rawQuantity.mjs'
const time='2026-10-18T12:00:00.000Z',basis={protocol:'pos-purchase-units/v1',purchasedUnit:'箱',purchasedQuantity:'01.000',baseQuantityPerUnit:'03.0',purchasedUnitPrice:'0100.00'},item={productId:'p',name:'Bottles 原文',unit:'瓶',qty:3,costBasis:basis},data={products:[{id:'p',unit:'瓶'}],suppliers:[{id:'supplier',name:'Supplier'}],purchases:[]},actor={userId:'owner',username:'Owner',role:'owner'}
const request=()=>{const purchase={id:'po',supplierId:'supplier',date:'2026-10-18',items:[structuredClone(item)]};return {kind:'purchase-create-units',id:'created',time,supplierContext:{storeId:'shop',epoch:'epoch',revision:0},unitReview:{protocol:'pos-purchase-units-review/v1',confirmed:true,sourceSignature:purchaseSourceSignature(purchase,data)},purchase}}
test('one box of three preserves original 100.00 through exact base units and cumulative cents',()=>{
 expect(purchaseUnitFacts(item)).toMatchObject({baseUnits:3000,totalCents:10000});expect([0,1,2,3].map(q=>purchaseLineCents(item,q))).toEqual([0,3333,6667,10000]);expect(purchaseReferenceCost(item)).toEqual({amount:33.33,approximate:true});expect(purchaseLineCents({qty:3,unitCost:33.33})).toBe(9999);expect(item.costBasis).toEqual(basis)
 const half={...item,qty:.75,costBasis:{...basis,purchasedQuantity:'.5',baseQuantityPerUnit:'1.5',purchasedUnitPrice:'0.07'}};expect(purchaseUnitFacts(half)).toMatchObject({baseUnits:750,totalCents:4});expect(purchaseLineCents(half)).toBe(4)
})
test('invalid facts, excessive precision, ambiguous prices and sub-milliunit conversion stop without rewriting raw input',()=>{
 const original=structuredClone(item)
 for(const [key,value]of [['purchasedQuantity',''],['purchasedQuantity','0'],['purchasedQuantity','-1'],['purchasedQuantity','1e2'],['purchasedQuantity','1.0001'],['baseQuantityPerUnit','0'],['baseQuantityPerUnit','.0001'],['purchasedUnitPrice','1.001'],['purchasedUnitPrice','NaN']])expect(()=>purchaseUnitFacts({...item,costBasis:{...basis,[key]:value}})).toThrow()
 expect(()=>purchaseUnitFacts({...item,unitCost:33.33})).toThrow();expect(()=>purchaseUnitFacts({...item,qty:2.999})).toThrow();expect(()=>purchaseUnitFacts({...item,unit:'箱'})).toThrow();expect(()=>purchaseUnitFacts({...item,costBasis:{...basis,purchasedQuantity:'.001',baseQuantityPerUnit:'.001'}})).toThrow();expect(()=>purchaseUnitFacts({...item,costBasis:{...basis,guessed:true}})).toThrow();expect(item).toEqual(original)
})
test('new creation requires explicit review and matching product units; legacy creation cannot discard package evidence',()=>{
 const r=request(),po=createProcurement(r,data);expect(po.procurement).toMatchObject({version:2,valuation:{version:1,legacyCount:0,order:[]}});expect(po.total).toBe(100);expect(po.items[0].costBasis).toEqual(basis);expect(Object.hasOwn(po.items[0],'unitCost')).toBe(false);expect(()=>validateProcurement(po)).not.toThrow()
 for(const patch of [{unitReview:{protocol:'pos-purchase-units-review/v1',confirmed:false}},{supplierContext:undefined},{kind:'purchase-create'},{sourceQuote:{}},{draftContext:{}}])expect(()=>createProcurement({...r,...patch},data)).toThrow()
 expect(()=>createProcurement(r,{...data,products:[{id:'p',unit:'公斤'}]})).toThrow();expect(()=>validateProcurement({...po,total:99.99})).toThrow();expect(()=>validateProcurement({...po,procurement:{...po.procurement,version:1}})).toThrow()
})
test('three receipts, one invoice and three partial credits conserve every cent of the original box',()=>{
 let po=createProcurement(request(),data);const receipts=[]
 for(let n=1;n<=3;n++){po=recordProcurementReceipt(po,{...po,items:[{...po.items[0],received:n}],status:n===3?'received':'partial'},{kind:'receive',id:'received-'+n,time,quantities:[1]});validateProcurement(po);receipts.push(po.procurement.receipts.at(-1).amount)}
 expect(receipts).toEqual([33.33,33.34,33.33]);expect(valuationState(po).unbilled.value).toEqual([10000]);po=planProcurement({kind:'purchase-bill',id:'bill',time,purchaseId:po.id,expectedPurchase:canonicalSignature(po),quantities:[3],reference:'Invoice',dueDate:'2026-10-20'},{purchases:[po]},actor).purchase;expect(procurementSummary(po).owed).toBe(100)
 const credits=[];for(let n=1;n<=3;n++){expect(quoteProcurementAllocation(po,[1],'bill')).toBe([33.33,33.34,33.33][n-1]);po=planProcurement({kind:'purchase-return',id:'returned-'+n,time,purchaseId:po.id,expectedPurchase:canonicalSignature(po),invoiceId:'bill',reason:'Supplier confirmed',quantities:[1]},{purchases:[po]},actor).purchase;validateProcurement(po);credits.push(po.procurement.returns.at(-1).amount)}
 expect(credits).toEqual(receipts);expect(procurementSummary(po)).toMatchObject({owed:0,netReceived:0,returned:100});expect(valuationState(po).bills.get('bill')).toMatchObject({qty:[0],value:[0]})
})
test('ordinary prices, explicit free goods and common raw quantity parsing retain their own meanings',()=>{
 const old=createProcurement({...request(),kind:'purchase-create',purchase:{...request().purchase,items:[{productId:'p',name:'Plain',unit:'瓶',qty:2,unitCost:.07}]}},data);expect(old.procurement.version).toBe(1);expect(old.total).toBe(.14);expect(purchaseLineCents(old.items[0],.5)).toBe(4);expect(purchaseReferenceCost(old.items[0])).toEqual({amount:.07,approximate:false})
 expect(purchaseUnitFacts({...item,costBasis:{...basis,purchasedUnitPrice:'0.00'}}).totalCents).toBe(0);expect(readBaseUnits(' 01.250 ','invalid')).toBe(1250);expect(readBaseUnits('.5','invalid')).toBe(500);expect(()=>readBaseUnits('1e2','invalid')).toThrow('invalid')
})
