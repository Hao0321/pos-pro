const {createHash}=require('node:crypto')
const {CUSTOMER_CART_CONTEXT}=require('../public/menu/cartContext.mjs')
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function context({storeId,epoch,table,key,menu,products}){
 if(typeof storeId!=='string'||!storeId||typeof epoch!=='string'||!epoch)throw Error('店面身份需要核對')
 const mode=menu?'menu':'ordinary'
 // The scope is an opaque namespace, never a substitute for resolveTable.
 const scopeId=digest({protocol:CUSTOMER_CART_CONTEXT,storeId,epoch,table:table?{id:table.id,key}:null,mode})
 const terms=menu||products.map(({id,name,price,unit})=>({id,name,price,unit:unit??''})).sort((a,b)=>a.id.localeCompare(b.id,'en'))
 return {protocol:CUSTOMER_CART_CONTEXT,scopeId,revision:digest({mode,terms}),mode}
}
function assertCurrent(scope,revision,current){
 // Omission is the existing client protocol. A partial declaration is invalid.
 if(scope===undefined&&revision===undefined)return
 const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
 if(!hex(scope)||!hex(revision)||!current||scope!==current.scopeId)throw Object.assign(Error('這張桌碼或店面已變更，請重新掃描。'),{cartContextCode:'CART_CONTEXT_CHANGED'})
 if(revision!==current.revision)throw Object.assign(Error('菜單價格已更新，請確認新金額後送出。'),{cartContextCode:'CART_REVIEW_CHANGED'})
}
module.exports={context,assertCurrent}
