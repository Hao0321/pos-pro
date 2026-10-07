window.addEventListener('error', e => {
  const root=document.getElementById('root')
  if (!root || root.querySelector('[data-react-mounted]')) return
  const panel=document.createElement('div'), title=document.createElement('h2'), detail=document.createElement('pre'), retry=document.createElement('button')
  panel.style.cssText='padding:40px;font-family:sans-serif'
  title.textContent='啟動錯誤'
  detail.textContent=String(e.message || '程式未能啟動')
  retry.textContent='重新載入';retry.addEventListener('click',()=>location.reload())
  panel.append(title,detail,retry);root.replaceChildren(panel)
})
if (import.meta.env.PROD && 'serviceWorker' in navigator && ['http:','https:'].includes(location.protocol))
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))
