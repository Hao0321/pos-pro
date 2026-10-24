import {RESTAURANT_FUNDS_PROTOCOL} from '../../electron/restaurantFunds.mjs'

// F8: new operations bind to the authority's current scope. A retry preserves
// the scope already frozen in its original pending command, including epoch.
export function prepareRestaurantCommand(input,{state=null,pending=null,identity=null}={}){
 let scope={}
 if(pending?.kind==='restaurant'){
  const original=JSON.parse(pending.signature).input
  scope=Object.fromEntries(['storeId','epoch','fundsProtocol','costMode'].filter(key=>Object.hasOwn(original,key)).map(key=>[key,original[key]]))
 }else if(input.action!=='configure'&&(input.action==='create'?state?.config.fundsEnabled:state?.entries.some(row=>row.id===input.entryId&&row.funds))){
  if(!state.storeId||!state.epoch||!['active','reference'].includes(state.costMode))throw Error('預訂款項缺少店面或復原識別，請保留原資料核對。')
  scope={storeId:state.storeId,epoch:state.epoch,fundsProtocol:RESTAURANT_FUNDS_PROTOCOL,costMode:state.costMode}
 }
 return {input:{...scope,...input,kind:'restaurant'},identity:identity||(!pending&&state?.now?{id:'restaurant-'+crypto.randomUUID(),time:state.now}:null)}
}
