// End-to-end check through the actual HTTPS tunnel. A clean browser keeps the
// owner's existing local profile and private collection keys out of this test.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from '../api/config.mjs'
import { createTemporaryGateway } from '../api/temporaryGateway.mjs'

// --local exercises the identical gateway/browser workflow without claiming
// that the public tunnel works. It never bypasses the access-code check.
const localCheck = process.argv.includes('--local')
const state = localCheck ? { accessCode: randomBytes(18).toString('base64url') } : JSON.parse(await readFile('tmp/temporary-access/state.json', 'utf8'))
let localGateway
if (localCheck) {
  localGateway = createServer(createTemporaryGateway({ distDirectory: resolve('dist'), accessCode: state.accessCode, getPublicOrigin: () => state.url }))
  await new Promise((resolve) => localGateway.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${localGateway.address().port}`
} else assert.match(state.url, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/u)
const { chromium } = await import(pathToFileURL(process.env.SINO_PLAYWRIGHT_MODULE).href)
loadLocalEnvironment()
const pool = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let testAccountId
await mkdir('tmp/temporary-access/qa', { recursive: true })
try {
  const privateResponse = await context.request.get(`${state.url}/api/personal/cards`)
  assert.equal(privateResponse.status(), 401)
  assert.equal((await context.request.get(`${state.url}/api/dictionary/search?q=学习`)).status(), 401)
  await page.goto(`${state.url}/dictionary`)
  await page.getByLabel('Код доступа', { exact: true }).fill(state.accessCode)
  const [loginResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/_sino/access' && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Открыть сайт', exact: true }).click(),
  ])
  assert.equal(loginResponse.status(), 303, 'A real browser form must pass the same-origin check')
  await page.getByRole('heading', { name: 'БОЛЬШОЙ СЛОВАРЬ', exact: true }).waitFor({ timeout: 60000 })
  assert.equal(new URL(page.url()).pathname, '/dictionary')
  const cookies = await context.cookies()
  const gateCookie = cookies.find((cookie) => cookie.name === '__Host-sino_preview')
  assert.ok(gateCookie?.httpOnly && gateCookie.secure)
  for (const path of ['/.env', '/package.json', '/tmp/temporary-access/state.json', '/api/server.mjs']) {
    // Exercise the browser's real cookie policy (loopback is a trustworthy
    // context in Chromium, unlike Playwright's separate HTTP client).
    assert.equal(await page.evaluate(async (path) => (await fetch(path)).status, path), 404)
  }
  await page.getByRole('button', { name: 'Предложение', exact: true }).click()
  await page.getByRole('button', { name: 'Попробовать пример', exact: true }).click()
  await page.getByRole('button', { name: '学习: открыть значение' }).click()
  await page.getByRole('heading', { name: 'Полная статья', exact: true }).waitFor()
  assert.ok((await page.locator('.dictionary-dialog-article').textContent()).length > 100)
  console.log(`PASS ${localCheck ? 'LOCAL gateway' : 'PUBLIC HTTPS'} access gate, secure cookie, dictionary segmentation and full article; source files blocked`)

  await page.goto(`${state.url}/profile`)
  await page.getByLabel('Как вас зовут', { exact: true }).fill('Проверка туннеля')
  await page.getByLabel('Электронная почта', { exact: true }).fill(`tunnel-${Date.now()}@example.test`)
  await page.getByRole('button', { name: 'Создать профиль', exact: true }).click()
  await page.getByRole('heading', { name: 'Личный кабинет', exact: true }).waitFor()
  const profileId = await page.evaluate(() => JSON.parse(localStorage.getItem('sino:profile')).id)
  await page.waitForFunction((id) => localStorage.getItem(`sino:personal-account:${id}`), profileId)
  testAccountId = await page.evaluate((id) => JSON.parse(localStorage.getItem(`sino:personal-account:${id}`)).accountId, profileId)
  await page.goto(`${state.url}/my-cards`)
  await page.getByRole('button', { name: '+ Создать папку', exact: true }).click()
  await page.getByLabel('Тема папки', { exact: true }).fill('Проверка связи')
  await page.getByRole('button', { name: 'Сохранить тему', exact: true }).click()
  await page.getByRole('heading', { name: 'Проверка связи', exact: true }).waitFor()
  await page.getByRole('button', { name: '+ Создать карточку', exact: true }).click()
  await page.getByLabel('Слово на китайском', { exact: true }).fill('学习')
  await page.getByLabel('Пиньинь', { exact: true }).fill('xuéxí')
  await page.getByLabel('Значения на русском', { exact: true }).fill('учиться; изучать')
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click()
  await page.locator('.personal-word-heading').filter({ hasText: '学习' }).waitFor()
  await page.reload()
  await page.locator('.personal-word-heading').filter({ hasText: '学习' }).waitFor()
  console.log('PASS profile, own folder/card and reload persistence through protected API')

  await page.goto(`${state.url}/study/hsk-1/writing?practice=learn&start=1&count=1`)
  await page.locator('.hanzi-quiz-canvas svg path').first().waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('button', { name: 'Показать порядок черт', exact: true }).isEnabled(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await page.screenshot({ path: 'tmp/temporary-access/qa/writing-mobile.png', fullPage: true })
  await page.goto(state.url)
  await page.getByRole('heading', { name: 'Сегодня, Проверка туннеля' }).waitFor()
  await page.screenshot({ path: 'tmp/temporary-access/qa/home-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS production writing, mobile layout and no browser exceptions')
} finally {
  await page.screenshot({ path: 'tmp/temporary-access/qa/last-state.png', fullPage: true }).catch(() => {})
  if (testAccountId) await pool.query('DELETE FROM personal.accounts WHERE id = $1', [testAccountId])
  await pool.end()
  await browser.close()
  if (localGateway) await new Promise((resolve) => { localGateway.closeAllConnections(); localGateway.close(resolve) })
}
