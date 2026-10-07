module.exports = function registerIpcHandlers({ ipcMain, db, ipcSecurity, getOrderServer, getLocalIP }) {
  const orderServer = getOrderServer()
  function handle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      ipcSecurity.authorize(event, channel, args)
      return handler(event, ...args)
    })
  }
  ipcMain.handle('auth:list', (e, legacy) => ipcSecurity.list(e, legacy))
  ipcMain.handle('auth:setup', (e, input) => ipcSecurity.setup(e, input))
  ipcMain.handle('auth:login', (e, input) => ipcSecurity.login(e, input))
  ipcMain.handle('auth:session', e => { ipcSecurity.trusted(e); return ipcSecurity.current() })
  ipcMain.handle('auth:logout', e => ipcSecurity.logout(e))
  handle('db:checkoutReceipt', (_e, id) => db.checkoutReceipt(id))
  // ----- Products -----
  handle('db:getProducts', () => db.getProducts())
  handle('db:addProduct', (_e, data) => db.addProduct(data))
  handle('db:updateProduct', (_e, id, data) => db.updateProduct(id, data))
  handle('db:deleteProduct', (_e, id) => db.deleteProduct(id))
  handle('db:findByBarcode', (_e, code) => db.findByBarcode(code))

  // ----- Members -----
  handle('db:getMembers', () => db.getMembers())
  handle('db:addMember', (_e, data) => db.addMember(data))
  handle('db:updateMember', (_e, id, data) => db.updateMember(id, data))
  handle('db:deleteMember', (_e, id) => db.deleteMember(id))

  // ----- Orders -----
  handle('db:getOrders', () => db.getOrders())
  handle('db:addOrder', (_e, data) => db.addOrder(data))
  handle('db:getOrderItems', (_e, orderId) => db.getOrderItems(orderId))

  // ----- Checkout (atomic) -----
  handle('db:checkout', (_e, orderData, stockUpdates, memberUpdate) => {
    return db.checkout(orderData, stockUpdates, memberUpdate)
  })

  // ----- Customer Orders -----
  handle('db:getCustomerOrders', () => db.getCustomerOrders())
  handle('db:updateOrderStatus', (_e, id, status) => {
    const result = db.updateOrderStatus(id, status)
    // 通知 WebSocket 客戶端
    if (orderServer && orderServer.broadcast) {
      orderServer.broadcast(JSON.stringify({ type: 'order-status', orderId: id, status }))
    }
    return result
  })

  // ----- Suppliers -----
  handle('db:getSuppliers', () => db.getSuppliers())
  handle('db:addSupplier', (_e, data) => db.addSupplier(data))
  handle('db:updateSupplier', (_e, id, data) => db.updateSupplier(id, data))
  handle('db:deleteSupplier', (_e, id) => db.deleteSupplier(id))

  // ----- Purchases -----
  handle('db:getPurchases', () => db.getPurchases())
  handle('db:addPurchase', (_e, data) => db.addPurchase(data))
  handle('db:updatePurchase', (_e, id, data) => db.updatePurchase(id, data))
  handle('db:deletePurchase', (_e, id) => db.deletePurchase(id))

  // ----- Promotions -----
  handle('db:getPromotions', () => db.getPromotions())
  handle('db:addPromotion', (_e, data) => db.addPromotion(data))
  handle('db:updatePromotion', (_e, id, data) => db.updatePromotion(id, data))
  handle('db:deletePromotion', (_e, id) => db.deletePromotion(id))

  // ----- Users -----
  handle('db:getUsers', () => db.getUsers())
  handle('db:addUser', (_e, data) => { ipcSecurity.validateUser(data); return db.addUser(data) })
  handle('db:updateUser', (_e, id, data) => {
    const users = db.getUsers(), old = users.find(u => u.id === id)
    if (!old) throw new Error('帳號不存在')
    const next = { ...old, ...data }; ipcSecurity.validateUser(next)
    if (old.role === 'owner' && next.role !== 'owner' && users.filter(u => u.role === 'owner').length < 2) throw new Error('必須保留管理員')
    return db.updateUser(id, data)
  })
  handle('db:deleteUser', (_e, id) => {
    const users = db.getUsers(), target = users.find(u => u.id === id)
    if (id === ipcSecurity.current()?.userId || (target?.role === 'owner' && users.filter(u => u.role === 'owner').length < 2)) throw new Error('不可刪除目前或最後一位管理員')
    return db.deleteUser(id)
  })

  // ----- Audit Log -----
  handle('db:getAuditLogs', (_e, filters) => db.getAuditLogs(filters))
  handle('db:writeAuditLog', (_e, entry) => db.writeAuditLog(entry))

  // ----- Manual Journal -----
  handle('db:getManualJournal', () => db.getManualJournal())
  handle('db:addManualEntry', (_e, data) => db.addManualEntry(data))
  handle('db:deleteManualEntry', (_e, id) => db.deleteManualEntry(id))

  // ----- Backups -----
  handle('db:getBackups', () => db.getBackups())
  handle('db:createBackup', (_e, label, createdBy) => db.createBackup(label, createdBy))
  handle('db:restoreBackup', (_e, id) => db.restoreBackup(id))
  handle('db:exportData', () => db.exportData())
  handle('db:importData', (_e, data, expectedRevision) => db.importData(data, expectedRevision))

  // ----- Settings -----
  handle('settings:get', (_e, key) => db.getSetting(key))
  handle('settings:set', (_e, key, value) => db.setSetting(key, value))
  handle('settings:getAll', () => db.getAllSettings())

  // ----- Migration -----
  handle('db:migrateFromLocalStorage', (_e, data) => db.migrateFromLocalStorage(data))
  handle('db:isEmpty', () => db.isEmpty())

  // ----- Refund -----
  handle('db:refundOrder', (_e, origId, refundData, stockUpdates, memberUpdate) =>
    db.refundOrder(origId, refundData, stockUpdates, memberUpdate))

  // ----- Held Orders -----
  handle('db:getHeldOrders', () => db.getHeldOrders())
  handle('db:addHeldOrder', (_e, data) => db.addHeldOrder(data))
  handle('db:deleteHeldOrder', (_e, id) => db.deleteHeldOrder(id))

  // ----- Shifts -----
  handle('db:getShifts', () => db.getShifts())
  handle('db:getOpenShift', () => db.getOpenShift())
  handle('db:openShift', (_e, data) => db.openShift(data))
  handle('db:closeShift', (_e, id, data) => db.closeShift(id, data))
  handle('db:getCashLog', (_e, shiftId) => db.getCashLog(shiftId))
  handle('db:addCashLog', (_e, data) => db.addCashLog(data))

  // ----- Waste -----
  handle('db:getWasteLog', () => db.getWasteLog())
  handle('db:addWaste', (_e, data) => db.addWaste(data))
  handle('db:deleteWaste', (_e, id) => db.deleteWaste(id))

  // ----- Topups -----
  handle('db:getTopups', (_e, memberId) => db.getTopups(memberId))
  handle('db:addTopup', (_e, data) => db.addTopup(data))

  // ----- Printer -----
  handle('printer:printReceipt', async (_e, orderData) => {
    const printer = require('./printer')
    return printer.printReceipt(orderData, db.getAllSettings())
  })
  handle('printer:openCashDrawer', async () => {
    const printer = require('./printer')
    return printer.openCashDrawer(db.getAllSettings())
  })
  handle('printer:testPrint', async () => {
    const printer = require('./printer')
    return printer.testPrint(db.getAllSettings())
  })
  handle('printer:getStatus', async () => {
    const printer = require('./printer')
    return printer.getStatus(db.getAllSettings())
  })

  // ----- Barcode -----
  handle('barcode:generate', async (_e, text, options) => {
    const barcode = require('./barcode')
    return barcode.generateBarcode(text, options)
  })
  handle('barcode:generateLabel', async (_e, product) => {
    const barcode = require('./barcode')
    return barcode.generateLabel(product)
  })
  handle('barcode:printLabels', async (_e, products, copies) => {
    const barcode = require('./barcode')
    return barcode.printLabels(products, copies, db.getAllSettings())
  })

  // ----- Server Info -----
  handle('server:getLocalIP', () => getLocalIP())
  handle('server:getStatus', () => ({
    running: orderServer?.isRunning?.() === true,
    ip: getLocalIP(),
    port: orderServer?.getActualPort?.() || db.getSetting('serverPort') || '3080',
    tunnelUrl: orderServer?.getTunnelUrl?.() || null,
  }))
}
