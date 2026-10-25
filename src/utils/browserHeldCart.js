import {readRecords,writeRecords,withSalesLock,RECORD_KEY} from './browserStorage'
import {privateDraftContext,privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import * as model from '../../electron/heldCart.mjs'
export const browserCartContext=(record,actor)=>privateDraftContext(readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),record.salesEpoch,actor,record.data.pos_users)
export const browserHeldJournal=record=>model.readHeldJournal(readExchangeTextSetting(record.data.pos_business_settings,model.HELD_CART_JOURNAL))
export function commitBrowserHeldCart(input,actor){return withSalesLock(()=>{
 let writing=false,before=null
 try{
  const record=readRecords(),history=browserHeldJournal(record),plan=model.planHeldCommand(input,browserCartContext(record,actor),{heldOrders:record.data.pos2_held_orders,products:record.data.pos2_products,members:record.data.pos2_members},history,actor)
  if(!plan.alreadySaved){const settings=updateBrowserSettings(record.data.pos_business_settings,{[model.HELD_CART_JOURNAL]:JSON.stringify(JSON.stringify({version:1,entries:[...history.entries,plan.receipt]}))});before=localStorage.getItem(RECORD_KEY);writing=true;writeRecords({pos2_held_orders:plan.heldOrders,pos_business_settings:settings},record.revision)}
  return model.heldResult(plan.receipt,readRecords().data.pos2_held_orders,plan.alreadySaved)
 }catch(error){
  if(writing&&localStorage.getItem(RECORD_KEY)!==before){try{const record=readRecords(),result=model.heldOriginal({family:'held-cart',id:input.id,digest:privateDraftDigest(input),context:input.draftContext,document:input},browserCartContext(record,actor),browserHeldJournal(record),record.data.pos2_held_orders);if(result.status==='matched')return result.result}catch{}return {protocol:model.HELD_CART_PROTOCOL,success:false,committed:null,operationId:input.id,digest:privateDraftDigest(input),error:'掛單結果尚未確認，請查詢原編號。'}}
  return {protocol:model.HELD_CART_PROTOCOL,success:false,committed:false,operationId:input.id,digest:privateDraftDigest(input),error:error.message}
 }
})}
