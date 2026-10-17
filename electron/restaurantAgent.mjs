import {canonicalSignature} from './operationRules.mjs'
import {assertRestaurantMenuActor,restaurantMenuPreview} from './restaurantMenuOriginal.mjs'
import {assertRestaurantAgentShape,assertRestaurantAgentOriginal,restaurantAgentMenuContext,validateRestaurantAgentDraft} from './restaurantAgentDraft.mjs'
import {AGENT_PROTOCOL} from './agentDraftRules.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'
import {assertOrdinaryRestaurantAgentDraft,ordinaryRestaurantAgentPreview,ordinaryRestaurantAgentOriginal} from './ordinaryRestaurantAgent.mjs'

export const RESTAURANT_AGENT_PREVIEW='pos-restaurant-agent-preview/v1'
export function previewRestaurantAgent(input,data,actor){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['draft','refresh'].includes(key))||!input.draft||Object.hasOwn(input,'refresh')&&typeof input.refresh!=='boolean')throw Error('餐點草稿格式不完整，請保留原內容核對。')
 assertRestaurantMenuActor(actor,data.users)
 const ordinary=input.draft.protocol===AGENT_PROTOCOL&&input.draft.kind==='restaurant'
 if(ordinary)assertOrdinaryRestaurantAgentDraft(input.draft);else assertRestaurantAgentShape(input.draft)
 const id='agent-'+input.draft.id,entry=data.entries.find(row=>row.id===id),receipt=data.operations.find(row=>row.id===id)
 // An accepted original is checked before current menu revisions or expiry.
 // This lookup never recreates the original under a new quote or generation.
 if(entry||receipt){const original=ordinary?ordinaryRestaurantAgentOriginal(input.draft,entry,receipt,data.storeId):assertRestaurantAgentOriginal(input.draft,entry||{},receipt,data.storeId);return {protocol:RESTAURANT_AGENT_PREVIEW,status:'accepted',original,originalProof:{id, digest:privateDraftDigest(JSON.parse(receipt.signature))}}}
 if(ordinary)return ordinaryRestaurantAgentPreview(input,data,actor)
 const context={storeId:data.storeId,role:actor.role,kinds:['restaurant'],restaurantEnabled:data.config.enabled,...restaurantAgentMenuContext(data.storeId,data.config,data.products)}
 if(!context.restaurantMenu)throw Error('請先在預訂出餐確認產能與配方並啟用預訂')
 const draft={...input.draft,...(input.refresh?{menuRevision:context.restaurantMenuRevision}:{})}
 const preview=validateRestaurantAgentDraft(draft,context,typeof data.now==='number'?data.now:Date.parse(data.now),true),result=restaurantMenuPreview({items:preview.menuInput},data,actor)
 const actual=result.menuReview.quote.items.map(({id,name,price,qty})=>({id,name,price,qty})),expected=preview.items.map(({id,name,price,qty})=>({id,name,price,qty}))
 if(canonicalSignature(actual)!==canonicalSignature(expected)||result.menuReview.quote.totalCents!==Math.round(preview.total*100))throw Error('餐點報價與原選擇不同，請重新核對。')
 return {protocol:RESTAURANT_AGENT_PREVIEW,status:'review',draft:preview.draft,menuReview:result.menuReview,availability:result.availability}
}
