import {useState} from 'react'
import {tr} from '../i18n'
import {openingSourceFacts,replaceOpeningSourceFact} from '../../electron/openingMigrationTables.mjs'
const labels={quantity:'庫存數量',value:'庫存總成本',rate:'庫存單位成本',date:'原資料日期'}

export default function OpeningMigrationFacts({text,disabled,onChange}){
 const [visible,setVisible]=useState(5),facts=openingSourceFacts(text)
 if(!facts.length)return null
 return <div data-opening-facts><p>{tr('只需確認這幾格')}</p>{facts.slice(0,visible).map(fact=><label key={[fact.part,fact.row,fact.column].join(':')}>
  <strong>{fact.externalId} · {tr(labels[fact.kind])}</strong><small>{fact.sheetId?fact.sheetId+' · ':''}{tr('原檔第 {0} 列',{0:fact.physicalRow})} · {fact.label}</small>
  <input className="field" type={fact.kind==='date'?'date':'text'} data-opening-cell={[fact.part,fact.row,fact.column].join(':')} value={fact.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(fact.value)?'':fact.value} disabled={disabled||!fact.canEdit} maxLength={2048} inputMode={fact.kind==='date'?'text':'decimal'} onChange={e=>onChange(replaceOpeningSourceFact(text,fact,e.target.value))}/>
  {(fact.reviewed||fact.kind==='date')&&<small>{tr('原值')}：<del>{fact.original||tr('空白')}</del></small>}
  {fact.acknowledge&&<button type="button" className="btn" data-opening-ack={[fact.part,fact.row,fact.column].join(':')} disabled={disabled} onClick={()=>onChange(replaceOpeningSourceFact(text,fact,fact.original))}>{tr('這格已核對')}</button>}
  {fact.blocked&&<small>{tr(fact.blockedReason==='currency'?'不同幣別先核對換算，不能直接當新台幣。':'來源數字超出可用範圍，請先核對原帳。')}</small>}
 </label>)}{facts.length>visible&&<button className="btn" disabled={disabled} onClick={()=>setVisible(n=>n+5)}>{tr('查看更多')}</button>}</div>
}
