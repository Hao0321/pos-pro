import {stockCostSummary} from './stockCost.mjs'
import {journalLineCents} from './journalAmounts.mjs'
import {wasteToJournalEntries} from './accountingCore.mjs'
const quantity=value=>{const n=Math.round(Math.abs(value)*1000);if(!Number.isSafeInteger(n)||n<1)throw Error('損耗成本需要核對');return n}
const amount=journal=>{const value=(journal?.lines||[]).filter(line=>line.account==='5208').reduce((sum,line)=>sum+journalLineCents(journal,line,'debit')-journalLineCents(journal,line,'credit'),0n);if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('損耗成本需要核對');return Number(value)}
const unresolved=(waste,unit=null)=>({wasteId:waste.id,unit,basis:'unresolved',complete:false,knownValueCents:0,valueCents:null})
// Read only. Original waste.cost remains its recorded reference. Current source
// intervals and frozen pre-opening postings supply the displayed/exported value.
export function stockWasteCosts(state,wasteLog){
 const projection=state?.projection,rows=new Map(wasteLog.map(row=>[row.id,row]));if(rows.size!==wasteLog.length)throw Error('損耗成本需要核對')
 if(!projection)return wasteLog.map(waste=>{const knownValueCents=amount(wasteToJournalEntries(waste)[0]),complete=waste.cost>0;return {wasteId:waste.id,unit:null,basis:'reference',complete,knownValueCents,valueCents:complete?knownValueCents:null}})
 const sources=new Map(projection.custody.sources.map(row=>[row.id,row])),resolved=new Map()
 for(const business of projection.business||[]){
  const linked=business.replacedJournalIds.filter(id=>id.startsWith('JW')&&rows.has(id.slice(2))).map(id=>rows.get(id.slice(2))),groups=new Map()
  for(const waste of linked){if(resolved.has(waste.id))throw Error('損耗成本需要核對');const group=groups.get(waste.productId)||[];group.push(waste);groups.set(waste.productId,group)}
  for(const [productId,wastes]of groups){
   const parts=business.effects.filter(effect=>effect.to?.stage==='wasted').flatMap(effect=>effect.segments||[]).filter(segment=>sources.get(segment.sourceId)?.productId===productId),units=[...new Set(parts.map(segment=>sources.get(segment.sourceId).unit))]
   // Never invent attribution for an ambiguous historical group.
   if(wastes.length!==1||units.length!==1||parts.reduce((sum,row)=>sum+row.quantityUnits,0)!==quantity(wastes[0].qty)){for(const waste of wastes)resolved.set(waste.id,unresolved(waste,units.length===1?units[0]:null));continue}
   const summary=stockCostSummary(projection.custody.sources,parts);resolved.set(wastes[0].id,{wasteId:wastes[0].id,unit:units[0],basis:'original-source',complete:summary.complete,knownValueCents:summary.knownValueCents,valueCents:summary.valueCents})
  }
 }
 return wasteLog.map(waste=>{
  if(resolved.has(waste.id))return resolved.get(waste.id)
  const frozen=projection.legacyJournals?.find(journal=>journal.id==='JW'+waste.id)
  if(!frozen)return unresolved(waste)
  const knownValueCents=amount(frozen),complete=knownValueCents>0||waste.cost>0;return {wasteId:waste.id,unit:null,basis:'posted',complete,knownValueCents,valueCents:complete?knownValueCents:null}
 })
}
export function wasteAmountText(cents,locale='zh-TW',group=true){const value=BigInt(cents);if(value<0n)throw Error('損耗成本需要核對');const whole=value/100n,fraction=(value%100n).toString().padStart(2,'0'),separator=group?new Intl.NumberFormat(locale).formatToParts(1.1).find(part=>part.type==='decimal').value:'.';return (group?whole.toLocaleString(locale):whole.toString())+separator+fraction}
