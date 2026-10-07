import { browserStorage } from '../utils/browserStorage'
import { useState, useEffect } from 'react'
import { Lock, Eye, EyeOff, AlertTriangle, Shield, Sparkles, ShoppingBag, TrendingUp, Users as UsersIcon, Smartphone } from 'lucide-react'
import { hashPassword, verifyPassword, createSession, writeAuditLog, checkRateLimit, resetRateLimit } from '../utils/security'
import { initAccounts, setupAccount } from '../utils/accountBootstrap'
import { isElectron } from '../utils/dataAccess'
import useIsMobile from '../hooks/useIsMobile'

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

  const timeStr = now.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
  const dateStr = now.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' })

  const features = [
    { Icon: ShoppingBag, label: '簡潔流暢的收銀體驗', color: 'green' },
    { Icon: TrendingUp,  label: '即時報表與營運洞察', color: 'blue' },
    { Icon: UsersIcon,   label: '會員點數與儲值系統', color: 'gold' },
    { Icon: Smartphone,  label: '顧客掃碼點餐', color: 'teal' },
  ]

  return (
    <div style={{...ls.root, flexDirection: isMobile ? 'column' : 'row', justifyContent: isMobile ? 'center' : undefined}}>
      {/* 漸層裝飾球 */}
      <div style={ls.blob1}/>
      <div style={ls.blob2}/>

      {!isMobile && (
        <div style={ls.left}>
          <div style={ls.leftContent} className="animate-up">
            <div style={ls.brandRow}>
              <div style={ls.logoMark}>
                <Sparkles size={12} style={{position:'absolute', top:-4, right:-4, color:'#fff', filter:'drop-shadow(0 0 4px rgba(255,255,255,.6))'}}/>
                P
              </div>
              <div>
                <div style={{fontSize:24, fontWeight:800, letterSpacing:'-.02em'}}>
                  POS<span style={{background:'var(--accent-grad)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text'}}>Pro</span>
                </div>
                <div style={{fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.06em', marginTop:1}}>智慧雜貨店系統</div>
              </div>
            </div>

            <div style={ls.clock} className="mono tabular">{timeStr}</div>
            <div style={ls.date}>{dateStr}</div>

            <div style={ls.featureGrid}>
              {features.map((f, i) => (
                <div key={i} style={{...ls.featureCard, animationDelay:`${i*60+200}ms`}} className="animate-up">
                  <div style={{...ls.featureIcon, background:`var(--${f.color}-dim)`, color:`var(--${f.color})`}}>
                    <f.Icon size={16}/>
                  </div>
                  <span style={{fontSize:13, color:'var(--text-secondary)', fontWeight:500}}>{f.label}</span>
                </div>
              ))}
            </div>

            <div style={ls.tipBox}>
              <span style={{fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.04em'}}>v2.6.0 · 藍白新裝</span>
            </div>
          </div>
        </div>
      )}

      <div style={{...ls.right, width: isMobile ? '100%' : 460, padding: isMobile ? 20 : 32}}>
        <div style={ls.card} className="animate-scale">
          <div style={{textAlign:'center', marginBottom:28}}>
            <div style={ls.lockBubble}>
              <Lock size={26} color="#fff"/>
            </div>
            <h2 style={{fontSize:22, fontWeight:800, color:'var(--text-primary)', letterSpacing:'-.01em'}}>歡迎回來</h2>
            <div style={{fontSize:13.5, color:'var(--text-tertiary)', marginTop:6, fontWeight:500}}>選擇身份並輸入密碼</div>
          </div>

          {error && (
            <div style={ls.errorBanner} className="animate-pop">
              <AlertTriangle size={14} style={{flexShrink:0}}/>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{display:'flex', flexDirection:'column', gap:18}}>
            <div>
              <div className="section-title">身份</div>
              {accountsReady && !users.length && <input className="field" value={username} onChange={e=>setUsername(e.target.value)} placeholder="建立管理員名稱" autoComplete="username"/>}
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
                        boxShadow: active ? '0 8px 24px rgba(37,99,235,0.28)' : 'var(--shadow-xs)',
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
                        {u.role === 'owner' ? '全部權限' : '基本操作'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="section-title">密碼</div>
              <div style={ls.pwWrap}>
                <input type={showPw ? 'text' : 'password'} className="field"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="輸入密碼"
                  style={{flex:1, fontSize:15, padding:'13px 16px', paddingRight:48, fontFamily:showPw?'inherit':'var(--font-mono)', letterSpacing: showPw?'normal':'.2em'}}
                  autoComplete="current-password"/>
                <button type="button" onClick={() => setShowPw(v=>!v)}
                  style={ls.eyeBtn}>
                  {showPw ? <EyeOff size={18} color="var(--accent)"/> : <Eye size={18} color="var(--text-tertiary)"/>}
                </button>
              </div>
            </div>

            {needsPasswordChange && <input type="password" className="field" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="設定至少 8 字元的新密碼" autoComplete="new-password"/>}
            <button type="submit" className="btn btn-primary btn-lg"
              disabled={loading || !accountsReady || !username || !password}
              style={{width:'100%', marginTop:8}}>
              {loading ? '驗證中...' : users.length ? '登入系統' : '建立管理員並開始'}
            </button>
          </form>

          <div style={ls.secNote}>
            <Shield size={12} style={{flexShrink:0}}/>
            <span>首次使用請建立自己的管理員；更新會保留既有帳號。</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const ls = {
  root:{
    display:'flex', height:'100dvh',
    background:'var(--bg-base)', overflow:'hidden',
    position:'relative',
  },
  blob1:{
    position:'absolute', top:-100, left:-100,
    width:400, height:400, borderRadius:'50%',
    background:'radial-gradient(circle, var(--accent-glow), transparent 70%)',
    pointerEvents:'none', zIndex:0,
  },
  blob2:{
    position:'absolute', bottom:-150, right:-100,
    width:500, height:500, borderRadius:'50%',
    background:'radial-gradient(circle, var(--gold-glow), transparent 70%)',
    pointerEvents:'none', zIndex:0,
  },
  left:{
    flex:1, display:'flex', alignItems:'center', justifyContent:'center',
    padding:48, position:'relative', zIndex:1,
  },
  leftContent:{ maxWidth:380, width:'100%' },
  brandRow:{ display:'flex', alignItems:'center', gap:12, marginBottom:36 },
  logoMark:{
    width:44, height:44, borderRadius:12,
    background:'var(--accent-grad)', color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily:'var(--font-serif)', fontWeight:900, fontSize:22,
    flexShrink:0, position:'relative',
    boxShadow:'0 6px 20px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,.2)',
  },
  clock:{
    fontSize:64, fontWeight:600, letterSpacing:'-.04em', lineHeight:1,
    color:'var(--text-primary)', marginBottom:8,
  },
  date:{ fontSize:14, color:'var(--text-tertiary)', marginBottom:36, fontWeight:500 },
  featureGrid:{
    display:'flex', flexDirection:'column', gap:10, marginBottom:24,
  },
  featureCard:{
    display:'flex', alignItems:'center', gap:12,
    padding:'12px 14px', borderRadius:'var(--r3)',
    background:'var(--bg-raised)',
    border:'1px solid var(--border-dim)',
    boxShadow:'var(--shadow-xs)',
  },
  featureIcon:{
    width:32, height:32, borderRadius:'var(--r2)',
    display:'flex', alignItems:'center', justifyContent:'center',
    flexShrink:0,
  },
  tipBox:{
    padding:'8px 14px', borderRadius:'var(--r-pill)',
    background:'var(--bg-overlay)', display:'inline-block',
    border:'1px solid var(--border-dim)',
  },
  right:{
    width:460, flexShrink:0,
    display:'flex', alignItems:'center', justifyContent:'center',
    padding:32, position:'relative', zIndex:1,
  },
  card:{
    background:'var(--bg-glass)',
    backdropFilter:'blur(24px) saturate(180%)',
    WebkitBackdropFilter:'blur(24px) saturate(180%)',
    border:'1px solid var(--border-subtle)',
    borderRadius:'var(--r5)',
    padding:'40px 32px', width:'100%',
    boxShadow:'var(--shadow-xl)',
  },
  lockBubble:{
    width:60, height:60, borderRadius:18,
    background:'var(--accent-grad)',
    display:'flex', alignItems:'center', justifyContent:'center',
    margin:'0 auto 16px',
    boxShadow:'0 8px 24px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,.15)',
  },
  errorBanner:{
    background:'var(--red-dim)',
    border:'1.5px solid rgba(217,79,68,0.22)',
    borderRadius:'var(--r2)', padding:'12px 16px', marginBottom:14,
    display:'flex', gap:10, alignItems:'center', color:'var(--red)',
    fontSize:13, fontWeight:600,
  },
  pwWrap:{ position:'relative', display:'flex', alignItems:'center' },
  eyeBtn:{
    position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
    padding:8, borderRadius:'var(--r2)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  secNote:{
    display:'flex', alignItems:'center', gap:8,
    marginTop:24, fontSize:11.5,
    color:'var(--text-tertiary)',
    justifyContent:'center', fontWeight:500,
  },
  code:{
    fontFamily:'var(--font-mono)', fontWeight:600,
    padding:'2px 6px', borderRadius:'var(--r1)',
    background:'var(--bg-overlay)', color:'var(--accent-deep)',
    fontSize:11,
  },
}
