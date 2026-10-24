import {test,expect} from 'vitest'
import {initializeRestaurantFunds,planRestaurantFundsEvent} from '../../electron/restaurantFunds.mjs'
import {parseFundsAmount,parseCancelledCount,restaurantFundingView,previewRestaurantFundsForm} from '../../src/utils/restaurantFundsView.mjs'
import {createRestaurantFundsForm,restaurantFundsFormScope,restaurantFundsFormKey,validateRestaurantFundsForm,readRestaurantFundsForm,saveRestaurantFundsForm,clearRestaurantFundsForm} from '../../src/utils/restaurantFundsDraft'
const actor={userId:'owner',username:'Owner',role:'owner'},state={storeId:'store',epoch:'epoch',costMode:'reference',today:'2026-10-17',now:'2026-10-17T12:00:00+08:00'},scope=restaurantFundsFormScope(state,actor)
function booking(payments=[]){
 let entry={id:'booking',version:1,status:'reserved',customer:'Guest',pickupNumber:1,startedAt:'',saleId:'',items:[{id:'p',name:'Meal',qty:3,price:80,cost:30}],quantity:3,total:240,allocations:[{id:'p',name:'Meal',qty:3,unitCost:30}]}
 entry.funds=initializeRestaurantFunds(entry,[{itemId:'p',rows:[{id:'p',name:'Meal',qty:1,unitCost:30}]}])
 for(const [index,payment]of payments.entries()){
  const input={id:'payment-'+index,time:state.now,kind:'restaurant',action:'funds-receive',entryId:entry.id,expectedVersion:entry.version,amount:payment.amount,paid:payment.amount,payMethod:payment.method,shiftId:'shift'},planned=planRestaurantFundsEvent(entry.funds,input,{entryId:entry.id,version:entry.version+1,date:state.today,prepared:false,actor})
  entry={...entry,version:entry.version+1,funds:planned.funds}
 }
 return entry
}
test.each(['',' ','-1','1.','1.001','1e2','Infinity','NaN','1,000','1000000000.01'])('invalid amount %j cannot become a confirmed monetary value',value=>expect(()=>parseFundsAmount(value)).toThrow())
test.each([['0',0],['.5',50],['0001.10',110],['0.01',1],['1000000000',100000000000]])('amount %s maps exactly to integer cents', (raw,cents)=>expect(parseFundsAmount(raw)).toBe(cents))
test('paid funds rather than saleId govern due, handover and owner-only cancellation; zero-price orders need no payment',()=>{
 const entry=booking([{amount:240,method:'cash'}]);expect(entry.saleId).toBe('');expect(restaurantFundingView(entry,'staff')).toMatchObject({dueCents:0,canComplete:true,canReceive:false,canCancel:false})
 const free=booking();free.items[0].price=0;free.total=0;free.funds=initializeRestaurantFunds(free,[{itemId:'p',rows:[{id:'p',name:'Meal',qty:1,unitCost:30}]}]);expect(restaurantFundingView(free,'staff')).toMatchObject({canReceive:false,canComplete:true,canCancel:true})
})
test('selected cancellation previews only the actual overpayment and the exact original LIFO refund method',()=>{
 const entry=booking([{amount:100,method:'cash'},{amount:100,method:'card'}]),form=createRestaurantFundsForm(entry,'cancel',scope);form.fields.all=false;form.fields.quantities[0].qty='1'
 const preview=previewRestaurantFundsForm(entry,form,{state,actor,shiftId:'shift',reason:'customer'})
 expect(preview.event.amountCents).toBe(4000);expect(preview.event.refunds).toEqual([{paymentId:'payment-1',method:'card',amountCents:4000}]);expect(preview.summary).toMatchObject({totalCents:16000,retainedCents:16000,dueCents:0,quantity:2})
 expect(()=>previewRestaurantFundsForm(entry,form,{state,actor:{...actor,role:'staff'},shiftId:'shift',reason:'customer'})).toThrow()
})
test('default cash follows the chosen amount, explicit tender computes change, and card ignores an unused cash field',()=>{
 const entry=booking(),form=createRestaurantFundsForm(entry,'receive',scope);form.fields.amount='50';form.fields.paid='not typed yet'
 expect(previewRestaurantFundsForm(entry,form,{state,actor,shiftId:'shift'}).event.changeCents).toBe(0)
 form.fields.customPaid=true;form.fields.paid='100';expect(previewRestaurantFundsForm(entry,form,{state,actor,shiftId:'shift'}).event.changeCents).toBe(5000)
 form.fields.method='card';form.fields.paid='';expect(previewRestaurantFundsForm(entry,form,{state,actor,shiftId:'shift'}).input.paid).toBe(50)
})
test('blank fields, excessive portions, no selection and stale source never produce a confirmation preview',()=>{
 const entry=booking(),form=createRestaurantFundsForm(entry,'cancel',scope);form.fields.all=false;form.fields.quantities[0].qty=''
 expect(()=>previewRestaurantFundsForm(entry,form,{state,actor,reason:'customer'})).toThrow();expect(()=>parseCancelledCount('4',3)).toThrow();form.fields.quantities[0].qty='0';expect(()=>previewRestaurantFundsForm(entry,form,{state,actor,reason:'customer'})).toThrow()
 form.fields.all=true;expect(()=>previewRestaurantFundsForm({...entry,version:2},form,{state,actor,reason:'customer'})).toThrow('工作單已更新')
})
test('a refund of1.10 remains exact and its saved operation cannot be changed to a different amount or store',()=>{
 const entry=booking([{amount:10,method:'cash'}]),form=createRestaurantFundsForm(entry,'refund',scope);form.fields.amount='1.10';form.fields.reasonKey='other';form.fields.reasonDetail='one adjustment'
 const preview=previewRestaurantFundsForm(entry,form,{state,actor,shiftId:'shift',reason:'one adjustment'});form.operation={id:'refund-original',time:state.now,input:preview.input};expect(()=>validateRestaurantFundsForm(form)).not.toThrow()
 const wrong=structuredClone(form);wrong.operation.input.amount=2;expect(()=>validateRestaurantFundsForm(wrong)).toThrow();wrong.operation.input.amount=1.1;wrong.operation.input.storeId='other';expect(()=>validateRestaurantFundsForm(wrong)).toThrow()
})
test('a saved cancellation cannot replace its displayed reason or omit the shift needed for its actual refund',()=>{
 const entry=booking([{amount:200,method:'cash'}]),form=createRestaurantFundsForm(entry,'cancel',scope),preview=previewRestaurantFundsForm(entry,form,{state,actor,shiftId:'shift',reason:'客人改單'})
 form.operation={id:'cancel-original',time:state.now,input:preview.input};expect(()=>validateRestaurantFundsForm(form)).not.toThrow()
 const changed=structuredClone(form);changed.operation.input.reason='餐點售完';expect(()=>validateRestaurantFundsForm(changed)).toThrow();changed.operation.input.reason='客人改單';changed.operation.input.shiftId='';expect(()=>validateRestaurantFundsForm(changed)).toThrow()
})
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)}}
test('scoped drafts retain invalid raw input, reject corrupt/foreign bytes and never overwrite or clear another window',()=>{
 const s=storage(),key=restaurantFundsFormKey(scope),form=createRestaurantFundsForm(booking(),'receive',scope);form.fields.amount='1.'
 const raw=saveRestaurantFundsForm(key,form,null,s);expect(readRestaurantFundsForm(key,scope,s).value.fields.amount).toBe('1.')
 s.setItem(key,'corrupt');expect(()=>readRestaurantFundsForm(key,scope,s)).toThrow();expect(()=>saveRestaurantFundsForm(key,form,raw,s)).toThrow();expect(()=>clearRestaurantFundsForm(key,raw,s)).toThrow();expect(s.getItem(key)).toBe('corrupt')
 s.setItem(key,raw);expect(()=>readRestaurantFundsForm(key,{...scope,userId:'other'},s)).toThrow();expect(()=>saveRestaurantFundsForm(restaurantFundsFormKey({...scope,epoch:'new'}),form,null,s)).toThrow()
})
test('prewrite quota leaves the original, postwrite reply loss recovers exact saved bytes, and postdelete failure does not resurrect a form',()=>{
 const s=storage(),key=restaurantFundsFormKey(scope),form=createRestaurantFundsForm(booking(),'receive',scope),set=s.setItem,remove=s.removeItem
 s.setItem=()=>{throw Error('quota')};expect(()=>saveRestaurantFundsForm(key,form,null,s)).toThrow();expect(s.getItem(key)).toBeNull()
 s.setItem=(...args)=>{set(...args);throw Error('after write')};const raw=saveRestaurantFundsForm(key,form,null,s);expect(raw).toBe(s.getItem(key))
 s.removeItem=key=>{remove(key);throw Error('after delete')};expect(()=>clearRestaurantFundsForm(key,raw,s)).not.toThrow();expect(s.getItem(key)).toBeNull()
})
