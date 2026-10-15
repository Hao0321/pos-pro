import {tr,trMessage} from "../../i18n"
import { browserStorage } from "../../utils/browserStorage"
import { useState } from "react"
import { X, Check, RefreshCw, Wifi, Cloud, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react"
import { writeAuditLog } from "../../utils/security"
import { getCloudConfig, saveCloudConfig, clearCloudConfig, testConnection, signInCloud, isCloudEnabled } from "../../utils/supabaseClient"
import { pushAll, pullAll } from "../../utils/cloudSync"
import { Section, FL, ss } from "./controls.jsx"

export function CloudSyncTab({ session }) {
  const [cloudEmail,setCloudEmail]=useState(''),[cloudPassword,setCloudPassword]=useState('')
  const [cloudLoginMessage,setCloudLoginMessage]=useState('')
  const initial = getCloudConfig() || { url: '', anonKey: '' }
  const [url, setUrl] = useState(initial.url || '')
  const [anonKey, setAnonKey] = useState(initial.anonKey || '')
  const [enabled, setEnabled] = useState(isCloudEnabled())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(null) // 'push' | 'pull' | null
  const [progress, setProgress] = useState([])
  const [confirmPull, setConfirmPull] = useState(false)
  const [lastSync, setLastSync] = useState(() => browserStorage.getItem('pos_last_sync') || '')
  const [msg, setMsg] = useState('')

  function showMsg(m, ms = 2500) {
    setMsg(m)
    setTimeout(() => setMsg(''), ms)
  }

  function handleSave() {
    saveCloudConfig({ url, anonKey })
    setEnabled(isCloudEnabled())
    setTestResult(null)
    writeAuditLog('CLOUD_CONFIG_SAVE', session, { hasConfig: !!(url && anonKey) })
    showMsg('✓ 設定已儲存')
  }

  function handleClear() {
    if (!confirm(tr("確認清除雲端設定？"))) return
    clearCloudConfig()
    setUrl('')
    setAnonKey('')
    setEnabled(false)
    setTestResult(null)
    showMsg('已清除設定')
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const r = await testConnection()
    setTesting(false)
    setTestResult(r)
  }

  async function handlePush() {
    setBusy('push')
    setProgress([])
    try {
      const report = await pushAll(({ table, status }) => {
        setProgress(prev => [...prev, { table, status }])
      })
      const total = report.reduce((s, r) => s + (r.count || 0), 0)
      browserStorage.setItem('pos_last_sync', new Date().toISOString())
      setLastSync(new Date().toISOString())
      writeAuditLog('CLOUD_PUSH', session, { total, tables: report.length })
      showMsg(`✓ 推送完成（共 ${total} 筆，${report.length} 張表）`, 5000)
    } catch (e) {
      showMsg(`✗ 推送失敗：${e.message}`, 8000)
      writeAuditLog('CLOUD_PUSH_FAIL', session, { error: e.message })
    }
    setBusy(null)
  }

  async function handlePull() {
    setConfirmPull(false)
    setBusy('pull')
    setProgress([])
    try {
      const report = await pullAll(({ table, status }) => {
        setProgress(prev => [...prev, { table, status }])
      })
      const total = report.reduce((s, r) => s + (r.count || 0), 0)
      browserStorage.setItem('pos_last_sync', new Date().toISOString())
      setLastSync(new Date().toISOString())
      writeAuditLog('CLOUD_PULL', session, { total, tables: report.length })
      showMsg(`✓ 拉取完成（共 ${total} 筆）— 自動重新載入...`, 3000)
      setTimeout(() => location.reload(), 1500)
    } catch (e) {
      showMsg(`✗ 拉取失敗：${e.message}`, 8000)
      writeAuditLog('CLOUD_PULL_FAIL', session, { error: e.message })
    }
    setBusy(null)
  }

  return (
    <div style={{padding:'0 4px', overflowY:'auto', height:'100%', display:'flex', flexDirection:'column', gap:18}}>
      <div className="card" style={{padding:14}}>
        <div>{tr("雲端使用 Supabase Auth 驗證；員工登入密碼不會同步到雲端。")}</div>
        <input className="field" type="email" value={cloudEmail} onChange={e=>setCloudEmail(e.target.value)} placeholder={tr("雲端帳號 Email")} autoComplete="username"/>
        <input className="field" type="password" value={cloudPassword} onChange={e=>setCloudPassword(e.target.value)} placeholder={tr("雲端帳號密碼")} autoComplete="current-password"/>
        <button className="btn btn-primary" onClick={async()=>{try{await signInCloud(cloudEmail,cloudPassword);setCloudPassword('');setCloudLoginMessage('雲端身份已驗證')}catch(e){setCloudLoginMessage(e.message)}}}>{tr("登入雲端")}</button>
        <div role="status">{trMessage(cloudLoginMessage)}</div>
      </div>
      <div className="card" style={{padding:'14px 16px', background: enabled ? 'var(--green-dim)' : 'var(--bg-overlay)', borderLeft: `3px solid ${enabled ? 'var(--green)' : 'var(--text-tertiary)'}`}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Cloud size={18} style={{color: enabled ? 'var(--green)' : 'var(--text-tertiary)'}}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:14}}>
              {enabled ? tr("雲端已設定") : tr("尚未設定雲端")}
            </div>
            <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>
              {enabled
                ? tr("上次同步：{0}", {0: lastSync ? new Date(lastSync).toLocaleString('zh-TW') : '尚未同步'})
                : tr("在下方輸入 Supabase URL 和 anon key，啟用跨裝置同步")}
            </div>
          </div>
        </div>
      </div>

      {/* 設定區 */}
      <div>
        <Section title={tr("Supabase 連線設定")}>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <div>
              <FL>Project URL</FL>
              <input className="field" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://xxxxx.supabase.co" style={{fontFamily:'var(--font-mono)', fontSize:12}}/>
            </div>
            <div>
              <FL>anon / public key</FL>
              <input type="password" className="field" value={anonKey} onChange={e=>setAnonKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style={{fontFamily:'var(--font-mono)', fontSize:12}}/>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4}}>{tr("Supabase Dashboard → Settings → API → Project URL 與 anon key（不是 service_role）")}</div>
            </div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!url || !anonKey}>
                <Check size={14}/>{tr("儲存設定")}</button>
              <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={!enabled || testing}>
                {testing ? <RefreshCw size={14} className="spin"/> : <Wifi size={14}/>}{tr("測試連線")}</button>
              {enabled && (
                <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={handleClear}>
                  <X size={14}/>{tr("清除設定")}</button>
              )}
            </div>
            {testResult && (
              <div style={{
                fontSize:12, padding:'8px 12px', borderRadius:8,
                background: testResult.ok ? 'var(--green-dim)' : 'var(--red-dim)',
                color: testResult.ok ? 'var(--green)' : 'var(--red)',
              }}>
                {testResult.ok ? tr("✓ 連線成功，已可進行同步") : tr("✗ 連線失敗：{0}", {0: testResult.error})}
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* 同步操作 */}
      {enabled && (
        <div>
          <Section title={tr("同步操作")}>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12}}>
              <button
                className="card"
                style={{padding:'16px', textAlign:'left', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1, border:'1px solid var(--blue)'}}
                onClick={handlePush}
                disabled={!!busy}
              >
                <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
                  <ArrowUp size={18} style={{color:'var(--blue)'}}/>
                  <span style={{fontWeight:600, fontSize:14}}>{tr("推上雲端")}</span>
                </div>
                <div style={{fontSize:12, color:'var(--text-secondary)', lineHeight:1.5}}>{tr("把本機資料 upsert 到雲端。已存在的（同 id）會覆蓋，新的會新增。")}<br/>
                  <span style={{color:'var(--text-tertiary)'}}>{tr("不會刪除雲端有但本機沒有的資料。")}</span>
                </div>
              </button>

              <button
                className="card"
                style={{padding:'16px', textAlign:'left', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1, border:'1px solid var(--amber)'}}
                onClick={() => setConfirmPull(true)}
                disabled={!!busy}
              >
                <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
                  <ArrowDown size={18} style={{color:'var(--amber)'}}/>
                  <span style={{fontWeight:600, fontSize:14}}>{tr("從雲端拉下來")}</span>
                </div>
                <div style={{fontSize:12, color:'var(--text-secondary)', lineHeight:1.5}}>{tr("從雲端拉取所有資料，")}<strong style={{color:'var(--amber)'}}>{tr("覆蓋本機現有資料")}</strong>。<br/>
                  <span style={{color:'var(--text-tertiary)'}}>{tr("用於其他裝置看到雲端最新版。")}</span>
                </div>
              </button>
            </div>

            {progress.length > 0 && (
              <div style={{marginTop:14, padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8, maxHeight:200, overflowY:'auto'}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:6, letterSpacing:'.05em'}}>
                  {busy === 'push' ? tr("推送進度") : busy === 'pull' ? tr("拉取進度") : tr("完成")}
                </div>
                {progress.map((p, i) => (
                  <div key={i} style={{fontSize:12, color:'var(--text-secondary)', padding:'3px 0', fontFamily:'var(--font-mono)'}}>
                    {p.status === 'pushing' ? '↑ ' : '↓ '}{p.table}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {msg && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          padding:'10px 18px', borderRadius:'var(--r3)',
          background: msg.startsWith('✗') ? 'var(--red-dim)' : 'var(--green-dim)',
          color: msg.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          border: `1px solid ${msg.startsWith('✗') ? 'var(--red)' : 'var(--green)'}`,
          fontSize:13, zIndex:300, boxShadow:'var(--shadow-md)',
        }}>{msg}</div>
      )}

      {confirmPull && (
        <div style={ss.overlay}>
          <div style={{...ss.modal, maxWidth:400}} className="animate-scale">
            <div style={{textAlign:'center', padding:'8px 0 18px'}}>
              <AlertTriangle size={36} style={{color:'var(--amber)', marginBottom:12}}/>
              <div style={{fontWeight:700, fontSize:15, marginBottom:8}}>{tr("確認從雲端拉取？")}</div>
              <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.6}}>{tr("本機目前資料將被")}<strong style={{color:'var(--red)'}}>{tr("完全覆蓋")}</strong>{tr("為雲端版本。")}<br/>{tr("建議先 \"立即備份\" 一次再進行此操作。")}</div>
            </div>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={handlePull}>{tr("確認拉取")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmPull(false)}>{tr("取消")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
