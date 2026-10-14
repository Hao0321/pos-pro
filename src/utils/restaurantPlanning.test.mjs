import {describe,it,expect} from 'vitest'
import {initialState,createOrder,moveOrder,payOrder,cancelOrder,updateIngredient,updateRecipes,updatePlan,prepSummary,summary,availability,validateState,dayUsed,slotUsed} from '../../public/scenarios/donburi/model.mjs'
const req=(qty=1,teaQty=qty,changes={})=>({day:'2027-01-05',slot:'11:30',channel:'preorder',fulfillment:'pickup',customer:'fixture',phone:'',address:'',note:'',lines:[{id:'pork',qty,teaQty}],...changes})
describe('isolated restaurant rehearsal business controls',()=>{
  it('keeps cooked cancellation in production capacity but releases uncooked cancellation',()=>{
    let s=initialState();s.dailyLimit=1;s.slotLimit=1
    s=createOrder(s,req(1,0),'order');const oid=s.orders[0].id
    const uncooked=cancelOrder(s,oid,false,'uncooked');expect(dayUsed(uncooked)).toBe(0);expect(slotUsed(uncooked,s.day,'11:30')).toBe(0)
    s=moveOrder(s,oid,'cook');s=cancelOrder(s,oid,false,'cooked')
    expect(dayUsed(s)).toBe(1);expect(slotUsed(s,s.day,'11:30')).toBe(1)
    expect(()=>createOrder(s,req(1,0,{slot:'11:45'}),'over-day')).toThrow(/限量已滿/)
    s=updatePlan(s,s.day,2,1,{pork:95,beef:115,tea:10},'more-daily')
    expect(()=>createOrder(s,req(1,0),'over-slot')).toThrow(/時段已滿/)
    s=createOrder(s,req(1,0,{slot:'11:45'}),'second');s=moveOrder(s,s.orders[1].id,'second-cook');s=cancelOrder(s,s.orders[1].id,false,'second-cancel')
    expect(()=>updatePlan(s,s.day,1,1,{pork:95,beef:115,tea:10},'lower-limit')).toThrow(/已製作量/)
  })
  it.each([
    ['negative total',s=>s.orders[0].total=-95],
    ['wrong total',s=>s.orders[0].total=999],
    ['fractional bowls',s=>s.orders[0].lines[0].qty=1.5],
    ['missing material',s=>delete s.orders[0].requirements.rice],
    ['foreign material',s=>s.orders[0].requirements.unknown=1],
    ['negative historical material',s=>s.orders[0].requirements.pork=-120],
    ['duplicate ingredient',s=>s.ingredients[1]=structuredClone(s.ingredients[0])],
    ['negative recipe',s=>s.menu[0].recipe.pork=-120],
    ['reused next number',s=>s.nextNumber=1],
    ['unpaid delivered',s=>{s.orders[0].status='completed';s.orders[0].materialCommitted=true}],
    ['forged payment',s=>s.orders[0].payment='paid'],
    ['wrong tea packaging',s=>s.orders[0].requirements.cup=0],
    ['malformed operation history',s=>s.operations.order.signature=null],
  ])('rejects persisted %s before accepting another order and preserves the raw state',(_label,corrupt)=>{
    const s=createOrder(initialState(),req(),'order');corrupt(s);const bytes=JSON.stringify(s)
    expect(()=>validateState(JSON.parse(bytes))).toThrow()
    expect(()=>createOrder(s,req(),'another')).toThrow();expect(JSON.stringify(s)).toBe(bytes)
  })
  it('retains valid historical prices and quantities after changing the menu',()=>{
    let s=createOrder(initialState(),req(),'order');s=updatePlan(s,s.day,30,5,{pork:110,beef:125,tea:15},'prices');s=updateRecipes(s,{rice:100,meat:180,onion:80,sauce:100},'recipe')
    expect(validateState(JSON.parse(JSON.stringify(s))).orders[0]).toMatchObject({total:105,requirements:{rice:90,pork:120}})
  })
  it('preorders and walkins reserve the same stock and release it before cooking on cancellation',()=>{
    let s=initialState();s.ingredients.find(i=>i.id==='pork').stock=120
    s=createOrder(s,req(),'first');expect(availability(s).pork).toBe(0)
    expect(()=>createOrder(s,req(1,0,{channel:'walkin'}),'second')).toThrow(/豬肉片不足/)
    s=cancelOrder(s,s.orders[0].id,false,'cancel');expect(availability(s).pork).toBe(120)
  })
  it('uses bowl capacity rather than number of tickets and rejects missing delivery details',()=>{
    let s=initialState();s=createOrder(s,req(4),'four')
    expect(()=>createOrder(s,req(2),'six')).toThrow(/時段已滿/)
    expect(()=>createOrder(initialState(),req(1,1,{fulfillment:'delivery'}),'bad-delivery')).toThrow(/電話和地址/)
    for(const qty of [-1,0,1.5,Infinity])expect(()=>createOrder(initialState(),req(qty,0),'bad-quantity')).toThrow()
  })
  it('deduplicates committed creation and rejects the same operation ID with changed contents',()=>{
    const s=createOrder(initialState(),req(),'stable')
    expect(createOrder(validateState(JSON.parse(JSON.stringify(s))),req(),'stable')).toEqual(s)
    expect(()=>createOrder(s,req(2),'stable')).toThrow(/內容不同/)
    for(const id of ['__proto__','constructor','prototype'])expect(()=>createOrder(initialState(),req(),id)).toThrow(/操作編號/)
  })
  it('deducts raw ingredients once, freezes quantities and rejects a stale preparation command',()=>{
    let s=createOrder(initialState(),req(),'order');const order=s.orders[0],stock=s.ingredients.find(i=>i.id==='pork').stock
    s=updateRecipes(s,{rice:100,meat:200,onion:50,sauce:100},'new-recipe')
    expect(s.orders[0].requirements.pork).toBe(120)
    s=moveOrder(s,order.id,'cook','accepted');expect(s.ingredients.find(i=>i.id==='pork').stock).toBe(stock-120)
    expect(moveOrder(s,order.id,'cook','accepted')).toEqual(s)
    expect(()=>moveOrder(s,order.id,'stale-cook','accepted')).toThrow(/進度已改變/)
  })
  it('separates paid, ready and delivered; refuses delivery completion before confirmed receipt',()=>{
    let s=createOrder(initialState(),req(),'order'),oid=s.orders[0].id
    s=moveOrder(s,oid,'cook');s=moveOrder(s,oid,'ready')
    expect(()=>moveOrder(s,oid,'serve')).toThrow(/尚未確認實收/)
    s=payOrder(s,oid,'cash',200,'cash');expect(s.orders[0].change).toBe(95)
    expect(payOrder(s,oid,'cash',200,'cash')).toEqual(s)
    s=moveOrder(s,oid,'serve');expect(summary(s).served).toBe(105)
  })
  it('supports delivery awaiting cash collection without confusing dispatch and completed sale',()=>{
    let s=createOrder(initialState(),req(1,0,{fulfillment:'delivery',phone:'fixture-number',address:'fixture-address'}),'delivery'),oid=s.orders[0].id
    s=moveOrder(s,oid,'cook');s=moveOrder(s,oid,'ready');s=moveOrder(s,oid,'dispatch')
    expect(s.orders[0].status).toBe('dispatched');expect(summary(s).served).toBe(0)
    expect(()=>moveOrder(s,oid,'delivered')).toThrow(/尚未確認實收/)
    s=payOrder(s,oid,'transfer',95,'paid');s=moveOrder(s,oid,'delivered');expect(summary(s).served).toBe(95)
  })
  it('refunds paid cancellation once and keeps cooked materials as loss instead of restoring raw meat',()=>{
    let s=createOrder(initialState(),req(),'order'),oid=s.orders[0].id
    s=payOrder(s,oid,'cash',105,'pay');s=moveOrder(s,oid,'cook');const stock=s.ingredients.find(i=>i.id==='pork').stock
    expect(()=>cancelOrder(s,oid,false,'missing-refund')).toThrow(/退款/)
    s=cancelOrder(s,oid,true,'refund');expect(summary(s).refunds).toBe(105);expect(summary(s).lossBowls).toBe(1)
    expect(cancelOrder(s,oid,true,'refund')).toEqual(s);expect(s.ingredients.find(i=>i.id==='pork').stock).toBe(stock)
  })
  it('aggregates 15 pork and 15 beef with tea without double-counting cooked rice or adding eggs',()=>{
    let s=initialState();s.slotLimit=30
    s=createOrder(s,req(15,15,{lines:[{id:'pork',qty:15,teaQty:15},{id:'beef',qty:15,teaQty:15}]}),'thirty')
    expect(prepSummary(s).ingredients).toEqual({rice:2700,pork:1800,beef:1800,onion:1800,sauce:3300,scallion:90,box:30,tea:9000,cup:30})
    expect(()=>createOrder(s,req(1,0,{slot:'12:00'}),'thirtyone')).toThrow(/今日限量已滿/)
  })
  it('does not represent missing prices as zero margin and never rewrites a historical cooking cost',()=>{
    let s=createOrder(initialState(),req(),'unknown');s=moveOrder(s,s.orders[0].id,'cook')
    expect(summary(s).usedCost).toBeNull();expect(summary(s).missingCosts).toContain('豬肉片')
    s=updateIngredient(s,'pork',s.ingredients.find(i=>i.id==='pork').stock,.2,'cost-later');expect(s.orders[0].cost).toBeNull()
    let priced=initialState();priced.ingredients.forEach(i=>i.unitPrice=i.unit==='套'?1:.01)
    priced=createOrder(priced,req(),'known');priced=moveOrder(priced,priced.orders[0].id,'known-cook')
    const snapshot=priced.orders[0].cost;priced=updateIngredient(priced,'pork',1880,.8,'new-price');expect(priced.orders[0].cost).toBe(snapshot)
  })
  it('preserves existing state on invalid dates, costs or inventory adjustments',()=>{
    const s=createOrder(initialState(),req(),'order'),before=structuredClone(s)
    expect(()=>updateIngredient(s,'pork',0,null,'short')).toThrow(/已預留/)
    expect(()=>createOrder(s,req(1,0,{day:'2027-02-30'}),'bad-date')).toThrow()
    expect(()=>updateIngredient(s,'pork',2000,-1,'negative-cost')).toThrow()
    expect(s).toEqual(before);expect(()=>validateState({schema:1})).toThrow(/格式不符/)
  })
})
