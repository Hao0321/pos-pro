/**
 * 顧客點餐伺服器
 * Express HTTP + WebSocket
 * 自動啟動 Cloudflare Tunnel 讓外網（不同網路）也能掃碼點餐
 */
const express = require('express')
const { WebSocketServer } = require('ws')
const path = require('path')
const net = require('net')

module.exports = function startOrderServer(port, db, getMainWindow) {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  // 提供客人點餐頁面
  app.use('/menu', express.static(path.join(__dirname, '../public/menu')))

  // ===== API =====
  app.get('/api/menu', (req, res) => {
    try {
      const products = db.getProducts().filter(p => p.stock > 0 && p.price > 0)
      const categories = [...new Set(products.map(p => p.category))]
      const storeName = db.getSetting('storeName') || '雜貨店'
      res.json({ success: true, products, categories, storeName })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  app.post('/api/order', (req, res) => {
    try {
      const { items, note, tableNum, customerName } = req.body
      if (!items || !items.length) {
        return res.status(400).json({ success: false, error: '請至少選擇一項商品' })
      }

      let subtotal = 0
      const validItems = []
      for (const item of items) {
        const product = db.getProducts().find(p => p.id === item.id)
        if (!product) continue
        if (product.stock < item.qty) continue
        validItems.push({
          id: product.id, productId: product.id,
          name: product.name, price: product.price, qty: item.qty,
        })
        subtotal += product.price * item.qty
      }

      if (!validItems.length) {
        return res.status(400).json({ success: false, error: '所選商品無庫存' })
      }

      const order = {
        id: 'CO' + Date.now(), items: validItems,
        subtotal, discount: 0, total: subtotal,
        payMethod: 'pending', paid: 0, change: 0,
        memberId: '', pointsUsed: 0, pointsEarned: 0,
        time: new Date().toISOString(),
        source: 'customer', status: 'pending',
        tableNum: tableNum || '',
        note: (customerName ? customerName + ': ' : '') + (note || ''),
      }

      db.addOrder(order)

      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('customer-order:new', order)
      }
      broadcast(JSON.stringify({ type: 'order-created', order }))

      res.json({ success: true, orderId: order.id, total: order.total })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  app.get('/api/order/:id', (req, res) => {
    try {
      const orders = db.getOrders()
      const order = orders.find(o => o.id === req.params.id)
      if (!order) return res.status(404).json({ success: false, error: '找不到訂單' })
      res.json({ success: true, order: { id: order.id, status: order.status, total: order.total } })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  app.get('/api/info', (req, res) => {
    res.json({ storeName: db.getSetting('storeName') || '雜貨店', version: '2.0.0' })
  })

  // ===== Server 啟動 =====
  const clients = new Set()
  let server = null
  let actualPort = port
  let tunnelUrl = null
  let tunnelStop = null

  function broadcast(message) {
    for (const client of clients) {
      try { if (client.readyState === 1) client.send(message) } catch {}
    }
  }

  function tryPort(p) {
    return new Promise((resolve) => {
      const tester = net.createServer()
      tester.once('error', () => resolve(false))
      tester.once('listening', () => { tester.close(); resolve(true) })
      tester.listen(p, '0.0.0.0')
    })
  }

  async function boot() {
    // 找可用 port
    for (let p = port; p < port + 10; p++) {
      if (await tryPort(p)) {
        actualPort = p
        break
      }
    }

    // 啟動 HTTP server
    server = await new Promise((resolve) => {
      const s = app.listen(actualPort, '0.0.0.0', () => {
        console.log(`[POS] 點餐伺服器已啟動: http://0.0.0.0:${actualPort}`)
        resolve(s)
      })
      s.on('error', (err) => {
        console.log(`[POS] 伺服器啟動失敗: ${err.message}`)
        resolve(null)
      })
    })

    if (!server) return

    // WebSocket
    const wss = new WebSocketServer({ server })
    wss.on('connection', (ws) => {
      clients.add(ws)
      ws.on('close', () => clients.delete(ws))
      ws.on('error', () => clients.delete(ws))
    })

    // 自動啟動 Cloudflare Tunnel（免費、無警告頁面、客人掃碼直接進入）
    try {
      const { bin: cfBin } = require('cloudflared')
      const { execFile } = require('child_process')

      const cfChild = execFile(cfBin, ['tunnel', '--url', `http://localhost:${actualPort}`, '--no-autoupdate'])
      tunnelStop = () => { try { cfChild.kill() } catch {} }

      // 從 stderr 中解析 tunnel URL
      cfChild.stderr.on('data', (data) => {
        const text = data.toString()
        const match = text.match(/https:\/\/[^\s]+\.trycloudflare\.com/)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          console.log(`[POS] 外網點餐網址: ${tunnelUrl}/menu`)
        }
      })
      cfChild.on('exit', () => { tunnelUrl = null; console.log('[POS] 外網穿透已斷線') })
    } catch (err) {
      console.log('[POS] 外網穿透啟動失敗:', err.message)
    }
  }

  boot()

  return {
    app,
    broadcast,
    getActualPort: () => actualPort,
    getTunnelUrl: () => tunnelUrl,
    close: () => { if (tunnelStop) tunnelStop(); if (server) server.close() },
  }
}
