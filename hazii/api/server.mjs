import express from 'express'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { createClient } from 'redis'
import { getDatabaseUrl, getRedisUrl, loadLocalEnvironment } from './config.mjs'
import { createPersonalCardsRouter } from './personalCards.mjs'
import { createDictionarySegmentationRouter } from './dictionarySegmentation.mjs'
import { createStaticSite } from './staticSite.mjs'

loadLocalEnvironment()

// Hosting platforms (Render) assign PORT and require listening on all
// interfaces; locally the API stays on loopback behind Vite's proxy.
const port = Number(process.env.PORT ?? process.env.DICTIONARY_API_PORT ?? 3001)
const host = process.env.HOST ?? '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
// Production may run without Redis: the cache is optional, PostgreSQL answers.
const redisUrl = process.env.REDIS_URL || (isProduction ? null : getRedisUrl())
const pool = new Pool({
  connectionString: getDatabaseUrl(),
  // Each application instance uses a deliberately modest pool. PgBouncer
  // multiplexes connections when multiple replicas are deployed in production.
  max: Number(process.env.DICTIONARY_DB_POOL_SIZE ?? 15),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
})
const cache = createClient({ url: redisUrl ?? undefined })

// Redis is a performance layer, not a dependency that can make the dictionary
// unavailable. If it is restarting, the request simply falls back to PostgreSQL.
cache.on('error', (error) => {
  console.warn('Dictionary cache is unavailable:', error.message)
})

const app = express()
app.disable('x-powered-by')
// Only a local gateway or reverse proxy may supply the visitor address. It is
// needed for per-visitor limits such as anonymous collection creation.
// On Render exactly one load balancer sits in front, so TRUST_PROXY=1 there.
const trustProxy = process.env.TRUST_PROXY
app.set('trust proxy', trustProxy ? (/^\d+$/u.test(trustProxy) ? Number(trustProxy) : trustProxy) : 'loopback')

// Character strokes are served by Sino itself, without a third-party CDN.
// A single validated Han character can never escape this package directory.
const strokeDataDirectory = fileURLToPath(new URL('../node_modules/hanzi-writer-data/', import.meta.url))
app.get('/api/hanzi/:character', (request, response, next) => {
  const character = request.params.character
  if (!/^\p{Script=Han}$/u.test(character)) {
    response.status(400).json({ message: 'Нужен один китайский иероглиф.' })
    return
  }
  response.sendFile(`${character}.json`, { root: strokeDataDirectory, maxAge: '1d' }, (error) => {
    if (!error) return
    if (error.status === 404) response.status(404).json({ message: 'Порядок черт этого знака пока не добавлен.' })
    else next(error)
  })
})
app.get('/api/hanzi-license', (_request, response) => {
  response.type('text/plain').sendFile('ARPHICPL.TXT', { root: strokeDataDirectory })
})

// During local development the browser app and API run on different ports.
// Only a local browser is allowed to call the API this way. In production the
// reverse proxy serves both parts from one domain, so no cross-origin access is needed.
app.use((request, response, next) => {
  const origin = request.get('origin')

  if (origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    response.set('Access-Control-Allow-Origin', origin)
    response.set('Vary', 'Origin')
  }

  next()
})

function normalizeForSearch(value) {
  return value
    .toLocaleLowerCase('ru-RU')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replaceAll('ü', 'u')
    .trim()
}

function detectDirection(query, requestedDirection) {
  if (requestedDirection === 'zh-ru' || requestedDirection === 'ru-zh') return requestedDirection
  if (/\p{Script=Han}/u.test(query)) return 'zh-ru'
  if (/[а-яё]/iu.test(query)) return 'ru-zh'
  return 'zh-ru'
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return 20
  return Math.min(Math.max(parsed, 1), 50)
}

function searchCacheKey({ direction, normalizedQuery, limit }) {
  return `sino:dictionary:search:v2:${direction}:${normalizedQuery}:${limit}`
}

function entryCacheKey(entryId) {
  return `sino:dictionary:entry:v1:${entryId}`
}

function addCacheHeaders(response) {
  response.set('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600')
}

function toSearchSuggestion(entry) {
  return {
    id: String(entry.id),
    direction: entry.direction,
    headword: entry.headword,
    pinyin: entry.pinyin,
    preview: entry.preview,
  }
}

function toDictionaryEntry(entry) {
  return {
    id: String(entry.id),
    direction: entry.direction,
    headword: entry.headword,
    pinyin: entry.pinyin,
    article: entry.article,
    source: {
      title: entry.source_title,
      version: entry.source_version,
    },
  }
}

async function readCachedPayload(key) {
  if (!cache.isReady) return null

  try {
    const cached = await cache.get(key)
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

async function cachePayload(key, payload) {
  if (!cache.isReady) return

  try {
    // Popular entries are shared by all API copies for five minutes.
    await cache.set(key, JSON.stringify(payload), { EX: 300 })
  } catch {
    // PostgreSQL has already answered the request, therefore no retry is needed here.
  }
}

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ ok: true })
  } catch {
    response.status(503).json({ ok: false })
  }
})

app.use('/api/personal', createPersonalCardsRouter(pool))
app.use('/api/dictionary/segment', createDictionarySegmentationRouter(pool))

app.get('/api/dictionary/search', async (request, response, next) => {
  const query = String(request.query.q ?? '').trim()
  const normalizedQuery = normalizeForSearch(query)
  const limit = clampLimit(request.query.limit)
  const direction = detectDirection(query, request.query.direction)

  if (normalizedQuery.length < 1) {
    response.json({ query, direction, entries: [] })
    return
  }

  // A dictionary search is a short phrase, never a full text document. The
  // limit protects the cache key and PostgreSQL from accidentally huge URLs.
  if (query.length > 120) {
    response.status(400).json({ message: 'Введите не более 120 символов.' })
    return
  }

  try {
    const key = searchCacheKey({ direction, normalizedQuery, limit })
    const cachedPayload = await readCachedPayload(key)

    if (cachedPayload) {
      addCacheHeaders(response)
      response.set('X-Cache', 'HIT')
      response.json(cachedPayload)
      return
    }

    const result = await pool.query(
      `
        SELECT
          id,
          direction,
          headword,
          pinyin,
          left(regexp_replace(article, '\\s+', ' ', 'g'), 180) AS preview
        FROM dictionary.entries
        WHERE direction = $1
          AND (
            headword_normalized LIKE $5 || '%'
            OR pinyin_normalized LIKE $5 || '%'
            OR (
              char_length($2) >= 3
              AND article_search @@ websearch_to_tsquery('russian', $3)
            )
          )
        ORDER BY
          CASE WHEN headword_normalized = $2 THEN 0 ELSE 1 END,
          CASE WHEN pinyin_normalized = $2 THEN 0 ELSE 1 END,
          length(headword),
          headword
        LIMIT $4
      `,
      // % and _ typed by a visitor are literal characters, not LIKE wildcards.
      [direction, normalizedQuery, query, limit, normalizedQuery.replace(/[\\%_]/gu, '\\$&')],
    )

    const payload = {
      query,
      direction,
      entries: result.rows.map(toSearchSuggestion),
    }

    addCacheHeaders(response)
    response.set('X-Cache', 'MISS')
    response.json(payload)
    void cachePayload(key, payload)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dictionary/entries/:entryId', async (request, response, next) => {
  const entryId = Number.parseInt(request.params.entryId, 10)

  if (!Number.isSafeInteger(entryId) || entryId < 1 || String(entryId) !== request.params.entryId) {
    response.status(400).json({ message: 'Некорректный идентификатор статьи.' })
    return
  }

  try {
    const key = entryCacheKey(entryId)
    const cachedPayload = await readCachedPayload(key)

    if (cachedPayload) {
      addCacheHeaders(response)
      response.set('X-Cache', 'HIT')
      response.json(cachedPayload)
      return
    }

    const result = await pool.query(
      `
        SELECT
          entries.id,
          entries.direction,
          entries.headword,
          entries.pinyin,
          entries.article,
          sources.title AS source_title,
          sources.version AS source_version
        FROM dictionary.entries AS entries
        INNER JOIN dictionary.sources AS sources ON sources.id = entries.source_id
        WHERE entries.id = $1
        LIMIT 1
      `,
      [entryId],
    )

    if (!result.rows[0]) {
      response.status(404).json({ message: 'Статья не найдена.' })
      return
    }

    const payload = { entry: toDictionaryEntry(result.rows[0]) }
    addCacheHeaders(response)
    response.set('X-Cache', 'MISS')
    response.json(payload)
    void cachePayload(key, payload)
  } catch (error) {
    next(error)
  }
})

// SERVE_STATIC=1 makes this process also serve the built app from dist/.
if (process.env.SERVE_STATIC === '1') {
  app.use(createStaticSite(fileURLToPath(new URL('../dist/', import.meta.url))))
}

app.use((error, _request, response, _next) => {
  console.error('Dictionary API request failed', error)
  response.status(503).json({ message: 'Словарь временно недоступен. Повторите попытку чуть позже.' })
})

const server = app.listen(port, host, () => {
  console.log(`Dictionary API is listening on http://${host}:${port}`)
})

if (redisUrl) {
  cache.connect().then(
    () => console.log('Dictionary cache is connected'),
    () => console.warn('Dictionary cache was not connected; PostgreSQL fallback remains available'),
  )
} else {
  console.log('Dictionary cache is disabled (no REDIS_URL); PostgreSQL answers every request')
}

function closeGracefully() {
  server.close(() => {
    const closers = [pool.end()]
    if (cache.isOpen) closers.push(cache.quit())
    Promise.allSettled(closers).finally(() => process.exit(0))
  })
}

process.on('SIGINT', closeGracefully)
process.on('SIGTERM', closeGracefully)
