import { browserStorage } from './browserStorage'
// 主題切換工具
const KEY = 'pos_theme'

export function getTheme() {
  return browserStorage.getItem(KEY) || 'light'
}

export function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', t)
  browserStorage.setItem(KEY, t)
}

export function toggleTheme() {
  const cur = getTheme()
  const next = cur === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

// 在 App 啟動時呼叫
export function initTheme() {
  applyTheme(getTheme())
}
