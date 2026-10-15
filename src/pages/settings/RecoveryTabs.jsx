import {tr} from "../../i18n"
import { isElectron } from '../../utils/dataAccess'

export function SecurityTab({ session }) {
  const items = [
    { icon:'🔐', title:'PBKDF2 密碼雜湊', desc:'密碼使用隨機 salt 與 PBKDF2 雜湊保存，降低密碼猜測速度。請仍使用長且不同於其他網站的密碼。', status:'已啟用', ok:true },
    { icon:'⏱', title:'閒置自動鎖定', desc:'30 分鐘無操作自動回到登入畫面，防止員工離開後他人存取', status:'30分鐘', ok:true },
    { icon:'🚫', title:'登入限速', desc:isElectron?'桌面連續 5 次失敗後暫停一分鐘；共用店面每個連線來源每分鐘最多 10 次登入／配對嘗試。':'瀏覽器登入連續失敗時會暫停重試。', status:'已啟用', ok:true },
    { icon:'📋', title:'稽核日誌', desc:'已接入稽核的異動記錄時間與操作人，畫面一次查閱最多 2000 筆；交易流水與回執另行保存。', status:'已啟用', ok:true },
    { icon:'🧹', title:'輸入與資料庫保護', desc:'介面使用文字呈現使用者輸入；資料庫使用參數化查詢，交易另外驗證金額、庫存與權限。', status:'已啟用', ok:true },
    { icon:'👁', title:'個資遮罩', desc:'顯示顧客資料時自動遮罩（09xx****xxx），防止員工截圖外洩', status:'顯示層', ok:true },
    { icon:'💾', title:'自動備份', desc:'老闆當日登入與登出時建立本機備份，最多保留 10 份；可另行下載 JSON。請確認備份檔案實際保存在另一個位置。', status:'已啟用', ok:true },
    { icon:'🔒', title:'Session 管理', desc:isElectron?'桌面與共用店面由電腦驗證角色、憑證與 8 小時期限，改密碼或撤銷裝置後失效。':'瀏覽器登入狀態有 8 小時期限，保存於 sessionStorage。', status:'8小時', ok:true },
  ]

  return (
    <div style={{overflowY:'auto',height:'100%',display:'flex',flexDirection:'column',gap:10}}>
      <div style={{fontSize:12,color:'var(--text-tertiary)',padding:'4px 0',flexShrink:0}}>{tr("以下是目前使用模式的保護措施。請仍做好裝置鎖定、帳號管理與外部備份。")}</div>
      {items.map(item=>(
        <div key={item.title} className="card" style={{padding:'13px 16px',display:'flex',gap:14,alignItems:'flex-start'}}>
          <div style={{fontSize:22,flexShrink:0,marginTop:2}}>{item.icon}</div>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <span style={{fontWeight:600,fontSize:13}}>{tr(item.title)}</span>
              <span style={{fontSize:10,padding:'1px 8px',borderRadius:20,background:item.ok?'var(--green-dim)':'var(--red-dim)',color:item.ok?'var(--green)':'var(--red)'}}>
                {tr(item.status)}
              </span>
            </div>
            <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6}}>{tr(item.desc)}</div>
          </div>
        </div>
      ))}
      <div style={{background:'var(--gold-dim)',border:'1px solid var(--gold-dim)',borderRadius:10,padding:'12px 16px',fontSize:12,color:'var(--gold-bright)',lineHeight:1.7,flexShrink:0}}>{tr("共用店面以 HTTPS 連到店面電腦；雲端快照須自行設定帳號與資料隔離。外部雲端或網路設備的保護需另外驗證，全部 POS 功能免費使用。")}</div>
    </div>
  )
}

export {BackupTab} from './BackupPanel'
