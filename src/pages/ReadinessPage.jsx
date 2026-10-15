import {useCallback,useEffect,useState} from 'react'
import {isElectron,isSharedStore} from '../utils/dataAccess'
import {browserStorage} from '../utils/browserStorage'
import {deviceChecks,inspectBrowserDevice} from '../utils/deviceReadiness'
import {createBackup,getBackupList,exportBackupFile,hasPermission} from '../utils/security'
import {FINANCIAL_PENDING} from '../utils/financialCommand'
import {restaurantAvailability} from '../../electron/restaurantRules.mjs'

const labels={pass:'已確認',review:'需核對',blocked:'請先處理'}
export default function ReadinessPage({store,session,backupIssue,onBackupVerified}) {
  const [device,setDevice]=useState(null),[backup,setBackup]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const canBackup=hasPermission(session,'backup.manage')
  const inspect=useCallback(async()=>{
    setDevice(null);setError('')
    const d=isSharedStore?{...(await inspectBrowserDevice()),mode:'shared-store'}:isElectron?{mode:'desktop-local'}:await inspectBrowserDevice()
    if(isSharedStore){try{await window.electronAPI.db.getStoreSnapshot();d.connected=true}catch{d.connected=false}}
    setDevice(d)
    if(canBackup){try{const list=await getBackupList();setBackup([...list].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]||null)}catch(e){setError('備份清單尚未確認：'+e.message)}}
  },[canBackup])
  useEffect(()=>{inspect().catch(e=>setError(e.message))},[inspect])
  async function action(work){if(busy)return;setBusy(true);setError('');setMessage('');try{await work()}catch(e){setError(e.message)}finally{setBusy(false)}}
  const pending=[]
  try{if(browserStorage.getItem('pos_pending_checkout_v1'))pending.push('收銀');if(browserStorage.getItem(FINANCIAL_PENDING))pending.push('退款／儲值')}catch{pending.push('待確認紀錄讀取失敗')}
  const invalid=store.products.filter(p=>!Number.isFinite(p.stock)||p.stock<0||!Number.isFinite(p.price)||p.price<0)
  const available=store.products.filter(p=>restaurantAvailability(p,store.restaurantConfig,store.products)>0&&p.price>0)
  const costs=available.filter(p=>!Number.isFinite(p.cost)||p.cost<=0)
  const checks=[
    ...(device?deviceChecks(device):[]),
    {id:'pending',status:pending.length?'blocked':'pass',title:'上一筆款項',detail:pending.length?'還有 '+pending.join('、')+' 結果未確認。先核對原單，不要重新收款。':'沒有待確認的收款、退款或儲值紀錄。'},
    {id:'catalogue',status:invalid.length?'blocked':available.length?'pass':'review',title:'可售品項',detail:invalid.length?invalid.length+' 個品項的庫存／售價需要修正。':available.length+' 個品項已有售價與可售量。'},
    {id:'cost',status:costs.length?'review':'pass',title:'成本與毛利',detail:costs.length?costs.length+' 個可售品項的成本為空白或零，請確認後再看毛利。':'可售品項已填正數成本。'},
    {id:'shift',status:store.openShift?'pass':'review',title:'開班與交班',detail:store.openShift?'目前已開班，收攤時核對實際現金。':'先確認零用金並開班，才能正式結帳。'},
    ...(canBackup?[{id:'backup',status:backup&&!backupIssue&&!error&&Date.now()-Date.parse(backup.createdAt)<24*60*60*1000?'pass':'review',title:'可還原的備份',detail:backupIssue?'自動備份尚未完成：'+backupIssue:backup?'最近備份：'+new Date(backup.createdAt).toLocaleString('zh-TW')+'。內建備份也在本機，請另外下載檔案。':'尚未確認本機備份，請先建立並下載。'}]:[]),
  ]
  return <div style={{flex:1,overflowY:'auto',padding:20,minWidth:0}}>
    <div style={{maxWidth:850,margin:'0 auto'}}>
      <h2 className="page-title">營業前檢查</h2><p style={{color:'var(--text-secondary)',margin:'8px 0 16px'}}>把會影響保存、斷網與收攤的狀態先核對。</p>
      <div className="card" style={{padding:16,marginBottom:16,lineHeight:1.7}}>
        <strong>{isSharedStore?'這台手機使用店面電腦的共同資料庫':isElectron?'這台電腦是本機收銀台':'這台手機／瀏覽器是獨立收銀台'}</strong>
        <p>{isSharedStore?'訂單與庫存會與店面電腦共用。連不到電腦時停止保存，恢復連線後先核對原交易。':isElectron?'可從「共用店面」啟動手機連線。透過配對網址登入的手機，會共用這台電腦的訂單與庫存。':'獨立瀏覽器的資料只在這台裝置。要與電腦共用訂單與庫存，請改用桌面版「共用店面」產生的配對網址。'}</p>
        <p>正式接單請使用「預訂出餐」，可預留成品或配方原料、收款、交付與取消退款。情境模板內的試賣演練另行保存。</p>
      </div>
      {!device&&<p role="status">正在實際檢查保存與離線程式…</p>}
      <div style={{display:'grid',gap:10}}>{checks.map(c=><div key={c.id} data-check={c.id} data-status={c.status} className="card" style={{padding:16}}>
        <div style={{display:'flex',gap:10,justifyContent:'space-between'}}><strong>{c.title}</strong><span style={{color:c.status==='blocked'?'var(--red)':c.status==='pass'?'var(--green)':'var(--amber)',whiteSpace:'nowrap'}}>{labels[c.status]}</span></div>
        <p style={{color:'var(--text-secondary)',marginTop:6,overflowWrap:'anywhere'}}>{c.detail}</p>
      </div>)}</div>
      {error&&<p role="alert" style={{color:'var(--red)',marginTop:12}}>{error}</p>}{message&&<p role="status" style={{marginTop:12}}>{message}</p>}
      <div style={{display:'flex',gap:10,flexWrap:'wrap',margin:'18px 0'}}>
        <button className="btn btn-ghost" disabled={busy} onClick={()=>action(inspect)}>重新檢查</button>
        {canBackup&&<><button className="btn btn-primary" disabled={busy||pending.length>0} onClick={()=>action(async()=>{await createBackup(session,'營業前備份');onBackupVerified();await inspect();setMessage('本機備份已建立。請再下載一份到裝置外保存。')})}>建立本機備份</button>
        <button className="btn btn-ghost" disabled={busy||pending.length>0} onClick={()=>action(async()=>{await exportBackupFile(session);setMessage('已產生備份下載，請確認檔案已存入「下載項目」，再另存到其他裝置。')})}>下載備份檔</button></>}
        {!isElectron&&<button className="btn btn-ghost" disabled={busy} onClick={()=>action(async()=>{if(!navigator.storage?.persist)throw Error('此瀏覽器不提供持續保存，請下載備份。');const granted=await navigator.storage.persist();await inspect();setMessage(granted?'持續保存已獲允許，仍請另外下載備份。':'瀏覽器尚未允許持續保存，請另外下載備份。')})}>允許持續保存</button>}
        <button className="btn btn-ghost" onClick={()=>store.setView('pos')}>前往收銀台</button>
      </div>
      <p style={{color:'var(--text-secondary)',lineHeight:1.7}}>試賣前先用測試空間跑一筆接單、收款、交付、取消退款與交班，再把自己會用的手機、網路和印表機實際試過。手機離線準備完成後，不要更換網址或清除網站資料。</p>
    </div>
  </div>
}
