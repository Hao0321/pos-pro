import {installStartupScreen} from './utils/startupScreen'

installStartupScreen()
if (import.meta.env.PROD && 'serviceWorker' in navigator && ['http:','https:'].includes(location.protocol))
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))
