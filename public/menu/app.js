// 顧客點餐頁面 — vanilla JS
const API = window.location.origin
let products = []
let categories = []
let cart = []
let activeCategory = null
let ws = null
let currentOrderId = null
let submitting = false

// 防 XSS：跳脫 HTML 特殊字元
function esc(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

// ===== 初始化 =====
async function init() {
  try {
    const res = await fetch(API + '/api/menu')
    const data = await res.json()
    if (data.success) {
      products = data.products
      categories = data.categories
      document.getElementById('store-name').textContent = data.storeName
      document.title = data.storeName + ' - 線上點餐'
      renderCategories()
      renderProducts()
    }
  } catch (err) {
    document.getElementById('store-name').textContent = '無法連線'
    document.getElementById('product-list').innerHTML =
      '<p style="text-align:center;color:#888;padding:40px;grid-column:1/-1">無法載入菜單，請確認網路連線</p>'
  }
  connectWebSocket()
}

// ===== WebSocket =====
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  try {
    ws = new WebSocket(protocol + '//' + location.host)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'order-status' && msg.orderId === currentOrderId) {
          updateOrderStatus(msg.status)
        }
      } catch {}
    }
    ws.onclose = () => setTimeout(connectWebSocket, 3000)
    ws.onerror = () => {}
  } catch {}
}

// ===== 分類 =====
function renderCategories() {
  const nav = document.getElementById('categories')
  const allBtn = createCatBtn('全部', null)
  nav.appendChild(allBtn)
  categories.forEach(cat => nav.appendChild(createCatBtn(cat, cat)))
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
    if (soldOut) stockNote = `<span class="p-soldout">售完</span>`
    else if (lastFew) stockNote = `<span class="p-stock-last">最後 ${stock} ${esc(p.unit || '個')}！</span>`
    else if (low) stockNote = `<span class="p-stock-low">剩 ${stock} ${esc(p.unit || '個')}</span>`
    return `
      <div class="product-card${soldOut ? ' sold-out' : ''}">
        ${qtyBadge}
        <span class="p-category">${esc(p.category)}</span>
        <span class="p-name">${esc(p.name)}</span>
        <span class="p-price">$${p.price} <span class="p-unit">/ ${esc(p.unit || '個')}</span></span>
        ${stockNote}
        <button class="add-btn" data-pid="${esc(p.id)}" ${soldOut ? 'disabled' : ''}>${soldOut ? '售完' : '加入購物車'}</button>
      </div>
    `
  }).join('')

  if (!filtered.length) {
    list.innerHTML = '<p style="text-align:center;color:#888;padding:40px;grid-column:1/-1">沒有符合的商品</p>'
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
    itemsDiv.innerHTML = '<div class="cart-empty">購物車是空的</div>'
    totalEl.textContent = '$0'
    checkoutBtn.disabled = true
    return
  }

  itemsDiv.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="ci-info">
        <div class="ci-name">${esc(item.name)}</div>
        <div class="ci-price">$${item.price} / ${esc(item.unit || '個')}</div>
      </div>
      <div class="ci-controls">
        <button onclick="removeFromCart('${esc(item.id)}')">-</button>
        <span class="ci-qty">${item.qty}</span>
        <button onclick="addToCart('${esc(item.id)}')">+</button>
      </div>
      <span class="ci-subtotal">$${item.price * item.qty}</span>
    </div>
  `).join('')

  totalEl.textContent = '$' + getCartTotal()
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
  document.getElementById('form-total').textContent = '$' + getCartTotal()
  document.getElementById('order-form-overlay').style.display = 'flex'
}

function closeOrderForm() {
  document.getElementById('order-form-overlay').style.display = 'none'
}

async function confirmOrder() {
  if (submitting) return
  submitting = true
  const btn = document.querySelector('.order-form .btn-primary')
  if (btn) { btn.disabled = true; btn.textContent = '送出中...' }

  const customerName = document.getElementById('customer-name').value.trim()
  const tableNum = document.getElementById('table-num').value.trim()
  const note = document.getElementById('order-note').value.trim()

  const orderItems = cart.map(c => ({ id: c.id, qty: c.qty }))

  try {
    const res = await fetch(API + '/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: orderItems, customerName, tableNum, note }),
    })
    const data = await res.json()
    if (data.success) {
      currentOrderId = data.orderId
      closeOrderForm()
      showSuccess(data.orderId, data.total)
      cart = []
      updateCartUI()
    } else {
      alert(data.error || '訂單送出失敗')
    }
  } catch (err) {
    alert('無法連線到伺服器')
  }
  submitting = false
  if (btn) { btn.disabled = false; btn.textContent = '確認送出' }
}

function showSuccess(orderId, total) {
  document.getElementById('success-order-id').textContent = '訂單編號: ' + orderId
  document.getElementById('success-status').textContent = '等待店家確認中...'
  document.getElementById('order-success').style.display = 'flex'
}

function updateOrderStatus(status) {
  const statusEl = document.getElementById('success-status')
  if (!statusEl) return
  const labels = {
    pending: '等待店家確認中...',
    accepted: '店家已接單，準備中！',
    completed: '已完成，請取餐！',
    rejected: '很抱歉，訂單已被取消',
  }
  statusEl.textContent = labels[status] || status
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
init()
