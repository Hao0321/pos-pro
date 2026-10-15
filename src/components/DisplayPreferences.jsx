import {useEffect,useState} from 'react'
import {Languages,Palette} from 'lucide-react'
import {useDisplayPreferences,tr} from '../i18n'
import {LOCALES,setDisplayPreferences} from '../../public/i18n/preferences.mjs'
import {getTheme,applyTheme} from '../utils/theme'

export default function DisplayPreferences({compact=false}){
  const prefs=useDisplayPreferences(),[warning,setWarning]=useState(''),[theme,setTheme]=useState(getTheme)
  useEffect(()=>{const changed=e=>setTheme(e.detail);window.addEventListener('pos-theme-changed',changed);return()=>window.removeEventListener('pos-theme-changed',changed)},[])
  function change(update){const result=setDisplayPreferences(update);setWarning(result.persisted?'':'這次已切換；這台裝置無法記住偏好，下次開啟需重新選擇。')}
  function changeTheme(value){try{applyTheme(value);setTheme(value);setWarning('')}catch{setTheme(value);setWarning('這次已切換；這台裝置無法記住偏好，下次開啟需重新選擇。')}}
  const controls=<div className="display-preference-fields">
    <label><span><Languages size={16} aria-hidden="true"/>{tr('語言')}</span><select className="field" data-display-locale aria-label={tr('顯示語言')} value={prefs.locale} onChange={e=>change({locale:e.target.value})}>{LOCALES.map(row=><option key={row.id} value={row.id} lang={row.id}>{row.name}</option>)}</select></label>
    <label><span><Palette size={16} aria-hidden="true"/>{tr('介面風格')}</span><select className="field" data-display-style aria-label={tr('介面風格')} value={prefs.style} onChange={e=>change({style:e.target.value})}><option value="poster">{tr('海報風格')}</option><option value="simple">{tr('明亮簡約')}</option></select></label>
    {prefs.style==='poster'&&<label><span>{tr('明暗')}</span><select className="field" aria-label={tr('明暗模式')} value={theme} onChange={e=>changeTheme(e.target.value)}><option value="light">{tr('淺色模式')}</option><option value="dark">{tr('深色模式')}</option></select></label>}
    {warning&&<p role="status">{tr(warning)}</p>}
  </div>
  return compact?<details className="display-preferences display-preferences-compact"><summary><Languages size={18} aria-hidden="true"/><span>{LOCALES.find(row=>row.id===prefs.locale)?.name}</span><span aria-hidden="true">⌄</span></summary>{controls}</details>:<section className="display-preferences" aria-label={tr('語言與外觀')}>{controls}<p className="display-preference-note">{tr('只改這台裝置的顯示方式；店面幣別、價格與資料維持原設定。')}</p></section>
}
