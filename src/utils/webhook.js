// 通用 webhook 通知系統
// 支援：原始 JSON POST、Discord webhook、Slack webhook（自動偵測格式）
// 用法：fireWebhook('low_stock', { products: [...] })

const STORAGE_KEY = 'pos_webhook_config'
const THROTTLE_KEY_PREFIX = 'pos_webhook_throttle_'

export const WEBHOOK_EVENTS = [
  { key: 'low_stock',    label: '低庫存警示',  desc: '每天觸發一次（避免騷擾）' },
  { key: 'checkout',     label: '每筆結帳',    desc: '每張完成的訂單' },
  { key: 'big_sale',     label: '大額訂單',    desc: '單筆超過 NT$1000 才通知' },
  { key: 'refund',       label: '退貨',        desc: '每次退貨' },
  { key: 'shift_open',   label: '開班',        desc: '員工開班時' },
  { key: 'shift_close',  label: '關班',        desc: '員工關班時（含當班報表）' },
  { key: 'expiring',     label: '即將過期商品', desc: '每天一次（7 天內到期）' },
]

export function getWebhookConfig() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? JSON.parse(v) : { url: '', events: ['low_stock', 'big_sale', 'refund'] }
  } catch { return { url: '', events: [] } }
}

export function saveWebhookConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

export function isWebhookEnabled() {
  const cfg = getWebhookConfig()
  return !!(cfg && cfg.url && cfg.events?.length)
}

function isDiscordUrl(url) { return /discord(app)?\.com\/api\/webhooks/.test(url) }
function isSlackUrl(url)   { return /hooks\.slack\.com/.test(url) }

// throttle：每個 event 一段時間內只通知一次（毫秒）
// 只「檢查」不寫入，避免 fetch 失敗仍記為已送導致漏送
function isThrottled(event, intervalMs) {
  const last = parseInt(localStorage.getItem(THROTTLE_KEY_PREFIX + event) || '0')
  return Date.now() - last < intervalMs
}
// 真正送出成功後才記時間戳
function markEventSent(event) {
  localStorage.setItem(THROTTLE_KEY_PREFIX + event, String(Date.now()))
}

// === Discord embed 格式 ===
function formatDiscord(event, payload) {
  const colors = {
    low_stock:    0xe89d2a, // amber
    checkout:     0x4caf50, // green
    big_sale:     0xd4a36b, // gold
    refund:       0xe25c52, // red
    shift_open:   0x4f7fc4, // blue
    shift_close:  0x8b6dc7, // purple
    expiring:     0xe25c52,
  }
  const titles = {
    low_stock:    '⚠️ 低庫存警示',
    checkout:     '🛒 新訂單',
    big_sale:     '💰 大額訂單',
    refund:       '↩️ 退貨通知',
    shift_open:   '🟢 開班',
    shift_close:  '🔴 關班',
    expiring:     '⏰ 商品即將過期',
  }
  return {
    embeds: [{
      title: payload._title || titles[event] || event,
      color: colors[event] || 0x8b7355,
      description: payload._description || '',
      fields: payload._fields || [],
      timestamp: new Date().toISOString(),
      footer: { text: 'POS Pro' },
    }],
  }
}

// === Slack 格式 ===
function formatSlack(event, payload) {
  return {
    text: payload._description || event,
    blocks: payload._fields?.length ? [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${payload._title || event}*\n${payload._description || ''}` },
      },
      ...payload._fields.map(f => ({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${f.name}*: ${f.value}` },
      })),
    ] : undefined,
  }
}

// 主要 fire 函式
export async function fireWebhook(event, payload = {}) {
  const cfg = getWebhookConfig()
  if (!cfg?.url || !cfg.events?.includes(event)) return false

  // throttle 重複事件（只檢查，送出成功後才記時間戳）
  const THROTTLE = {
    low_stock: 6 * 3600 * 1000,    // 6 小時
    expiring:  24 * 3600 * 1000,   // 1 天
  }
  if (THROTTLE[event] && isThrottled(event, THROTTLE[event])) return false

  // 大額訂單門檻
  if (event === 'big_sale' && (payload.total || 0) < 1000) return false

  const url = cfg.url
  let body
  if (isDiscordUrl(url)) body = formatDiscord(event, payload)
  else if (isSlackUrl(url)) body = formatSlack(event, payload)
  else body = { event, timestamp: new Date().toISOString(), store: 'POS Pro', ...payload }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      mode: 'cors',
    })
    if (THROTTLE[event]) markEventSent(event) // 成功送出才記，失敗下次仍會重試
    return true
  } catch (e) {
    console.warn('[webhook] failed:', e)
    return false
  }
}

// === payload 建構助手 ===
export function payloadFromOrder(order, member) {
  const itemsText = (order.items || [])
    .map(i => `${i.name || '商品'} × ${Math.abs(Number(i.qty) || 0)}`)
    .join('、')
  return {
    _title: order.refundOf ? '↩️ 退貨通知' : '🛒 新訂單',
    _description: `${itemsText}\n總額：NT$ ${Math.abs(Number(order.total) || 0).toLocaleString()}`,
    _fields: [
      { name: '訂單編號', value: order.id || '—' },
      { name: '付款方式', value: order.payMethod || 'cash' },
      { name: '會員', value: member?.name || '散客' },
      { name: '收銀員', value: order.cashier || '—' },
    ],
    orderId: order.id,
    total: order.total,
    items: order.items,
  }
}

export function payloadFromLowStock(products) {
  const top = products.slice(0, 10)
  return {
    _title: '⚠️ 低庫存警示',
    _description: `共 ${products.length} 項商品需要補貨`,
    _fields: top.map(p => ({
      name: p.name,
      value: `剩 ${p.stock}${p.reorderLevel ? ` / 安全 ${p.reorderLevel}` : ''}`,
    })),
    count: products.length,
    products: products.map(p => ({ name: p.name, stock: p.stock, reorderLevel: p.reorderLevel })),
  }
}

export function payloadFromExpiring(expired, soon) {
  return {
    _title: '⏰ 商品到期警示',
    _description: `${expired.length} 項已過期、${soon.length} 項即將到期`,
    _fields: [
      ...expired.slice(0, 5).map(p => ({ name: '🔴 ' + p.name, value: `已過期 ${Math.abs(p.daysLeft)} 天` })),
      ...soon.slice(0, 5).map(p => ({ name: '🟡 ' + p.name, value: `${p.daysLeft} 天內到期` })),
    ],
    expired: expired.length,
    soon: soon.length,
  }
}

export function payloadFromShift(shift, action, summary = {}) {
  return {
    _title: action === 'open' ? '🟢 開班' : '🔴 關班',
    _description: `收銀員：${shift.cashier || '—'}`,
    _fields: action === 'open' ? [
      { name: '開班時間', value: new Date(shift.openTime).toLocaleString('zh-TW') },
      { name: '零用金', value: `NT$ ${(shift.openCash || 0).toLocaleString()}` },
    ] : [
      { name: '營業額（現金）', value: `NT$ ${(summary.cashSales || 0).toLocaleString()}` },
      { name: '營業額（電子）', value: `NT$ ${(summary.cardSales || 0).toLocaleString()}` },
      { name: '訂單數', value: String(summary.orderCount || 0) },
      { name: '預估現金', value: `NT$ ${(summary.expected || 0).toLocaleString()}` },
      { name: '實點現金', value: `NT$ ${(summary.closeCash || 0).toLocaleString()}` },
      { name: '差異', value: `NT$ ${(summary.diff || 0).toLocaleString()}` },
    ],
    shift, summary,
  }
}
