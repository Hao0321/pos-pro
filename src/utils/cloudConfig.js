import { browserStorage } from './browserStorage'

export const CLOUD_CONFIG_KEY = 'pos_supabase_config'

export function getCloudConfig() {
  // 優先讀 localStorage（UI 設定），其次讀 vite env
  try {
    const stored = browserStorage.getItem(CLOUD_CONFIG_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.url && parsed.anonKey) {validateCloudConfig(parsed);return parsed}
    }
  } catch {}
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (url && anonKey) {try{validateCloudConfig({url,anonKey});return {url,anonKey}}catch{return null}}
  return null
}

export function isCloudEnabled() {
  return !!getCloudConfig()
}

export function validateCloudConfig({url,anonKey}) {
  const parsed=new URL(url)
  if(parsed.protocol!=='https:' || parsed.username || parsed.password)throw new Error('雲端網址必須使用 HTTPS')
  const key=anonKey.trim()
  if(key.startsWith('sb_publishable_'))return true
  try{
    const payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
    if(payload.role==='anon')return true
  }catch{}
  throw new Error('只可輸入公開 publishable／anon key，禁止 secret／service_role key')
}
