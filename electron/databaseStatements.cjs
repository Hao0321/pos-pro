module.exports=function prepareStatements(db){
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
      INSERT INTO members (id, name, phone, points, tier, totalSpent, joinDate, balance, birthday, lastBirthdayBonus,note)
      VALUES (@id, @name, @phone, @points, @tier, @totalSpent, @joinDate, @balance, @birthday, @lastBirthdayBonus,@note)
    `),
    updateMember: db.prepare(`
      UPDATE members SET name=@name, phone=@phone, points=@points,
      tier=@tier, totalSpent=@totalSpent, balance=@balance, birthday=@birthday,
      lastBirthdayBonus=@lastBirthdayBonus,note=@note WHERE id=@id
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
      INSERT INTO purchases (id, supplierId, supplierName, status, date, receivedDate, paidDate, note, total, items,procurement)
      VALUES (@id, @supplierId, @supplierName, @status, @date, @receivedDate, @paidDate, @note, @total, @items,@procurement)
    `),
    updatePurchase: db.prepare(`
      UPDATE purchases SET supplierId=@supplierId, supplierName=@supplierName,
      status=@status, date=@date, receivedDate=@receivedDate, paidDate=@paidDate, note=@note,
      total=@total, items=@items,procurement=@procurement WHERE id=@id
    `),
    deletePurchase: db.prepare('DELETE FROM purchases WHERE id = ?'),

    // --- Promotions ---
    getAllPromotions: db.prepare('SELECT * FROM promotions'),
    insertPromotion: db.prepare(`
      INSERT INTO promotions (id, name, type, condition_data, enabled, startAt, endAt,note)
      VALUES (@id, @name, @type, @condition_data, @enabled, @startAt, @endAt,@note)
    `),
    updatePromotion: db.prepare(`
      UPDATE promotions SET name=@name, type=@type, condition_data=@condition_data,
      enabled=@enabled, startAt=@startAt, endAt=@endAt,note=@note WHERE id=@id
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
    getAllWaste: db.prepare('SELECT * FROM waste_log ORDER BY time DESC,id DESC'),
    insertWaste: db.prepare(`
      INSERT INTO waste_log (id, productId, productName, qty, reason, cost, time, cashier)
      VALUES (@id, @productId, @productName, @qty, @reason, @cost, @time, @cashier)
    `),
    deleteWaste: db.prepare('DELETE FROM waste_log WHERE id = ?'),

    // --- Member Topups ---
    getAllTopups: db.prepare('SELECT * FROM member_topups ORDER BY time DESC'),
    getMemberTopups: db.prepare('SELECT * FROM member_topups WHERE memberId = ? ORDER BY time DESC'),
    insertTopup: db.prepare(`
      INSERT INTO member_topups (id, memberId, amount, bonus, payMethod, time, cashier, note,shiftId)
      VALUES (@id, @memberId, @amount, @bonus, @payMethod, @time, @cashier, @note,@shiftId)
    `),
  }

  // ===== Transaction helpers =====
  return stmts
}
