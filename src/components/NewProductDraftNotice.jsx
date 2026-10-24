import {tr,trMessage} from '../i18n'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/new-product-draft.css'
export default function NewProductDraftNotice({draft,active=false,saving=false}){
 return <div className="new-product-draft" data-new-product-draft><WorkspaceDraftNotice draft={{...draft.workspace,notice:''}}/>{!active&&draft.message&&<p role="status">{trMessage(draft.message)}</p>}{active?<p>{tr('按「儲存」才會建立商品。')}</p>:draft.resumable&&<button type="button" className="btn btn-primary" data-new-product-resume disabled={draft.blocked||saving} onClick={draft.resume}>{tr('繼續填商品')}</button>}{!active&&<NewProductDraftActions draft={draft} saving={saving}/>}</div>
}
export function NewProductDraftActions({draft,saving=false}){return draft.resumable&&<details className="new-product-draft" data-new-product-options><summary>{tr('草稿選項')}</summary><button type="button" className="btn btn-ghost" data-new-product-discard disabled={draft.blocked||saving} onClick={draft.discard}>{tr('放棄這次輸入')}</button></details>}
