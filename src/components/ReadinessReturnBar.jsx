import {tr} from '../i18n'
import {readinessTaskFor} from '../utils/openingGuide.mjs'
import '../styles/opening-guide.css'
export default function ReadinessReturnBar({store,session,view}){
 const task=store.readinessTask;if(!readinessTaskFor(task,session,view))return null
 return <aside className="opening-return" data-opening-return><span>{tr('完成這一步後，會重新核對店裡的資料。')}</span><button type="button" className="btn btn-ghost" onClick={()=>store.finishReadinessTask(task.id)}>{tr('回到營業前檢查')}</button></aside>
}
