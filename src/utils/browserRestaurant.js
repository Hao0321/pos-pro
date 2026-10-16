import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {planRestaurant,restaurantReceipt,readRestaurantConfig,validateRestaurantRecords} from '../../electron/restaurantRules.mjs'
import {prepareCheckout} from './checkoutSafety.mjs'
import {prepareRefund} from './refundSafety.mjs'
import {hasBrowserStockCost,commitBrowserStockBusiness} from './browserStockBusiness'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
function read(){
  const saved=readRecords(),r=saved.data,settings=Object.fromEntries(r.pos_business_settings.map(s=>[s.key,JSON.parse(s.value)]))
  const data={products:r.pos2_products,entries:r.pos_restaurant_orders,operations:r.pos_restaurant_operations,orders:r.pos2_orders,waste:r.pos2_waste,shifts:r.pos2_shifts,settings,config:readRestaurantConfig(settings.restaurantConfig,r.pos2_products)}
  validateRestaurantRecords(data.entries,data.operations,data.orders,data.products)
  return {saved,data}
}
export function browserRestaurantState(){const {data}=read();return {config:data.config,entries:data.entries}}
export function commitBrowserRestaurant(request,actor){
  return withSalesLock(()=>{
    let replay=false,historyChecked=false
    try{
      const {saved,data}=read(),old=data.operations.find(r=>r.id===request?.id);replay=!!old;historyChecked=true
      if(hasBrowserStockCost(saved))return commitBrowserStockBusiness('applyRestaurantOperation',request,actor,saved)
      assertOriginalOperationAvailable('applyRestaurantOperation',request.id,saved,request)
      if(old)return restaurantReceipt(request,old,data)
      const plan=planRestaurant(request,data,actor,{prepareCheckout,prepareRefund})
      const updates={pos2_products:plan.next.products,pos2_orders:plan.next.orders,pos2_waste:plan.next.waste,pos_restaurant_orders:plan.next.entries,pos_restaurant_operations:[...data.operations,plan.receipt]}
      if(request.action==='configure')updates.pos_business_settings=updateBrowserSettings(saved.data.pos_business_settings,{restaurantConfig:JSON.stringify(JSON.stringify(plan.config))})
      writeRecords(updates,saved.revision)
      return restaurantReceipt(request,plan.receipt,plan.next)
    }catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||historyChecked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  })
}
