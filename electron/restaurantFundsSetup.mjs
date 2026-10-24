export function restaurantFundsSetupState(data){
 return {protocol:'pos-restaurant-funds-setup/v1',newStore:data.fundsSetupEligible===true&&!data.config.enabled&&!Object.hasOwn(data.config,'fundsEnabled')&&!data.entries.length&&!data.operations.length&&!data.orders.length&&!data.cashLogs.length&&!data.waste.length&&!data.shifts.some(row=>row.status==='closed')}
}
export function assertRestaurantFundsSetupProposal(request,data){
 if(!Object.hasOwn(request,'fundsSetupProposal'))return
 if(request.fundsSetupProposal!==true||request.config?.fundsEnabled!==true||!restaurantFundsSetupState(data).newStore)throw Error('店面已有新紀錄，請重新核對分次收款設定。')
}
export function browserFundsSetupEligible(records){
 const setup=new Set(['pos2_products','pos_users','pos_audit_log','pos_business_settings','pos2_shifts'])
 return !Object.entries(records.data).some(([key,value])=>!setup.has(key)&&Array.isArray(value)&&value.length)
}
