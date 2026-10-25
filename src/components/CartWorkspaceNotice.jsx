import {tr,trMessage} from '../i18n'
import '../styles/held-cart.css'
export default function CartWorkspaceNotice({workspace,view}){
 if(!workspace||view!=='pos'&&!workspace.pending)return null
 const {ready,waiting,error,notice,pending,saving}=workspace
 if(ready&&!error&&!notice&&!pending)return null
 return <section className="cart-workspace-notice" role={pending||error?'alert':'status'} data-cart-workspace-notice data-cart-ready={ready} aria-busy={saving}>
  <div><strong>{tr(pending?'先找回剛才那張單':waiting?'購物車正在另一個視窗使用':!ready?'正在接回購物車…':'原購物車還在')}</strong>
   <p>{trMessage(error||notice||(waiting?'請先關閉另一個收銀視窗，再接著操作。':'請稍候，原內容仍保留。'))}</p></div>
  {pending?<div className="held-cart-actions"><button className="btn btn-primary" data-held-check disabled={saving} onClick={()=>workspace.recover().catch(()=>{})}>{tr(saving?'正在核對…':'核對上次結果')}</button><details><summary>{tr('查看原單資訊')}</summary><code>{pending.id}</code><button className="btn btn-ghost" data-held-retry disabled={saving} onClick={()=>workspace.recover(true).catch(()=>{})}>{tr('沿用原編號繼續')}</button></details></div>:!ready&&!waiting?<div className="held-cart-actions"><button className="btn btn-primary" onClick={workspace.recheck}>{tr('重新核對購物車')}</button>{workspace.rawAvailable&&<button className="btn btn-ghost" onClick={workspace.download}>{tr('保留原購物車檔案')}</button>}</div>:null}
 </section>
}
