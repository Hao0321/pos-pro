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

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if(url.origin!==location.origin)return
  // 不快取顧客點餐 / API
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/menu')) return

  // 靜態資源走 cache-first，HTML 走 network-first
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
  if (isHTML) {
    e.respondWith(
      fetch(req).then((r) => {
        if(!r.ok)throw new Error('shell unavailable')
        const copy = r.clone()
        caches.open(VERSION).then((c) => c.put(req, copy))
        return r
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
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
