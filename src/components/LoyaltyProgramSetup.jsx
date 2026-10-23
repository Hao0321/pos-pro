import {useEffect,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {getLoyaltyProgramPreview} from '../utils/dataAccess'
import useLoyaltyProgramSetup from '../hooks/useLoyaltyProgramSetup'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/loyalty-program.css'
export default function LoyaltyProgramSetup({session,store}){return session?.role==='owner'?<Loader key={session.userId+':'+session.role} session={session} store={store}/>:<p>{tr('請用店主帳號設定會員福利。')}</p>}
function Loader({session,store}){const[data,setData]=useState(null),[error,setError]=useState('');useEffect(()=>{let alive=true;getLoyaltyProgramPreview({},session).then(value=>{if(alive)setData(value)}).catch(error=>{if(alive)setError(error.message)});return()=>{alive=false}},[session.userId,session.role]);return data?<Editor session={session} initial={data} store={store}/>:<div className="loyalty-program" role={error?'alert':'status'}>{trMessage(error)||tr('正在讀取會員福利…')}</div>}
function Editor({session,initial,store}){
 const d=useLoyaltyProgramSetup({session,initial,onSaved:async value=>{await store?.refreshLoyaltyRules?.(value.current)}}),p=d.preview,form=d.state.form
 return <div className="loyalty-program" data-loyalty-setup><h3>{tr('會員福利')}</h3><p className="loyalty-current" data-loyalty-current>{tr('目前：每 {0} 元集 1 點，1 點折 {1} 元。',{0:p.current.earn,1:p.current.redeem})}</p><WorkspaceDraftNotice draft={d.workspace}/>{d.message&&<p role="status">{trMessage(d.message)}</p>}{d.error&&<p role="alert">{trMessage(d.error)}</p>}
  <fieldset disabled={d.locked}><legend>{tr('選一種集點方式')}</legend><div className="loyalty-presets">{[100,50].map(earn=><button type="button" className="btn btn-ghost" key={earn} data-loyalty-preset={earn} aria-pressed={Number(form.earn)===earn} onClick={()=>d.change('earn',String(earn))}>{tr('每 {0} 元集 1 點',{0:earn})}</button>)}</div>
  <p className="loyalty-label">{tr('生日當月首次消費，加送幾點？')}</p><div className="loyalty-birthday-presets">{[0,20,100].map(bonus=><button type="button" className="btn btn-ghost" key={bonus} data-loyalty-birthday={bonus} aria-label={tr(bonus===0?'不加送':'{0} 點',{0:bonus})} aria-pressed={Number(form.birthdayBonus)===bonus} onClick={()=>d.change('birthdayBonus',String(bonus))}>{bonus}</button>)}</div></fieldset>
  {p.valueLocked&&Number(form.redeem)!==p.current.redeem&&<button type="button" className="btn btn-ghost" data-loyalty-use-current disabled={d.locked} onClick={d.useCurrentPointValue}>{tr('採用目前點值')}</button>}
  {!d.busy&&p.allowed&&<div className="loyalty-example" data-loyalty-example><strong>{tr('消費 NT$ {0} → {1} 點',{0:p.example.spend,1:p.example.earned})}</strong><p>{tr('這些點數之後可折 NT$ {0}',{0:p.example.rewardValue})}</p>{p.program.birthdayBonus>0&&<p>{tr('生日當月首次消費 → 共 {0} 點',{0:p.example.birthdayEarned})}</p>}</div>}
  <button type="button" className="btn btn-primary" data-loyalty-save disabled={!d.canSave} onClick={d.save}>{tr(d.running?'保存中…':d.pending?d.retryAllowed?'再次確認這個方案':'核對上次設定':'確認啟用')}</button>
  <details data-loyalty-custom><summary>{tr('自訂數字')}</summary><fieldset disabled={d.locked}>{[['earn','每幾元集 1 點'],['redeem','1 點折幾元'],['birthdayBonus','生日加送點數']].map(([key,label])=><label key={key}>{tr(label)}<input className="field" data-loyalty-field={key} aria-label={tr(label)} inputMode="decimal" value={form[key]} disabled={key==='redeem'&&p.valueLocked} onChange={e=>d.change(key,e.target.value)}/></label>)}{p.valueLocked&&<p>{tr('已發點數的折抵價值會保留。')}</p>}</fieldset></details>
 </div>
}
