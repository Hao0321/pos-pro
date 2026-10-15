import {beforeEach,afterEach,expect,test,vi} from 'vitest'
import {makeCatalogue,makePartyCard,readPartyCard,readExchangeStore,planExchange,exchangeReceipt,assertExchangeReceipt,validateQuote,validateExchangeSettings,QUOTE_PRICING,EXCHANGE_SETTING,productReference,validateQuotedPurchase} from '../../electron/businessExchange.mjs'
import {prepareExternalDocument,validateExternalDraft,quotePurchaseSource} from '../../electron/quoteImport.mjs'
import {makeAgentContext,agentCommand} from '../../electron/agentDraftRules.mjs'
import {defaultRestaurantConfig} from '../../electron/restaurantRules.mjs'
import {getBrowserExchangeContext,commitBrowserExchange} from '../../src/utils/browserExchange'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {readRecords,writeRecords,DATA_KEYS,RECORD_KEY} from '../../src/utils/browserStorage'
import {executeFinancial,readPendingFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'
import {getAgentContext,writeAuditLog as writeDataAudit} from '../../src/utils/dataAccess'
import {writeAuditLog as writeSecurityAudit} from '../../src/utils/security'

const owner={role:'owner',userId:'owner',username:'Fixture Owner'},seller={id:'seller-store',name:'供應商 <script>資料</script>'},buyer={id:'buyer-store',name:'甲店'},other={id:'other-store',name:'乙店'}
const products=[{id:'beef',name:'牛肉',unit:'公斤',price:200,cost:91,stock:100,supplierId:'private-supplier',recipe:'private-recipe'}]
const state=()=>readExchangeStore(null)
const request=(overrides={})=>({id:'quote-original-0001',time:new Date().toISOString(),kind:'exchange',storeId:seller.id,expectedRevision:0,quoteId:'',expectedQuoteRevision:0,recipient:buyer,validUntil:new Date(Date.now()+7*86400000).toISOString(),items:[{productId:'beef',qty:1.125,unitPrice:180,expectedProduct:productReference(products[0])}],note:'甲店專屬條件',rememberPrices:true,pricing:QUOTE_PRICING,...overrides})
const issue=(r=request(),s=state())=>planExchange(r,s,products,seller,owner)
let values
beforeEach(()=>{
  values=new Map()
  vi.stubGlobal('localStorage',{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)})
  vi.stubGlobal('navigator',{locks:{request:(_key,action)=>action()}})
  const data=Object.fromEntries(DATA_KEYS.map(k=>[k,[]]));data.pos2_products=structuredClone(products);data.pos_business_settings=[{key:'sharedStoreId',value:seller.id},{key:'storeName',value:seller.name}]
  values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})

test('public catalogue is an explicit projection without cost, stock, recipe, supplier or private prices',async()=>{
  const doc=await makeCatalogue(products,seller)
  expect(doc.items).toEqual([{sku:'beef',name:'牛肉',unit:'公斤',unitPrice:200}])
  for(const key of ['cost','stock','recipe','supplierId','pricebooks','quotes'])expect(JSON.stringify(doc)).not.toContain('"'+key+'"')
  expect(doc.sender.name).toBe(seller.name)
})
test('catalogue revisions track public content and ignore private cost or stock changes',async()=>{
  const a=await makeCatalogue(products,seller),b=await makeCatalogue([{...products[0],stock:0,cost:1}],seller),c=await makeCatalogue([{...products[0],price:199}],seller)
  expect(a.revision).toBe(b.revision);expect(c.revision).not.toBe(a.revision)
})
test('party cards contain only an identifier and name and reject credentials or self-reported price tiers',()=>{
  expect(readPartyCard(makePartyCard(buyer))).toEqual(buyer)
  expect(()=>readPartyCard({protocol:'business-party/v1',business:{...buyer,tier:'vip'}})).toThrow()
  expect(()=>readPartyCard({...makePartyCard(buyer),token:'private'})).toThrow()
})
test('browser quotes read the store identity and name previously saved by the Agent settings adapter',async()=>{
  writeRecords({pos_business_settings:[{key:'sharedStoreId',value:JSON.stringify(seller.id)},{key:'storeName',value:JSON.stringify(seller.name)}]})
  const context=await getBrowserExchangeContext(owner)
  expect(context.storeId).toBe(seller.id);expect(context.sender.name).toBe(seller.name)
})
test('a browser store first created by quotes stays readable by the existing Agent flow',async()=>{
  writeRecords({pos_business_settings:[]})
  const quote=await getBrowserExchangeContext(owner),agent=await getAgentContext(owner)
  expect(agent.storeId).toBe(quote.storeId)
})
test('coherent price-history or remembered-price tampering still fails against the original audit receipt',()=>{
  const r=request(),a=issue(r),settings=[{key:'sharedStoreId',value:seller.id},{key:EXCHANGE_SETTING,value:JSON.stringify(a.state)}],audit=[{id:'exchange:'+r.id,action:'business-quote',detail:a.receipt}]
  expect(()=>validateExchangeSettings(settings,[],audit)).not.toThrow()
  const changed=structuredClone(a.state);changed.quotes[0].items[0].unitPrice=1;changed.quotes[0].total=1.13
  expect(()=>validateExchangeSettings([settings[0],{key:EXCHANGE_SETTING,value:JSON.stringify(changed)}],[],audit)).toThrow()
  changed.quotes=structuredClone(a.state.quotes);changed.pricebooks[0].prices[0].unitPrice=1
  expect(()=>validateExchangeSettings([settings[0],{key:EXCHANGE_SETTING,value:JSON.stringify(changed)}],[],audit)).toThrow()
})
test('routine audit retention preserves historical quote and stock receipts beyond the ordinary display limit',async()=>{
  const count={id:'old-stock-operation',time:new Date().toISOString(),kind:'stocktake',counts:[{id:'beef',stock:101,expectedStock:100}]}
  expect((await commitBrowserInventory(count,owner)).success).toBe(true)
  expect((await commitBrowserExchange(request(),owner)).success).toBe(true)
  writeRecords({pos_audit_log:[...Array.from({length:2000},(_,i)=>({id:'ordinary-'+i,action:'LOGIN',detail:{}})),...readRecords().data.pos_audit_log]})
  await writeDataAudit({id:'new-ordinary',action:'LOGIN',detail:{}})
  expect(writeSecurityAudit('LOGIN',owner)).not.toBe(null)
  const data=readRecords().data
  expect(data.pos_audit_log.some(r=>r.id==='stock-operation:old-stock-operation')).toBe(true)
  expect(data.pos_audit_log.some(r=>r.id==='exchange:quote-original-0001')).toBe(true)
  expect((await commitBrowserInventory(count,owner)).success).toBe(true)
  expect(readRecords().data.pos2_products[0].stock).toBe(101)
})
test('two recipients retain separate prices and one exported quote never carries the other pricebook',()=>{
  const a=issue(),b=issue(request({id:'quote-other-0002',recipient:other,expectedRevision:1,items:[{...request().items[0],unitPrice:170}],note:'乙店專屬條件'}),a.state)
  expect(b.state.pricebooks.map(p=>p.prices[0].unitPrice)).toEqual([180,170])
  expect(b.quote.recipient).toEqual(other);expect(JSON.stringify(b.quote)).not.toContain('甲店');expect(JSON.stringify(b.quote)).not.toContain('180')
  expect(a.quote.total).toBe(202.5);expect(b.quote.total).toBe(191.25)
})
test('revisions preserve the exact earlier quote and price changes never rewrite it',()=>{
  const a=issue(),snapshot=structuredClone(a.quote),r=request({id:'revision-operation-02',quoteId:a.quote.id,expectedQuoteRevision:1,expectedRevision:1,items:[{...request().items[0],unitPrice:175}]})
  const b=issue(r,a.state)
  expect(b.state.quotes[0]).toEqual(snapshot);expect(b.quote.id).toBe(a.quote.id);expect(b.quote.revision).toBe(2);expect(b.quote.createdAt).toBe(a.quote.createdAt);expect(b.state.pricebooks[0].prices[0].unitPrice).toBe(175)
})
test('a revision cannot change its recipient or branch from an old version',()=>{
  const a=issue()
  for(const extra of [{recipient:other,expectedQuoteRevision:1},{expectedQuoteRevision:0}])expect(()=>issue(request({quoteId:a.quote.id,expectedRevision:1,...extra}),a.state)).toThrow(/版本|收件人/)
})
test('stale state and changed product price or unit reject before modifying the supplied state',()=>{
  const a=issue(),before=structuredClone(a.state)
  expect(()=>issue(request(),a.state)).toThrow(/更新/)
  for(const expectedProduct of [{...productReference(products[0]),price:201},{...productReference(products[0]),unit:'箱'}])expect(()=>issue(request({items:[{...request().items[0],expectedProduct}]}))).toThrow(/更新/)
  expect(a.state).toEqual(before)
})
test('original request replay returns its immutable revision and changed input is rejected',()=>{
  const r=request(),a=issue(r),result=exchangeReceipt(r,a.receipt,a.state)
  expect(result.quote).toEqual(a.quote);expect(()=>assertExchangeReceipt(r,result)).not.toThrow()
  expect(()=>exchangeReceipt({...r,note:'changed'},a.receipt,a.state)).toThrow(/編號/)
  expect(()=>assertExchangeReceipt(r,{...result,quote:{...a.quote,recipient:other}})).toThrow(/回覆/)
})
test('staff, wrong store and self-quotation fail before any plan can be created',()=>{
  expect(()=>planExchange(request(),state(),products,seller,{role:'staff'})).toThrow(/權限/)
  expect(()=>issue(request({storeId:'forged'}))).toThrow(/店面/)
  expect(()=>issue(request({recipient:seller}))).toThrow(/另一間/)
})
test.each(['USD','CNY'])('quote currency %s is rejected without automatic conversion',currency=>{
  expect(()=>validateQuote({...issue().quote,currency})).toThrow(/台幣/)
})
test.each(['net-plus-tax','buyer-vip','unknown'])('unsupported pricing %s is rejected',pricing=>{
  expect(()=>issue(request({pricing}))).toThrow(/條件/)
})
test('expired, future-dated and wrong-recipient quotes are rejected',()=>{
  const q=issue().quote
  expect(()=>validateQuote(q,{now:Date.parse(q.validUntil)})).toThrow(/過期/)
  expect(()=>validateQuote(q,{now:Date.parse(q.issuedAt)-300001})).toThrow(/生效/)
  expect(()=>validateQuote(q,{recipientStoreId:other.id})).toThrow(/另一間/)
})
test('quote instants require a timezone and reject calendar rollover',()=>{
  const quote=issue().quote
  for(const createdAt of ['2026-10-16T12:00:00','2026-02-30T12:00:00Z','2026-13-01T12:00:00Z'])expect(()=>validateQuote({...quote,createdAt})).toThrow(/日期/)
})
test('explicit timezone offsets describe the same quote validity instant',()=>{
  const quote=issue().quote,time=Date.parse(quote.issuedAt),offset=new Date(time+8*3600000).toISOString().replace('Z','+08:00')
  expect(()=>validateQuote({...quote,createdAt:offset,issuedAt:offset},{now:time})).not.toThrow()
})
test('negative prices, excess precision, duplicate products, unknown fields and wrong totals reject',()=>{
  const q=issue().quote
  for(const changed of [{total:q.total+.01},{items:[...q.items,...q.items]},{items:[{...q.items[0],unitPrice:-1}]},{items:[{...q.items[0],qty:.0001}]},{instructions:'execute'},{recipient:{...buyer,priceTier:'vip'}}])expect(()=>validateQuote({...q,...changed})).toThrow()
})
test('fractional quantities use exact half-up cents and no hidden fees',()=>{
  const r=request({items:[{...request().items[0],qty:1.125,unitPrice:12.34}]}),q=issue(r).quote
  expect(q.total).toBe(13.88);expect(q.pricing).toBe('all-inclusive-unit')
})
test('history rejects missing revisions, mixed recipient families and corrupt pricebooks',()=>{
  const a=issue()
  for(const changed of [{revision:2},{quotes:[{...a.quote,revision:2}]},{pricebooks:[...a.state.pricebooks,...a.state.pricebooks]}])expect(()=>readExchangeStore({...a.state,...changed})).toThrow()
  expect(()=>validateExchangeSettings([{key:EXCHANGE_SETTING,value:JSON.stringify(a.state)},{key:'sharedStoreId',value:other.id}])).toThrow(/身份/)
})
test('browser save and reply loss preserve one original quote and its per-customer price across retry',async()=>{
  const input=request();delete input.id;delete input.time
  await expect(executeFinancial('exchange',input,async r=>{await commitBrowserExchange(r,owner);throw Error('lost reply')})).rejects.toThrow(/尚未確認/)
  const pending=readPendingFinancial();expect(pending.kind).toBe('exchange')
  const result=await executeFinancial('exchange',input,r=>commitBrowserExchange(r,owner))
  expect(result.quote.id).toBe(pending.request.id);expect(readPendingFinancial()).toBe(null)
  const c=await getBrowserExchangeContext(owner);expect(c.state.quotes).toHaveLength(1);expect(c.state.pricebooks[0].prices[0].unitPrice).toBe(180)
})
test('invalid acknowledgement keeps the journal and quota failure cannot partially save a quote',async()=>{
  const r=request(),a=issue(r),input={...r};delete input.id;delete input.time
  await expect(executeFinancial('exchange',input,async command=>({...exchangeReceipt(r,a.receipt,a.state),receipt:{...a.receipt,id:command.id}}))).rejects.toThrow()
  expect(values.has(FINANCIAL_PENDING)).toBe(true);values.delete(FINANCIAL_PENDING)
  const original=values.get(RECORD_KEY),write=localStorage.setItem
  localStorage.setItem=(key,value)=>{if(key===RECORD_KEY)throw Error('quota');write(key,value)}
  expect((await commitBrowserExchange(r,owner)).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(original)
})
async function buyerContext(){
  return makeAgentContext({storeId:buyer.id,products:[{id:'local-beef',name:'牛肉',unit:'公斤',price:250,cost:150,stock:3}],suppliers:[{id:'supplier',name:seller.name}],restaurantConfig:defaultRestaurantConfig(),role:'owner'})
}
test('quotation SKUs belong to the seller and cannot collide with an unrelated local product ID',async()=>{
  const context=await buyerContext();context.products.push({...context.products[0],id:'beef',name:'米'})
  const prepared=await prepareExternalDocument(issue().quote,context)
  expect(prepared.draft.items[0].productId).toBe('local-beef')
})
test('a seller SKU that collides locally can still be explicitly mapped and remembered for that seller',async()=>{
  const context=await buyerContext();context.products.push({...context.products[0],id:'beef',name:'米'})
  const quote=issue().quote;quote.items[0].name='供應商的牛肉名稱'
  const unmatched=await prepareExternalDocument(quote,context)
  expect(unmatched.draft).toBe(null)
  const mapped=await prepareExternalDocument(quote,context,{'sku:beef':'local-beef'})
  expect(mapped.draft.items[0].productId).toBe('local-beef');expect(mapped.chosen).toEqual({'sku:beef':'local-beef'})
})
test('an older valid quote maps to a purchase at the quoted cost without changing the local selling price',async()=>{
  const q=issue().quote,old=new Date(Date.now()-3*86400000).toISOString();q.createdAt=old;q.issuedAt=old
  const context=await buyerContext(),result=await prepareExternalDocument(q,context)
  result.draft.supplierId='supplier';result.draft.date=new Date().toISOString().slice(0,10)
  const preview=validateExternalDraft(result.draft,context,q)
  expect(preview.items[0].price).toBe(180);expect(context.products[0].price).toBe(250);expect(preview.draft.issuedAt).toBe(old)
})
test('quote revisions share an operation identity, and mapping or units require explicit resolution',async()=>{
  const a=issue(),b=issue(request({id:'rev-02',quoteId:a.quote.id,expectedRevision:1,expectedQuoteRevision:1,items:[{...request().items[0],unitPrice:175}]}),a.state),context=await buyerContext()
  const first=await prepareExternalDocument(a.quote,context),second=await prepareExternalDocument(b.quote,context)
  expect(second.draft.id).toBe(first.draft.id);expect(second.draft.issuedAt).toBe(first.draft.issuedAt);expect(second.draft.note).not.toBe(first.draft.note)
  const unknown={...context,products:[{...context.products[0],name:'different'}]},unresolved=await prepareExternalDocument(a.quote,unknown)
  expect(unresolved.draft).toBe(null);expect(unresolved.unresolved).toHaveLength(1)
  expect((await prepareExternalDocument(a.quote,unknown,{'sku:beef':'local-beef'})).draft.items[0].productId).toBe('local-beef')
  await expect(prepareExternalDocument(a.quote,{...context,products:[{...context.products[0],unit:'箱'}]})).rejects.toThrow(/單位/)
})
test('a price catalogue is not mistaken for an order',async()=>{
  await expect(prepareExternalDocument(await makeCatalogue(products,seller),await buyerContext())).rejects.toThrow(/價目目錄/)
})
test('quote provenance is enforced at purchase commit and restored unchanged with the business records',async()=>{
  const q=issue().quote,context=await buyerContext(),prepared=await prepareExternalDocument(q,context)
  prepared.draft.supplierId='supplier';prepared.draft.date=new Date().toISOString().slice(0,10)
  const command=agentCommand(validateExternalDraft(prepared.draft,context,q));command.input.sourceQuote=quotePurchaseSource(q,prepared.chosen)
  const initial=readRecords();writeRecords({pos2_products:[{id:'local-beef',name:'牛肉',unit:'公斤',price:250,cost:150,stock:3}],pos_suppliers:[{id:'supplier',name:seller.name,catalog:[]}],pos_business_settings:[{key:'sharedStoreId',value:buyer.id}]},initial.revision)
  const request={...command.input,...command.identity,kind:command.kind},before=readRecords().data
  const r=await commitBrowserInventory(request,owner);expect(r.success,r.error).toBe(true)
  expect(r.purchase.procurement.sourceQuote.document).toEqual(q)
  expect(readRecords().data.pos2_products).toEqual(before.pos2_products);expect(readRecords().data.pos2_cash_log).toEqual(before.pos2_cash_log);expect(readRecords().data.pos2_orders).toEqual(before.pos2_orders)
  const duplicate=await commitBrowserInventory({...request,id:'new-attempt',purchase:{...request.purchase,id:'new-po'}},owner);expect(duplicate.success).toBe(false)
  expect((await commitBrowserInventory(request,owner)).success).toBe(true)
  const bad=structuredClone(r.purchase);bad.items[0].unitCost=179
  expect(()=>validateQuotedPurchase(bad,bad.procurement.sourceQuote)).toThrow()
})
