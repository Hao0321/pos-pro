const {createHmac,timingSafeEqual}=require('node:crypto')
const {canonicalSignature}=require('./operationRules.mjs')
const {publicMenuQuoteBody,assertCustomerMenuRequest}=require('./restaurantCustomerMenu.mjs')
const {assertPublicMenuQuote}=require('../public/menu/menuProtocol.mjs')
const token=(key,body,review)=>createHmac('sha256',key).update(canonicalSignature({protocol:'pos-public-menu-seal/v1',body,privateSourceSignature:review.quote.signature})).digest('hex')
function quote(review,key){const body=publicMenuQuoteBody(review);return {...body,token:token(key,body,review)}}
function verify(request,preview,key,now){
 assertCustomerMenuRequest(request);const submitted=assertPublicMenuQuote(request.menuReview),{token:received,...body}=submitted,expected=publicMenuQuoteBody(preview.menuReview,submitted.issuedAt)
 if(now<Date.parse(submitted.issuedAt)||now>Date.parse(submitted.expiresAt)||canonicalSignature(body)!==canonicalSignature(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(token(key,body,preview.menuReview))))throw Error('餐點報價已更新，請重新核對。')
 if(!preview.availability.available)throw Error('這些餐點目前數量不足，請減少份數或詢問店家。')
 return preview.menuReview
}
module.exports={quote,verify}
