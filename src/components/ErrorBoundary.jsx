import { browserStorage } from '../utils/browserStorage'
import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    console.error('[POS] React error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          fontFamily: 'sans-serif',
          color: 'var(--text-primary)',
          background: 'var(--bg-base)',
          minHeight: '100vh',
          overflow: 'auto',
        }}>
          <h2 style={{ color: 'var(--red)', marginBottom: 16 }}>應用程式發生錯誤</h2>
          <pre style={{
            background: 'var(--bg-raised)',
            padding: 16,
            borderRadius: 8,
            fontSize: 12,
            overflow: 'auto',
            maxWidth: 800,
            border: '1px solid var(--border-subtle)',
          }}>
            {this.state.error?.message || String(this.state.error)}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <details style={{ marginTop: 16, color: 'var(--text-secondary)' }}>
            <summary style={{ cursor: 'pointer' }}>元件堆疊</summary>
            <pre style={{ fontSize: 11, marginTop: 8 }}>
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button onClick={() => location.reload()} style={{
              padding: '10px 24px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
            }}>重新載入</button>
            <button onClick={() => {
              if (confirm('清除所有本地資料？只清 localStorage，SQLite 資料保留')) {
                browserStorage.clear()
                location.reload()
              }
            }} style={{
              padding: '10px 24px',
              background: 'transparent',
              color: 'var(--red)',
              border: '1px solid var(--red)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
            }}>清除快取重啟</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
