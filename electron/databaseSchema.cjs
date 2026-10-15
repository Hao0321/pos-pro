module.exports=function initializeSchema(db){
  db.exec('CREATE TABLE IF NOT EXISTS sales_documents (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sales_operations (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sales_runtime (id TEXT PRIMARY KEY,value TEXT NOT NULL);')
  db.prepare('INSERT OR IGNORE INTO sales_runtime (id,value) VALUES (?,?)').run('epoch',require('node:crypto').randomUUID())
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_orders (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS restaurant_operations (id TEXT PRIMARY KEY, data TEXT NOT NULL);`)
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
    ensureColumn('members','note',"TEXT DEFAULT ''")
    ensureColumn('member_topups','shiftId',"TEXT DEFAULT ''")
    ensureColumn('purchases', 'paidDate', "TEXT DEFAULT ''")
    ensureColumn('purchases', 'procurement', 'TEXT DEFAULT NULL')
    ensureColumn('promotions','note',"TEXT DEFAULT ''")
  } catch(e){db.close();throw new Error('資料庫結構更新未完成，已保留原始資料：'+e.message)}

  // ===== Prepared Statements =====

  // --- Products ---
}
