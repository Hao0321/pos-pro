// 顧客點餐頁面 — vanilla JS
import {tr,trMessage} from '../i18n/core.mjs'
import {getDisplayPreferences,setDisplayPreferences,subscribeDisplayPreferences,initDisplayPreferences} from '../i18n/preferences.mjs'
import {readCustomerJournal,beginCustomerRequest,confirmCustomerRequest,clearCustomerRequest,rejectUncommittedRequest,assertCustomerAcknowledgement,assertCustomerProgress,customerQuoteTotal} from './orderJournal.mjs'
import {PUBLIC_MENU_PROTOCOL,assertPublicMenuQuote,assertQuotedSelections,menuCanonical} from './menuProtocol.mjs'
import {createMenuPicker} from './menuPicker.mjs'
import {assertCartContext,cartContextHeaders} from './cartContext.mjs'
import {createGuestDraftUI} from './guestDraftUI.mjs'
const API = window.location.origin
let optionMenu=null,menuReview=null,menuBusy=false,cartContext=null,draftUI=null,heldPicker=null,menuSequence=0,orderSequence=0,confirmedVerified=false
const menuPicker=createMenuPicker({getMenu:()=>optionMenu,isLocked:()=>submitting||menuBusy||journalBlocked||draftLocked()||!!pendingOrderRequest||!!currentOrderId,onAdd:selection=>changeSelectedCart([...cart.map(row=>row.selection),selection]),onChange:selection=>{heldPicker=selection;saveDraft()}})
let products = []
let categories = []
let cart = []
let activeCategory = null
let ws = null
let currentOrderId = null
let submitting = false
let storeName=null,storeNameIsDefault=false,lastOrderStatus='pending',menuFailed=false,preferenceFailed=false
let storeId=null,tableContext=null,journal=null,journalBlocked=false,menuContextInvalid=false,warning='',lastFulfilmentStatus='',lastTotal=0,lastPickupNumber=null
function renderWarning(){for(const id of ['customer-order-warning','form-warning']){const node=document.getElementById(id);node.textContent=trMessage(warning);node.hidden=!warning;if(heldPicker&&!menuPicker.snapshot()&&!draftLocked()&&!journal&&!submitting){for(const [label,work]of [['重新選擇這道餐點',()=>menuPicker.open(heldPicker.offerId)],['略過未加入的餐點',()=>{heldPicker=null;showWarning('');saveDraft()}]]){const button=document.createElement('button');button.type='button';button.className='btn-secondary';button.textContent=tr(label);button.dataset.heldPickerAction=label==='略過未加入的餐點'?'skip':'choose';button.onclick=work;node.append(button)}}}}
function showWarning(message){warning=message;renderWarning()}
const draftLocked=()=>!draftUI||draftUI.locked
const saveDraft=()=>draftUI?.save()
const staleWork=()=>Object.assign(Error('點餐已由其他分頁接手'),{code:'GUEST_WORK_STALE'})
const noticeError=error=>{if(error.code!=='GUEST_WORK_STALE')showWarning(error.message)}
function suspendGuestWork(){orderSequence++;menuSequence++;submitting=false;menuBusy=false;confirmedVerified=false;heldPicker=menuPicker.snapshot()||heldPicker;menuPicker.suspend()}
function snapshotGuest(){return {mode:optionMenu?'menu':'ordinary',menuRevision:cartContext.revision,cart:cart.map(row=>({id:row.id,name:row.name,price:row.price,qty:row.qty,unit:row.unit||'',...(optionMenu?{offerId:row.offerId,selection:structuredClone(row.selection)}:{})})),picker:menuPicker.snapshot()||heldPicker,customerName:document.getElementById('customer-name').value,tableNum:document.getElementById('table-num').value,note:document.getElementById('order-note').value,formOpen:document.getElementById('order-form-overlay').style.display==='flex',cartOpen:document.getElementById('cart-panel').classList.contains('open'),search:searchQuery,category:activeCategory}}
function restoreGuest(state){
  if(state&&(state.mode!==(optionMenu?'menu':'ordinary')||tableContext&&state.tableNum!==tableContext.label))throw Error('這份點餐草稿需要核對，原資料已保留。')
  menuPicker.suspend();cart=state?structuredClone(state.cart):[];heldPicker=state?.picker?structuredClone(state.picker):null;searchQuery=state?.search||'';activeCategory=state?.category??null
  for(const [id,value]of [['customer-name',state?.customerName||''],['table-num',state?.tableNum??tableContext?.label??''],['order-note',state?.note||''],['search-input',searchQuery]])document.getElementById(id).value=value
  document.getElementById('order-form-overlay').style.display=state?.formOpen?'flex':'none';for(const id of ['cart-panel','cart-overlay'])document.getElementById(id).classList.toggle('open',!!state?.cartOpen)
  if(heldPicker&&!menuPicker.restore(heldPicker))showWarning('這道餐點已調整，先前選擇仍保留。')
  else if(state&&state.menuRevision!==cartContext.revision)showWarning('菜單已更新，請核對餐點與總額。')
  applyMenuLanguage()
}
function adoptOriginal(){
  const saved=readCustomerJournal(localStorage)
  if(!saved&&pendingOrderRequest){journalBlocked=true;throw Error('這台裝置的原訂單需要核對，紀錄已保留')}
  journal=saved;pendingOrderRequest=saved?.phase==='pending'?saved.request:null
  if(!saved){currentOrderId=null;trackingToken=null;document.getElementById('order-success').style.display='none';return false}
  if(saved.storeId!==storeId){journalBlocked=true;showWarning('店面已變更，請向店家核對原訂單')}
  if(saved.phase==='confirmed'){currentOrderId=saved.ack.orderId;trackingToken=saved.ack.trackingToken;showSuccess(currentOrderId,saved.ack.total)}
  else{cart=structuredClone(saved.quote);document.getElementById('order-form-overlay').style.display='flex';showWarning('上次送單尚未確認，請核對原訂單')}
  applyMenuLanguage();return true
}
async function refreshGuestContext(isCurrent=()=>true){
  const params=new URLSearchParams(location.search),query=new URLSearchParams();for(const key of ['table','key'])if(params.has(key))query.set(key,params.get(key))
  const response=await fetch(API+'/api/menu'+(query.size?'?'+query:'')),data=await response.json();if(!data.success)throw Error('這張桌碼或店面已變更，請重新掃描。')
  if(!isCurrent())throw staleWork()
  const context=assertCartContext(data.cartContext);if(context.scopeId!==cartContext.scopeId||data.storeId!==storeId)throw Error('這張桌碼或店面已變更，請重新掃描。')
  cartContext=context;optionMenu=data.menu??null;products=optionMenu?optionMenu.offers.map(offer=>({id:offer.id,name:offer.name,category:offer.category,price:offer.variants.find(row=>row.id===offer.defaultVariantId).price,stock:null,unit:tr('份')})):data.products;categories=data.categories;tableContext=data.table??null
}
async function verifyConfirmedOriginal(){
  const saved=journal,token=draftUI?.token;if(saved?.phase!=='confirmed'||!draftUI?.originalReady)return false
  const response=await fetch(API+'/api/order/'+encodeURIComponent(saved.ack.orderId),{headers:{Authorization:'Bearer '+saved.ack.trackingToken}}),result=await response.json();assertCustomerProgress(saved.ack,result)
  if(!draftUI.isCurrent(token)||journal?.signature!==saved.signature)throw staleWork()
  await draftUI.runWriter(()=>{const current=readCustomerJournal(localStorage);if(current?.phase!=='confirmed'||current.signature!==saved.signature)throw staleWork();return current},{clearProof:saved.cartDraft})
  if(!draftUI.isCurrent(token))throw staleWork();confirmedVerified=true;updateOrderStatus(result.order.status,result.order.fulfilmentStatus,result.order.pickupNumber);applyMenuLanguage();return true
}

function applyMenuLanguage(){
  initDisplayPreferences()
  for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=tr(el.dataset.i18n)
  for(const el of document.querySelectorAll('[data-i18n-placeholder]'))el.placeholder=tr(el.dataset.i18nPlaceholder)
  const prefs=getDisplayPreferences();document.getElementById('menu-language').value=prefs.locale;document.getElementById('menu-style').value=prefs.style
  document.getElementById('menu-language').setAttribute('aria-label',tr('語言'));document.getElementById('menu-style').setAttribute('aria-label',tr('介面風格'))
  document.getElementById('preference-warning').textContent=preferenceFailed?tr('這次已切換；這台裝置無法記住偏好，下次開啟需重新選擇。'):''
  const displayName=storeNameIsDefault?tr('商店'):storeName
  document.getElementById('store-name').textContent=displayName??tr(menuFailed?'無法連線':'載入中...')
  document.title=displayName?displayName+' - '+tr('線上點餐'):tr('線上點餐')
  document.getElementById('checkout-btn').textContent=tr('送出訂單')
  document.querySelector('.order-form [data-action="confirmOrder"]').textContent=tr(submitting?'送出中...':pendingOrderRequest?'核對原訂單':'確認送出')
  document.querySelector('.order-form [data-action="confirmOrder"]').disabled=submitting||journalBlocked||!(pendingOrderRequest?draftUI?.originalReady:!draftLocked())
  document.getElementById('cart-fab').setAttribute('aria-label',tr('購物車'))
  document.querySelector('.cart-header .close-btn').setAttribute('aria-label',tr('關閉購物車'))
  if(currentOrderId)document.getElementById('success-order-id').textContent=tr('訂單編號: {0}',{0:currentOrderId})
  renderWarning()
  const originalTable=(pendingOrderRequest||currentOrderId&&journal?.request)?.tableNum;document.getElementById('table-context').textContent=originalTable?tr('原訂單桌號 {0}',{0:originalTable}):tableContext?tr('桌號 {0}',{0:tableContext.label}):''
  if(currentOrderId){document.getElementById('success-table-label').textContent=journal?.request.tableNum?tr('桌號 {0}',{0:journal.request.tableNum}):'';document.getElementById('success-order-total').textContent=tr('訂單金額 NT$ {0}',{0:lastTotal});const quoted=journal?.quote?customerQuoteTotal(journal.quote,{allowZero:journal.request.menuProtocol===PUBLIC_MENU_PROTOCOL}):lastTotal;document.getElementById('success-order-price-change').textContent=quoted!==lastTotal?tr('金額已更新：原 {0}，店家 {1}；請向店家確認。',{0:quoted,1:lastTotal}):''}
  document.getElementById('pending-order-reference').hidden=!pendingOrderRequest;document.getElementById('pending-order-id').textContent=pendingOrderRequest?'CO'+pendingOrderRequest.requestId:''
  if(pendingOrderRequest)for(const [id,key]of [['customer-name','customerName'],['table-num','tableNum'],['order-note','note']]){document.getElementById(id).value=pendingOrderRequest[key]||'';document.getElementById(id).readOnly=true}
  for(const id of ['customer-name','table-num','order-note'])document.getElementById(id).readOnly=submitting||draftLocked()||!!pendingOrderRequest||!!currentOrderId||id==='table-num'&&!!tableContext
  document.querySelector('[data-action="resetApp"]').disabled=submitting||journalBlocked||!draftUI?.originalReady||!confirmedVerified
  document.querySelector('[data-action="closeOrderForm"]').disabled=submitting
  document.querySelector('[data-action="closeOrderForm"]').textContent=tr(pendingOrderRequest?'返回菜單':'取消')
  document.getElementById('search-input').disabled=draftLocked()
  updateOrderStatus(lastOrderStatus,lastFulfilmentStatus,lastPickupNumber);renderCategories();renderProducts();updateCartUI();menuPicker.refresh();renderFormQuote()
  draftUI?.render()
}

// 防 XSS：跳脫 HTML 特殊字元
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

// ===== 初始化 =====
async function init() {
  try{journal=readCustomerJournal(localStorage);pendingOrderRequest=journal?.phase==='pending'?journal.request:null}catch{journalBlocked=true;showWarning('這台裝置的原訂單需要核對，紀錄已保留')}
  try {
    const params=new URLSearchParams(location.search),query=new URLSearchParams();for(const key of ['table','key'])if(params.has(key))query.set(key,params.get(key))
    let res = await fetch(API + '/api/menu'+(query.size?'?'+query:'')),data = await res.json()
    if(!data.success&&journal){menuContextInvalid=!!query.size;res=await fetch(API+'/api/menu');data=await res.json()}
    if (data.success) {
      optionMenu=data.menu??null
      products = optionMenu?optionMenu.offers.map(offer=>({id:offer.id,name:offer.name,category:offer.category,price:offer.variants.find(row=>row.id===offer.defaultVariantId).price,stock:null,unit:tr('份')})):data.products
      categories = data.categories
      storeName=data.storeName
      storeNameIsDefault=data.storeNameIsDefault===true
      storeId=data.storeId??null;tableContext=data.table??null
      cartContext=data.cartContext===undefined?null:assertCartContext(data.cartContext)
      if(!cartContext&&!journal){journalBlocked=true;showWarning('無法核對菜單，請重新開啟點餐頁。')}
      if(data.tableRequired&&!tableContext&&!journal){journalBlocked=true;showWarning('請掃描桌上的點餐碼')}
      if(tableContext){document.getElementById('table-num').value=tableContext.label;document.getElementById('table-num').readOnly=true}
      if(journal){
        if(journal.storeId!==storeId){journalBlocked=true;showWarning('店面已變更，請向店家核對原訂單')}
        if(journal.phase==='confirmed'){currentOrderId=journal.ack.orderId;trackingToken=journal.ack.trackingToken;showSuccess(currentOrderId,journal.ack.total);if(journalBlocked)updateOrderStatus('uncertain')}
        else{cart=structuredClone(journal.quote);for(const [id,key]of [['customer-name','customerName'],['table-num','tableNum'],['order-note','note']]){document.getElementById(id).value=journal.request[key]||'';document.getElementById(id).readOnly=true};document.getElementById('form-total').textContent='NT$ '+customerQuoteTotal(journal.quote,{allowZero:journal.request.menuProtocol===PUBLIC_MENU_PROTOCOL});document.getElementById('order-form-overlay').style.display='flex';if(!journalBlocked)showWarning('上次送單尚未確認，請核對原訂單')}
      }
      applyMenuLanguage()
      if(cartContext){draftUI=createGuestDraftUI({getContext:()=>cartContext,hasOriginal:()=>journal||pendingOrderRequest||currentOrderId,snapshot:snapshotGuest,restore:restoreGuest,refresh:refreshGuestContext,adoptOriginal,onLock:()=>applyMenuLanguage(),onSuspend:suspendGuestWork,onWarning:showWarning,afterAcquire:()=>verifyConfirmedOriginal()});await draftUI.start()}
    }else{journalBlocked=true;showWarning(data.error||'無法載入菜單，請確認網路連線');throw Error('Menu unavailable')
    }
  } catch (err) {
    menuFailed=true
    document.getElementById('store-name').textContent = tr('無法連線')
    document.getElementById('product-list').innerHTML =
      '<p style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1">'+esc(tr('無法載入菜單，請確認網路連線'))+'</p>'
  }
  connectWebSocket()
}

// ===== WebSocket =====
let trackingToken=null, pendingOrderRequest=null
function connectWebSocket() {
  setInterval(async()=>{
    if(!currentOrderId || !trackingToken||journal?.storeId!==storeId)return
    try{
      if(journal?.phase==='confirmed'&&!confirmedVerified&&draftUI?.originalReady){await verifyConfirmedOriginal();return}
      const r=await fetch(API+'/api/order/'+encodeURIComponent(currentOrderId),{headers:{Authorization:'Bearer '+trackingToken}})
      const data=await r.json(),order=assertCustomerProgress({orderId:currentOrderId,total:lastTotal},data);updateOrderStatus(order.status,order.fulfilmentStatus,order.pickupNumber)
    }catch{updateOrderStatus('uncertain')}
  },3000)
}

// ===== 分類 =====
function renderCategories() {
  const nav = document.getElementById('categories')
  nav.replaceChildren()
  const allBtn = createCatBtn(tr('全部'), null)
  nav.appendChild(allBtn)
  categories.filter(cat=>typeof cat==='string'&&cat.trim()).forEach(cat => nav.appendChild(createCatBtn(cat, cat)))
}

function createCatBtn(label, value) {
  const btn = document.createElement('button')
  btn.className = 'cat-btn' + (activeCategory === value ? ' active' : '')
  btn.textContent = label
  btn.disabled=draftLocked()
  btn.onclick = () => {
    activeCategory = value
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    renderProducts()
    saveDraft()
  }
  return btn
}

// ===== 商品搜尋 =====
let searchQuery = ''

// ===== 商品列表 =====
function renderProducts() {
  const list = document.getElementById('product-list')
  let filtered = activeCategory
    ? products.filter(p => p.category === activeCategory)
    : products
  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    filtered = filtered.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    )
  }

  list.innerHTML = filtered.map(p => {
    const count=optionMenu?cart.filter(c=>c.offerId===p.id).reduce((sum,row)=>sum+row.qty,0):cart.find(c=>c.id===p.id)?.qty
    const inCart=count?{qty:count}:null
    const qtyBadge = inCart ? `<div class="qty-badge">${inCart.qty}</div>` : ''
    const stock = Number(p.stock) || 0
    const soldOut = !optionMenu&&stock <= 0
    const lastFew = !optionMenu&&stock > 0 && stock <= 3
    const low = !optionMenu&&stock > 0 && stock <= 5
    let stockNote = ''
    if (soldOut) stockNote = `<span class="p-soldout">${esc(tr('售完'))}</span>`
    else if (lastFew) stockNote = `<span class="p-stock-last">${esc(tr('最後 {0} {1}！',{0:stock,1:p.unit||tr('個')}))}</span>`
    else if (low) stockNote = `<span class="p-stock-low">${esc(tr('剩 {0} {1}',{0:stock,1:p.unit||tr('個')}))}</span>`
    return `
      <div class="product-card${soldOut ? ' sold-out' : ''}">
        ${qtyBadge}
        ${p.category?`<span class="p-category">${esc(p.category)}</span>`:''}
        <span class="p-name">${esc(p.name)}</span>
        <span class="p-price">NT$ ${esc(p.price)} <span class="p-unit">/ ${esc(p.unit || tr('個'))}</span></span>
        ${stockNote}
        <button class="add-btn" data-pid="${esc(p.id)}" ${soldOut||draftLocked()||journalBlocked||pendingOrderRequest||currentOrderId||menuBusy||submitting ? 'disabled' : ''}>${esc(tr(soldOut ? '售完' : optionMenu?'選擇':'加入購物車'))}</button>
      </div>
    `
  }).join('')

  if (!filtered.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1">'+esc(tr(menuFailed?'無法載入菜單，請確認網路連線':'沒有符合的商品'))+'</p>'
  }

  // 用 event delegation 取代 inline onclick — 修 audit #23 邊界 case，安全處理含特殊字元的 id
  list.querySelectorAll('.add-btn[data-pid]').forEach(btn => {
    btn.onclick = () => addToCart(btn.getAttribute('data-pid'))
  })
}

function setSearch(q) {
  searchQuery = q || ''
  renderProducts()
  saveDraft()
}


function cartLineName(item){
  if(!optionMenu||pendingOrderRequest||currentOrderId||!item.selection)return item.name
  const offer=optionMenu.offers.find(row=>row.id===item.selection.offerId),variant=offer?.variants.find(row=>row.id===item.selection.variantId);if(!offer||!variant)return item.name
  const full=[offer.name,variant.name],short=[offer.name,...(offer.variants.length>1?[variant.name]:[])]
  for(const selected of item.selection.selections){
    const group=offer.groups.find(row=>row.id===selected.groupId);if(!group)return item.name
    const normal=group.min===1&&group.max===1&&menuCanonical(selected.choices)===menuCanonical(group.defaults)
    for(const chosen of selected.choices){const choice=group.choices.find(row=>row.id===chosen.id);if(!choice)return item.name;const label=choice.name+(chosen.qty>1?' × '+chosen.qty:'');full.push(label);if(!normal||choice.priceDelta!==0)short.push(label)}
  }
  return full.join(' · ')===item.name?short.join(' · '):item.name
}
function renderFormQuote(){
  const list=document.getElementById('form-menu-items');if(!list)return;list.replaceChildren();list.hidden=!cart.length
  for(const item of cart){const row=document.createElement('li');row.title=item.name;row.textContent=optionMenu||journal?.request.menuProtocol===PUBLIC_MENU_PROTOCOL?cartLineName(item)+' × '+item.qty+' · NT$ '+Math.round(item.price*100)*item.qty/100:cartLineName(item)+' · NT$ '+item.price+' / '+(item.unit||tr('個'))+' × '+item.qty;list.append(row)}
  if(cart.length)document.getElementById('form-total').textContent='NT$ '+getCartTotal()
}
async function changeSelectedCart(rows){
  if(draftLocked())throw staleWork()
  if(menuBusy)throw Error('餐點正在核對，請稍候。')
  if(!rows.length){cart=[];menuReview=null;updateCartUI();renderProducts();saveDraft();return}
  const sequence=++menuSequence,token=draftUI.token
  menuBusy=true;updateCartUI()
  try{
    const params=new URLSearchParams(location.search),body={items:rows,...(tableContext?{table:tableContext.id,key:params.get('key')}:{})},response=await fetch(API+'/api/menu/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json()
    if(sequence!==menuSequence||!draftUI.isCurrent(token))throw staleWork()
    if(!result.success)throw Error('餐點選項或可用量已變更，請重新確認。')
    const reviewed=assertPublicMenuQuote(result.menuReview);assertQuotedSelections(rows,reviewed);if(reviewed.storeId!==storeId)throw Error('店面已變更，請向店家核對原訂單')
    const current=assertCartContext(result.cartContext);if(current.mode!=='menu'||!cartContext||current.scopeId!==cartContext.scopeId)throw Error('這張桌碼或店面已變更，請重新掃描。')
    cartContext=current
    menuReview=reviewed;cart=reviewed.items.map((item,index)=>({...item,offerId:reviewed.input[index].offerId,selection:structuredClone(reviewed.input[index]),unit:tr('份')}));renderProducts();renderFormQuote();saveDraft()
  }catch(e){if(e.code==='GUEST_WORK_STALE'||['餐點選項或可用量已變更，請重新確認。','餐點選項已變更，請重新選擇。','店面已變更，請向店家核對原訂單','這張桌碼或店面已變更，請重新掃描。'].includes(e.message))throw e;throw Error('無法核對餐點，請確認網路後重試。')}
  finally{if(sequence===menuSequence){menuBusy=false;updateCartUI();renderProducts();document.body.dataset.menuBusy='false'}}
}

// ===== 購物車 =====
function addToCart(productId) {
  if(draftLocked()||journalBlocked||pendingOrderRequest||currentOrderId||submitting||menuBusy)return
  if(optionMenu){const line=cart.find(row=>row.id===productId);if(line)changeSelectedCart(cart.map(row=>({...row.selection,qty:row.qty+(row.id===productId?1:0)}))).catch(noticeError);else menuPicker.open(productId);return}
  const previous=structuredClone(cart)
  const product = products.find(p => p.id === productId)
  if (!product) return
  const existing = cart.find(c => c.id === productId)
  if (existing) {
    if (existing.qty >= Math.min(product.stock,1000000)) return // 不能超過庫存
    existing.qty++
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit })
  }
  try{getCartTotal()}catch(e){cart=previous;showWarning(e.message);return}
  updateCartUI()
  renderProducts() // 更新數量 badge
  saveDraft()
}

function removeFromCart(productId) {
  if(draftLocked()||journalBlocked||pendingOrderRequest||submitting||menuBusy)return
  if(optionMenu){changeSelectedCart(cart.flatMap(row=>row.id===productId?(row.qty>1?[{...row.selection,qty:row.qty-1}]:[]):[row.selection])).catch(noticeError);return}
  const idx = cart.findIndex(c => c.id === productId)
  if (idx < 0) return
  if (cart[idx].qty > 1) cart[idx].qty--
  else cart.splice(idx, 1)
  updateCartUI()
  renderProducts()
  saveDraft()
}

function deleteFromCart(productId) {
  if(draftLocked()||journalBlocked||pendingOrderRequest||submitting||menuBusy)return
  if(optionMenu){changeSelectedCart(cart.filter(row=>row.id!==productId).map(row=>row.selection)).catch(noticeError);return}
  cart = cart.filter(c => c.id !== productId)
  updateCartUI()
  renderProducts()
  saveDraft()
}

function getCartTotal() {
  return customerQuoteTotal(cart,{allowZero:!!optionMenu||journal?.request.menuProtocol===PUBLIC_MENU_PROTOCOL})
}

function getCartCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0)
}

function updateCartUI() {
  const badge = document.getElementById('cart-badge')
  const count = getCartCount()
  badge.textContent = count
  badge.style.display = count > 0 ? 'flex' : 'none'

  const itemsDiv = document.getElementById('cart-items')
  const totalEl = document.getElementById('cart-total-amount')
  const checkoutBtn = document.getElementById('checkout-btn')

  if (!cart.length) {
    itemsDiv.innerHTML = '<div class="cart-empty">'+esc(tr('購物車是空的'))+'</div>'
    totalEl.textContent = 'NT$ 0'
    checkoutBtn.disabled = true
    return
  }

  itemsDiv.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="ci-info">
        <div class="ci-name" title="${esc(item.name)}">${esc(cartLineName(item))}</div>
        <div class="ci-price">NT$ ${esc(item.price)} / ${esc(item.unit || tr('個'))}</div>
      </div>
      <div class="ci-controls">
        <button data-action="removeFromCart" data-pid="${esc(item.id)}" ${draftLocked()||pendingOrderRequest||journalBlocked||menuBusy||submitting?'disabled':''}>-</button>
        <span class="ci-qty">${item.qty}</span>
        <button data-action="addToCart" data-pid="${esc(item.id)}" ${draftLocked()||pendingOrderRequest||journalBlocked||menuBusy||submitting?'disabled':''}>+</button>
      </div>
      <span class="ci-subtotal">NT$ ${Math.round(item.price*100)*item.qty/100}</span>
    </div>
  `).join('')

  totalEl.textContent = 'NT$ ' + getCartTotal()
  checkoutBtn.disabled = draftLocked()||journalBlocked||!!currentOrderId||menuBusy||submitting
  document.body.dataset.menuBusy=String(menuBusy)
}

function toggleCart() {
  const overlay = document.getElementById('cart-overlay')
  const panel = document.getElementById('cart-panel')
  const isOpen = panel.classList.contains('open')
  if (isOpen) {
    panel.classList.remove('open')
    overlay.classList.remove('open')
  } else {
    updateCartUI()
    panel.classList.add('open')
    overlay.classList.add('open')
  }
  saveDraft()
}

// ===== 訂單提交 =====
async function submitOrder() {
  if(pendingOrderRequest){
    if(!draftUI?.originalReady||journalBlocked||submitting)return
    cart=structuredClone(journal.quote);toggleCart();document.getElementById('order-form-overlay').style.display='flex';applyMenuLanguage();return
  }
  if (!cart.length||draftLocked()||journalBlocked||currentOrderId||menuBusy||submitting||heldPicker) return
  const token=draftUI.token
  if(optionMenu)try{await changeSelectedCart(cart.map(row=>row.selection))}catch(e){noticeError(e);return}
  if(!draftUI.isCurrent(token))return
  toggleCart()
  document.getElementById('form-total').textContent = 'NT$ ' + getCartTotal()
  document.getElementById('order-form-overlay').style.display = 'flex'
  renderFormQuote()
  saveDraft()
}

function closeOrderForm() {
  document.getElementById('order-form-overlay').style.display = 'none'
  saveDraft()
}

async function reviewOrdinaryCart(token){
  const expected=assertCartContext(cartContext),params=new URLSearchParams(location.search),query=new URLSearchParams()
  for(const key of ['table','key'])if(params.has(key))query.set(key,params.get(key))
  let data
  try{const response=await fetch(API+'/api/menu'+(query.size?'?'+query:''));data=await response.json();if(!response.ok||!data.success)throw Error('menu')}catch{throw Error('無法核對餐點，請確認網路後重試。')}
  if(!draftUI.isCurrent(token))throw staleWork()
  const current=assertCartContext(data.cartContext)
  if(current.mode!=='ordinary'||data.storeId!==storeId||current.scopeId!==expected.scopeId)throw Error('這張桌碼或店面已變更，請重新掃描。')
  const before=menuCanonical(cart),next=cart.map(row=>{
    const product=data.products.find(product=>product.id===row.id)
    if(!product||!Number.isFinite(product.stock)||product.stock<row.qty)throw Error('餐點選項或可用量已變更，請重新確認。')
    return {...row,name:product.name,price:product.price,unit:product.unit}
  })
  customerQuoteTotal(next)
  products=data.products;categories=data.categories;cart=next;cartContext=current
  renderCategories();renderProducts();updateCartUI();renderFormQuote()
  saveDraft()
  return menuCanonical(next)===before
}

async function confirmOrder() {
  if (submitting||journalBlocked||!draftUI?.originalReady||!pendingOrderRequest&&draftLocked()) return
  const attempt=++orderSequence,token=draftUI.token
  submitting = true
  document.querySelector('[data-action="closeOrderForm"]').disabled=true
  const btn = document.querySelector('.order-form .btn-primary')
  if (btn) { btn.disabled = true; btn.textContent = tr('送出中...') }

  const customerName = document.getElementById('customer-name').value.trim()
  const tableNum = document.getElementById('table-num').value.trim()
  const note = document.getElementById('order-note').value.trim()

  const orderItems = cart.map(c => ({ id: c.id, qty: c.qty }))
  for(const id of ['customer-name','table-num','order-note'])document.getElementById(id).readOnly=true
  updateCartUI();renderProducts()

  try {
    if(typeof storeId!=='string'||!storeId)throw Error('店面身份需要核對')
    const durable=await draftUI.runWriter(()=>readCustomerJournal(localStorage))
    if(attempt!==orderSequence||!draftUI.isCurrent(token))return
    if(durable){
      if(durable.storeId!==storeId)throw Error('店面已變更，請向店家核對原訂單')
      journal=durable
      if(durable.phase==='confirmed'){currentOrderId=durable.ack.orderId;trackingToken=durable.ack.trackingToken;pendingOrderRequest=null;cart=[];closeOrderForm();showSuccess(currentOrderId,durable.ack.total);await verifyConfirmedOriginal();return}
      pendingOrderRequest=durable.request
    }
    if(!pendingOrderRequest){
      if(optionMenu)try{const old=menuCanonical(cart.map(({id,name,price,qty})=>({id,name,price,qty})));await changeSelectedCart(cart.map(row=>row.selection));if(menuCanonical(cart.map(({id,name,price,qty})=>({id,name,price,qty})))!==old){showWarning('菜單價格已更新，請確認新金額後送出。');renderFormQuote();return}}catch(e){noticeError(e);return}
      else try{if(!await reviewOrdinaryCart(token)){showWarning('餐點內容已更新，請確認後再送出。');return}}catch(e){noticeError(e);return}
      if(attempt!==orderSequence||!draftUI.isCurrent(token))return
      if(menuContextInvalid)throw Error('這張桌碼已失效，請向店家確認')
      const proof=await draftUI.prepare(),params=new URLSearchParams(location.search),request={items:optionMenu?menuReview.input:orderItems,...(optionMenu?{menuProtocol:PUBLIC_MENU_PROTOCOL,menuReview}:{}),customerName,tableNum,note,requestId:proof.documentId,...(tableContext?{table:tableContext.id,key:params.get('key')}:{})}
      journal=await draftUI.runWriter(()=>beginCustomerRequest(localStorage,storeId,request,cart,{cartContext:assertCartContext(cartContext),cartDraft:proof}));pendingOrderRequest=journal.request
    }else{const saved=readCustomerJournal(localStorage);if(!saved||saved.phase!=='pending'||saved.storeId!==storeId||saved.signature!==journal.signature)throw Error('這台裝置的原訂單需要核對，紀錄已保留')}
    if(attempt!==orderSequence||!draftUI.isCurrent(token))return
    const res = await fetch(API + '/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',...cartContextHeaders(journal.cartContext) },
      body: JSON.stringify(pendingOrderRequest),
    })
    const data = await res.json()
    if(attempt!==orderSequence||!draftUI.isCurrent(token))return
    if (data.success) {
      const ack=assertCustomerAcknowledgement(pendingOrderRequest,data,journal),check=await fetch(API+'/api/order/'+encodeURIComponent(ack.orderId),{headers:{Authorization:'Bearer '+ack.trackingToken}}),verified=await check.json()
      assertCustomerProgress(ack,verified)
      if(attempt!==orderSequence||!draftUI.isCurrent(token))return
      journal=await draftUI.runWriter(()=>confirmCustomerRequest(localStorage,pendingOrderRequest,ack),{clearProof:journal.cartDraft})
      if(attempt!==orderSequence||!draftUI.isCurrent(token))return
      currentOrderId = ack.orderId
      trackingToken = ack.trackingToken
      confirmedVerified=true
      pendingOrderRequest = null
      showWarning('')
      closeOrderForm()
      showSuccess(data.orderId, data.total)
      updateOrderStatus(verified.order.status,verified.order.fulfilmentStatus,verified.order.pickupNumber)
      cart = []
      updateCartUI()
    } else {
      if(res.status===400&&data.committed===false){await draftUI.runWriter(()=>rejectUncommittedRequest(localStorage,pendingOrderRequest));if(attempt!==orderSequence||!draftUI.isCurrent(token))return;pendingOrderRequest=null;journal=null;for(const id of ['customer-name','table-num','order-note'])document.getElementById(id).readOnly=id==='table-num'&&!!tableContext;if(data.code==='CART_CONTEXT_CHANGED')menuContextInvalid=true;if(menuContextInvalid)journalBlocked=true}
      showWarning(data.error || '訂單送出失敗')
    }
  } catch (err) {
    if(attempt!==orderSequence||!draftUI.isCurrent(token))return
    try{const saved=readCustomerJournal(localStorage);if(saved?.phase==='pending'){journal=saved;pendingOrderRequest=saved.request;cart=structuredClone(saved.quote);if(saved.storeId!==storeId)journalBlocked=true}}catch{journalBlocked=true}
    showWarning(journalBlocked?'這台裝置的原訂單需要核對，紀錄已保留':pendingOrderRequest?'連線中斷，結果尚未確認。再次送出會使用原請求編號，請勿另外建立訂單。':'這台裝置無法保留原單，請先確認儲存空間')
  } finally {
    if(attempt!==orderSequence)return
    submitting = false
    if (btn) { btn.disabled = journalBlocked; btn.textContent = tr(pendingOrderRequest?'核對原訂單':'確認送出') }
    applyMenuLanguage()
  }
}

function showSuccess(orderId, total) {
  lastTotal=total
  document.getElementById('success-order-id').textContent = tr('訂單編號: {0}',{0:orderId})
  updateOrderStatus('pending')
  document.getElementById('order-success').style.display = 'flex'
  document.getElementById('success-order-total').textContent=tr('訂單金額 NT$ {0}',{0:total})
  document.getElementById('success-table-label').textContent=journal?.request.tableNum?tr('桌號 {0}',{0:journal.request.tableNum}):''
  const quoted=journal?.quote?customerQuoteTotal(journal.quote,{allowZero:journal.request.menuProtocol===PUBLIC_MENU_PROTOCOL}):total;document.getElementById('success-order-price-change').textContent=quoted!==total?tr('金額已更新：原 {0}，店家 {1}；請向店家確認。',{0:quoted,1:total}):''
}

function updateOrderStatus(status,fulfilmentStatus='',pickupNumber=null) {
  lastOrderStatus=status
  lastFulfilmentStatus=fulfilmentStatus
  if(Number.isSafeInteger(pickupNumber)&&pickupNumber>0)lastPickupNumber=pickupNumber
  document.getElementById('success-pickup-number').textContent=lastPickupNumber?tr('取餐號 {0}',{0:String(lastPickupNumber).padStart(3,'0')}):''
  const statusEl = document.getElementById('success-status')
  if (!statusEl) return
  const labels = {
    pending: '等待店家確認中...',
    accepted: '店家已接單，準備中！',
    completed: '已完成，請取餐！',
    rejected: '很抱歉，訂單已被取消',
    uncertain:'店家正在核對原單，請勿重新下單',
  }
  const kitchen={reserved:'店家已接單，排隊備餐中',cooking:'餐點製作中',ready:'餐點好了，請向店家取餐',dispatched:'餐點配送中',completed:'餐點已交付',cancelled:'很抱歉，訂單已被取消'}
  statusEl.textContent = tr(kitchen[fulfilmentStatus]||labels[status] || status)
}

async function resetApp() {
  if(!draftUI?.originalReady||journalBlocked)return
  if(pendingOrderRequest){showWarning('上次送單尚未確認，請核對原訂單');return}
  try{if(journal){await verifyConfirmedOriginal();await draftUI.runWriter(()=>clearCustomerRequest(localStorage,journal.request.requestId))}}catch(e){noticeError(e);return}
  journal=null;trackingToken=null;journalBlocked=menuContextInvalid;showWarning(menuContextInvalid?'這張桌碼已失效，請向店家確認':'')
  lastPickupNumber=null;lastFulfilmentStatus='';lastOrderStatus='pending'
  cart=[];updateCartUI()
  currentOrderId = null
  confirmedVerified=false
  document.getElementById('order-success').style.display = 'none'
  document.getElementById('customer-name').value = ''
  document.getElementById('customer-name').readOnly=false;document.getElementById('table-num').readOnly=!!tableContext;document.getElementById('order-note').readOnly=false
  document.getElementById('table-num').value = tableContext?.label||''
  document.getElementById('order-note').value = ''
  renderProducts()
  draftUI.restoreCurrent()
}

// 啟動
document.getElementById('search-input').addEventListener('input', e => setSearch(e.target.value))
for(const id of ['customer-name','table-num','order-note'])document.getElementById(id).addEventListener('input',saveDraft)
document.getElementById('menu-language').addEventListener('change',e=>{const result=setDisplayPreferences({locale:e.target.value});preferenceFailed=!result.persisted;applyMenuLanguage()})
document.getElementById('menu-style').addEventListener('change',e=>{const result=setDisplayPreferences({style:e.target.value});preferenceFailed=!result.persisted;applyMenuLanguage()})
subscribeDisplayPreferences(applyMenuLanguage)
applyMenuLanguage()
init()

document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button)return
  const actions={toggleCart,submitOrder,closeOrderForm,confirmOrder,resetApp,addToCart,removeFromCart}
  Promise.resolve(actions[button.dataset.action]?.(button.dataset.pid)).catch(noticeError)
})
