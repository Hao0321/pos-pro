import {tr} from "../i18n"
import { useState,useEffect,lazy,Suspense } from "react"
import { Shield, Users, Database, FileText, Printer, Wifi, Settings as Cog, Gift, Cloud } from "lucide-react"
import { ROLES } from "../utils/security"
import { isSharedStore } from "../utils/dataAccess"
import { GeneralTab, BusinessTab } from "./settings/PreferencesTabs.jsx"
import { UsersTab } from "./settings/UsersTab.jsx"
import { HardwareTab } from "./settings/HardwareTab.jsx"
import { SecurityTab, BackupTab } from "./settings/RecoveryTabs.jsx"
import { AuditTab } from "./settings/AuditTab.jsx"
import { WebhookTab } from "./settings/WebhookTab.jsx"
const CloudSyncTab=lazy(()=>import("./settings/CloudSyncTab.jsx").then(module=>({default:module.CloudSyncTab})))
import { ss } from "./settings/controls.jsx"

export const TABS = [
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

export default function SettingsPage({ session, onLogout, store }) {
  const [tab, setTab] = useState('general')
  useEffect(()=>{if(store?.settingsTarget?.tab==='business'&&session.role==='owner'){setTab('business');store.consumeSettingsTarget()}},[store?.settingsTarget,session.role])
  useEffect(()=>{if(store?.settingsTarget?.tab==='hardware'&&!isSharedStore){setTab('hardware');store.consumeSettingsTarget()}},[store?.settingsTarget])

  return (
    <div style={ss.root}>
      <div style={ss.header}>
        <div>
          <h2 className="page-title" style={ss.title}>{tr("系統設定")}</h2>
          <div style={{fontSize:12,color:'var(--text-tertiary)',marginTop:2}}>{tr("登入身份：")}<span style={{color:ROLES[session.role]?.color}}>{session.username}</span>
            <span style={{color:'var(--text-tertiary)'}}> · {tr(ROLES[session.role]?.label)}</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={onLogout}>{tr("登出")}</button>
      </div>

      <div style={ss.tabBar}>
        {TABS.filter(t=>!isSharedStore||['general','business','audit'].includes(t.key)||t.key==='backup'&&session.role==='owner').map(({key,label,Icon})=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            ...ss.tab,
            background: tab===key?'var(--bg-active)':'transparent',
            color: tab===key?'var(--text-primary)':'var(--text-tertiary)',
            borderBottom:`2px solid ${tab===key?'var(--gold)':'transparent'}`,
          }}>
            <Icon size={14}/>{tr(label)}
          </button>
        ))}
      </div>

      <div style={{flex:1, overflow:'hidden', paddingTop:16}}>
        {tab==='general'  && <GeneralTab  session={session}/>}
        {tab==='business' && <BusinessTab session={session} store={store}/>}
        {tab==='users'    && <UsersTab    session={session}/>}
        {tab==='hardware' && <HardwareTab session={session}/>}
        {tab==='security' && <SecurityTab session={session}/>}
        {tab==='backup'   && <BackupTab   session={session} store={store}/>}
        {tab==='cloud'    && <Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><CloudSyncTab session={session}/></Suspense>}
        {tab==='webhook'  && <WebhookTab  session={session}/>}
        {tab==='audit'    && <AuditTab    session={session}/>}
      </div>
    </div>
  )
}
