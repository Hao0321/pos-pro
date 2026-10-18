// ═══════════════════════════════════════════════════════════
import {salesDate as localDate} from './salesRules.mjs'
import {spreadsheetRowsCSV} from './spreadsheetCsv.mjs'
import {financialPnL,financialBalance} from './ledgerReports.mjs'
import {journalLineCents,spreadsheetMoneyCents} from './journalAmounts.mjs'
import {restaurantFundedOrderToJournalEntries} from './restaurantFundsJournal.mjs'
export {formatMoneyCents,centsDecimal,journalLineCents} from './journalAmounts.mjs'
// 會計引擎 — 複式記帳 + 科目表 + 報表生成
// ═══════════════════════════════════════════════════════════

// ── 科目表 (Chart of Accounts) ───────────────────────────
export const ACCOUNTS = {
  // 資產 Assets (1xxx)
  '1101': { name: '現金',         type: 'asset',    normal: 'debit',  group: '流動資產' },
  '1103': { name: '銀行存款',     type: 'asset',    normal: 'debit',  group: '流動資產' },
  '1141': { name: '應收帳款',     type: 'asset',    normal: 'debit',  group: '流動資產' },
  '1211': { name: '存貨',         type: 'asset',    normal: 'debit',  group: '流動資產' },
  '1261': { name: '供應商預付款', type: 'asset',    normal: 'debit',  group: '流動資產' },
  '1501': { name: '設備',         type: 'asset',    normal: 'debit',  group: '非流動資產' },
  // 負債 Liabilities (2xxx)
  '2101': { name: '應付帳款',     type: 'liability', normal: 'credit', group: '流動負債' },
  '2102': { name: '進貨暫估應付', type: 'liability', normal: 'credit', group: '流動負債' },
  '2111': { name: '銷項稅額',     type: 'liability', normal: 'credit', group: '流動負債' },
  '2191': { name: '預收款',       type: 'liability', normal: 'credit', group: '流動負債' },
  '2192': { name: '客戶預收款',   type: 'liability', normal: 'credit', group: '流動負債' },
  '2193': { name: '餐飲預收款',   type: 'liability', normal: 'credit', group: '流動負債' },
  '2291': { name: '待核對成本暫記', type: 'liability', normal: 'credit', group: '流動負債' },
  // 業主權益 Equity (3xxx)
  '3101': { name: '業主資本',     type: 'equity',   normal: 'credit', group: '業主權益' },
  '3901': { name: '保留盈餘',     type: 'equity',   normal: 'credit', group: '業主權益' },
  '3902': { name: '開帳待對帳',   type: 'equity',   normal: 'credit', group: '業主權益' },
  // 收入 Revenue (4xxx)
  '4101': { name: '銷售收入',     type: 'revenue',  normal: 'credit', group: '營業收入' },
  '4191': { name: '其他收入',     type: 'revenue',  normal: 'credit', group: '其他收入' },
  // 支出 Expenses (5xxx)
  '5101': { name: '銷貨成本',     type: 'expense',  normal: 'debit',  group: '營業成本' },
  '5201': { name: '薪資費用',     type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5202': { name: '租金費用',     type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5203': { name: '水電費',       type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5204': { name: '進貨費用',     type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5205': { name: '廣告費',       type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5206': { name: '雜費',         type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5207': { name: '促銷費用',     type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5208': { name: '庫存損耗',     type: 'expense',  normal: 'debit',  group: '營業費用' },
  '5301': { name: '折舊費用',     type: 'expense',  normal: 'debit',  group: '非現金項目' },
}

export const ACCOUNT_GROUPS = {
  asset:     ['流動資產', '非流動資產'],
  liability: ['流動負債'],
  equity:    ['業主權益'],
  revenue:   ['營業收入', '其他收入'],
  expense:   ['營業成本', '營業費用', '非現金項目'],
}

// ── 從訂單自動產生分錄 ────────────────────────────────────
export function orderToJournalEntries(order, products, restaurantEntry) {
  if(order.source==='restaurant-funded')return restaurantFundedOrderToJournalEntries(order,restaurantEntry)
  if(order.source==='customer' || order.payMethod==='pending' || (order.status && !['completed','refunded'].includes(order.status)))return []
  const entries = []
  const items = order.items || []
  const date  = order.time&&Number.isFinite(Date.parse(order.time))?localDate(new Date(order.time)):''
  const disc  = order.discount || 0   // 會員點數折抵（退貨單為負）

  // 計算銷貨成本（退貨單 qty 為負 → cogs 為負，用來沖回成本與存貨）
  const cogs = items.reduce((sum, item) => {
    const prod = products.find(p => p.id === item.id)
    return sum + (order.itemCosts?.[item.id] ?? prod?.cost ?? 0) * item.qty
  }, 0)

  let pays=typeof order.payments==='string'?JSON.parse(order.payments):order.payments
  if(!Array.isArray(pays)||!pays.length){if(order.payMethod==='mixed')throw Error('混合付款缺少明細，請核對原紀錄');pays=[{method:order.payMethod||'cash',amount:order.total}]}
  if(pays.some(p=>!['cash','card'].includes(p.method)||!Number.isFinite(p.amount))||Math.round(pays.reduce((n,p)=>n+p.amount,0)*100)!==Math.round(order.total*100))throw Error('付款流水與應收金額不一致，請核對原紀錄')

  // 分錄 1：確認收入。order.total 已是「折抵後實收淨額」，所以：
  //   現金/銀行 = 實收淨額 (order.total)
  //   銷售收入 4101 = 原價（淨額 + 折抵），認列原價
  //   其他收入 4191 借方 = 折抵金額 → 當作 sales-discount 的 contra-revenue
  //   （淨營收 = 原價 − 折抵 = 實收；現金永遠等於實收）
  // 舊版用「貸記現金」沖折抵，會把現金與營收各虛減一次 → 已修正。
  entries.push({
    id:          'J' + order.id + '_rev',
    orderId:     order.id,
    date,
    description: `銷售收入 — ${order.id}`,
    type:        'auto_sale',
    lines: [
      ...pays.map(p=>({account:p.method==='cash'?'1101':'1103',debit:p.amount,credit:0,note:p.method==='cash'?'現金收款':'電子支付'})),
      ...(disc !== 0 ? [{ account: '4191', debit: disc, credit: 0, note: '會員點數折抵' }] : []),
      { account: '4101', debit: 0, credit: order.total + disc, note: disc !== 0 ? '銷售收入（原價）' : '銷售收入' },
    ],
  })

  // 分錄 2：確認銷貨成本。退貨時 cogs 為負，需照樣記以沖回成本/存貨，故用 !== 0（舊版 > 0 會漏記退貨）
  if (cogs !== 0) {
    entries.push({
      id:          'J' + order.id + '_cogs',
      orderId:     order.id,
      date,
      description: `銷貨成本 — ${order.id}`,
      type:        'auto_cogs',
      lines: [
        { account: '5101', debit: cogs, credit: 0,    note: '銷貨成本' },
        { account: '1211', debit: 0,    credit: cogs, note: '存貨減少' },
      ],
    })
  }

  // 分錄 3：儲值折抵。order.total 是「扣掉儲值後的現金/電子實收」，用儲值付的部分要另外認列收入並沖預收款，
  // 否則用儲值結帳的營收會完全不見（舊版問題）。
  const bal = order.balanceUsed || 0
  if (bal !== 0) {
    entries.push({
      id:          'J' + order.id + '_bal',
      orderId:     order.id,
      date,
      description: `儲值折抵 — ${order.id}`,
      type:        'auto_balance',
      lines: [
        { account: '2191', debit: bal, credit: 0,   note: '預收款（儲值）抵用' },
        { account: '4101', debit: 0,   credit: bal, note: '儲值消費收入' },
      ],
    })
  }

  return entries
}

// ── 會員儲值自動分錄 ────────────────────────────────────────
// 加值：Dr 現金/銀行(實收) + Dr 促銷費(贈送) / Cr 預收款(實收+贈送)
// 之後用儲值消費時，再由 orderToJournalEntries 的 auto_balance 把預收款轉成收入，整段金流即完整入帳。
export function topupToJournalEntries(topup) {
  if (!topup) return []
  const amount = Number(topup.amount) || 0   // 實收現金/電子
  const bonus  = Number(topup.bonus) || 0    // 贈送額（促銷成本）
  if (amount === 0 && bonus === 0) return []
  const date = topup.time&&Number.isFinite(Date.parse(topup.time))?localDate(new Date(topup.time)):''
  const payAccount = topup.payMethod === 'cash' ? '1101' : '1103'
  const lines = [
    { account: payAccount, debit: amount, credit: 0, note: topup.payMethod === 'cash' ? '現金儲值' : '電子儲值' },
  ]
  if (bonus !== 0) lines.push({ account: '5207', debit: bonus, credit: 0, note: '儲值贈送（促銷）' })
  lines.push({ account: '2191', debit: 0, credit: amount + bonus, note: '預收款（儲值）' })
  return [{
    id:          'JT' + topup.id,
    orderId:     topup.id,
    date,
    description: `會員儲值 — ${topup.id}`,
    type:        'auto_topup',
    lines,
  }]
}

export function wasteToJournalEntries(waste,reference=null){
  const value=reference?.valueCents??Math.round(Number(waste.cost||0)*Math.abs(Number(waste.qty))*100)
  if(!Number.isSafeInteger(value)||value<0)throw Error('損耗成本需要核對')
  if(!value)return []
  const date=waste.time&&Number.isFinite(Date.parse(waste.time))?localDate(new Date(waste.time)):''
  return [{id:'JW'+waste.id,orderId:waste.id,date,description:'庫存損耗 — '+(waste.productName||waste.id),type:'auto_waste',lines:[{account:'5208',debit:value/100,credit:0,note:waste.reason||''},{account:'1211',debit:0,credit:value/100,note:'已扣除的存貨'}]}]
}
// ── 損益表 ─────────────────────────────────────────────────
export function buildPnL(journalEntries, from, to, options={}) {return financialPnL(journalEntries,from,to,ACCOUNTS,options)}

// ── 資產負債表 ──────────────────────────────────────────────
export function buildBalanceSheet(journalEntries, asOf, options={}) {return financialBalance(journalEntries,asOf,ACCOUNTS,options)}

// ── 日記帳摘要（依日期分組）─────────────────────────────────
export function groupJournalByDate(journalEntries) {
  const map = {}
  journalEntries.forEach(j => {
    if (!map[j.date]) map[j.date] = []
    map[j.date].push(j)
  })
  return Object.entries(map).sort(([a],[b]) => b.localeCompare(a))
}

// ── CSV 匯出 ────────────────────────────────────────────────
export function exportJournalCSV(journalEntries) {
  const rows = [['日期', '憑單號', '摘要', '科目代號', '科目名稱', '借方', '貸方', '類型']]
  journalEntries.forEach(j => {
    j.lines.forEach(l => {
      rows.push([
        j.date, j.id, j.description,
        l.account, ACCOUNTS[l.account]?.name || l.account,
        j.amountUnit==='cents'?spreadsheetMoneyCents(journalLineCents(j,l,'debit')):l.debit||'',
        j.amountUnit==='cents'?spreadsheetMoneyCents(journalLineCents(j,l,'credit')):l.credit||'',j.type,
      ])
    })
  })
  return spreadsheetRowsCSV(rows)
}
export function exportPnLCSV(pnl, from, to) {
  const value=(key,negative=false)=>pnl.exact[key]===null?'成本待確認':spreadsheetMoneyCents(BigInt(pnl.exact[key])*(negative?-1n:1n))
  const rows = [
    ['損益表', `${from} ~ ${to}`], [''],
    ['項目', '金額'],
    ['報表狀態', pnl.complete?'已列分錄可核對':'成本或帳務待核對'],
    ['營業收入', value('revenue')],
    ['銷貨成本', value('cogs',true)],
    ['毛利', value('grossProfit')],
    [`毛利率`, pnl.grossMargin===null?'成本待確認':`${pnl.grossMargin}%`],
    ['營業費用', value('opExpenses',true)],
    ['本期淨利', value('netIncome')],
    [`淨利率`, pnl.netMargin===null?'成本待確認':`${pnl.netMargin}%`],
  ]
  if(!pnl.complete)rows.push(['已知銷貨成本（非完整成本）',spreadsheetMoneyCents(pnl.knownExact.cogs)],['已知營業費用',spreadsheetMoneyCents(pnl.knownExact.opExpenses)])
  return spreadsheetRowsCSV(rows)
}
