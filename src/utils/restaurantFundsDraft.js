import {browserStorage} from './browserStorage'
import {canonicalSignature,operationHeader,moneyValue} from '../../electron/operationRules.mjs'
import {restaurantFundsReview,fundsAmountText,parseFundsAmount,parseCancelledCount} from './restaurantFundsView.mjs'
import fundsMessages from '../../public/i18n/catalogue/restaurant-funds.mjs'

export const RESTAURANT_FUNDS_FORM='pos-restaurant-funds-form/v1'
export async function withRestaurantFundsFormLock(key,work){
 if(!globalThis.navigator?.locks?.request)throw Error('瀏覽器無法安全保留輸入，請更新瀏覽器。')
 return navigator.locks.request('pos-restaurant-funds-draft:'+key,{mode:'exclusive'},work)
}
const fail=()=>Error('保留的收款輸入需要核對，請勿覆蓋。'),id=value=>typeof value==='string'&&/^[-A-Za-z0-9_:]{1,128}$/.test(value),integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(',')
const text=(value,max)=>typeof value==='string'&&value.length<=max
const reasonLabels={customer:'客人改單',soldout:'餐點售完'}
export function restaurantFundsFormScope(state,actor){
 const scope={storeId:state?.storeId,epoch:state?.epoch,userId:actor?.userId,role:actor?.role}
 if(!id(scope.storeId)||!id(scope.epoch)||!id(scope.userId)||!['owner','staff'].includes(scope.role))throw Error('店面資料尚未準備好，請保留輸入。')
 return scope
}
export function restaurantFundsFormKey(scope){
 if(!keys(scope,['storeId','epoch','userId','role']))throw fail()
 restaurantFundsFormScope(scope,{userId:scope.userId,role:scope.role})
 return 'pos_restaurant_funds_form_v1:'+['storeId','epoch','userId','role'].map(key=>encodeURIComponent(scope[key])).join(':')
}
export function createRestaurantFundsForm(entry,mode,scope){
 const review=restaurantFundsReview(entry),fields=mode==='receive'?{amount:fundsAmountText(review.dueCents),paid:fundsAmountText(review.dueCents),method:'cash',customPaid:false}:mode==='refund'?{amount:fundsAmountText(review.retainedCents),reasonKey:'customer',reasonDetail:''}:{all:true,quantities:review.items.map(item=>({id:item.id,qty:'0'})),reasonKey:'customer',reasonDetail:''}
 return validateRestaurantFundsForm({protocol:RESTAURANT_FUNDS_FORM,scope,formId:'funds-form-'+crypto.randomUUID(),mode,review,fields,operation:null})
}
export function validateRestaurantFundsForm(value,scope=null){
 if(!keys(value,['protocol','scope','formId','mode','review','fields','operation'])||value.protocol!==RESTAURANT_FUNDS_FORM||!id(value.formId)||!['receive','cancel','refund'].includes(value.mode))throw fail()
 restaurantFundsFormKey(value.scope);if(scope&&canonicalSignature(value.scope)!==canonicalSignature(scope))throw fail()
 const review=value.review
 if(!keys(review,['entryId','entryVersion','status','pickupNumber','customer','prepared','fulfilled','totalCents','retainedCents','dueCents','items'])||!id(review.entryId)||!integer(review.entryVersion,1)||!['reserved','cooking','ready','dispatched','completed'].includes(review.status)||!integer(review.pickupNumber)||!text(review.customer,100)||typeof review.prepared!=='boolean'||typeof review.fulfilled!=='boolean'||!['totalCents','retainedCents','dueCents'].every(key=>integer(review[key])&&review[key]<=100000000000)||review.retainedCents+review.dueCents!==review.totalCents||!Array.isArray(review.items)||!review.items.length||review.items.length>100)throw fail()
 const seen=new Set();let total=0
 for(const item of review.items){if(!keys(item,['id','name','qty','price'])||!id(item.id)||seen.has(item.id)||!text(item.name,500)||!item.name||!integer(item.qty,1)||item.qty>100000)throw fail();seen.add(item.id);total+=Math.round(moneyValue(item.price,'餐點金額')*100)*item.qty}
 if(total!==review.totalCents)throw fail()
 const fields=value.fields
 if(value.mode==='receive'){
  if(!keys(fields,['amount','paid','method','customPaid'])||!text(fields.amount,32)||!text(fields.paid,32)||!['cash','card'].includes(fields.method)||typeof fields.customPaid!=='boolean')throw fail()
 }else{
  if(!keys(fields,value.mode==='cancel'?['all','quantities','reasonKey','reasonDetail']:['amount','reasonKey','reasonDetail'])||!['customer','soldout','other'].includes(fields.reasonKey)||!text(fields.reasonDetail,1000))throw fail()
  if(value.mode==='refund'&&!text(fields.amount,32))throw fail()
  if(value.mode==='cancel'&&(typeof fields.all!=='boolean'||!Array.isArray(fields.quantities)||fields.quantities.length!==review.items.length||fields.quantities.some((row,index)=>!keys(row,['id','qty'])||row.id!==review.items[index].id||!text(row.qty,16))))throw fail()
 }
 if(value.operation!==null){
  const operation=value.operation;if(!keys(operation,['id','time','input']))throw fail();operationHeader(operation)
  const input=operation.input,actions=value.mode==='receive'?['funds-receive']:value.mode==='refund'?['funds-refund']:['cancel','cancel-part']
  if(!input||input.kind!=='restaurant'||!actions.includes(input.action)||input.entryId!==review.entryId||input.expectedVersion!==review.entryVersion||input.storeId!==value.scope.storeId||input.epoch!==value.scope.epoch||input.fundsProtocol!=='pos-restaurant-funds/v1'||!['active','reference'].includes(input.costMode)||Object.hasOwn(input,'id')||Object.hasOwn(input,'time'))throw fail()
  const base=['kind','action','entryId','expectedVersion','storeId','epoch','costMode','fundsProtocol','shiftId'],extra=value.mode==='receive'?['amount','paid','payMethod']:value.mode==='refund'?['amount','reason']:fields.all?['reason']:['quantities','reason']
  if(!keys(input,[...base,...extra])||!text(input.shiftId,128))throw fail()
  if(value.mode==='receive'){
   const amount=parseFundsAmount(fields.amount),paid=fields.method==='cash'&&fields.customPaid?parseFundsAmount(fields.paid):amount
   if(input.amount!==amount/100||input.paid!==paid/100||input.payMethod!==fields.method||!amount||amount>review.dueCents||paid<amount||!id(input.shiftId))throw fail()
  }else{
   if(!text(input.reason,1000)||!input.reason.trim()||fields.reasonKey==='other'&&input.reason!==fields.reasonDetail.trim())throw fail()
   if(fields.reasonKey!=='other'&&![reasonLabels[fields.reasonKey],...fundsMessages[reasonLabels[fields.reasonKey]]].includes(input.reason))throw fail()
   if(value.mode==='refund'&&(input.amount!==parseFundsAmount(fields.amount)/100||input.amount<=0||parseFundsAmount(fields.amount)>review.retainedCents||review.fulfilled||!id(input.shiftId)||value.scope.role!=='owner'))throw fail()
   if(value.mode==='cancel'){
    const quantities=fields.all?[]:fields.quantities.map(row=>({id:row.id,qty:parseCancelledCount(row.qty,review.items.find(item=>item.id===row.id).qty)})).filter(row=>row.qty)
    if(input.action!==(fields.all?'cancel':'cancel-part')||!fields.all&&(!quantities.length||canonicalSignature(quantities)!==canonicalSignature(input.quantities)))throw fail()
    const cancelled=fields.all?review.totalCents:quantities.reduce((sum,row)=>sum+Math.round(review.items.find(item=>item.id===row.id).price*100)*row.qty,0)
    if((review.retainedCents>0||review.fulfilled)&&value.scope.role!=='owner'||review.retainedCents>review.totalCents-cancelled&&!id(input.shiftId))throw fail()
   }
  }
 }
 return structuredClone(value)
}
export function readRestaurantFundsForm(key,scope,storage=browserStorage){
 const raw=storage.getItem(key);if(raw===null)return {value:null,raw:null}
 if(typeof raw!=='string'||raw.length>131072)throw fail()
 try{return {value:validateRestaurantFundsForm(JSON.parse(raw),scope),raw}}catch{throw fail()}
}
export function saveRestaurantFundsForm(key,value,previousRaw,storage=browserStorage){
 const validated=validateRestaurantFundsForm(value),raw=JSON.stringify(validated)
 if(key!==restaurantFundsFormKey(validated.scope))throw fail()
 if(raw.length>131072)throw fail()
 if(storage.getItem(key)!==previousRaw)throw Error('另一個視窗已更新輸入，請重新核對。')
 try{storage.setItem(key,raw)}catch(error){if(storage.getItem(key)===raw)return raw;throw error}
 if(storage.getItem(key)!==raw)throw Error('輸入尚未保存，請保留畫面並重試。')
 return raw
}
export function clearRestaurantFundsForm(key,previousRaw,storage=browserStorage){
 if(storage.getItem(key)!==previousRaw)throw Error('另一個視窗已更新輸入，請重新核對。')
 try{storage.removeItem(key)}catch(error){if(storage.getItem(key)===null)return;throw error}
 if(storage.getItem(key)!==null)throw Error('輸入尚未清除，請核對原紀錄。')
}
