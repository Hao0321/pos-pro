export const CUSTOMER_CART_CONTEXT='pos-customer-cart-context/v1'
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export function assertCartContext(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='mode,protocol,revision,scopeId'||value.protocol!==CUSTOMER_CART_CONTEXT||!['ordinary','menu'].includes(value.mode)||!hex(value.scopeId)||!hex(value.revision))throw Error('無法核對菜單，請重新開啟點餐頁。')
 return value
}
export function cartContextHeaders(value){
 if(value===undefined)return {}
 const context=assertCartContext(value)
 return {'X-POS-Cart-Scope':context.scopeId,'X-POS-Cart-Revision':context.revision}
}
