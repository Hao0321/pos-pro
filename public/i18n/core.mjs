import messages from './messages.mjs'
import {getDisplayPreferences} from './preferences.mjs'
export const getLocale=()=>getDisplayPreferences().locale
const localeIndex={en:0,ja:1,'zh-CN':2}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
const patterns=Object.keys(messages).filter(key=>/\{\w+\}/.test(key)).map(key=>{const names=[];let cursor=0,source='';for(const match of key.matchAll(/\{(\w+)\}/g)){source+=escape(key.slice(cursor,match.index))+'([\\s\\S]*?)';names.push(match[1]);cursor=match.index+match[0].length}return {key,names,regex:new RegExp('^'+source+escape(key.slice(cursor))+'$')}})
const prefixes=Object.keys(messages).filter(key=>/[：:]\s*$/.test(key)&&key.length>=4).sort((a,b)=>b.length-a.length)
export function tr(source,values={},locale=getLocale()){
  if(typeof source!=='string')return source
  const row=Object.hasOwn(messages,source)?messages[source]:null
  const translated=locale==='zh-TW'?source:row?.[localeIndex[locale]]||source
  return translated.replace(/\{([\w]+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]):match)
}
// Only use on system messages. Merchant names and free-form notes bypass this.
export function trMessage(source,locale=getLocale()){
  if(typeof source!=='string'||locale==='zh-TW')return source
  const remote=/^Error invoking remote method '[^']+': (?:Error: )?([\s\S]*)$/.exec(source)
  if(remote)return trMessage(remote[1],locale)
  if(Object.hasOwn(messages,source))return tr(source,{},locale)
  if(source.length>1024)return source
  for(const row of patterns){const match=row.regex.exec(source);if(match)return tr(row.key,Object.fromEntries(row.names.map((name,i)=>[name,match[i+1]])),locale)}
  for(const prefix of prefixes)if(source.startsWith(prefix)&&source.length>prefix.length)return tr(prefix,{},locale)+trMessage(source.slice(prefix.length),locale)
  return source
}
