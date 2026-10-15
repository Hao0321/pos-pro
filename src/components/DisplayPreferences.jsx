import {useEffect,useRef,useState} from 'react'
import {Languages,Palette,Check,ChevronDown} from 'lucide-react'
import {useDisplayPreferences,tr} from '../i18n'
import {LOCALES,setDisplayPreferences} from '../../public/i18n/preferences.mjs'
import {getTheme,applyTheme} from '../utils/theme'

const styles=[
  {id:'simple',title:'明亮簡約',description:'白底、柔和藍色，日常操作更清楚。'},
  {id:'poster',title:'海報風格',description:'鈷藍、黑與米白，保留海報設計感。'},
]
const shortLocale={'zh-TW':'繁','en':'EN','ja':'日','zh-CN':'简'}

export default function DisplayPreferences({compact=false,toolbar=false}){
  const prefs=useDisplayPreferences(),[warning,setWarning]=useState(''),[theme,setTheme]=useState(getTheme)
  const details=useRef(null)
  useEffect(()=>{const changed=e=>setTheme(e.detail);window.addEventListener('pos-theme-changed',changed);return()=>window.removeEventListener('pos-theme-changed',changed)},[])
  useEffect(()=>{
    if(!toolbar)return
    function outside(event){if(details.current?.open&&!details.current.contains(event.target))details.current.open=false}
    function escape(event){if(event.key==='Escape'&&details.current?.open){event.preventDefault();details.current.open=false;details.current.querySelector('summary')?.focus()}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[toolbar])
  function change(update){const result=setDisplayPreferences(update);setWarning(result.persisted?'':'這次已切換；這台裝置無法記住偏好，下次開啟需重新選擇。')}
  function changeTheme(value){try{applyTheme(value);setTheme(value);setWarning('')}catch{setTheme(value);setWarning('這次已切換；這台裝置無法記住偏好，下次開啟需重新選擇。')}}
  const controls=<div className="display-preference-fields">
    <label><span><Languages size={16} aria-hidden="true"/>{tr('語言')}</span><select className="field" data-display-locale aria-label={tr('顯示語言')} value={prefs.locale} onChange={e=>change({locale:e.target.value})}>{LOCALES.map(row=><option key={row.id} value={row.id} lang={row.id}>{row.name}</option>)}</select></label>
    {compact&&!toolbar?<label><span><Palette size={16} aria-hidden="true"/>{tr('介面風格')}</span><select className="field" data-display-style aria-label={tr('介面風格')} value={prefs.style} onChange={e=>change({style:e.target.value})}><option value="poster">{tr('海報風格')}</option><option value="simple">{tr('明亮簡約')}</option></select></label>:<fieldset className="display-style-picker" data-display-style><legend>{tr('介面風格')}</legend><div className="display-style-options">{styles.map(style=><button type="button" key={style.id} data-style-choice={style.id} className="display-style-option" aria-pressed={prefs.style===style.id} onClick={()=>change({style:style.id})}><span aria-hidden="true" className={'display-style-sample display-style-sample-'+style.id}><i/><span><b/><b/><em/></span></span><span className="display-style-label"><strong>{tr(style.title)}</strong>{prefs.style===style.id&&<Check size={17} aria-hidden="true"/>}</span><small>{tr(style.description)}</small></button>)}</div></fieldset>}
    {prefs.style==='poster'&&<label><span>{tr('明暗')}</span><select className="field" aria-label={tr('明暗模式')} value={theme} onChange={e=>changeTheme(e.target.value)}><option value="light">{tr('淺色模式')}</option><option value="dark">{tr('深色模式')}</option></select></label>}
    {warning&&<p role="status">{tr(warning)}</p>}
  </div>
  if(toolbar)return <details ref={details} className="display-preferences display-preferences-toolbar" data-mobile-display onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false}}><summary aria-label={tr('語言與外觀')}><Languages size={19} aria-hidden="true"/><span>{shortLocale[prefs.locale]}</span><ChevronDown size={14} aria-hidden="true"/></summary><div className="display-preference-popover">{controls}<p className="display-preference-note">{tr('只改這台裝置的顯示方式；店面幣別、價格與資料維持原設定。')}</p></div></details>
  return compact?<details className="display-preferences display-preferences-compact"><summary><Languages size={18} aria-hidden="true"/><span>{LOCALES.find(row=>row.id===prefs.locale)?.name}</span><ChevronDown size={14} aria-hidden="true"/></summary>{controls}</details>:<section className="display-preferences" aria-label={tr('語言與外觀')}>{controls}<p className="display-preference-note">{tr('只改這台裝置的顯示方式；店面幣別、價格與資料維持原設定。')}</p></section>
}
