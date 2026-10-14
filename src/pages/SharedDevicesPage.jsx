import {useEffect,useState} from 'react'
import QRCode from 'qrcode'
import {isElectron,isSharedStore} from '../utils/dataAccess'
export default function SharedDevicesPage(){
  const [status,setStatus]=useState(null),[host,setHost]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pair,setPair]=useState(null),[qr,setQr]=useState('')
  const api=window.electronAPI?.shared
  useEffect(()=>{if(!api)return;let cancelled=false;const refresh=()=>api.getStatus().then(s=>{if(!cancelled){setStatus(s);setHost(h=>s.running?s.host:s.addresses?.includes(h)?h:s.addresses?.[0]||'')}}).catch(e=>{if(!cancelled)setError(e.message)});refresh();const t=setInterval(refresh,5000);return()=>{cancelled=true;clearInterval(t)}},[])
  async function run(fn){if(busy)return;setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function downloadCertificate(){const data=await api.certificate(),a=document.createElement('a');a.href='data:application/pkix-cert;base64,'+data;a.download='POS-Store.cer';a.click()}
  return <div style={{padding:24,overflowY:'auto',maxWidth:850}}>
    <h2>手機與電腦共用店面</h2>
    <p>所有訂單、庫存、會員與交班都存於店面電腦。手機與電腦連到同一個 Wi-Fi 或熱點，電腦須保持開機並開啟 POS。</p>
    <p>共用店面免費使用；連不到電腦時會停止保存，恢復後沿用原單號核對。</p>
    {error&&<p role="alert" style={{color:'var(--red)'}}>{error}</p>}
    {!isElectron&&<p>請用 Windows 桌面版啟動共用店面，再以配對網址登入手機。</p>}
    {isSharedStore&&<p>此手機已連到 {location.host}，使用電腦的共同資料庫。配對與裝置撤銷請在店面電腦操作。</p>}
    {isElectron&&!isSharedStore&&status&&<>
      <label>店面電腦的私人網路位址 <select className="field" disabled={busy||status.running} value={host} onChange={e=>setHost(e.target.value)}>{status.addresses?.map(a=><option key={a}>{a}</option>)}</select></label>
      {!status.addresses?.length&&<p>尚未找到私人網路位址，請先連上店面的 Wi-Fi 或熱點。</p>}
      {status.running&&!status.addresses?.includes(status.host)&&<p role="alert">店面網路位址已變更。請停止後重新啟動共用店面，再讓手機重新配對。</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
        <button className="btn btn-primary" disabled={busy||status.running||!host} onClick={()=>run(async()=>setStatus(await api.start({host,port:3443})))}>啟動共用店面</button>
        <button className="btn btn-ghost" disabled={busy||!status.running} onClick={()=>run(async()=>{setStatus(await api.stop());setPair(null);setQr('')})}>停止共用店面</button>
      </div>
      {status.running&&<>
        <p>店面網址：{status.url}</p>
        <p>第一次連線需將這間店的 HTTPS 憑證加入手機信任，才能使用安全的瀏覽器功能。請先比對電腦顯示的指紋，再信任憑證；憑證只適用此店的位址。</p>
        <p style={{overflowWrap:'anywhere',fontFamily:'monospace'}}>SHA-256：{status.fingerprint}</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn btn-ghost" disabled={busy} onClick={()=>run(downloadCertificate)}>下載店面憑證</button>
          <button className="btn btn-primary" disabled={busy} onClick={()=>run(async()=>{const p=await api.pair();setPair(p);setQr(await QRCode.toDataURL(p.url,{width:260,margin:2}))})}>產生手機配對 QR 碼</button>
        </div>
        <p>手機可從店面網址的 /certificate.cer 下載相同憑證。iPhone 安裝描述檔後須啟用完整信任；Android 須安裝為 CA 憑證。不同手機的設定位置不同。</p>
        <p>配對連結 5 分鐘內可使用一次，配對後仍須登入店面帳號。程式重啟或停止共用後需重新配對；系統不會自行開放防火牆或建立外網通道。</p>
        {pair&&<div><img src={qr} alt="手機一次性配對 QR 碼" style={{maxWidth:'100%'}}/><p style={{overflowWrap:'anywhere'}}>{pair.url}</p><p>連結到期：{new Date(pair.expiresAt).toLocaleTimeString('zh-TW')}</p></div>}
        {status.devices.map(d=><div key={d.id} style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:10}}><span>{d.username} · {d.role||'待登入'}</span><button disabled={busy} className="btn btn-ghost" onClick={()=>run(async()=>setStatus(await api.revoke(d.id)))}>撤銷此裝置</button></div>)}
      </>}
    </>}
  </div>
}
