module.exports=function prepareMigration(db,stmts,orderInsertParams,supplierParams,stockStore){
  // ===== Migration =====
  const migrateTx = db.transaction((data,{costRestore=false}={}) => {
    const rawSettings=data.settings||[],encoding=require('./settingEncoding.mjs')
    encoding.validateSettingRows(rawSettings,'sqlite')
    require('./masterMigration.mjs').readMasterMigrationHistory(data)
    require('./reservationHistory.mjs').readReservationBook(data)
    if(rawSettings.some(row=>row.key==='reservationVersionFence'&&row.value==='1'))require('./databaseFeatureFence.cjs').installReservationFence(db)
    if(rawSettings.some(row=>row.key==='agentMasterMigrationVersionFence'&&row.value==='1'))require('./databaseFeatureFence.cjs').installMasterMigrationFence(db)
    if(rawSettings.some(row=>row.key==='stockOpeningMigrationVersionFence'&&row.value==='1'))require('./databaseFeatureFence.cjs').installOpeningMigrationFence(db)
    if(rawSettings.some(row=>row.key==='openingCutoverVersionFence'&&row.value==='1'))require('./databaseFeatureFence.cjs').installCutoverFence(db)
    if(rawSettings.some(row=>row.key==='agentWorkbookMigrationVersionFence'&&row.value==='1'))require('./databaseFeatureFence.cjs').installWorkbookMigrationFence(db)
    if(rawSettings.some(row=>row.key==='agentTabularMigrationVersionFence'&&row.value==='1'))require('./databaseFeatureFence.cjs').installTabularMigrationFence(db)
    data={...data,settings:encoding.settingsForValidation(rawSettings,'sqlite')}
    require('./stockBackup.mjs').validateStockCostBook(data)
    if(!costRestore&&(data.stockCostEntries?.length||data.stockCostOperations?.length))throw require('./stockOpeningPlan.mjs').stockLedgerError('FLOW')
    require('./procurementRules.mjs').validateProcurementRecords(data.purchases||[],data.cashLog||[])
    require('./businessExchange.mjs').validateExchangeSettings(data.settings||[],data.purchases||[],data.auditLog||[])
    const exchange=require('./businessExchange.mjs')
    const openingBalanceContext=require('./openingCutoverHistory.mjs').readOpeningCutoverHistory(data).context
    require('./supplierLedger.mjs').validateSupplierLedgerRecords(data.supplierEntries||[],data.supplierOperations||[],{storeId:exchange.readExchangeTextSetting(data.settings||[],'sharedStoreId'),suppliers:data.suppliers||[],purchases:data.purchases||[],inventoryAudits:data.auditLog||[],cashLogs:data.cashLog||[],openingBalanceContext})
    if(data.supplierEntries?.length||data.supplierOperations?.length)require('./databaseFeatureFence.cjs').installSupplierFence(db)
    for(const [key,table]of [['supplierEntries','supplier_entries'],['supplierOperations','supplier_operations']])for(const row of data[key]||[])db.prepare('INSERT INTO '+table+' (id,data) VALUES (?,?)').run(row.id,JSON.stringify(row))
    require('./customerLedger.mjs').validateCustomerLedgerRecords(data.customerEntries||[],data.customerOperations||[],{storeId:data.settings?.find(s=>s.key==='sharedStoreId')?.value,documents:data.salesDocuments||[],salesOperations:data.salesOperations||[],cashLogs:data.cashLog||[],openingBalanceContext})
    if(data.customerEntries?.length||data.customerOperations?.length)require('./databaseFeatureFence.cjs').installCustomerFence(db)
    for(const [key,table]of [['customerEntries','customer_entries'],['customerOperations','customer_operations']])for(const row of data[key]||[])db.prepare('INSERT INTO '+table+' (id,data) VALUES (?,?)').run(row.id,JSON.stringify(row))
    require('./salesPlan.mjs').validateSalesRecords(data.salesDocuments||[],data.salesOperations||[],data.cashLog||[],data.settings?.find(s=>s.key==='sharedStoreId')?.value,data.products||[],exchange.readExchangeStore(exchange.readExchangeTextSetting(data.settings||[],exchange.EXCHANGE_SETTING)).quotes)
    for(const [key,table]of [['salesDocuments','sales_documents'],['salesOperations','sales_operations']])for(const row of data[key]||[])db.prepare('INSERT INTO '+table+' (id,data) VALUES (?,?)').run(row.id,JSON.stringify(row))
    const restaurantConfig=data.settings?.find(s=>s.key==='restaurantConfig')
    const checkedConfig=require('./restaurantRules.mjs').readRestaurantConfig(restaurantConfig?.value??null,data.products||[])
    if(require('./restaurantMenuOriginal.mjs').usesRestaurantMenu(checkedConfig,data.restaurantOrders||[],data.restaurantOperations||[]))require('./databaseFeatureFence.cjs').installMenuFence(db)
    if(require('./restaurantCustomerMenu.mjs').usesRestaurantPublicMenu(data.orders||[]))require('./databaseFeatureFence.cjs').installPublicMenuFence(db)
    if(require('./privateDrafts.mjs').usesPrivateQuickDrafts(data.restaurantOperations||[],data.auditLog||[]))require('./databaseFeatureFence.cjs').installPrivateQuickFence(db)
    if(require('./restaurantFunds.mjs').usesRestaurantFunds(checkedConfig,data.restaurantOrders||[],data.orders||[]))require('./databaseFeatureFence.cjs').installFundsFence(db)
    if(Object.hasOwn(data,'kitchenPrintJobs')!==Object.hasOwn(data,'kitchenPrintOperations'))throw Error('廚房列印紀錄需要核對，請保留原單')
    if(Object.hasOwn(checkedConfig,'kitchenPrinting')&&!Object.hasOwn(data,'kitchenPrintJobs'))throw Error('廚房列印紀錄需要核對，請保留原單')
    require('./kitchenPrint.mjs').validateKitchenRecords(data.kitchenPrintJobs||[],data.kitchenPrintOperations||[],{entries:data.restaurantOrders||[],restaurantOperations:data.restaurantOperations||[]})
    if(require('./kitchenPrint.mjs').usesKitchenPrinting(checkedConfig,data.kitchenPrintJobs,data.kitchenPrintOperations))require('./databaseFeatureFence.cjs').installKitchenPrintFence(db)
    for(const [key,table]of [['kitchenPrintJobs','kitchen_print_jobs'],['kitchenPrintOperations','kitchen_print_operations']])for(const row of data[key]||[])db.prepare('INSERT INTO '+table+' (id,data) VALUES (?,?)').run(row.id,JSON.stringify(row))
    if(require('./tableOrdering.mjs').usesRestaurantIntake(checkedConfig,data.restaurantOrders||[],data.orders||[]))require('./databaseFeatureFence.cjs').installIntakeFence(db)
    if(data.restaurantOrders||data.restaurantOperations){
      require('./restaurantRules.mjs').validateRestaurantRecords(data.restaurantOrders||[],data.restaurantOperations||[],data.orders||[],data.products||[],{cashLogs:data.cashLog||[],waste:data.wasteLog||[],storeId:data.settings?.find(row=>row.key==='sharedStoreId')?.value,config:checkedConfig,menuConfigurationId:exchange.readExchangeTextSetting(data.settings,require('./restaurantMenuOriginal.mjs').RESTAURANT_MENU_CONFIG_KEY),menuReceiptKey:exchange.readExchangeTextSetting(data.settings,'orderReceiptSecret')})
      for(const [key,table] of [['restaurantOrders','restaurant_orders'],['restaurantOperations','restaurant_operations']])for(const row of data[key]||[])db.prepare('INSERT INTO '+table+' (id,data) VALUES (?,?)').run(row.id,JSON.stringify(row))
    }
    for(const row of rawSettings)stmts.setRawSetting.run(row)
    if(rawSettings.some(row=>row.encoding||Object.hasOwn(row,'id')))require('./databaseFeatureFence.cjs').installCrossStorageFence(db)
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
        db.prepare('UPDATE products SET createdAt=?,updatedAt=? WHERE id=?').run(p.createdAt??null,p.updatedAt??null,p.id)
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
          note:m.note||'',
        })
        db.prepare('UPDATE members SET createdAt=? WHERE id=?').run(m.createdAt??null,m.id)
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
          procurement:p.procurement?JSON.stringify(p.procurement):null,
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
          note:pr.note||'',
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
          shiftId:t.shiftId||'',
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

    if(!costRestore&&require('./stockCompatibility.mjs').hasStockCostHistory(data))stockStore.ensureCompatibility()
    return { success: true }
  })

  // 「清空全部表 + 重新匯入」包成單一 transaction：
  // importData / restoreBackup 共用。若 migrateTx 中途 throw（例如缺欄位、髒資料），
  // 連同前面的 DELETE 一起 rollback，保證不會把舊資料清掉卻沒匯入新資料造成整庫遺失。
  const replaceAllTx = db.transaction((data) => {
    require('./stockBackup.mjs').validateStockCostBook(data)
    return stockStore.restore(()=>{
    db.exec(`
      DELETE FROM products; DELETE FROM members;
      DELETE FROM order_items; DELETE FROM orders;
      DELETE FROM suppliers; DELETE FROM purchases;
      DELETE FROM promotions; DELETE FROM users;
      DELETE FROM manual_journal;
      DELETE FROM held_orders; DELETE FROM shifts;
      DELETE FROM cash_log; DELETE FROM waste_log;
      DELETE FROM member_topups; DELETE FROM audit_log;
      DELETE FROM settings;
      DELETE FROM restaurant_orders; DELETE FROM restaurant_operations;
      DELETE FROM sales_documents; DELETE FROM sales_operations; DELETE FROM customer_entries; DELETE FROM customer_operations;
      DELETE FROM supplier_entries; DELETE FROM supplier_operations;
      DELETE FROM kitchen_print_jobs; DELETE FROM kitchen_print_operations;
    `)
    migrateTx(data,{costRestore:true})
    db.prepare('UPDATE sales_runtime SET value=? WHERE id=?').run(require('node:crypto').randomUUID(),'epoch')
    stockStore.replace(data)
    })
  })

  return {migrateTx,replaceAllTx}
}
