import {tr,trMessage} from '../i18n'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/shift-count-draft.css'
export default function ShiftCountDraftNotice({draft,active=false,busy=false,run,error=''}){
 return <div className="shift-count-draft" data-shift-count-draft><WorkspaceDraftNotice draft={draft.workspace}/>{draft.message&&draft.message!==error&&<p role="status">{trMessage(draft.message)}</p>}{!active&&draft.resumable&&<button className="btn btn-primary" type="button" data-shift-count-resume disabled={busy||draft.blocked} onClick={()=>run(draft.resume)}>{tr('繼續點算現金')}</button>}{active&&draft.stale&&draft.canDiscard&&<button className="btn btn-primary" type="button" data-shift-count-recount disabled={busy} onClick={()=>run(draft.recount)}>{tr('重新點算')}</button>}</div>
}
export function ShiftCountDraftOptions({draft,busy=false}){return draft.resumable&&draft.canDiscard&&<details className="shift-count-draft" data-shift-count-options><summary>{tr('點算選項')}</summary><button type="button" className="btn btn-ghost" data-shift-count-discard disabled={busy||draft.blocked} onClick={draft.discard}>{tr('放棄這次點算')}</button></details>}
