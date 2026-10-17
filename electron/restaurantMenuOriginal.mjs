import {canonicalSignature,operationHeader} from './operationRules.mjs'
import {RESTAURANT_MENU_PROTOCOL,quoteRestaurantMenu,reviewRestaurantMenuQuote,validateRestaurantMenuQuote,captureRestaurantMenuConfiguration,validateRestaurantMenuConfiguration,assertRestaurantMenuQuoteConfiguration,restaurantMenuDigest} from './restaurantMenu.mjs'
import {validateCustomerMenuOrder,assertCustomerMenuIntake,assertCustomerMenuAuthentication} from './restaurantCustomerMenu.mjs'
import {assertRestaurantAgentSource,restaurantAgentMenuContext} from './restaurantAgentDraft.mjs'
import {assertPrivateDraftOperation} from './privateDrafts.mjs'

export const RESTAURANT_MENU_FEATURE='restaurant-menu-v1'
export const RESTAURANT_MENU_CONFIG_KEY='restaurantMenuConfigurationId'
const ORIGINAL='pos-restaurant-menu-original/v1',same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const invalid=()=>Error('餐點選項、菜單設定或原單來源不完整，請保留原單核對。')
function only(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw invalid()}
function configuration(receipt){
 if(!receipt||receipt.kind!=='restaurant'||receipt.action!=='configure'||receipt.actor?.role!=='owner'||!receipt.actor.userId||!receipt.actor.username||typeof receipt.menuConfiguredAt!=='string'||!Number.isFinite(Date.parse(receipt.menuConfiguredAt))||new Date(receipt.menuConfiguredAt).toISOString()!==receipt.menuConfiguredAt)throw invalid()
 const input=JSON.parse(receipt.signature);operationHeader(input)
 if(input.id!==receipt.id||input.kind!=='restaurant'||input.action!=='configure'||input.time!==receipt.time||receipt.signature!==canonicalSignature(input)||input.config?.fundsEnabled!==true)throw invalid()
 validateRestaurantMenuConfiguration(receipt.menuConfiguration,input.config)
 return receipt.menuConfiguration
}
export function usesRestaurantMenu(config,entries=[],operations=[]){return !!config&&Object.hasOwn(config,'menu')||entries.some(entry=>Object.hasOwn(entry,'menu'))||operations.some(receipt=>Object.hasOwn(receipt,'menuConfiguration'))}
export function assertRestaurantMenuActor(actor,users){
 if(!actor||!['owner','staff'].includes(actor.role)||!Array.isArray(users)||!users.some(user=>user.id===actor.userId&&user.role===actor.role&&user.username===actor.username))throw Error('權限不足')
}
export function menuConfigurationReceipt(config,products){return config.menu?captureRestaurantMenuConfiguration(config,products):null}
function currentConfiguration(data){
 if(!data.config.menu||data.config.fundsEnabled!==true)throw invalid()
 const receipt=data.operations.find(receipt=>receipt.id===data.menuConfigurationId),saved=configuration(receipt)
 // Current catalogue prices/costs may change independently; the saved definition
 // and recipe must still match the acknowledged configuration.
 validateRestaurantMenuConfiguration(saved,data.config)
 return receipt
}
export function restaurantMenuAuthorityPreview(input,data){
 only(input,['items']);const receipt=currentConfiguration(data),result=quoteRestaurantMenu({...data,menu:data.config.menu},input.items)
 return {protocol:'pos-restaurant-menu-preview/v1',menuReview:{configurationId:receipt.id,quote:result.quote},availability:result.availability}
}
export function restaurantMenuPreview(input,data,actor){assertRestaurantMenuActor(actor,data.users);return restaurantMenuAuthorityPreview(input,data)}
export function materializeRestaurantMenu(request,data,actor){
 assertPrivateDraftOperation(request,{data,actor})
 const allowed=['id','kind','action','time','storeId','epoch','fundsProtocol','costMode','day','slot','channel','customer','contact','note','menuProtocol','menuReview','agentDraft','draftContext','customerOrderId','customerOrderSignature']
 if(Object.keys(request).some(key=>!allowed.includes(key))||request.action!=='create'||request.menuProtocol!==RESTAURANT_MENU_PROTOCOL||request.fundsProtocol!=='pos-restaurant-funds/v1')throw invalid()
 assertRestaurantMenuActor(actor,data.users);currentConfiguration(data);only(request.menuReview,['configurationId','quote'])
 const receipt=data.operations.find(receipt=>receipt.id===request.menuReview.configurationId),saved=configuration(receipt),quote=validateRestaurantMenuQuote(request.menuReview.quote)
 if(Date.parse(receipt.menuConfiguredAt)>Date.parse(quote.issuedAt))throw invalid()
 assertRestaurantMenuQuoteConfiguration(quote,saved);reviewRestaurantMenuQuote({...data,menu:data.config.menu},quote)
 assertRestaurantAgentSource(request,{quote},{context:{storeId:data.storeId,role:actor.role,kinds:['restaurant'],restaurantEnabled:data.config.enabled,...restaurantAgentMenuContext(data.storeId,data.config,data.products)},now:data.now})
 if(request.customerOrderId){const source=data.orders.find(order=>order.id===request.customerOrderId);if(!source?.customerMenu)throw invalid();assertCustomerMenuIntake(source,request.menuReview)}
 return {protocol:ORIGINAL,configurationId:receipt.id,quote}
}
export const menuOriginalSignature=menu=>restaurantMenuDigest(menu)
export function fundedRestaurantProductIds(entry){
 const ids=entry.menu?entry.menu.quote.lineFacts.map(row=>row.productId):entry.funds.items.map(row=>row.id)
 return [...new Set([...ids,...entry.funds.itemAllocations.flatMap(row=>row.rows.map(row=>row.id))])]
}
export function assertMenuCreateResult(request,entry,receipt){
 if(!entry.menu){if(request.menuProtocol!==undefined||receipt.menuSourceSignature!==undefined)throw invalid();return}
 const menu=entry.menu;only(menu,['protocol','configurationId','quote']);if(menu.protocol!==ORIGINAL)throw invalid();validateRestaurantMenuQuote(menu.quote)
 if(!same(menu.quote.items,entry.funds.items)||!same(menu.quote.itemAllocations,entry.funds.itemAllocations)||receipt.menuSourceSignature!==menuOriginalSignature(menu))throw invalid()
 if(request.action==='create'&&(request.menuProtocol!==RESTAURANT_MENU_PROTOCOL||request.items!==undefined||!same(request.menuReview,{configurationId:menu.configurationId,quote:menu.quote})||!same(menu.quote.scope,{storeId:request.storeId,epoch:request.epoch,costMode:request.costMode})))throw invalid()
 if(request.action==='create')assertRestaurantAgentSource(request,menu)
}
export function validateRestaurantMenuBook(config,entries,operations,configurationId,orders=[],menuReceiptKey){
 if(!usesRestaurantMenu(config,entries,operations)&&!orders.some(order=>Object.hasOwn(order,'customerMenu')))return
 const configurations=new Map()
 for(const receipt of operations)if(Object.hasOwn(receipt,'menuConfiguration')){if(configurations.has(receipt.id))throw invalid();configurations.set(receipt.id,configuration(receipt))}
 if(config?.menu){const saved=configurations.get(configurationId);if(!saved||config.fundsEnabled!==true)throw invalid();validateRestaurantMenuConfiguration(saved,config)}
 for(const order of orders.filter(order=>Object.hasOwn(order,'customerMenu'))){
  const source=validateCustomerMenuOrder(order),saved=configurations.get(source.menuReview.configurationId);if(!saved)throw invalid()
  assertCustomerMenuAuthentication(order,menuReceiptKey)
  assertRestaurantMenuQuoteConfiguration(source.menuReview.quote,saved)
  if(Date.parse(operations.find(receipt=>receipt.id===source.menuReview.configurationId).menuConfiguredAt)>Date.parse(source.menuReview.quote.issuedAt))throw invalid()
 }
 for(const entry of entries.filter(entry=>Object.hasOwn(entry,'menu'))){
  if(!entry.funds)throw invalid();const first=operations.filter(receipt=>receipt.entityId===entry.id&&receipt.entityVersion===1);if(first.length!==1)throw invalid()
  const created=JSON.parse(first[0].signature);assertMenuCreateResult(created,entry,first[0]);const saved=configurations.get(entry.menu.configurationId);if(!saved)throw invalid()
  assertRestaurantMenuQuoteConfiguration(entry.menu.quote,saved)
  if(Date.parse(operations.find(receipt=>receipt.id===entry.menu.configurationId).menuConfiguredAt)>Date.parse(entry.menu.quote.issuedAt))throw invalid()
  for(const receipt of operations.filter(receipt=>receipt.entityId===entry.id))if(receipt.menuSourceSignature!==menuOriginalSignature(entry.menu))throw invalid()
 }
}
