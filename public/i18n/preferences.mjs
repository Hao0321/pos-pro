// Display preferences belong to this device, never to the shared store ledger.
export const DISPLAY_KEY='pos_display_preferences_v1'
export const LOCALES=Object.freeze([{id:'zh-TW',name:'繁體中文'},{id:'en',name:'English'},{id:'ja',name:'日本語'},{id:'zh-CN',name:'简体中文'}])
const validLocale=value=>LOCALES.some(row=>row.id===value)
function read(){try{const value=JSON.parse(globalThis.localStorage?.getItem(DISPLAY_KEY)||'null');return Object.freeze({locale:validLocale(value?.locale)?value.locale:'zh-TW',style:value?.style==='simple'?'simple':'poster'})}catch{return Object.freeze({locale:'zh-TW',style:'poster'})}}
let current=read()
const listeners=new Set()
export const getDisplayPreferences=()=>current
export function subscribeDisplayPreferences(listener){listeners.add(listener);return()=>listeners.delete(listener)}
function apply(){if(!globalThis.document)return;document.documentElement.lang=current.locale;document.documentElement.dir='ltr';document.documentElement.dataset.uiStyle=current.style}
export function setDisplayPreferences(update){
  if(update.locale!==undefined&&!validLocale(update.locale)||update.style!==undefined&&!['poster','simple'].includes(update.style))throw new Error('Unsupported display preference')
  const next=Object.freeze({...current,...update});let persisted=true
  try{if(!globalThis.localStorage)throw Error('Storage unavailable');localStorage.setItem(DISPLAY_KEY,JSON.stringify(next))}catch{persisted=false}
  current=next;apply();for(const listener of listeners)listener();return {persisted,...next}
}
export function initDisplayPreferences(){apply()}
if(globalThis.addEventListener)globalThis.addEventListener('storage',event=>{if(event.key!==DISPLAY_KEY&&event.key!==null)return;current=read();apply();for(const listener of listeners)listener()})
