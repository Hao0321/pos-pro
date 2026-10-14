// POS Pro Service Worker — offline-first cache
const VERSION = '__BUILD_VERSION__'
const CORE = ['./', './index.html', './manifest.webmanifest', './apple-touch-icon.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('pos-pro-') && k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('message',e=>{
  if(e.data?.type!=='POS_OFFLINE_STATUS'||!e.ports?.[0])return
  e.waitUntil((async()=>{
    const exists=await caches.has(VERSION)
    const cache=exists?await caches.open(VERSION):null
    const present=cache?await Promise.all(CORE.map(url=>cache.match(new URL(url,self.registration.scope).href).then(r=>!!r?.ok))):[]
    e.ports[0].postMessage({type:'POS_OFFLINE_STATUS',version:VERSION,total:CORE.length,complete:present.length===CORE.length&&present.every(Boolean)})
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if(url.origin!==location.origin)return
  // 不快取顧客點餐 / API
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/menu')) return

  // Keep HTML and its hashed modules from the same installed build. A newer
  // worker waits until existing tabs close; never replace a live sale's shell.
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
  if (isHTML) {
    e.respondWith(
      caches.open(VERSION).then(async c=>{
        const cached=await c.match(req)
        if(cached)return cached
        if(url.pathname.endsWith('/')||url.pathname.endsWith('/index.html'))return (await c.match(new URL('./index.html',self.registration.scope).href))||fetch(req)
        return fetch(req)
      })
    )
  } else {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((r) => {
          if (r.ok && (url.origin === location.origin)) {
            const copy = r.clone()
            caches.open(VERSION).then((c) => c.put(req, copy))
          }
          return r
        }).catch(() => cached)
      )
    )
  }
})
