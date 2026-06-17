const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os = require('os')

let mainWindow = null
let db = null
let orderServer = null

// 單一實例鎖定
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'POS Pro 雜貨店管理系統',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 載入 renderer
  const isDev = !app.isPackaged
  if (isDev) {
    // 生產模式用 build 好的 dist
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ===== 初始化 =====
app.whenReady().then(async () => {
  // 初始化 SQLite 資料庫
  const initDatabase = require('./database')
  const dbPath = path.join(app.getPath('userData'), 'pos-data.db')
  db = initDatabase(dbPath)

  // 啟動顧客點餐伺服器
  try {
    const startOrderServer = require('./server')
    const serverPort = db.getSetting('serverPort') || '3080'
    orderServer = startOrderServer(parseInt(serverPort), db, () => mainWindow)
  } catch (err) {
    console.log('[POS] 點餐伺服器啟動失敗，POS 功能正常:', err.message)
  }

  // 註冊所有 IPC handlers
  registerIpcHandlers()

  createWindow()
})

app.on('window-all-closed', () => {
  if (orderServer) orderServer.close()
  if (db) db.close()
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})

// ===== IPC Handlers =====
function registerIpcHandlers() {
  // ----- Products -----
  ipcMain.handle('db:getProducts', () => db.getProducts())
  ipcMain.handle('db:addProduct', (_e, data) => db.addProduct(data))
  ipcMain.handle('db:updateProduct', (_e, id, data) => db.updateProduct(id, data))
  ipcMain.handle('db:deleteProduct', (_e, id) => db.deleteProduct(id))
  ipcMain.handle('db:findByBarcode', (_e, code) => db.findByBarcode(code))

  // ----- Members -----
  ipcMain.handle('db:getMembers', () => db.getMembers())
  ipcMain.handle('db:addMember', (_e, data) => db.addMember(data))
  ipcMain.handle('db:updateMember', (_e, id, data) => db.updateMember(id, data))
  ipcMain.handle('db:deleteMember', (_e, id) => db.deleteMember(id))

  // ----- Orders -----
  ipcMain.handle('db:getOrders', () => db.getOrders())
  ipcMain.handle('db:addOrder', (_e, data) => db.addOrder(data))
  ipcMain.handle('db:getOrderItems', (_e, orderId) => db.getOrderItems(orderId))

  // ----- Checkout (atomic) -----
  ipcMain.handle('db:checkout', (_e, orderData, stockUpdates, memberUpdate) => {
    return db.checkout(orderData, stockUpdates, memberUpdate)
  })

  // ----- Customer Orders -----
  ipcMain.handle('db:getCustomerOrders', () => db.getCustomerOrders())
  ipcMain.handle('db:updateOrderStatus', (_e, id, status) => {
    const result = db.updateOrderStatus(id, status)
    // 通知 WebSocket 客戶端
    if (orderServer && orderServer.broadcast) {
      orderServer.broadcast(JSON.stringify({ type: 'order-status', orderId: id, status }))
    }
    return result
  })

  // ----- Suppliers -----
  ipcMain.handle('db:getSuppliers', () => db.getSuppliers())
  ipcMain.handle('db:addSupplier', (_e, data) => db.addSupplier(data))
  ipcMain.handle('db:updateSupplier', (_e, id, data) => db.updateSupplier(id, data))
  ipcMain.handle('db:deleteSupplier', (_e, id) => db.deleteSupplier(id))

  // ----- Purchases -----
  ipcMain.handle('db:getPurchases', () => db.getPurchases())
  ipcMain.handle('db:addPurchase', (_e, data) => db.addPurchase(data))
  ipcMain.handle('db:updatePurchase', (_e, id, data) => db.updatePurchase(id, data))
  ipcMain.handle('db:deletePurchase', (_e, id) => db.deletePurchase(id))

  // ----- Promotions -----
  ipcMain.handle('db:getPromotions', () => db.getPromotions())
  ipcMain.handle('db:addPromotion', (_e, data) => db.addPromotion(data))
  ipcMain.handle('db:updatePromotion', (_e, id, data) => db.updatePromotion(id, data))
  ipcMain.handle('db:deletePromotion', (_e, id) => db.deletePromotion(id))

  // ----- Users -----
  ipcMain.handle('db:getUsers', () => db.getUsers())
  ipcMain.handle('db:addUser', (_e, data) => db.addUser(data))
  ipcMain.handle('db:updateUser', (_e, id, data) => db.updateUser(id, data))
  ipcMain.handle('db:deleteUser', (_e, id) => db.deleteUser(id))

  // ----- Audit Log -----
  ipcMain.handle('db:getAuditLogs', (_e, filters) => db.getAuditLogs(filters))
  ipcMain.handle('db:writeAuditLog', (_e, entry) => db.writeAuditLog(entry))

  // ----- Manual Journal -----
  ipcMain.handle('db:getManualJournal', () => db.getManualJournal())
  ipcMain.handle('db:addManualEntry', (_e, data) => db.addManualEntry(data))
  ipcMain.handle('db:deleteManualEntry', (_e, id) => db.deleteManualEntry(id))

  // ----- Backups -----
  ipcMain.handle('db:getBackups', () => db.getBackups())
  ipcMain.handle('db:createBackup', (_e, label, createdBy) => db.createBackup(label, createdBy))
  ipcMain.handle('db:restoreBackup', (_e, id) => db.restoreBackup(id))
  ipcMain.handle('db:exportData', () => db.exportData())
  ipcMain.handle('db:importData', (_e, data) => db.importData(data))

  // ----- Settings -----
  ipcMain.handle('settings:get', (_e, key) => db.getSetting(key))
  ipcMain.handle('settings:set', (_e, key, value) => db.setSetting(key, value))
  ipcMain.handle('settings:getAll', () => db.getAllSettings())

  // ----- Migration -----
  ipcMain.handle('db:migrateFromLocalStorage', (_e, data) => db.migrateFromLocalStorage(data))
  ipcMain.handle('db:isEmpty', () => db.isEmpty())

  // ----- Refund -----
  ipcMain.handle('db:refundOrder', (_e, origId, refundData, stockUpdates, memberUpdate) =>
    db.refundOrder(origId, refundData, stockUpdates, memberUpdate))

  // ----- Held Orders -----
  ipcMain.handle('db:getHeldOrders', () => db.getHeldOrders())
  ipcMain.handle('db:addHeldOrder', (_e, data) => db.addHeldOrder(data))
  ipcMain.handle('db:deleteHeldOrder', (_e, id) => db.deleteHeldOrder(id))

  // ----- Shifts -----
  ipcMain.handle('db:getShifts', () => db.getShifts())
  ipcMain.handle('db:getOpenShift', () => db.getOpenShift())
  ipcMain.handle('db:openShift', (_e, data) => db.openShift(data))
  ipcMain.handle('db:closeShift', (_e, id, data) => db.closeShift(id, data))
  ipcMain.handle('db:getCashLog', (_e, shiftId) => db.getCashLog(shiftId))
  ipcMain.handle('db:addCashLog', (_e, data) => db.addCashLog(data))

  // ----- Waste -----
  ipcMain.handle('db:getWasteLog', () => db.getWasteLog())
  ipcMain.handle('db:addWaste', (_e, data) => db.addWaste(data))
  ipcMain.handle('db:deleteWaste', (_e, id) => db.deleteWaste(id))

  // ----- Topups -----
  ipcMain.handle('db:getTopups', (_e, memberId) => db.getTopups(memberId))
  ipcMain.handle('db:addTopup', (_e, data) => db.addTopup(data))

  // ----- Printer -----
  ipcMain.handle('printer:printReceipt', async (_e, orderData) => {
    const printer = require('./printer')
    return printer.printReceipt(orderData, db.getAllSettings())
  })
  ipcMain.handle('printer:openCashDrawer', async () => {
    const printer = require('./printer')
    return printer.openCashDrawer(db.getAllSettings())
  })
  ipcMain.handle('printer:testPrint', async () => {
    const printer = require('./printer')
    return printer.testPrint(db.getAllSettings())
  })
  ipcMain.handle('printer:getStatus', async () => {
    const printer = require('./printer')
    return printer.getStatus(db.getAllSettings())
  })

  // ----- Barcode -----
  ipcMain.handle('barcode:generate', async (_e, text, options) => {
    const barcode = require('./barcode')
    return barcode.generateBarcode(text, options)
  })
  ipcMain.handle('barcode:generateLabel', async (_e, product) => {
    const barcode = require('./barcode')
    return barcode.generateLabel(product)
  })
  ipcMain.handle('barcode:printLabels', async (_e, products, copies) => {
    const barcode = require('./barcode')
    return barcode.printLabels(products, copies, db.getAllSettings())
  })

  // ----- Server Info -----
  ipcMain.handle('server:getLocalIP', () => getLocalIP())
  ipcMain.handle('server:getStatus', () => ({
    running: !!orderServer,
    ip: getLocalIP(),
    port: orderServer?.getActualPort?.() || db.getSetting('serverPort') || '3080',
    tunnelUrl: orderServer?.getTunnelUrl?.() || null,
  }))
}
