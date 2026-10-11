// Private API responses never enter these shared caches. Only public assets
// and explicitly downloaded stroke data can be reused without a connection.
const SHELL_CACHE = 'sino-shell-v3'
const COURSE_PREFIX = 'sino-course:'
const READY_URL = '/__sino-offline__/ready'
const APP_SHELL = ['/', '/index.html', '/site.webmanifest', '/sino-icon.svg']

async function matchDownloaded(request) {
  const names = (await caches.keys()).filter((name) => name.startsWith(COURSE_PREFIX)).reverse()
  for (const name of names) {
    const cache = await caches.open(name)
    if (!await cache.match(READY_URL)) continue
    // Public build assets are invariant. Preview/CDN may emit Vary: Origin;
    // module-script requests send Origin differently from explicit downloads.
    const response = await cache.match(request, { ignoreVary: true })
    if (response) return response
  }
  return undefined
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Do not remove courses, other apps' caches, or browser profile data.
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('sino-shell-') && name !== SHELL_CACHE).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/')) {
    // Sole API exception: public HanziWriter strokes downloaded by the user.
    if (/^\/api\/hanzi\/[^/]+$/u.test(url.pathname)) {
      event.respondWith(fetch(request).then(async (response) => response.ok ? response : (await matchDownloaded(request)) || response)
        .catch(async () => (await matchDownloaded(request)) || Response.error()))
    }
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await matchDownloaded('/')) || (await caches.open(SHELL_CACHE)).match('/')))
    return
  }
  // A manifest must describe the currently deployed build, not a cached one.
  if (url.pathname === '/offline-manifest.json' || url.pathname.endsWith('/sw.js')) return
  if (!url.pathname.startsWith('/assets/') && !APP_SHELL.includes(url.pathname)) return

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const saved = (await cache.match(request)) || (await matchDownloaded(request))
    if (saved) return saved
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  })())
})
