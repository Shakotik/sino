// Production-only service-worker QA. Uses its own loopback preview and clean
// browser context; closing the context removes its downloaded test course.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const { chromium } = await import(pathToFileURL(process.env.SINO_PLAYWRIGHT_MODULE).href)
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { windowsHide: true, stdio: 'pipe' })
let ready = false
let output = ''
preview.stdout.on('data', (data) => { output += String(data); if (output.includes('4174')) ready = true })
preview.stderr.on('data', (data) => { output += String(data) })
let browser
let page
const browserErrors = []
try {
  for (let attempt = 0; !ready && attempt < 50; attempt++) await delay(100)
  assert.equal(ready, true, `Preview not ready: ${output}`)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  page = await context.newPage()
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('requestfailed', (request) => console.error('Failed:', new URL(request.url()).pathname, request.failure()?.errorText))
  await page.goto('http://127.0.0.1:4174/study/hsk-1')
  await page.waitForFunction(() => navigator.serviceWorker.controller)
  await page.getByRole('button', { name: 'Скачать для занятий без интернета', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить загрузку', exact: true }).waitFor({ timeout: 120000 })
  const pack = await page.evaluate(async () => {
    const name = (await caches.keys()).find((key) => key.startsWith('sino-course:'))
    const cache = await caches.open(name)
    return { metadata: await (await cache.match('/__sino-offline__/ready')).json(), urls: (await cache.keys()).map((request) => new URL(request.url).pathname) }
  })
  assert.equal(pack.metadata.words, 300)
  assert.ok(pack.metadata.characters > 100)
  assert.equal(pack.urls.some((url) => url.startsWith('/api/personal') || url.startsWith('/api/dictionary')), false)

  await context.setOffline(true)
  // Clear incidental shell cache: downloaded course alone must suffice.
  await page.evaluate(async () => { for (const key of await caches.keys()) if (key.startsWith('sino-shell-')) await caches.delete(key) })
  await page.goto('http://127.0.0.1:4174/study/hsk-1/knowledge?mode=meaning&word=1&count=1')
  await page.getByLabel('Ваш перевод', { exact: true }).fill('любить')
  await page.getByRole('button', { name: 'Проверить', exact: true }).click()
  await page.getByText('Верно!', { exact: true }).waitFor()
  await page.goto('http://127.0.0.1:4174/study/hsk-1/writing?practice=learn&count=1&start=1')
  await page.locator('.hanzi-quiz-canvas svg path').first().waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Показать порядок черт', exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: 'Показать порядок черт', exact: true }).isEnabled(), true)
  await page.goto('http://127.0.0.1:4174/study/hsk-1/cards?filter=all')
  await page.locator('.vocabulary-card').waitFor()
  await page.goto('http://127.0.0.1:4174/study/hsk-1')
  await page.getByText(/Вы без интернета/).waitFor()
  const progress = await page.evaluate(() => localStorage.getItem('sino:user:guest:skills:hsk-1'))
  await page.getByRole('button', { name: 'Удалить загрузку', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить загрузку', exact: true }).waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => localStorage.getItem('sino:user:guest:skills:hsk-1')), progress)
  assert.equal(await page.evaluate(async () => (await caches.keys()).some((key) => key.startsWith('sino-course:'))), false)
  assert.deepEqual(browserErrors, [])
  console.log(`PASS offline cold navigation, meaning check, stroke data, cards, local progress; removing download preserves progress. HSK1: ${(pack.metadata.bytes / 1024 / 1024).toFixed(1)} MiB.`)
} catch (error) {
  console.error((await page?.locator('body').innerText())?.slice(0, 1500))
  throw error
} finally {
  await browser?.close()
  preview.kill()
}
