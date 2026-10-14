import { browserStorage } from "../../utils/browserStorage"
import { useState, useEffect } from "react"
import { Trash2, Plus, X } from "lucide-react"
import { ROLES, hashPassword, verifyPassword, writeAuditLog } from "../../utils/security"
import { isElectron, loadUsers } from "../../utils/dataAccess"
import { FL, ss } from "./controls.jsx"

export function UsersTab({ session }) {
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
      loadUsers([]).then(setUsers).catch(e=>setAddErr('帳號讀取未完成：'+e.message))
    } else {
      try { setUsers(JSON.parse(browserStorage.getItem('pos_users')||'[]')) } catch(e){setAddErr('帳號讀取未完成：'+e.message)}
    }
  },[])

  function saveUsers(u) {
    if (!isElectron) browserStorage.setItem('pos_users', JSON.stringify(u))
    setUsers(u)
  }

  // ── 新增帳號 ─────────────────────────────────────────────
  async function handleAdd() {
    if (!addForm.username || !addForm.password) return
    if (addForm.password.length < 8) { setAddErr('密碼至少 8 字元'); return }
    if (users.find(u=>u.username===addForm.username)) { setAddErr('帳號名稱已存在'); return }
    setAddErr(''); setSaving(true)
    try {
    const hashed  = await hashPassword(addForm.password)
    const newUser = { id:'u'+Date.now(), username:addForm.username, password:hashed, role:addForm.role }

    writeAuditLog('USER_CREATE', session, { username:addForm.username, role:addForm.role })
    // Electron: 同步到 SQLite
    if (isElectron) {
      await window.electronAPI.db.addUser({ id: newUser.id, username: newUser.username, password: newUser.password, role: newUser.role })
    }
    saveUsers([...users,newUser])
    setAdding(false); setAddForm({username:'',password:'',role:'staff'}); setSaving(false)
    }catch(e){setAddErr(e.message)}finally{setSaving(false)}
  }

  // ── 刪除帳號 ─────────────────────────────────────────────
  async function handleDelete(u) {
    if (u.id === session.userId) return
    if(u.role==='owner'&&users.filter(u=>u.role==='owner').length<2){alert('必須保留管理員帳號');return}
    try{
    if(isElectron)await window.electronAPI.db.deleteUser(u.id)
    saveUsers(users.filter(x=>x.id!==u.id))
    writeAuditLog('USER_DELETE', session, { username:u.username })
    }catch(e){alert('刪除未完成：'+e.message)}
  }

  // ── 變更密碼 ─────────────────────────────────────────────
  async function handleChangePw() {
    const target  = users.find(u=>u.id===changePw.id)
    const isSelf  = changePw.id === session.userId
    const isOwner = session.role === 'owner'
    setPwErr(''); setPwOk(''); setSaving(true)
    try{

    // 自己改：需驗舊密碼
    if (isSelf) {
      const ok = await verifyPassword(pwForm.oldPw, target.password)
      if (!ok) { setPwErr('舊密碼錯誤'); setSaving(false); return }
    }

    if (pwForm.newPw.length < 8) { setPwErr('新密碼至少 8 字元'); setSaving(false); return }
    if (pwForm.newPw !== pwForm.confirmPw) { setPwErr('兩次密碼不一致'); setSaving(false); return }
    if (isSelf && pwForm.newPw === pwForm.oldPw) { setPwErr('新密碼不能與舊密碼相同'); setSaving(false); return }

    const hashed = await hashPassword(pwForm.newPw)

    if (isElectron) {
      await window.electronAPI.db.updateUser(changePw.id, { password: hashed })
    }
    saveUsers(users.map(u=>u.id===changePw.id?{...u,password:hashed}:u))
    writeAuditLog('USER_UPDATE', session, { action:'change_password', target:changePw.username, by:session.username })
    setSaving(false); setPwOk('密碼已更新'); setPwForm({oldPw:'',newPw:'',confirmPw:''})
    setTimeout(()=>{ setChangePw(null); setPwOk('') }, 1200)
    }catch(e){setPwErr('密碼更新未完成：'+e.message)}finally{setSaving(false)}
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

export function getPwScore(pw) {
  let s = 0
  if (pw.length >= 8)  s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) s++
  return Math.max(1, s)
}

export const PW_COLORS = ['var(--red)', 'var(--amber)', 'var(--teal)', 'var(--green)']

export const PW_LABELS = ['強度：弱', '強度：普通', '強度：良好', '強度：強']
