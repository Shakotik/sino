import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTemporaryGateway } from './temporaryGateway.mjs'

const publicOrigin = 'https://sino-preview.example.test'
const accessCode = 'test-only-strong-access-code-123456'
// Tests should also work in a fresh checkout before a Vite build exists.
async function createSiteFixture(cleanup) {
  const directory = await mkdtemp(join(tmpdir(), 'sino-gateway-test-'))
  const index = join(directory, 'index.html')
  await writeFile(index, '<!doctype html><html lang="ru"><title>Sino test</title></html>')
  cleanup.after(async () => { await unlink(index); await rmdir(directory) })
  return directory
}
async function listen(server, cleanup) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }))
  return `http://127.0.0.1:${server.address().port}`
}

test('temporary gateway protects pages, assets and API; preserves Bearer auth without exposing files', async (t) => {
  const distDirectory = await createSiteFixture(t)
  const requests = []
  const upstream = createServer(async (request, response) => {
    const body = []
    for await (const chunk of request) body.push(chunk)
    requests.push({ url: request.url, auth: request.headers.authorization, cookie: request.headers.cookie, forwardedFor: request.headers['x-forwarded-for'], body: Buffer.concat(body).toString() })
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
  })
  const upstreamUrl = await listen(upstream, t)
  const app = createTemporaryGateway({ distDirectory, upstream: upstreamUrl, accessCode, getPublicOrigin: () => publicOrigin })
  const base = await listen(createServer(app), t)
  const get = (path, headers) => fetch(base + path, { headers, redirect: 'manual' })
  const login = (code, next = '/', origin = publicOrigin) => fetch(base + '/_sino/access', {
    method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, next }), redirect: 'manual',
  })
  const page = await get('/profile')
  assert.equal(page.status, 303)
  assert.match(page.headers.get('location'), /^\/_sino\/access\?next=/)
  assert.equal(page.headers.get('referrer-policy'), 'same-origin', 'Browser POST forms must not receive an opaque Origin')
  for (const path of ['/api/personal/cards', '/api/dictionary/search?q=学习', '/assets/private.js', '/sw.js', '/.env']) assert.equal((await get(path)).status, 401)
  assert.equal(requests.length, 0)
  assert.equal((await login(accessCode, '/', 'https://attacker.example')).status, 403)
  assert.equal((await login('incorrect')).status, 401)
  const signedIn = await login(accessCode, '//attacker.example')
  assert.equal(signedIn.status, 303)
  assert.equal(signedIn.headers.get('location'), '/')
  const setCookie = signedIn.headers.get('set-cookie')
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=28800']) assert.ok(setCookie.includes(attribute))
  const cookie = setCookie.split(';')[0]
  assert.equal((await get('/profile', { cookie })).status, 200)
  for (const path of ['/package.json', '/api/server.mjs', '/.env', '/tmp/temporary-access/state.json', '/health', '/assets/test.js.map']) assert.equal((await get(path, { cookie })).status, 404)
  const api = await get('/api/personal/cards', { cookie, authorization: 'Bearer original-personal-token' })
  assert.equal(api.status, 200)
  assert.equal(api.headers.get('cache-control'), 'no-store')
  assert.equal(requests.at(-1).auth, 'Bearer original-personal-token')
  assert.equal(requests.at(-1).cookie, undefined, 'preview cookie is never passed to the upstream')
  assert.ok(requests.at(-1).forwardedFor, 'the API can rate-limit each visitor separately')
  const update = (origin) => fetch(base + '/api/personal/cards', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: '{"hanzi":"爱"}' })
  assert.equal((await update('https://attacker.example')).status, 403)
  assert.equal((await update(publicOrigin)).status, 200)
  assert.deepEqual(JSON.parse(requests.at(-1).body), { hanzi: '爱' })
  assert.match(api.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  const logout = await fetch(base + '/_sino/logout', { method: 'POST', headers: { cookie, origin: publicOrigin }, redirect: 'manual' })
  assert.equal(logout.status, 303)
  assert.equal((await get('/api/personal/cards', { cookie })).status, 401)
})

test('temporary login has a bounded attempt limit', async (t) => {
  const distDirectory = await createSiteFixture(t)
  const app = createTemporaryGateway({ distDirectory, accessCode, getPublicOrigin: () => publicOrigin, loginLimit: 2 })
  const base = await listen(createServer(app), t)
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(base + '/_sino/access', { method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=wrong' })
    assert.equal(response.status, attempt < 2 ? 401 : 429)
    if (attempt === 2) assert.equal(response.headers.get('retry-after'), '900')
  }
})
