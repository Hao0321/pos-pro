import { browserStorage } from './browserStorage'
// Supabase 客戶端 — 設定存 localStorage，讓 user 在 Settings UI 輸入即可（也支援 env）
import { createClient } from '@supabase/supabase-js'

import {CLOUD_CONFIG_KEY as STORAGE_KEY,getCloudConfig,validateCloudConfig} from './cloudConfig'
export {getCloudConfig,isCloudEnabled,validateCloudConfig} from './cloudConfig'

export function saveCloudConfig({ url, anonKey }) {
  if (!url || !anonKey) {
    browserStorage.removeItem(STORAGE_KEY)
    _client = null
    return
  }
  validateCloudConfig({url,anonKey})
  browserStorage.setItem(STORAGE_KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }))
  _client = null // 強制下次重建
}

export function clearCloudConfig() {
  browserStorage.removeItem(STORAGE_KEY)
  _client = null
}

let _client = null
export function getSupabase() {
  if (_client) return _client
  const cfg = getCloudConfig()
  if (!cfg) return null
  try {
    _client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, storage: browserStorage },
    })
    return _client
  } catch (e) {
    console.error('[Supabase] init failed:', e)
    return null
  }
}

// 測試連線（呼叫一個輕量 query）
export async function testConnection() {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: '尚未設定雲端' }
  try {
    const { error } = await sb.from('products').select('id', { count: 'exact', head: true })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

export async function signInCloud(email,password) {
  const sb=getSupabase();if(!sb)throw new Error('請先保存雲端設定')
  const {data,error}=await sb.auth.signInWithPassword({email,password})
  if(error)throw new Error(error.message)
  return data.user
}
