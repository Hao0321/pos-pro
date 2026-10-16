const { createHash, randomUUID } = require('node:crypto')
const { prepareRefund, refundSignature } = require('./refundSafety.cjs')
const { prepareDatabaseCheckout, signature, PROTOCOL } = require('./checkoutContract.cjs')
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { summarizeShift } = require('./shiftReconciliation.mjs')
const {moneyValue,quantityValue,operationHeader,sameCommand,canonicalSignature}=require('./operationRules.mjs')

module.exports = function initDatabase(dbPath) {
  const db = new Database(dbPath)
  require('./databaseFeatureFence.cjs').register(db)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  require('./databaseSchema.cjs')(db)
  let stockStore
  try{stockStore=require('./stockLedgerStorage.cjs')(db)}catch(error){db.close();throw error}
  if(db.prepare('SELECT 1 FROM customer_entries LIMIT 1').get())require('./databaseFeatureFence.cjs').installCustomerFence(db)
  if(db.prepare('SELECT 1 FROM supplier_entries LIMIT 1').get())require('./databaseFeatureFence.cjs').installSupplierFence(db)
  const stmts = require('./databaseStatements.cjs')(db)

  const orderInsertParams = (o) => ({
    id: o.id,
    subtotal: o.subtotal || 0,
    discount: o.discount || 0,
    manualDiscount: o.manualDiscount || 0,
    balanceUsed: o.balanceUsed || 0,
    total: o.total || 0,
    payMethod: o.payMethod || 'cash',
    paid: o.paid || 0,
    change_amount: o.change || 0,
    payments: typeof o.payments === 'string' ? o.payments : JSON.stringify(o.payments || []),
    memberId: o.memberId || '',
    pointsUsed: o.pointsUsed || 0,
    pointsEarned: o.pointsEarned || 0,
    time: o.time || new Date().toISOString(),
    source: o.source || 'pos',
    status: o.status || 'completed',
    tableNum: o.tableNum || '',
    note: o.note || '',
    taxId: o.taxId || '',
    shiftId: o.shiftId || '',
    refundOf: o.refundOf || '',
    cashier: o.cashier || '',
    fullRefund: o.fullRefund ? 1 : 0,
    trackingTokenHash: o.trackingTokenHash || '',
    requestSignature: o.requestSignature || '',
    itemCosts: typeof o.itemCosts==='string'?o.itemCosts:JSON.stringify(o.itemCosts||{}),
  })

  // 廠商參數統一組裝：catalog（貨源清單）為 JSON 陣列，存 TEXT；三個寫入點（新增/更新/遷移）共用
  const supplierParams = (s, id) => ({
    // 亂數後綴：還原備份時迴圈連續插入，同毫秒撞 id 會讓整個 migrateTx rollback
    id: id || s.id || 's' + Date.now() + Math.random().toString(36).slice(2, 6),
    name: s.name || '',
    contact: s.contact || '',
    phone: s.phone || '',
    payTerms: s.payTerms || '',
    note: s.note || '',
    catalog: typeof s.catalog === 'string' ? s.catalog : JSON.stringify(s.catalog || []),
  })
  // 讀出時把 catalog 還原成陣列（壞 JSON 安全降級成空陣列）
  const parseSupplier = (row) => ({
    ...row,
    catalog: (() => { try { return JSON.parse(row.catalog || '[]') } catch { return [] } })(),
  })

  function readOrder(id) {
    const row = stmts.getOrderById.get(id)
    if (!row) return null
    return {...row,change:row.change_amount,memberId:row.memberId||null,fullRefund:!!row.fullRefund,itemCosts:JSON.parse(row.itemCosts||'{}'),payments:JSON.parse(row.payments || '[]'),
      items:stmts.getOrderItems.all(id).map(i=>({id:i.productId,name:i.name,price:i.price,qty:i.qty}))}
  }
  function checkoutReceipt(id) {
    const order=readOrder(id)
    if (!order) return {protocol:PROTOCOL,success:true,found:false}
    return {protocol:PROTOCOL,success:true,orderId:id,order,
      ...(order.status==='refunded'&&!order.refundOf?{refunds:db.prepare('SELECT id FROM orders WHERE refundOf=?').all(id).map(row=>readOrder(row.id))}:{}),
      products:order.items.map(i=>stmts.getProductById.get(i.id)).filter(Boolean),
      member:order.memberId ? stmts.getMemberById.get(order.memberId) || null : null}
  }
  const checkoutTx = db.transaction((orderData, stockUpdates, memberUpdate) => {
    const old=readOrder(orderData.id)
    if (old) {
      if (signature(old)!==signature(orderData)) throw new Error('單號已存在，內容不符')
      return {success:true,orderId:old.id}
    }
    const plan=prepareDatabaseCheckout(orderData,{
      product:id=>stmts.getProductById.get(id),member:id=>stmts.getMemberById.get(id),
      shift:id=>stmts.getShiftById.get(id),setting:key=>stmts.getSetting.get(key)?.value,
    })
    plan.order.itemCosts=Object.fromEntries(plan.order.items.map(i=>[i.id,stmts.getProductById.get(i.id).cost||0]))
    orderData=plan.order;stockUpdates=plan.stockUpdates;memberUpdate=plan.memberUpdate
    stmts.insertOrder.run(orderInsertParams(orderData))

    if (orderData.items) {
      for (const item of orderData.items) {
        stmts.insertOrderItem.run({
          orderId: orderData.id,
          productId: item.id || item.productId || '',
          name: item.name,
          price: item.price,
          qty: item.qty,
        })
      }
    }

    if (stockUpdates) {
      for (const su of stockUpdates) {
        stmts.updateProductStock.run({ id: su.id, delta: su.delta })
      }
    }

    if (memberUpdate && memberUpdate.id) {
      const member = stmts.getMemberById.get(memberUpdate.id)
      if (member) {
        stmts.updateMember.run({
          id: member.id,
          name: member.name,
          phone: member.phone,
          points: Math.max(0, (member.points || 0) + (memberUpdate.pointsDelta || 0)),
          tier: memberUpdate.tier || member.tier,
          totalSpent: Math.max(0, (member.totalSpent || 0) + (memberUpdate.spentDelta || 0)),
          balance: Math.max(0, (member.balance || 0) + (memberUpdate.balanceDelta || 0)),
          birthday: member.birthday || '',
          // 生日贈點發放月份要寫回 DB，否則重開程式後本月會員每筆結帳都重複贈點
          lastBirthdayBonus: memberUpdate.lastBirthdayBonus ?? member.lastBirthdayBonus ?? '',
          note:member.note||'',
        })
      }
    }

    return { success: true, orderId: orderData.id }
  })

  const refundTx = db.transaction(request => {
    const old=readOrder(request.id)
    if (old) {
      if (old.requestSignature!==refundSignature(request)) throw new Error('退貨單號內容不一致')
      return {...checkoutReceipt(old.id),original:readOrder(old.refundOf)}
    }
    const original=readOrder(request.refundOf)
    const previous=db.prepare('SELECT id FROM orders WHERE refundOf=?').all(request.refundOf).map(o=>readOrder(o.id))
    const plan=prepareRefund(original,previous,request,original?.memberId?stmts.getMemberById.get(original.memberId):null)
    if (plan.stockUpdates.some(u=>!stmts.getProductById.get(u.id))) throw new Error('退貨商品已不存在，請先核對庫存')
    stmts.insertOrder.run(orderInsertParams(plan.order))
    for (const i of plan.order.items) stmts.insertOrderItem.run({orderId:plan.order.id,productId:i.id,name:i.name,price:i.price,qty:i.qty})
    for (const u of plan.stockUpdates) stmts.updateProductStock.run(u)
    if (plan.member) stmts.updateMember.run(plan.member)
    if (plan.order.fullRefund) stmts.updateOrderStatus.run('refunded',original.id)
    return {...checkoutReceipt(plan.order.id),original:readOrder(original.id)}
  })

  const {migrateTx,replaceAllTx}=require('./databaseMigration.cjs')(db,stmts,orderInsertParams,supplierParams,stockStore)

  // ===== Public API =====
  const api={
    async getAgentContext(actor){
      if(!actor||!['owner','staff'].includes(actor.role))throw Error('請先登入')
      let storeId=this.getSetting('sharedStoreId');if(!storeId){storeId=require('node:crypto').randomUUID();this.setSetting('sharedStoreId',storeId)}
      return require('./agentDraftRules.mjs').makeAgentContext({storeId,products:this.getProducts(),suppliers:actor.role==='owner'?this.getSuppliers():[],restaurantConfig:this.getRestaurantState().config,role:actor.role,mappings:require('./businessDocument.mjs').readAgentMappings(this.getSetting('agentMappings'))})
    },
    rememberAgentMappings(input,actor){return db.transaction(()=>{const mappings=require('./businessDocument.mjs').mergeAgentMappings(stmts.getSetting.get('agentMappings')?.value,input,this.getProducts(),actor);stmts.setSetting.run('agentMappings',JSON.stringify(mappings));return {success:true,mappings}})()},
    ...require('./restaurantOperations.cjs')(db,stmts,readOrder,orderInsertParams),
    ...require('./scenarioTemplates.cjs')(db, stmts),
    ...require('./inventoryOperations.cjs')(db,stmts,supplierParams),
    ...require('./exchangeOperations.cjs')(db,stmts),
    ...require('./salesOperations.cjs')(db,stmts),
    ...require('./customerOperations.cjs')(db,stmts),
    ...require('./supplierOperations.cjs')(db,stmts),
    // Products
    getProducts() {
      return stmts.getAllProducts.all().map(p => ({ ...p, noBarcode: !!p.noBarcode }))
    },
    addProduct(data) {
      moneyValue(data.price??0,'售價');moneyValue(data.cost??0,'成本');quantityValue(data.stock??0,'庫存');quantityValue(data.reorderLevel??0,'安全庫存')
      const old=data.id&&stmts.getProductById.get(data.id)
      if(old){if(['name','price','cost','stock','barcode','category','supplierId'].some(k=>(old[k]??'')!==(data[k]??(typeof old[k]==='number'?0:''))))throw Error('商品編號已存在且內容不同，請核對已保存商品');return {success:true}}
      stmts.insertProduct.run({
        id: data.id || 'p' + Date.now(),
        name: data.name || '',
        category: data.category || '',
        price: data.price || 0,
        cost: data.cost || 0,
        stock: data.stock || 0,
        barcode: data.barcode || '',
        unit: data.unit || '個',
        noBarcode: data.noBarcode ? 1 : 0,
        imageUrl: data.imageUrl || '',
        expiryDate: data.expiryDate || '',
        supplierId: data.supplierId || '',
        reorderLevel: data.reorderLevel || 0,
      })
      return { success: true }
    },
    updateProduct(id, data) {
      const existing = stmts.getProductById.get(id)
      if (!existing) return { success: false, error: 'not found' }
      require('./costPricing.mjs').assertProductPricingUnchanged(existing,data._expectedPricing)
      for(const key of ['price','cost'])if(data[key]!=null)moneyValue(data[key],key)
      for(const key of ['stock','reorderLevel'])if(data[key]!=null)quantityValue(data[key],key)
      if(Object.hasOwn(data,'_expectedStock')&&data.stock!=null&&existing.stock!==data._expectedStock)return {success:false,error:'庫存已變更，請重新核對'}
      stmts.updateProduct.run({
        id,
        name: data.name ?? existing.name,
        category: data.category ?? existing.category,
        price: data.price ?? existing.price,
        cost: data.cost ?? existing.cost,
        stock: data.stock ?? existing.stock,
        barcode: data.barcode ?? existing.barcode,
        unit: data.unit ?? existing.unit,
        noBarcode: (data.noBarcode ?? existing.noBarcode) ? 1 : 0,
        imageUrl: data.imageUrl ?? existing.imageUrl ?? '',
        expiryDate: data.expiryDate ?? existing.expiryDate ?? '',
        supplierId: data.supplierId ?? existing.supplierId ?? '',
        reorderLevel: data.reorderLevel ?? existing.reorderLevel ?? 0,
      })
      return { success: true }
    },
    deleteProduct(id) {
      if(db.prepare("SELECT 1 FROM sales_documents d,json_each(json_extract(d.data,'$.items')) i WHERE json_extract(i.value,'$.productId')=? LIMIT 1").get(id))throw Error('商品仍被銷售文件使用，請保留以供核對')
      if(stmts.getAllPurchases.all().some(p=>p.procurement&&JSON.parse(p.items||'[]').some(i=>i.productId===id)))throw Error('品項仍被採購文件使用，請保留以供核對')
      const cfg=JSON.parse(stmts.getSetting.get('restaurantConfig')?.value||'{}')
      if(Object.hasOwn(cfg.recipes||{},id)||Object.values(cfg.recipes||{}).some(rows=>rows.some(r=>r.id===id))||db.prepare('SELECT data FROM restaurant_orders').all().some(r=>{const e=JSON.parse(r.data);return e.items.some(i=>i.id===id)||e.allocations.some(i=>i.id===id)}))throw Error('品項仍被預訂或配方使用，請保留以供核對')
      stmts.deleteProduct.run(id)
      return { success: true }
    },
    findByBarcode(code) {
      const p = stmts.findByBarcode.get(code)
      return p ? { ...p, noBarcode: !!p.noBarcode } : null
    },

    // Members
    getMembers() {
      return stmts.getAllMembers.all()
    },
    addMember(data) {
      const old=data.id&&stmts.getMemberById.get(data.id)
      if(old){if(['name','phone','birthday','note'].some(k=>(old[k]||'')!==(data[k]||'')))throw Error('會員編號已存在且內容不同，請核對已保存會員');return {success:true}}
      stmts.insertMember.run({
        id: data.id || 'm' + Date.now(),
        name: data.name || '',
        phone: data.phone || '',
        points: data.points || 0,
        tier: data.tier || 'normal',
        totalSpent: data.totalSpent || 0,
        joinDate: data.joinDate || new Date().toISOString().slice(0, 10),
        balance: data.balance || 0,
        birthday: data.birthday || '',
        lastBirthdayBonus: data.lastBirthdayBonus || '',
        note:data.note||'',
      })
      return { success: true }
    },
    updateMember(id, data) {
      const existing = stmts.getMemberById.get(id)
      if (!existing) return { success: false }
      stmts.updateMember.run({
        id,
        name: data.name ?? existing.name,
        phone: data.phone ?? existing.phone,
        points: data.points ?? existing.points,
        tier: data.tier ?? existing.tier,
        totalSpent: data.totalSpent ?? existing.totalSpent,
        balance: data.balance ?? existing.balance ?? 0,
        birthday: data.birthday ?? existing.birthday ?? '',
        lastBirthdayBonus: data.lastBirthdayBonus ?? existing.lastBirthdayBonus ?? '',
        note:data.note??existing.note??'',
      })
      return { success: true }
    },
    deleteMember(id) {
      stmts.deleteMember.run(id)
      return { success: true }
    },

    // Orders
    getOrders() {return stmts.getAllOrders.all().map(o=>readOrder(o.id))},
    addOrder(data) {
      return db.transaction(() => {
      stmts.insertOrder.run(orderInsertParams(data))
      if (data.items) {
        for (const item of data.items) {
          stmts.insertOrderItem.run({
            orderId: data.id,
            productId: item.id || item.productId || '',
            name: item.name,
            price: item.price,
            qty: item.qty,
          })
        }
      }
      return { success: true }
      })()
    },
    getOrder: readOrder,
    checkoutReceipt,
    getOrderItems(orderId) {
      return stmts.getOrderItems.all(orderId)
    },
    checkout(orderData, stockUpdates, memberUpdate) {
      try {
        checkoutTx(orderData, stockUpdates, memberUpdate)
        return checkoutReceipt(orderData.id)
      } catch(error) { return {protocol:PROTOCOL,success:false,committed:false,orderId:orderData?.id,error:error.message} }
    },
    refundOrder(origOrderId, request) {
      try {
        if(db.prepare('SELECT data FROM restaurant_orders').all().some(r=>JSON.parse(r.data).saleId===origOrderId))throw Error('預訂退款請在「預訂出餐」取消原單，避免回補已耗用食材')
        if (origOrderId!==request.refundOf) throw new Error('原始訂單編號不符')
        return refundTx(request)
      } catch (error) {return {success:false,committed:false,error:error.message}}
    },
    getCustomerOrders() {
      const orders = stmts.getCustomerOrders.all()
      return orders.map(o => ({
        ...o,
        change: o.change_amount,
        items: stmts.getOrderItems.all(o.id).map(i => ({
          id: i.productId, name: i.name, price: i.price, qty: i.qty,
        })),
      }))
    },
    updateOrderStatus(id, status) {
      const order=stmts.getOrderById.get(id)
      if(!order||order.source!=='customer')throw new Error('只能更新顧客點餐進度，不能修改收款訂單')
      if(order.status===status)return {success:true}
      const allowed={pending:['accepted','rejected'],accepted:['completed','rejected']}
      if(!allowed[order.status]?.includes(status))throw new Error('點餐狀態轉換不正確')
      stmts.updateOrderStatus.run(status, id)
      return { success: true }
    },

    // Suppliers
    getSuppliers() { return stmts.getAllSuppliers.all().map(parseSupplier) },
    addSupplier(data) {
      stmts.insertSupplier.run(supplierParams(data))
      return { success: true }
    },
    updateSupplier(id, data) {
      const old=stmts.getAllSuppliers.all().find(s=>s.id===id)
      if(!old)return {success:false,error:'供應商不存在'}
      if(data._expectedCatalog!==undefined&&canonicalSignature(JSON.parse(old.catalog||'[]'))!==data._expectedCatalog&&canonicalSignature(data.catalog)!==canonicalSignature(JSON.parse(old.catalog||'[]')))return {success:false,error:'貨源目錄已變更，請保留修改並重新核對'}
      stmts.updateSupplier.run(supplierParams({...old,...data}, id))
      return { success: true }
    },
    deleteSupplier(id) {if(db.prepare('SELECT data FROM supplier_entries').all().some(row=>JSON.parse(row.data).supplierId===id)||stmts.getAllProducts.all().some(p=>p.supplierId===id)||stmts.getAllPurchases.all().some(p=>p.supplierId===id&&(p.procurement||['draft','ordered','partial'].includes(p.status))))return {success:false,error:'供應商仍有商品、採購或款項文件，請先核對'};stmts.deleteSupplier.run(id); return { success: true } },

    // Purchases
    getPurchases() {
      return stmts.getAllPurchases.all().map(require('./procurementRules.mjs').parsePurchase)
    },
    addPurchase(data) {
      if(data.procurement)throw Error('新採購請使用可追溯的採購流程')
      if(require('./databaseFeatureFence.cjs').hasSupplierFence(db))throw Error('歷史進貨單保留原帳，請使用新採購的正式收貨與付款流程')
      const params={
        id: data.id || 'po' + Date.now(),
        supplierId: data.supplierId || '',
        supplierName: data.supplierName || '',
        status: data.status || 'draft',
        date: data.date || '',
        receivedDate: data.receivedDate || '',
        paidDate: data.paidDate || '',
        note: data.note || '',
        total: data.total || 0,
        items: JSON.stringify(data.items || []),
        procurement:null,
      }
      const old=stmts.getAllPurchases.all().find(p=>p.id===params.id)
      if(old){if(Object.keys(params).some(k=>params[k]!==old[k]))throw Error('進貨單編號已存在且內容不同');return {success:true,purchase:{...old,items:JSON.parse(old.items)}}}
      stmts.insertPurchase.run(params)
      return { success: true,purchase:this.getPurchases().find(p=>p.id===params.id) }
    },
    updatePurchase(id, data) {
      const existing = stmts.getAllPurchases.all().find(p => p.id === id)
      if (!existing) return { success: false }
      if(existing.procurement||data.procurement)throw Error('採購文件不可直接改寫，請使用收貨、請款或付款流程')
      if(require('./databaseFeatureFence.cjs').hasSupplierFence(db))throw Error('歷史進貨單保留原帳，請使用新採購的正式收貨與付款流程')
      stmts.updatePurchase.run({
        id,
        supplierId: data.supplierId ?? existing.supplierId,
        supplierName: data.supplierName ?? existing.supplierName,
        status: data.status ?? existing.status,
        date: data.date ?? existing.date,
        receivedDate: data.receivedDate ?? existing.receivedDate,
        paidDate: data.paidDate ?? existing.paidDate ?? '',
        note: data.note ?? existing.note,
        total: data.total ?? existing.total,
        items: JSON.stringify(data.items || JSON.parse(existing.items || '[]')),
        procurement:null,
      })
      return { success: true,purchase:this.getPurchases().find(p=>p.id===id) }
    },
    deletePurchase(id) {if(stmts.getAllPurchases.all().find(p=>p.id===id)?.procurement)throw Error('採購歷史不可刪除，未收貨請使用取消採購');if(require('./databaseFeatureFence.cjs').hasSupplierFence(db))throw Error('歷史進貨單保留原帳，請使用新採購的正式收貨與付款流程');stmts.deletePurchase.run(id); return { success: true } },

    // Promotions
    getPromotions() {
      return stmts.getAllPromotions.all().map(p => ({
        ...p,
        condition: JSON.parse(p.condition_data || '{}'),
        enabled: !!p.enabled,
      }))
    },
    addPromotion(data) {
      stmts.insertPromotion.run({
        id: data.id || 'promo' + Date.now(),
        name: data.name || '',
        type: data.type || '',
        condition_data: JSON.stringify(data.condition || {}),
        enabled: data.enabled ? 1 : 0,
        startAt: data.startAt || '',
        endAt: data.endAt || '',
        note:data.note||'',
      })
      return { success: true }
    },
    updatePromotion(id, data) {
      const all = stmts.getAllPromotions.all()
      const existing = all.find(p => p.id === id)
      if (!existing) return { success: false }
      stmts.updatePromotion.run({
        id,
        name: data.name ?? existing.name,
        type: data.type ?? existing.type,
        condition_data: data.condition ? JSON.stringify(data.condition) : existing.condition_data,
        enabled: (data.enabled !== undefined ? data.enabled : existing.enabled) ? 1 : 0,
        startAt: data.startAt ?? existing.startAt,
        endAt: data.endAt ?? existing.endAt,
        note:data.note??existing.note??'',
      })
      return { success: true }
    },
    deletePromotion(id) { stmts.deletePromotion.run(id); return { success: true } },

    // Users
    getUsers() { return stmts.getAllUsers.all() },
    addUser(data) {
      stmts.insertUser.run({
        id: data.id || 'u' + Date.now(),
        username: data.username,
        password: data.password || '',
        role: data.role || 'staff',
      })
      return { success: true }
    },
    updateUser(id, data) {
      const existing = stmts.getAllUsers.all().find(u => u.id === id)
      if (!existing) return { success: false }
      stmts.updateUser.run({
        id,
        username: data.username ?? existing.username,
        password: data.password ?? existing.password,
        role: data.role ?? existing.role,
      })
      return { success: true }
    },
    deleteUser(id) { stmts.deleteUser.run(id); return { success: true } },

    // Audit Log
    getAuditLogs(filters) {
      if (!filters) return stmts.getAuditLogs.all()
      let sql = 'SELECT * FROM audit_log WHERE 1=1'
      const params = []
      if (filters.level) { sql += ' AND level = ?'; params.push(filters.level) }
      if (filters.action) { sql += ' AND action = ?'; params.push(filters.action) }
      sql += ' ORDER BY timestamp DESC LIMIT 2000'
      return db.prepare(sql).all(...params)
    },
    writeAuditLog(entry) {
      if(String(entry?.id||'').startsWith('exchange:')||entry?.action==='business-quote')throw Error('報價回執只能由正式報價流程建立')
      if(String(entry?.id||'').startsWith('scenario-template:')||entry?.action==='SCENARIO_TEMPLATE_APPLY'||String(entry?.id||'').startsWith('stock-operation:')||entry?.action==='INVENTORY_OPERATION')throw Error('情境模板或庫存回執只能由正式異動流程建立')
      stmts.insertAuditLog.run({
        id: entry.id || 'a' + Date.now() + Math.random().toString(36).slice(2, 6),
        timestamp: entry.timestamp || new Date().toISOString(),
        action: entry.action || '',
        level: entry.level || 'info',
        label: entry.label || '',
        userId: entry.userId || '',
        username: entry.username || '',
        role: entry.role || '',
        detail: typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail || {}),
      })
      return { success: true }
    },

    // Manual Journal
    getManualJournal() {
      return stmts.getAllManualJournal.all().map(j => ({
        ...j,
        lines: JSON.parse(j.lines || '[]'),
      }))
    },
    addManualEntry(data) {
      require('./manualJournalRules.mjs').validateManualEntry(data)
      const params={
        id: data.id || 'j' + Date.now(),
        orderId: data.orderId || '',
        date: data.date || '',
        description: data.description || '',
        type: data.type || 'manual',
        lines: JSON.stringify(data.lines || []),
      }
      const old=stmts.getAllManualJournal.all().find(j=>j.id===params.id)
      if(old){if(Object.keys(params).some(k=>params[k]!==old[k]))throw Error('帳務編號已存在且內容不同');return {success:true}}
      stmts.insertManualEntry.run(params)
      return { success: true }
    },
    deleteManualEntry(id) { stmts.deleteManualEntry.run(id); return { success: true } },

    // Backups
    getBackups() {
      return db.prepare('SELECT id,label,createdAt,createdBy,length(data) AS size FROM backups ORDER BY createdAt DESC').all()
    },
    createBackup(label, createdBy) {
      const allData = this.exportFullBackup()
      const id = 'bk-' + randomUUID()
      stmts.insertBackup.run({
        id,
        label: label || '自動備份',
        createdAt: new Date().toISOString(),
        createdBy: createdBy || '',
        data: JSON.stringify(allData),
      })
      // 保留最新 10 個備份
      const all = stmts.getAllBackups.all()
      if (all.length > 10) {
        const toDelete = all.slice(10)
        for (const b of toDelete) {
          db.prepare('DELETE FROM backups WHERE id = ?').run(b.id)
        }
      }
      return { success: true, id }
    },
    exportData() {
      return db.transaction(()=>{
      const data = {
        products: stmts.getAllProducts.all().map(p => ({ ...p, noBarcode: !!p.noBarcode })),
        members: stmts.getAllMembers.all(),
        orders: stmts.getAllOrders.all().map(o=>readOrder(o.id)),
        suppliers: stmts.getAllSuppliers.all().map(parseSupplier),
        purchases: stmts.getAllPurchases.all().map(require('./procurementRules.mjs').parsePurchase),
        promotions: stmts.getAllPromotions.all().map(p => ({
          ...p, condition: JSON.parse(p.condition_data || '{}'), enabled: !!p.enabled,
        })),
        users: stmts.getAllUsers.all(),
        manualJournal: stmts.getAllManualJournal.all().map(j => ({ ...j, lines: JSON.parse(j.lines || '[]') })),
        heldOrders: stmts.getAllHeld.all().map(h => ({ ...h, cart: (() => { try { return JSON.parse(h.cart || '[]') } catch { return [] } })() })),
        shifts: db.prepare('SELECT * FROM shifts ORDER BY openTime DESC').all(),
        cashLog: db.prepare('SELECT * FROM cash_log ORDER BY time DESC').all(),
        wasteLog: db.prepare('SELECT * FROM waste_log ORDER BY time DESC').all(),
        memberTopups: db.prepare('SELECT * FROM member_topups ORDER BY time DESC').all(),
        auditLog: db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC').all(),
        settings: stmts.getAllSettings.all(),
        restaurantOrders: db.prepare('SELECT data FROM restaurant_orders ORDER BY rowid DESC').all().map(r=>JSON.parse(r.data)),
        restaurantOperations: db.prepare('SELECT data FROM restaurant_operations ORDER BY rowid').all().map(r=>JSON.parse(r.data)),
        salesDocuments:db.prepare('SELECT data FROM sales_documents ORDER BY id').all().map(r=>JSON.parse(r.data)),
        salesOperations:db.prepare('SELECT data FROM sales_operations ORDER BY id').all().map(r=>JSON.parse(r.data)),
        customerEntries:db.prepare('SELECT data FROM customer_entries ORDER BY id').all().map(r=>JSON.parse(r.data)),
        customerOperations:db.prepare('SELECT data FROM customer_operations ORDER BY id').all().map(r=>JSON.parse(r.data)),
        supplierEntries:db.prepare('SELECT data FROM supplier_entries ORDER BY id').all().map(r=>JSON.parse(r.data)),
        supplierOperations:db.prepare('SELECT data FROM supplier_operations ORDER BY id').all().map(r=>JSON.parse(r.data)),
      }
      const stock=stockStore.read()
      if(stock.projection){
        require('./stockOpeningPlan.mjs').assertStockCustodyMatchesBook(stock.projection.custody,data.products,data.restaurantOrders)
      }
      data.stockCostEntries=stock.entries;data.stockCostOperations=stock.operations
      require('./stockBackup.mjs').validateStockCostBook(data,stock)
      // A backup round trip may change insertion order for tied timestamps.
      // Stable collection ordering keeps the revision tied to business content.
      for(const rows of Object.values(data))rows.sort((a,b)=>String(a.id??a.key).localeCompare(String(b.id??b.key)))
      return {...data,_revision:createHash('sha256').update(canonicalSignature(data)).digest('hex')}
      })()
    },
    // Settings
    getSetting(key) {
      const row = stmts.getSetting.get(key)
      return row ? row.value : null
    },
    setSetting(key, value) {
      if(key==='stockCostVersionFence')throw Error('成本資料的版本保護由完整備份流程管理')
      if(key==='businessExchangeV1')throw Error('報價歷史只能由正式報價或還原流程保存')
      stmts.setSetting.run(key, value)
      return { success: true }
    },
    setSettings(values){if(Object.hasOwn(values,'stockCostVersionFence'))throw Error('成本資料的版本保護由完整備份流程管理');if(Object.hasOwn(values,'businessExchangeV1'))throw Error('報價歷史只能由正式報價或還原流程保存');db.transaction(()=>{for(const [key,value]of Object.entries(values))stmts.setSetting.run(key,String(value))})();return {success:true}},
    getAllSettings() {
      const rows = stmts.getAllSettings.all()
      const result = {}
      for (const r of rows) result[r.key] = r.value
      return result
    },

    // Migration
    migrateFromLocalStorage(data,actor) {
      // Renderer migrations are a first-run path, never an alternate restore
      // endpoint. Account-only bootstrap is validated by ipcSecurity.list.
      if(actor&&(!api.isEmpty()||data?.users?.length))throw Error('已有營運資料或帳號，請透過備份還原預覽匯入')
      return migrateTx(data)
    },
    isEmpty() {
      return ['products','members','orders','suppliers','purchases','promotions','manual_journal','held_orders','shifts','cash_log','waste_log','member_topups','sales_documents','sales_operations','customer_entries','customer_operations','supplier_entries','supplier_operations','restaurant_orders','restaurant_operations','stock_cost_entries','stock_cost_operations'].every(t=>db.prepare('SELECT 1 FROM '+t+' LIMIT 1').get()==null)
    },

    // ===== Held Orders 掛單 =====
    getHeldOrders() {
      return stmts.getAllHeld.all().map(h => ({
        ...h,
        cart: (() => { try { return JSON.parse(h.cart || '[]') } catch { return [] } })(),
      }))
    },
    addHeldOrder(data) {
      stmts.insertHeld.run({
        id: data.id || 'H' + Date.now(),
        label: data.label || '',
        cart: typeof data.cart === 'string' ? data.cart : JSON.stringify(data.cart || []),
        memberId: data.memberId || '',
        manualDiscount: data.manualDiscount || 0,
        note: data.note || '',
        createdAt: data.createdAt || new Date().toISOString(),
        cashier: data.cashier || '',
      })
      return { success: true }
    },
    deleteHeldOrder(id) {
      stmts.deleteHeld.run(id)
      return { success: true }
    },

    // ===== Shifts 班別 =====
    getShifts() { return stmts.getAllShifts.all() },
    getOpenShift() { return stmts.getOpenShift.get() || null },
    openShift(data) {
      if(typeof data.openCash!=='number'||!Number.isFinite(data.openCash)||data.openCash<0||data.openCash>1e9)throw new Error('開班現金不正確')
      if(stmts.getOpenShift.get())throw new Error('已有開啟中的班別')
      const id = data.id || 'S' + Date.now()
      stmts.insertShift.run({
        id, cashier: data.cashier || '', cashierId: data.cashierId || '',
        openTime: data.openTime || new Date().toISOString(),
        openCash: data.openCash || 0, note: data.note || '',
      })
      return { success: true, id }
    },
    closeShift(id, data) {
      return db.transaction(() => {
      const shift = stmts.getShiftById.get(id)
      if(typeof data.closeCash!=='number'||!Number.isFinite(data.closeCash)||data.closeCash<0||data.closeCash>1e9)throw new Error('交班現金不正確')
      if(!shift)throw new Error('班別不存在')
      if(shift.status==='closed'){
        if(shift.closeCash!==data.closeCash || shift.note!==(data.note||''))throw new Error('已交班內容不同，請核對原交班紀錄')
        return {success:true,expected:shift.expectedCash,diff:shift.diff}
      }
      if(shift.status!=='open')throw new Error('班別狀態需要核對')
      const stats=summarizeShift(shift,db.prepare('SELECT * FROM orders WHERE shiftId=?').all(id),stmts.getCashLog.all(id),db.prepare('SELECT * FROM member_topups WHERE shiftId=?').all(id))
      const {expected,cash:cashSales,card:cardSales,orderCount,refundCount,refundAmt:refundAmount}=stats
      const closeCash = data.closeCash
      stmts.closeShift.run({
        id, closeTime: new Date().toISOString(),
        closeCash, expectedCash: expected, diff: Math.round((closeCash-expected)*100)/100,
        cashSales, cardSales, orderCount,
        refundCount, refundAmount, note: data.note || '',
      })
      return { success: true, expected, diff: Math.round((closeCash-expected)*100)/100 }
      })()
    },
    getCashLog(shiftId) {
      return shiftId ? stmts.getCashLog.all(shiftId) : stmts.getAllCashLog.all()
    },
    addCashLog(data) {
      try{return db.transaction(()=>{
        operationHeader(data);if(data.id.startsWith('customer-cash:'))throw Error('客戶收付現金流水只能由原客戶款項操作保存');const old=db.prepare('SELECT * FROM cash_log WHERE id=?').get(data.id)
        if(old){if(!sameCommand(old,data,['shiftId','time','type','amount','reason','cashier']))throw Error('現金流水編號內容不一致');return {success:true,cashLog:old}}
        moneyValue(data.amount,'現金流水',.01)
        if(!['in','out'].includes(data.type)||stmts.getShiftById.get(data.shiftId)?.status!=='open')throw Error('現金異動或班別不正確')
        const cashLog={...data,reason:data.reason||'',cashier:data.cashier||''};stmts.insertCashLog.run(cashLog)
        return {success:true,cashLog}
      })()}catch(error){return {success:false,committed:false,error:error.message}}
    },

    // ===== Waste 損耗 =====
    getWasteLog() {
      return stmts.getAllWaste.all()
    },
    addWaste(data) {
      try{return db.transaction(()=>{
        operationHeader(data);const old=db.prepare('SELECT * FROM waste_log WHERE id=?').get(data.id)
        if(old){if(!sameCommand(old,data,['productId','qty','reason','time','cashier']))throw Error('損耗編號內容不一致');return {success:true,waste:old,product:stmts.getProductById.get(old.productId)||null}}
        const p=stmts.getProductById.get(data.productId)
        quantityValue(data.qty,'損耗數量',.001)
        if(!p||data.qty>p.stock)throw new Error('損耗商品或數量不正確')
        const waste={...data,productName:p.name,cost:p.cost||0,reason:data.reason||'',cashier:data.cashier||''}
        stmts.insertWaste.run(waste)
        stmts.updateProductStock.run({id:p.id,delta:-data.qty})
        return {success:true,waste,product:stmts.getProductById.get(p.id)}
      })()}catch(error){return {success:false,committed:false,error:error.message}}
    },
    deleteWaste(id) { throw Error('損耗已扣庫並入帳，紀錄須保留；請用盤點與會計更正，不能直接刪除') },

    // ===== Member Topups 會員儲值 =====
    getTopups(memberId) {
      return memberId ? stmts.getMemberTopups.all(memberId) : stmts.getAllTopups.all()
    },
    addTopup(data) {
      try {return db.transaction(()=>{
        operationHeader(data);moneyValue(data.amount,'儲值金額',.01);moneyValue(data.bonus,'贈額')
        if(!['cash','card'].includes(data.payMethod))throw Error('儲值付款方式不正確')
        const member=stmts.getMemberById.get(data.memberId)
        const old=db.prepare('SELECT * FROM member_topups WHERE id=?').get(data.id)
        if (old) {
          if(!sameCommand(old,data,['memberId','amount','bonus','payMethod','time','cashier','note','shiftId']))throw Error('儲值單號內容不一致')
          return {success:true,member:member||null,topup:old}
        }
        if(!member)throw Error('會員不存在')
        if(stmts.getShiftById.get(data.shiftId)?.status!=='open')throw Error('請先開班再收取儲值款項')
        moneyValue((member.balance||0)+data.amount+data.bonus,'儲值餘額')
        stmts.insertTopup.run({...data,note:data.note||'',cashier:data.cashier||'',shiftId:data.shiftId})
        stmts.updateMemberBalance.run({id:member.id,delta:Math.round((data.amount+data.bonus)*100)/100})
        return {success:true,member:stmts.getMemberById.get(member.id),topup:data}
      })()} catch(error){return {success:false,committed:false,error:error.message}}
    },

    close() {
      db.close()
    },
  }
  Object.assign(api,require('./stockOpeningOperations.cjs')(db,api,stockStore),require('./stockCostOperations.cjs')(db,api,stockStore))
  require('./stockBusinessOperations.cjs')(db,api,stockStore)
  return require('./recoveryOperations.cjs')(db,api,replaceAllTx)
}
