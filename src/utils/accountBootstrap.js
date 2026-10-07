import { browserStorage } from './browserStorage'
import { hashPassword } from './security'
export async function initAccounts(api) {
  // The account version marker is advisory, never permission to delete users.
  if (api) { const existing=await api.auth.list(); if (existing.length) return existing }
  const raw=browserStorage.getItem('pos_users')
  const legacy=raw ? JSON.parse(raw) : []
  if (!Array.isArray(legacy)) throw new Error('帳號資料損壞，請保留備份')
  if (api) return api.auth.list(legacy)
  return legacy
}
export async function setupAccount(username,password,api) {
  if (!username.trim() || password.length<8 || password.length>512) throw new Error('名稱必填，密碼至少 8 字元')
  if (api) return api.auth.setup({username,password})
  if ((await initAccounts()).length) throw new Error('管理帳號已存在')
  const user={id:'u'+crypto.randomUUID(),username:username.trim(),password:await hashPassword(password),role:'owner'}
  browserStorage.setItem('pos_users',JSON.stringify([user]))
  return user
}
