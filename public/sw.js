// POS Pro Service Worker — offline-first cache
const VERSION = 'pos-pro-v2.3.0'
const CORE = ['./', './index.html', './manifest.webmanifest', './apple-touch-icon.png']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE).catch(() => {})))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // 不快取顧客點餐 / API
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/menu')) return

  // 靜態資源走 cache-first，HTML 走 network-first
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
  if (isHTML) {
    e.respondWith(
      fetch(req).then((r) => {
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
