import {test,expect,vi} from 'vitest'
import {DATA_KEYS,RECORD_KEY,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {getBrowserSalesState,commitBrowserSalesDocument} from '../../src/utils/browserSalesDocuments'
import {commitBrowserExchange} from '../../src/utils/browserExchange'
import {productReference,QUOTE_PRICING,EXCHANGE_SETTING,readExchangeStore} from '../../electron/businessExchange.mjs'
import {validateSalesRecords} from '../../electron/salesPlan.mjs'

test('actual renderer migration preserves sales, original quote receipts, restaurant collections and mixed setting encodings',async()=>{
  const saved=new Map(),actor={role:'owner',userId:'owner',username:'fixture owner'}
  vi.stubGlobal('localStorage',{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value)),removeItem:key=>saved.delete(key)})
  vi.stubGlobal('navigator',{locks:{request:async(_key,action)=>action()}})
  try{
    const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=[{id:'p',name:'fixture',unit:'個',stock:2,price:10,cost:3}]
    saved.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}));const state=await getBrowserSalesState(actor)
    const quote=await commitBrowserExchange({id:'migration-quote',time:new Date().toISOString(),kind:'exchange',storeId:state.storeId,expectedRevision:0,quoteId:'',expectedQuoteRevision:0,recipient:{id:'buyer',name:'fixture buyer'},validUntil:new Date(Date.now()+86400000).toISOString(),items:[{productId:'p',qty:1,unitPrice:8,expectedProduct:productReference(data.pos2_products[0])}],note:'',rememberPrices:true,pricing:QUOTE_PRICING},actor);expect(quote.success,quote.error).toBe(true)
    const sale=await commitBrowserSalesDocument({id:'migration-sale',time:new Date().toISOString(),kind:'sales',storeId:state.storeId,epoch:state.epoch,date:state.today,action:'create',document:{customer:quote.quote.recipient,date:state.today,items:[{productId:'p',qty:1,unitPrice:8,expectedProduct:productReference(data.pos2_products[0])}],note:'',quoteRef:{id:quote.quote.id,revision:1}}},actor);expect(sale.success,sale.error).toBe(true)
    const record=readRecords();writeRecords({pos_business_settings:[...record.data.pos_business_settings,{key:'storeName',value:JSON.stringify('migration store')},{key:'restaurantConfig',value:JSON.stringify(JSON.stringify({enabled:false,dailyCapacity:30,slotCapacity:5,recipes:{}}))}]},record.revision)
    let imported
    vi.stubGlobal('window',{location:{protocol:'file:',pathname:'/dist/index.html'},electronAPI:{db:{isEmpty:async()=>true,migrateFromLocalStorage:async payload=>{imported=structuredClone(payload);return {success:true}}}}})
    vi.resetModules();const {checkAndMigrate}=await import('../../src/utils/dataAccess');expect(await checkAndMigrate()).toBe(true)
    expect(imported.salesDocuments).toEqual([sale.document]);expect(imported.salesOperations).toHaveLength(1)
    expect(imported.restaurantOrders).toEqual([]);expect(imported.restaurantOperations).toEqual([])
    expect(imported.settings.find(row=>row.key==='sharedStoreId').value).toBe(state.storeId);expect(imported.settings.find(row=>row.key==='storeName').value).toBe('migration store')
    expect(JSON.parse(imported.settings.find(row=>row.key==='restaurantConfig').value).enabled).toBe(false)
    const history=readExchangeStore(imported.settings.find(row=>row.key===EXCHANGE_SETTING).value)
    expect(history.quotes).toEqual([quote.quote]);expect(()=>validateSalesRecords(imported.salesDocuments,imported.salesOperations,imported.cashLog,state.storeId,imported.products,history.quotes)).not.toThrow()
    expect(Object.hasOwn(imported,'salesEpoch')).toBe(false);expect(Object.keys(imported)).not.toContain('pos_pending_financial_v1')
  }finally{vi.unstubAllGlobals();vi.resetModules()}
})
