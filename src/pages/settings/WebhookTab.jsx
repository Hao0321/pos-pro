import {tr} from "../../i18n"
import { useState } from "react"
import { Check, RefreshCw, Wifi } from "lucide-react"
import { writeAuditLog } from "../../utils/security"
import { getWebhookConfig, saveWebhookConfig, fireWebhook, WEBHOOK_EVENTS } from "../../utils/webhook"
import { Section, FL } from "./controls.jsx"

export function WebhookTab({ session }) {
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
            <div style={{fontWeight:600, fontSize:14}}>{tr("通知 Webhook")}</div>
            <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>{tr("關鍵事件發生時自動 POST 通知到指定 URL — 可接 Discord / Slack / Zapier / Make / 自家伺服器")}</div>
          </div>
        </div>
      </div>

      <Section title={tr("連線設定")}>
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          <div>
            <FL>Webhook URL</FL>
            <input className="field" value={url} onChange={e=>setUrl(e.target.value)}
              placeholder={tr("https://discord.com/api/webhooks/... 或 https://hooks.slack.com/... 或自家 URL")}
              style={{fontFamily:'var(--font-mono)', fontSize:12}}/>
            <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4, lineHeight:1.5}}>{tr("· Discord 用：")}<strong>{tr("伺服器設定 → 整合 → Webhook → 複製 URL")}</strong><br/>{tr("· Slack 用：")}<strong>{tr("Apps → Incoming Webhooks → Add → 複製 URL")}</strong><br/>{tr("· 自家後端：自動發送 POST + JSON（含 event / timestamp / payload）")}<br/>{tr("· Zapier / Make：用「Webhook by Zapier」當觸發")}</div>
          </div>
        </div>
      </Section>

      <Section title={tr("觸發事件")}>
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
                    {tr(ev.label)}
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
          <Check size={14}/>{tr("儲存設定")}</button>
        <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={!url || testing}>
          {testing ? <RefreshCw size={14} className="spin"/> : <Wifi size={14}/>}{tr("測試送出")}</button>
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
