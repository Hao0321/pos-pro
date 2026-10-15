import {hasPermission} from './security'
import {isProcurement,procurementSummary} from '../../electron/procurementRules.mjs'
import {tr} from '../../public/i18n/core.mjs'

export const WORKSPACE_TASKS=[
  {id:'sale',title:'賣東西、收款',detail:'點商品，確認金額，再收款。',view:'pos',perm:'pos.use',words:'收銀 結帳 現場'},
  {id:'quick',title:'幫我建單',detail:'點商品、貼內容，或交給 Agent。',view:'quick',perm:'pos.use',words:'開單 匯入 agent AI'},
  {id:'restaurant',title:'接預訂、準備出餐',detail:'預訂、現場與外送放在一起看。',view:'restaurant',perm:'pos.use',words:'丼飯 餐飲 交付 取餐'},
  {id:'purchase',title:'進貨、退貨、付款',detail:'從叫貨到收到貨、付清款項。',view:'purchase',perm:'purchase.view',words:'供應商 請款 應付 退款'},
  {id:'exchange',title:'報價給客戶、分享價目表',detail:'選客戶與商品，保存報價，再交給對方。',view:'exchange',perm:'purchase.edit',words:'客戶價格 公開目錄 供應商 agent catalogue quote pricing'},
  {id:'shifts',title:'開始營業、收攤',detail:'確認零用金與這班實際現金。',view:'shifts',perm:'pos.use',words:'開班 交班 日結 關店'},
  {id:'inventory',title:'商品、庫存',detail:'新增商品，查看剩多少。',view:'inventory',perm:'inventory.view',words:'品項 售價 成本 缺貨'},
  {id:'readiness',title:'營業前檢查、備份',detail:'確認資料保存與手機連線。',view:'readiness',perm:'pos.use',words:'下載 安全 還原 離線'},
  {id:'devices',title:'手機和電腦一起用',detail:'配對手機，共用同一間店資料。',view:'devices',perm:'settings.edit',words:'同步 共用 連線 QR'},
  {id:'members',title:'找客人、會員',detail:'查詢客戶、點數與儲值。',view:'members',perm:'members.view',words:'顧客 CRM 聯絡'},
  {id:'reports',title:'今天賣得怎麼樣',detail:'查銷售紀錄與營業報表。',view:'reports',perm:'reports.view',words:'退款 報表 業績 銷售'},
  {id:'accounting',title:'查看帳務',detail:'收入、支出、應付與分錄。',view:'accounting',perm:'accounting.view',words:'會計 財務 利潤'},
  {id:'stocktake',title:'實際點一下庫存',detail:'輸入點到的數量，核對差異。',view:'stocktake',perm:'stocktake.view',words:'盤點 數量'},
  {id:'waste',title:'記錄壞掉、耗損的貨',detail:'記錄數量與原因。',view:'waste',perm:'inventory.view',words:'損耗 報廢 過期'},
  {id:'promotions',title:'促銷活動',detail:'管理活動條件與期間。',view:'promotions',perm:'promotions.view',words:'折扣 優惠'},
  {id:'orders',title:'查看顧客點餐',detail:'查看點餐入口送來的訂單。',view:'orders',perm:'pos.use',words:'網路 點單'},
  {id:'settings',title:'設定、備份還原',detail:'店面、帳號、設備與資料管理。',view:'settings',perm:'settings.view',words:'印表機 密碼 權限 設備'},
  {id:'scenarios',title:'套用情境模板',detail:'先在演練空間試跑，再設定店面。',view:'scenarios',perm:'settings.edit',words:'丼飯 新手 試賣'},
  {id:'sales',title:'接客戶訂單、收欠款',detail:'從客戶同意報價，到交貨、收款與退貨。',view:'sales',perm:'purchase.edit',words:'銷售 應收 請款 交付 退款 sales receivables'},
]
export const WORKSPACE_AREAS=[
  {id:'crm',title:'顧客與點餐',code:'CRM',intro:'幫你照顧客人',detail:'會員、點數、儲值、點餐與預訂。',description:'會員、點數、儲值、點餐和預訂，讓接單與經營回頭客更方便。',taskIds:['sales','members','orders','restaurant','exchange','quick','sale','promotions','reports']},
  {id:'erp',title:'營運管理',code:'ERP',intro:'幫你顧好貨和錢',detail:'商品、庫存、進貨、付款與帳務。',description:'商品、庫存、進貨、付款和帳務，知道還剩多少貨、今天賣了多少、有哪些款項要付。',taskIds:['sales','sale','quick','exchange','inventory','purchase','shifts','stocktake','waste','accounting','reports','readiness','devices','settings','scenarios']},
]
export function workspaceTasks(session,query='',area='all'){
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const group=WORKSPACE_AREAS.find(a=>a.id===area)
  const matched=WORKSPACE_TASKS.filter(t=>hasPermission(session,t.perm)&&(area==='all'||group?.taskIds.includes(t.id))&&terms.every(term=>(t.title+' '+t.detail+' '+t.words+' '+tr(t.title)+' '+tr(t.detail)).toLocaleLowerCase().includes(term)))
  return group?matched.sort((a,b)=>group.taskIds.indexOf(a.id)-group.taskIds.indexOf(b.id)):matched
}
export function workspaceReminders(store,session){
  const reminders=[]
  if(!store.products.length&&hasPermission(session,'inventory.edit'))reminders.push({id:'first-product',title:'先新增第一個商品',detail:'填名稱與售價，再確認實際庫存。',view:'inventory'})
  if(!store.openShift)reminders.push({id:'open-shift',title:'準備營業：先開班',detail:'確認零用金後就能收款。',view:'shifts'})
  if(store.cart.length)reminders.push({id:'cart',title:tr('收銀台還有 {0} 種商品',{0:store.cart.length}),detail:'接著完成這筆收款，或先掛單。',view:'pos'})
  if(hasPermission(session,'purchase.view')){
    const rows=(store.purchases||[]).filter(isProcurement),summaries=rows.map(p=>procurementSummary(p))
    const owed=Math.round(summaries.reduce((n,s)=>n+s.owed,0)*100)/100,credit=Math.round(summaries.reduce((n,s)=>n+s.credit,0)*100)/100
    if(owed>0)reminders.push({id:'payable',title:tr('還有 NT$ {0} 待付款',{0:owed.toLocaleString('zh-TW')}),detail:summaries.some(s=>s.overdue>0)?'其中有已逾期款項，請核對。':'依實際請款與付款紀錄計算。',view:'purchase'})
    if(credit>0)reminders.push({id:'supplier-credit',title:tr('供應商還要退回 NT$ {0}',{0:credit.toLocaleString('zh-TW')}),detail:'收到退款後，開啟原採購單記錄。',view:'purchase'})
  }
  return reminders
}
