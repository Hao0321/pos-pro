import {tr} from '../../i18n'
import {customerDraftRequest} from '../../utils/customerDraftReceipt.mjs'
export default function CustomerDirectoryForm({draft,setDraft,onSave,onHide,busy,error}){
  const update=(key,value)=>setDraft(previous=>({...previous,customer:{...previous.customer,[key]:value}}))
  return <section className="card customer-form"><h2>{tr(draft.action==='customer-create'?'新增往來客戶':'編輯客戶資料')}</h2><p>{tr('名稱相同也會保留各自身份，款項不會自動合併。')}</p><form onSubmit={event=>{event.preventDefault();onSave(customerDraftRequest(draft))}}><fieldset disabled={busy}>
    <label>{tr('客戶名稱')}<input autoFocus className="field" data-customer-name value={draft.customer.name} maxLength={100} onChange={e=>update('name',e.target.value)} required/></label>
    <label>{tr('電話')}<input className="field" type="tel" data-customer-phone value={draft.customer.phone||''} maxLength={300} onChange={e=>update('phone',e.target.value)} autoComplete="tel"/></label>
    <details><summary>{tr('更多客戶資料')}</summary>{[['contact','聯絡人'],['email','Email'],['address','地址'],['note','備註']].map(([key,label])=><label key={key}>{tr(label)}<input className="field" value={draft.customer[key]||''} maxLength={key==='note'?1000:300} onChange={e=>update(key,e.target.value)}/></label>)}<p>{tr('客戶代碼')}：<span className="customer-id">{draft.customer.id}</span></p></details>
    {error&&<p role="alert">{error}</p>}<div className="customer-actions"><button type="button" className="btn btn-ghost" onClick={onHide}>{tr('先收起草稿')}</button><button className="btn btn-primary" data-customer-save type="submit">{busy?tr('保存中…'):tr('保存客戶資料')}</button></div>
  </fieldset></form></section>
}
