import { useState, useEffect, useRef } from 'react'
import { Shield, Users, Database, FileText, Download, Upload, Trash2, Plus, X, Check, RefreshCw, Printer, Wifi, Sun, Moon, Settings as Cog, Gift, Cloud, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react'
import QRCode from 'qrcode'
import {
  ROLES, hashPassword, verifyPassword, writeAuditLog, readAuditLogs,
  createBackup, getBackupList, restoreBackup, exportBackupFile, importBackupFile,
  maskPhone, maskName,
} from '../utils/security'
import { isElectron, loadUsers, saveUsers as dbSaveUsers, getSetting, setSetting } from '../utils/dataAccess'
import { getTheme, applyTheme } from '../utils/theme'
import { getCloudConfig, saveCloudConfig, clearCloudConfig, testConnection, isCloudEnabled } from '../utils/supabaseClient'
import { pushAll, pullAll, SYNC_TABLES } from '../utils/cloudSync'
import { getWebhookConfig, saveWebhookConfig, fireWebhook, WEBHOOK_EVENTS } from '../utils/webhook'

const TABS = [
  { key:'general',  label:'一般偏好', Icon:Cog      },
  { key:'business', label:'營運設定', Icon:Gift     },
  { key:'users',    label:'員工帳號', Icon:Users    },
  { key:'hardware', label:'硬體設定', Icon:Printer  },
  { key:'security', label:'資安設定', Icon:Shield   },
  { key:'backup',   label:'備份還原', Icon:Database },
  { key:'cloud',    label:'雲端同步', Icon:Cloud    },
  { key:'webhook',  label:'通知 Webhook', Icon:Wifi },
  { key:'audit',    label:'稽核日誌', Icon:FileText },
]

const LEVEL_STYLE = {
  info:     { color:'var(--text-tertiary)',  bg:'var(--bg-active)' },
  warning:  { color:'var(--amber)',          bg:'var(--amber-dim)' },
  critical: { color:'var(--red)',            bg:'var(--red-dim)'   },
}

export default function SettingsPage({ session, onLogout, store }) {
  const [tab, setTab] = useState('general')

  return (
    <div style={ss.root}>
      <div style={ss.header}>
        <div>
          <h2 style={ss.title}>系統設定</h2>
          <div style={{fontSize:12,color:'var(--text-tertiary)',marginTop:2}}>
            登入身份：<span style={{color:ROLES[session.role]?.color}}>{session.username}</span>
            <span style={{color:'var(--text-tertiary)'}}> · {ROLES[session.role]?.label}</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={onLogout}>登出</button>
      </div>

      <div style={ss.tabBar}>
        {TABS.map(({key,label,Icon})=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            ...ss.tab,
            background: tab===key?'var(--bg-active)':'transparent',
            color: tab===key?'var(--text-primary)':'var(--text-tertiary)',
            borderBottom:`2px solid ${tab===key?'var(--gold)':'transparent'}`,
          }}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      <div style={{flex:1, overflow:'hidden', paddingTop:16}}>
        {tab==='general'  && <GeneralTab  session={session}/>}
        {tab==='business' && <BusinessTab session={session} store={store}/>}
        {tab==='users'    && <UsersTab    session={session}/>}
        {tab==='hardware' && <HardwareTab session={session}/>}
        {tab==='security' && <SecurityTab session={session}/>}
        {tab==='backup'   && <BackupTab   session={session}/>}
        {tab==='cloud'    && <CloudSyncTab session={session}/>}
        {tab==='webhook'  && <WebhookTab  session={session}/>}
        {tab==='audit'    && <AuditTab    session={session}/>}
      </div>
    </div>
  )
}

// ── 員工帳號管理 ──────────────────────────────────────────────
// ===== 一般偏好（主題、銷售目標）=====
function GeneralTab({ session }) {
  const [theme, setTheme] = useState(getTheme())
  const [salesGoal, setSalesGoal] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    getSetting('dailySalesGoal').then(v => setSalesGoal(v || ''))
  }, [])

  function changeTheme(t) {
    setTheme(t)
    applyTheme(t)
  }

  async function saveGoal() {
    await setSetting('dailySalesGoal', salesGoal || '0')
    setSavedMsg('已儲存')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  return (
    <div style={{padding:'0 24px', overflowY:'auto', height:'100%'}}>
      <Section title="外觀">
        <div style={{display:'flex', gap:12}}>
          <button onClick={()=>changeTheme('light')} style={{
            flex:1, padding:'14px 16px', borderRadius:10, display:'flex', alignItems:'center', gap:10,
            border:`2px solid ${theme==='light' ? 'var(--gold)' : 'var(--border-subtle)'}`,
            background: theme==='light' ? 'var(--gold-dim)' : 'var(--bg-raised)',
            cursor:'pointer',
          }}>
            <Sun size={18} color="var(--amber)"/>
            <div style={{textAlign:'left'}}>
              <div style={{fontWeight:600, fontSize:14}}>淺色模式</div>
              <div style={{fontSize:11, color:'var(--text-tertiary)'}}>米白底 + 棕色點綴</div>
            </div>
          </button>
          <button onClick={()=>changeTheme('dark')} style={{
            flex:1, padding:'14px 16px', borderRadius:10, display:'flex', alignItems:'center', gap:10,
            border:`2px solid ${theme==='dark' ? 'var(--gold)' : 'var(--border-subtle)'}`,
            background: theme==='dark' ? 'var(--gold-dim)' : 'var(--bg-raised)',
            cursor:'pointer',
          }}>
            <Moon size={18} color="var(--blue)"/>
            <div style={{textAlign:'left'}}>
              <div style={{fontWeight:600, fontSize:14}}>深色模式</div>
              <div style={{fontSize:11, color:'var(--text-tertiary)'}}>暗色背景 + 金色點綴</div>
            </div>
          </button>
        </div>
      </Section>

      <Section title="每日銷售目標">
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{fontSize:13, color:'var(--text-secondary)', minWidth:60}}>目標金額</span>
          <input className="field" type="number" value={salesGoal} onChange={e=>setSalesGoal(e.target.value)} placeholder="例：30000" style={{flex:1, maxWidth:200}}/>
          <span style={{fontSize:13, color:'var(--text-tertiary)'}}>NT$</span>
          <button className="btn btn-primary btn-sm" onClick={saveGoal}>儲存</button>
          {savedMsg && <span style={{fontSize:12, color:'var(--green)'}}>{savedMsg}</span>}
        </div>
        <p style={{fontSize:12, color:'var(--text-tertiary)', marginTop:8}}>
          設定後會在首頁儀表板顯示達成進度
        </p>
      </Section>

      <Section title="鍵盤快捷鍵">
        <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:2}}>
          <div><kbd style={kbdStyle}>F1</kbd> 快速查價</div>
          <div><kbd style={kbdStyle}>F2</kbd> 掛單</div>
          <div><kbd style={kbdStyle}>F3</kbd> 取單列表</div>
          <div><kbd style={kbdStyle}>Esc</kbd> 關閉對話框</div>
        </div>
      </Section>
    </div>
  )
}

// ===== 營運設定（點數規則、生日贈點）=====
function BusinessTab({ session, store }) {
  const [earn, setEarn] = useState(10)
  const [redeem, setRedeem] = useState(1)
  const [birthdayBonus, setBirthdayBonus] = useState(100)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    getSetting('pointsEarnRate').then(v => setEarn(parseInt(v) || 10))
    getSetting('pointsRedeemRate').then(v => setRedeem(parseFloat(v) || 1))
    getSetting('birthdayBonus').then(v => setBirthdayBonus(parseInt(v) || 100))
  }, [])

  async function save() {
    if (store?.updatePointsRule) {
      await store.updatePointsRule(parseInt(earn) || 10, parseFloat(redeem) || 1)
    } else {
      await setSetting('pointsEarnRate', String(earn))
      await setSetting('pointsRedeemRate', String(redeem))
    }
    if (store?.updateBirthdayBonus) {
      await store.updateBirthdayBonus(birthdayBonus)
    } else {
      await setSetting('birthdayBonus', String(birthdayBonus))
    }
    setSavedMsg('已儲存')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  return (
    <div style={{padding:'0 24px', overflowY:'auto', height:'100%'}}>
      <Section title="會員點數規則">
        <div style={{padding:'16px 18px', background:'var(--gold-glow)', border:'1px solid var(--gold-dim)', borderRadius:8, marginBottom:14}}>
          <div style={{fontSize:13, fontWeight:600, marginBottom:10, color:'var(--gold-bright)'}}>
            <Gift size={14} style={{verticalAlign:'middle', marginRight:6}}/>
            目前規則
          </div>
          <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.8}}>
            <div>• 消費每 NT$ <strong style={{color:'var(--gold)'}}>{earn}</strong> 元 → 獲得 1 點</div>
            <div>• 1 點 → 折抵 NT$ <strong style={{color:'var(--gold)'}}>{redeem}</strong> 元</div>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <FieldLabel>消費 X 元 = 1 點</FieldLabel>
            <input className="field" type="number" value={earn} onChange={e=>setEarn(e.target.value)}/>
          </div>
          <div>
            <FieldLabel>1 點折抵金額 (元)</FieldLabel>
            <input className="field" type="number" step="0.5" value={redeem} onChange={e=>setRedeem(e.target.value)}/>
          </div>
        </div>
      </Section>

      <Section title="會員生日贈點">
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{fontSize:13, color:'var(--text-secondary)', minWidth:140}}>生日當月可獲得</span>
          <input className="field" type="number" value={birthdayBonus} onChange={e=>setBirthdayBonus(e.target.value)} style={{width:120}}/>
          <span style={{fontSize:13, color:'var(--text-tertiary)'}}>點</span>
        </div>
        <p style={{fontSize:12, color:'var(--text-tertiary)', marginTop:8}}>
          會員在生日當月首次消費時自動加贈
        </p>
      </Section>

      <button className="btn btn-primary" onClick={save} style={{padding:'10px 24px'}}>
        儲存設定
      </button>
      {savedMsg && <span style={{marginLeft:12, fontSize:13, color:'var(--green)'}}>{savedMsg}</span>}
    </div>
  )
}

const kbdStyle = {
  fontFamily:'var(--font-mono)', fontSize:11, padding:'2px 8px',
  background:'var(--bg-overlay)', borderRadius:4, color:'var(--text-secondary)',
  border:'1px solid var(--border-dim)', marginRight:8,
}

function Section({ title, children }) {
  return (
    <div style={{marginBottom:24}}>
      <div style={{fontSize:13, fontWeight:600, marginBottom:10, color:'var(--text-primary)'}}>{title}</div>
      {children}
    </div>
  )
}

function FieldLabel({ children }) {
  return <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em'}}>{children}</div>
}

function UsersTab({ session }) {
  const [users,    setUsers]    = useState([])
  const [adding,   setAdding]   = useState(false)
  const [changePw, setChangePw] = useState(null)   // target user object
  const [addForm,  setAddForm]  = useState({ username:'', password:'', role:'staff' })
  const [pwForm,   setPwForm]   = useState({ oldPw:'', newPw:'', confirmPw:'' })
  const [saving,   setSaving]   = useState(false)
  const [addErr,   setAddErr]   = useState('')
  const [pwErr,    setPwErr]    = useState('')
  const [pwOk,     setPwOk]     = useState('')

  useEffect(()=>{
    if (isElectron) {
      loadUsers([]).then(setUsers)
    } else {
      try { setUsers(JSON.parse(localStorage.getItem('pos_users')||'[]')) } catch {}
    }
  },[])

  function saveUsers(u) {
    setUsers(u)
    if (!isElectron) localStorage.setItem('pos_users', JSON.stringify(u))
  }

  // ── 新增帳號 ─────────────────────────────────────────────
  async function handleAdd() {
    if (!addForm.username || !addForm.password) return
    if (addForm.password.length < 8) { setAddErr('密碼至少 8 字元'); return }
    if (users.find(u=>u.username===addForm.username)) { setAddErr('帳號名稱已存在'); return }
    setAddErr(''); setSaving(true)
    const hashed  = await hashPassword(addForm.password)
    const newUser = { id:'u'+Date.now(), username:addForm.username, password:hashed, role:addForm.role }
    saveUsers([...users, newUser])
    writeAuditLog('USER_CREATE', session, { username:addForm.username, role:addForm.role })
    // Electron: 同步到 SQLite
    if (isElectron) {
      window.electronAPI.db.addUser({ id: newUser.id, username: newUser.username, password: newUser.password, role: newUser.role }).catch(() => {})
    }
    setAdding(false); setAddForm({username:'',password:'',role:'staff'}); setSaving(false)
  }

  // ── 刪除帳號 ─────────────────────────────────────────────
  function handleDelete(u) {
    if (u.id === session.userId) return
    saveUsers(users.filter(x=>x.id!==u.id))
    writeAuditLog('USER_DELETE', session, { username:u.username })
  }

  // ── 變更密碼 ─────────────────────────────────────────────
  async function handleChangePw() {
    const target  = users.find(u=>u.id===changePw.id)
    const isSelf  = changePw.id === session.userId
    const isOwner = session.role === 'owner'
    setPwErr(''); setPwOk(''); setSaving(true)

    // 自己改：需驗舊密碼
    if (isSelf) {
      const ok = await verifyPassword(pwForm.oldPw, target.password)
      if (!ok) { setPwErr('舊密碼錯誤'); setSaving(false); return }
    }

    if (pwForm.newPw.length < 8) { setPwErr('新密碼至少 8 字元'); setSaving(false); return }
    if (pwForm.newPw !== pwForm.confirmPw) { setPwErr('兩次密碼不一致'); setSaving(false); return }
    if (isSelf && pwForm.newPw === pwForm.oldPw) { setPwErr('新密碼不能與舊密碼相同'); setSaving(false); return }

    const hashed = await hashPassword(pwForm.newPw)
    saveUsers(users.map(u => u.id===changePw.id ? {...u, password:hashed} : u))
    if (isElectron) {
      window.electronAPI.db.updateUser(changePw.id, { password: hashed }).catch(() => {})
    }
    writeAuditLog('USER_UPDATE', session, { action:'change_password', target:changePw.username, by:session.username })
    setSaving(false); setPwOk('密碼已更新'); setPwForm({oldPw:'',newPw:'',confirmPw:''})
    setTimeout(()=>{ setChangePw(null); setPwOk('') }, 1200)
  }

  const isOwner = session.role === 'owner'

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,height:'100%'}}>
      {isOwner && (
        <div style={{display:'flex',justifyContent:'flex-end',flexShrink:0}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setAdding(true)}><Plus size={14}/>新增員工</button>
        </div>
      )}

      <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8}}>
        {users.map(u=>{
          const role = ROLES[u.role]
          const isMe = u.id === session.userId
          // Can change password: owner can change anyone, others can only change their own
          const canChangePw = isOwner || isMe
          return (
            <div key={u.id} className="card" style={{padding:'13px 16px',display:'flex',alignItems:'center',gap:14}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:`${role?.color}22`,color:role?.color,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:15,flexShrink:0}}>
                {u.username[0]}
              </div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:600,fontSize:14}}>{u.username}</span>
                  {isMe && <span style={{fontSize:10,color:'var(--gold)',background:'var(--gold-dim)',padding:'1px 7px',borderRadius:20}}>我</span>}
                </div>
                <div style={{fontSize:12,color:role?.color,marginTop:2}}>{role?.label} · {role?.permissions.length} 項權限</div>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                {canChangePw && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{fontSize:11,gap:4}}
                    onClick={()=>{ setChangePw(u); setPwForm({oldPw:'',newPw:'',confirmPw:''}); setPwErr(''); setPwOk('') }}
                  >
                    🔑 {isMe ? '改密碼' : '重設密碼'}
                  </button>
                )}
                {isOwner && !isMe && (
                  <button className="btn-icon btn-sm" style={{color:'var(--red)'}} onClick={()=>handleDelete(u)}>
                    <Trash2 size={14}/>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── 新增帳號 Modal ── */}
      {adding && (
        <div style={ss.overlay}>
          <div style={ss.modal} className="animate-scale">
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:18}}>
              <span style={{fontWeight:700}}>新增員工帳號</span>
              <button className="btn-icon" onClick={()=>setAdding(false)}><X size={16}/></button>
            </div>
            <FL>帳號名稱 *</FL>
            <input className="field" value={addForm.username} onChange={e=>setAddForm(f=>({...f,username:e.target.value}))} placeholder="例：小美" style={{marginBottom:12}}/>
            <FL>密碼 *（至少8字元）</FL>
            <input type="password" className="field" value={addForm.password} onChange={e=>setAddForm(f=>({...f,password:e.target.value}))} placeholder="輸入密碼" style={{marginBottom:addErr?4:12}}/>
            {addErr && <div style={{fontSize:11,color:'var(--red)',marginBottom:12}}>{addErr}</div>}
            <FL>角色</FL>
            <select className="field" value={addForm.role} onChange={e=>setAddForm(f=>({...f,role:e.target.value}))} style={{marginBottom:18,cursor:'pointer'}}>
              {Object.entries(ROLES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
            <div style={{background:'var(--bg-base)',borderRadius:8,padding:'10px 12px',marginBottom:16,fontSize:11,color:'var(--text-secondary)'}}>
              {ROLES[addForm.role]?.permissions.slice(0,5).join(' · ')}{ROLES[addForm.role]?.permissions.length>5?` ...等 ${ROLES[addForm.role].permissions.length} 項`:''}
            </div>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={handleAdd} disabled={saving}>{saving?'儲存中...':'儲存'}</button>
              <button className="btn btn-ghost"   style={{flex:1}} onClick={()=>setAdding(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 變更密碼 Modal ── */}
      {changePw && (
        <div style={ss.overlay}>
          <div style={ss.modal} className="animate-scale">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>
                  {changePw.id===session.userId ? '變更我的密碼' : `重設密碼 — ${changePw.username}`}
                </div>
                <div style={{fontSize:11,color:'var(--text-tertiary)',marginTop:3}}>
                  {changePw.id===session.userId ? '需要輸入舊密碼才能更改' : '老闆權限：直接重設，無需舊密碼'}
                </div>
              </div>
              <button className="btn-icon" onClick={()=>setChangePw(null)}><X size={16}/></button>
            </div>

            {/* 自己改才需要舊密碼 */}
            {changePw.id === session.userId && (
              <>
                <FL>舊密碼</FL>
                <input
                  type="password" className="field"
                  value={pwForm.oldPw}
                  onChange={e=>setPwForm(f=>({...f,oldPw:e.target.value}))}
                  placeholder="輸入目前密碼"
                  style={{marginBottom:14}}
                  autoComplete="current-password"
                />
              </>
            )}

            <FL>新密碼（至少 8 字元）</FL>
            <input
              type="password" className="field"
              value={pwForm.newPw}
              onChange={e=>setPwForm(f=>({...f,newPw:e.target.value}))}
              placeholder="輸入新密碼"
              style={{marginBottom:12}}
              autoComplete="new-password"
            />

            {/* Strength indicator */}
            {pwForm.newPw.length > 0 && (
              <div style={{marginBottom:12}}>
                <div style={{display:'flex',gap:4,marginBottom:4}}>
                  {[1,2,3,4].map(i=>{
                    const score = getPwScore(pwForm.newPw)
                    return <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=score?PW_COLORS[score-1]:'var(--border-dim)',transition:'background .2s'}}/>
                  })}
                </div>
                <div style={{fontSize:11,color:PW_COLORS[getPwScore(pwForm.newPw)-1]||'var(--text-tertiary)'}}>
                  {PW_LABELS[getPwScore(pwForm.newPw)-1]||'請輸入密碼'}
                </div>
              </div>
            )}

            <FL>確認新密碼</FL>
            <input
              type="password" className="field"
              value={pwForm.confirmPw}
              onChange={e=>setPwForm(f=>({...f,confirmPw:e.target.value}))}
              placeholder="再輸入一次新密碼"
              style={{marginBottom: (pwErr||pwOk) ? 8 : 18}}
              autoComplete="new-password"
            />

            {pwErr && <div style={{fontSize:12,color:'var(--red)',marginBottom:14,display:'flex',alignItems:'center',gap:6}}>⚠ {pwErr}</div>}
            {pwOk  && <div style={{fontSize:12,color:'var(--green)',marginBottom:14,display:'flex',alignItems:'center',gap:6}}>✓ {pwOk}</div>}

            <div style={{display:'flex',gap:10}}>
              <button
                className="btn btn-primary" style={{flex:1}}
                onClick={handleChangePw}
                disabled={saving || !pwForm.newPw || !pwForm.confirmPw || (changePw.id===session.userId && !pwForm.oldPw)}
              >
                {saving ? '更新中...' : '確認更新'}
              </button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setChangePw(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Password strength helpers
function getPwScore(pw) {
  let s = 0
  if (pw.length >= 8)  s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) s++
  return Math.max(1, s)
}
const PW_COLORS = ['var(--red)', 'var(--amber)', 'var(--teal)', 'var(--green)']
const PW_LABELS = ['強度：弱', '強度：普通', '強度：良好', '強度：強']

// ── 硬體設定 ────────────────────────────────────────────────
function HardwareTab({ session }) {
  const [printerType, setPrinterType] = useState('network')
  const [printerIP, setPrinterIP] = useState('192.168.1.100')
  const [printerPort, setPrinterPort] = useState('9100')
  const [printerName, setPrinterName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [storePhone, setStorePhone] = useState('')
  const [receiptFooter, setReceiptFooter] = useState('')
  const [printerStatus, setPrinterStatus] = useState(null)
  const [serverInfo, setServerInfo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [tunnelQr, setTunnelQr] = useState(null)
  const [lanQr, setLanQr] = useState(null)

  const isE = !!window.electronAPI

  useEffect(() => {
    if (serverInfo?.tunnelUrl) {
      QRCode.toDataURL(serverInfo.tunnelUrl + '/menu', { width: 220, margin: 2 }).then(setTunnelQr).catch(() => {})
    } else {
      setTunnelQr(null)
    }
    if (serverInfo?.ip && serverInfo?.port) {
      QRCode.toDataURL(`http://${serverInfo.ip}:${serverInfo.port}/menu`, { width: 180, margin: 2 }).then(setLanQr).catch(() => {})
    }
  }, [serverInfo])

  useEffect(() => {
    if (!isE) return
    // 載入設定
    window.electronAPI.settings.getAll().then(s => {
      if (s.printerType) setPrinterType(s.printerType)
      if (s.printerIP) setPrinterIP(s.printerIP)
      if (s.printerPort) setPrinterPort(s.printerPort)
      if (s.printerName) setPrinterName(s.printerName)
      if (s.storeName) setStoreName(s.storeName)
      if (s.storeAddress) setStoreAddress(s.storeAddress)
      if (s.storePhone) setStorePhone(s.storePhone)
      if (s.receiptFooter) setReceiptFooter(s.receiptFooter)
    })
    window.electronAPI.printer.getStatus().then(setPrinterStatus)
    window.electronAPI.server.getStatus().then(setServerInfo)
  }, [isE])

  async function handleSave() {
    if (!isE) return
    setSaving(true)
    const settings = { printerType, printerIP, printerPort, printerName, storeName, storeAddress, storePhone, receiptFooter }
    for (const [k, v] of Object.entries(settings)) {
      await window.electronAPI.settings.set(k, v)
    }
    setSaving(false)
    setTestMsg('設定已儲存')
    setTimeout(() => setTestMsg(''), 2000)
  }

  async function handleTestPrint() {
    if (!isE) return
    setTestMsg('列印中...')
    const result = await window.electronAPI.printer.testPrint()
    setTestMsg(result.success ? '測試列印成功' : '列印失敗: ' + (result.error || '未知錯誤'))
    setTimeout(() => setTestMsg(''), 4000)
  }

  async function handleTestDrawer() {
    if (!isE) return
    setTestMsg('開啟中...')
    const result = await window.electronAPI.printer.openCashDrawer()
    setTestMsg(result.success ? '錢箱已開啟' : '開啟失敗: ' + (result.error || ''))
    setTimeout(() => setTestMsg(''), 3000)
  }

  if (!isE) return (
    <div style={{padding:20, textAlign:'center', color:'var(--text-dim)'}}>
      硬體設定僅在桌面版本可用
    </div>
  )

  const fieldStyle = { width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid var(--border-dim)', fontSize:13, fontFamily:'inherit' }
  const labelStyle = { fontSize:11, color:'var(--text-tertiary)', marginBottom:4, display:'block' }

  return (
    <div style={{overflow:'auto', height:'100%', padding:'0 4px'}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, maxWidth:800}}>
        {/* 印表機設定 */}
        <div className="card" style={{padding:16}}>
          <h3 style={{fontSize:14, fontWeight:600, marginBottom:12, display:'flex', alignItems:'center', gap:6}}>
            <Printer size={15}/> 印表機設定
          </h3>

          <label style={labelStyle}>連線方式</label>
          <div style={{display:'flex', gap:8, marginBottom:12}}>
            <button className={`btn btn-sm ${printerType==='network' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPrinterType('network')}>網路印表機</button>
            <button className={`btn btn-sm ${printerType==='windows' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPrinterType('windows')}>Windows 共享</button>
          </div>

          {printerType === 'network' ? (
            <>
              <label style={labelStyle}>印表機 IP</label>
              <input style={{...fieldStyle, marginBottom:8}} value={printerIP} onChange={e=>setPrinterIP(e.target.value)} placeholder="192.168.1.100"/>
              <label style={labelStyle}>Port</label>
              <input style={{...fieldStyle, marginBottom:8}} value={printerPort} onChange={e=>setPrinterPort(e.target.value)} placeholder="9100"/>
            </>
          ) : (
            <>
              <label style={labelStyle}>印表機共享路徑</label>
              <input style={{...fieldStyle, marginBottom:8}} value={printerName} onChange={e=>setPrinterName(e.target.value)} placeholder="\\\\server\\printer"/>
            </>
          )}

          <div style={{display:'flex', gap:8, marginTop:8}}>
            <button className="btn btn-ghost btn-sm" onClick={handleTestPrint}>測試列印</button>
            <button className="btn btn-ghost btn-sm" onClick={handleTestDrawer}>測試錢箱</button>
          </div>
          {printerStatus && (
            <div style={{marginTop:8, fontSize:12, color: printerStatus.connected ? 'var(--green)' : 'var(--red)'}}>
              {printerStatus.connected ? '印表機已連線' : '印表機未連線'}
            </div>
          )}
        </div>

        {/* 收據設定 */}
        <div className="card" style={{padding:16}}>
          <h3 style={{fontSize:14, fontWeight:600, marginBottom:12}}>收據設定</h3>

          <label style={labelStyle}>店名</label>
          <input style={{...fieldStyle, marginBottom:8}} value={storeName} onChange={e=>setStoreName(e.target.value)} placeholder="我的雜貨店"/>

          <label style={labelStyle}>地址</label>
          <input style={{...fieldStyle, marginBottom:8}} value={storeAddress} onChange={e=>setStoreAddress(e.target.value)} placeholder="台北市..."/>

          <label style={labelStyle}>電話</label>
          <input style={{...fieldStyle, marginBottom:8}} value={storePhone} onChange={e=>setStorePhone(e.target.value)} placeholder="02-1234-5678"/>

          <label style={labelStyle}>收據底部文字</label>
          <input style={{...fieldStyle, marginBottom:8}} value={receiptFooter} onChange={e=>setReceiptFooter(e.target.value)} placeholder="感謝您的光臨！"/>
        </div>

        {/* 點餐系統 */}
        <div className="card" style={{padding:16}}>
          <h3 style={{fontSize:14, fontWeight:600, marginBottom:12, display:'flex', alignItems:'center', gap:6}}>
            <Wifi size={15}/> 點餐系統
          </h3>
          {serverInfo && (
            <>
              <div style={{fontSize:13, marginBottom:8}}>
                狀態: <span style={{color: serverInfo.running ? 'var(--green)' : 'var(--red)', fontWeight:600}}>
                  {serverInfo.running ? '運行中' : '未啟動'}
                </span>
              </div>
              {serverInfo.running && (
                <>
                  {/* 外網 QR Code */}
                  {serverInfo.tunnelUrl ? (
                    <div style={{marginBottom:12, padding:'12px', background:'var(--green-dim)', borderRadius:8, border:'1px solid rgba(90,158,111,0.2)', textAlign:'center'}}>
                      <div style={{fontSize:11, color:'var(--green)', fontWeight:600, marginBottom:8}}>外網點餐 QR Code（任何網路皆可掃）</div>
                      {tunnelQr && (
                        <img src={tunnelQr} alt="外網點餐QR Code"
                          style={{width:180, height:180, borderRadius:8, border:'4px solid #fff', boxShadow:'0 2px 8px rgba(0,0,0,0.15)', display:'block', margin:'0 auto 8px'}}/>
                      )}
                      <code style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-secondary)', wordBreak:'break-all', display:'block'}}>
                        {serverInfo.tunnelUrl}/menu
                      </code>
                    </div>
                  ) : (
                    <div style={{marginBottom:12, padding:'10px 12px', background:'var(--amber-dim)', borderRadius:8, fontSize:11, color:'var(--amber)'}}>
                      外網穿透連線中...（如果一直無法連線，請檢查網路）
                    </div>
                  )}

                  {/* 區域網路 QR Code */}
                  <div style={{padding:'12px', background:'var(--bg-overlay)', borderRadius:8, border:'1px solid var(--border-dim)', textAlign:'center'}}>
                    <div style={{fontSize:11, color:'var(--text-secondary)', fontWeight:600, marginBottom:8}}>區域網路 QR Code（同一 WiFi）</div>
                    {lanQr && (
                      <img src={lanQr} alt="區域網路QR Code"
                        style={{width:140, height:140, borderRadius:6, border:'3px solid #fff', boxShadow:'0 2px 6px rgba(0,0,0,0.1)', display:'block', margin:'0 auto 8px'}}/>
                    )}
                    <code style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-tertiary)'}}>
                      http://{serverInfo.ip}:{serverInfo.port}/menu
                    </code>
                  </div>
                </>
              )}
            </>
          )}
          <button className="btn btn-ghost btn-sm" style={{marginTop:10}} onClick={() => {
            window.electronAPI.server.getStatus().then(setServerInfo)
          }}>重新整理狀態</button>
        </div>

        {/* 儲存 */}
        <div className="card" style={{padding:16, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:10}}>
          <button className="btn btn-primary" style={{width:'100%', padding:12}} onClick={handleSave} disabled={saving}>
            {saving ? '儲存中...' : '儲存所有設定'}
          </button>
          {testMsg && (
            <div style={{fontSize:12, color:'var(--accent)', textAlign:'center'}}>{testMsg}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 資安設定說明 ──────────────────────────────────────────────
function SecurityTab({ session }) {
  const items = [
    { icon:'🔐', title:'PBKDF2 密碼加密', desc:'密碼以 PBKDF2（200,000次迭代 + 隨機 salt）儲存，即使資料庫外洩也無法破解', status:'已啟用', ok:true },
    { icon:'⏱', title:'閒置自動鎖定', desc:'30 分鐘無操作自動回到登入畫面，防止員工離開後他人存取', status:'30分鐘', ok:true },
    { icon:'🚫', title:'暴力破解防護', desc:'同一帳號連續 5 次輸入錯誤密碼，鎖定 30 分鐘', status:'已啟用', ok:true },
    { icon:'📋', title:'稽核日誌', desc:'所有登入、結帳、刪除、匯出操作均記錄時間戳、操作人，最多保留 2000 筆', status:'已啟用', ok:true },
    { icon:'🧹', title:'XSS / Injection 防護', desc:'所有輸入資料在儲存前清洗，過濾 script 標籤、SQL 注入等惡意字串', status:'已啟用', ok:true },
    { icon:'👁', title:'個資遮罩', desc:'顯示顧客資料時自動遮罩（09xx****xxx），防止員工截圖外洩', status:'顯示層', ok:true },
    { icon:'💾', title:'自動備份', desc:'每次重要操作前自動快照，最多保留 10 份，可匯出 JSON 檔案離線保存', status:'已啟用', ok:true },
    { icon:'🔒', title:'Session 管理', desc:'登入 Token 存於 sessionStorage（關閉分頁即失效），包含到期時間，不存密碼', status:'8小時', ok:true },
  ]

  return (
    <div style={{overflowY:'auto',height:'100%',display:'flex',flexDirection:'column',gap:10}}>
      <div style={{fontSize:12,color:'var(--text-tertiary)',padding:'4px 0',flexShrink:0}}>
        以下為系統內建的資安防護，所有措施均在瀏覽器端實作，無需額外設定。
      </div>
      {items.map(item=>(
        <div key={item.title} className="card" style={{padding:'13px 16px',display:'flex',gap:14,alignItems:'flex-start'}}>
          <div style={{fontSize:22,flexShrink:0,marginTop:2}}>{item.icon}</div>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <span style={{fontWeight:600,fontSize:13}}>{item.title}</span>
              <span style={{fontSize:10,padding:'1px 8px',borderRadius:20,background:item.ok?'var(--green-dim)':'var(--red-dim)',color:item.ok?'var(--green)':'var(--red)'}}>
                {item.status}
              </span>
            </div>
            <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6}}>{item.desc}</div>
          </div>
        </div>
      ))}
      <div style={{background:'var(--gold-dim)',border:'1px solid var(--gold-dim)',borderRadius:10,padding:'12px 16px',fontSize:12,color:'var(--gold-bright)',lineHeight:1.7,flexShrink:0}}>
        <strong>升級至雲端版後額外獲得：</strong> HTTPS 加密傳輸 · Row Level Security（每店資料隔離）· 異地備份 · WAF 防火牆 · DDoS 防護
      </div>
    </div>
  )
}

// ── 備份還原 ──────────────────────────────────────────────────
function BackupTab({ session }) {
  const [backups,  setBackups]  = useState(getBackupList)
  const [restoring,setRestoring]= useState(null)
  const [msg,      setMsg]      = useState('')

  function doBackup() {
    createBackup(session, `手動備份 ${new Date().toLocaleString('zh-TW')}`)
    setBackups(getBackupList())
    setMsg('備份建立成功')
    setTimeout(()=>setMsg(''),2500)
  }

  function doRestore(id) {
    const ok = restoreBackup(id, session)
    setRestoring(null)
    setMsg(ok ? '✓ 還原成功，請重新整理頁面' : '還原失敗')
    setTimeout(()=>setMsg(''),4000)
  }

  function doExport() {
    exportBackupFile(session)
    setMsg('匯出完成')
    setTimeout(()=>setMsg(''),2000)
  }

  function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    importBackupFile(file, session).then(()=>{
      setMsg('匯入成功，請重新整理頁面')
    }).catch(()=>setMsg('匯入失敗，格式錯誤'))
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14,height:'100%'}}>
      <div style={{display:'flex',gap:10,flexShrink:0,flexWrap:'wrap'}}>
        <button className="btn btn-primary btn-sm" onClick={doBackup}><Database size={14}/>立即備份</button>
        <button className="btn btn-ghost btn-sm"  onClick={doExport}><Download size={14}/>匯出 JSON 檔</button>
        <label className="btn btn-ghost btn-sm" style={{cursor:'pointer'}}>
          <Upload size={14}/>匯入備份
          <input type="file" accept=".json" style={{display:'none'}} onChange={handleImport}/>
        </label>
      </div>
      {msg && <div style={{background:'var(--green-dim)',border:'1px solid rgba(52,201,122,.2)',color:'var(--green)',borderRadius:8,padding:'8px 14px',fontSize:13,flexShrink:0}}>{msg}</div>}

      <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8}}>
        {backups.length===0 ? (
          <div style={{textAlign:'center',padding:'40px',color:'var(--text-tertiary)',fontSize:13}}>尚無備份記錄</div>
        ) : backups.map(b=>(
          <div key={b.id} className="card" style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:14}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:500,fontSize:13}}>{b.label}</div>
              <div style={{fontSize:11,color:'var(--text-tertiary)',marginTop:3,fontFamily:'var(--font-mono)'}}>
                {new Date(b.createdAt).toLocaleString('zh-TW')} · {b.createdBy}
                · {Math.round(b.size/1024)}KB
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{color:'var(--amber)'}} onClick={()=>setRestoring(b.id)}>
              <RefreshCw size={13}/>還原
            </button>
          </div>
        ))}
      </div>

      {restoring && (
        <div style={ss.overlay}>
          <div style={{...ss.modal,maxWidth:360}} className="animate-scale">
            <div style={{textAlign:'center',padding:'8px 0 20px'}}>
              <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
              <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>確認還原？</div>
              <div style={{fontSize:13,color:'var(--text-secondary)'}}>目前所有資料將被備份覆蓋，此操作無法復原</div>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={()=>doRestore(restoring)}>確認還原</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setRestoring(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 稽核日誌 ──────────────────────────────────────────────────
function AuditTab({ session }) {
  const [logs,    setLogs]    = useState(readAuditLogs)
  const [filter,  setFilter]  = useState('all')
  const [search,  setSearch]  = useState('')

  const filtered = logs.filter(l=>{
    const okFilter = filter==='all' || l.level===filter
    const okSearch = !search || l.username.includes(search) || l.label.includes(search)
    return okFilter && okSearch
  })

  const counts = { warning: logs.filter(l=>l.level==='warning').length, critical:logs.filter(l=>l.level==='critical').length }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,height:'100%'}}>
      <div style={{display:'flex',gap:10,flexShrink:0,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋人員或操作..." style={{flex:1,maxWidth:220,background:'var(--bg-overlay)',border:'1px solid var(--border-subtle)',borderRadius:8,padding:'7px 12px',fontSize:13,color:'var(--text-primary)'}}/>
        <div style={{display:'flex',gap:4}}>
          {[['all','全部',logs.length],['info','一般',null],['warning','警告',counts.warning],['critical','重大',counts.critical]].map(([k,l,n])=>(
            <button key={k} onClick={()=>setFilter(k)} style={{padding:'5px 10px',borderRadius:6,fontSize:12,cursor:'pointer',background:filter===k?'var(--bg-active)':'transparent',color:filter===k?'var(--text-primary)':'var(--text-tertiary)',border:`1px solid ${filter===k?'var(--border-mid)':'transparent'}`}}>
              {l}{n!==null&&<span style={{marginLeft:4,fontFamily:'var(--font-mono)',fontSize:10}}>{n}</span>}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setLogs(readAuditLogs())}><RefreshCw size={13}/></button>
      </div>

      <div style={{flex:1,overflowY:'auto',background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r3)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <div style={{display:'grid',gridTemplateColumns:'140px 70px 70px 1fr 1fr',gap:8,padding:'8px 14px',background:'var(--bg-overlay)',fontSize:11,color:'var(--text-tertiary)',letterSpacing:'.05em',flexShrink:0}}>
          <span>時間</span><span>人員</span><span>等級</span><span>操作</span><span>詳情</span>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {filtered.length===0 ? (
            <div style={{textAlign:'center',padding:'40px',color:'var(--text-tertiary)',fontSize:13}}>無符合記錄</div>
          ) : filtered.slice(0,500).map(l=>{
            const lvl = LEVEL_STYLE[l.level] || LEVEL_STYLE.info
            return (
              <div key={l.id} style={{display:'grid',gridTemplateColumns:'140px 70px 70px 1fr 1fr',gap:8,padding:'9px 14px',borderBottom:'1px solid var(--border-dim)',fontSize:12,alignItems:'center'}}>
                <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-tertiary)',whiteSpace:'nowrap'}}>
                  {new Date(l.timestamp).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                </span>
                <span style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.username}</span>
                <span>
                  <span style={{padding:'1px 7px',borderRadius:20,fontSize:10,background:lvl.bg,color:lvl.color}}>{l.level}</span>
                </span>
                <span style={{color:lvl.color,fontWeight:l.level!=='info'?600:400}}>{l.label}</span>
                <span style={{color:'var(--text-tertiary)',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {Object.entries(l.detail||{}).map(([k,v])=>`${k}:${v}`).join(' · ')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FL({children}){return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}

// ── Webhook 通知 ─────────────────────────────────────────────
function WebhookTab({ session }) {
  const initial = getWebhookConfig()
  const [url, setUrl] = useState(initial.url || '')
  const [events, setEvents] = useState(new Set(initial.events || []))
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState('')

  function showMsg(m, ms=3000) { setMsg(m); setTimeout(()=>setMsg(''), ms) }

  function handleSave() {
    saveWebhookConfig({ url: url.trim(), events: Array.from(events) })
    writeAuditLog('WEBHOOK_CONFIG_SAVE', session, { hasUrl: !!url, eventCount: events.size })
    showMsg('✓ 設定已儲存')
  }

  function toggleEvent(key) {
    setEvents(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleTest() {
    if (!url) { showMsg('✗ 請先填 URL'); return }
    setTesting(true)
    // 先暫存 + 用 checkout 事件測試
    saveWebhookConfig({ url: url.trim(), events: ['checkout'] })
    const ok = await fireWebhook('checkout', {
      _title: '🧪 測試訊息',
      _description: '這是 POS Pro 的 webhook 測試',
      _fields: [{ name: '時間', value: new Date().toLocaleString('zh-TW') }],
    })
    // 還原設定
    saveWebhookConfig({ url: url.trim(), events: Array.from(events) })
    setTesting(false)
    showMsg(ok ? '✓ 測試訊息已送出，請檢查目的端' : '✗ 送出失敗（可能是 URL 錯誤或 CORS）', 5000)
  }

  return (
    <div style={{padding:'0 4px', overflowY:'auto', height:'100%', display:'flex', flexDirection:'column', gap:18}}>
      <div className="card" style={{padding:'14px 16px', background:'var(--bg-overlay)'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Wifi size={18} style={{color:'var(--blue)'}}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:14}}>通知 Webhook</div>
            <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>
              關鍵事件發生時自動 POST 通知到指定 URL — 可接 Discord / Slack / Zapier / Make / 自家伺服器
            </div>
          </div>
        </div>
      </div>

      <Section title="連線設定">
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          <div>
            <FL>Webhook URL</FL>
            <input className="field" value={url} onChange={e=>setUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/... 或 https://hooks.slack.com/... 或自家 URL"
              style={{fontFamily:'var(--font-mono)', fontSize:12}}/>
            <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4, lineHeight:1.5}}>
              · Discord 用：<strong>伺服器設定 → 整合 → Webhook → 複製 URL</strong><br/>
              · Slack 用：<strong>Apps → Incoming Webhooks → Add → 複製 URL</strong><br/>
              · 自家後端：自動發送 POST + JSON（含 event / timestamp / payload）<br/>
              · Zapier / Make：用「Webhook by Zapier」當觸發
            </div>
          </div>
        </div>
      </Section>

      <Section title="觸發事件">
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:8}}>
          {WEBHOOK_EVENTS.map(ev => {
            const on = events.has(ev.key)
            return (
              <label key={ev.key} style={{
                display:'flex', alignItems:'flex-start', gap:10,
                padding:'12px 14px', borderRadius:8, cursor:'pointer',
                background: on ? 'var(--green-dim)' : 'var(--bg-overlay)',
                border: `1px solid ${on ? 'var(--green)' : 'var(--border-dim)'}`,
              }}>
                <input type="checkbox" checked={on} onChange={()=>toggleEvent(ev.key)} style={{marginTop:2, accentColor:'var(--green)', cursor:'pointer'}}/>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:600, color: on ? 'var(--text-primary)' : 'var(--text-secondary)'}}>
                    {ev.label}
                  </div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>
                    {ev.desc}
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      </Section>

      <div style={{display:'flex', gap:8, flexShrink:0, flexWrap:'wrap'}}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!url}>
          <Check size={14}/>儲存設定
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={!url || testing}>
          {testing ? <RefreshCw size={14} className="spin"/> : <Wifi size={14}/>}測試送出
        </button>
      </div>

      {msg && (
        <div style={{
          padding:'10px 14px', borderRadius:8, fontSize:13,
          background: msg.startsWith('✗') ? 'var(--red-dim)' : 'var(--green-dim)',
          color: msg.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          border: `1px solid ${msg.startsWith('✗') ? 'var(--red)' : 'var(--green)'}`,
        }}>{msg}</div>
      )}
    </div>
  )
}

// ── 雲端同步 ──────────────────────────────────────────────────
function CloudSyncTab({ session }) {
  const initial = getCloudConfig() || { url: '', anonKey: '' }
  const [url, setUrl] = useState(initial.url || '')
  const [anonKey, setAnonKey] = useState(initial.anonKey || '')
  const [enabled, setEnabled] = useState(isCloudEnabled())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(null) // 'push' | 'pull' | null
  const [progress, setProgress] = useState([])
  const [confirmPull, setConfirmPull] = useState(false)
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('pos_last_sync') || '')
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
    if (!confirm('確認清除雲端設定？')) return
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
      localStorage.setItem('pos_last_sync', new Date().toISOString())
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
      localStorage.setItem('pos_last_sync', new Date().toISOString())
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
      <div className="card" style={{padding:'14px 16px', background: enabled ? 'var(--green-dim)' : 'var(--bg-overlay)', borderLeft: `3px solid ${enabled ? 'var(--green)' : 'var(--text-tertiary)'}`}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Cloud size={18} style={{color: enabled ? 'var(--green)' : 'var(--text-tertiary)'}}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:14}}>
              {enabled ? '雲端已設定' : '尚未設定雲端'}
            </div>
            <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>
              {enabled
                ? `上次同步：${lastSync ? new Date(lastSync).toLocaleString('zh-TW') : '尚未同步'}`
                : '在下方輸入 Supabase URL 和 anon key，啟用跨裝置同步'}
            </div>
          </div>
        </div>
      </div>

      {/* 設定區 */}
      <div>
        <Section title="Supabase 連線設定">
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <div>
              <FL>Project URL</FL>
              <input className="field" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://xxxxx.supabase.co" style={{fontFamily:'var(--font-mono)', fontSize:12}}/>
            </div>
            <div>
              <FL>anon / public key</FL>
              <input type="password" className="field" value={anonKey} onChange={e=>setAnonKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style={{fontFamily:'var(--font-mono)', fontSize:12}}/>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4}}>
                Supabase Dashboard → Settings → API → Project URL 與 anon key（不是 service_role）
              </div>
            </div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!url || !anonKey}>
                <Check size={14}/>儲存設定
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={!enabled || testing}>
                {testing ? <RefreshCw size={14} className="spin"/> : <Wifi size={14}/>}測試連線
              </button>
              {enabled && (
                <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={handleClear}>
                  <X size={14}/>清除設定
                </button>
              )}
            </div>
            {testResult && (
              <div style={{
                fontSize:12, padding:'8px 12px', borderRadius:8,
                background: testResult.ok ? 'var(--green-dim)' : 'var(--red-dim)',
                color: testResult.ok ? 'var(--green)' : 'var(--red)',
              }}>
                {testResult.ok ? '✓ 連線成功，已可進行同步' : `✗ 連線失敗：${testResult.error}`}
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* 同步操作 */}
      {enabled && (
        <div>
          <Section title="同步操作">
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12}}>
              <button
                className="card"
                style={{padding:'16px', textAlign:'left', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1, border:'1px solid var(--blue)'}}
                onClick={handlePush}
                disabled={!!busy}
              >
                <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
                  <ArrowUp size={18} style={{color:'var(--blue)'}}/>
                  <span style={{fontWeight:600, fontSize:14}}>推上雲端</span>
                </div>
                <div style={{fontSize:12, color:'var(--text-secondary)', lineHeight:1.5}}>
                  把本機資料 upsert 到雲端。已存在的（同 id）會覆蓋，新的會新增。<br/>
                  <span style={{color:'var(--text-tertiary)'}}>不會刪除雲端有但本機沒有的資料。</span>
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
                  <span style={{fontWeight:600, fontSize:14}}>從雲端拉下來</span>
                </div>
                <div style={{fontSize:12, color:'var(--text-secondary)', lineHeight:1.5}}>
                  從雲端拉取所有資料，<strong style={{color:'var(--amber)'}}>覆蓋本機現有資料</strong>。<br/>
                  <span style={{color:'var(--text-tertiary)'}}>用於其他裝置看到雲端最新版。</span>
                </div>
              </button>
            </div>

            {progress.length > 0 && (
              <div style={{marginTop:14, padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8, maxHeight:200, overflowY:'auto'}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:6, letterSpacing:'.05em'}}>
                  {busy === 'push' ? '推送進度' : busy === 'pull' ? '拉取進度' : '完成'}
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
              <div style={{fontWeight:700, fontSize:15, marginBottom:8}}>確認從雲端拉取？</div>
              <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.6}}>
                本機目前資料將被<strong style={{color:'var(--red)'}}>完全覆蓋</strong>為雲端版本。<br/>
                建議先 "立即備份" 一次再進行此操作。
              </div>
            </div>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={handlePull}>確認拉取</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmPull(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const ss = {
  root:{display:'flex',flexDirection:'column',height:'100%',padding:'16px',gap:12,overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0},
  title:{fontFamily:'var(--font-serif)',fontSize:20,fontWeight:600},
  tabBar:{display:'flex',borderBottom:'1px solid var(--border-dim)',flexShrink:0},
  tab:{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',fontSize:13,fontWeight:500,transition:'all 150ms',borderRadius:0,letterSpacing:'.01em'},
  overlay:{position:'fixed',inset:0,background:'rgba(44,42,38,0.25)',backdropFilter:'blur(2px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r4)',padding:24,width:'90%',maxWidth:420},
}
