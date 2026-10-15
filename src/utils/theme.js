import { browserStorage } from './browserStorage'
// 主題切換工具
const KEY = 'pos_theme'

export function getTheme() {
  try{return browserStorage.getItem(KEY)==='dark'?'dark':'light'}catch{return 'light'}
}

export function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', t)
  window.dispatchEvent(new CustomEvent('pos-theme-changed',{detail:t}))
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
  try{applyTheme(getTheme())}catch{/* Keep the current session usable if storage is blocked. */}
}
