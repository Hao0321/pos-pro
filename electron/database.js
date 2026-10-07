const { createHash, randomUUID } = require('node:crypto')
const { prepareRefund, refundSignature } = require('./refundSafety.cjs')
const { prepareDatabaseCheckout, signature, PROTOCOL } = require('./checkoutContract.cjs')
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

module.exports = function initDatabase(dbPath) {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // ===== Schema =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      barcode TEXT DEFAULT '',
      unit TEXT DEFAULT '個',
      noBarcode INTEGER DEFAULT 0,
      imageUrl TEXT DEFAULT '',
      expiryDate TEXT DEFAULT '',
      supplierId TEXT DEFAULT '',
      reorderLevel INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      updatedAt TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      points INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'normal',
      totalSpent REAL DEFAULT 0,
      joinDate TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      manualDiscount REAL DEFAULT 0,
      balanceUsed REAL DEFAULT 0,
      total REAL DEFAULT 0,
      payMethod TEXT DEFAULT 'cash',
      paid REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      payments TEXT DEFAULT '[]',
      memberId TEXT,
      pointsUsed INTEGER DEFAULT 0,
      pointsEarned INTEGER DEFAULT 0,
      time TEXT NOT NULL,
      source TEXT DEFAULT 'pos',
      status TEXT DEFAULT 'completed',
      tableNum TEXT DEFAULT '',
      note TEXT DEFAULT '',
      taxId TEXT DEFAULT '',
      shiftId TEXT DEFAULT '',
      refundOf TEXT DEFAULT '',
      cashier TEXT DEFAULT '',
      fullRefund INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_orders_time ON orders(time);
    CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId TEXT NOT NULL,
      productId TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY (orderId) REFERENCES orders(id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      payTerms TEXT DEFAULT '',
      note TEXT DEFAULT '',
      catalog TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      supplierId TEXT,
      supplierName TEXT,
      status TEXT DEFAULT 'draft',
      date TEXT,
      receivedDate TEXT,
      paidDate TEXT DEFAULT '',
      note TEXT DEFAULT '',
      total REAL DEFAULT 0,
      items TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      condition_data TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      startAt TEXT,
      endAt TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      role TEXT DEFAULT 'staff'
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      label TEXT DEFAULT '',
      userId TEXT DEFAULT '',
      username TEXT DEFAULT '',
      role TEXT DEFAULT '',
      detail TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

    CREATE TABLE IF NOT EXISTS manual_journal (
      id TEXT PRIMARY KEY,
      orderId TEXT,
      date TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'manual',
      lines TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      label TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      createdBy TEXT DEFAULT '',
      data TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS held_orders (
      id TEXT PRIMARY KEY,
      label TEXT DEFAULT '',
      cart TEXT NOT NULL DEFAULT '[]',
      memberId TEXT DEFAULT '',
      manualDiscount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      cashier TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_held_createdAt ON held_orders(createdAt);

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      cashier TEXT NOT NULL,
      cashierId TEXT DEFAULT '',
      openTime TEXT NOT NULL,
      closeTime TEXT DEFAULT '',
      openCash REAL DEFAULT 0,
      closeCash REAL DEFAULT 0,
      expectedCash REAL DEFAULT 0,
      diff REAL DEFAULT 0,
      cashSales REAL DEFAULT 0,
      cardSales REAL DEFAULT 0,
      orderCount INTEGER DEFAULT 0,
      refundCount INTEGER DEFAULT 0,
      refundAmount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'open'
    );
    CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);

    CREATE TABLE IF NOT EXISTS cash_log (
      id TEXT PRIMARY KEY,
      shiftId TEXT DEFAULT '',
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT DEFAULT '',
      cashier TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_cash_log_shift ON cash_log(shiftId);

    CREATE TABLE IF NOT EXISTS waste_log (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT DEFAULT '',
      qty INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      cost REAL DEFAULT 0,
      time TEXT NOT NULL,
      cashier TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_waste_time ON waste_log(time);
    CREATE INDEX IF NOT EXISTS idx_waste_product ON waste_log(productId);

    CREATE TABLE IF NOT EXISTS member_topups (
      id TEXT PRIMARY KEY,
      memberId TEXT NOT NULL,
      amount REAL NOT NULL,
      bonus REAL DEFAULT 0,
      payMethod TEXT DEFAULT 'cash',
      time TEXT NOT NULL,
      cashier TEXT DEFAULT '',
      note TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_topups_member ON member_topups(memberId);
  `)

  // === 自動補欄位（升級舊資料庫）===
  function ensureColumn(table, col, def) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all()
    if (!cols.find(c => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
    }
  }
  try {
    ensureColumn('products', 'imageUrl', "TEXT DEFAULT ''")
    ensureColumn('products', 'expiryDate', "TEXT DEFAULT ''")
    ensureColumn('products', 'supplierId', "TEXT DEFAULT ''")
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplierId)')
    ensureColumn('products', 'reorderLevel', 'INTEGER DEFAULT 0')
    ensureColumn('orders', 'manualDiscount', 'REAL DEFAULT 0')
    ensureColumn('orders', 'payments', "TEXT DEFAULT '[]'")
    ensureColumn('orders', 'itemCosts', "TEXT DEFAULT '{}'")
    ensureColumn('orders', 'trackingTokenHash', "TEXT DEFAULT ''")
    ensureColumn('orders', 'requestSignature', "TEXT DEFAULT ''")
    ensureColumn('orders', 'taxId', "TEXT DEFAULT ''")
    ensureColumn('orders', 'shiftId', "TEXT DEFAULT ''")
    ensureColumn('orders', 'refundOf', "TEXT DEFAULT ''")
    ensureColumn('orders', 'cashier', "TEXT DEFAULT ''")
    ensureColumn('orders', 'fullRefund', 'INTEGER DEFAULT 0')
    ensureColumn('orders', 'balanceUsed', 'REAL DEFAULT 0')
    ensureColumn('suppliers', 'catalog', "TEXT DEFAULT '[]'")  // v2.6 商家貨源清單（JSON 陣列）
    ensureColumn('members', 'balance', 'REAL DEFAULT 0')
    ensureColumn('members', 'birthday', "TEXT DEFAULT ''")
    ensureColumn('members', 'lastBirthdayBonus', "TEXT DEFAULT ''")
    ensureColumn('purchases', 'paidDate', "TEXT DEFAULT ''")
  } catch(e){db.close();throw new Error('資料庫結構更新未完成，已保留原始資料：'+e.message)}

  // ===== Prepared Statements =====

  // --- Products ---
  const stmts = {
    getAllProducts: db.prepare('SELECT * FROM products ORDER BY name'),
    getProductById: db.prepare('SELECT * FROM products WHERE id = ?'),
    findByBarcode: db.prepare("SELECT * FROM products WHERE barcode = ? AND barcode != ''"),
    insertProduct: db.prepare(`
      INSERT INTO products (id, name, category, price, cost, stock, barcode, unit, noBarcode, imageUrl, expiryDate, supplierId, reorderLevel)
      VALUES (@id, @name, @category, @price, @cost, @stock, @barcode, @unit, @noBarcode, @imageUrl, @expiryDate, @supplierId, @reorderLevel)
    `),
    updateProduct: db.prepare(`
      UPDATE products SET name=@name, category=@category, price=@price, cost=@cost,
      stock=@stock, barcode=@barcode, unit=@unit, noBarcode=@noBarcode,
      imageUrl=@imageUrl, expiryDate=@expiryDate,
      supplierId=@supplierId, reorderLevel=@reorderLevel,
      updatedAt=datetime('now','localtime') WHERE id=@id
    `),
    updateProductStock: db.prepare('UPDATE products SET stock = stock + @delta WHERE id = @id'),
    deleteProduct: db.prepare('DELETE FROM products WHERE id = ?'),

    // --- Members ---
    getAllMembers: db.prepare('SELECT * FROM members ORDER BY name'),
    getMemberById: db.prepare('SELECT * FROM members WHERE id = ?'),
    insertMember: db.prepare(`
      INSERT INTO members (id, name, phone, points, tier, totalSpent, joinDate, balance, birthday, lastBirthdayBonus)
      VALUES (@id, @name, @phone, @points, @tier, @totalSpent, @joinDate, @balance, @birthday, @lastBirthdayBonus)
    `),
    updateMember: db.prepare(`
      UPDATE members SET name=@name, phone=@phone, points=@points,
      tier=@tier, totalSpent=@totalSpent, balance=@balance, birthday=@birthday,
      lastBirthdayBonus=@lastBirthdayBonus WHERE id=@id
    `),
    updateMemberBalance: db.prepare('UPDATE members SET balance = balance + @delta WHERE id = @id'),
    deleteMember: db.prepare('DELETE FROM members WHERE id = ?'),

    // --- Orders ---
    getAllOrders: db.prepare('SELECT * FROM orders ORDER BY time DESC'),
    getOrderById: db.prepare('SELECT * FROM orders WHERE id = ?'),
    getCustomerOrders: db.prepare("SELECT * FROM orders WHERE source = 'customer' ORDER BY time DESC"),
    insertOrder: db.prepare(`
      INSERT INTO orders (id, subtotal, discount, manualDiscount, balanceUsed, total, payMethod, paid, change_amount,
        payments, memberId, pointsUsed, pointsEarned, time, source, status, tableNum, note,
        taxId, shiftId, refundOf, cashier, fullRefund, trackingTokenHash, requestSignature, itemCosts)
      VALUES (@id, @subtotal, @discount, @manualDiscount, @balanceUsed, @total, @payMethod, @paid, @change_amount,
        @payments, @memberId, @pointsUsed, @pointsEarned, @time, @source, @status, @tableNum, @note,
        @taxId, @shiftId, @refundOf, @cashier, @fullRefund, @trackingTokenHash, @requestSignature, @itemCosts)
    `),
    updateOrderStatus: db.prepare('UPDATE orders SET status = ? WHERE id = ?'),

    // --- Order Items ---
    getOrderItems: db.prepare('SELECT * FROM order_items WHERE orderId = ?'),
    insertOrderItem: db.prepare(`
      INSERT INTO order_items (orderId, productId, name, price, qty)
      VALUES (@orderId, @productId, @name, @price, @qty)
    `),

    // --- Suppliers ---
    getAllSuppliers: db.prepare('SELECT * FROM suppliers ORDER BY name'),
    insertSupplier: db.prepare(`
      INSERT INTO suppliers (id, name, contact, phone, payTerms, note, catalog)
      VALUES (@id, @name, @contact, @phone, @payTerms, @note, @catalog)
    `),
    updateSupplier: db.prepare(`
      UPDATE suppliers SET name=@name, contact=@contact, phone=@phone,
      payTerms=@payTerms, note=@note, catalog=@catalog WHERE id=@id
    `),
    deleteSupplier: db.prepare('DELETE FROM suppliers WHERE id = ?'),

    // --- Purchases ---
    getAllPurchases: db.prepare('SELECT * FROM purchases ORDER BY date DESC'),
    insertPurchase: db.prepare(`
      INSERT INTO purchases (id, supplierId, supplierName, status, date, receivedDate, paidDate, note, total, items)
      VALUES (@id, @supplierId, @supplierName, @status, @date, @receivedDate, @paidDate, @note, @total, @items)
    `),
    updatePurchase: db.prepare(`
      UPDATE purchases SET supplierId=@supplierId, supplierName=@supplierName,
      status=@status, date=@date, receivedDate=@receivedDate, paidDate=@paidDate, note=@note,
      total=@total, items=@items WHERE id=@id
    `),
    deletePurchase: db.prepare('DELETE FROM purchases WHERE id = ?'),

    // --- Promotions ---
    getAllPromotions: db.prepare('SELECT * FROM promotions'),
    insertPromotion: db.prepare(`
      INSERT INTO promotions (id, name, type, condition_data, enabled, startAt, endAt)
      VALUES (@id, @name, @type, @condition_data, @enabled, @startAt, @endAt)
    `),
    updatePromotion: db.prepare(`
      UPDATE promotions SET name=@name, type=@type, condition_data=@condition_data,
      enabled=@enabled, startAt=@startAt, endAt=@endAt WHERE id=@id
    `),
    deletePromotion: db.prepare('DELETE FROM promotions WHERE id = ?'),

    // --- Users ---
    getAllUsers: db.prepare('SELECT * FROM users'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertUser: db.prepare(`
      INSERT INTO users (id, username, password, role)
      VALUES (@id, @username, @password, @role)
    `),
    updateUser: db.prepare(`UPDATE users SET username=@username, password=@password, role=@role WHERE id=@id`),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

    // --- Audit Log ---
    getAuditLogs: db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 2000'),
    insertAuditLog: db.prepare(`
      INSERT INTO audit_log (id, timestamp, action, level, label, userId, username, role, detail)
      VALUES (@id, @timestamp, @action, @level, @label, @userId, @username, @role, @detail)
    `),

    // --- Manual Journal ---
    getAllManualJournal: db.prepare('SELECT * FROM manual_journal ORDER BY date DESC'),
    insertManualEntry: db.prepare(`
      INSERT INTO manual_journal (id, orderId, date, description, type, lines)
      VALUES (@id, @orderId, @date, @description, @type, @lines)
    `),
    deleteManualEntry: db.prepare('DELETE FROM manual_journal WHERE id = ?'),

    // --- Backups ---
    getAllBackups: db.prepare('SELECT id, label, createdAt, createdBy FROM backups ORDER BY createdAt DESC'),
    getBackupById: db.prepare('SELECT * FROM backups WHERE id = ?'),
    insertBackup: db.prepare(`
      INSERT INTO backups (id, label, createdAt, createdBy, data)
      VALUES (@id, @label, @createdAt, @createdBy, @data)
    `),

    // --- Settings ---
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
    getAllSettings: db.prepare('SELECT * FROM settings'),

    // --- Held Orders ---
    getAllHeld: db.prepare('SELECT * FROM held_orders ORDER BY createdAt DESC'),
    insertHeld: db.prepare(`
      INSERT INTO held_orders (id, label, cart, memberId, manualDiscount, note, createdAt, cashier)
      VALUES (@id, @label, @cart, @memberId, @manualDiscount, @note, @createdAt, @cashier)
    `),
    deleteHeld: db.prepare('DELETE FROM held_orders WHERE id = ?'),

    // --- Shifts ---
    getAllShifts: db.prepare('SELECT * FROM shifts ORDER BY openTime DESC LIMIT 200'),
    getOpenShift: db.prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY openTime DESC LIMIT 1"),
    getShiftById: db.prepare('SELECT * FROM shifts WHERE id = ?'),
    insertShift: db.prepare(`
      INSERT INTO shifts (id, cashier, cashierId, openTime, openCash, status, note)
      VALUES (@id, @cashier, @cashierId, @openTime, @openCash, 'open', @note)
    `),
    closeShift: db.prepare(`
      UPDATE shifts SET closeTime=@closeTime, closeCash=@closeCash, expectedCash=@expectedCash,
        diff=@diff, cashSales=@cashSales, cardSales=@cardSales, orderCount=@orderCount,
        refundCount=@refundCount, refundAmount=@refundAmount, note=@note, status='closed'
      WHERE id=@id
    `),

    // --- Cash Log ---
    getCashLog: db.prepare('SELECT * FROM cash_log WHERE shiftId = ? ORDER BY time DESC'),
    getAllCashLog: db.prepare('SELECT * FROM cash_log ORDER BY time DESC LIMIT 500'),
    insertCashLog: db.prepare(`
      INSERT INTO cash_log (id, shiftId, time, type, amount, reason, cashier)
      VALUES (@id, @shiftId, @time, @type, @amount, @reason, @cashier)
    `),

    // --- Waste Log ---
    getAllWaste: db.prepare('SELECT * FROM waste_log ORDER BY time DESC LIMIT 1000'),
    insertWaste: db.prepare(`
      INSERT INTO waste_log (id, productId, productName, qty, reason, cost, time, cashier)
      VALUES (@id, @productId, @productName, @qty, @reason, @cost, @time, @cashier)
    `),
    deleteWaste: db.prepare('DELETE FROM waste_log WHERE id = ?'),

    // --- Member Topups ---
    getAllTopups: db.prepare('SELECT * FROM member_topups ORDER BY time DESC LIMIT 500'),
    getMemberTopups: db.prepare('SELECT * FROM member_topups WHERE memberId = ? ORDER BY time DESC'),
    insertTopup: db.prepare(`
      INSERT INTO member_topups (id, memberId, amount, bonus, payMethod, time, cashier, note)
      VALUES (@id, @memberId, @amount, @bonus, @payMethod, @time, @cashier, @note)
    `),
  }

  // ===== Transaction helpers =====
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

  // ===== Migration =====
  const migrateTx = db.transaction((data) => {
    // Products
    if (data.products && data.products.length) {
      for (const p of data.products) {
        stmts.insertProduct.run({
          id: p.id,
          name: p.name || '',
          category: p.category || '',
          price: p.price || 0,
          cost: p.cost || 0,
          stock: p.stock || 0,
          barcode: p.barcode || '',
          unit: p.unit || '個',
          noBarcode: p.noBarcode ? 1 : 0,
          imageUrl: p.imageUrl || '',
          expiryDate: p.expiryDate || '',
          supplierId: p.supplierId || '',
          reorderLevel: p.reorderLevel || 0,
        })
      }
    }

    // Members
    if (data.members && data.members.length) {
      for (const m of data.members) {
        stmts.insertMember.run({
          id: m.id,
          name: m.name || '',
          phone: m.phone || '',
          points: m.points || 0,
          tier: m.tier || 'normal',
          totalSpent: m.totalSpent || 0,
          joinDate: m.joinDate || '',
          balance: m.balance || 0,
          birthday: m.birthday || '',
          lastBirthdayBonus: m.lastBirthdayBonus || '',
        })
      }
    }

    // Orders
    if (data.orders && data.orders.length) {
      for (const o of data.orders) {
        // 用統一的 orderInsertParams 避免漏 named params（manualDiscount, payments, taxId, shiftId, refundOf, cashier, fullRefund）
        stmts.insertOrder.run(orderInsertParams(o))
        if (o.items) {
          for (const item of o.items) {
            stmts.insertOrderItem.run({
              orderId: o.id,
              productId: item.id || '',
              name: item.name || '',
              price: item.price || 0,
              qty: item.qty || 0,
            })
          }
        }
      }
    }

    // Manual journal
    if (data.manualJournal && data.manualJournal.length) {
      for (const j of data.manualJournal) {
        stmts.insertManualEntry.run({
          id: j.id,
          orderId: j.orderId || '',
          date: j.date || '',
          description: j.description || '',
          type: j.type || 'manual',
          lines: JSON.stringify(j.lines || []),
        })
      }
    }

    // Users
    if (data.users && data.users.length) {
      for (const u of data.users) {
        stmts.insertUser.run({
          id: u.id || 'u' + Date.now() + Math.random().toString(36).slice(2, 6),
          username: u.username,
          password: u.password || '',
          role: u.role || 'staff',
        })
      }
    }

    // Suppliers
    if (data.suppliers && data.suppliers.length) {
      for (const s of data.suppliers) {
        stmts.insertSupplier.run(supplierParams(s))
      }
    }

    // Purchases
    if (data.purchases && data.purchases.length) {
      for (const p of data.purchases) {
        stmts.insertPurchase.run({
          id: p.id,
          supplierId: p.supplierId || '',
          supplierName: p.supplierName || '',
          status: p.status || 'draft',
          date: p.date || '',
          receivedDate: p.receivedDate || '',
          paidDate: p.paidDate || '',
          note: p.note || '',
          total: p.total || 0,
          items: JSON.stringify(p.items || []),
        })
      }
    }

    // Promotions
    if (data.promotions && data.promotions.length) {
      for (const pr of data.promotions) {
        stmts.insertPromotion.run({
          id: pr.id,
          name: pr.name || '',
          type: pr.type || '',
          condition_data: JSON.stringify(pr.condition || pr.condition_data || {}),
          enabled: pr.enabled ? 1 : 0,
          startAt: pr.startAt || '',
          endAt: pr.endAt || '',
        })
      }
    }

    // Held Orders
    if (data.heldOrders && data.heldOrders.length) {
      for (const h of data.heldOrders) {
        stmts.insertHeld.run({
          id: h.id,
          label: h.label || '',
          cart: typeof h.cart === 'string' ? h.cart : JSON.stringify(h.cart || []),
          memberId: h.memberId || '',
          manualDiscount: h.manualDiscount || 0,
          note: h.note || '',
          createdAt: h.createdAt || new Date().toISOString(),
          cashier: h.cashier || '',
        })
      }
    }

    // Shifts（用 full insert 含 close 後的所有欄位）
    if (data.shifts && data.shifts.length) {
      const insertShiftFull = db.prepare(`
        INSERT INTO shifts (id, cashier, cashierId, openTime, closeTime, openCash, closeCash,
          expectedCash, diff, cashSales, cardSales, orderCount, refundCount, refundAmount, note, status)
        VALUES (@id, @cashier, @cashierId, @openTime, @closeTime, @openCash, @closeCash,
          @expectedCash, @diff, @cashSales, @cardSales, @orderCount, @refundCount, @refundAmount, @note, @status)
      `)
      for (const s of data.shifts) {
        insertShiftFull.run({
          id: s.id, cashier: s.cashier || '', cashierId: s.cashierId || '',
          openTime: s.openTime || '', closeTime: s.closeTime || '',
          openCash: s.openCash || 0, closeCash: s.closeCash || 0,
          expectedCash: s.expectedCash || 0, diff: s.diff || 0,
          cashSales: s.cashSales || 0, cardSales: s.cardSales || 0,
          orderCount: s.orderCount || 0, refundCount: s.refundCount || 0,
          refundAmount: s.refundAmount || 0, note: s.note || '',
          status: s.status || 'open',
        })
      }
    }

    // Cash Log
    if (data.cashLog && data.cashLog.length) {
      for (const c of data.cashLog) {
        stmts.insertCashLog.run({
          id: c.id,
          shiftId: c.shiftId || '',
          time: c.time || new Date().toISOString(),
          type: c.type || 'in',
          amount: c.amount || 0,
          reason: c.reason || '',
          cashier: c.cashier || '',
        })
      }
    }

    // Waste Log
    if (data.wasteLog && data.wasteLog.length) {
      for (const w of data.wasteLog) {
        stmts.insertWaste.run({
          id: w.id,
          productId: w.productId || '',
          productName: w.productName || '',
          qty: w.qty || 0,
          reason: w.reason || '',
          cost: w.cost || 0,
          time: w.time || new Date().toISOString(),
          cashier: w.cashier || '',
        })
      }
    }

    // Member Topups
    if (data.memberTopups && data.memberTopups.length) {
      for (const t of data.memberTopups) {
        stmts.insertTopup.run({
          id: t.id,
          memberId: t.memberId || '',
          amount: t.amount || 0,
          bonus: t.bonus || 0,
          payMethod: t.payMethod || 'cash',
          time: t.time || new Date().toISOString(),
          cashier: t.cashier || '',
          note: t.note || '',
        })
      }
    }

    // Audit Log
    if (data.auditLog && data.auditLog.length) {
      for (const a of data.auditLog) {
        stmts.insertAuditLog.run({
          id: a.id,
          timestamp: a.timestamp || new Date().toISOString(),
          action: a.action || '',
          level: a.level || 'info',
          label: a.label || '',
          userId: a.userId || '',
          username: a.username || '',
          role: a.role || '',
          detail: typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail || {}),
        })
      }
    }

    return { success: true }
  })

  // 「清空全部表 + 重新匯入」包成單一 transaction：
  // importData / restoreBackup 共用。若 migrateTx 中途 throw（例如缺欄位、髒資料），
  // 連同前面的 DELETE 一起 rollback，保證不會把舊資料清掉卻沒匯入新資料造成整庫遺失。
  const replaceAllTx = db.transaction((data) => {
    db.exec(`
      DELETE FROM products; DELETE FROM members;
      DELETE FROM order_items; DELETE FROM orders;
      DELETE FROM suppliers; DELETE FROM purchases;
      DELETE FROM promotions; DELETE FROM users;
      DELETE FROM manual_journal;
      DELETE FROM held_orders; DELETE FROM shifts;
      DELETE FROM cash_log; DELETE FROM waste_log;
      DELETE FROM member_topups; DELETE FROM audit_log;
    `)
    migrateTx(data)
  })

  // ===== Public API =====
  return {
    // Products
    getProducts() {
      return stmts.getAllProducts.all().map(p => ({ ...p, noBarcode: !!p.noBarcode }))
    },
    addProduct(data) {
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
      stmts.updateSupplier.run(supplierParams(data, id))
      return { success: true }
    },
    deleteSupplier(id) { stmts.deleteSupplier.run(id); return { success: true } },

    // Purchases
    getPurchases() {
      return stmts.getAllPurchases.all().map(p => ({ ...p, items: JSON.parse(p.items || '[]') }))
    },
    addPurchase(data) {
      stmts.insertPurchase.run({
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
      })
      return { success: true }
    },
    updatePurchase(id, data) {
      const existing = stmts.getAllPurchases.all().find(p => p.id === id)
      if (!existing) return { success: false }
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
      })
      return { success: true }
    },
    deletePurchase(id) { stmts.deletePurchase.run(id); return { success: true } },

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
      stmts.insertManualEntry.run({
        id: data.id || 'j' + Date.now(),
        orderId: data.orderId || '',
        date: data.date || '',
        description: data.description || '',
        type: data.type || 'manual',
        lines: JSON.stringify(data.lines || []),
      })
      return { success: true }
    },
    deleteManualEntry(id) { stmts.deleteManualEntry.run(id); return { success: true } },

    // Backups
    getBackups() {
      return db.prepare('SELECT id,label,createdAt,createdBy,length(data) AS size FROM backups ORDER BY createdAt DESC').all()
    },
    createBackup(label, createdBy) {
      const allData = this.exportData()
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
    restoreBackup(id) {
      const backup = stmts.getBackupById.get(id)
      if (!backup) return { success: false, error: 'backup not found' }
      const data = JSON.parse(backup.data)
      // 清空所有表再匯入 — 包在「單一 transaction」內：若匯入中途 throw，DELETE 會一起 rollback，
      // 不會發生「舊資料已清掉、新資料卻沒匯入」的整庫遺失。
      if(!data||typeof data!=='object')throw new Error('備份格式錯誤')
      const current=this.exportData(),merged={...current,...data}
      for(const key of Object.keys(current).filter(k=>k!=='_revision'))if(!Array.isArray(merged[key]))throw new Error('備份資料集合格式錯誤：'+key)
      if(current.users.length && !merged.users.some(u=>u.role==='owner'))throw new Error('備份必須保留管理員帳號')
      replaceAllTx(merged)
      return { success: true }
    },
    exportData() {
      const data = {
        products: stmts.getAllProducts.all().map(p => ({ ...p, noBarcode: !!p.noBarcode })),
        members: stmts.getAllMembers.all(),
        orders: stmts.getAllOrders.all().map(o=>readOrder(o.id)),
        suppliers: stmts.getAllSuppliers.all().map(parseSupplier),
        purchases: stmts.getAllPurchases.all().map(p => ({ ...p, items: JSON.parse(p.items || '[]') })),
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
      }
      return {...data,_revision:createHash('sha256').update(JSON.stringify(data)).digest('hex')}
    },
    importData(data, expectedRevision) {
      // 同 restoreBackup：清空＋重匯包成單一 transaction，避免匯入失敗造成整庫遺失
      if (expectedRevision && this.exportData()._revision!==expectedRevision) throw new Error('本機資料已改變，已取消覆蓋')
      if(!data||typeof data!=='object')throw new Error('備份格式錯誤')
      const current=this.exportData(),merged={...current,...data}
      for(const key of Object.keys(current).filter(k=>k!=='_revision'))if(!Array.isArray(merged[key]))throw new Error('備份資料集合格式錯誤：'+key)
      if(current.users.length && !merged.users.some(u=>u.role==='owner'))throw new Error('備份必須保留管理員帳號')
      replaceAllTx(merged)
      return { success: true }
    },

    // Settings
    getSetting(key) {
      const row = stmts.getSetting.get(key)
      return row ? row.value : null
    },
    setSetting(key, value) {
      stmts.setSetting.run(key, value)
      return { success: true }
    },
    getAllSettings() {
      const rows = stmts.getAllSettings.all()
      const result = {}
      for (const r of rows) result[r.key] = r.value
      return result
    },

    // Migration
    migrateFromLocalStorage(data) {
      return migrateTx(data)
    },
    isEmpty() {
      return ['products','members','orders','suppliers','purchases','promotions','manual_journal','held_orders','shifts','cash_log','waste_log','member_topups'].every(t=>db.prepare('SELECT 1 FROM '+t+' LIMIT 1').get()==null)
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
      const shift = stmts.getShiftById.get(id)
      if(!shift||shift.status!=='open')throw new Error('班別已關閉或不存在')
      if(typeof data.closeCash!=='number'||!Number.isFinite(data.closeCash)||data.closeCash<0||data.closeCash>1e9)throw new Error('交班現金不正確')
      // 計算這班的現金/卡片銷售（混合付款拆分；完整退貨配對抵銷不計）
      const orders = db.prepare("SELECT * FROM orders WHERE shiftId = ?").all(id)
      let cashSales = 0, cardSales = 0, refundCount = 0, refundAmount = 0
      for (const o of orders) {
        if (o.source==='customer' || !['cash','card','mixed'].includes(o.payMethod)) continue
        if (o.refundOf) {
          refundCount += 1
          refundAmount += Math.abs(o.total)
          // 部分退貨：照付款方式扣回
          if (o.payMethod === 'mixed') {
            try {
              const pays = JSON.parse(o.payments || '[]')
              for (const p of pays) {
                if (p.method === 'cash') cashSales += (p.amount || 0)
                else cardSales += (p.amount || 0)
              }
            } catch { cardSales += o.total }
          } else if (o.payMethod === 'cash') cashSales += o.total
          else cardSales += o.total
          continue
        }
        if (o.payMethod === 'mixed' && o.payments) {
          try {
            const pays = JSON.parse(o.payments)
            for (const p of pays) {
              if (p.method === 'cash') cashSales += (p.amount || 0)
              else cardSales += (p.amount || 0)
            }
          } catch { cardSales += o.total }
        } else if (o.payMethod === 'cash') cashSales += o.total
        else cardSales += o.total
      }
      const cashIn = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM cash_log WHERE shiftId = ? AND type='in'").get(id).s
      const cashOut = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM cash_log WHERE shiftId = ? AND type='out'").get(id).s
      const expected = (shift.openCash || 0) + cashSales + cashIn - cashOut
      const closeCash = data.closeCash || 0
      stmts.closeShift.run({
        id, closeTime: new Date().toISOString(),
        closeCash, expectedCash: expected, diff: closeCash - expected,
        cashSales, cardSales, orderCount: orders.length - refundCount,
        refundCount, refundAmount, note: data.note || '',
      })
      return { success: true, expected, diff: closeCash - expected }
    },
    getCashLog(shiftId) {
      return shiftId ? stmts.getCashLog.all(shiftId) : stmts.getAllCashLog.all()
    },
    addCashLog(data) {
      if(!['in','out'].includes(data.type)||typeof data.amount!=='number'||!Number.isFinite(data.amount)||data.amount<=0||data.amount>1e9||stmts.getShiftById.get(data.shiftId)?.status!=='open')throw new Error('現金異動或班別不正確')
      stmts.insertCashLog.run({
        id: data.id || 'CL' + Date.now() + Math.random().toString(36).slice(2,5),
        shiftId: data.shiftId || '',
        time: data.time || new Date().toISOString(),
        type: data.type || 'in',
        amount: data.amount || 0,
        reason: data.reason || '',
        cashier: data.cashier || '',
      })
      return { success: true }
    },

    // ===== Waste 損耗 =====
    getWasteLog() {
      return stmts.getAllWaste.all()
    },
    addWaste(data) {
      return db.transaction(()=>{
        const p=stmts.getProductById.get(data.productId)
        if(!p||typeof data.qty!=='number'||!Number.isFinite(data.qty)||data.qty<=0||data.qty>p.stock)throw new Error('損耗商品或數量不正確')
        const waste={...data,productName:p.name,cost:p.cost||0,reason:data.reason||'',cashier:data.cashier||''}
        stmts.insertWaste.run(waste)
        stmts.updateProductStock.run({id:p.id,delta:-data.qty})
        return {success:true,waste,product:stmts.getProductById.get(p.id)}
      })()
    },
    deleteWaste(id) { stmts.deleteWaste.run(id); return { success: true } },

    // ===== Member Topups 會員儲值 =====
    getTopups(memberId) {
      return memberId ? stmts.getMemberTopups.all(memberId) : stmts.getAllTopups.all()
    },
    addTopup(data) {
      try {return db.transaction(()=>{
        if ([data.amount,data.bonus].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e9)||!['cash','card'].includes(data.payMethod)) throw new Error('儲值金額或付款方式不正確')
        const member=stmts.getMemberById.get(data.memberId)
        if (!member) throw new Error('會員不存在')
        const old=db.prepare('SELECT * FROM member_topups WHERE id=?').get(data.id)
        if (old) {
          if (['memberId','amount','bonus','payMethod','time','cashier','note'].some(k=>(old[k]||'')!==(data[k]||''))) throw new Error('儲值單號內容不一致')
          return {success:true,member,topup:old}
        }
        stmts.insertTopup.run({...data,note:data.note||'',cashier:data.cashier||''})
        stmts.updateMemberBalance.run({id:member.id,delta:Math.round((data.amount+data.bonus)*100)/100})
        return {success:true,member:stmts.getMemberById.get(member.id),topup:data}
      })()} catch(error){return {success:false,committed:false,error:error.message}}
    },

    close() {
      db.close()
    },
  }
}
