import {useEffect,useState,lazy,Suspense} from 'react'
import StocktakePage from './StocktakePage'
import {loadLotState} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import {tr,trMessage} from '../i18n'
const LotCountPage=lazy(()=>import('./LotCountPage'))
export default function StocktakeRouter({store,session}){
 const [state,setState]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{let alive=true;setError('');loadLotState(session).then(value=>{if(alive)setState(value)}).catch(cause=>{if(alive)setError(cause.message)});return()=>{alive=false}},[session.userId,session.role,reload])
 let original=null;try{original=readPendingFinancial()}catch{}
 const countOriginal=original?.kind==='lots'&&original.request.action==='count',legacyOriginal=original?.kind==='stocktake'
 if(!state)return <section className="physical-count-page">{error?<><p role="alert">{trMessage(error)}</p><button className="btn" onClick={()=>setReload(n=>n+1)}>{tr('重新讀取')}</button></>:<p role="status">{tr('正在讀取盤點資料…')}</p>}</section>
 return state.active&&!legacyOriginal||countOriginal?<Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><LotCountPage store={store} session={session}/></Suspense>:<StocktakePage store={store} session={session}/>
}
