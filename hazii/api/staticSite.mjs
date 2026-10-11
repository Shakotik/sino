import express from 'express'

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
}

// In production one Node process serves both the built app and /api, so the
// browser sees a single HTTPS origin. Hashed files under /assets never change
// and are cached for a year; everything else is revalidated so a deploy (and
// the service worker) is picked up on the next visit.
export function createStaticSite(distDirectory) {
  const router = express.Router()

  router.use((_request, response, next) => {
    response.set(SECURITY_HEADERS)
    next()
  })
  router.use(express.static(distDirectory, {
    index: false,
    dotfiles: 'deny',
    redirect: false,
    setHeaders(response, filePath) {
      const immutable = /[\\/]assets[\\/]/u.test(filePath)
      response.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  }))
  // Client-side routes (/profile, /study/hsk-1/cards, …) all load index.html.
  // Paths that look like files or API calls get a real 404 instead.
  router.get(/^\/(?!api(?:\/|$))[^.]*$/u, (_request, response) => {
    response.set('Cache-Control', 'no-cache').sendFile('index.html', { root: distDirectory })
  })

  return router
}
