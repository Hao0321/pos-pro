import {useEffect,useRef,useState} from 'react'
import {getAgentContext,loadRestaurantAgentPreview} from '../utils/dataAccess'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {normalizeRestaurantSelections} from '../../electron/restaurantMenu.mjs'
import {RESTAURANT_AGENT_PROTOCOL,reviewedRestaurantAgentDraft} from '../../electron/restaurantAgentDraft.mjs'
import {AGENT_PROTOCOL} from '../../electron/agentDraftRules.mjs'
import {reviewedOrdinaryRestaurantDraft} from '../../electron/ordinaryRestaurantAgent.mjs'

export const restaurantAgentReviewKey=draft=>draft?.protocol===RESTAURANT_AGENT_PROTOCOL||draft?.protocol===AGENT_PROTOCOL&&draft.kind==='restaurant'?canonicalSignature({protocol:draft.protocol,id:draft.id,issuedAt:draft.issuedAt,storeId:draft.storeId,revision:draft.menuRevision??draft.catalogueRevision,items:draft.items}):''
const identity=session=>canonicalSignature({userId:session.userId,role:session.role})
const empty={key:'',result:null,error:'',busy:false}
export default function useRestaurantAgentReview({draft,session,financialPending,onDraft,onContext,onAccepted}){
 const key=restaurantAgentReviewKey(draft),[state,setState]=useState(empty),sequence=useRef(0),latest=useRef(null)
 latest.current={draft,session,onDraft,onContext,onAccepted}
 useEffect(()=>()=>{sequence.current++},[])
 async function review(refresh=false){
  const current=latest.current;if(!restaurantAgentReviewKey(current.draft)||financialPending)return
  const request=structuredClone(current.draft),expected=restaurantAgentReviewKey(request),actor=identity(current.session),ticket=++sequence.current
  const valid=()=>ticket===sequence.current&&restaurantAgentReviewKey(latest.current.draft)===expected&&identity(latest.current.session)===actor
  setState({key:expected,result:null,error:'',busy:true})
  try{
   const result=await loadRestaurantAgentPreview({draft:request,...(refresh?{refresh:true}:{})},current.session);if(!valid())return
   if(result?.protocol!=='pos-restaurant-agent-preview/v1')throw Error('餐點草稿格式不完整，請保留原內容核對。')
   if(result.status==='accepted'){
    if(result.original?.id!=='agent-'+request.id||!Number.isSafeInteger(result.original.totalCents)||result.original.totalCents<0||!['reserved','cooking','ready','dispatched','completed','cancelled'].includes(result.original.status))throw Error('保存結果尚未確認，請保留原編號核對。')
    setState(empty);await latest.current.onAccepted(result.original,result.originalProof);return
   }
   const selected=request.protocol===RESTAURANT_AGENT_PROTOCOL,revision=selected?'menuRevision':'catalogueRevision'
   if(result.status!=='review'||result.draft?.protocol!==request.protocol||['id','issuedAt','storeId'].some(field=>result.draft?.[field]!==request[field])||!refresh&&result.draft[revision]!==request[revision])throw Error('餐點草稿格式不完整，請保留原內容核對。')
   const requested=selected?normalizeRestaurantSelections(request.items,result.menuReview.quote.source.menu):request.items
   if(canonicalSignature(requested)!==canonicalSignature(result.draft.items))throw Error('餐點報價與原選擇不同，請重新核對。')
   const context=await getAgentContext(current.session);if(!valid())return
   const fields=Object.fromEntries(['channel','day','slot','customer','contact','note'].filter(field=>Object.hasOwn(latest.current.draft,field)).map(field=>[field,latest.current.draft[field]])),next={...result.draft,...fields}
   if(selected)reviewedRestaurantAgentDraft(next,context,result,Date.now(),true);else reviewedOrdinaryRestaurantDraft(next,context,result,Date.now(),true)
   latest.current.onContext(context);latest.current.onDraft(next);setState({key:restaurantAgentReviewKey(next),result,error:'',busy:false})
  }catch(cause){if(valid())setState({key:expected,result:null,error:cause.message,busy:false})}
 }
 useEffect(()=>{
  if(!key||!draft.items.length){sequence.current++;setState(empty);return}
  if(financialPending){sequence.current++;setState(current=>({...current,busy:false}));return}
  if(state.key===key&&state.result)return
  review(false)
  return()=>{sequence.current++}
 },[key,session.userId,session.role,financialPending])
 return {busy:state.busy,error:state.error,result:state.key===key?state.result:null,refresh:()=>review(true),invalidate:()=>{sequence.current++;setState({key,result:null,error:'',busy:false})}}
}
