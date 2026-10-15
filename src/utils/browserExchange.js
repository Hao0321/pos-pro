import {readRecords,writeRecords,withSalesLock} from './browserStorage'
import {EXCHANGE_SETTING,EXCHANGE_PREFIX,EXCHANGE_ACTION,readExchangeStore,planExchange,exchangeReceipt,makeCatalogue,makePartyCard,readExchangeTextSetting} from '../../electron/businessExchange.mjs'

const getSetting=(data,key)=>readExchangeTextSetting(data.pos_business_settings,key)
export function getBrowserExchangeContext(actor){
  if(actor?.role!=='owner')throw Error('權限不足')
  return withSalesLock(async()=>{
    let record=readRecords(),storeId=getSetting(record.data,'sharedStoreId')
    if(!storeId){storeId=crypto.randomUUID();record=writeRecords({pos_business_settings:[...record.data.pos_business_settings,{key:'sharedStoreId',value:JSON.stringify(storeId)}]},record.revision)}
    const sender={id:storeId,name:getSetting(record.data,'storeName')||'商店'}
    return {storeId,sender,partyCard:makePartyCard(sender),state:readExchangeStore(getSetting(record.data,EXCHANGE_SETTING)),catalogue:await makeCatalogue(record.data.pos2_products,sender)}
  })
}
export function commitBrowserExchange(request,actor){
  if(actor?.role!=='owner')throw Error('權限不足')
  return withSalesLock(()=>{
    let replay=false,checked=false
    try{
      const record=readRecords(),data=record.data,sender={id:getSetting(data,'sharedStoreId'),name:getSetting(data,'storeName')||'商店'}
      if(!sender.id||request.storeId!==sender.id)throw Error('報價店面不符，請回到原店面確認')
      const old=data.pos_audit_log.find(l=>l.id===EXCHANGE_PREFIX+request.id),state=readExchangeStore(getSetting(data,EXCHANGE_SETTING))
      replay=!!old;checked=true
      if(old){if(old.action!==EXCHANGE_ACTION)throw Error('報價回執需要核對');return exchangeReceipt(request,typeof old.detail==='string'?JSON.parse(old.detail):old.detail,state)}
      const plan=planExchange(request,state,data.pos2_products,sender,actor)
      const settings=new Map(data.pos_business_settings.map(s=>[s.key,s.value]));settings.set(EXCHANGE_SETTING,JSON.stringify(plan.state))
      writeRecords({pos_business_settings:[...settings].map(([key,value])=>({key,value})),pos_audit_log:[{id:EXCHANGE_PREFIX+request.id,action:EXCHANGE_ACTION,label:'客戶報價',timestamp:new Date().toISOString(),userId:actor.userId||'',username:actor.username||'',role:actor.role,detail:plan.receipt},...data.pos_audit_log]},record.revision)
      return exchangeReceipt(request,plan.receipt,plan.state)
    }catch(error){return {success:false,committed:error.operationConflict===true||checked&&!replay?false:null,error:error.message}}
  })
}
