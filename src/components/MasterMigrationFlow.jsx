import {useEffect,useRef,useState,lazy,Suspense} from 'react'
import {Upload,ClipboardPaste,Check} from 'lucide-react'
import {tr,trMessage} from '../i18n'
import {loadPrivateDraftContext,previewMasterMigration,applyMasterMigration} from '../utils/dataAccess'
import {readFileAsText} from '../utils/csv'
import {readTabularText} from '../utils/tabularMigrationFile'
import {isTabularDraftSetup,detectTableDelimiter,suggestTabularPlan,makeTabularDraft} from '../../electron/tabularMigration.mjs'
import TabularMigrationSetup from './TabularMigrationSetup'
import WorkbookMigrationSetup from './WorkbookMigrationSetup'
import {readWorkbookFile} from '../utils/workbookMigrationFile'
import {makeWorkbookDraft,isWorkbookDraftSetup,initialWorkbookSheets} from '../../electron/workbookMigration.mjs'
import useArchivedDraft from '../hooks/useArchivedDraft'
import {emptyMigrationDraft,validMigrationInput,migrationHandoff,readMigrationDraft} from '../utils/migrationDraft.mjs'
import {makeMasterMigrationInput,readMasterMigrationInput,assertMasterMigrationResult} from '../../electron/masterMigration.mjs'
import {openingSourceCanRoute} from '../../electron/openingMigrationTables.mjs'
import '../styles/agent-migration.css'
import '../styles/arrival.css'
const BackupTab=lazy(()=>import('../pages/settings/BackupPanel.jsx').then(module=>({default:module.BackupTab})))
const options={empty:emptyMigrationDraft,valid:validMigrationInput,maxLength:1500000,prefix:'pos-migration-preview:',fileName:'migration-input.json',archiveName:'migration-input',message:'搬家草稿讀不到，原輸入仍保留'}
import MigrationReviewRow from './MigrationReviewRow'
const OpeningMigrationFlow=lazy(()=>import('./OpeningMigrationFlow'))
export default function MasterMigrationFlow({session,store,onClose}){
 const [opening,setOpening]=useState(false),[openingSuppressed,setOpeningSuppressed]=useState(false)
 const [scope,setScope]=useState(null),[error,setError]=useState(''),[handoff,setHandoff]=useState(''),[preview,setPreview]=useState(null),[backup,setBackup]=useState(false),[paste,setPaste]=useState(false),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState(null),[canRecheck,setCanRecheck]=useState(false),[visible,setVisible]=useState(10)
 const heading=useRef(null),dialog=useRef(null),fileInput=useRef(null),pasteInput=useRef(null),generation=useRef(0),busyRef=useRef(false),mounted=useRef(true)
 const key=scope?'pos_migration_preview_v1:'+JSON.stringify([scope.storeId,scope.epoch,session.userId,session.role]):null,draft=useArchivedDraft(key,options)
 const pending=draft.form.attempted,locked=!draft.status.ready||!!draft.status.error,editingLocked=locked||busy||!!pending
 let tabular=null,workbook=null;try{const value=JSON.parse(draft.form.text);if(isTabularDraftSetup(value))tabular=value;else if(isWorkbookDraftSetup(value))workbook=value}catch{}
 useEffect(()=>{mounted.current=true;let alive=true;const previous=document.activeElement;loadPrivateDraftContext(session).then(value=>{if(alive)setScope(value)}).catch(cause=>{if(alive)setError(cause.message)});heading.current?.focus();return()=>{alive=false;mounted.current=false;generation.current++;previous?.focus?.()}},[])
 useEffect(()=>{const close=event=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose])
 useEffect(()=>{if(paste)pasteInput.current?.focus()},[paste])
 useEffect(()=>{if(!openingSuppressed&&draft.status.ready&&!pending){try{const raw=JSON.parse(draft.form.text);if(draft.form.workflow==='opening-stock'&&openingSourceCanRoute(draft.form.text)||Array.isArray(raw.tables)&&raw.tables.some(t=>t?.entity==='opening-stock'))setOpening(true)}catch{}}},[draft.status.ready,draft.form.text,draft.form.workflow,openingSuppressed,pending])
 function fill(text,workflow=null){if(editingLocked||busyRef.current)return;setOpeningSuppressed(false);generation.current++;setPreview(null);setReceipt(null);setError('');setCanRecheck(false);draft.setForm({text,...(workflow?{workflow}:{})})}
 function setTable(value){const text=JSON.stringify(makeTabularDraft(value.source,value.file,value.plan));if(new TextEncoder().encode(text).length>250000){setError('表格太大，請拆成較小的檔案。');return}fill(text)}
 function setWorkbook(value){const text=JSON.stringify(makeWorkbookDraft(value.source,value.file,value.currency,value.sheets));if(new TextEncoder().encode(text).length>250000){setError('Excel 資料太多，請拆成較小的檔案。');return}fill(text)}
 function openWorkbook(file){let source={system:'',company:''};try{const previous=JSON.parse(draft.current().form.text).source;if(typeof previous?.system==='string'&&typeof previous?.company==='string')source={system:previous.system,company:previous.company}}catch{}let sheets=[],failure='';try{sheets=initialWorkbookSheets(file)}catch(cause){failure=cause.message}setWorkbook({source,file,currency:'',sheets});setPaste(false);if(failure)setError(failure)}
 function openTable(text,name){const delimiter=detectTableDelimiter(text);let plan={entity:'products',externalId:-1,mapping:[],unit:'',repairs:[]};if(delimiter)plan=suggestTabularPlan(text,delimiter);let source={system:'',company:''};try{const previous=JSON.parse(draft.current().form.text);if(previous.source)source=previous.source}catch{}setTable({source,file:{name,text,delimiter},plan});setPaste(false)}
 async function inspect(text=draft.current().form.text,choices=[]){
  if(editingLocked||busyRef.current||!scope)return
  const turn=++generation.current
  try{
   if(!text.trimStart().startsWith('{')&&!text.includes('```')&&(detectTableDelimiter(text)||/[\r\n]/.test(text)&&/[,\t;]/.test(text))){openTable(text,'pasted-table.csv');return}
   if(openingSourceCanRoute(text)){draft.setForm({text,workflow:'opening-stock'});draft.save();setError('');setOpening(true);return}
   readMigrationDraft(text);draft.setForm({text});draft.save();setError('')
   const input=makeMasterMigrationInput(text,scope,choices),value=await previewMasterMigration(input,session)
   if(turn!==generation.current||!mounted.current)return
   setPreview({...value,input});setVisible(10)
   if(value.saved)setReceipt(value.saved)
  }catch(cause){if(turn===generation.current&&mounted.current)setError(cause.message)}
 }
 async function file(input){
  if(!input||editingLocked||busyRef.current)return
  const turn=++generation.current
  try{if(/\.xls$/i.test(input.name))throw Error('舊式 Excel 請先另存成 XLSX，再選取檔案。');if(/\.xlsx$/i.test(input.name)){const data=await readWorkbookFile(input);if(turn!==generation.current||!mounted.current)return;openWorkbook(data);return}if(input.size>250000)throw Error(options.message);const isTable=/\.(csv|tsv)$/i.test(input.name),text=await(isTable?readTabularText(input):readFileAsText(input));if(turn!==generation.current||!mounted.current)return;if(isTable){openTable(text,input.name);return}fill(text);await inspect(text)}catch(cause){if(turn===generation.current&&mounted.current)setError(cause.message)}
 }
 function choose(choice){const choices=[...preview.input.choices.filter(item=>item.table!==choice.table||item.row!==choice.row),choice];inspect(draft.current().form.text,choices)}
 async function confirm(original=null){
  if(locked||busyRef.current)return
  busyRef.current=true;generation.current++;setBusy(true);setError('');setCanRecheck(false);let dispatched=false
  try{
   const input=original||{...preview.input,review:preview.review};readMasterMigrationInput(input)
   if(!original){draft.setForm({text:draft.current().form.text,attempted:input});draft.save()}
   dispatched=true
   const result=await applyMasterMigration(input,session)
   if(result?.success!==true){setCanRecheck(result?.committed===false);throw Error(result?.error||'搬入結果尚未確認，請保留原編號再核對。')}
   assertMasterMigrationResult(input,result)
   if(!mounted.current)return
   setReceipt(result.receipt);setPreview(null);draft.setForm({text:input.sourceText});draft.save()
   await store.reloadFromDB?.();window.dispatchEvent(new Event('pos-data-refreshed'))
  }catch(cause){if(mounted.current){if(!dispatched&&!original)draft.setForm({text:draft.current().form.text});setError(cause.message)}}finally{busyRef.current=false;if(mounted.current)setBusy(false)}
 }
 function containFocus(event){if(event.key!=='Tab')return;const controls=[...dialog.current.querySelectorAll('button,input,textarea,select,summary,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length&&!node.closest('details:not([open])')||node.tagName==='SUMMARY'&&node.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===heading.current)){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
 const pendingRows=preview?.rows.filter(row=>row.action==='blocked')||[],unused=[...new Set((preview?.rows||[]).flatMap(row=>row.unused))]
 if(opening)return <Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><OpeningMigrationFlow session={session} store={store} seedText={draft.form.text} onSourceChange={text=>fill(text,'opening-stock')} onClose={onClose} onBack={()=>{setOpeningSuppressed(true);setOpening(false)}}/></Suspense>
 return <div className="arrival-overlay"><section ref={dialog} onKeyDown={containFocus} className="arrival-modal migration-panel" role="dialog" aria-modal="true" aria-labelledby="migration-heading" data-agent-migration><header><h2 id="migration-heading" ref={heading} tabIndex={-1}>{tr('Agent 幫我搬家')}</h2><button className="btn" onClick={onClose}>{tr('關閉')}</button></header>
  {backup?<><Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><BackupTab session={session} store={store}/></Suspense><button className="btn" onClick={()=>setBackup(false)}>{tr('返回修改')}</button></>:<>
   <ol className="migration-steps" aria-label={tr('搬家步驟')}><li className={!preview&&!receipt?'active':''}>1 · {tr('交資料')}</li><li className={preview?'active':''}>2 · {tr('看結果')}</li><li className={receipt?'active':''}>3 · {tr('確認')}</li></ol>
   {pending&&<div className="migration-pending" role="status"><strong>{tr('上次搬入尚未確認')}</strong><button className="btn btn-primary" data-migration-recover disabled={locked||busy} onClick={()=>confirm(pending)}>{tr('核對上次結果')}</button>{canRecheck&&<button className="btn" data-migration-recheck disabled={busy} onClick={()=>{draft.setForm({text:draft.current().form.text});draft.save();setPreview(null);setCanRecheck(false);setError('')}}>{tr('重新核對')}</button>}</div>}
   {!receipt&&!pending&&!preview&&<div className={'migration-drop'+(tabular||workbook?' migration-drop-compact':'')} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();file(event.dataTransfer.files?.[0])}}>{!tabular&&!workbook&&<p>{tr('舊系統表格或 Agent 草稿，都可以放進來。')}</p>}<button className={'btn '+(tabular||workbook?'':'btn-primary')} data-migration-choose-file disabled={editingLocked} onClick={()=>fileInput.current?.click()}><Upload size={20} aria-hidden="true"/>{tr(tabular||workbook?'更換檔案':'選擇檔案')}</button><button className="btn" data-migration-paste disabled={editingLocked} onClick={()=>setPaste(value=>!value)}><ClipboardPaste size={20} aria-hidden="true"/>{tr('貼上資料')}</button><input hidden ref={fileInput} data-migration-file type="file" accept=".json,.txt,.csv,.tsv,.xlsx,.xls,application/json,text/plain,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={editingLocked} onChange={event=>{file(event.target.files?.[0]);event.target.value=''}}/></div>}
   {tabular&&!preview&&!receipt&&!pending&&<TabularMigrationSetup value={tabular} disabled={editingLocked} onChange={setTable} onPreview={()=>inspect()}/>}
   {workbook&&!preview&&!receipt&&!pending&&<WorkbookMigrationSetup value={workbook} disabled={editingLocked} onChange={setWorkbook} onPreview={()=>inspect()}/>}
   {preview&&!receipt&&<div data-migration-result><p>{preview.source.system} · {preview.source.company}</p><strong>{tr('已讀取 {0} 筆，待核對 {1} 處',{0:preview.rows.length,1:pendingRows.reduce((n,row)=>n+row.issues.length,0)})}</strong><div className="migration-counts"><span>{tr('新增')} {preview.counts.create}</span><span>{tr('更新')} {preview.counts.update}</span><span>{tr('保留')} {preview.counts.keep+preview.counts.unchanged}</span></div><ul className="migration-rows">{(pendingRows.length?pendingRows:preview.rows).slice(0,visible).map(row=><MigrationReviewRow key={row.table+':'+row.row} row={row} disabled={editingLocked} onChoose={choose}/>)}</ul>{(pendingRows.length?pendingRows:preview.rows).length>visible&&<button className="btn" onClick={()=>setVisible(value=>value+20)}>{tr('查看更多')}</button>}{unused.length>0&&<details><summary>{tr('保留但未套用的欄位')} · {unused.length}</summary><p>{unused.join(' · ')}</p></details>}<p className="migration-note">{tr('庫存與未結帳款另行核對。')}</p><button className="btn btn-primary" data-migration-confirm disabled={editingLocked||!preview.ready} onClick={()=>confirm()}><Check size={20} aria-hidden="true"/>{tr('確認搬入這批資料')}</button><button className="btn" data-migration-edit disabled={editingLocked} onClick={()=>{setPreview(null);setPaste(!tabular&&!workbook)}}>{tr('返回修改')}</button></div>}
   {receipt&&<div className="migration-success" data-migration-saved role="status"><Check size={32} aria-hidden="true"/><strong>{tr('這批資料已搬入')}</strong><p>{tr('新增 {0} 筆、更新 {1} 筆、保留 {2} 筆',{0:receipt.counts.create,1:receipt.counts.update,2:receipt.counts.keep+receipt.counts.unchanged})}</p><button className="btn" data-migration-export onClick={()=>{const source=JSON.parse(receipt.signature).sourceText,packet={protocol:'pos-master-migration-export/v1',sourceText:source,mappings:receipt.rows,receipt},url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='migration-record.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>{tr('下載搬入紀錄')}</button><button className="btn" disabled={busy} onClick={()=>{setReceipt(null);setPreview(null)}}>{tr('繼續核對其他資料')}</button></div>}
   <details open={paste} onToggle={event=>setPaste(event.currentTarget.open)} data-migration-source><summary>{tr('貼上或查看原始資料')}</summary><label>{tr('貼上搬家草稿')}<textarea ref={pasteInput} className="field" data-migration-text value={draft.form.text} disabled={editingLocked} maxLength={250000} onChange={event=>fill(event.target.value)}/></label></details>
   {!pending&&!receipt&&!preview&&!tabular&&!workbook&&draft.form.text&&<button className="btn btn-primary" data-migration-preview disabled={editingLocked} onClick={()=>inspect()}>{tr('看搬家核對結果')}</button>}
   <details className="migration-tools"><summary>{tr('Agent 與備份')}</summary><button className="btn" data-migration-handoff disabled={editingLocked} onClick={async()=>{const text=JSON.stringify(migrationHandoff(),null,2);setHandoff(text);try{await navigator.clipboard.writeText(text)}catch{}}}>{tr('複製給 Agent')}</button>{handoff&&<label>{tr('給 Agent 的內容')}<textarea className="field" readOnly value={handoff} onFocus={event=>event.target.select()}/></label>}<button className="btn" data-migration-download disabled={!draft.form.text} onClick={draft.download}>{tr('下載草稿')}</button><button className="btn" data-migration-pos-backup disabled={busy||!!pending} onClick={()=>setBackup(true)}>{tr('搬入 POS Pro 完整備份')}</button></details>
  </>}{busy&&<p role="status">{tr('正在核對保存結果…')}</p>}{(error||draft.status.error)&&<p role="alert">{trMessage(error||draft.status.error)}</p>}
 </section></div>
}
