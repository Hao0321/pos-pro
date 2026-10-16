import {useEffect,useId,useRef,useState} from 'react'
import {Database,Download,Upload,RefreshCw} from 'lucide-react'
import {tr,trMessage,getLocale} from '../../i18n'
import {createBackup,getBackupList,getProtectedBackupList,restoreBackup,exportBackupFile,importBackupFile,writeAuditLog} from '../../utils/security'
import {previewRestore,applyRestorePreview,readRecoveryCommand} from '../../utils/recoveryClient'
import RecoverySummary from '../../components/RecoverySummary'
import '../../styles/recovery.css'

function RestorePreview({entry,busy,onConfirm,onCancel,onRefresh,onRecovery}){
  const dialog=useRef(null),[ack,setAck]=useState(false),heading=useId()
  let pending=false;try{pending=!!readRecoveryCommand('restore')}catch{pending=true}
  useEffect(()=>{const previous=document.activeElement,el=dialog.current;if(el.showModal)el.showModal();else el.setAttribute('open','');return()=>previous?.focus?.()},[])
  useEffect(()=>setAck(false),[entry.preview?.id])
  const label=entry.preview?.label||entry.label||entry.filename
  return <dialog ref={dialog} className="recovery-dialog" data-restore-preview aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)onCancel()}}><div className="recovery-page"><h2 id={heading}>{tr('確認還原？')}</h2><p role={entry.preview||entry.error?undefined:'status'}>{label?(entry.kind==='backup'?label:tr(label)):tr('正在準備還原預覽…')}</p><p>{tr('會先保存目前資料。')}</p>
    {entry.error&&<><p className="recovery-error" role="alert">{trMessage(entry.error)}</p><button className="btn btn-primary" disabled={busy} onClick={pending?onRecovery:onRefresh}>{tr(pending?'核對上次復原':'重新查看還原預覽')}</button></>}
    {entry.preview&&<RecoverySummary current={entry.preview.current} target={entry.preview.target}/>}
    {entry.preview?.protection&&<p className="recovery-notice" data-backup-protection>{entry.preview.protection.legacy?tr('舊備份：不含完整保護紀錄，原裝置的紀錄仍會保留。'):tr('一併帶回 {0} 份保護副本',{0:entry.preview.protection.snapshots.toLocaleString(getLocale())})}</p>}
    <label className="recovery-check"><input type="checkbox" data-restore-ack checked={ack} disabled={!entry.preview||busy} onChange={event=>setAck(event.target.checked)}/><span>{tr('我確認要還原這份資料')}</span></label>
    <div className="recovery-dialog-actions"><button className="btn btn-primary" disabled={!entry.preview||!ack||busy} onClick={onConfirm}>{tr('確認還原')}</button><button className="btn btn-ghost" disabled={busy} onClick={onCancel}>{tr('取消')}</button></div>
  </div></dialog>
}
export function BackupTab({session,store}){
  const [backups,setBackups]=useState([]),[protectedBackups,setProtectedBackups]=useState([]),[visible,setVisible]=useState(20),[restoring,setRestoring]=useState(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),running=useRef(false)
  async function refresh(){const [ordinary,protectedRows]=await Promise.all([getBackupList(),getProtectedBackupList(session)]);setBackups(ordinary);setProtectedBackups(protectedRows)}
  useEffect(()=>{let active=true;Promise.all([getBackupList(),getProtectedBackupList(session)]).then(([ordinary,protectedRows])=>{if(active){setBackups(ordinary);setProtectedBackups(protectedRows)}}).catch(error=>{if(active)setError(error.message)});return()=>{active=false}},[session.userId])
  async function perform(action){
    if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('')
    try{await action()}catch(error){setError(error.message);setRestoring(current=>current?{...current,label:current.preview?.label||current.label,preview:null,error:error.message}:null)}finally{running.current=false;setBusy(false)}
  }
  async function openBackup(id,kind='backup'){
    setError('');setRestoring({id,kind,preview:null})
    try{const preview=await previewRestore({kind,id},session);setRestoring(current=>current?.id===id?{...current,preview}:current)}catch(error){setRestoring(current=>current?.id===id?{...current,error:error.message}:current)}
  }
  function openFile(file){
    const id='file-'+crypto.randomUUID();setError('');setRestoring({id,kind:'import',filename:file.name,file,preview:null})
    importBackupFile(file,session).then(preview=>setRestoring(current=>current?.id===id?{...current,preview}:current)).catch(error=>setRestoring(current=>current?.id===id?{...current,error:error.message}:current))
  }
  function handleImport(event){const file=event.target.files?.[0];event.target.value='';if(file)openFile(file)}
  async function confirm(){
    const entry=restoring
    if(entry.kind==='backup')await restoreBackup(entry.id,session,entry.preview)
    else{await applyRestorePreview(entry.preview,session);writeAuditLog('BACKUP_RESTORE',session,{source:entry.kind==='protected'?'protected':'file'})}
    await store.reloadAfterRecovery();setRestoring(null);await refresh();setMessage('還原已完成，資料已重新載入')
  }
  return <div style={{display:'flex',flexDirection:'column',gap:14,height:'100%',minWidth:0}}><div style={{display:'flex',gap:10,flexShrink:0,flexWrap:'wrap'}}>
    <button className="btn btn-primary" disabled={busy} onClick={()=>perform(async()=>{await createBackup(session,tr('手動備份')+' '+new Date().toLocaleString(getLocale()));await refresh();setMessage('備份建立成功')})}><Database size={16}/>{tr('立即備份')}</button>
    <button className="btn btn-ghost" disabled={busy} onClick={()=>perform(async()=>{await exportBackupFile(session);setMessage('已開啟備份下載，請確認檔案實際保存完成')})}><Download size={16}/>{tr('下載完整備份')}</button>
    <label className="btn btn-ghost"><Upload size={16}/>{tr('匯入備份')}<input type="file" accept=".json" disabled={busy} style={{display:'none'}} onChange={handleImport}/></label>
  </div>{error&&<p role="alert" className="recovery-error">{trMessage(error)}</p>}{message&&<p role="status" className="recovery-notice">{tr(message)}</p>}<p style={{lineHeight:1.7,color:'var(--text-secondary)'}}>{tr('每次還原前會保留完整保護副本。請仍定期下載備份，另存到安全位置。')}</p>
    <div style={{flex:1,overflowY:'auto',display:'grid',alignContent:'start',gap:8}}>{!backups.length?<p>{tr('尚無備份記錄')}</p>:backups.map(backup=><div className="card" key={backup.id} style={{padding:16,display:'flex',alignItems:'center',gap:12,minWidth:0}}><div style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}><strong>{backup.label}</strong><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:6}}>{new Date(backup.createdAt).toLocaleString(getLocale())} · {backup.createdBy} · {Math.round((backup.size||0)/1024)} KB</p></div><button className="btn btn-ghost" disabled={busy} style={{minHeight:48,flexShrink:0}} onClick={()=>openBackup(backup.id)}><RefreshCw size={16}/>{tr('還原')}</button></div>)}
    {!!protectedBackups.length&&<details data-protected-backups><summary style={{minHeight:48,padding:'12px 0',cursor:'pointer'}}>{tr('還原前的副本')} · {protectedBackups.length.toLocaleString(getLocale())}</summary><div className="protected-backup-list">{protectedBackups.slice(0,visible).map(backup=><div className="card" key={backup.id}><time dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString(getLocale())}</time>{!backup.canRestore&&<p>{tr(backup.reason)}</p>}<button className="btn btn-ghost" data-restore-protected={backup.id} disabled={busy||!backup.canRestore} onClick={()=>openBackup(backup.id,'protected')}>{tr('找回這份資料')}</button></div>)}{protectedBackups.length>visible&&<button className="btn btn-ghost" onClick={()=>setVisible(n=>n+20)}>{tr('顯示更多')}</button>}</div></details>}
    </div>
    {restoring&&<RestorePreview key={restoring.id} entry={restoring} busy={busy} onConfirm={()=>perform(confirm)} onCancel={()=>setRestoring(null)} onRefresh={()=>restoring.kind==='import'?openFile(restoring.file):openBackup(restoring.id,restoring.kind)} onRecovery={()=>{setRestoring(null);store.setView('recovery')}}/>}
  </div>
}
