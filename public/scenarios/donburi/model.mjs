const copy = value => structuredClone(value)
const required = (ok, text) => { if (!ok) throw Error(text) }
export const SLOT_TIMES = ['11:30','11:45','12:00','12:15','12:30','12:45','17:30','17:45','18:00','18:15','18:30','18:45']
export const LABELS = { accepted:'待備餐', preparing:'製作中', ready:'可取餐', dispatched:'外送中', completed:'已交付', cancelled:'已取消' }
export const money = n => Math.round((n + Number.EPSILON) * 100) / 100
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v))
const positiveInt = (v,max) => Number.isSafeInteger(v) && v>0 && v<=max
const nonnegativeInt = (v,max) => Number.isSafeInteger(v) && v>=0 && v<=max
const amount = (v,max=1e9) => typeof v==='number' && Number.isFinite(v) && v>=0 && v<=max && Math.abs(v-money(v))<1e-7
const dateValid = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T12:00:00Z')) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v
const operationIdValid = v => typeof v==='string' && /^[A-Za-z0-9_-]{1,159}$/.test(v) && !['__proto__','constructor','prototype'].includes(v)
const usesCapacity = o => o.status!=='cancelled' || o.materialCommitted
export function initialState() {
  const ingredient=(id,name,unit,stock)=>({id,name,unit,stock,unitPrice:null})
  return {schema:1, revision:0, day:'2027-01-05', dailyLimit:30, slotLimit:5, nextNumber:1, orders:[],operations:{},
    ingredients:[ingredient('rice','生白米','g',5000),ingredient('pork','豬肉片','g',2000),ingredient('beef','牛肉片','g',2000),ingredient('onion','洋蔥','g',2000),ingredient('sauce','共用醬汁','ml',4000),ingredient('scallion','蔥花','g',200),ingredient('box','餐盒／餐具／袋','套',30),ingredient('tea','煮好冬瓜茶','ml',9000),ingredient('cup','飲料杯／蓋','套',30)],
    menu:[{id:'pork',name:'日式豬肉丼',price:95,recipe:{rice:90,pork:120,onion:60,sauce:110,scallion:3,box:1}},
      {id:'beef',name:'日式牛肉丼',price:115,recipe:{rice:90,beef:120,onion:60,sauce:110,scallion:3,box:1}}],teaPrice:10}
}
export function validateState(s) {
  required(record(s) && s.schema===1 && Array.isArray(s.orders) && Array.isArray(s.ingredients) && Array.isArray(s.menu) && record(s.operations) && nonnegativeInt(s.revision,1e9),'示範紀錄格式不符，請保留匯出的檔案')
  required(dateValid(s.day) && positiveInt(s.dailyLimit,1000) && positiveInt(s.slotLimit,100) && positiveInt(s.nextNumber,1e9),'日期、限量或下一張單號需要核對')
  const units={rice:'g',pork:'g',beef:'g',onion:'g',sauce:'ml',scallion:'g',box:'套',tea:'ml',cup:'套'}
  required(s.ingredients.length===Object.keys(units).length && new Set(s.ingredients.map(i=>i?.id)).size===s.ingredients.length,'原料紀錄缺少品項或重複')
  for(const i of s.ingredients)required(record(i) && Object.hasOwn(units,i.id) && i.unit===units[i.id] && typeof i.name==='string' && i.name.length>0 && i.name.length<=100 && nonnegativeInt(i.stock,1e9) && (i.unitPrice===null || typeof i.unitPrice==='number'&&Number.isFinite(i.unitPrice)&&i.unitPrice>=0&&i.unitPrice<=1e6),'原料紀錄需要核對')
  required(s.menu.length===2 && new Set(s.menu.map(m=>m?.id)).size===2 && amount(s.teaPrice,10000) && s.teaPrice>0,'菜單紀錄需要核對')
  for(const m of s.menu){
    required(record(m) && ['pork','beef'].includes(m.id) && typeof m.name==='string' && m.name.length>0 && m.name.length<=100 && amount(m.price,10000) && m.price>0 && record(m.recipe),'菜單價格或配方需要核對')
    const keys=['rice',m.id,'onion','sauce','scallion','box']
    required(Object.keys(m.recipe).length===keys.length && keys.every(k=>positiveInt(m.recipe[k],2000)),'菜單原料份量需要核對')
  }
  let highestNumber=0
  for(const o of s.orders){
    required(record(o) && typeof o.id==='string' && /^D\d{5,10}$/.test(o.id) && Object.hasOwn(LABELS,o.status) && Array.isArray(o.lines) && o.lines.length>0 && o.lines.length<=2 && record(o.requirements),'訂單紀錄需要核對')
    const ticket=Number(o.id.slice(1));highestNumber=Math.max(highestNumber,ticket)
    required(positiveInt(ticket,1e9) && o.id==='D'+String(ticket).padStart(5,'0') && o.number==='A'+String(ticket).padStart(3,'0') && dateValid(o.day) && SLOT_TIMES.includes(o.slot) && ['preorder','walkin'].includes(o.channel) && ['pickup','delivery'].includes(o.fulfillment),'訂單編號、日期或交付方式需要核對')
    const seen=new Set()
    for(const l of o.lines){
      required(record(l) && ['pork','beef'].includes(l.id) && !seen.has(l.id) && typeof l.name==='string' && positiveInt(l.qty,100) && nonnegativeInt(l.teaQty,l.qty) && amount(l.price,10000) && l.price>0 && amount(l.teaPrice,10000) && l.teaPrice>0,'訂單數量或歷史售價需要核對');seen.add(l.id)
    }
    required(amount(o.total) && o.total===money(o.lines.reduce((n,l)=>n+l.qty*l.price+l.teaQty*l.teaPrice,0)),'訂單總額與明細不一致')
    for(const [key,n] of Object.entries(o.requirements))required(Object.hasOwn(units,key) && nonnegativeInt(n,1e9),'歷史原料份量需要核對')
    required(['rice','onion','sauce','scallion','box',...seen].every(k=>positiveInt(o.requirements[k],1e9)) && ['pork','beef'].filter(k=>!seen.has(k)).every(k=>!o.requirements[k]) && o.requirements.box===bowls(o) && o.requirements.tea===o.lines.reduce((n,l)=>n+l.teaQty*300,0) && o.requirements.cup===o.lines.reduce((n,l)=>n+l.teaQty,0),'訂單缺少原料或包材紀錄')
    required(typeof o.materialCommitted==='boolean' && (o.status==='cancelled' || o.materialCommitted===(o.status!=='accepted')) && (o.status!=='dispatched'||o.fulfillment==='delivery'),'備餐與扣料狀態需要核對')
    required(['unpaid','paid','refunded'].includes(o.payment) && amount(o.tendered) && amount(o.change) && amount(o.refunded),'收款紀錄需要核對')
    if(o.payment==='unpaid')required(o.method===null && o.tendered===0 && o.change===0 && o.refunded===0 && o.status!=='completed','未收款訂單不能標為已交付')
    else {
      required(['cash','transfer','electronic'].includes(o.method) && o.tendered>=o.total && o.change===money(o.tendered-o.total) && (o.method==='cash'||o.tendered===o.total),'實收與找零紀錄不一致')
      required(o.payment==='refunded'?o.status==='cancelled'&&o.refunded===o.total:o.status!=='cancelled'&&o.refunded===0,'退款與取消狀態不一致')
    }
    required(Array.isArray(o.missingCosts) && o.missingCosts.every(n=>typeof n==='string') && new Set(o.missingCosts).size===o.missingCosts.length,'歷史成本紀錄需要核對')
    if(o.materialCommitted)required(amount(o.knownCost) && (o.cost===null?o.missingCosts.length>0:amount(o.cost)&&o.cost===o.knownCost&&o.missingCosts.length===0),'歷史成本紀錄需要核對')
    else required(o.cost===null && o.missingCosts.length===0,'尚未備餐不能記錄耗用成本')
    for(const [key,max] of [['customer',100],['phone',40],['address',300],['note',300]])required(typeof o[key]==='string' && o[key].length<=max,'訂單聯絡資料需要核對')
    required(o.channel!=='preorder'||o.customer.trim(),'預訂缺少稱呼')
    required(o.fulfillment!=='delivery'||o.customer.trim()&&o.phone.trim()&&o.address.trim(),'外送缺少聯絡資料')
  }
  required(new Set(s.orders.map(o=>o.id)).size===s.orders.length && s.nextNumber>highestNumber,'示範單號重複或下一張單號已使用')
  required(Object.entries(s.operations).every(([id,o])=>operationIdValid(id)&&record(o)&&typeof o.signature==='string'&&o.signature.length>0) && Object.keys(s.operations).length===s.revision,'操作紀錄需要核對')
  required(Object.values(availability(s)).every(n=>n>=0),'原料量低於已預留訂單，請核對')
  return s
}
export function reserve(s) {
  const result={}
  for(const o of s.orders)if(o.status!=='cancelled' && !o.materialCommitted)for(const [id,n] of Object.entries(o.requirements))result[id]=(result[id]||0)+n
  return result
}
export function availability(s) {const held=reserve(s);return Object.fromEntries(s.ingredients.map(i=>[i.id,i.stock-(held[i.id]||0)]))}
export function dayOrders(s,day=s.day) {return s.orders.filter(o=>o.day===day)}
export function bowls(o) {return o.lines.reduce((n,l)=>n+l.qty,0)}
export function slotUsed(s,day,time) {return s.orders.filter(o=>o.day===day&&o.slot===time&&usesCapacity(o)).reduce((n,o)=>n+bowls(o),0)}
export function dayUsed(s,day=s.day) {return dayOrders(s,day).filter(usesCapacity).reduce((n,o)=>n+bowls(o),0)}
function signature(value) {
  if(Array.isArray(value))return '['+value.map(signature).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+signature(value[k])).join(',')+'}'
  return JSON.stringify(value)
}
function operation(state,id,type,payload,fn) {
  validateState(state)
  required(operationIdValid(id),'請保留有效的操作編號')
  const digest=signature({type,payload}), prior=Object.hasOwn(state.operations,id)?state.operations[id]:null
  if(prior){required(prior.signature===digest,'同操作編號的內容不同，請先核對原單');return copy(state)}
  const s=copy(state);fn(s);s.operations[id]={signature:digest};s.revision++;return validateState(s)
}
export function createOrder(state,request,operationId) {
  return operation(state,operationId,'create',request,s=>{
    const {day,slot,channel,fulfillment}=request
    required(dateValid(day),'請選擇有效取餐日期')
    required(SLOT_TIMES.includes(slot),'請選擇取餐時段')
    required(['preorder','walkin'].includes(channel)&&['pickup','delivery'].includes(fulfillment),'接單／交付方式不正確')
    required(Array.isArray(request.lines)&&request.lines.length>0&&request.lines.length<=2,'請選擇餐點')
    const seen=new Set(),needs={},available=availability(s)
    const lines=request.lines.map(l=>{
      const m=s.menu.find(m=>m.id===l.id);required(m&&!seen.has(l.id),'餐點不存在或重複');seen.add(l.id)
      required(Number.isInteger(l.qty)&&l.qty>0&&l.qty<=100,'餐點碗數需為正整數')
      required(Number.isInteger(l.teaQty)&&l.teaQty>=0&&l.teaQty<=l.qty,'加購茶數量不可超過丼飯碗數')
      for(const [id,n] of Object.entries(m.recipe))needs[id]=(needs[id]||0)+n*l.qty
      needs.tea=(needs.tea||0)+l.teaQty*300;needs.cup=(needs.cup||0)+l.teaQty
      return {id:m.id,name:m.name,qty:l.qty,teaQty:l.teaQty,price:m.price,teaPrice:s.teaPrice}
    })
    const quantity=lines.reduce((n,l)=>n+l.qty,0)
    required(dayUsed(s,day)+quantity<=s.dailyLimit,'今日限量已滿，請改日期或減少碗數')
    required(slotUsed(s,day,slot)+quantity<=s.slotLimit,'這個取餐時段已滿，請選其他時段')
    for(const [id,n] of Object.entries(needs))required(Number.isFinite(available[id])&&available[id]>=n,(s.ingredients.find(i=>i.id===id)?.name||id)+'不足，請補料或減少訂量')
    const clean=(v,max)=>{required(typeof v==='string'&&v.length<=max,'聯絡資料／備註過長');return v.trim()}
    const customer=clean(request.customer||'',100),phone=clean(request.phone||'',40),address=clean(request.address||'',300),note=clean(request.note||'',300)
    required(channel!=='preorder'||customer,'預訂請填稱呼，方便核對取餐')
    required(fulfillment!=='delivery'||customer&&phone&&address,'外送請填稱呼、聯絡電話和地址')
    const total=money(lines.reduce((n,l)=>n+l.qty*l.price+l.teaQty*l.teaPrice,0))
    s.orders.push({id:'D'+String(s.nextNumber).padStart(5,'0'),number:'A'+String(s.nextNumber++).padStart(3,'0'),day,slot,channel,fulfillment,customer,phone,address,note,lines,requirements:needs,total,status:'accepted',payment:'unpaid',method:null,tendered:0,change:0,materialCommitted:false,cost:null,missingCosts:[],refunded:0})
  })
}
function find(s,id) {const o=s.orders.find(o=>o.id===id);required(o,'找不到這筆單');return o}
export function moveOrder(state,id,operationId,expectedStatus) {
  return operation(state,operationId,'move',{id,expectedStatus},s=>{
    const o=find(s,id);required(!['completed','cancelled'].includes(o.status),'這筆單已結束')
    required(expectedStatus==null||o.status===expectedStatus,'出餐進度已改變，請核對最新狀態')
    if(o.status==='accepted'){
      required(!o.materialCommitted,'這筆單已扣料，請核對')
      const held=reserve(s)
      for(const i of s.ingredients)required(i.stock>=(held[i.id]||0),i.name+'不足以完成已預留訂單')
      let cost=0;const missing=[]
      for(const [ingredientId,n] of Object.entries(o.requirements)){
        if(!n)continue
        const i=s.ingredients.find(i=>i.id===ingredientId);required(i&&i.stock>=n,'原料不足')
        i.stock-=n
        if(i.unitPrice===null)missing.push(i.name)
        else cost+=n*i.unitPrice
      }
      o.cost=missing.length?null:money(cost);o.knownCost=money(cost);o.missingCosts=missing;o.materialCommitted=true;o.status='preparing'
    }else if(o.status==='preparing')o.status='ready'
    else if(o.status==='ready'&&o.fulfillment==='delivery')o.status='dispatched'
    else {required(o.payment==='paid','尚未確認實收，請先登記收款再完成交付');o.status='completed'}
  })
}
export function payOrder(state,id,method,tendered,operationId) {
  return operation(state,operationId,'pay',{id,method,tendered},s=>{
    const o=find(s,id);required(o.status!=='cancelled'&&o.payment==='unpaid','這筆單已收款或已取消')
    required(['cash','transfer','electronic'].includes(method),'請選擇付款方式')
    required(amount(tendered)&&tendered>=o.total,'實收不足或金額不正確（金額最多兩位小數）')
    required(method==='cash'||money(tendered)===o.total,'轉帳／電子付款請核對應收金額')
    o.payment='paid';o.method=method;o.tendered=money(tendered);o.change=money(tendered-o.total)
  })
}
export function cancelOrder(state,id,refund,operationId) {
  return operation(state,operationId,'cancel',{id,refund},s=>{
    const o=find(s,id);required(!['completed','cancelled'].includes(o.status),'這筆單已結束，不能重複取消')
    required(o.payment!=='paid'||refund===true,'這筆已收款，請明確登記退款並取消')
    if(o.payment==='paid'){o.refunded=o.total;o.payment='refunded'}
    o.status='cancelled'
  })
}
export function updateIngredient(state,id,stock,unitPrice,operationId) {
  return operation(state,operationId,'ingredient',{id,stock,unitPrice},s=>{
    const i=s.ingredients.find(i=>i.id===id);required(i,'原料不存在')
    required(Number.isInteger(stock)&&stock>=0&&stock<=1e9,'現有量需為非負整數')
    required(unitPrice===null||typeof unitPrice==='number'&&Number.isFinite(unitPrice)&&unitPrice>=0&&unitPrice<=1e6,'進價不正確')
    required(stock>=(reserve(s)[id]||0),'現有量低於已預留，請先核對訂單')
    i.stock=stock;i.unitPrice=unitPrice
  })
}
export function updatePlan(state,day,dailyLimit,slotLimit,prices,operationId) {
  return operation(state,operationId,'plan',{day,dailyLimit,slotLimit,prices},s=>{
    required(Number.isInteger(dailyLimit)&&dailyLimit>0&&dailyLimit<=1000&&Number.isInteger(slotLimit)&&slotLimit>0&&slotLimit<=100,'請填有效每日限量與時段碗數')
    required(dateValid(day),'日期不正確')
    required(s.orders.filter(usesCapacity).every(o=>dayUsed(s,o.day)<=dailyLimit&&slotUsed(s,o.day,o.slot)<=slotLimit),'新限量低於已接訂量或已製作量，請先核對')
    for(const k of ['pork','beef','tea'])required(amount(prices[k],10000)&&prices[k]>0,'示範售價不正確（金額最多兩位小數）')
    s.day=day;s.dailyLimit=dailyLimit;s.slotLimit=slotLimit;s.menu=s.menu.map(m=>({...m,price:money(prices[m.id])}));s.teaPrice=money(prices.tea)
  })
}
export function updateRecipes(state,values,operationId){
  return operation(state,operationId,'recipe',values,s=>{
    for(const key of ['rice','meat','onion','sauce'])required(Number.isInteger(values[key])&&values[key]>0&&values[key]<=2000,'每碗份量需為 1～2000 的整數')
    s.menu=s.menu.map(m=>({...m,recipe:{...m.recipe,rice:values.rice,[m.id]:values.meat,onion:values.onion,sauce:values.sauce}}))
  })
}
export function prepSummary(state,day=state.day) {
  const result={bowls:0,tea:0,ingredients:{},pork:0,beef:0,remaining:0}
  for(const o of dayOrders(state,day).filter(o=>o.status!=='cancelled')){
    result.bowls+=bowls(o);if(o.status==='accepted')result.remaining+=bowls(o)
    for(const l of o.lines){result[l.id]+=l.qty;result.tea+=l.teaQty}
    for(const [id,n] of Object.entries(o.requirements))result.ingredients[id]=(result.ingredients[id]||0)+n
  }
  return result
}
export function summary(state,day=state.day) {
  const all=dayOrders(state,day),active=all.filter(o=>o.status!=='cancelled'),consumed=all.filter(o=>o.materialCommitted),costKnown=consumed.every(o=>o.cost!==null)
  return {orders:active.length,bowls:active.reduce((n,o)=>n+bowls(o),0),paid:money(all.reduce((n,o)=>n+(o.payment==='paid'?o.total:0),0)),unpaid:money(active.filter(o=>o.payment==='unpaid').reduce((n,o)=>n+o.total,0)),served:money(active.filter(o=>o.status==='completed').reduce((n,o)=>n+o.total,0)),refunds:money(all.reduce((n,o)=>n+o.refunded,0)),usedCost:costKnown?money(consumed.reduce((n,o)=>n+o.cost,0)):null,knownCost:money(consumed.reduce((n,o)=>n+(o.knownCost||0),0)),lossBowls:all.filter(o=>o.status==='cancelled'&&o.materialCommitted).reduce((n,o)=>n+bowls(o),0),missingCosts:[...new Set(consumed.flatMap(o=>o.missingCosts))]}
}
