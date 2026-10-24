import LoyaltyProgramSetup from '../../components/LoyaltyProgramSetup'
import {tr,trMessage} from "../../i18n"
import { useState, useEffect, useRef } from "react"
import { Gift } from "lucide-react"
import { getSetting, setSetting, setSettings } from "../../utils/dataAccess"
import DisplayPreferences from '../../components/DisplayPreferences'
import { Section, FieldLabel } from "./controls.jsx"

export function GeneralTab({ session }) {
  const saving=useRef(false)
  const [salesGoal, setSalesGoal] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    getSetting('dailySalesGoal').then(v => setSalesGoal(v??'')).catch(e=>setSavedMsg('讀取未完成：'+e.message))
  }, [])

  async function saveGoal() {
    if(saving.current)return;saving.current=true
    try{
      const value=Number(salesGoal||0);if(!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*100-Math.round(value*100))>1e-6)throw Error('目標金額須為有效金額，最多兩位小數')
      const result=await setSettings({dailySalesGoal:String(value)})
      if(result?.success!==true)throw Error(result?.error||'未收到保存回覆')
      setSavedMsg('已儲存');setTimeout(()=>setSavedMsg(''),2000)
    }catch(e){setSavedMsg('保存未完成：'+e.message)}finally{saving.current=false}
  }

  return (
    <div style={{padding:'0 24px', overflowY:'auto', height:'100%'}}>
      <Section title={tr("語言與外觀")}><DisplayPreferences/></Section>

      <Section title={tr("每日銷售目標")}>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{fontSize:13, color:'var(--text-secondary)', minWidth:60}}>{tr("目標金額")}</span>
          <input className="field" type="number" value={salesGoal} onChange={e=>setSalesGoal(e.target.value)} placeholder={tr("例：30000")} style={{flex:1, maxWidth:200}}/>
          <span style={{fontSize:13, color:'var(--text-tertiary)'}}>NT$</span>
          <button className="btn btn-primary btn-sm" onClick={saveGoal}>{tr("儲存")}</button>
          {savedMsg && <span style={{fontSize:12, color:'var(--green)'}}>{trMessage(savedMsg)}</span>}
        </div>
        <p style={{fontSize:12, color:'var(--text-tertiary)', marginTop:8}}>{tr("設定後會在首頁儀表板顯示達成進度")}</p>
      </Section>

      <Section title={tr("鍵盤快捷鍵")}>
        <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:2}}>
          <div><kbd style={kbdStyle}>F1</kbd>{tr(" 快速查價")}</div>
          <div><kbd style={kbdStyle}>F2</kbd>{tr(" 掛單")}</div>
          <div><kbd style={kbdStyle}>F3</kbd>{tr(" 取單列表")}</div>
          <div><kbd style={kbdStyle}>Esc</kbd>{tr(" 關閉對話框")}</div>
        </div>
      </Section>
    </div>
  )
}

export function BusinessTab({session,store}){return <LoyaltyProgramSetup session={session} store={store}/>}

export const kbdStyle = {
  fontFamily:'var(--font-mono)', fontSize:11, padding:'2px 8px',
  background:'var(--bg-overlay)', borderRadius:4, color:'var(--text-secondary)',
  border:'1px solid var(--border-dim)', marginRight:8,
}
