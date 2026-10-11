import { loadHskCatalog } from '../../data/hskCatalogs.js'

// A course is visible to the service worker only after the final ready marker.
// An interrupted update leaves the previous complete copy intact.
const CACHE_PREFIX = 'sino-course:'
const READY_URL = '/__sino-offline__/ready'

export async function listOfflineCourses() {
  if (!('caches' in globalThis)) return []
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX))
  const records = await Promise.all(names.map(async (cacheName) => {
    const ready = await (await caches.open(cacheName)).match(READY_URL)
    return ready ? { ...await ready.json(), cacheName } : null
  }))
  return records.filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function removeOfflineCourse(levelId) {
  const names = (await caches.keys()).filter((name) => name.startsWith(`${CACHE_PREFIX}${levelId}:`))
  await Promise.all(names.map((name) => caches.delete(name)))
}

export async function downloadOfflineCourse(levelId, { signal, onProgress }) {
  if (!/^hsk-[1-6]$/u.test(levelId)) throw new Error('Неизвестный курс.')
  if (!navigator.serviceWorker?.controller) throw new Error('Офлайн-режим ещё не готов. Обновите страницу и попробуйте снова.')
  const manifestResponse = await fetch('/offline-manifest.json', { signal, cache: 'no-store' })
  if (!manifestResponse.ok || !manifestResponse.headers.get('content-type')?.includes('json')) {
    throw new Error('Загрузка без интернета доступна в собранной версии сайта, а не на сервере разработки.')
  }
  const manifest = await manifestResponse.json()
  const entryPath = document.querySelector('script[type="module"][src]')?.getAttribute('src')
  if (entryPath && !manifest.core.includes(entryPath)) {
    throw new Error('На сервере появилась новая версия. Обновите страницу перед скачиванием курса.')
  }
  const { words } = await loadHskCatalog(levelId)
  if (!manifest.courses[levelId]) throw new Error('Курс отсутствует в офлайн-манифесте.')
  const characters = [...new Set(words.flatMap((word) => [...word.hanzi].filter((character) => /\p{Script=Han}/u.test(character))))]
  const urls = [...new Set([...manifest.core, manifest.courses[levelId], ...characters.map((character) => `/api/hanzi/${encodeURIComponent(character)}`)])]
  // Reject anything outside the public inventory, even if a manifest is bad.
  if (urls.some((url) => !/^\/(?:$|assets\/[^?#]+|api\/hanzi\/[^/?#]+|index\.html|site\.webmanifest|sino-icon\.svg)$/u.test(url))) {
    throw new Error('В манифесте есть неподдерживаемый адрес.')
  }
  const cacheName = `${CACHE_PREFIX}${levelId}:${crypto.randomUUID()}`
  const cache = await caches.open(cacheName)
  let index = 0
  let completed = 0
  let bytes = 0
  let firstError = null
  try {
    // Four bounded workers avoid flooding the drawing-data endpoint.
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < urls.length && !firstError) {
        const url = urls[index++]
        try {
          signal.throwIfAborted()
          const response = await fetch(url, { signal, cache: 'reload' })
          if (!response.ok) throw new Error('Не удалось загрузить все файлы. Проверьте соединение и попробуйте снова.')
          if (url.startsWith('/api/hanzi/')) {
            const data = await response.clone().json()
            if (!Array.isArray(data.strokes) || !Array.isArray(data.medians)) throw new Error('Повреждены данные написания иероглифа.')
          }
          bytes += (await response.clone().arrayBuffer()).byteLength
          await cache.put(url, response)
          onProgress({ completed: ++completed, total: urls.length, bytes })
        } catch (error) { firstError ??= error }
      }
    }))
    if (firstError) throw firstError
    signal.throwIfAborted()
    const ready = { levelId, bytes, words: words.length, characters: characters.length, savedAt: new Date().toISOString() }
    await cache.put(READY_URL, Response.json(ready))
    // Commit succeeded. Remove only older copies of this public course.
    const older = (await caches.keys()).filter((name) => name.startsWith(`${CACHE_PREFIX}${levelId}:`) && name !== cacheName)
    await Promise.all(older.map((name) => caches.delete(name)))
    return ready
  } catch (error) {
    await caches.delete(cacheName)
    if (error.name === 'QuotaExceededError') throw new Error('На устройстве недостаточно места. Удалите сохранённую копию другого курса и повторите загрузку.')
    throw error
  }
}
