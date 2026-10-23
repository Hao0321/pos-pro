import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable} from './browserStorage'
import {planRestaurant,restaurantReceipt,readRestaurantConfig,validateRestaurantRecords} from '../../electron/restaurantRules.mjs'
import {prepareCheckout} from './checkoutSafety.mjs'
import {prepareRefund} from './refundSafety.mjs'
import {hasBrowserStockCost,commitBrowserStockBusiness} from './browserStockBusiness'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import {customerOrderView,makeCustomerIntake} from '../../electron/tableOrdering.mjs'
import {usesRestaurantFunds} from '../../electron/restaurantFunds.mjs'
import {salesDate} from '../../electron/salesRules.mjs'
import {restaurantFundsSetupState,browserFundsSetupEligible} from '../../electron/restaurantFundsSetup.mjs'
import {usesRestaurantMenu,restaurantMenuPreview,assertRestaurantMenuActor,RESTAURANT_MENU_CONFIG_KEY} from '../../electron/restaurantMenuOriginal.mjs'
import {assertCustomerMenuIntake} from '../../electron/restaurantCustomerMenu.mjs'
import {previewRestaurantMenuSetup} from '../../electron/restaurantMenuSetup.mjs'
import {previewRestaurantAgent} from '../../electron/restaurantAgent.mjs'
import {assertPrivateDraftCaller} from '../../electron/privateDrafts.mjs'
import {readReservationBook} from '../../electron/reservationHistory.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {commitBrowserReservationDepositReturn} from './browserReservationDepositReturn'
function read(){
  const saved=readRecords(),r=saved.data,settings=Object.fromEntries(r.pos_business_settings.map(s=>[s.key,JSON.parse(s.value)]))
  const data={products:r.pos2_products,entries:r.pos_restaurant_orders,operations:r.pos_restaurant_operations,orders:r.pos2_orders,waste:r.pos2_waste,cashLogs:r.pos2_cash_log,shifts:r.pos2_shifts,settings,config:readRestaurantConfig(settings.restaurantConfig,r.pos2_products),storeId:settings.sharedStoreId||'',epoch:saved.salesEpoch,costMode:hasBrowserStockCost(saved)?'active':'reference',now:Date.now()}
  data.date=salesDate(new Date(data.now))
  data.users=r.pos_users;data.suppliers=r.pos_suppliers;data.menuConfigurationId=settings[RESTAURANT_MENU_CONFIG_KEY]||''
  data.reservationState=readReservationBook(browserToBook(r)).state
  data.fundsSetupEligible=browserFundsSetupEligible(saved)
  validateRestaurantRecords(data.entries,data.operations,data.orders,data.products,{cashLogs:data.cashLogs,waste:data.waste,storeId:data.storeId,config:data.config,menuConfigurationId:data.menuConfigurationId,menuReceiptKey:data.settings.orderReceiptSecret})
  return {saved,data}
}
export function browserRestaurantState(){const {data}=read(),customers=data.orders.filter(o=>o.source==='customer');return {config:data.config,entries:data.entries,fundsSetup:restaurantFundsSetupState(data),...(usesRestaurantFunds(data.config,data.entries,data.orders)?{storeId:data.storeId,epoch:data.epoch,costMode:data.costMode,today:data.date,now:new Date(data.now).toISOString()}:{}),...(customers.length?{customerOrders:customers.map(o=>customerOrderView(o,data.entries))}:{})}}
export function browserCustomerIntakeContext(id,actor){const {data}=read(),order=data.orders.find(o=>o.id===id&&o.source==='customer'),now=new Date();if(!order)throw Error('這張顧客原單已處理，請重新核對');const schedule=makeCustomerIntake(order,now),entryId=data.entries.find(e=>e.customerOrderId===id)?.id||'',menuReview=order.customerMenu&&!entryId?restaurantMenuPreview({items:order.customerMenu.menuReview.quote.input},data,actor).menuReview:null;if(menuReview)assertCustomerMenuIntake(order,menuReview);return {protocol:'pos-customer-intake-context/v1',order,entryId,now:now.toISOString(),day:schedule.day,slot:schedule.slot,...(menuReview?{menuReview}:{})}}
export function browserRestaurantMenuQuote(input,actor){return withSalesLock(()=>restaurantMenuPreview(input,read().data,actor))}
export function browserRestaurantMenuSetupPreview(input,actor){return withSalesLock(()=>previewRestaurantMenuSetup(input,read().data,actor))}
export function browserRestaurantAgentPreview(input,actor){return withSalesLock(()=>previewRestaurantAgent(input,read().data,actor))}
export async function commitBrowserRestaurant(request,actor){
  const returned=await commitBrowserReservationDepositReturn(request,actor)
  if(returned!==null)return returned
  return withSalesLock(()=>{
    let replay=false,historyChecked=false,writing=false,beforeRaw=null
    try{
      if(request?.action==='configure'&&(request.storeId!==undefined||request.epoch!==undefined))assertRestaurantMenuActor(actor,readRecords().data.pos_users)
      if(assertPrivateDraftCaller(request,actor)&&!readRecords().data.pos_users.some(user=>user.id===actor?.userId&&user.username===actor.username&&user.role===actor.role))throw Error('權限不足')
      const {saved,data}=read(),old=data.operations.find(r=>r.id===request?.id);replay=!!old;historyChecked=true
      if(Object.hasOwn(request||{},'reservationDining')){const parent=readReservationBook(browserToBook(saved.data)).recorded.find(row=>row.id===request.reservationDining?.parentId);if(!old||!parent||parent.event.input.action!=='dine'||canonicalSignature(parent.event.input.order)!==canonicalSignature(request))throw Error('請從原訂位流程保存餐點')}
      if(Object.hasOwn(request?.config||{},'menu')||usesRestaurantMenu(data.config,data.entries,data.operations))assertRestaurantMenuActor(actor,data.users)
      if(hasBrowserStockCost(saved))return commitBrowserStockBusiness('applyRestaurantOperation',request,actor,saved)
      assertOriginalOperationAvailable('applyRestaurantOperation',request.id,saved,request)
      if(old)return restaurantReceipt(request,old,data)
      if(request?.customerOrderId&&Math.abs(Date.now()-Date.parse(request.time))>300000)throw Error('接單時間已過期，請重新核對原單')
      const plan=planRestaurant(request,data,actor,{prepareCheckout,prepareRefund})
      const updates={pos2_products:plan.next.products,pos2_orders:plan.next.orders,pos2_waste:plan.next.waste,pos_restaurant_orders:plan.next.entries,pos_restaurant_operations:[...data.operations,plan.receipt],...(plan.cashLog?{pos2_cash_log:plan.next.cashLogs}:{})}
      if(request.action==='configure')updates.pos_business_settings=updateBrowserSettings(saved.data.pos_business_settings,{restaurantConfig:JSON.stringify(JSON.stringify(plan.config)),...(plan.config.menu?{[RESTAURANT_MENU_CONFIG_KEY]:JSON.stringify(request.id)}:{}),...(plan.config.fundsEnabled&&!data.storeId?{sharedStoreId:JSON.stringify(crypto.randomUUID())}:{})})
      beforeRaw=localStorage.getItem('pos_atomic_records_v1');writing=true
      writeRecords(updates,saved.revision,{ensureSalesEpoch:!!plan.config.fundsEnabled})
      return restaurantReceipt(request,plan.receipt,plan.next)
    }catch(error){
      // A wrapper can lose its reply after the atomic record was already saved.
      // Read the persisted original before claiming that no money was recorded.
      if(writing)try{
        if(localStorage.getItem('pos_atomic_records_v1')!==beforeRaw){
          const {data}=read(),original=data.operations.find(row=>row.id===request.id)
          if(!original)throw Error('missing original')
          return restaurantReceipt(request,original,data)
        }
      }catch{return {success:false,committed:null,errorCode:'RECOVERY_REQUIRED',error:'保存結果尚未確認，請保留原編號核對。'}}
      return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||historyChecked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}
    }
  })
}
