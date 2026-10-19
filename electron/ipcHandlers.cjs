module.exports = function registerIpcHandlers({ ipcMain, db, ipcSecurity, getOrderServer, getLocalIP,sharedStore,stockSetupEnabled=false }) {
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
  handle('db:getStoreSnapshot',()=>require('./storeSnapshot.cjs')(db,ipcSecurity.current()))
  handle('db:getStockAccountingState',()=>db.getStockAccountingState(ipcSecurity.current()))
  handle('db:getStockSalesState',()=>db.getStockSalesState(ipcSecurity.current()))
  handle('db:getStockHistory',(_e,input)=>db.getStockHistory(input,ipcSecurity.current()))
  handle('db:getLotState',()=>db.getLotState(ipcSecurity.current()))
  handle('db:applyLotOperation',(_e,input)=>db.applyLotOperation(input,ipcSecurity.current()))
  handle('db:getWarehouseState',()=>db.getWarehouseState(ipcSecurity.current()))
  handle('db:applyWarehouseOperation',(_e,input)=>db.applyWarehouseOperation(input,ipcSecurity.current()))
  handle('db:getStockSetupAccess',()=>({enabled:stockSetupEnabled===true}))
  handle('db:getStockSetupState',()=>{if(!stockSetupEnabled)throw Error('成本設定尚未開放新保存，請保留原編號核對');return db.getStockSetupState(ipcSecurity.current())})
  handle('db:previewStockSetup',(_e,input)=>{if(!stockSetupEnabled)throw Error('成本設定尚未開放新保存，請保留原編號核對');return db.previewStockSetup(input,ipcSecurity.current())})
  handle('db:applyStockSetupOperation',(_e,input)=>db.applyStockSetupOperation(input,ipcSecurity.current(),{allowNew:stockSetupEnabled===true}))
  handle('db:getRestaurantState',()=>db.getRestaurantState())
  handle('db:getRestaurantMenuQuote',(_e,input)=>db.getRestaurantMenuQuote(input,ipcSecurity.current()))
  handle('db:getRestaurantMenuSetupPreview',(_e,input)=>db.getRestaurantMenuSetupPreview(input,ipcSecurity.current()))
  handle('db:getRestaurantAgentPreview',(_e,input)=>db.getRestaurantAgentPreview(input,ipcSecurity.current()))
  handle('db:getTableOrderingContext',()=>db.getTableOrderingContext(ipcSecurity.current()))
  handle('db:getCustomerIntakeContext',(_e,id)=>db.getCustomerIntakeContext(id,ipcSecurity.current()))
  handle('db:getKitchenPrintState',()=>db.getKitchenPrintState(ipcSecurity.current()))
  handle('db:applyKitchenPrintOperation',(_e,input)=>db.applyKitchenPrintOperation(input,ipcSecurity.current()))
  handle('db:getAgentContext',()=>db.getAgentContext(ipcSecurity.current()))
  handle('db:previewMasterMigration',(_e,input)=>db.previewMasterMigration(input,ipcSecurity.current()))
  handle('db:applyMasterMigration',(_e,input)=>db.applyMasterMigration(input,ipcSecurity.current()))
  handle('db:getReservationState',()=>db.getReservationState(ipcSecurity.current()))
  handle('db:getReservationAvailability',(_e,input)=>db.getReservationAvailability(input,ipcSecurity.current()))
  handle('db:applyReservationOperation',(_e,input)=>db.applyReservationOperation(input,ipcSecurity.current()))
  handle('db:getReservationDiningContext',(_e,input)=>db.getReservationDiningContext(input,ipcSecurity.current()))
  handle('db:previewOpeningMigration',(_e,input)=>db.previewOpeningMigration(input,ipcSecurity.current()))
  handle('db:applyOpeningMigration',(_e,input)=>db.applyOpeningMigration(input,ipcSecurity.current()))
  handle('db:getPrivateDraftContext',()=>db.getPrivateDraftContext(ipcSecurity.current()))
  handle('db:lookupPrivateDraftOriginal',(_e,input)=>db.lookupPrivateDraftOriginal(input,ipcSecurity.current()))
  handle('db:getExchangeContext',()=>db.getExchangeContext(ipcSecurity.current()))
  handle('db:applyExchangeOperation',(_e,input)=>db.applyExchangeOperation(input,ipcSecurity.current()))
  handle('db:getSalesState',()=>db.getSalesState(ipcSecurity.current()))
  handle('db:applySalesOperation',(_e,input)=>db.applySalesOperation(input,ipcSecurity.current()))
  handle('db:applyCustomerLedgerOperation',(_e,input)=>db.applyCustomerLedgerOperation(input,ipcSecurity.current()))
  handle('db:getSupplierState',()=>db.getSupplierState(ipcSecurity.current()))
  handle('db:applySupplierLedgerOperation',(_e,input)=>db.applySupplierLedgerOperation(input,ipcSecurity.current()))
  handle('db:rememberAgentMappings',(_e,input)=>db.rememberAgentMappings(input,ipcSecurity.current()))
  handle('db:applyRestaurantOperation',(_e,input)=>db.applyRestaurantOperation(input,ipcSecurity.current()))
  handle('shared:getStatus',()=>sharedStore?.status()||{running:false,addresses:[]})
  handle('shared:start',(_e,input)=>sharedStore.start(input))
  handle('shared:stop',()=>sharedStore.stop())
  handle('shared:pair',()=>sharedStore.pair())
  handle('shared:revoke',(_e,id)=>sharedStore.revoke(id))
  handle('shared:certificate',()=>sharedStore.certificate())
  // ----- Products -----
  handle('db:getProducts', () => db.getProducts())
  handle('db:applyInventoryOperation',(_e,input)=>db.applyInventoryOperation(input,ipcSecurity.current()))
  handle('db:applyScenarioTemplate', (_e, input) => db.applyScenarioTemplate(input, ipcSecurity.current()))
  handle('db:getScenarioTemplateReceipt', (_e, id) => db.getScenarioTemplateReceipt(id, ipcSecurity.current()))
  handle('db:addProduct', (_e, data) => db.addProduct(data,ipcSecurity.current()))
  handle('db:updateProduct', (_e, id, data) => db.updateProduct(id, data,ipcSecurity.current()))
  handle('db:deleteProduct', (_e, id) => db.deleteProduct(id,ipcSecurity.current()))
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
    return db.checkout(orderData, stockUpdates, memberUpdate,ipcSecurity.current())
  })

  // ----- Customer Orders -----
  handle('db:getCustomerOrders', () => db.getCustomerOrders())
  handle('db:updateOrderStatus', (_e, id, status) => {
    const result = db.updateOrderStatus(id, status,ipcSecurity.current())
    // 通知 WebSocket 客戶端
    const orderServer=getOrderServer()
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
  handle('db:addManualEntry', (_e, data) => db.addManualEntry(data,ipcSecurity.current()))
  handle('db:deleteManualEntry', (_e, id) => db.deleteManualEntry(id,ipcSecurity.current()))

  // ----- Backups -----
  handle('db:getBackups', () => db.getBackups())
  handle('db:createBackup', (_e, label, createdBy) => db.createBackup(label, createdBy))
  handle('db:restoreBackup', (_e, id, options) => db.restoreBackup(id,options,ipcSecurity.current()))
  handle('db:exportData', () => db.exportData())
  handle('db:exportFullBackup', () => db.exportFullBackup(ipcSecurity.current()))
  handle('db:getProtectedBackups', () => db.getProtectedBackups(ipcSecurity.current()))
  handle('db:getStocktakeState', () => db.getStocktakeState(ipcSecurity.current()))
  handle('db:getRefundContext', () => db.getRefundContext(ipcSecurity.current()))
  handle('db:previewRefund', (_e,input) => db.previewRefund(input,ipcSecurity.current()))
  handle('db:importData', (_e, data, expectedRevision) => db.importData(data, expectedRevision,ipcSecurity.current()))
  handle('db:previewRestore',(_e,input)=>db.previewRestore(input,ipcSecurity.current()))
  handle('db:applyRestorePreview',(_e,id)=>db.applyRestorePreview(id,ipcSecurity.current()))
  handle('db:lookupRestorePreview',(_e,id)=>db.lookupRestorePreview(id,ipcSecurity.current()))
  handle('db:getRecoveryState',(_e,pending)=>db.getRecoveryState(pending,ipcSecurity.current()))
  handle('db:applyRecoveryOperation',(_e,input)=>db.applyRecoveryOperation(input,ipcSecurity.current()))
  handle('db:lookupRecoveryOperation',(_e,input)=>db.lookupRecoveryOperation(input,ipcSecurity.current()))
  handle('db:exportRecoverySource',(_e,id)=>db.exportRecoverySource(id,ipcSecurity.current()))
  handle('db:exportRecoveryDiagnostics',()=>db.exportRecoveryDiagnostics(ipcSecurity.current()))

  // ----- Settings -----
  handle('settings:get', (_e, key) => db.getSetting(key))
  handle('settings:set', (_e, key, value) => db.setSetting(key, value))
  handle('settings:setMany',(_e,values)=>db.setSettings(values))
  handle('settings:getAll', () => db.getAllSettings())

  // ----- Migration -----
  handle('db:migrateFromLocalStorage', (_e, data) => db.migrateFromLocalStorage(data,ipcSecurity.current()))
  handle('db:isEmpty', () => db.isEmpty())

  // ----- Refund -----
  handle('db:refundOrder', (_e, origId, refundData) =>
    db.refundOrder(origId, refundData, ipcSecurity.current()))

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
  handle('db:addWaste', (_e, data) => db.addWaste(data,ipcSecurity.current()))
  handle('db:deleteWaste', (_e, id) => db.deleteWaste(id))

  // ----- Topups -----
  handle('db:getTopups', (_e, memberId) => db.getTopups(memberId))
  handle('db:addTopup', (_e, data) => db.addTopup(data))

  // ----- Printer -----
  handle('printer:printReceipt', async (_e, orderData) => {
    const printer = require('./printer')
    const original=db.getOrder(orderData?.id)
    if(!original||original.source==='customer'||original.payMethod==='pending'||!['completed','refunded'].includes(original.status))throw Error('請先核對已保存的正式收款單')
    const saved=db.checkoutReceipt(original.id)
    if(saved?.success!==true||saved.order?.id!==original.id)throw Error('正式收款原單尚未確認，請先核對')
    return printer.printReceipt(saved.order, db.getAllSettings())
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
  handle('server:getStatus', () => {const orderServer=getOrderServer();return {
    running: orderServer?.isRunning?.() === true,
    ip: getLocalIP(),
    port: orderServer?.getActualPort?.() || db.getSetting('serverPort') || '3080',
    tunnelUrl: orderServer?.getTunnelUrl?.() || null,
  }})
}
