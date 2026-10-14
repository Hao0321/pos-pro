import {useRef,useState,useEffect} from 'react'
import {BookOpen,ChefHat,Check,ArrowRight} from 'lucide-react'
import {scenarioTemplates,applyScenarioTemplate,loadScenarioTemplateReceipt} from '../utils/scenarioTemplates'
const PENDING_KEY='pos_donburi_template_pending_v1'
function pendingTemplate(){try{return JSON.parse(localStorage.getItem(PENDING_KEY)||'null')}catch{return null}}

export default function ScenarioTemplatesPage({session,store}){
  const template=scenarioTemplates[0]
  const [pending]=useState(pendingTemplate)
  const [tab,setTab]=useState('catalog'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null)
  const [values,setValues]=useState(Object.fromEntries(template.products.map(p=>[p.key,pending?.items?.[p.key]?Object.fromEntries(Object.entries(pending.items[p.key]).map(([k,v])=>[k,String(v)])):{price:String(p.examplePrice),cost:'',stock:'0'}])))
  const operationId=useRef(pending?.operationId||null),submitting=useRef(false)
  useEffect(()=>{let active=true;loadScenarioTemplateReceipt(template.id,session).then(value=>{if(active&&value)setReceipt(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[template.id,session])
  const update=(key,field,value)=>{operationId.current=null;setValues(v=>({...v,[key]:{...v[key],[field]:value}}))}
  async function apply(event){
    event.preventDefault();if(submitting.current)return
    setError('');submitting.current=true;setBusy(true)
    try{
      const items=Object.fromEntries(template.products.map(p=>{
        const row=values[p.key]
        if(Object.values(row).some(v=>v.trim()===''))throw Error('請填寫每個品項的售價、單份成本與可售數量；成本尚未確定時可先用試賣演練')
        return [p.key,Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v)]))]
      }))
      operationId.current ||= 'scenario_'+crypto.randomUUID()
      const input={templateId:template.id,operationId:operationId.current,items}
      localStorage.setItem(PENDING_KEY,JSON.stringify(input))
      const result=await applyScenarioTemplate(input,session)
      if(!result?.success || result.operationId!==operationId.current || result.productIds?.length!==template.products.length)throw Error('套用結果尚未確認，請保留本頁並以相同設定重試')
      setReceipt(result)
      try{localStorage.removeItem(PENDING_KEY)}catch{}
      try{await store?.reloadFromDB();window.dispatchEvent(new Event('pos-data-refreshed'))}catch(e){setError('菜單已保存，但重新讀取未完成；請重新載入：'+e.message)}
    }catch(e){setError(e.message)}finally{submitting.current=false;setBusy(false)}
  }
  return <section style={{padding:24,height:'100%',overflowY:'auto'}}>
    <div style={{maxWidth:1080,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}><BookOpen size={24}/><h2 style={{fontSize:22,margin:0}}>情境模板</h2><span className="badge badge-green">全部免費</span></div>
      <p style={{color:'var(--text-secondary)',lineHeight:1.7}}>從自己的生意開始設定。第一個模板：一般丼飯外帶，支援後續擴充更多店型。</p>
      <div style={{display:'flex',gap:8,margin:'20px 0',flexWrap:'wrap'}}>
        <button className={'btn '+(tab==='catalog'?'btn-primary':'btn-ghost')} style={{color:tab==='catalog'?'#fff':'var(--text-primary)'}} onClick={()=>setTab('catalog')}>套用菜單</button>
        <button className={'btn '+(tab==='rehearsal'?'btn-primary':'btn-ghost')} style={{color:tab==='rehearsal'?'#fff':'var(--text-primary)'}} onClick={()=>setTab('rehearsal')}><ChefHat size={16}/>試賣演練</button>
      </div>
      {tab==='rehearsal'?<>
        <p style={{color:'var(--text-secondary)',lineHeight:1.7}}>這裡試跑預訂、現場、外送、限量與備料；演練紀錄與正式收銀分開。</p>
        <iframe title="丼飯試賣演練" src="./scenarios/donburi/index.html" style={{width:'100%',height:820,border:'1px solid var(--border-subtle)',borderRadius:16}} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"/>
      </>:<div className="card" style={{padding:24}}>
        <h3 style={{margin:'0 0 8px',fontSize:20}}>{template.name}</h3>
        <p style={{color:'var(--text-secondary)',lineHeight:1.7}}>先填實際售價、單份食材與包材成本，以及目前可售的成品碗／杯數。下方售價只是範例，可自行修改。</p>
        {receipt?<div role="status" style={{padding:20,background:'var(--green-dim)',borderRadius:12}}>
          <Check size={22}/><h3>丼飯菜單已保存</h3><p>已新增豬肉丼、牛肉丼與冬瓜茶；既有商品、帳號及交易都保留。</p>
          <button className="btn btn-primary" onClick={()=>location.reload()}>重新載入，開始使用<ArrowRight size={16}/></button>
        </div>:<form onSubmit={apply}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,margin:'24px 0'}}>
            {template.products.map(p=><div key={p.key} style={{padding:18,border:'1px solid var(--border-subtle)',borderRadius:12}}>
              <h4 style={{margin:'0 0 16px'}}>{p.name}</h4>
              {[['price','售價（元）','0.01'],['cost','單份成本（元）','0.01'],['stock',`目前可售（${p.unit}）`,'1']].map(([field,label,step])=><label key={field} style={{display:'block',marginBottom:12,fontSize:13,color:'var(--text-secondary)'}}>{label}<input className="field" type="number" min={field==='price'?'0.01':'0'} max="1000000" step={step} required value={values[p.key][field]} onChange={e=>update(p.key,field,e.target.value)} disabled={busy} style={{display:'block',width:'100%',marginTop:6}}/></label>)}
            </div>)}
          </div>
          {error&&<p role="alert" style={{color:'var(--red)',lineHeight:1.6}}>{error}</p>}
          <button className="btn btn-primary" disabled={busy}>{busy?'正在保存菜單…':'新增丼飯菜單'}</button>
        </form>}
        <div style={{marginTop:24,padding:16,background:'var(--bg-base)',borderRadius:12,fontSize:13,color:'var(--text-secondary)',lineHeight:1.8}}>
          套用後可使用收銀、成品庫存、班別與報表。從「預訂出餐」確認產能與原料配方，即可正式接單、備餐與交付；本頁的試賣演練另行保存。套餐可先將丼飯與冬瓜茶一起加入購物車。
        </div>
      </div>}
    </div>
  </section>
}
