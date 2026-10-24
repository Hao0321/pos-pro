import {tr,trMessage} from '../i18n'
export default function WorkspaceDraftNotice({draft}){
 const message=draft.error||draft.warning||(draft.waiting?'草稿正在另一個視窗使用，離開該頁後會自動接回。':draft.notice)
 if(!message)return null
 const button={minHeight:48,fontSize:18,marginTop:8,display:'block',whiteSpace:'normal'}
 return <div data-workspace-draft-notice role={draft.error||draft.warning?'alert':'status'} className="workspace-draft-notice" style={{margin:'12px 0',padding:12,border:'1px solid var(--border-dim)',borderRadius:12,lineHeight:1.6}}>{trMessage(message)}{(draft.error||draft.warning)&&<button type="button" className="btn btn-ghost" style={button} onClick={draft.recheck}>{tr('重新核對草稿')}</button>}{draft.error&&draft.rawAvailable&&<><button type="button" className="btn btn-ghost" style={button} onClick={draft.download}>{tr('下載原草稿')}</button>{draft.canReset&&<button type="button" className="btn btn-ghost" data-workspace-draft-reset style={button} onClick={draft.reset}>{tr('清除這張未完成草稿')}</button>}</>}</div>
}
