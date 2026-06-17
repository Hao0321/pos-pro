// ═══════════════════════════════════════════════════════════════════
// 資安核心模組 — POS Pro Security Layer
// ═══════════════════════════════════════════════════════════════════

import { isElectron } from './dataAccess'

// ── 1. 角色權限定義 (RBAC) ──────────────────────────────────────────
// 簡化為：老闆 (全部權限) 和 員工 (基本操作)
export const ROLES = {
  owner: {
    label: '老闆',
    color: 'var(--gold)',
    permissions: [
      'pos.use', 'pos.discount',
      'inventory.view', 'inventory.edit', 'inventory.delete',
      'members.view', 'members.edit', 'members.delete',
      'reports.view', 'reports.export',
      'accounting.view', 'accounting.edit',
      'purchase.view', 'purchase.edit', 'purchase.approve',
      'stocktake.view', 'stocktake.edit',
      'promotions.view', 'promotions.edit',
      'settings.view', 'settings.edit',
      'users.view', 'users.edit',
      'audit.view', 'backup.manage',
    ],
  },
  staff: {
    label: '員工',
    color: 'var(--blue)',
    permissions: [
      'pos.use',
      'inventory.view', 'inventory.edit',
      'members.view', 'members.edit',
      'reports.view',
      'purchase.view',
      'stocktake.view', 'stocktake.edit',
      'promotions.view',
    ],
  },
}

// ── 2. 密碼加密 (PBKDF2) ────────────────────────────────────────────
const PBKDF2_ITERATIONS = 200_000
const SALT_LEN = 32

async function getKeyMaterial(password) {
  const enc = new TextEncoder()
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
}

// 回傳 JSON 字串 { hash, salt, iter }
export async function hashPassword(password) {
  const salt    = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const keyMat  = await getKeyMaterial(password)
  const bits    = await crypto.subtle.deriveBits(
    { name:'PBKDF2', hash:'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMat, 256
  )
  const hashArr = Array.from(new Uint8Array(bits))
  const saltArr = Array.from(salt)
  return JSON.stringify({ hash: hashArr, salt: saltArr, iter: PBKDF2_ITERATIONS })
}

export async function verifyPassword(password, stored) {
  try {
    // stored 是 JSON 字串或物件
    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored
    const { hash, salt, iter } = parsed
    if (!hash || !salt) return false
    const keyMat = await getKeyMaterial(password)
    const bits   = await crypto.subtle.deriveBits(
      { name:'PBKDF2', hash:'SHA-256', salt: new Uint8Array(salt), iterations: iter || PBKDF2_ITERATIONS },
      keyMat, 256
    )
    const candidate = Array.from(new Uint8Array(bits))
    return candidate.length === hash.length && candidate.every((v,i) => v === hash[i])
  } catch { return false }
}

// ── 3. Session Token ────────────────────────────────────────────────
const SESSION_KEY  = 'pos_session'
const SESSION_TTL  = 8 * 60 * 60 * 1000

export function createSession(user) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2,'0')).join('')
  const session = {
    token,
    userId:    user.id,
    username:  user.username,
    role:      user.role,
    loginAt:   Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (Date.now() > session.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch { return null }
}

export function destroySession() {
  sessionStorage.removeItem(SESSION_KEY)
}

export function extendSession() {
  const s = getSession()
  if (!s) return
  s.expiresAt = Date.now() + SESSION_TTL
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

// ── 4. 權限檢查 ──────────────────────────────────────────────────────
export function hasPermission(session, permission) {
  if (!session) return false
  const rolePerms = ROLES[session.role]?.permissions || []
  return rolePerms.includes(permission)
}

export function requirePermission(session, permission) {
  if (!hasPermission(session, permission)) {
    throw new Error(`權限不足：需要 ${permission}`)
  }
}

// ── 5. 稽核日誌 ──────────────────────────────────────────────────────
const AUDIT_KEY     = 'pos_audit_log'
const AUDIT_MAX     = 2000

export const AUDIT_ACTIONS = {
  LOGIN:           { label: '登入',         level: 'info'    },
  LOGOUT:          { label: '登出',         level: 'info'    },
  LOGIN_FAIL:      { label: '登入失敗',     level: 'warning' },
  CHECKOUT:        { label: '結帳',         level: 'info'    },
  DISCOUNT_APPLY:  { label: '套用折扣',     level: 'warning' },
  PRODUCT_EDIT:    { label: '編輯商品',     level: 'info'    },
  PRODUCT_DELETE:  { label: '刪除商品',     level: 'warning' },
  MEMBER_EDIT:     { label: '編輯會員',     level: 'info'    },
  MEMBER_DELETE:   { label: '刪除會員',     level: 'warning' },
  ACCOUNTING_EDIT: { label: '編輯帳務',     level: 'warning' },
  ACCOUNTING_DEL:  { label: '刪除帳務',     level: 'critical' },
  PURCHASE_CREATE: { label: '建立進貨單',   level: 'info'    },
  PURCHASE_APPROVE:{ label: '核准進貨',     level: 'warning' },
  PROMO_CREATE:    { label: '建立促銷',     level: 'info'    },
  STOCKTAKE_DONE:  { label: '完成盤點',     level: 'warning' },
  DATA_EXPORT:     { label: '匯出資料',     level: 'warning' },
  BACKUP_CREATE:   { label: '建立備份',     level: 'info'    },
  BACKUP_RESTORE:  { label: '還原備份',     level: 'critical' },
  USER_CREATE:     { label: '建立帳號',     level: 'warning' },
  USER_DELETE:     { label: '刪除帳號',     level: 'critical' },
  PERMISSION_DENY: { label: '權限拒絕',     level: 'warning' },
}

export function writeAuditLog(action, session, detail = {}) {
  try {
    const entry = {
      id:        'AL' + Date.now() + Math.random().toString(36).slice(2,6),
      timestamp: new Date().toISOString(),
      action,
      level:     AUDIT_ACTIONS[action]?.level || 'info',
      label:     AUDIT_ACTIONS[action]?.label || action,
      userId:    session?.userId   || 'anonymous',
      username:  session?.username || '未知',
      role:      session?.role     || '—',
      detail:    typeof detail === 'object' ? JSON.stringify(detail) : String(detail),
    }

    if (isElectron) {
      // Electron: 寫入 SQLite
      window.electronAPI.db.writeAuditLog(entry).catch(() => {})
    } else {
      // 瀏覽器: 寫入 localStorage
      const logs = readAuditLogs()
      logs.unshift(entry)
      const trimmed = logs.slice(0, AUDIT_MAX)
      localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed))
    }
    return entry
  } catch { return null }
}

export function readAuditLogs() {
  try {
    if (isElectron) return [] // Electron 由 IPC 非同步取得
    const raw = localStorage.getItem(AUDIT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

// ── 6. 輸入清洗 ──────────────────────────────────────────────────────
const DANGEROUS = /<script|javascript:|on\w+\s*=|<iframe|<object|<embed|data:text/gi

export function sanitize(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}

export function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj
  const result = {}
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') result[key] = val.replace(DANGEROUS, '[BLOCKED]').trim()
    else if (typeof val === 'object') result[key] = sanitizeObject(val)
    else result[key] = val
  }
  return result
}

export function validatePrice(val) {
  const n = parseFloat(val)
  if (isNaN(n) || n < 0 || n > 999999) throw new Error('價格格式錯誤')
  return Math.round(n * 100) / 100
}

export function validateStock(val) {
  const n = parseInt(val)
  if (isNaN(n) || n < 0 || n > 999999) throw new Error('庫存格式錯誤')
  return n
}

export function validatePhone(val) {
  const cleaned = val.replace(/[-\s]/g, '')
  if (!/^09\d{8}$/.test(cleaned)) throw new Error('手機格式錯誤（應為 09xxxxxxxx）')
  return cleaned
}

// ── 7. 個資遮罩 ──────────────────────────────────────────────────────
export function maskPhone(phone) {
  if (!phone || phone.length < 8) return '****'
  return phone.slice(0,4) + '****' + phone.slice(-3)
}

export function maskName(name) {
  if (!name) return '**'
  if (name.length <= 2) return name[0] + '*'
  return name[0] + '*'.repeat(name.length - 2) + name.slice(-1)
}

// ── 8. 自動備份 ──────────────────────────────────────────────────────
const BACKUP_KEY     = 'pos_backups'
const BACKUP_MAX     = 10
const BACKUP_KEYS    = ['pos2_products','pos2_members','pos2_orders','pos2_manual_j']

export function createBackup(session, label = '') {
  try {
    if (isElectron) {
      // Electron: SQLite 備份
      window.electronAPI.db.createBackup(label || '自動備份', session?.username || '系統').catch(() => {})
      return { id: 'BK' + Date.now() }
    }

    const backups = getBackupList()
    const data    = {}
    BACKUP_KEYS.forEach(k => {
      try { data[k] = JSON.parse(localStorage.getItem(k) || '[]') } catch { data[k] = [] }
    })

    const backup = {
      id:        'BK' + Date.now(),
      label:     label || `備份 ${new Date().toLocaleString('zh-TW')}`,
      createdAt: new Date().toISOString(),
      createdBy: session?.username || '系統',
      size:      JSON.stringify(data).length,
      data,
    }

    backups.unshift(backup)
    const trimmed = backups.slice(0, BACKUP_MAX)
    localStorage.setItem(BACKUP_KEY, JSON.stringify(trimmed))
    writeAuditLog('BACKUP_CREATE', session, { label: backup.label })
    return backup
  } catch { return null }
}

export function getBackupList() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    return raw ? JSON.parse(raw).map(b => ({ ...b, data: undefined })) : []
  } catch { return [] }
}

export function restoreBackup(backupId, session) {
  try {
    const raw     = localStorage.getItem(BACKUP_KEY)
    const backups = raw ? JSON.parse(raw) : []
    const backup  = backups.find(b => b.id === backupId)
    if (!backup?.data) throw new Error('備份不存在')

    BACKUP_KEYS.forEach(k => {
      if (backup.data[k]) localStorage.setItem(k, JSON.stringify(backup.data[k]))
    })
    writeAuditLog('BACKUP_RESTORE', session, { backupId, label: backup.label })
    return true
  } catch { return false }
}

export function exportBackupFile(session) {
  try {
    const data = {}
    BACKUP_KEYS.forEach(k => {
      try { data[k] = JSON.parse(localStorage.getItem(k) || '[]') } catch { data[k] = [] }
    })
    const content   = JSON.stringify({ exportedAt: new Date().toISOString(), version: '3.0', data }, null, 2)
    const blob      = new Blob([content], { type: 'application/json' })
    const url       = URL.createObjectURL(blob)
    const a         = document.createElement('a')
    const filename  = `POSPro_backup_${new Date().toISOString().slice(0,10)}.json`
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
    writeAuditLog('DATA_EXPORT', session, { filename })
    return true
  } catch { return false }
}

export function importBackupFile(file, session) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const { data } = JSON.parse(e.target.result)
        if (!data) throw new Error('格式錯誤')
        BACKUP_KEYS.forEach(k => {
          if (data[k]) localStorage.setItem(k, JSON.stringify(data[k]))
        })
        writeAuditLog('BACKUP_RESTORE', session, { source: 'file' })
        resolve(true)
      } catch(err) { reject(err) }
    }
    reader.readAsText(file)
  })
}

// ── 9. 速率限制 ──────────────────────────────────────────────────────
const RATE_MAP = new Map()

export function checkRateLimit(key, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const now     = Date.now()
  const entry   = RATE_MAP.get(key) || { attempts: 0, resetAt: now + windowMs, lockedUntil: 0 }

  if (now < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 1000)
    return { allowed: false, remaining: 0, lockedFor: remaining }
  }
  if (now > entry.resetAt) {
    entry.attempts = 0; entry.resetAt = now + windowMs
  }

  entry.attempts++
  RATE_MAP.set(key, entry)

  if (entry.attempts > maxAttempts) {
    entry.lockedUntil = now + 30 * 60 * 1000
    RATE_MAP.set(key, entry)
    return { allowed: false, remaining: 0, lockedFor: 1800 }
  }

  return { allowed: true, remaining: maxAttempts - entry.attempts + 1, lockedFor: 0 }
}

export function resetRateLimit(key) {
  RATE_MAP.delete(key)
}

// ── 10. 自動鎖定計時器 ──────────────────────────────────────────────
let idleTimer = null
const IDLE_TIMEOUT = 30 * 60 * 1000

export function startIdleTimer(onLock) {
  clearIdleTimer()
  const reset = () => {
    clearIdleTimer()
    extendSession()
    idleTimer = setTimeout(onLock, IDLE_TIMEOUT)
  }
  ;['mousedown','keydown','touchstart','scroll'].forEach(e => document.addEventListener(e, reset, { passive: true }))
  idleTimer = setTimeout(onLock, IDLE_TIMEOUT)
  return () => {
    clearIdleTimer()
    ;['mousedown','keydown','touchstart','scroll'].forEach(e => document.removeEventListener(e, reset))
  }
}

export function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}
