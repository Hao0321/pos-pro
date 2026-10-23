import {deviceChecks} from './deviceReadiness'
import {restaurantAvailability} from '../../electron/restaurantRules.mjs'

export function recentOpeningBackup(row,now=Date.now()){
 const time=Date.parse(row?.createdAt),age=now-time
 return !!row&&typeof row.id==='string'&&Number.isFinite(time)&&age>=0&&age<86400000
}
export function openingGuide(snapshot,{ready=true,dataError='',pending=false,pendingError='',canEdit=false,canCost=false,canBackup=false,owner=false,stockSetupEnabled=false,backupIssue='',checking=false,now=Date.now()}={}){
 const waiting={kind:'checking',title:'正在核對店裡的資料…',detail:'請稍候，會依實際資料顯示下一步。',label:'正在檢查…',action:'none',disabled:true,canOperate:false,checks:[]}
 if(checking||!ready||!snapshot)return waiting
 const checks=[]
 const result=(kind,title,detail,label,action,extra={})=>({kind,title,detail,label,action,disabled:action==='none',canOperate:false,checks,...extra})
 if(dataError)return result('problem','資料需要先核對','請先核對原資料，再繼續準備。',owner?'一步一步找回資料':'請店主協助這一步。',owner?'recovery':'none')
 if(snapshot.error)return result('problem','資料還沒確認','請重新檢查，原資料會保留。','重新檢查','inspect')
 if(!Array.isArray(snapshot.products)||!snapshot.restaurantConfig||!snapshot.device)return result('problem','資料還沒確認','請重新檢查，原資料會保留。','重新檢查','inspect')
 checks.push(...deviceChecks(snapshot.device))
 checks.push({id:'pending',status:pending||pendingError?'blocked':'pass',title:'上一筆款項',detail:pending||pendingError?'請先核對上一筆結果，避免重做或再次收款。':'沒有待確認的收款、退款或儲值紀錄。'})
 const products=snapshot.products,invalid=products.filter(p=>!p||typeof p.id!=='string'||!Number.isFinite(p.stock)||p.stock<0||!Number.isFinite(p.price)||p.price<0)
 let available=[]
 try{if(!invalid.length)available=products.filter(p=>restaurantAvailability(p,snapshot.restaurantConfig,products)>0&&p.price>=0)}catch{return result('problem','資料需要先核對','商品與配方資料還沒確認，請保留原資料核對。',owner?'一步一步找回資料':'請店主協助這一步。',owner?'recovery':'none')}
 const costs=available.filter(p=>!Number.isFinite(p.cost)||p.cost<=0),free=available.some(p=>p.price===0)
 checks.push({id:'catalogue',status:invalid.length?'blocked':available.length&&!free?'pass':'review',title:'可售品項',detail:invalid.length?'售價或數量需要先核對。':free?'有商品售價是 0，請確認是否免費。':available.length?'已有售價與可售量，可以繼續準備。':'先加入要賣的商品與實際數量。'})
 checks.push({id:'cost',status:!available.length||costs.length?'review':'pass',title:'成本與毛利',detail:!available.length?'先有可售商品，再核對成本與毛利。':costs.length?'有商品的成本為空白或零，請確認後再看毛利。':'可售品項已填正數成本。'})
 const shift=snapshot.openShift,shiftValid=shift===null||shift===undefined||typeof shift==='object'&&typeof shift.id==='string'&&shift.status==='open'&&Number.isFinite(shift.openCash)&&shift.openCash>=0
 checks.push({id:'shift',status:!shiftValid?'blocked':shift?'pass':'review',title:'開班與交班',detail:!shiftValid?'班別資料還沒確認，請先核對。':shift?'目前已開班，收攤時核對實際現金。':'先確認零用金並開班，才能正式結帳。'})
 if(canBackup){const rows=snapshot.backups,invalidBackups=!Array.isArray(rows)||rows.some(row=>!row||typeof row.id!=='string'||!Number.isFinite(Date.parse(row.createdAt))),latest=Array.isArray(rows)?rows.filter(row=>Number.isFinite(Date.parse(row?.createdAt))).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]:null;checks.push({id:'backup',status:!invalidBackups&&!snapshot.backupError&&!backupIssue&&recentOpeningBackup(latest,now)?'pass':'review',title:'本機備份紀錄',detail:snapshot.backupError||backupIssue||invalidBackups?'備份紀錄還沒確認，可重新檢查或建立一份。':latest?'已有本機備份，仍請另外下載到其他裝置。':'尚未確認本機備份，請先建立並下載。'})}
 const reminders=checks.filter(row=>row.status==='review').length
 if(pending||pendingError)return result('blocked','請先核對上一筆結果','上方的原單提示會接續原來那筆。','請先核對原單','none',{reminders})
 const blockedDevice=checks.find(row=>['transport','storage','shared-connection'].includes(row.id)&&row.status==='blocked')
 if(blockedDevice)return result('blocked','先處理保存或連線',blockedDevice.detail,'重新檢查','inspect',{reminders})
 if(!shiftValid)return result('blocked','資料需要先核對','班別資料還沒確認，請先核對。',owner?'一步一步找回資料':'請店主協助這一步。',owner?'recovery':'none',{reminders})
 if(invalid.length)return result('task','先核對商品資料','售價或數量需要先核對。',canEdit?'核對商品':'請店主協助這一步。',canEdit?'task':'none',{task:'review-product',productId:invalid[0]?.id||'',reminders})
 if(!products.length)return result('task','先加入要賣的商品','填商品名稱、單位、售價、成本與實際數量。',canEdit?'新增第一個商品':'請店主協助這一步。',canEdit?'task':'none',{task:'add-product',reminders})
 if(!available.length)return result('task','先核對可售數量','商品已有資料，先核對實際數量與售價。',stockSetupEnabled&&canCost?'核對實際庫存':'核對商品','task',{task:stockSetupEnabled&&canCost?'stocksetup':'review-product',productId:products.find(p=>p.price>0)?.id||products[0].id,reminders})
 if(!shift)return result('task','先準備找零金','數好今天抽屜的現金，再確認開班。','點算找零金並開班','task',{task:'open-shift',reminders})
 return result('ready','接著開始收銀',reminders?'還有 {0} 項提醒，可以展開查看。':'商品和開班資料已讀回，可以前往收銀台。',canBackup?'備份並開始收銀':'開始收銀',canBackup?'backup-start':'pos',{canOperate:true,reminders,values:{0:reminders}})
}

const destinations={'add-product':'inventory','review-product':'inventory','open-shift':'shifts',stocksetup:'stocksetup'}
export function createReadinessTask(kind,productId,session){
 if(!Object.hasOwn(destinations,kind)||!session?.userId||!['owner','staff'].includes(session.role)||kind==='stocksetup'&&session.role!=='owner'||typeof productId!=='string'||productId.length>200)throw Error('這一步需要重新核對，請回到營業前檢查。')
 return {id:'opening-'+crypto.randomUUID(),kind,view:destinations[kind],productId,userId:session.userId,role:session.role}
}
export function readinessTaskFor(task,session,view){return !!task&&task.userId===session?.userId&&task.role===session?.role&&destinations[task.kind]===view&&task.view===view&&(task.kind!=='stocksetup'||session.role==='owner')}
export function assertReadinessProduct(rows,id,input,checkCost=true){
 const row=Array.isArray(rows)?rows.find(p=>p?.id===id):null,fields=['price',...(checkCost?['cost']:[]),...(Object.hasOwn(input,'stock')?['stock']:[])]
 if(!row||String(row.name).trim()!==String(input.name).trim()||String(row.unit||'個')!==String(input.unit||'個')||fields.some(key=>row[key]!==input[key]))throw Error('商品還沒確認保存，請保留原輸入並核對。')
 return row
}
