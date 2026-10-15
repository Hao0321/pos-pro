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

export function BusinessTab({ session, store }) {
  const saving=useRef(false)
  const [earn, setEarn] = useState(10)
  const [redeem, setRedeem] = useState(1)
  const [birthdayBonus, setBirthdayBonus] = useState(100)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    getSetting('pointsEarnRate').then(v => setEarn(v==null?10:Number(v))).catch(e=>setSavedMsg('讀取未完成：'+e.message))
    getSetting('pointsRedeemRate').then(v => setRedeem(v==null?1:Number(v))).catch(e=>setSavedMsg('讀取未完成：'+e.message))
    getSetting('birthdayBonus').then(v => setBirthdayBonus(v==null?100:Number(v))).catch(e=>setSavedMsg('讀取未完成：'+e.message))
  }, [])

  async function save() {
    if(saving.current)return;saving.current=true
    try{
    if(store?.updateBusinessSettings){await store.updateBusinessSettings(earn,redeem,birthdayBonus)}else{
    if (store?.updatePointsRule) {
      await store.updatePointsRule(parseInt(earn) || 10, parseFloat(redeem) || 1)
    } else {
      await setSetting('pointsEarnRate', String(earn))
      await setSetting('pointsRedeemRate', String(redeem))
    }
    if (store?.updateBirthdayBonus) {
      await store.updateBirthdayBonus(birthdayBonus)
    } else {
      await setSetting('birthdayBonus', String(birthdayBonus))
    }
    }
    setSavedMsg('已儲存')
    setTimeout(() => setSavedMsg(''), 2000)
    }catch(e){setSavedMsg('保存未完成：'+e.message)}finally{saving.current=false}
  }

  return (
    <div style={{padding:'0 24px', overflowY:'auto', height:'100%'}}>
      <Section title={tr("會員點數規則")}>
        <div style={{padding:'16px 18px', background:'var(--gold-glow)', border:'1px solid var(--gold-dim)', borderRadius:8, marginBottom:14}}>
          <div style={{fontSize:13, fontWeight:600, marginBottom:10, color:'var(--gold-bright)'}}>
            <Gift size={14} style={{verticalAlign:'middle', marginRight:6}}/>{tr("目前規則")}</div>
          <div style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.8}}>
            <div>{tr("• 消費每 NT$ ")}<strong style={{color:'var(--gold)'}}>{earn}</strong>{tr(" 元 → 獲得 1 點")}</div>
            <div>{tr("• 1 點 → 折抵 NT$ ")}<strong style={{color:'var(--gold)'}}>{redeem}</strong>{tr(" 元")}</div>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <FieldLabel>{tr("消費 X 元 = 1 點")}</FieldLabel>
            <input className="field" type="number" value={earn} onChange={e=>setEarn(e.target.value)}/>
          </div>
          <div>
            <FieldLabel>{tr("1 點折抵金額 (元)")}</FieldLabel>
            <input className="field" type="number" step="0.5" value={redeem} onChange={e=>setRedeem(e.target.value)}/>
          </div>
        </div>
      </Section>

      <Section title={tr("會員生日贈點")}>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{fontSize:13, color:'var(--text-secondary)', minWidth:140}}>{tr("生日當月可獲得")}</span>
          <input className="field" type="number" value={birthdayBonus} onChange={e=>setBirthdayBonus(e.target.value)} style={{width:120}}/>
          <span style={{fontSize:13, color:'var(--text-tertiary)'}}>{tr("點")}</span>
        </div>
        <p style={{fontSize:12, color:'var(--text-tertiary)', marginTop:8}}>{tr("會員在生日當月首次消費時自動加贈")}</p>
      </Section>

      <button className="btn btn-primary" onClick={save} style={{padding:'10px 24px'}}>{tr("儲存設定")}</button>
      {savedMsg && <span style={{marginLeft:12, fontSize:13, color:'var(--green)'}}>{trMessage(savedMsg)}</span>}
    </div>
  )
}

export const kbdStyle = {
  fontFamily:'var(--font-mono)', fontSize:11, padding:'2px 8px',
  background:'var(--bg-overlay)', borderRadius:4, color:'var(--text-secondary)',
  border:'1px solid var(--border-dim)', marginRight:8,
}
