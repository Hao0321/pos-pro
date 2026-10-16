import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {planRestaurant,restaurantReceipt,readRestaurantConfig,validateRestaurantRecords} from '../../electron/restaurantRules.mjs'
import {prepareCheckout} from './checkoutSafety.mjs'
import {prepareRefund} from './refundSafety.mjs'
import {hasBrowserStockCost,commitBrowserStockBusiness} from './browserStockBusiness'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import {customerOrderView,makeCustomerIntake} from '../../electron/tableOrdering.mjs'
function read(){
  const saved=readRecords(),r=saved.data,settings=Object.fromEntries(r.pos_business_settings.map(s=>[s.key,JSON.parse(s.value)]))
  const data={products:r.pos2_products,entries:r.pos_restaurant_orders,operations:r.pos_restaurant_operations,orders:r.pos2_orders,waste:r.pos2_waste,shifts:r.pos2_shifts,settings,config:readRestaurantConfig(settings.restaurantConfig,r.pos2_products)}
  validateRestaurantRecords(data.entries,data.operations,data.orders,data.products)
  return {saved,data}
}
export function browserRestaurantState(){const {data}=read(),customers=data.orders.filter(o=>o.source==='customer');return {config:data.config,entries:data.entries,...(customers.length?{customerOrders:customers.map(o=>customerOrderView(o,data.entries))}:{})}}
export function browserCustomerIntakeContext(id){const {data}=read(),order=data.orders.find(o=>o.id===id&&o.source==='customer'),now=new Date();if(!order)throw Error('這張顧客原單已處理，請重新核對');const schedule=makeCustomerIntake(order,now);return {protocol:'pos-customer-intake-context/v1',order,entryId:data.entries.find(e=>e.customerOrderId===id)?.id||'',now:now.toISOString(),day:schedule.day,slot:schedule.slot}}
export function commitBrowserRestaurant(request,actor){
  return withSalesLock(()=>{
    let replay=false,historyChecked=false
    try{
      const {saved,data}=read(),old=data.operations.find(r=>r.id===request?.id);replay=!!old;historyChecked=true
      if(hasBrowserStockCost(saved))return commitBrowserStockBusiness('applyRestaurantOperation',request,actor,saved)
      assertOriginalOperationAvailable('applyRestaurantOperation',request.id,saved,request)
      if(old)return restaurantReceipt(request,old,data)
      if(request?.customerOrderId&&Math.abs(Date.now()-Date.parse(request.time))>300000)throw Error('接單時間已過期，請重新核對原單')
      const plan=planRestaurant(request,data,actor,{prepareCheckout,prepareRefund})
      const updates={pos2_products:plan.next.products,pos2_orders:plan.next.orders,pos2_waste:plan.next.waste,pos_restaurant_orders:plan.next.entries,pos_restaurant_operations:[...data.operations,plan.receipt]}
      if(request.action==='configure')updates.pos_business_settings=updateBrowserSettings(saved.data.pos_business_settings,{restaurantConfig:JSON.stringify(JSON.stringify(plan.config))})
      writeRecords(updates,saved.revision)
      return restaurantReceipt(request,plan.receipt,plan.next)
    }catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||historyChecked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  })
}
