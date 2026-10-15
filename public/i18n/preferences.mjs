// Display preferences belong to this device, never to the shared store ledger.
export const DISPLAY_KEY='pos_display_preferences_v1'
export const LOCALES=Object.freeze([{id:'zh-TW',name:'繁體中文'},{id:'en',name:'English'},{id:'ja',name:'日本語'},{id:'zh-CN',name:'简体中文'}])
const validLocale=value=>LOCALES.some(row=>row.id===value)
// Use the first supported device language. Script takes precedence over region.
export function resolveDeviceLocale(languages=[]){
  for(const value of Array.isArray(languages)?languages:[]){
    if(typeof value!=='string')continue
    let tag
    try{tag=new Intl.Locale(value.trim().replaceAll('_','-'))}catch{continue}
    if(tag.language==='en'||tag.language==='ja')return tag.language
    if(tag.language!=='zh')continue
    if(tag.script==='Hant')return 'zh-TW'
    if(tag.script==='Hans')return 'zh-CN'
    return ['CN','SG','MY'].includes(tag.region)?'zh-CN':'zh-TW'
  }
  return 'zh-TW'
}
function deviceLocale(){try{return resolveDeviceLocale([...(globalThis.navigator?.languages||[]),globalThis.navigator?.language])}catch{return 'zh-TW'}}
function read(){
  let value
  try{value=JSON.parse(globalThis.localStorage?.getItem(DISPLAY_KEY)||'null')}catch{/* A blocked or damaged preference must not block sign-in. */}
  return Object.freeze({locale:validLocale(value?.locale)?value.locale:deviceLocale(),style:value?.style==='simple'?'simple':'poster'})
}
let current=read()
let sessionLocaleChosen=false
const listeners=new Set()
export const getDisplayPreferences=()=>current
export function subscribeDisplayPreferences(listener){listeners.add(listener);return()=>listeners.delete(listener)}
function apply(){if(!globalThis.document)return;document.documentElement.lang=current.locale;document.documentElement.dir='ltr';document.documentElement.dataset.uiStyle=current.style}
export function setDisplayPreferences(update){
  if(!update||typeof update!=='object'||Array.isArray(update)||update.locale!==undefined&&!validLocale(update.locale)||update.style!==undefined&&!['poster','simple'].includes(update.style))throw new Error('Unsupported display preference')
  const next=Object.freeze({locale:update.locale??current.locale,style:update.style??current.style});let persisted=true
  try{if(!globalThis.localStorage)throw Error('Storage unavailable');localStorage.setItem(DISPLAY_KEY,JSON.stringify(next))}catch{persisted=false}
  current=next;if(update.locale!==undefined)sessionLocaleChosen=true;apply();for(const listener of listeners)listener();return {persisted,...next}
}
export function initDisplayPreferences(){apply()}
if(globalThis.addEventListener)globalThis.addEventListener('storage',event=>{if(event.key!==DISPLAY_KEY&&event.key!==null)return;sessionLocaleChosen=false;current=read();apply();for(const listener of listeners)listener()})
if(globalThis.addEventListener)globalThis.addEventListener('languagechange',()=>{if(sessionLocaleChosen)return;current=read();apply();for(const listener of listeners)listener()})
