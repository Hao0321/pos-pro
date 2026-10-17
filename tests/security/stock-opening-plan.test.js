import {test,expect} from 'vitest'
import {prepareStockOpening} from '../../electron/stockOpening.mjs'
import {planStockOpening,planOpeningCostPrice,stockCostCommand,stockOpeningKey,assertStockCustodyMatchesBook,STOCK_LEDGER_ERRORS} from '../../electron/stockOpeningPlan.mjs'
import {planCostCustody} from '../../electron/stockCustody.mjs'
import messages from '../../public/i18n/messages.mjs'
const product=(id,stock,cost)=>({id,name:id,unit:'袋',stock,cost})
const products=[product('rice',9,20),product('unknown',2,0),product('zero',1,0)]
const held={id:'reservation',status:'cooking',version:2,saleId:'',startedAt:'2026-10-16T00:00:00Z',allocations:[{id:'rice',qty:1,unitCost:30}]}
const preview=(patch={})=>prepareStockOpening({storeId:'store',epoch:'epoch',products,orders:[],topups:[],wasteLog:[],purchases:[],salesDocuments:[],customerEntries:[],supplierEntries:[],manualJournal:[{id:'old-inventory',type:'manual',date:'2026-10-15',lines:[{account:'1211',debit:80,credit:0},{account:'3901',debit:0,credit:80}]}],restaurantEntries:[held],...patch}).preview
const request=(patch={})=>({protocol:'pos-stock-cost/v1',action:'open',id:'open',time:'2026-10-16T01:00:00.000Z',storeId:'store',epoch:'epoch',snapshotDigest:'sha256:'+'0'.repeat(64),reviewed:true,overrides:[],...patch})
const date='2026-10-16',freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}

test('opening retains unpaid WIP, distinguishes unknown from confirmed zero, and bridges only the existing GL difference',()=>{
 const source=freeze(preview()),input=freeze(request({overrides:[{key:stockOpeningKey('available','zero'),valueCents:0}]})),before=JSON.stringify(source)
 const plan=planStockOpening(source,input,date)
 expect(plan.valuation).toMatchObject({ownedKnownValueCents:21000,ownedValueCents:null})
 expect(plan.custody.sources.find(row=>row.productId==='unknown').valueCents).toBeNull()
 expect(plan.custody.sources.find(row=>row.productId==='zero').valueCents).toBe(0)
 expect(plan.journal).toMatchObject({amountUnit:'cents',costComplete:false,lines:[{account:'1211',debitCents:13000,creditCents:0},{account:'3901',debitCents:0,creditCents:13000}]})
 expect(plan.custody.positions.find(row=>row.owner.stage==='reserved').owner.referenceId).toBe('reservation')
 expect(JSON.stringify(source)).toBe(before)
})
test('explicit opening costs change the bridge without rewriting current quantities or frozen reservation prices',()=>{
 const input=request({overrides:[{key:stockOpeningKey('available','rice'),valueCents:10000}]}),plan=planStockOpening(preview(),input,date)
 expect(plan.valuation.ownedKnownValueCents).toBe(13000);expect(plan.journal.lines[0].debitCents).toBe(5000)
 expect(assertStockCustodyMatchesBook(plan.custody,products,[held])).toBe(true)
})
test('opening can preserve an explicitly unknown nonzero reference instead of silently accepting it',()=>{
 const plan=planStockOpening(preview(),request({overrides:[{key:stockOpeningKey('available','rice'),valueCents:null}]}),date)
 expect(plan.custody.sources.find(row=>row.productId==='rice'&&row.valueCents===null)).toBeTruthy()
 expect(plan.journal.lines).toEqual([{account:'1211',debitCents:0,creditCents:5000},{account:'3901',debitCents:5000,creditCents:0}])
})
test('the opening queue states a cutover policy and restores a legacy hold before the available snapshot',()=>{
 const plan=planStockOpening(preview(),request(),date),from=plan.custody.positions.find(row=>row.owner.stage==='reserved').owner
 const next=planCostCustody(plan.custody,{expectedSequence:0,steps:[{kind:'move',from,to:{stage:'available',locationId:'main',referenceId:''},productId:'rice',unit:'袋',quantityUnits:1000}]})
 expect(next.state.positions.find(row=>row.owner.stage==='available').segments[0].sourceId).toBe(plan.custody.sources[0].id)
})
test('a later confirmation allocates the original unknown source to assets, sold, wasted and supplier-returned quantities without any cash journal',()=>{
 const source=preview({products:[product('pending',10,0)],restaurantEntries:[],manualJournal:[]}),opened=planStockOpening(source,request(),date)
 const owner=stage=>({stage,locationId:'main',referenceId:stage==='available'?'':'original-'+stage}),steps=[['reserved',2000],['consumed',3000],['wasted',1000],['supplierReturned',1000]].map(([stage,quantityUnits])=>({kind:'move',from:owner('available'),to:owner(stage),productId:'pending',unit:'袋',quantityUnits}))
 const moved=planCostCustody(opened.custody,{expectedSequence:0,steps}),projection={...opened,custody:moved.state}
 const priced=planOpeningCostPrice(projection,{protocol:'pos-stock-cost/v1',action:'price',id:'price',time:request().time,storeId:'store',epoch:'epoch',expectedSequence:1,sourceId:opened.custody.sources[0].id,valueCents:10000,reviewed:true},date)
 expect(priced.journal.lines).toEqual([{account:'1211',debitCents:5000,creditCents:0},{account:'5101',debitCents:3000,creditCents:0},{account:'5208',debitCents:1000,creditCents:0},{account:'5204',debitCents:1000,creditCents:0},{account:'3901',debitCents:0,creditCents:10000}])
 expect(priced.valuation.ownedValueCents).toBe(5000);expect(priced.valuation.totalSourceValueCents).toBe(10000)
 expect(opened.custody.sources[0].valueCents).toBeNull()
})
test('unknown overrides, duplicate overrides, a zero-quantity source and forged fields are rejected',()=>{
 for(const overrides of [[{key:'missing',valueCents:0}],[{key:stockOpeningKey('available','rice'),valueCents:0},{key:stockOpeningKey('available','rice'),valueCents:1}],[{key:stockOpeningKey('available','empty'),valueCents:0}]])expect(()=>planStockOpening(preview({products:[...products,product('empty',0,0)]}),request({overrides}),date)).toThrow()
 for(const change of [{actor:{role:'owner'}},{reviewed:false},{snapshotDigest:'fake'},{overrides:[{key:'missing',valueCents:-1}]},{time:'2026-10-16'}])expect(()=>stockCostCommand(request(change))).toThrow()
})
test('accessors and hidden properties cannot execute while inspecting a cost command',()=>{
 let accessed=false;const input=request();Object.defineProperty(input,'action',{enumerable:true,get(){accessed=true;return 'open'}})
 expect(()=>stockCostCommand(input)).toThrow();expect(accessed).toBe(false)
 const hidden=request();Object.defineProperty(hidden,'actor',{value:'forged',enumerable:false});expect(()=>stockCostCommand(hidden)).toThrow()
})
test('an unrepresentable legacy balance or bridge prevents an apparently successful opening',()=>{
 expect(()=>planStockOpening({...preview(),referenceInventoryBalanceCents:null},request(),date)).toThrow()
 const source={...preview({products:[product('max',1,1)],restaurantEntries:[]}),referenceInventoryBalanceCents:-Number.MAX_SAFE_INTEGER}
 expect(()=>planStockOpening(source,request({overrides:[{key:stockOpeningKey('available','max'),valueCents:Number.MAX_SAFE_INTEGER}]}),date)).toThrow()
})
test('a large balanced opening journal persists exact integer cents when decimal currency would lose a cent',()=>{
 const valueCents=9007199254740971,source=preview({products:[product('large',1,1)],restaurantEntries:[],manualJournal:[]})
 const {journal}=planStockOpening(source,request({overrides:[{key:stockOpeningKey('available','large'),valueCents}]}),date)
 expect(Math.round(valueCents/100*100)).toBe(valueCents-1)
 const saved=JSON.parse(JSON.stringify(journal));expect(saved.amountUnit).toBe('cents');expect(saved.lines[0].debitCents).toBe(valueCents)
 expect(saved.lines.reduce((sum,row)=>sum+BigInt(row.debitCents)-BigInt(row.creditCents),0n)).toBe(0n)
 expect(saved.lines.every(row=>!Object.hasOwn(row,'debit')&&!Object.hasOwn(row,'credit'))).toBe(true)
})
test('the projection is checked against both available stock and every unpaid reservation',()=>{
 const plan=planStockOpening(preview(),request(),date)
 for(const next of [[products.map(row=>row.id==='rice'?{...row,stock:8}:row),[held]],[products,[{...held,saleId:'now-paid'}]],[products.map(row=>({...row,unit:'箱'})),[held]],[products.map(row=>({...row,stock:NaN})),[held]]])expect(()=>assertStockCustodyMatchesBook(plan.custody,...next)).toThrow()
 expect(assertStockCustodyMatchesBook(plan.custody,products.map(row=>({...row,cost:999,name:'new name'})),[held])).toBe(true)
})
test('every cost-ledger instruction and failure has all three translated display strings',()=>{
 for(const text of [...Object.values(STOCK_LEDGER_ERRORS),'庫存成本開帳差額','期初庫存成本補登'])expect(messages[text]).toHaveLength(3)
})
