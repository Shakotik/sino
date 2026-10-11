import express from 'express'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE = '__Host-sino_preview'
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000
const API_PATH = /^\/api\/(?:dictionary(?:\/|$)|personal(?:\/|$)|hanzi(?:\/|$)|hanzi-license$)/u
const PAGE_PATH = /^\/(?:|profile|dictionary|my-cards|difficult|texts(?:\/[a-z-]+)?|study\/hsk-[1-6](?:\/(?:cards|learning|knowledge|anki|words|writing))?)$/u
const digest = (value) => createHash('sha256').update(String(value)).digest()
export const secretMatches = (left, right) => timingSafeEqual(digest(left), digest(right))

function safeDestination(value) {
  if (typeof value !== 'string' || value.length > 2000 || !value.startsWith('/') || /[\\\r\n]/u.test(value)) return '/'
  try {
    const url = new URL(value, 'https://sino.invalid')
    return url.origin === 'https://sino.invalid' && PAGE_PATH.test(url.pathname) ? url.pathname + url.search : '/'
  } catch { return '/' }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function loginPage(destination, error = '') {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sino — временный доступ</title>
  <style>html{color-scheme:dark}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#15191b;color:#eee8e1;font:17px/1.6 system-ui,sans-serif}main{width:min(440px,calc(100% - 64px));padding:30px 24px;background:#222a2c;border:1px solid #384244;border-radius:24px}h1{margin:0;font-size:36px}p{color:#b5c0ba}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;min-height:48px;padding:12px;border:1px solid #4b6156;border-radius:12px;font:inherit}input{background:#15191b;color:inherit}button{margin-top:16px;background:#264d3b;color:#d5f3df;cursor:pointer}.error{color:#f4b499}small{display:block;margin-top:20px;color:#adb7b3}</style></head><body><main><h1>Sino</h1><p>Временная тестовая версия. Введите код, который передал владелец сайта.</p>
  <form method="post" action="/_sino/access"><input type="hidden" name="next" value="${escapeHtml(destination)}"><label for="access-code">Код доступа</label><input id="access-code" name="code" type="password" required maxlength="128" autocomplete="current-password" autofocus>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<button type="submit">Открыть сайт</button></form><small>Это защита тестовой ссылки, а не пароль личного профиля. Сайт доступен, пока компьютер владельца включён.</small></main></body></html>`
}

// Serves only dist and an explicit API allowlist. Never points at Vite, lists
// directories, or accepts an upstream URL from a visitor. The user explicitly
// approved Cloudflare as the intermediary for this temporary preview.
export function createTemporaryGateway({ distDirectory, upstream = 'http://127.0.0.1:3001', accessCode, getPublicOrigin, loginLimit = 10 }) {
  if (!accessCode || accessCode.length < 20) throw new Error('Temporary access code must have at least 20 characters')
  const apiOrigin = new URL(upstream)
  if (apiOrigin.hostname !== '127.0.0.1') throw new Error('Only the local API is allowed')
  const sessions = new Map()
  const loginAttempts = new Map()
  let totalAttempts = { count: 0, until: 0 }
  const app = express()
  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    response.set({
      'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
      // Keep same-origin form POSTs attributable for CSRF checks. no-referrer
      // can make browsers send Origin: null for navigational form submissions.
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    })
    next()
  })

  function requireSameOrigin(request, response, next) {
    const expected = getPublicOrigin()
    if (!expected || request.get('origin') !== expected || request.get('sec-fetch-site') === 'cross-site') {
      response.status(403).json({ message: 'Откройте форму на странице Sino и повторите действие.' })
      return
    }
    next()
  }
  function validSession(request) {
    const token = request.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    const now = Date.now()
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key)
    return token && sessions.has(token) ? token : null
  }
  function limitLogin(request, response, next) {
    const now = Date.now()
    for (const [key, window] of loginAttempts) if (window.until <= now) loginAttempts.delete(key)
    // Cloudflare supplies this on its tunnel. Even a fabricated header cannot
    // bypass the independent global cap; the gateway listens on loopback only.
    const identity = request.get('cf-connecting-ip') || request.socket.remoteAddress
    const window = loginAttempts.get(identity) || { count: 0, until: now + 15 * 60_000 }
    if (totalAttempts.until <= now) totalAttempts = { count: 0, until: now + 15 * 60_000 }
    if (window.count >= loginLimit || totalAttempts.count >= 100 || loginAttempts.size >= 1000) {
      response.set('Retry-After', '900').status(429).send(loginPage('/', 'Слишком много попыток. Повторите через 15 минут.'))
      return
    }
    window.count++; totalAttempts.count++
    loginAttempts.set(identity, window)
    next()
  }

  app.get('/_sino/access', (request, response) => response.type('html').send(loginPage(safeDestination(request.query.next))))
  app.post('/_sino/access', requireSameOrigin, limitLogin, express.urlencoded({ extended: false, limit: '4kb' }), (request, response) => {
    const next = safeDestination(request.body?.next)
    if (typeof request.body?.code !== 'string' || !secretMatches(request.body.code, accessCode)) {
      response.status(401).type('html').send(loginPage(next, 'Неверный код доступа.'))
      return
    }
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value)
    const token = randomBytes(32).toString('hex')
    sessions.set(token, Date.now() + SESSION_DURATION_MS)
    response.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_DURATION_MS })
    response.redirect(303, next)
  })

  app.use((request, response, next) => {
    if (validSession(request)) { next(); return }
    if (request.method === 'GET' && PAGE_PATH.test(request.path)) {
      response.redirect(303, `/_sino/access?next=${encodeURIComponent(safeDestination(request.originalUrl))}`)
    } else response.status(401).json({ message: 'Сначала введите код временного доступа на главной странице сайта.' })
  })
  app.post('/_sino/logout', requireSameOrigin, (request, response) => {
    sessions.delete(validSession(request))
    response.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    response.redirect(303, '/_sino/access')
  })
  app.use((request, response, next) => ['GET', 'HEAD'].includes(request.method) ? next() : requireSameOrigin(request, response, next))

  app.use((request, response, next) => {
    if (!API_PATH.test(request.path)) { next(); return }
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) { response.sendStatus(405); return }
    express.raw({ type: () => true, limit: '64kb' })(request, response, async (error) => {
      if (error) { next(error); return }
      try {
        const target = new URL(request.originalUrl, apiOrigin)
        if (target.origin !== apiOrigin.origin || !API_PATH.test(target.pathname)) { response.sendStatus(400); return }
        const headers = {}
        for (const name of ['content-type', 'authorization']) if (request.get(name)) headers[name] = request.get(name)
        // Lets the API rate-limit visitors separately; otherwise all of them share 127.0.0.1.
        headers['x-forwarded-for'] = request.get('cf-connecting-ip') || request.socket.remoteAddress
        const upstreamResponse = await fetch(target, {
          method: request.method, headers, redirect: 'error', signal: AbortSignal.timeout(20_000),
          ...(!['GET', 'HEAD'].includes(request.method) && Buffer.isBuffer(request.body) ? { body: request.body } : {}),
        })
        response.status(upstreamResponse.status)
        response.type(upstreamResponse.headers.get('content-type') || 'application/json')
        response.send(Buffer.from(await upstreamResponse.arrayBuffer()))
      } catch {
        response.status(503).json({ message: 'Локальный сервер временно недоступен. Попросите владельца проверить запуск Sino.' })
      }
    })
  })
  app.use((request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method) || request.path.endsWith('.map') || request.path.split('/').some((part) => part.startsWith('.'))) {
      response.sendStatus(404); return
    }
    next()
  })
  app.use(express.static(distDirectory, { index: false, dotfiles: 'deny', cacheControl: false, redirect: false }))
  app.use((request, response) => PAGE_PATH.test(request.path) ? response.sendFile('index.html', { root: distDirectory, cacheControl: false }) : response.sendStatus(404))
  app.use((error, _request, response, _next) => response.status(error.status === 413 ? 413 : 400).json({ message: 'Некорректный запрос.' }))
  return app
}
