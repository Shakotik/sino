// This narrow-scope worker only owns notifications. The main /sw.js continues
// to own offline navigation and caching; there is no background timer here.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin)
    // Notification metadata may only open Sino routes on this same origin.
    if (target.origin !== self.location.origin) return
    if (target.pathname !== '/' && !/^\/study\/hsk-[1-6](?:\/anki)?$/u.test(target.pathname)) return
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existingWindow = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existingWindow) {
      try {
        const navigatedWindow = await existingWindow.navigate(target.href)
        await (navigatedWindow || existingWindow).focus()
        return
      } catch { /* A closing tab should not prevent opening the review queue. */ }
    }
    await self.clients.openWindow(target.href)
  })())
})
