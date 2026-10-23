import {tr} from '../i18n'
import {ArrowRight} from 'lucide-react'
const issues={
 'unhandled-master-field':'原主檔還有未處理的資料，整批仍保留。',
 'ambiguous-column':'多個欄位意思相近，請核對對照','missing-source-id':'缺少原系統編號，請核對','duplicate-source-id':'原系統編號重複，請核對','missing-name':'缺少名稱，請核對','invalid-price':'售價讀不到，請核對原文','invalid-cost':'成本讀不到，請核對原文','missing-price':'請補上商品售價','missing-unit':'缺少基本單位，請核對','duplicate-barcode':'條碼重複，請核對商品','needs-ledger-mapping':'庫存、儲值或帳款需另行對帳','choose-target':'請選擇要對應哪一筆','local-change':'本店資料已修改，請選擇保留哪一份','missing-supplier':'找不到來源供應商編號','missing-target':'原對應資料已不存在，請核對','source-target-changed':'原系統編號已有對應，請保留原對照','invalid-target-choice':'這筆對應不在候選清單','duplicate-target':'多筆來源指向同一筆資料，請核對','unit-change':'原單位已有使用，請先核對單位換算','invalid-text':'文字欄位需要核對','invalid-birthday':'生日請使用正確的西元年月日','needs-currency':'幣別不同或不明，請先核對換算'
}
const entityText={products:'商品',suppliers:'供應商',customers:'客戶','opening-stock':'期初庫存','opening-receivables':'未收款','opening-payables':'未付款','history-reference':'歷史參考'}
const fieldText={name:'名稱',barcode:'條碼',unit:'單位',price:'售價',cost:'參考成本',category:'分類',supplierId:'供應商編號',phone:'電話',contact:'聯絡人',payTerms:'付款條件',note:'備註',birthday:'生日'}
export default function MigrationReviewRow({row,disabled,onChoose}){
 const choose=resolution=>onChoose({table:row.table,row:row.row,targetId:row.targetId,resolution})
 const display=(key,value)=>key==='supplierId'?(value===row.values.supplierId?row.supplierLabel:row.beforeSupplierLabel)||value:['price','cost'].includes(key)?'TWD '+value:String(value??'')
 return <li className="migration-row"><div><strong>{row.values.name||row.before?.name||row.externalId}</strong><span>{tr(entityText[row.entity])} · {row.externalId}</span></div>
  {row.issues.map(code=><p className="migration-issue" key={code}>{tr(issues[code])}</p>)}
  {row.issues.includes('choose-target')&&<label>{tr('請選擇要對應哪一筆')}<select className="field" data-migration-target disabled={disabled} value="" onChange={event=>{if(event.target.value)onChoose({table:row.table,row:row.row,targetId:event.target.value==='__new__'?'':event.target.value,...(event.target.value==='__new__'?{}:{resolution:'source'})})}}><option value="">{tr('請選擇')}</option><option value="__new__">{tr('建立另一筆')}</option>{row.candidates.map(item=><option key={item.id} value={item.id}>{item.name} · {item.barcode||item.phone||item.id}</option>)}</select></label>}
  {row.issues.includes('local-change')&&<div className="migration-choices"><button className="btn" disabled={disabled} data-migration-keep onClick={()=>choose('keep')}>{tr('保留本店資料')}</button><button className="btn" disabled={disabled} data-migration-use-source onClick={()=>choose('source')}>{tr('使用來源資料')}</button></div>}
  {(['create','update'].includes(row.action)||row.issues.includes('local-change'))&&<dl className="migration-diff">{Object.entries(row.values).filter(([key,value])=>(key!=='name'||row.before&&row.before.name!==value)&&row.before?.[key]!==value).map(([key,value])=><div key={key}><dt>{tr(fieldText[key])}</dt><dd>{row.before&&<><del>{display(key,row.before?.[key]??'')}</del><ArrowRight size={14} aria-hidden="true"/></>}<ins>{display(key,value)}</ins></dd></div>)}</dl>}
 </li>
}
