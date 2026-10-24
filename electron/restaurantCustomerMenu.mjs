import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'
import {hmac} from '@noble/hashes/hmac.js'
import {canonicalSignature} from './operationRules.mjs'
import {validateRestaurantMenuQuote} from './restaurantMenu.mjs'
import {PUBLIC_MENU_PROTOCOL,PUBLIC_QUOTE_PROTOCOL,assertPublicMenuQuote,menuCanonical} from '../public/menu/menuProtocol.mjs'

export const RESTAURANT_PUBLIC_MENU_FEATURE='restaurant-public-menu-v1'
export const CUSTOMER_MENU_PROTOCOL='pos-restaurant-customer-menu/v1'
const same=(a,b)=>menuCanonical(a)===menuCanonical(b),invalid=()=>Error('顧客選餐原單需要核對，請保留原單。')
export const customerMenuRequestSignature=request=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(request))))
export const usesRestaurantPublicMenu=(orders=[])=>orders.some(order=>Object.hasOwn(order,'customerMenu')||order.trackingProof?.version===2)
export function customerMenuAuthentication(order,key){
 const bytes=typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)?Uint8Array.from(key.match(/../g),part=>parseInt(part,16)):key
 if(!(bytes instanceof Uint8Array)||bytes.length!==32)throw invalid()
 const material={protocol:'pos-customer-menu-source/v1',id:order.id,requestSignature:order.requestSignature,time:order.time,tableNum:order.tableNum||'',tableId:order.tableId||'',tableSignature:order.tableSignature||'',items:order.items,total:order.total,payMethod:order.payMethod,paid:order.paid,source:order.source,note:order.note||'',customerMenu:order.customerMenu}
 return bytesToHex(hmac(sha256,bytes,new TextEncoder().encode(canonicalSignature(material))))
}
export function assertCustomerMenuAuthentication(order,key){
 const actual=order.trackingProof?.menuSignature
 if(order.trackingProof?.version!==2||typeof actual!=='string'||!/^[a-f0-9]{64}$/.test(actual))throw invalid()
 const expected=customerMenuAuthentication(order,key);let diff=0;for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);if(diff)throw invalid()
}
export function publicMenuQuoteBody(review,issuedAt=review.quote.issuedAt){
 const q=review.quote
 return {protocol:PUBLIC_QUOTE_PROTOCOL,storeId:q.scope.storeId,input:structuredClone(q.input),items:q.items.map(({id,name,price,qty})=>({id,name,price,qty})),totalCents:q.totalCents,issuedAt,expiresAt:new Date(Date.parse(issuedAt)+300000).toISOString()}
}
export function publicRestaurantMenu(config,products){
 if(!config.enabled||!config.menu||!config.fundsEnabled)throw invalid()
 return {protocol:PUBLIC_MENU_PROTOCOL,offers:config.menu.offers.map(offer=>({id:offer.id,name:offer.name,category:products.find(product=>product.id===offer.productId)?.category||'',defaultVariantId:offer.defaultVariantId,variants:offer.variants.map(({id,name,price})=>({id,name,price})),groups:offer.groups.map(({id,name,min,max,defaults,choices})=>({id,name,min,max,defaults:structuredClone(defaults),choices:choices.map(({id,name,priceDelta,max})=>({id,name,priceDelta,max}))}))}))}
}
export function assertCustomerMenuRequest(request){
 const allowed=['requestId','items','customerName','tableNum','note','table','key','menuProtocol','menuReview']
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!allowed.includes(key))||request.menuProtocol!==PUBLIC_MENU_PROTOCOL||typeof request.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId))throw invalid()
 const review=assertPublicMenuQuote(request.menuReview)
 if(!same(request.items,review.input))throw invalid()
 for(const [key,max]of [['customerName',100],['tableNum',40],['note',500]])if(request[key]!==undefined&&(typeof request[key]!=='string'||request[key].length>max))throw invalid()
 if((Object.hasOwn(request,'table')||Object.hasOwn(request,'key'))&&(typeof request.table!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(request.table)||typeof request.key!=='string'||!/^[a-f0-9]{64}$/.test(request.key)))throw invalid()
 return request
}
export function validateCustomerMenuOrder(order){
 const source=order.customerMenu
 if(!source||source.protocol!==CUSTOMER_MENU_PROTOCOL||Object.keys(source).sort().join(',')!=='menuReview,protocol,request'||order.source!=='customer'||!['pending','rejected'].includes(order.status)||order.payMethod!=='pending'||order.paid!==0||order.refundOf)throw invalid()
 if(order.trackingProof?.version!==2||typeof order.trackingProof.menuSignature!=='string'||!/^[a-f0-9]{64}$/.test(order.trackingProof.menuSignature))throw invalid()
 assertCustomerMenuRequest(source.request)
 const review=source.menuReview;if(!review||Object.keys(review).sort().join(',')!=='configurationId,quote'||typeof review.configurationId!=='string'||!review.configurationId)throw invalid()
 const quote=validateRestaurantMenuQuote(review.quote),publicReview=source.request.menuReview,{token,...body}=publicReview
 if(!same(body,publicMenuQuoteBody(review,publicReview.issuedAt))||!same(order.items,body.items)||order.id!=='CO'+source.request.requestId||order.total!==body.totalCents/100||order.requestSignature!==customerMenuRequestSignature(source.request))throw invalid()
 if(order.note!==(source.request.customerName?source.request.customerName+': ':'')+(source.request.note||'')||(source.request.tableNum!==undefined||!source.request.table)&&(order.tableNum||'')!==(source.request.tableNum||'')||(order.tableId||'')!==(source.request.table||'')||(order.tableSignature||'')!==(source.request.key||''))throw invalid()
 const accepted=Date.parse(order.time)
 if(!Number.isFinite(accepted)||accepted<Date.parse(publicReview.issuedAt)||accepted>Date.parse(publicReview.expiresAt)||Date.parse(quote.issuedAt)>accepted||accepted-Date.parse(quote.issuedAt)>300000)throw invalid()
 return source
}
export function assertCustomerMenuIntake(source,review){
 const original=validateCustomerMenuOrder(source).menuReview.quote,current=validateRestaurantMenuQuote(review.quote)
 if(!same(original.source,current.source)||!same(original.input,current.input)||!same(original.items,current.items)||original.totalCents!==current.totalCents)throw Error('這張點餐的菜單已變更，請先讓顧客重新確認。')
}
