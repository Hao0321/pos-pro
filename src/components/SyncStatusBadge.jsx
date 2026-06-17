import { useState, useEffect } from 'react'
import { Cloud, CloudOff, ArrowUp, ArrowDown, RefreshCw, Check } from 'lucide-react'
import { isCloudEnabled } from '../utils/supabaseClient'
import { pushAll, pullAll } from '../utils/cloudSync'

function formatAgo(iso) {
  if (!iso) return '尚未同步'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '剛剛'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} 分鐘前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小時前`
  return `${Math.floor(hours / 24)} 天前`
}

export default function SyncStatusBadge({ onGoToSettings }) {
  const [enabled, setEnabled] = useState(isCloudEnabled())
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('pos_last_sync') || '')
  const [busy, setBusy] = useState(null) // 'push' | 'pull' | null
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState('')

  // 監聽 localStorage 變化（在其他分頁 / Settings 內改設定後同步狀態）
  useEffect(() => {
    function refresh() {
      setEnabled(isCloudEnabled())
      setLastSync(localStorage.getItem('pos_last_sync') || '')
    }
    const t = setInterval(refresh, 5000)
    window.addEventListener('storage', refresh)
    return () => { clearInterval(t); window.removeEventListener('storage', refresh) }
  }, [])

  async function handlePush() {
    if (busy) return
    setBusy('push')
    setFeedback('')
    try {
      const report = await pushAll(() => {})
      const total = report.reduce((s, r) => s + (r.count || 0), 0)
      localStorage.setItem('pos_last_sync', new Date().toISOString())
      setLastSync(new Date().toISOString())
      setFeedback(`✓ 已推送 ${total} 筆`)
      setTimeout(() => setFeedback(''), 3000)
    } catch (e) {
      setFeedback(`✗ ${e.message}`)
      setTimeout(() => setFeedback(''), 5000)
    }
    setBusy(null)
  }

  async function handlePull() {
    if (busy) return
    if (!confirm('從雲端拉取會覆蓋本機資料，確認？')) return
    setBusy('pull')
    setFeedback('')
    try {
      await pullAll(() => {})
      localStorage.setItem('pos_last_sync', new Date().toISOString())
      setFeedback('✓ 拉取完成，重新載入...')
      setTimeout(() => location.reload(), 800)
    } catch (e) {
      setFeedback(`✗ ${e.message}`)
      setTimeout(() => setFeedback(''), 5000)
      setBusy(null)
    }
  }

  if (!enabled) {
    return (
      <button
        onClick={onGoToSettings}
        style={styles.box}
        title="尚未設定雲端同步，點此前往設定"
      >
        <CloudOff size={13} style={{color:'var(--text-tertiary)', flexShrink:0}}/>
        <span style={{fontSize:11, color:'var(--text-tertiary)', flex:1}}>未連線雲端</span>
      </button>
    )
  }

  const stale = lastSync && (Date.now() - new Date(lastSync).getTime()) > 24 * 60 * 60 * 1000
  const color = stale ? 'var(--amber)' : 'var(--green)'

  return (
    <div style={{...styles.wrap, ...(open ? {gap:6} : {})}}>
      <button onClick={() => setOpen(o => !o)} style={styles.box}>
        {busy ? (
          <RefreshCw size={13} className="spin" style={{color, flexShrink:0}}/>
        ) : (
          <Cloud size={13} style={{color, flexShrink:0}}/>
        )}
        <div style={{flex:1, minWidth:0, textAlign:'left'}}>
          <div style={{fontSize:11, color:'var(--text-secondary)', fontWeight:600}}>
            {busy === 'push' ? '推送中...' : busy === 'pull' ? '拉取中...' : '雲端已連線'}
          </div>
          <div style={{fontSize:10, color:'var(--text-tertiary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
            {formatAgo(lastSync)}
          </div>
        </div>
      </button>

      {open && !busy && (
        <div style={styles.actions}>
          <button onClick={handlePush} style={{...styles.actionBtn, color:'var(--blue)'}} title="把本機改動推到雲端">
            <ArrowUp size={12}/>推送
          </button>
          <button onClick={handlePull} style={{...styles.actionBtn, color:'var(--amber)'}} title="從雲端拉最新（覆蓋本機）">
            <ArrowDown size={12}/>拉取
          </button>
        </div>
      )}

      {feedback && (
        <div style={{
          fontSize:11, padding:'4px 8px', borderRadius:6,
          background: feedback.startsWith('✗') ? 'var(--red-dim)' : 'var(--green-dim)',
          color: feedback.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          margin:'0 14px',
        }}>{feedback}</div>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    display:'flex', flexDirection:'column',
    margin:'0 14px',
  },
  box: {
    display:'flex', alignItems:'center', gap:8,
    background:'var(--bg-raised)',
    borderRadius:'var(--r2)',
    padding:'7px 10px',
    border:'1px solid var(--border-dim)',
    cursor:'pointer',
    width:'100%',
    transition:'background 150ms',
  },
  actions: {
    display:'flex', gap:6, marginTop:6,
  },
  actionBtn: {
    flex:1,
    display:'flex', alignItems:'center', justifyContent:'center', gap:4,
    fontSize:11, fontWeight:600,
    padding:'6px 8px',
    borderRadius:'var(--r2)',
    background:'var(--bg-raised)',
    border:'1px solid var(--border-dim)',
    cursor:'pointer',
  },
}
