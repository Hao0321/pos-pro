import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, Camera, RefreshCw, AlertTriangle } from 'lucide-react'

// 模組層級序號：React 18 StrictMode 會把 effect 掛載兩次，用遞增序號當容器 id，
// 避免兩次 Date.now() 撞同毫秒造成兩個實例共用同一個 id。
let scannerSeq = 0

// 通用相機條碼掃描 modal
// 用法：<BarcodeScannerModal onScan={(code)=>...} onClose={()=>...} />
// onScan 可以回傳 'keep' 字串表示掃完不關閉（連續掃，例如盤點）；其他狀況預設關閉
export default function BarcodeScannerModal({ onScan, onClose, title = '掃描條碼', mode = 'single' }) {
  const containerRef = useRef(null)
  const scannerRef = useRef(null)
  const [status, setStatus] = useState('initializing') // initializing | scanning | error
  const [error, setError] = useState('')
  const [lastCode, setLastCode] = useState('')

  useEffect(() => {
    let cancelled = false       // unmount / 已關閉
    let running = false         // scanner.start() 已成功進入掃描中
    let stopping = false        // 已開始 stop，避免 double-stop（鏡頭不滅）
    let scanner = null          // 本次 effect run 專屬實例（不靠 scannerRef，否則 StrictMode 兩次掛載會互相覆蓋導致鏡頭洩漏）
    const id = 'barcode-reader-' + (++scannerSeq)
    if (containerRef.current) containerRef.current.id = id

    // 安全停止：只停「本實例」、且只在已 running 時才停一次。
    // 關鍵：先判斷 !running 再決定是否標記 stopping —— 若在 start() 尚未完成時就 unmount，
    // 這裡會直接 return 而不鎖死 stopping，等 start() 完成後仍能正確把剛啟動的相機關掉（修正鏡頭不滅）。
    function safeStop() {
      if (!scanner || stopping || !running) return Promise.resolve()
      stopping = true
      const sc = scanner
      return sc.stop().then(() => sc.clear()).catch(() => {})
    }

    async function start() {
      try {
        scanner = new Html5Qrcode(id, { verbose: false })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' }, // 後鏡頭優先
          { fps: 10, qrbox: { width: 280, height: 160 }, aspectRatio: 1.333 },
          (decodedText) => {
            if (cancelled || stopping) return
            setLastCode(decodedText)
            const keepScanning = onScan?.(decodedText) === 'keep' || mode === 'continuous'
            if (!keepScanning) {
              safeStop().finally(() => onClose?.())
            }
          },
          () => {} // ignore decode error frames
        )
        running = true
        // 若在 start() 進行中已被 unmount，立即停掉剛啟動的相機
        if (cancelled) { safeStop(); return }
        setStatus('scanning')
      } catch (e) {
        if (cancelled) return
        setError(e?.message || '無法啟動相機，請確認權限')
        setStatus('error')
      }
    }
    start()

    return () => {
      cancelled = true
      safeStop()
    }
  }, [])

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <Camera size={16} style={{color:'var(--gold)'}}/>
            <span style={{fontWeight:600, fontSize:15}}>{title}</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18}/></button>
        </div>

        {status === 'error' ? (
          <div style={styles.errorBox}>
            <AlertTriangle size={32} style={{color:'var(--red)', marginBottom:10}}/>
            <div style={{fontWeight:600, marginBottom:6}}>無法開啟相機</div>
            <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.5}}>
              {error}
            </div>
            <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:12, lineHeight:1.6}}>
              · iOS Safari：需手動到 設定 → Safari → 相機 允許<br/>
              · 必須是 HTTPS 網站（PWA 部署時自動 HTTPS）<br/>
              · 桌機 Electron：請改用 USB 條碼槍
            </div>
          </div>
        ) : (
          <>
            <div ref={containerRef} style={styles.reader}/>
            <div style={styles.statusBar}>
              {status === 'initializing' ? (
                <span><RefreshCw size={12} className="spin" style={{verticalAlign:-1}}/> 啟動相機中...</span>
              ) : lastCode ? (
                <span style={{color:'var(--green)'}}>✓ 已掃到 {lastCode}</span>
              ) : (
                <span>請對準條碼或 QR Code</span>
              )}
            </div>
          </>
        )}

        <div style={{padding:'12px 16px', display:'flex', gap:8}}>
          <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position:'fixed', inset:0, zIndex:500,
    background:'rgba(20,18,15,0.85)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  modal: {
    background:'var(--bg-raised)', borderRadius:'var(--r4)',
    width:'90%', maxWidth:420, overflow:'hidden',
    border:'1px solid var(--border-dim)',
  },
  header: {
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'14px 16px', borderBottom:'1px solid var(--border-dim)',
  },
  reader: {
    width:'100%', minHeight:280, background:'#000',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  statusBar: {
    padding:'10px 16px',
    fontSize:12, color:'var(--text-secondary)',
    background:'var(--bg-overlay)', textAlign:'center',
  },
  errorBox: {
    padding:'30px 24px', textAlign:'center',
  },
}
