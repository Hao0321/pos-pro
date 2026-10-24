import {lotError,lotDay,lotRegistry} from './lotRules.mjs'
export function lotEffectiveDay(registry,time){return [registry.observedDay,lotDay(time,registry.timeZone)].sort().at(-1)}
export function splitLotSegments(custody,registry,segments){
 lotRegistry(registry,custody);const result=[]
 for(const part of segments){const end=part.offsetUnits+part.quantityUnits,cuts=new Set([part.offsetUnits,end]),items=registry.items.filter(row=>row.sourceId===part.sourceId)
  for(const lot of items)for(const range of lot.segments){const start=Math.max(part.offsetUnits,range.offsetUnits),stop=Math.min(end,range.offsetUnits+range.quantityUnits);if(start<stop){cuts.add(start);cuts.add(stop)}}
  const ordered=[...cuts].sort((a,b)=>a-b)
  for(let index=0;index<ordered.length-1;index++){const offset=ordered[index],stop=ordered[index+1],lot=items.find(row=>row.segments.some(range=>range.offsetUnits<=offset&&range.offsetUnits+range.quantityUnits>=stop))||null;result.push({segment:{...part,offsetUnits:offset,quantityUnits:stop-offset},lot})}
 }return result
}
export function lotEligibility(registry,productId,lot,day){if(lot?.expiryDate&&lot.expiryDate<day)return 'expired';if(registry.products.find(row=>row.productId===productId)?.required&&!lot?.expiryDate)return 'unknown';return 'eligible'}
export function lotPositionParts(custody,registry,owner,productId){const sources=new Map(custody.sources.map(row=>[row.id,row])),position=custody.positions.find(row=>row.owner.stage===owner.stage&&row.owner.locationId===owner.locationId&&row.owner.referenceId===owner.referenceId);return splitLotSegments(custody,registry,(position?.segments||[]).filter(part=>sources.get(part.sourceId)?.productId===productId))}
export function selectLotQuantity(parts,quantityUnits,{eligible=()=>true,fefo=false}={}){
 const selected=[],ordered=parts.filter(eligible).slice().sort((a,b)=>{const expiry=fefo?(a.lot?.expiryDate||'9999-12-31').localeCompare(b.lot?.expiryDate||'9999-12-31'):0;return expiry||a.segment.queueOrder-b.segment.queueOrder||a.segment.sourceId.localeCompare(b.segment.sourceId)||a.segment.offsetUnits-b.segment.offsetUnits});let needed=quantityUnits
 if(!Number.isSafeInteger(needed)||needed<1||needed>1e12)throw lotError('QUANTITY')
 for(const part of ordered){if(!needed)break;const count=Math.min(needed,part.segment.quantityUnits);selected.push({...part,segment:{...part.segment,quantityUnits:count}});needed-=count}
 if(needed)throw lotError('QUANTITY');return selected
}
export function unassignedLotIntervals(custody,registry,sourceId){return splitLotSegments(custody,registry,custody.positions.filter(row=>['available','reserved','quarantined'].includes(row.owner.stage)).flatMap(row=>row.segments).filter(part=>part.sourceId===sourceId)).filter(row=>!row.lot).sort((a,b)=>a.segment.offsetUnits-b.segment.offsetUnits)}
