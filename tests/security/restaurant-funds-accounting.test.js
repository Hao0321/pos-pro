import {test,expect} from 'vitest'
import {planRestaurant} from '../../electron/restaurantRules.mjs'
import {automaticBusinessJournal} from '../../electron/businessJournal.mjs'
import {orderToJournalEntries,buildBalanceSheet,buildPnL} from '../../electron/accountingCore.mjs'
import {prepareStockOpening} from '../../electron/stockOpening.mjs'

const owner={userId:'owner',username:'Owner',role:'owner'}
function fixture(){
 let ordinal=0,data={storeId:'store',epoch:'epoch',date:'2026-10-17',now:Date.parse('2026-10-17T12:00:00+08:00'),products:[{id:'bowl',name:'Bowl',price:95,cost:4,stock:0,unit:'份'},{id:'premium',name:'Premium',price:120,cost:5,stock:0,unit:'份'},{id:'rice',name:'Rice',price:10,cost:10,stock:1,unit:'kg'},{id:'box',name:'Box',price:3,cost:3,stock:10,unit:'個'}],entries:[],operations:[],orders:[],waste:[],cashLogs:[],shifts:[{id:'shift',status:'open'}],settings:{},config:{enabled:true,fundsEnabled:true,dailyCapacity:10,slotCapacity:5,recipes:{bowl:[{id:'rice',qty:.1},{id:'box',qty:1}],premium:[{id:'rice',qty:.2},{id:'box',qty:1}]}}}
 function call(action,fields={}){
  const input={id:'operation-'+(++ordinal),kind:'restaurant',action,time:new Date(data.now).toISOString(),storeId:data.storeId,epoch:data.epoch,...(action==='create'?{}:{entryId:data.entries[0].id,expectedVersion:data.entries[0].version}),...fields}
  const plan=planRestaurant(input,data,owner,{})
  data={...plan.next,operations:[...data.operations,plan.receipt]};return plan
 }
 call('create',{day:data.date,slot:'12:00',channel:'walkin',customer:'Guest',contact:'',note:'',items:[{id:'bowl',qty:2,price:95},{id:'premium',qty:1,price:120}]})
 return {
  call,get data(){return data},
  day(date){data={...data,date,now:Date.parse(date+'T12:00:00+08:00')}},
  collect(){call('funds-receive',{amount:100,paid:150,payMethod:'cash',shiftId:'shift'});call('funds-receive',{amount:210,paid:210,payMethod:'card',shiftId:'shift'})},
  fulfil(){call('advance',{status:'cooking'});call('advance',{status:'ready'});return call('advance',{status:'completed'})},
  source(){return {storeId:data.storeId,epoch:data.epoch,products:data.products,orders:data.orders,restaurantEntries:data.entries,topups:[],wasteLog:data.waste,purchases:[],salesDocuments:[],customerEntries:[],supplierEntries:[],manualJournal:[]}},
  journal(){return automaticBusinessJournal(this.source())},
 }
}
const account=(rows,id)=>Math.round(rows.flatMap(row=>row.lines).filter(row=>row.account===id).reduce((sum,line)=>sum+line.debit-line.credit,0)*100)/100

test('the application journal includes actual restaurant advances and its balance sheet recognizes the liability',()=>{
 const h=fixture();h.collect();const journal=h.journal()
 expect(h.data.orders).toEqual([]);expect(account(journal,'1101')).toBe(100);expect(account(journal,'1103')).toBe(210);expect(account(journal,'2193')).toBe(-310);expect(account(journal,'4101')).toBe(0)
 const balance=buildBalanceSheet(journal,'2026-10-17')
 expect(balance).toMatchObject({balanced:true,complete:true,totalAssets:310,totalLiabilities:310})
 expect(balance.sections.liability.items).toContainEqual(expect.objectContaining({code:'2193',name:'餐飲預收款',amount:310}))
 expect(buildPnL(journal,'2026-10-17','2026-10-17').revenue).toBe(0)
})

test('fulfilment uses the application journal to release the original liability on its own date without collecting again',()=>{
 const h=fixture();h.collect();h.day('2026-10-18');h.fulfil();const journal=h.journal()
 expect(account(journal,'1101')).toBe(100);expect(account(journal,'1103')).toBe(210);expect(account(journal,'2193')).toBe(0);expect(account(journal,'4101')).toBe(-310);expect(account(journal,'5101')).toBe(13)
 expect(buildPnL(journal,'2026-10-17','2026-10-17').revenue).toBe(0)
 expect(buildPnL(journal,'2026-10-18','2026-10-18')).toMatchObject({revenue:310,cogs:13})
 expect(buildBalanceSheet(journal,'2026-10-17')).toMatchObject({totalAssets:310,totalLiabilities:310})
 expect(new Set(journal.map(row=>row.id)).size).toBe(journal.length)
})

test('a prepared partial then full cancellation reverses revenue and source tenders once while retaining real waste',()=>{
 const h=fixture();h.collect();h.fulfil();h.day('2026-10-19')
 h.call('cancel-part',{quantities:[{id:'premium',qty:1}],reason:'one cancelled',shiftId:'shift'})
 let rows=h.journal();expect(account(rows,'1101')).toBe(100);expect(account(rows,'1103')).toBe(90);expect(account(rows,'2193')).toBe(0);expect(account(rows,'4101')).toBe(-190);expect(account(rows,'5101')).toBe(8);expect(account(rows,'5208')).toBe(5)
 h.call('cancel',{reason:'remaining cancelled',shiftId:'shift'});rows=h.journal()
 for(const code of ['1101','1103','2193','4101','5101'])expect(account(rows,code)).toBe(0)
 expect(account(rows,'5208')).toBe(13);expect(buildPnL(rows,'2026-10-17','2026-10-19').netIncome).toBe(-13)
})

test('source-funded recognition cannot fall back to a regular cash sale when its original is missing or changed',()=>{
 const h=fixture();h.collect();h.fulfil();const order=h.data.orders[0]
 expect(()=>orderToJournalEntries(order,h.data.products)).toThrow()
 expect(()=>automaticBusinessJournal({...h.source(),restaurantEntries:[]})).toThrow()
 expect(()=>automaticBusinessJournal({...h.source(),orders:[{...order,total:311}]})).toThrow()
 expect(orderToJournalEntries(order,h.data.products,h.data.entries[0])).toEqual(expect.arrayContaining([expect.objectContaining({type:'auto_restaurant_sale'})]))
})

test('cost opening keeps an unfulfilled funded booking reserved and freezes the same advance journal as the accounting screen',()=>{
 const h=fixture();h.collect();const result=prepareStockOpening(h.source()),material=JSON.parse(result.material)
 expect(result.preview.unpaidReservations).toHaveLength(1);expect(result.preview.paidLegacyReservations).toEqual([])
 expect(material.legacyJournal).toEqual(h.journal());expect(account(material.legacyJournal,'2193')).toBe(-310)
 expect(result.preview.unpaidReservations[0].allocations).toEqual(expect.arrayContaining([expect.objectContaining({productId:'rice',quantityUnits:400}),expect.objectContaining({productId:'box',quantityUnits:3000})]))
})
