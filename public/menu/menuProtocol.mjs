export const PUBLIC_MENU_PROTOCOL='pos-restaurant-public-menu/v1'
export const PUBLIC_QUOTE_PROTOCOL='pos-restaurant-public-quote/v1'
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
export const menuCanonical=value=>JSON.stringify(canonical(value))
const invalid=()=>Error('餐點選項已變更，請重新選擇。')
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw invalid()}
const id=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value))throw invalid()}
const count=value=>{if(!Number.isSafeInteger(value)||value<1||value>100000)throw invalid()}
export function assertPublicSelections(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw invalid()
 for(const row of rows){exact(row,['offerId','variantId','qty','selections']);id(row.offerId);id(row.variantId);count(row.qty)
  if(!Array.isArray(row.selections)||row.selections.length>20)throw invalid();const groups=new Set()
  for(const group of row.selections){exact(group,['groupId','choices']);id(group.groupId);if(groups.has(group.groupId)||!Array.isArray(group.choices)||group.choices.length>20)throw invalid();groups.add(group.groupId);const choices=new Set()
   for(const choice of group.choices){exact(choice,['id','qty']);id(choice.id);count(choice.qty);if(choices.has(choice.id))throw invalid();choices.add(choice.id)}
  }
 }
 return rows
}
export function assertPublicMenuQuote(value){
 exact(value,['protocol','storeId','input','items','totalCents','issuedAt','expiresAt','token'])
 if(value.protocol!==PUBLIC_QUOTE_PROTOCOL||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token))throw invalid();id(value.storeId);assertPublicSelections(value.input)
 if(!Array.isArray(value.items)||value.items.length!==value.input.length)throw invalid()
 const ids=new Set();let total=0n
 for(const [index,item]of value.items.entries()){exact(item,['id','name','price','qty']);id(item.id);count(item.qty)
  if(ids.has(item.id)||typeof item.name!=='string'||!item.name||item.name.length>500||item.qty!==value.input[index].qty||typeof item.price!=='number'||!Number.isFinite(item.price)||item.price<0||item.price>1e9||Math.abs(item.price*100-Math.round(item.price*100))>1e-6)throw invalid()
  ids.add(item.id);total+=BigInt(Math.round(item.price*100))*BigInt(item.qty)
 }
 if(total>100000000000n||Number(total)!==value.totalCents)throw invalid()
 for(const key of ['issuedAt','expiresAt'])if(typeof value[key]!=='string'||!Number.isFinite(Date.parse(value[key]))||new Date(value[key]).toISOString()!==value[key])throw invalid()
 if(Date.parse(value.expiresAt)-Date.parse(value.issuedAt)!==300000)throw invalid()
 return value
}
export function assertQuotedSelections(rows,quote){
 assertPublicSelections(rows);assertPublicMenuQuote(quote)
 const normalized=input=>{const map=new Map();for(const row of input){const key=menuCanonical({offerId:row.offerId,variantId:row.variantId,selections:row.selections.map(group=>({...group,choices:[...group.choices].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)})).sort((a,b)=>a.groupId<b.groupId?-1:a.groupId>b.groupId?1:0)});map.set(key,(map.get(key)||0)+row.qty)}return [...map].sort(([a],[b])=>a<b?-1:a>b?1:0)}
 if(menuCanonical(normalized(rows))!==menuCanonical(normalized(quote.input)))throw invalid()
 return quote
}
