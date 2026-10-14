import { useState, useEffect, useRef } from "react"
import { Printer, Wifi } from "lucide-react"
import QRCode from "qrcode"

export function HardwareTab({ session }) {
  const savingRef=useRef(false)
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
  const [publicOrdering,setPublicOrdering]=useState(false)

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
      setPublicOrdering(s.publicOrderingEnabled==='true')
    }).catch(e=>setTestMsg('設定讀取未完成：'+e.message))
    window.electronAPI.printer.getStatus().then(setPrinterStatus).catch(e=>setTestMsg('印表機狀態讀取失敗：'+e.message))
    window.electronAPI.server.getStatus().then(setServerInfo).catch(e=>setTestMsg('點餐通道狀態讀取失敗：'+e.message))
  }, [isE])

  async function handleSave() {
    if (!isE||savingRef.current) return
    savingRef.current=true;setSaving(true)
    const settings = { printerType, printerIP, printerPort, printerName, storeName, storeAddress, storePhone, receiptFooter,publicOrderingEnabled:String(publicOrdering) }
    try{
      const result=await window.electronAPI.settings.setMany(settings)
      if(result?.success!==true)throw Error(result?.error||'未收到完整保存回覆')
      setTestMsg('設定已儲存；對外點餐通道的變更會在重啟桌面版後套用');setTimeout(()=>setTestMsg(''),2000)
    }catch(e){setTestMsg('設定保存未完成：'+e.message)}finally{savingRef.current=false;setSaving(false)}
  }

  async function handleTestPrint() {
    if (!isE) return
    setTestMsg('列印中...')
    try{const result=await window.electronAPI.printer.testPrint();setTestMsg(result.success?'列印已送出，請確認紙張與內容':'列印失敗: '+(result.error||'未知錯誤'))}catch(e){setTestMsg('列印未完成：'+e.message)}
    setTimeout(() => setTestMsg(''), 4000)
  }

  async function handleTestDrawer() {
    if (!isE) return
    setTestMsg('開啟中...')
    try{const result=await window.electronAPI.printer.openCashDrawer();setTestMsg(result.success?'開啟指令已送出，請確認錢箱':'開啟失敗: '+(result.error||''))}catch(e){setTestMsg('開啟未完成：'+e.message)}
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
          <label style={{display:'flex',gap:8,marginBottom:12,fontSize:13}}><input type="checkbox" checked={publicOrdering} onChange={e=>setPublicOrdering(e.target.checked)}/>允許建立對外點餐通道（儲存後重啟套用）</label>
          <p style={{fontSize:12,color:'var(--text-secondary)'}}>啟用後，知道網址的人可開啟菜單並送出訂單。核心 POS 和區網菜單不需要此通道。</p>
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
                    <div style={{marginBottom:12, padding:'12px', background:'var(--green-dim)', borderRadius:8, border:'1px solid rgba(22,163,74,0.25)', textAlign:'center'}}>
                      <div style={{fontSize:11, color:'var(--green)', fontWeight:600, marginBottom:8}}>外網點餐 QR Code（任何網路皆可掃）</div>
                      {tunnelQr && (
                        <img src={tunnelQr} alt="外網點餐QR Code"
                          style={{width:180, height:180, borderRadius:8, border:'4px solid #fff', boxShadow:'var(--shadow-sm)', display:'block', margin:'0 auto 8px'}}/>
                      )}
                      <code style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-secondary)', wordBreak:'break-all', display:'block'}}>
                        {serverInfo.tunnelUrl}/menu
                      </code>
                    </div>
                  ) : (
                    <div style={{marginBottom:12, padding:'10px 12px', background:'var(--amber-dim)', borderRadius:8, fontSize:11, color:'var(--amber)'}}>
                      {publicOrdering?'尚未取得對外網址；請重啟桌面版並檢查連線狀態':'對外點餐通道已關閉；可使用下方區網菜單'}
                    </div>
                  )}

                  {/* 區域網路 QR Code */}
                  <div style={{padding:'12px', background:'var(--bg-overlay)', borderRadius:8, border:'1px solid var(--border-dim)', textAlign:'center'}}>
                    <div style={{fontSize:11, color:'var(--text-secondary)', fontWeight:600, marginBottom:8}}>區域網路 QR Code（同一 WiFi）</div>
                    {lanQr && (
                      <img src={lanQr} alt="區域網路QR Code"
                        style={{width:140, height:140, borderRadius:6, border:'3px solid #fff', boxShadow:'var(--shadow-xs)', display:'block', margin:'0 auto 8px'}}/>
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
            window.electronAPI.server.getStatus().then(setServerInfo).catch(e=>setTestMsg('點餐通道狀態讀取失敗：'+e.message))
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
