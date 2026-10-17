import {canonicalSignature} from './operationRules.mjs'
import {normalizeRestaurantSelections,restaurantMenuLineSummary,restaurantMenuDigest,validateRestaurantMenuQuote} from './restaurantMenu.mjs'
import {publicRestaurantMenu} from './restaurantCustomerMenu.mjs'

export const RESTAURANT_AGENT_PROTOCOL='pos-restaurant-agent-draft/v1'
const invalid=()=>Error('餐點草稿格式不完整，請保留原內容核對。')
function object(value,allowed,required=[]){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw invalid()}
function array(value,max,min=0){if(!Array.isArray(value)||value.length<min||value.length>max||Object.keys(value).length!==value.length)throw invalid();return value}
function id(value,max=128){if(typeof value!=='string'||!/^[-A-Za-z0-9_:]+$/.test(value)||value.length>max)throw invalid()}
function count(value){if(!Number.isSafeInteger(value)||Object.is(value,-0)||value<1||value>100000)throw invalid()}
function text(value,max){if(value===undefined)return '';if(typeof value!=='string'||value.length>max)throw invalid();return value.trim()}
const validDay=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const instant=new Date(value+'T00:00:00Z');return Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,10)===value}
export function restaurantAgentMenuContext(storeId,config,products){
 if(!config?.enabled||!config.fundsEnabled||!config.menu)return {}
 const restaurantMenu=publicRestaurantMenu(config,products),restaurantMenuRevision=restaurantMenuDigest({storeId,menu:restaurantMenu}).slice(7)
 return {restaurantMenu,restaurantMenuRevision}
}
export function assertRestaurantAgentItems(items,{allowEmpty=false}={}){
 for(const item of array(items,100,allowEmpty?0:1)){object(item,['offerId','variantId','qty','selections'],['offerId','qty']);id(item.offerId,64);count(item.qty);if(Object.hasOwn(item,'variantId'))id(item.variantId,64)
  if(Object.hasOwn(item,'selections'))for(const group of array(item.selections,8)){object(group,['groupId','choices'],['groupId','choices']);id(group.groupId,64);for(const choice of array(group.choices,20)){object(choice,['id','qty'],['id','qty']);id(choice.id,64);count(choice.qty)}}
 }
 return items
}
export function assertRestaurantAgentShape(draft,{allowEmpty=false}={}){
 object(draft,['protocol','id','issuedAt','storeId','menuRevision','kind','items','channel','day','slot','customer','contact','note'],['protocol','id','issuedAt','storeId','menuRevision','kind','items'])
 if(draft.protocol!==RESTAURANT_AGENT_PROTOCOL||draft.kind!=='restaurant'||!/^[-A-Za-z0-9_]{8,80}$/.test(draft.id||'')||typeof draft.menuRevision!=='string'||!/^[a-f0-9]{64}$/.test(draft.menuRevision))throw invalid()
 id(draft.storeId)
 if(typeof draft.issuedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(draft.issuedAt)||!validDay(draft.issuedAt.slice(0,10))||!Number.isFinite(Date.parse(draft.issuedAt)))throw invalid()
 assertRestaurantAgentItems(draft.items,{allowEmpty})
 for(const [key,max]of [['channel',10],['day',10],['slot',5],['customer',100],['contact',100],['note',1000]])if(Object.hasOwn(draft,key))text(draft[key],max)
 if(new TextEncoder().encode(JSON.stringify(draft)).length>32768)throw Error('單據太大，請分批匯入（每次最多 32 KB）')
 return draft
}
export function restaurantAgentFields(draft,allowIncomplete=false){
 const channel=text(draft.channel,10),day=text(draft.day,10),slot=text(draft.slot,5),customer=text(draft.customer,100),contact=text(draft.contact,100),note=text(draft.note,1000)
 if(!(allowIncomplete&&!channel)&&!['preorder','walkin','delivery'].includes(channel)||!(allowIncomplete&&!day)&&!validDay(day)||!(allowIncomplete&&!slot)&&!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(slot))throw Error('請確認取餐日期與時段（每 15 分鐘）')
 if(!allowIncomplete&&channel!=='walkin'&&!contact)throw Error('預訂或外送請填聯絡方式')
 if(!allowIncomplete&&channel==='delivery'&&!note)throw Error('外送請在備註填寫地址')
 return {channel,day,slot,customer,contact,note}
}
export function validateRestaurantAgentDraft(draft,context,now=Date.now(),allowIncomplete=false){
 assertRestaurantAgentShape(draft)
 if(!context||!['owner','staff'].includes(context.role)||!context.kinds?.includes('restaurant'))throw Error('請先登入')
 if(draft.storeId!==context.storeId)throw Error('這份草稿屬於另一間店，沒有建立任何單據')
 if(now-Date.parse(draft.issuedAt)>86400000||Date.parse(draft.issuedAt)-now>300000)throw Error('草稿已過期或時間不正確，請重新整理草稿')
 if(!context.restaurantEnabled||!context.restaurantMenu)throw Error('請先在預訂出餐確認產能與配方並啟用預訂')
 if(draft.menuRevision!==context.restaurantMenuRevision)throw Error('菜單已更新，請重新核對餐點與總額。')
 const input=normalizeRestaurantSelections(draft.items,context.restaurantMenu),items=input.map(row=>({...restaurantMenuLineSummary(row,context.restaurantMenu),unit:'份'})),fields=restaurantAgentFields(draft,allowIncomplete)
 const totalCents=items.reduce((sum,row)=>sum+BigInt(Math.round(row.price*100))*BigInt(row.qty),0n);if(totalCents>100000000000n)throw invalid()
 return {draft:{...structuredClone(draft),...fields,items:input},items,total:Number(totalCents)/100,note:fields.note,menuInput:input}
}
export function restaurantAgentExampleItem(offer){
 const selections=offer.groups.map(group=>{const choices=structuredClone(group.defaults),current=()=>choices.reduce((sum,row)=>sum+row.qty,0);for(const option of group.choices){if(current()>=group.min)break;const row=choices.find(row=>row.id===option.id),extra=Math.min(group.min-current(),option.max-(row?.qty||0));if(extra){if(row)row.qty+=extra;else choices.push({id:option.id,qty:extra})}}if(current()<group.min)throw Error('必選項目的可選份數不足，請調整選項。');return {groupId:group.id,choices}})
 return {offerId:offer.id,variantId:offer.defaultVariantId,qty:1,selections}
}
export function reviewedRestaurantAgentDraft(draft,context,result,now=Date.now(),allowIncomplete=false){
 const preview=validateRestaurantAgentDraft(draft,context,now,allowIncomplete)
 if(result?.protocol!=='pos-restaurant-agent-preview/v1'||result.status!=='review'||typeof result.menuReview?.configurationId!=='string'||!result.menuReview.configurationId||typeof result.availability?.available!=='boolean'||['id','issuedAt','storeId','menuRevision'].some(key=>result.draft?.[key]!==draft[key]))throw invalid()
 const quote=validateRestaurantMenuQuote(result.menuReview.quote),rows=quote.items.map(({id,name,price,qty})=>({id,name,price,qty})),expected=preview.items.map(({id,name,price,qty})=>({id,name,price,qty}))
 if(quote.scope.storeId!==draft.storeId||canonicalSignature(result.draft.items)!==canonicalSignature(preview.menuInput)||canonicalSignature(quote.input)!==canonicalSignature(preview.menuInput)||canonicalSignature(rows)!==canonicalSignature(expected)||quote.totalCents!==Math.round(preview.total*100))throw Error('餐點報價與原選擇不同，請重新核對。')
 return {...preview,menuReview:result.menuReview,availability:result.availability}
}
export function assertRestaurantAgentOriginal(draft,entry,receipt,storeId){
 assertRestaurantAgentShape(draft)
 if(draft.storeId!==storeId||entry.id!=='agent-'+draft.id||receipt?.id!==entry.id||receipt.action!=='create'||!entry.menu)throw Error('原編號已用於不同內容，請保留原單核對。')
 const original=JSON.parse(receipt.signature),fields=restaurantAgentFields(draft),input=normalizeRestaurantSelections(draft.items,entry.menu.quote.source.menu)
 if((original.agentDraft?.issuedAt??original.time)!==draft.issuedAt||original.menuProtocol!=='pos-restaurant-menu/v1'||canonicalSignature(original.menuReview?.quote)!==canonicalSignature(entry.menu.quote)||canonicalSignature(input)!==canonicalSignature(entry.menu.quote.input)||Object.entries(fields).some(([key,value])=>value!==original[key]))throw Error('原編號已用於不同內容，請保留原單核對。')
 return {id:entry.id,status:entry.status,totalCents:entry.menu.quote.totalCents,currentTotalCents:Math.round(entry.total*100)}
}
export function assertRestaurantAgentSource(request,menu,{context=null,now=null}={}){
 if(!Object.hasOwn(request,'agentDraft'))return
 const draft=assertRestaurantAgentShape(request.agentDraft),fields=restaurantAgentFields(draft),input=normalizeRestaurantSelections(draft.items,menu.quote.source.menu),age=Date.parse(request.time)-Date.parse(draft.issuedAt)
 if(request.action!=='create'||request.customerOrderId||request.id!=='agent-'+draft.id||draft.storeId!==request.storeId||request.time!==menu.quote.issuedAt||age< -300000||age>86400000||canonicalSignature(input)!==canonicalSignature(menu.quote.input)||Object.entries(fields).some(([key,value])=>value!==request[key]))throw Error('原編號已用於不同內容，請保留原單核對。')
 if(context)validateRestaurantAgentDraft(draft,context,typeof now==='number'?now:Date.parse(now))
}
