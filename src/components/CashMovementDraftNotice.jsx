import {tr,trMessage} from '../i18n'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/cash-movement-draft.css'
export default function CashMovementDraftNotice({draft,active=false,saving=false,error='',run=work=>work()}){
 return <div className="cash-movement-draft" data-cash-movement-draft><WorkspaceDraftNotice draft={draft.workspace}/>{draft.message&&draft.message!==error&&<p role="status">{trMessage(draft.message)}</p>}{!active&&draft.resumable&&<button type="button" className="btn btn-primary" data-cash-movement-resume disabled={draft.blocked||saving} onClick={()=>run(draft.resume)}>{tr('繼續記現金進出')}</button>}{active&&draft.stale&&!draft.pending&&<button type="button" className="btn btn-ghost" data-cash-movement-rebind disabled={draft.blocked||saving} onClick={()=>run(draft.rebind)}>{tr('改記到目前班次')}</button>}{draft.canDiscard&&<details data-cash-movement-options><summary>{tr('草稿選項')}</summary><button type="button" className="btn btn-ghost" data-cash-movement-discard disabled={draft.blocked||saving} onClick={draft.discard}>{tr('放棄這次輸入')}</button></details>}</div>
}
