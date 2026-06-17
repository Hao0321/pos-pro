import { useState, useEffect, useCallback } from 'react'
import { Bell, Check, X, Clock, ChefHat, RefreshCw } from 'lucide-react'
import { isElectron, loadCustomerOrders, updateOrderStatus } from '../utils/dataAccess'

const STATUS_MAP = {
  pending:   { label: '待處理', color: '#e67e22', icon: Clock },
  accepted:  { label: '準備中', color: '#3498db', icon: ChefHat },
  completed: { label: '已完成', color: '#27ae60', icon: Check },
  rejected:  { label: '已拒絕', color: '#e74c3c', icon: X },
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('pending')
  const [loading, setLoading] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadCustomerOrders()
      setOrders(data || [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // 監聽新訂單事件
  useEffect(() => {
    if (!isElectron) return
    const unsub = window.electronAPI.onNewOrder((order) => {
      setOrders(prev => [order, ...prev.filter(o => o.id !== order.id)])
      // 播放通知音效
      try { new Audio('/notification.mp3').play().catch(() => {}) } catch {}
    })
    return unsub
  }, [])

  const handleAccept = async (orderId) => {
    await updateOrderStatus(orderId, 'accepted')
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'accepted' } : o))
  }

  const handleReject = async (orderId) => {
    await updateOrderStatus(orderId, 'rejected')
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'rejected' } : o))
  }

  const handleComplete = async (orderId) => {
    await updateOrderStatus(orderId, 'completed')
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'completed' } : o))
  }

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter)
  const pendingCount = orders.filter(o => o.status === 'pending').length

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Bell size={22} />
        <h2 style={{ flex: 1, fontSize: '1.3rem' }}>顧客點餐</h2>
        {pendingCount > 0 && (
          <span style={{
            background: '#e74c3c', color: '#fff', padding: '4px 12px',
            borderRadius: 20, fontSize: '0.85rem', fontWeight: 700,
          }}>
            {pendingCount} 筆待處理
          </span>
        )}
        <button
          onClick={fetchOrders}
          className="btn btn-ghost btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> 重新整理
        </button>
      </div>

      {/* 篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'pending', label: '待處理' },
          { key: 'accepted', label: '準備中' },
          { key: 'completed', label: '已完成' },
          { key: 'rejected', label: '已拒絕' },
          { key: 'all', label: '全部' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="btn btn-sm"
            style={{
              background: filter === f.key ? 'var(--accent)' : 'var(--bg-base)',
              color: filter === f.key ? '#fff' : 'var(--text-primary)',
              border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border-dim)'}`,
            }}
          >
            {f.label}
            {f.key === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
          </button>
        ))}
      </div>

      {/* 訂單列表 */}
      {!isElectron && (
        <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
          顧客點餐功能僅在桌面版本可用
        </div>
      )}

      {isElectron && !filtered.length && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
          {filter === 'pending' ? '目前沒有待處理的訂單' : '沒有符合條件的訂單'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(order => {
          const st = STATUS_MAP[order.status] || STATUS_MAP.pending
          const StIcon = st.icon
          const time = new Date(order.time)
          const timeStr = time.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
          const dateStr = time.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })

          return (
            <div key={order.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: st.color + '18', color: st.color,
                  padding: '3px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600,
                }}>
                  <StIcon size={13} /> {st.label}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  {dateStr} {timeStr}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {order.id}
                </span>
                {order.tableNum && (
                  <span style={{
                    background: 'var(--blue)', color: '#fff',
                    padding: '2px 8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
                  }}>
                    {order.tableNum}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '1.1rem' }}>
                  ${order.total}
                </span>
              </div>

              {/* 商品列表 */}
              <div style={{
                background: 'var(--bg-base)', borderRadius: 8, padding: '8px 12px',
                fontSize: '0.85rem', marginBottom: order.note ? 8 : 10,
              }}>
                {(order.items || []).map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span>{item.name} x{item.qty}</span>
                    <span style={{ color: 'var(--text-dim)' }}>${item.price * item.qty}</span>
                  </div>
                ))}
              </div>

              {order.note && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 10 }}>
                  備註: {order.note}
                </p>
              )}

              {/* 操作按鈕 */}
              {order.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleAccept(order.id)}
                    className="btn btn-sm"
                    style={{ flex: 1, background: '#27ae60', color: '#fff', border: 'none' }}
                  >
                    <Check size={14} /> 接單
                  </button>
                  <button
                    onClick={() => handleReject(order.id)}
                    className="btn btn-sm"
                    style={{ flex: 1, background: '#e74c3c', color: '#fff', border: 'none' }}
                  >
                    <X size={14} /> 拒絕
                  </button>
                </div>
              )}
              {order.status === 'accepted' && (
                <button
                  onClick={() => handleComplete(order.id)}
                  className="btn btn-sm"
                  style={{ width: '100%', background: '#27ae60', color: '#fff', border: 'none' }}
                >
                  <Check size={14} /> 標記完成
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
