import {tr,trMessage,getLocale} from "../i18n"
import { browserStorage } from '../utils/browserStorage'
import { useState, useEffect } from 'react'
import { Eye, EyeOff, AlertTriangle, Shield } from 'lucide-react'
import Brand from '../components/Brand'
import { hashPassword, verifyPassword, createSession, writeAuditLog, checkRateLimit, resetRateLimit } from '../utils/security'
import { initAccounts, setupAccount } from '../utils/accountBootstrap'
import { isElectron } from '../utils/dataAccess'
import useIsMobile from '../hooks/useIsMobile'
import { version } from '../../package.json'
import DisplayPreferences from '../components/DisplayPreferences'

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [users,    setUsers]    = useState([])
  const [accountsReady,setAccountsReady]=useState(false)
  const [newPassword,setNewPassword]=useState('')
  const [needsPasswordChange,setNeedsPasswordChange]=useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    initAccounts(isElectron?window.electronAPI:undefined).then(value=>{setUsers(value);setAccountsReady(true)}).catch(e=>setError(e.message))
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (loading || !accountsReady) return
    setError('');setLoading(true)
    try {
      let session
      if (!users.length) {
        const created=await setupAccount(username,password,isElectron?window.electronAPI:undefined)
        session=isElectron?created:createSession(created)
      } else if(isElectron) {
        session=await window.electronAPI.auth.login({username,password,newPassword})
        if(session.needsPasswordChange){setNeedsPasswordChange(true);throw new Error('請更換至少 8 字元的密碼後再登入')}
      } else {
        const limit=checkRateLimit('login:'+username)
        if(!limit.allowed)throw new Error('嘗試次數過多，請稍後再試')
        const user=users.find(u=>u.username===username)
        if(!user || !await verifyPassword(password,user.password))throw new Error('帳號或密碼錯誤')
        if(password.length<8){
          if(newPassword.length<8 || newPassword===password){setNeedsPasswordChange(true);throw new Error('請更換至少 8 字元的密碼後再登入')}
          user.password=await hashPassword(newPassword)
          browserStorage.setItem('pos_users',JSON.stringify(users))
        }
        session=createSession(user)
        resetRateLimit('login:'+username)
      }
      sessionStorage.setItem('pos_session',JSON.stringify(session))
      writeAuditLog('LOGIN',session,{username})
      await onLogin(session)
    } catch(e){setError(e.message||'登入未完成，請稍後再試')}
    finally {setLoading(false)}
  }

  // 即時時間
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const timeStr = now.toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
  const dateStr = now.toLocaleDateString(getLocale(), { year:'numeric', month:'long', day:'numeric', weekday:'long' })

  return (
    <div className="login-screen">
      {!isMobile&&<section className="login-left"><div className="login-left-inner">
        <Brand/>
        <div className="login-headline"><p>{tr("所有店家，全部功能免費。")}</p><h1>{tr("顧好店。")}<br/><span>{tr("照顧客人。")}</span></h1><p>{tr("收銀、ERP、點餐與會員 CRM，")}<br/>{tr("在同一間店裡，順順地接起來。")}</p></div>
        <div className="login-poster" aria-hidden="true"><span>ERP.</span><span>CRM.</span><span>{tr("點餐。")}</span><i/><i/><i/></div>
        <div className="login-meta"><span>{dateStr}</span><span className="mono">{timeStr}</span></div>
        <p className="login-version">POS Pro / v{version}</p>
      </div></section>}
      <div className="login-right"><div className="login-card">
        <DisplayPreferences/>
        <div className="login-form-heading">
          {isMobile&&<div className="login-mobile-brand"><Brand compact/></div>}
          <p className="login-kicker">{tr("開始今天的營運")}</p>
          <h2>{accountsReady&&!users.length?tr("建立你的店"):tr("歡迎回來")}</h2>
          <p>{accountsReady&&!users.length?tr("先設定店主帳號，就能開始使用。"):tr("選帳號，輸入密碼就能繼續。")}</p>
        </div>

          {error && (
            <div style={ls.errorBanner} className="animate-pop">
              <AlertTriangle size={14} style={{flexShrink:0}}/>
              <span>{trMessage(error)}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{display:'flex', flexDirection:'column', gap:18}}>
            <div>
              <div className="section-title">{tr("身份")}</div>
              {accountsReady && !users.length && <input className="field" value={username} onChange={e=>setUsername(e.target.value)} placeholder={tr("建立管理員名稱")} autoComplete="username"/>}
              <div style={{display:'flex', gap:10}}>
                {users.map(u => {
                  const active = username === u.username
                  return (
                    <button key={u.id} type="button"
                      onClick={() => setUsername(u.username)}
                      style={{
                        flex:1, padding:'18px 12px',
                        borderRadius: 'var(--r3)',
                        border: active ? '2px solid var(--accent)' : '2px solid var(--border-dim)',
                        background: active ? 'var(--accent-dim)' : 'var(--bg-raised)',
                        cursor: 'pointer',
                        transition: 'all 240ms var(--ease-spring)',
                        display:'flex', flexDirection:'column', alignItems:'center', gap:8,
                        transform: active ? 'translateY(-2px)' : 'translateY(0)',
                        boxShadow: 'none',
                      }}>
                      <div style={{
                        width:46, height:46, borderRadius:'50%',
                        background: active ? 'var(--accent-grad)' : 'var(--bg-overlay)',
                        color: active ? '#fff' : 'var(--text-secondary)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontWeight:800, fontSize:18,
                        boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,.2)' : 'none',
                        transition:'all 240ms var(--ease-spring)',
                      }}>
                        {u.username[0]}
                      </div>
                      <span style={{
                        fontSize:14.5, fontWeight: 600,
                        color: active ? 'var(--accent-deep)' : 'var(--text-primary)',
                      }}>
                        {u.username}
                      </span>
                      <span style={{fontSize:10.5, color:'var(--text-tertiary)', fontWeight:500, letterSpacing:'.03em'}}>
                        {u.role === 'owner' ? tr("全部權限") : tr("基本操作")}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="section-title">{tr("密碼")}</div>
              <div style={ls.pwWrap}>
                <input type={showPw ? 'text' : 'password'} className="field"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={tr("輸入密碼")}
                  style={{flex:1, fontSize:15, padding:'13px 16px', paddingRight:48, fontFamily:showPw?'inherit':'var(--font-mono)', letterSpacing: showPw?'normal':'.2em'}}
                  autoComplete="current-password"/>
                <button type="button" onClick={() => setShowPw(v=>!v)}
                  style={ls.eyeBtn}>
                  {showPw ? <EyeOff size={18} color="var(--accent)"/> : <Eye size={18} color="var(--text-tertiary)"/>}
                </button>
              </div>
            </div>

            {needsPasswordChange && <input type="password" className="field" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder={tr("設定至少 8 字元的新密碼")} autoComplete="new-password"/>}
            <button type="submit" className="btn btn-primary btn-lg"
              disabled={loading || !accountsReady || !username || !password}
              style={{width:'100%', marginTop:8}}>
              {loading ? tr("驗證中...") : users.length ? tr("登入系統") : tr("建立管理員並開始")}
            </button>
          </form>

          <div style={ls.secNote}>
            <Shield size={12} style={{flexShrink:0}}/>
            <span>{tr("首次使用請建立自己的管理員；更新會保留既有帳號。")}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const ls = {
  errorBanner:{background:'var(--red-dim)',border:'1px solid var(--red)',borderRadius:'var(--r2)',padding:14,marginBottom:16,display:'flex',gap:10,alignItems:'center',color:'var(--red)',fontSize:16},
  pwWrap:{position:'relative',display:'flex',alignItems:'center'},
  eyeBtn:{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',padding:8,display:'flex',alignItems:'center',justifyContent:'center'},
  secNote:{display:'flex',alignItems:'flex-start',gap:8,marginTop:24,fontSize:13,color:'var(--text-secondary)',lineHeight:1.7},
  code:{fontFamily:'var(--font-mono)',padding:'2px 6px',background:'var(--bg-overlay)',fontSize:12},
}
