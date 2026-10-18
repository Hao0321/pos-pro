// One vocabulary for Agent drafts and directly uploaded delimited tables.
export const migrationAliases={
 name:['name','商品名稱','品名','item name','item_name','product name','product_name','supplier name','supplier_name','供應商名稱','供應商','customer name','customer_name','客戶名稱','姓名','客戶'],
 barcode:['barcode','條碼','ean'],unit:['unit','單位','uom','stock uom','stock_uom','基本單位'],
 price:['price','售價','selling price','sales price','sales_price','list_price','standard_rate','標準售價'],cost:['cost','成本','valuation rate','valuation_rate','參考成本'],
 stock:['stock','庫存','quantity','qty','opening stock','期初庫存','opening_stock','actual_qty','qty_available','庫存量','庫存數量','現有庫存'],category:['category','分類'],supplier:['supplier id','supplier_id','供應商編號'],
 phone:['phone','電話','手機','mobile'],contact:['contact','聯絡人'],payTerms:['payment terms','payterms','付款條件'],note:['note','notes','備註'],birthday:['birthday','生日'],
 balance:['balance','儲值','儲值餘額','credit','outstanding','欠款','未收款','未付款','應收帳款','應付帳款','未收帳款','未付帳款','預收款','預付款','會員儲值','儲值金','帳款餘額','outstanding_amount','opening_balance'],points:['points','點數','點數餘額','會員點數','reward points','loyalty points'],totalSpent:['totalspent','total spent','累計消費','total_spent','消費總額','消費累計'],currency:['currency','幣別','currency code','貨幣','currency_code']
}
export const protectedTabularFields=['stock','balance','points','totalSpent','currency']
export const tabularFieldNames={externalId:'原系統編號',name:'名稱',barcode:'條碼',unit:'單位',price:'售價',cost:'參考成本',category:'分類',supplier:'供應商編號',phone:'電話',contact:'聯絡人',payTerms:'付款條件',note:'備註',birthday:'生日',stock:'庫存',balance:'儲值或帳款',points:'點數',totalSpent:'累計消費',currency:'幣別'}
export const tabularEntityFields={products:['name','barcode','unit','price','cost','category','supplier'],suppliers:['name','phone','contact','payTerms','note'],customers:['name','phone','birthday','note']}
const idAliases=['id','external id','external_id','原系統編號','原編號']
const entityIds={products:['product code','product_code','item code','item_code','商品編號','商品代碼','貨號'],suppliers:['supplier code','supplier_code','supplier id','supplier_id','供應商編號','供應商代碼'],customers:['customer code','customer_code','customer id','customer_id','member id','member_id','客戶編號','會員編號']}
const entityNames={products:['name','商品名稱','品名','item name','item_name','product name','product_name'],suppliers:['name','supplier name','supplier_name','供應商名稱','供應商'],customers:['name','customer name','customer_name','客戶名稱','姓名','客戶']}
export const migrationColumnAliases=(field,entity)=>field==='name'&&Object.hasOwn(entityNames,entity)?entityNames[entity]:migrationAliases[field]
export function migrationColumnField(header,entity=null){
 const key=header.trim().toLowerCase()
 if(idAliases.includes(key)||Object.hasOwn(entityIds,entity)&&entityIds[entity].includes(key))return 'externalId'
 if(entity==='products'&&['supplier code','supplier_code','供應商代碼'].includes(key))return 'supplier'
 return Object.keys(migrationAliases).find(field=>migrationColumnAliases(field,entity).includes(key))||''
}
