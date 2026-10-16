import {readRecords,writeRecords,withSalesLock} from './browserStorage'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {makeRefundPreview,verifyRefundReview} from '../../electron/refundReview.mjs'

export function refundOwner(actor,record){
  const account=record.data.pos_users.find(row=>row.id===actor?.userId)
  if(!account||actor.role!=='owner'||account.role!==actor.role||account.username!==actor.username)throw Error('只有目前店主能核對退款')
  return {userId:account.id,username:account.username,role:account.role}
}
export const browserRefundData=record=>({storeId:readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),epoch:record.salesEpoch,costMode:record.data.pos_stock_cost_entries.length?'active':'reference',
  orders:record.data.pos2_orders,members:record.data.pos2_members,products:record.data.pos2_products,shifts:record.data.pos2_shifts,restaurantEntries:record.data.pos_restaurant_orders})
export function getBrowserRefundContext(actor){return withSalesLock(()=>{
  let record=readRecords();const account=refundOwner(actor,record),storeId=browserRefundData(record).storeId
  if(!storeId||!record.salesEpoch)record=writeRecords(!storeId?{pos_business_settings:[...record.data.pos_business_settings,{key:'sharedStoreId',value:JSON.stringify(crypto.randomUUID())}]}:{},record.revision,{ensureSalesEpoch:true})
  const data=browserRefundData(record),shift=data.shifts.find(row=>row.status==='open')
  return {storeId:data.storeId,epoch:data.epoch,now:new Date().toISOString(),actor:account,openShift:shift?{id:shift.id,status:shift.status,openTime:shift.openTime}:null,restaurantSaleIds:data.restaurantEntries.map(row=>row.saleId).filter(Boolean)}
})}
export function previewBrowserRefund(input,actor){return withSalesLock(()=>{
  const record=readRecords();refundOwner(actor,record)
  if(input?.cashier!==actor.username)throw Error('退款帳號已更新，請重新登入')
  return makeRefundPreview(input,browserRefundData(record))
})}
export function verifyBrowserRefundReview(request,actor,record){
  if(request.review===undefined)return
  refundOwner(actor,record)
  if(request.cashier!==actor.username)throw Error('退款帳號已更新，請重新登入')
  return verifyRefundReview(request,browserRefundData(record))
}
