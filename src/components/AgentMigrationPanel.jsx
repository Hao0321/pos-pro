import {useEffect,useRef,useState,lazy,Suspense} from 'react'
import {tr,trMessage} from '../i18n'
import {loadPrivateDraftContext} from '../utils/dataAccess'
import {readFileAsText} from '../utils/csv'
import useArchivedDraft from '../hooks/useArchivedDraft'
import {emptyMigrationDraft,validMigrationInput,migrationHandoff,readMigrationDraft,previewMigration} from '../utils/migrationDraft.mjs'
import '../styles/agent-migration.css'
import '../styles/arrival.css'
const BackupTab=lazy(()=>import('../pages/settings/BackupPanel.jsx').then(module=>({default:module.BackupTab})))
const options={empty:emptyMigrationDraft,valid:validMigrationInput,maxLength:1500000,prefix:'pos-migration-preview:',fileName:'migration-input.json',archiveName:'migration-input',message:'搬家草稿讀不到，原輸入仍保留'}
const issueText={
 'ambiguous-column':'多個欄位意思相近，請核對對照', 'missing-name-column':'請指出商品名稱欄位', 'missing-source-id':'缺少原系統編號，請核對', 'duplicate-source-id':'原系統編號重複，請核對', 'missing-name':'缺少商品名稱，請核對', 'invalid-price':'售價讀不到，請核對原文', 'invalid-cost':'成本讀不到，請核對原文', 'invalid-stock':'庫存讀不到，請核對原文', 'missing-unit':'缺少基本單位，請核對', 'duplicate-barcode':'條碼重複，請核對商品', 'possible-shared-phone':'電話相同，請核對是否為同一人', 'needs-ledger-mapping':'這份帳款或歷史資料需另行對帳'
}
const entityText={'products':'商品','suppliers':'供應商','customers':'客戶','opening-stock':'期初庫存','opening-receivables':'未收款','opening-payables':'未付款','history-reference':'歷史參考'}
export default function AgentMigrationPanel({session,store,onClose}){
 const [scope,setScope]=useState(null),[error,setError]=useState(''),[handoff,setHandoff]=useState(''),[preview,setPreview]=useState(null),[backup,setBackup]=useState(false),heading=useRef(null),dialog=useRef(null),fileRead=useRef(0)
 const key=scope?'pos_migration_preview_v1:'+JSON.stringify([scope.storeId,scope.epoch,session.userId,session.role]):null,draft=useArchivedDraft(key,options),locked=!draft.status.ready||!!draft.status.error
 useEffect(()=>{let alive=true;const previous=document.activeElement;loadPrivateDraftContext(session).then(value=>{if(alive)setScope(value)}).catch(cause=>{if(alive)setError(cause.message)});heading.current?.focus();return()=>{alive=false;fileRead.current++;previous?.focus?.()}},[])
 useEffect(()=>{const close=event=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose])
 function fill(text){if(locked)return;fileRead.current++;setPreview(null);setError('');draft.setForm({text})}
 function inspect(text=draft.current().form.text){if(locked)return;try{const value=previewMigration(readMigrationDraft(text));draft.setForm({text});draft.save();setPreview(value);setError('')}catch(cause){setError(cause.message)}}
 async function file(input){if(!input||locked)return;const generation=++fileRead.current;try{if(input.size>250000)throw Error('搬家草稿讀不到，原輸入仍保留');const text=await readFileAsText(input);if(generation!==fileRead.current)return;fill(text);inspect(text)}catch(cause){if(generation===fileRead.current)setError(cause.message)}}
 function containFocus(event){if(event.key!=='Tab')return;const controls=[...dialog.current.querySelectorAll('button,input,textarea,select,summary,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===heading.current)){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
 return <div className="arrival-overlay"><section ref={dialog} onKeyDown={containFocus} className="arrival-modal migration-panel" role="dialog" aria-modal="true" aria-labelledby="migration-heading" data-agent-migration><header><h2 id="migration-heading" ref={heading} tabIndex={-1}>{tr('Agent 幫我搬家')}</h2><button className="btn" onClick={onClose}>{tr('關閉')}</button></header>
 {backup?<><Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><BackupTab session={session} store={store}/></Suspense><button className="btn" onClick={()=>setBackup(false)}>{tr('返回修改')}</button></>:<>
 <p>{tr('先核對資料；其他 ERP 的正式搬入仍在開發。')}</p>
 <button className="btn" data-migration-handoff disabled={locked} onClick={async()=>{const text=JSON.stringify(migrationHandoff(),null,2);setHandoff(text);try{await navigator.clipboard.writeText(text)}catch{}}}>{tr('複製給 Agent')}</button>
 {handoff&&<label>{tr('給 Agent 的內容')}<textarea className="field" readOnly value={handoff} onFocus={event=>event.target.select()}/></label>}
 <div onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();file(event.dataTransfer.files?.[0])}}><label className="btn">{tr('選擇 Agent 草稿')}<input data-migration-file type="file" accept=".json,.txt,application/json,text/plain" disabled={locked} onChange={event=>{file(event.target.files?.[0]);event.target.value=''}}/></label><label>{tr('貼上搬家草稿')}<textarea className="field" data-migration-text value={draft.form.text} disabled={locked} maxLength={250000} onChange={event=>fill(event.target.value)}/></label></div>
 <button className="btn btn-primary" data-migration-preview disabled={locked||!draft.form.text} onClick={()=>inspect()}>{tr('看搬家核對結果')}</button>
 {preview&&<div data-migration-result><p>{preview.source.system} · {preview.source.company}</p><strong>{tr('已讀取 {0} 筆，待核對 {1} 處',{0:preview.rows,1:preview.issues.length})}</strong>{preview.tables.map((table,index)=><p key={index}>{tr(entityText[table.entity])} · {table.count}</p>)}{preview.issues.length>0&&<ul>{preview.issues.slice(0,20).map((issue,index)=><li key={index}>{tr('第 {0} 份',{0:issue.table+1})} {issue.row!==null&&tr('第 {0} 列',{0:issue.row+1})}：{tr(issueText[issue.code])}</li>)}</ul>}<p>{tr('預檢已完成，尚未寫入營業資料。')}</p></div>}
 <details><summary>{tr('保留原輸入')}</summary><button className="btn" disabled={locked} onClick={draft.download}>{tr('下載草稿')}</button></details>
 <button className="btn" data-migration-pos-backup onClick={()=>setBackup(true)}>{tr('搬入 POS Pro 完整備份')}</button>
 </>}{(error||draft.status.error)&&<p role="alert">{trMessage(error||draft.status.error)}</p>}
 </section></div>
}
