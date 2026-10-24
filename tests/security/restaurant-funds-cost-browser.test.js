// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import fixture from '../fixtures/stock-cost-native-v1.json'
import fixed from '../fixtures/browser-stock-command-v1.json'
import {bookToBrowser,browserToBook} from '../../electron/recoveryRules.mjs'
import {readRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {dbAddProduct} from '../../src/utils/dataAccess'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {getBrowserStockAccountingState,getBrowserStockSalesState} from '../../src/utils/browserStockReports'
import {stockReportCostPostings} from '../../electron/stockReportCosts.mjs'
import {buildPnL} from '../../electron/accountingCore.mjs'
import {stockPeriodDisclosure} from '../../electron/stockAccounting.mjs'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'

const owner=fixed.actor,ok=result=>{expect(result.success,result.error).toBe(true);return result}
let records,refuse,afterWrite,ordinal
const book=()=>browserToBook(readRecords().data),state=()=>validateStockCostBook(book()),entry=()=>browserRestaurantState().entries[0]
function command(action,fields={}){const context=browserRestaurantState();return {id:'browser-funded-cost-'+(++ordinal),kind:'restaurant',action,time:new Date().toISOString(),storeId:context.storeId,epoch:context.epoch,...fields}}
async function apply(action,fields={}){return ok(await commitBrowserRestaurant(command(action,{entryId:entry().id,expectedVersion:entry().version,...fields}),owner))}
const pnl=()=>{const report=getBrowserStockAccountingState(owner);return buildPnL(report.journals,'2026-10-16','2026-10-16',stockPeriodDisclosure(report,'2026-10-16','2026-10-16'))}
const costs=()=>{const source=book();return stockReportCostPostings(state(),{products:source.products,orders:source.orders,restaurantEntries:source.restaurantOrders,salesDocuments:source.salesDocuments})}
const itemCost=id=>costs().filter(row=>row.productId===id).reduce((sum,row)=>sum+BigInt(row.amountCents),0n)
beforeEach(async()=>{
 records=new Map();refuse=false;afterWrite=false;ordinal=0
 vi.useFakeTimers();vi.setSystemTime(new Date(fixed.clock))
 vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,removeItem:key=>records.delete(key),setItem:(key,value)=>{if(key===RECORD_KEY&&refuse)throw Error('fixture quota');records.set(key,String(value));if(key===RECORD_KEY&&afterWrite){afterWrite=false;throw Error('fixture reply lost after atomic write')}}})
 vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
 const source=structuredClone(fixture.book);source.settings=source.settings.map(row=>({...row,value:JSON.stringify(row.value)}))
 records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'browser-stock-fixed-epoch',data:bookToBrowser(source)}))
 ok(await dbAddProduct({id:'premium',name:'Premium',price:120,cost:40,stock:2,unit:'份'},owner))
 const config=browserRestaurantState().config
 ok(await commitBrowserRestaurant(command('configure',{expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true,dailyCapacity:20,slotCapacity:10}}),owner))
 ok(await commitBrowserRestaurant(command('create',{day:'2026-10-16',slot:'12:00',channel:'walkin',customer:'Browser guest',contact:'',note:'',items:[{id:'p',qty:1,price:100},{id:'premium',qty:1,price:120}]}),owner))
})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})

test('standalone funds and actual cost preserve each menu source through selected then full prepared refunds',async()=>{
 const baseline=pnl(),oldCost=itemCost('p')
 const received=await apply('funds-receive',{amount:50,paid:100,payMethod:'cash',shiftId:'shift'})
 expect(received.costReceipt).toMatchObject({sourceMethod:'applyRestaurantOperation'});expect(state().projection.business.at(-1).effects).toEqual([]);expect(pnl().revenue).toBe(baseline.revenue)
 await apply('funds-receive',{amount:170,paid:170,payMethod:'card',shiftId:'shift'})
 await apply('advance',{status:'cooking'});await apply('advance',{status:'ready'});await apply('advance',{status:'completed'})
 expect(pnl().cogs-baseline.cogs).toBe(70);expect(itemCost('p')-oldCost).toBe(3000n);expect(itemCost('premium')).toBe(4000n)
 await apply('cancel-part',{quantities:[{id:'p',qty:1}],reason:'selected prepared',shiftId:'shift'})
 expect(itemCost('p')).toBe(oldCost);expect(itemCost('premium')).toBe(4000n);expect(pnl().cogs-baseline.cogs).toBe(40);expect(pnl().opExpenses-baseline.opExpenses).toBe(30)
 await apply('cancel',{reason:'remaining prepared',shiftId:'shift'})
 expect(pnl().revenue).toBe(baseline.revenue);expect(pnl().cogs).toBe(baseline.cogs);expect(pnl().opExpenses-baseline.opExpenses).toBe(70)
 expect(book().products.find(row=>row.id==='p').stock).toBe(8);expect(book().products.find(row=>row.id==='premium').stock).toBe(1)
 expect(getBrowserStockSalesState(owner).status).toBe('active');expect(readRecords().recovery.version).toBe(6)
 expect(()=>state()).not.toThrow()
})

test('a postwrite lost reply returns the exact saved funds and cost receipts instead of repeating either book',async()=>{
 const request=command('funds-receive',{entryId:entry().id,expectedVersion:entry().version,amount:50,paid:50,payMethod:'cash',shiftId:'shift'})
 afterWrite=true;const first=ok(await commitBrowserRestaurant(request,owner)),saved=records.get(RECORD_KEY)
 expect(first.fundsEvent.amountCents).toBe(5000);expect(first.costReceipt.id).toBe(request.id)
 expect(await commitBrowserRestaurant(request,owner)).toEqual(first);expect(records.get(RECORD_KEY)).toBe(saved)
})

test('prewrite quota rejection leaves payment, reservation, cash and the complete cost chain unchanged',async()=>{
 const request=command('funds-receive',{entryId:entry().id,expectedVersion:entry().version,amount:50,paid:50,payMethod:'cash',shiftId:'shift'}),saved=records.get(RECORD_KEY)
 refuse=true;expect(await commitBrowserRestaurant(request,owner)).toMatchObject({success:false,committed:false});expect(records.get(RECORD_KEY)).toBe(saved)
})

test('a native-style reply cannot strip the required cost acknowledgment and clear the original financial command',async()=>{
 const context=browserRestaurantState(),input={kind:'restaurant',action:'funds-receive',entryId:entry().id,expectedVersion:entry().version,storeId:context.storeId,epoch:context.epoch,costMode:context.costMode,fundsProtocol:'pos-restaurant-funds/v1',amount:50,paid:50,payMethod:'cash',shiftId:'shift'}
 expect(input.costMode).toBe('active')
 try{
  await expect(executeFinancial('restaurant',input,async request=>{const result=structuredClone(ok(await commitBrowserRestaurant(request,owner)));window.electronAPI={};delete result.costReceipt;return result})).rejects.toThrow()
 }finally{delete window.electronAPI}
 expect(readPendingFinancial()).not.toBeNull();const saved=records.get(RECORD_KEY)
 const result=await executeFinancial('restaurant',input,request=>commitBrowserRestaurant(request,owner))
 expect(result.costReceipt.id).toBe(result.fundsEvent.id);expect(readPendingFinancial()).toBeNull();expect(records.get(RECORD_KEY)).toBe(saved)
})

test('later cancellations preserve earlier source snapshots while a missing funded operation or recognition fails complete cost validation',async()=>{
 await apply('funds-receive',{amount:220,paid:220,payMethod:'card',shiftId:'shift'});await apply('advance',{status:'cooking'});await apply('advance',{status:'ready'});await apply('advance',{status:'completed'})
 const historical=structuredClone(book().stockCostEntries)
 await apply('cancel-part',{quantities:[{id:'p',qty:1}],reason:'one returned',shiftId:'shift'})
 expect(book().stockCostEntries.slice(0,historical.length)).toEqual(historical)
 const missing=book();missing.restaurantOperations=missing.restaurantOperations.filter(row=>row.id!==entry().funds.events[0].id);expect(()=>validateStockCostBook(missing)).toThrow()
 const noOrder=book();noOrder.orders=noOrder.orders.filter(row=>row.id!==entry().saleId);expect(()=>validateStockCostBook(noOrder)).toThrow()
})
