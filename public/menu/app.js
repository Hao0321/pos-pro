// 顧客點餐頁面 — vanilla JS
import {tr,trMessage} from '../i18n/core.mjs'
import {getDisplayPreferences,setDisplayPreferences,subscribeDisplayPreferences,initDisplayPreferences} from '../i18n/preferences.mjs'
import {readCustomerJournal,beginCustomerRequest,confirmCustomerRequest,clearCustomerRequest,rejectUncommittedRequest,assertCustomerAcknowledgement,assertCustomerProgress,customerQuoteTotal} from './orderJournal.mjs'
const API = window.location.origin
let products = []
let categories = []
let cart = []
let activeCategory = null
let ws = null
let currentOrderId = null
let submitting = false
let storeName=null,storeNameIsDefault=false,lastOrderStatus='pending',menuFailed=false,preferenceFailed=false
let storeId=null,tableContext=null,journal=null,journalBlocked=false,menuContextInvalid=false,warning='',lastFulfilmentStatus='',lastTotal=0,lastPickupNumber=null
function showWarning(message){warning=message;document.getElementById('customer-order-warning').textContent=trMessage(message)}

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
  document.querySelector('.order-form [data-action="confirmOrder"]').disabled=submitting||journalBlocked
  document.getElementById('cart-fab').setAttribute('aria-label',tr('購物車'))
  document.querySelector('.cart-header .close-btn').setAttribute('aria-label',tr('關閉購物車'))
  if(currentOrderId)document.getElementById('success-order-id').textContent=tr('訂單編號: {0}',{0:currentOrderId})
  document.getElementById('customer-order-warning').textContent=trMessage(warning)
  const originalTable=(pendingOrderRequest||currentOrderId&&journal?.request)?.tableNum;document.getElementById('table-context').textContent=originalTable?tr('原訂單桌號 {0}',{0:originalTable}):tableContext?tr('桌號 {0}',{0:tableContext.label}):''
  if(currentOrderId){document.getElementById('success-table-label').textContent=journal?.request.tableNum?tr('桌號 {0}',{0:journal.request.tableNum}):'';document.getElementById('success-order-total').textContent=tr('訂單金額 NT$ {0}',{0:lastTotal});const quoted=journal?.quote?customerQuoteTotal(journal.quote):lastTotal;document.getElementById('success-order-price-change').textContent=quoted!==lastTotal?tr('金額已更新：原 {0}，店家 {1}；請向店家確認。',{0:quoted,1:lastTotal}):''}
  document.getElementById('pending-order-reference').hidden=!pendingOrderRequest;document.getElementById('pending-order-id').textContent=pendingOrderRequest?'CO'+pendingOrderRequest.requestId:''
  if(pendingOrderRequest)for(const [id,key]of [['customer-name','customerName'],['table-num','tableNum'],['order-note','note']]){document.getElementById(id).value=pendingOrderRequest[key]||'';document.getElementById(id).readOnly=true}
  updateOrderStatus(lastOrderStatus,lastFulfilmentStatus,lastPickupNumber);renderCategories();renderProducts();updateCartUI()
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
      products = data.products
      categories = data.categories
      storeName=data.storeName
      storeNameIsDefault=data.storeNameIsDefault===true
      storeId=data.storeId??null;tableContext=data.table??null
      if(data.tableRequired&&!tableContext&&!journal){journalBlocked=true;showWarning('請掃描桌上的點餐碼')}
      if(tableContext){document.getElementById('table-num').value=tableContext.label;document.getElementById('table-num').readOnly=true}
      if(journal){
        if(journal.storeId!==storeId){journalBlocked=true;showWarning('店面已變更，請向店家核對原訂單')}
        if(journal.phase==='confirmed'){currentOrderId=journal.ack.orderId;trackingToken=journal.ack.trackingToken;showSuccess(currentOrderId,journal.ack.total);if(journalBlocked)updateOrderStatus('uncertain')}
        else{cart=structuredClone(journal.quote);for(const [id,key]of [['customer-name','customerName'],['table-num','tableNum'],['order-note','note']]){document.getElementById(id).value=journal.request[key]||'';document.getElementById(id).readOnly=true};document.getElementById('form-total').textContent='NT$ '+customerQuoteTotal(journal.quote);document.getElementById('order-form-overlay').style.display='flex';if(!journalBlocked)showWarning('上次送單尚未確認，請核對原訂單')}
      }
      applyMenuLanguage()
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
  btn.onclick = () => {
    activeCategory = value
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    renderProducts()
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
    const inCart = cart.find(c => c.id === p.id)
    const qtyBadge = inCart ? `<div class="qty-badge">${inCart.qty}</div>` : ''
    const stock = Number(p.stock) || 0
    const soldOut = stock <= 0
    const lastFew = stock > 0 && stock <= 3
    const low = stock > 0 && stock <= 5
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
        <button class="add-btn" data-pid="${esc(p.id)}" ${soldOut||journalBlocked||pendingOrderRequest||currentOrderId ? 'disabled' : ''}>${esc(tr(soldOut ? '售完' : '加入購物車'))}</button>
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
}

// ===== 購物車 =====
function addToCart(productId) {
  if(journalBlocked||pendingOrderRequest||currentOrderId)return
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
}

function removeFromCart(productId) {
  if(journalBlocked||pendingOrderRequest)return
  const idx = cart.findIndex(c => c.id === productId)
  if (idx < 0) return
  if (cart[idx].qty > 1) cart[idx].qty--
  else cart.splice(idx, 1)
  updateCartUI()
  renderProducts()
}

function deleteFromCart(productId) {
  if(journalBlocked||pendingOrderRequest)return
  cart = cart.filter(c => c.id !== productId)
  updateCartUI()
  renderProducts()
}

function getCartTotal() {
  return customerQuoteTotal(cart)
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
        <div class="ci-name">${esc(item.name)}</div>
        <div class="ci-price">NT$ ${esc(item.price)} / ${esc(item.unit || tr('個'))}</div>
      </div>
      <div class="ci-controls">
        <button data-action="removeFromCart" data-pid="${esc(item.id)}" ${pendingOrderRequest||journalBlocked?'disabled':''}>-</button>
        <span class="ci-qty">${item.qty}</span>
        <button data-action="addToCart" data-pid="${esc(item.id)}" ${pendingOrderRequest||journalBlocked?'disabled':''}>+</button>
      </div>
      <span class="ci-subtotal">NT$ ${Math.round(item.price*100)*item.qty/100}</span>
    </div>
  `).join('')

  totalEl.textContent = 'NT$ ' + getCartTotal()
  checkoutBtn.disabled = journalBlocked||!!currentOrderId
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
}

// ===== 訂單提交 =====
function submitOrder() {
  if (!cart.length||journalBlocked||currentOrderId) return
  toggleCart()
  document.getElementById('form-total').textContent = 'NT$ ' + getCartTotal()
  document.getElementById('order-form-overlay').style.display = 'flex'
}

function closeOrderForm() {
  document.getElementById('order-form-overlay').style.display = 'none'
}

function newOrderRequestId() {
  // getRandomValues also works on private-network HTTP where randomUUID may
  // be unavailable. The server still validates the exact UUID v4 identity.
  const bytes=crypto.getRandomValues(new Uint8Array(16))
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
}

async function confirmOrder() {
  if (submitting||journalBlocked) return
  submitting = true
  const btn = document.querySelector('.order-form .btn-primary')
  if (btn) { btn.disabled = true; btn.textContent = tr('送出中...') }

  const customerName = document.getElementById('customer-name').value.trim()
  const tableNum = document.getElementById('table-num').value.trim()
  const note = document.getElementById('order-note').value.trim()

  const orderItems = cart.map(c => ({ id: c.id, qty: c.qty }))

  try {
    if(typeof storeId!=='string'||!storeId)throw Error('店面身份需要核對')
    const durable=readCustomerJournal(localStorage)
    if(durable){
      if(durable.storeId!==storeId)throw Error('店面已變更，請向店家核對原訂單')
      journal=durable
      if(durable.phase==='confirmed'){currentOrderId=durable.ack.orderId;trackingToken=durable.ack.trackingToken;pendingOrderRequest=null;cart=[];closeOrderForm();showSuccess(currentOrderId,durable.ack.total);return}
      pendingOrderRequest=durable.request
    }
    if(!pendingOrderRequest){
      if(menuContextInvalid)throw Error('這張桌碼已失效，請向店家確認')
      const params=new URLSearchParams(location.search),request={items:orderItems,customerName,tableNum,note,requestId:newOrderRequestId(),...(tableContext?{table:tableContext.id,key:params.get('key')}:{})}
      journal=beginCustomerRequest(localStorage,storeId,request,cart);pendingOrderRequest=journal.request
    }else{const saved=readCustomerJournal(localStorage);if(!saved||saved.phase!=='pending'||saved.storeId!==storeId||saved.signature!==journal.signature)throw Error('這台裝置的原訂單需要核對，紀錄已保留')}
    const res = await fetch(API + '/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingOrderRequest),
    })
    const data = await res.json()
    if (data.success) {
      const ack=assertCustomerAcknowledgement(pendingOrderRequest,data),check=await fetch(API+'/api/order/'+encodeURIComponent(ack.orderId),{headers:{Authorization:'Bearer '+ack.trackingToken}}),verified=await check.json()
      assertCustomerProgress(ack,verified)
      journal=confirmCustomerRequest(localStorage,pendingOrderRequest,ack)
      currentOrderId = ack.orderId
      trackingToken = ack.trackingToken
      pendingOrderRequest = null
      showWarning('')
      closeOrderForm()
      showSuccess(data.orderId, data.total)
      updateOrderStatus(verified.order.status,verified.order.fulfilmentStatus,verified.order.pickupNumber)
      cart = []
      updateCartUI()
    } else {
      if(res.status===400&&data.committed===false){rejectUncommittedRequest(localStorage,pendingOrderRequest);pendingOrderRequest=null;journal=null;for(const id of ['customer-name','table-num','order-note'])document.getElementById(id).readOnly=id==='table-num'&&!!tableContext;if(menuContextInvalid)journalBlocked=true}
      showWarning(data.error || '訂單送出失敗')
    }
  } catch (err) {
    try{const saved=readCustomerJournal(localStorage);if(saved?.phase==='pending'){journal=saved;pendingOrderRequest=saved.request;cart=structuredClone(saved.quote);if(saved.storeId!==storeId)journalBlocked=true}}catch{journalBlocked=true}
    showWarning(journalBlocked?'這台裝置的原訂單需要核對，紀錄已保留':pendingOrderRequest?'連線中斷，結果尚未確認。再次送出會使用原請求編號，請勿另外建立訂單。':'這台裝置無法保留原單，請先確認儲存空間')
  } finally {
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
  const quoted=journal?.quote?customerQuoteTotal(journal.quote):total;document.getElementById('success-order-price-change').textContent=quoted!==total?tr('金額已更新：原 {0}，店家 {1}；請向店家確認。',{0:quoted,1:total}):''
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

function resetApp() {
  if(pendingOrderRequest){showWarning('上次送單尚未確認，請核對原訂單');return}
  try{if(journal)clearCustomerRequest(localStorage,journal.request.requestId)}catch(e){journalBlocked=true;showWarning(e.message);return}
  journal=null;trackingToken=null;journalBlocked=menuContextInvalid;showWarning(menuContextInvalid?'這張桌碼已失效，請向店家確認':'')
  lastPickupNumber=null;lastFulfilmentStatus='';lastOrderStatus='pending'
  cart=[];updateCartUI()
  currentOrderId = null
  document.getElementById('order-success').style.display = 'none'
  document.getElementById('customer-name').value = ''
  document.getElementById('customer-name').readOnly=false;document.getElementById('table-num').readOnly=!!tableContext;document.getElementById('order-note').readOnly=false
  document.getElementById('table-num').value = tableContext?.label||''
  document.getElementById('order-note').value = ''
  renderProducts()
}

// 啟動
document.getElementById('search-input').addEventListener('input', e => setSearch(e.target.value))
document.getElementById('menu-language').addEventListener('change',e=>{const result=setDisplayPreferences({locale:e.target.value});preferenceFailed=!result.persisted;applyMenuLanguage()})
document.getElementById('menu-style').addEventListener('change',e=>{const result=setDisplayPreferences({style:e.target.value});preferenceFailed=!result.persisted;applyMenuLanguage()})
subscribeDisplayPreferences(applyMenuLanguage)
applyMenuLanguage()
init()

document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button)return
  const actions={toggleCart,submitOrder,closeOrderForm,confirmOrder,resetApp,addToCart,removeFromCart}
  actions[button.dataset.action]?.(button.dataset.pid)
})
