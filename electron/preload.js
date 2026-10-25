const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  auth: {
    list: legacy => ipcRenderer.invoke('auth:list', legacy),
    setup: input => ipcRenderer.invoke('auth:setup', input),
    login: input => ipcRenderer.invoke('auth:login', input),
    session: () => ipcRenderer.invoke('auth:session'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  // ----- Products -----
  db: {
    previewMasterMigration: input=>ipcRenderer.invoke('db:previewMasterMigration',input),
    applyMasterMigration: input=>ipcRenderer.invoke('db:applyMasterMigration',input),
    getReservationState: ()=>ipcRenderer.invoke('db:getReservationState'),
    getReservationDiningContext: input=>ipcRenderer.invoke('db:getReservationDiningContext',input),
    getReservationAvailability: input=>ipcRenderer.invoke('db:getReservationAvailability',input),
    applyReservationOperation: input=>ipcRenderer.invoke('db:applyReservationOperation',input),
    previewOpeningMigration: input=>ipcRenderer.invoke('db:previewOpeningMigration',input),
    applyOpeningMigration: input=>ipcRenderer.invoke('db:applyOpeningMigration',input),
    getPrivateDraftContext:()=>ipcRenderer.invoke('db:getPrivateDraftContext'),
    getLoyaltyProgramPreview:input=>ipcRenderer.invoke('db:getLoyaltyProgramPreview',input),
    applyLoyaltyProgram:input=>ipcRenderer.invoke('db:applyLoyaltyProgram',input),
    lookupPrivateDraftOriginal:input=>ipcRenderer.invoke('db:lookupPrivateDraftOriginal',input),
    getStockAccountingState:()=>ipcRenderer.invoke('db:getStockAccountingState'),
    getStockSalesState:()=>ipcRenderer.invoke('db:getStockSalesState'),
    getStockHistory:input=>ipcRenderer.invoke('db:getStockHistory',input),
    getAgentContext:()=>ipcRenderer.invoke('db:getAgentContext'),
    getExchangeContext:()=>ipcRenderer.invoke('db:getExchangeContext'),
    applyExchangeOperation:input=>ipcRenderer.invoke('db:applyExchangeOperation',input),
    getSalesState:()=>ipcRenderer.invoke('db:getSalesState'),
    applySalesOperation:input=>ipcRenderer.invoke('db:applySalesOperation',input),
    applyCustomerLedgerOperation:input=>ipcRenderer.invoke('db:applyCustomerLedgerOperation',input),
    getSupplierState:()=>ipcRenderer.invoke('db:getSupplierState'),
    applySupplierLedgerOperation:input=>ipcRenderer.invoke('db:applySupplierLedgerOperation',input),
    rememberAgentMappings:input=>ipcRenderer.invoke('db:rememberAgentMappings',input),
    getRestaurantState:()=>ipcRenderer.invoke('db:getRestaurantState'),
    getRestaurantMenuQuote:input=>ipcRenderer.invoke('db:getRestaurantMenuQuote',input),
    getRestaurantMenuSetupPreview:input=>ipcRenderer.invoke('db:getRestaurantMenuSetupPreview',input),
    getRestaurantAgentPreview:input=>ipcRenderer.invoke('db:getRestaurantAgentPreview',input),
    getTableOrderingContext:()=>ipcRenderer.invoke('db:getTableOrderingContext'),
    getCustomerIntakeContext:id=>ipcRenderer.invoke('db:getCustomerIntakeContext',id),
    getKitchenPrintState:()=>ipcRenderer.invoke('db:getKitchenPrintState'),
    applyKitchenPrintOperation:input=>ipcRenderer.invoke('db:applyKitchenPrintOperation',input),
    applyRestaurantOperation:input=>ipcRenderer.invoke('db:applyRestaurantOperation',input),
    getStoreSnapshot:()=>ipcRenderer.invoke('db:getStoreSnapshot'),
    getProducts: () => ipcRenderer.invoke('db:getProducts'),
    applyInventoryOperation:input=>ipcRenderer.invoke('db:applyInventoryOperation',input),
    applyScenarioTemplate: input => ipcRenderer.invoke('db:applyScenarioTemplate', input),
    getScenarioTemplateReceipt: id => ipcRenderer.invoke('db:getScenarioTemplateReceipt', id),
    addProduct: (data) => ipcRenderer.invoke('db:addProduct', data),
    updateProduct: (id, data) => ipcRenderer.invoke('db:updateProduct', id, data),
    deleteProduct: (id) => ipcRenderer.invoke('db:deleteProduct', id),
    findByBarcode: (code) => ipcRenderer.invoke('db:findByBarcode', code),

    getMembers: () => ipcRenderer.invoke('db:getMembers'),
    addMember: (data) => ipcRenderer.invoke('db:addMember', data),
    updateMember: (id, data) => ipcRenderer.invoke('db:updateMember', id, data),
    deleteMember: (id) => ipcRenderer.invoke('db:deleteMember', id),

    checkoutReceipt: id => ipcRenderer.invoke('db:checkoutReceipt', id),
    getOrders: () => ipcRenderer.invoke('db:getOrders'),
    addOrder: (data) => ipcRenderer.invoke('db:addOrder', data),
    getOrderItems: (orderId) => ipcRenderer.invoke('db:getOrderItems', orderId),
    checkout: (orderData, stockUpdates, memberUpdate, cartBinding) =>
      ipcRenderer.invoke('db:checkout', orderData, stockUpdates, memberUpdate,cartBinding),

    getCustomerOrders: () => ipcRenderer.invoke('db:getCustomerOrders'),
    updateOrderStatus: (id, status) => ipcRenderer.invoke('db:updateOrderStatus', id, status),

    getSuppliers: () => ipcRenderer.invoke('db:getSuppliers'),
    addSupplier: (data) => ipcRenderer.invoke('db:addSupplier', data),
    updateSupplier: (id, data) => ipcRenderer.invoke('db:updateSupplier', id, data),
    deleteSupplier: (id) => ipcRenderer.invoke('db:deleteSupplier', id),

    getPurchases: () => ipcRenderer.invoke('db:getPurchases'),
    addPurchase: (data) => ipcRenderer.invoke('db:addPurchase', data),
    updatePurchase: (id, data) => ipcRenderer.invoke('db:updatePurchase', id, data),
    deletePurchase: (id) => ipcRenderer.invoke('db:deletePurchase', id),

    getPromotions: () => ipcRenderer.invoke('db:getPromotions'),
    addPromotion: (data) => ipcRenderer.invoke('db:addPromotion', data),
    updatePromotion: (id, data) => ipcRenderer.invoke('db:updatePromotion', id, data),
    deletePromotion: (id) => ipcRenderer.invoke('db:deletePromotion', id),

    getUsers: () => ipcRenderer.invoke('db:getUsers'),
    addUser: (data) => ipcRenderer.invoke('db:addUser', data),
    updateUser: (id, data) => ipcRenderer.invoke('db:updateUser', id, data),
    deleteUser: (id) => ipcRenderer.invoke('db:deleteUser', id),

    getAuditLogs: (filters) => ipcRenderer.invoke('db:getAuditLogs', filters),
    writeAuditLog: (entry) => ipcRenderer.invoke('db:writeAuditLog', entry),

    getManualJournal: () => ipcRenderer.invoke('db:getManualJournal'),
    addManualEntry: (data) => ipcRenderer.invoke('db:addManualEntry', data),
    deleteManualEntry: (id) => ipcRenderer.invoke('db:deleteManualEntry', id),

    getBackups: () => ipcRenderer.invoke('db:getBackups'),
    createBackup: (label, createdBy) => ipcRenderer.invoke('db:createBackup', label, createdBy),
    restoreBackup: (id,options) => ipcRenderer.invoke('db:restoreBackup', id,options),
    previewRestore: input=>ipcRenderer.invoke('db:previewRestore',input),
    applyRestorePreview: id=>ipcRenderer.invoke('db:applyRestorePreview',id),
    lookupRestorePreview: id=>ipcRenderer.invoke('db:lookupRestorePreview',id),
    getRecoveryState: pending=>ipcRenderer.invoke('db:getRecoveryState',pending),
    applyRecoveryOperation: input=>ipcRenderer.invoke('db:applyRecoveryOperation',input),
    lookupRecoveryOperation: input=>ipcRenderer.invoke('db:lookupRecoveryOperation',input),
    exportRecoverySource: id=>ipcRenderer.invoke('db:exportRecoverySource',id),
    exportRecoveryDiagnostics: ()=>ipcRenderer.invoke('db:exportRecoveryDiagnostics'),
    exportData: () => ipcRenderer.invoke('db:exportData'),
    exportFullBackup: () => ipcRenderer.invoke('db:exportFullBackup'),
    getProtectedBackups: () => ipcRenderer.invoke('db:getProtectedBackups'),
    getStocktakeState: () => ipcRenderer.invoke('db:getStocktakeState'),
    getLotState: () => ipcRenderer.invoke('db:getLotState'),
    applyLotOperation: input => ipcRenderer.invoke('db:applyLotOperation',input),
    getWarehouseState: () => ipcRenderer.invoke('db:getWarehouseState'),
    applyWarehouseOperation: input => ipcRenderer.invoke('db:applyWarehouseOperation',input),
    getStockSetupAccess: () => ipcRenderer.invoke('db:getStockSetupAccess'),
    getStockSetupState: () => ipcRenderer.invoke('db:getStockSetupState'),
    previewStockSetup: input => ipcRenderer.invoke('db:previewStockSetup',input),
    applyStockSetupOperation: input => ipcRenderer.invoke('db:applyStockSetupOperation',input),
    getRefundContext: () => ipcRenderer.invoke('db:getRefundContext'),
    previewRefund: input => ipcRenderer.invoke('db:previewRefund',input),
    importData: (data, expectedRevision) => ipcRenderer.invoke('db:importData', data, expectedRevision),

    migrateFromLocalStorage: (data) => ipcRenderer.invoke('db:migrateFromLocalStorage', data),
    isEmpty: () => ipcRenderer.invoke('db:isEmpty'),

    // ----- Refund -----
    refundOrder: (origId, refundData, stockUpdates, memberUpdate) =>
      ipcRenderer.invoke('db:refundOrder', origId, refundData, stockUpdates, memberUpdate),

    // ----- Held Orders -----
    getHeldOrders: () => ipcRenderer.invoke('db:getHeldOrders'),
    addHeldOrder: (data) => ipcRenderer.invoke('db:addHeldOrder', data),
    deleteHeldOrder: (id) => ipcRenderer.invoke('db:deleteHeldOrder', id),

    // ----- Shifts -----
    getShifts: () => ipcRenderer.invoke('db:getShifts'),
    getOpenShift: () => ipcRenderer.invoke('db:getOpenShift'),
    openShift: (data) => ipcRenderer.invoke('db:openShift', data),
    closeShift: (id, data) => ipcRenderer.invoke('db:closeShift', id, data),
    getCashLog: (shiftId) => ipcRenderer.invoke('db:getCashLog', shiftId),
    addCashLog: (data) => ipcRenderer.invoke('db:addCashLog', data),

    // ----- Waste -----
    getWasteLog: () => ipcRenderer.invoke('db:getWasteLog'),
    addWaste: (data) => ipcRenderer.invoke('db:addWaste', data),
    deleteWaste: (id) => ipcRenderer.invoke('db:deleteWaste', id),

    // ----- Topups -----
    getTopups: (memberId) => ipcRenderer.invoke('db:getTopups', memberId),
    addTopup: (data) => ipcRenderer.invoke('db:addTopup', data),
  },

  // ----- Printer -----
  printer: {
    printReceipt: (orderData) => ipcRenderer.invoke('printer:printReceipt', orderData),
    openCashDrawer: () => ipcRenderer.invoke('printer:openCashDrawer'),
    testPrint: () => ipcRenderer.invoke('printer:testPrint'),
    getStatus: () => ipcRenderer.invoke('printer:getStatus'),
  },

  // ----- Barcode -----
  barcode: {
    generate: (text, options) => ipcRenderer.invoke('barcode:generate', text, options),
    generateLabel: (product) => ipcRenderer.invoke('barcode:generateLabel', product),
    printLabels: (products, copies) => ipcRenderer.invoke('barcode:printLabels', products, copies),
  },

  // ----- Settings -----
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setMany: values => ipcRenderer.invoke('settings:setMany',values),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
  },

  // ----- Server -----
  onReservationChanged:(callback)=>{const handler=()=>callback();ipcRenderer.on('reservation:changed',handler);return()=>ipcRenderer.removeListener('reservation:changed',handler)},
  server: {
    getLocalIP: () => ipcRenderer.invoke('server:getLocalIP'),
    getStatus: () => ipcRenderer.invoke('server:getStatus'),
  },

  // ----- Events -----
  shared:{getStatus:()=>ipcRenderer.invoke('shared:getStatus'),start:input=>ipcRenderer.invoke('shared:start',input),stop:()=>ipcRenderer.invoke('shared:stop'),pair:()=>ipcRenderer.invoke('shared:pair'),revoke:id=>ipcRenderer.invoke('shared:revoke',id),certificate:()=>ipcRenderer.invoke('shared:certificate')},
  onStoreChanged:callback=>{const handler=()=>callback();ipcRenderer.on('store:changed',handler);return()=>ipcRenderer.removeListener('store:changed',handler)},
  onNewOrder: (callback) => {
    const handler = (_e, order) => callback(order)
    ipcRenderer.on('customer-order:new', handler)
    return () => ipcRenderer.removeListener('customer-order:new', handler)
  },
})
