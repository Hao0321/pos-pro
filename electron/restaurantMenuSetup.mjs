import {canonicalSignature} from './operationRules.mjs'
import {normalizeRestaurantMenu,captureRestaurantMenuConfiguration,restaurantMenuDigest,quoteRestaurantMenu} from './restaurantMenu.mjs'
import {assertRestaurantMenuActor} from './restaurantMenuOriginal.mjs'
import {restaurantFundsSetupState} from './restaurantFundsSetup.mjs'

export const RESTAURANT_MENU_SETUP='pos-restaurant-menu-setup-review/v1'
const error=()=>Error('菜單核對資料已變更，請保留輸入並重新預覽。')
function only(value,keys,required=keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw error()}
const scope=data=>({storeId:data.storeId||'',epoch:data.epoch||'',costMode:data.costMode})
function setupSource(config,data){const activationBasis=data.epoch?null:restaurantMenuDigest({config:data.config,products:data.products,entries:data.entries||[],operations:data.operations||[],orders:data.orders||[],cashLogs:data.cashLogs||[],waste:data.waste||[],shifts:data.shifts||[]});return restaurantMenuDigest({config,source:captureRestaurantMenuConfiguration(config,data.products),activationBasis})}
const displayResources=(rows,products)=>rows.map(row=>({...row,unit:products.find(product=>product.id===row.id).unit}))
function exampleSelections(offer){return offer.groups.map(group=>{
 const choices=structuredClone(group.defaults);let count=choices.reduce((sum,row)=>sum+row.qty,0)
 for(const choice of group.choices){if(count>=group.min)break;const current=choices.find(row=>row.id===choice.id),qty=Math.min(choice.max-(current?.qty||0),group.min-count);if(qty){if(current)current.qty+=qty;else choices.push({id:choice.id,qty});count+=qty}}
 if(count<group.min)throw Error('必選項目的可選份數不足，請調整選項。')
 return {groupId:group.id,choices}
})}
export function previewRestaurantMenuSetup(input,data,actor){
 assertRestaurantMenuActor(actor,data.users);if(actor.role!=='owner')throw Error('只有老闆能修改菜單')
 only(input,['menu','expectedMenu','selection'],['menu','expectedMenu'])
 if(input.expectedMenu!==canonicalSignature(data.config.menu??null))throw Error('菜單已由其他裝置修改，請先核對已保存菜單。')
 const config={...structuredClone(data.config),enabled:true,fundsEnabled:true,menu:normalizeRestaurantMenu(input.menu,data.products)},issuedAt=new Date(data.now).toISOString()
 if(!['active','reference'].includes(data.costMode)||data.epoch!==undefined&&typeof data.epoch!=='string'||!data.epoch&&data.config.fundsEnabled===true)throw error()
 const source=setupSource(config,data),review={protocol:RESTAURANT_MENU_SETUP,scope:scope(data),source,issuedAt},examples=[]
 for(const offer of config.menu.offers)for(const variant of offer.variants){
  const result=quoteRestaurantMenu({...data,storeId:data.storeId||'menu-setup-unassigned',epoch:data.epoch||'menu-setup-unassigned',config,menu:config.menu},[{offerId:offer.id,variantId:variant.id,qty:1,selections:exampleSelections(offer)}])
  examples.push({offerId:offer.id,variantId:variant.id,name:result.quote.items[0].name,priceCents:result.quote.totalCents,referenceCostCents:result.quote.referenceCostCents,capacity:variant.capacity,resources:displayResources(result.quote.allocations,data.products),available:result.availability.available})
 }
 let selection=null
 if(Object.hasOwn(input,'selection')){const result=quoteRestaurantMenu({...data,storeId:data.storeId||'menu-setup-unassigned',epoch:data.epoch||'menu-setup-unassigned',config,menu:config.menu},input.selection);selection={input:result.quote.input,items:result.quote.items,totalCents:result.quote.totalCents,referenceCostCents:result.quote.referenceCostCents,resources:displayResources(result.quote.allocations,data.products),available:result.availability.available}}
 return {protocol:'pos-restaurant-menu-setup-preview/v1',config,expectedConfig:canonicalSignature(data.config),menuSetupReview:review,examples,selection,...(restaurantFundsSetupState(data).newStore?{fundsSetupProposal:true}:{})}
}
export function assertRestaurantMenuSetupReview(review,config,data){
 only(review,['protocol','scope','source','issuedAt']);only(review.scope,['storeId','epoch','costMode'])
 const age=(typeof data.now==='number'?data.now:Date.parse(data.now))-Date.parse(review.issuedAt)
 if(review.protocol!==RESTAURANT_MENU_SETUP||typeof review.issuedAt!=='string'||!Number.isFinite(age)||age<0||age>300000||new Date(review.issuedAt).toISOString()!==review.issuedAt||canonicalSignature(review.scope)!==canonicalSignature(scope(data))||!config.menu||review.source!==setupSource(config,data))throw error()
 return review
}
