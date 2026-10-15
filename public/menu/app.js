// 顧客點餐頁面 — vanilla JS
import {tr,trMessage} from '../i18n/core.mjs'
import {getDisplayPreferences,setDisplayPreferences,subscribeDisplayPreferences,initDisplayPreferences} from '../i18n/preferences.mjs'
const API = window.location.origin
let products = []
let categories = []
let cart = []
let activeCategory = null
let ws = null
let currentOrderId = null
let submitting = false
let storeName=null,lastOrderStatus='pending',menuFailed=false,preferenceFailed=false

function applyMenuLanguage(){
  initDisplayPreferences()
  for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=tr(el.dataset.i18n)
  for(const el of document.querySelectorAll('[data-i18n-placeholder]'))el.placeholder=tr(el.dataset.i18nPlaceholder)
  const prefs=getDisplayPreferences();document.getElementById('menu-language').value=prefs.locale;document.getElementById('menu-style').value=prefs.style
  document.getElementById('menu-language').setAttribute('aria-label',tr('語言'));document.getElementById('menu-style').setAttribute('aria-label',tr('介面風格'))
  document.getElementById('preference-warning').textContent=preferenceFailed?tr('這次已切換；這台裝置無法記住偏好，下次開啟需重新選擇。'):''
  document.getElementById('store-name').textContent=storeName??tr(menuFailed?'無法連線':'載入中...')
  document.title=storeName?storeName+' - '+tr('線上點餐'):tr('線上點餐')
  document.getElementById('checkout-btn').textContent=tr('送出訂單')
  document.querySelector('.order-form [data-action="confirmOrder"]').textContent=tr(submitting?'送出中...':'確認送出')
  document.getElementById('cart-fab').setAttribute('aria-label',tr('購物車'))
  document.querySelector('.cart-header .close-btn').setAttribute('aria-label',tr('關閉購物車'))
  if(currentOrderId)document.getElementById('success-order-id').textContent=tr('訂單編號: {0}',{0:currentOrderId})
  updateOrderStatus(lastOrderStatus);renderCategories();renderProducts();updateCartUI()
}

// 防 XSS：跳脫 HTML 特殊字元
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

// ===== 初始化 =====
async function init() {
  try {
    const res = await fetch(API + '/api/menu')
    const data = await res.json()
    if (data.success) {
      products = data.products
      categories = data.categories
      storeName=data.storeName
      applyMenuLanguage()
    }else{throw Error('Menu unavailable')
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
    if(!currentOrderId || !trackingToken)return
    try{
      const r=await fetch(API+'/api/order/'+encodeURIComponent(currentOrderId),{headers:{Authorization:'Bearer '+trackingToken}})
      const data=await r.json();if(data.success)updateOrderStatus(data.order.status)
    }catch{}
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
        <button class="add-btn" data-pid="${esc(p.id)}" ${soldOut ? 'disabled' : ''}>${esc(tr(soldOut ? '售完' : '加入購物車'))}</button>
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
  const product = products.find(p => p.id === productId)
  if (!product) return
  const existing = cart.find(c => c.id === productId)
  if (existing) {
    if (existing.qty >= product.stock) return // 不能超過庫存
    existing.qty++
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit })
  }
  updateCartUI()
  renderProducts() // 更新數量 badge
}

function removeFromCart(productId) {
  const idx = cart.findIndex(c => c.id === productId)
  if (idx < 0) return
  if (cart[idx].qty > 1) cart[idx].qty--
  else cart.splice(idx, 1)
  updateCartUI()
  renderProducts()
}

function deleteFromCart(productId) {
  cart = cart.filter(c => c.id !== productId)
  updateCartUI()
  renderProducts()
}

function getCartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0)
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
        <button data-action="removeFromCart" data-pid="${esc(item.id)}">-</button>
        <span class="ci-qty">${item.qty}</span>
        <button data-action="addToCart" data-pid="${esc(item.id)}">+</button>
      </div>
      <span class="ci-subtotal">NT$ ${item.price * item.qty}</span>
    </div>
  `).join('')

  totalEl.textContent = 'NT$ ' + getCartTotal()
  checkoutBtn.disabled = false
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
  if (!cart.length) return
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
  if (submitting) return
  submitting = true
  const btn = document.querySelector('.order-form .btn-primary')
  if (btn) { btn.disabled = true; btn.textContent = tr('送出中...') }

  const customerName = document.getElementById('customer-name').value.trim()
  const tableNum = document.getElementById('table-num').value.trim()
  const note = document.getElementById('order-note').value.trim()

  const orderItems = cart.map(c => ({ id: c.id, qty: c.qty }))

  try {
    pendingOrderRequest ||= {items:orderItems,customerName,tableNum,note,requestId:newOrderRequestId()}
    const res = await fetch(API + '/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingOrderRequest),
    })
    const data = await res.json()
    if (data.success) {
      currentOrderId = data.orderId
      trackingToken = data.trackingToken
      pendingOrderRequest = null
      closeOrderForm()
      showSuccess(data.orderId, data.total)
      cart = []
      updateCartUI()
    } else {
      if(res.status===400)pendingOrderRequest=null
      alert(trMessage(data.error || '訂單送出失敗'))
    }
  } catch (err) {
    alert(tr('連線中斷，結果尚未確認。再次送出會使用原請求編號，請勿另外建立訂單。'))
  }
  submitting = false
  if (btn) { btn.disabled = false; btn.textContent = tr('確認送出') }
}

function showSuccess(orderId, total) {
  document.getElementById('success-order-id').textContent = tr('訂單編號: {0}',{0:orderId})
  updateOrderStatus('pending')
  document.getElementById('order-success').style.display = 'flex'
}

function updateOrderStatus(status) {
  lastOrderStatus=status
  const statusEl = document.getElementById('success-status')
  if (!statusEl) return
  const labels = {
    pending: '等待店家確認中...',
    accepted: '店家已接單，準備中！',
    completed: '已完成，請取餐！',
    rejected: '很抱歉，訂單已被取消',
  }
  statusEl.textContent = tr(labels[status] || status)
}

function resetApp() {
  currentOrderId = null
  document.getElementById('order-success').style.display = 'none'
  document.getElementById('customer-name').value = ''
  document.getElementById('table-num').value = ''
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
