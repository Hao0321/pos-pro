import {test,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {quoteRestaurantMenu,normalizeRestaurantMenu,validateRestaurantMenuQuote,reviewRestaurantMenuQuote} from '../../electron/restaurantMenu.mjs'
import {restaurantMenuFixture,bowl,choose} from '../fixtures/restaurant-menu-v1.mjs'
const meal=data=>data.menu.offers[0],resource=(quote,id)=>quote.allocations.find(row=>row.id===id),quote=(data,input=[bowl()])=>quoteRestaurantMenu(data,input).quote

test('normal defaults produce the authoritative100 bowl,33 reference cost and frozen per-portion recipe without consuming the output SKU',()=>{
 const data=restaurantMenuFixture(),before=structuredClone(data),result=quoteRestaurantMenu(data,[bowl()])
 expect(result.quote).toMatchObject({totalCents:10000,referenceCostCents:3300,quantity:1,capacity:1,scope:{storeId:data.storeId,epoch:data.epoch,costMode:'reference'}})
 expect(result.quote.items[0]).toMatchObject({name:'牛肉丼 · 正常份 · 正常飯',price:100,qty:1,cost:33});expect(result.availability.available).toBe(true)
 expect(resource(result.quote,'rice').qty).toBe(.2);expect(resource(result.quote,'beef').qty).toBe(.1);expect(resource(result.quote,'box').qty).toBe(1);expect(resource(result.quote,'bowl')).toBeUndefined();expect(data).toEqual(before)
 expect(validateRestaurantMenuQuote(result.quote)).toEqual(result.quote)
})
test('same-product normal,egg and two combos keep three distinct lines with445 total,152 cost and six capacity units',()=>{
 const data=restaurantMenuFixture(),result=quote(data,[bowl(),bowl(1,{selections:[choose('extras','egg')]}),{offerId:'bowl-set',qty:2}])
 expect(result).toMatchObject({totalCents:44500,referenceCostCents:15200,capacity:6,quantity:4});expect(new Set(result.items.map(row=>row.id)).size).toBe(3)
 expect(result.lineFacts.every(row=>row.productId==='bowl')).toBe(true);expect(resource(result,'rice').qty).toBe(.8);expect(resource(result,'beef').qty).toBe(.4);expect(resource(result,'box').qty).toBe(4);expect(resource(result,'egg').qty).toBe(1);expect(resource(result,'tea').qty).toBe(2)
 expect(result.itemAllocations.map(row=>row.itemId)).toEqual(result.items.map(row=>row.id))
})
test('selection ordering is canonical, identical lines merge and changed choices retain different line identities',()=>{
 const data=restaurantMenuFixture(),a=bowl(1,{selections:[choose('extras','egg'),choose('rice','less')]}),b=bowl(2,{selections:[choose('rice','less'),choose('extras','egg')]})
 const merged=quote(data,[a,b]);expect(merged.items).toHaveLength(1);expect(merged.items[0].qty).toBe(3);expect(quote(data,[a]).items[0].id).toBe(quote(data,[b]).items[0].id)
 expect(merged.items[0].id).not.toBe(quote(data).items[0].id);expect(resource(merged,'rice').qty).toBe(.45)
})
test('line identities use ordinal protocol ordering, independent of a host language collator',()=>{
 const data=restaurantMenuFixture();meal(data).groups[0].id='a-group';meal(data).groups[1].id='A-group'
 const expected={offerId:'bowl-offer',variantId:'regular',selections:[{groupId:'A-group',choices:[]},{groupId:'a-group',choices:[{id:'normal',qty:1}]}]}
 expect(quote(data).items[0].id).toBe('ml-'+createHash('sha256').update(canonicalSignature(expected)).digest('hex'))
})
test('whole-cart shared resources are checked together even when every individual line appears available',()=>{
 const data=restaurantMenuFixture();data.products.find(row=>row.id==='rice').stock=.3
 const input=[bowl(),bowl(1,{selections:[choose('extras','egg')]})],result=quoteRestaurantMenu(data,input)
 expect(result.availability.lines.every(row=>row.available===1)).toBe(true);expect(result.availability.available).toBe(false);expect(result.availability.shortages).toEqual([{productId:'rice',requiredUnits:400,availableUnits:300}]);expect(()=>reviewRestaurantMenuQuote(data,result.quote)).toThrow('原料可用量不足')
})
test('less rice and omit rice apply to the chosen large variant without changing another line',()=>{
 const data=restaurantMenuFixture(),less=quote(data,[bowl(1,{variantId:'large',selections:[choose('rice','less')]})]),none=quote(data,[bowl(1,{variantId:'large',selections:[choose('rice','without')]})])
 expect(resource(less,'rice').qty).toBe(.25);expect(none.totalCents).toBe(11500);expect(none.referenceCostCents).toBe(3300);expect(resource(none,'rice')).toBeUndefined();expect(resource(none,'beef').qty).toBe(.15)
})
test('omitting and adding the same resource in independent groups is rejected rather than ordered by click timing',()=>{
 const data=restaurantMenuFixture();meal(data).groups[1].choices[0].components.push({id:'rice',qty:.01})
 expect(()=>quote(data,[bowl(1,{selections:[choose('rice','without'),choose('extras','egg')]})])).toThrow('彼此衝突')
})
test('component fractions combine exactly before milliunit precision is checked',()=>{
 const data=restaurantMenuFixture();data.products.push(...['half-a','half-b'].map(id=>({id,name:id,price:0,cost:0,stock:0,unit:'份'})));Object.assign(data.config.recipes,{'half-a':[{id:'rice',qty:.001}],'half-b':[{id:'rice',qty:.001}]});meal(data).variants[0].components=[{id:'half-a',qty:.5},{id:'half-b',qty:.5}]
 expect(resource(quote(data),'rice').qty).toBe(.001);meal(data).variants[0].components.pop();expect(()=>quote(data)).toThrow('用量太細')
})
test('a valid catalogue identifier cannot replace the recipe container prototype or disappear from frozen provenance',()=>{
 const data=restaurantMenuFixture();data.products.push({id:'__proto__',name:'Special recipe output',price:100,cost:5,stock:0,unit:'份'});data.config.recipes=Object.fromEntries([['__proto__',[{id:'rice',qty:.1}]]]);meal(data).variants[0].components=[{id:'__proto__',qty:1}]
 const result=quote(data);expect(Object.hasOwn(result.source.recipes,'__proto__')).toBe(true);expect(Array.isArray(Object.getPrototypeOf(result.source.recipes))).toBe(false);expect(resource(result,'rice').qty).toBe(.1);expect(validateRestaurantMenuQuote(result)).toEqual(result)
})
test('reference cost rounds once after exact total rather than rounding each half-cent portion first',()=>{
 const data=restaurantMenuFixture();data.products.find(row=>row.id==='rice').cost=.01;meal(data).variants[0].components=[{id:'rice',qty:.5}]
 expect(quote(data,[bowl(2)]).referenceCostCents).toBe(1)
})
test('free prices are explicit and negative final prices cannot become a confirmed quote',()=>{
 const data=restaurantMenuFixture();meal(data).variants[0].price=0;expect(quote(data).totalCents).toBe(0);meal(data).groups[1].choices[0].priceDelta=-1;expect(()=>quote(data,[bowl(1,{selections:[choose('extras','egg')]})])).toThrow()
})
test('frozen quote remains readable after current prices, recipes and caller source objects change',()=>{
 const data=restaurantMenuFixture(),original=quote(data),saved=structuredClone(original);meal(data).variants[0].price=200;data.config.recipes.bowl[0].qty=.5
 expect(validateRestaurantMenuQuote(original)).toEqual(saved);expect(original).toEqual(saved);expect(()=>reviewRestaurantMenuQuote(data,original)).toThrow('價格或配方已變更')
})
test('stock-only changes and unrelated menu edits do not invalidate the reviewed price but current stock is still checked',()=>{
 const data=restaurantMenuFixture(),original=quote(data);data.products.find(row=>row.id==='rice').stock=5;data.products.find(row=>row.id==='tea').price=77;data.menu.offers[1].variants[0].price=199;data.now='2026-10-17T04:01:00+08:00'
 expect(reviewRestaurantMenuQuote(data,original).quote.signature).toBe(original.signature);data.products.find(row=>row.id==='rice').stock=.1;expect(()=>reviewRestaurantMenuQuote(data,original)).toThrow('原料可用量不足')
})
test.each(['storeId','epoch','costMode'])('a changed %s cannot inherit another scope reviewed quote',key=>{
 const data=restaurantMenuFixture(),original=quote(data);data[key]=key==='costMode'?'active':'different';expect(()=>reviewRestaurantMenuQuote(data,original)).toThrow('不同店面或還原版本')
})
test.each(['2026-10-17T03:59:59+08:00','2026-10-17T04:05:01+08:00'])('future or expired issue time is rejected at %s',now=>{const data=restaurantMenuFixture(),original=quote(data);data.now=now;expect(()=>reviewRestaurantMenuQuote(data,original)).toThrow('已過期')})
test('tampered results or a self-consistent foreign price snapshot cannot authorize a current order',()=>{
 const data=restaurantMenuFixture(),original=quote(data),tampered=structuredClone(original);tampered.items[0].price=1;expect(()=>validateRestaurantMenuQuote(tampered)).toThrow()
 const foreign=restaurantMenuFixture();meal(foreign).variants[0].price=1;const cheaper=quote(foreign);expect(validateRestaurantMenuQuote(cheaper).totalCents).toBe(100);expect(()=>reviewRestaurantMenuQuote(data,cheaper)).toThrow('價格或配方已變更')
})
test.each([
 ['variant price',data=>{meal(data).variants[0].price=null}],['variant components',data=>{meal(data).variants[0].components=null}],['offer groups',data=>{meal(data).groups=null}],['offer name',data=>{meal(data).name=null}],['choice omissions',data=>{meal(data).groups[0].choices[0].omit=null}],
])('an explicit null %s is invalid rather than a silently chosen default',(_label,change)=>{const data=restaurantMenuFixture();change(data);expect(()=>normalizeRestaurantMenu(data.menu,data.products)).toThrow()})
test.each([
 {offerId:'missing',qty:1},{offerId:'bowl-offer',qty:0},{offerId:'bowl-offer',qty:'1'},{offerId:'bowl-offer',qty:1.1},{offerId:'bowl-offer',qty:1,price:1},
 bowl(1,{variantId:null}),bowl(1,{selections:null}),bowl(1,{selections:[{groupId:'rice',choices:[]}]}),bowl(1,{selections:[choose('extras','egg',3)]}),bowl(1,{selections:[choose('extras','missing')]}),bowl(1,{selections:[choose('extras','egg'),choose('extras','egg')]}),
])('invalid or forged selection %# is rejected before a result is produced',input=>{expect(()=>quote(restaurantMenuFixture(),[input])).toThrow()})
test('a missing required default asks for an explicit selection without silently selecting the first choice',()=>{
 const data=restaurantMenuFixture();meal(data).groups[0].defaults=[];expect(()=>quote(data)).toThrow('必選項目');expect(quote(data,[bowl(1,{selections:[choose('rice','less')]})]).totalCents).toBe(10000)
})
test('a recipe output cannot recursively become an ingredient or hide unsupported nested production',()=>{const data=restaurantMenuFixture();data.config.recipes.rice=[{id:'box',qty:1}];expect(()=>quote(data)).toThrow('原料與包材')})
test('invalid precision, aggregate limits and negative resource balances do not produce guessed quantities',()=>{
 const data=restaurantMenuFixture();meal(data).variants[0].price=1.001;expect(()=>quote(data)).toThrow();meal(data).variants[0].price=1000000000;expect(()=>quote(data,[bowl(2)])).toThrow();meal(data).variants[0].price=100;meal(data).groups[0].choices[1].components[0].qty=-1;expect(()=>quote(data,[bowl(1,{selections:[choose('rice','less')]})])).toThrow('超過原配方')
})
