// Persistent SQLite triggers make older, unaware writers fail before touching a
// book that has used customer advances. The support function is connection-local.
const feature='customer-ledger-v1'
const tables=['products','members','orders','order_items','suppliers','purchases','promotions','manual_journal','held_orders','shifts','cash_log','waste_log','member_topups','audit_log','settings','sales_documents','sales_operations','sales_runtime','restaurant_orders','restaurant_operations','customer_entries','customer_operations']
function register(db){db.function('pos_require_feature',{deterministic:true},value=>{if(value!==feature)throw Error('資料庫使用較新功能，請使用相容版本並保留原資料');return 1})}
function installCustomerFence(db){
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='pos_customer_guard_sales_runtime_insert'").get())return
  db.transaction(()=>{
    const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name))
    for(const table of tables.filter(name=>existing.has(name)))for(const action of ['insert','update','delete'])
      db.exec(`CREATE TRIGGER IF NOT EXISTS pos_customer_guard_${table}_${action} BEFORE ${action.toUpperCase()} ON ${table} BEGIN SELECT pos_require_feature('${feature}'); END;`)
  })()
}
module.exports={register,installCustomerFence}
