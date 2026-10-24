import {useEffect,useState} from 'react'
import {tr} from '../i18n'
import TabularMigrationSetup from './TabularMigrationSetup'
import {readWorkbook} from '../../electron/workbookReader.mjs'
import {workbookView,workbookSheetPlan,suggestedWorkbookHeader,workbookCellNeedsReview} from '../../electron/workbookMigration.mjs'
import {masterMappedValueIssue} from '../../electron/masterMigration.mjs'

export default function WorkbookMigrationSetup({value,onChange,onPreview,disabled}){
 const [active,setActive]=useState(value.sheets[0]?.sheetId||''),[otherHeader,setOtherHeader]=useState(false);let book=null,error='',view=null
 try{book=readWorkbook(value.file.base64)}catch(cause){error=cause.message}
 useEffect(()=>{setActive(value.sheets[0]?.sheetId||'');setOtherHeader(false)},[value.file.base64])
 const selected=value.sheets.find(s=>s.sheetId===active),sheet=book?.sheets.find(s=>s.id===active)
 if(selected)try{view=workbookView(value,active)}catch(cause){error=cause.message}
 const changeSheet=next=>onChange({...value,sheets:value.sheets.map(s=>s.sheetId===next.sheetId?next:s)}),choose=id=>{setActive(id);setOtherHeader(false)},toggle=(id,checked)=>{if(checked){const header=suggestedWorkbookHeader(book,id);onChange({...value,sheets:[...value.sheets,workbookSheetPlan(value,id,header)]});choose(id)}else{onChange({...value,sheets:value.sheets.filter(s=>s.sheetId!==id)});if(active===id)choose(value.sheets.find(s=>s.sheetId!==id)?.sheetId||'')}}
 const focus=[]
 if(view&&selected){for(const issue of view.table.issues)if(workbookCellNeedsReview(issue,selected.plan))focus.push(issue);view.table.rows.forEach((row,ri)=>row.forEach((raw,ci)=>{const field=selected.plan.mapping[ci],identity=ci===selected.plan.externalId,required=identity||field==='name'||selected.plan.entity==='products'&&['price','cost','unit'].includes(field),issue=identity?(raw.length>128?'original-id':null):raw.trim()?masterMappedValueIssue(selected.plan.entity,field,raw):null;if((required&&!raw.trim()||issue)&&!focus.some(c=>c.row===ri&&c.column===ci))focus.push({row:ri,column:ci,issue})}))}
 const headers=sheet?.rows.slice(0,20)||[],currentHeader=sheet?.rows.find(r=>r.number===selected?.headerRow);if(currentHeader&&!headers.some(r=>r.number===currentHeader.number))headers.push(currentHeader)
 return <div className="workbook-setup" data-workbook-setup>
  <strong>{value.file.name}</strong>
  <div className="tabular-source"><label>{tr('原系統名稱')}<input className="field" data-tabular-system disabled={disabled} value={value.source.system} maxLength={128} onChange={e=>onChange({...value,source:{...value.source,system:e.target.value}})}/></label><label>{tr('原公司或店名')}<input className="field" data-tabular-company disabled={disabled} value={value.source.company} maxLength={128} onChange={e=>onChange({...value,source:{...value.source,company:e.target.value}})}/></label></div>
  {value.sheets.some(s=>s.plan.entity==='products')&&<label>{tr('來源金額的幣別')}<select className="field" data-workbook-currency disabled={disabled} value={value.currency} onChange={e=>onChange({...value,currency:e.target.value})}><option value="">{tr('請選擇')}</option><option value="TWD">{tr('新台幣 TWD')}</option></select><small>{tr('不同幣別先核對換算，不能直接當新台幣。')}</small></label>}
  <details open={!value.sheets.length} data-workbook-sheets><summary>{tr('這次搬入 {0} 張工作表',{0:value.sheets.length})}</summary>{book?.sheets.map(s=><label className="workbook-sheet-choice" key={s.id}><input type="checkbox" data-workbook-include={s.id} checked={value.sheets.some(r=>r.sheetId===s.id)} disabled={disabled||s.unsupported} onChange={e=>toggle(s.id,e.target.checked)}/><span>{s.name}{s.state!=='visible'?' · '+tr('原檔隱藏的工作表'):''}{s.unsupported?' · '+tr('這張不是資料表'):''}</span></label>)}</details>
  {value.sheets.length>0&&<label>{tr('核對工作表')}<select className="field" data-workbook-sheet disabled={disabled} value={active} onChange={e=>choose(e.target.value)}><option value="">{tr('請選擇')}</option>{value.sheets.map(s=><option key={s.sheetId} value={s.sheetId}>{book?.sheets.find(r=>r.id===s.sheetId)?.name||s.sheetId}</option>)}</select></label>}
  {selected&&sheet&&<details open={!selected.headerRow} data-workbook-header-options><summary>{tr('欄位名稱在哪一列？')} · {selected.headerRow||tr('請選擇')}</summary><label>{tr('欄位名稱在哪一列？')}<select className="field" data-workbook-header disabled={disabled} value={selected.headerRow} onChange={e=>changeSheet(workbookSheetPlan(value,active,Number(e.target.value),selected.plan.entity))}><option value={0}>{tr('請選擇')}</option>{headers.map(row=><option key={row.number} value={row.number}>{row.number} · {row.cells.slice(0,4).map(c=>c.value).join(' · ').slice(0,100)}</option>)}</select></label><button type="button" className="btn" disabled={disabled} onClick={()=>setOtherHeader(v=>!v)}>{tr('標題在其他列')}</button>{otherHeader&&<label>{tr('Excel 的列號')}<input className="field" type="number" data-workbook-other-header min={1} max={1048576} value={selected.headerRow||''} disabled={disabled} onChange={e=>{const row=Number(e.target.value);if(Number.isInteger(row)&&row>=0&&row<=1048576)changeSheet(workbookSheetPlan(value,active,row,selected.plan.entity))}}/></label>}</details>}
  {view&&selected&&<>
   {view.table.skippedBeforeHeader>0&&<p>{tr('標題列前有 {0} 列內容，不在這次搬入範圍。',{0:view.table.skippedBeforeHeader})}</p>}
   {(view.table.hiddenRows>0||view.table.hiddenColumns>0)&&<p>{tr('隱藏列與隱藏欄的資料也會一起核對。')}</p>}
   {view.table.blankRows>0&&<details><summary>{tr('略過 {0} 列空白列，原檔仍完整保留。',{0:view.table.blankRows})}</summary><p>{tr('沒有把空白當成零，也沒有移動原始資料的位置。')}</p></details>}
   <TabularMigrationSetup key={active} value={{...view.tabular,file:{...view.tabular.file,name:sheet.name}}} tableOverride={view.table} focusCells={focus} showSource={false} showDelimiter={false} showReview={false} disabled={disabled} onEntityChange={entity=>changeSheet(workbookSheetPlan(value,active,selected.headerRow,entity))} onChange={next=>changeSheet({...selected,plan:next.plan})}/>
  </>}
  {error&&<p role="status">{tr(error)}</p>}
  <button className="btn btn-primary" type="button" data-workbook-review disabled={disabled||!book||!value.sheets.length} onClick={onPreview}>{tr('看搬家核對結果')}</button>
 </div>
}
