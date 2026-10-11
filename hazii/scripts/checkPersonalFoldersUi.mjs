// End-to-end QA with a disposable browser context and server account.
// The finally block removes only the account created in this test context.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from '../api/config.mjs'

const { chromium } = await import(pathToFileURL(process.env.SINO_PLAYWRIGHT_MODULE).href)
loadLocalEnvironment()
const pool = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })
const profile = { id: randomUUID(), displayName: 'Проверка интерфейса', email: 'layout@example.test', joinedAt: new Date().toISOString(), dailyGoal: 10, enrolledCourseIds: ['hsk-1'] }
await context.addInitScript((value) => {
  if (!localStorage.getItem('sino:qa-seeded')) {
    localStorage.setItem('sino:profile', JSON.stringify(value))
    localStorage.setItem('sino:qa-seeded', '1')
  }
}, profile)
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('tmp/responsive', { recursive: true })
let testAccountId

async function assertLayout(label) {
  await page.evaluate(() => document.fonts.ready)
  const result = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open], [role="dialog"]')
    const elements = [...(dialog || document.querySelector('main')).querySelectorAll('*')]
    const outside = elements.filter((element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || box.width === 0 || element.closest('[inert], [aria-hidden="true"], .vocabulary-stack')) return false
      // Text with an exceptionally long token may scroll within its own region.
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX) && parent.clientWidth < parent.scrollWidth) return false
      }
      return box.right > innerWidth + 1 || box.left < -1
    }).map((element) => `${element.tagName}.${element.className}: ${element.textContent.slice(0, 80)}`)
    return { outside, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
  })
  assert.deepEqual(result, { outside: [], pageOverflow: false }, label)
}

async function createFolder(title) {
  await page.getByRole('button', { name: '+ Создать папку', exact: true }).click()
  await page.getByLabel('Тема папки', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Сохранить тему', exact: true }).click()
  await page.locator('dialog').waitFor({ state: 'detached' })
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}

try {
  await page.goto('http://127.0.0.1:4173/my-cards')
  await page.waitForFunction((id) => localStorage.getItem(`sino:personal-account:${id}`), profile.id)
  testAccountId = await page.evaluate((id) => JSON.parse(localStorage.getItem(`sino:personal-account:${id}`)).accountId, profile.id)
  await createFolder('Путешествия')
  const travelId = new URL(page.url()).searchParams.get('folder')
  for (const [hanzi, pinyin, meaning] of [['机场', 'jīchǎng', 'аэропорт — место прибытия и отправления самолётов'], ['火车', 'huǒchē', 'поезд; железнодорожный транспорт']]) {
    await page.getByRole('button', { name: '+ Создать карточку', exact: true }).click()
    await page.getByLabel('Слово на китайском').fill(hanzi)
    await page.getByLabel('Пиньинь').fill(pinyin)
    await page.getByLabel('Значения на русском').fill(meaning)
    await page.getByLabel('Пример или заметка').fill('我喜欢学习中文。 Учение — труд. По-китайски и по русски. 10 км.')
    await assertLayout('Create card dialog, 390px')
    await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click()
    await page.locator('dialog').waitFor({ state: 'detached' })
    await page.locator('.personal-word-heading').filter({ hasText: hanzi }).waitFor()
  }
  await page.getByRole('button', { name: 'Взять как курс', exact: true }).click()
  await page.getByRole('button', { name: 'Курс в профиле', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Учить тему', exact: true }).click()
  await page.getByRole('button', { name: 'Начать повторение', exact: true }).click()
  await page.locator('dialog').waitFor({ state: 'detached' })
  for (const grade of ['Помню', 'Ещё учу']) {
    await page.getByRole('button', { name: 'Показать ответ', exact: true }).last().click()
    await assertLayout(`Practice answer, ${grade}`)
    await page.getByRole('button', { name: new RegExp(`^${grade}`) }).click()
  }
  await page.getByRole('heading', { name: 'Повторение завершено', exact: true }).waitFor()
  await page.goto('http://127.0.0.1:4173/profile')
  const course = page.locator('.personal-folder-courses article').filter({ has: page.getByRole('heading', { name: 'Путешествия', exact: true }) })
  await course.waitFor()
  assert.match(await course.locator('.personal-statistic').filter({ hasText: /^Изучено/ }).textContent(), /1 \/ 2/)
  assert.match(await course.textContent(), /Ответов: 2/)
  await course.getByText('Дневник темы', { exact: true }).click()
  assert.equal(await course.locator('.personal-folder-diary li').count(), 1)

  for (const width of [320, 360, 375, 390, 414, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/profile', `/my-cards?folder=${travelId}`]) {
      await page.goto(`http://127.0.0.1:4173${route}`)
      await page.getByRole('heading', { name: 'Путешествия', exact: true }).waitFor()
      await assertLayout(`${route}, ${width}px`)
      if (width === 390) await page.screenshot({ path: `tmp/responsive/${route.startsWith('/profile') ? 'profile' : 'folders'}-390.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: '+ Создать карточку', exact: true }).click()
  await assertLayout('Landscape create dialog')
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click()
  await page.locator('dialog').waitFor({ state: 'detached' })

  await page.setViewportSize({ width: 390, height: 844 })
  await createFolder('Транспорт')
  const transportId = new URL(page.url()).searchParams.get('folder')
  await page.getByRole('button', { name: 'Все темы', exact: true }).click()
  await page.getByLabel('Выбрать показанные слова').check()
  await page.getByLabel('Перенести 2 слов в тему').selectOption(transportId)
  await page.getByRole('button', { name: 'Переместить', exact: true }).click()
  await page.getByLabel('Перенести 2 слов в тему').waitFor({ state: 'detached' })
  await page.locator('.personal-folder').filter({ hasText: 'Транспорт' }).getByRole('button', { name: 'Взять как курс', exact: true }).click()
  await page.goto('http://127.0.0.1:4173/profile')
  const movedCourse = page.locator('.personal-folder-courses article').filter({ hasText: 'Транспорт' })
  await movedCourse.waitFor()
  assert.match(await movedCourse.locator('.personal-statistic').filter({ hasText: /^Изучено/ }).textContent(), /1 \/ 2/)
  await movedCourse.getByRole('button', { name: 'Убрать курс из профиля' }).click()
  await page.getByRole('button', { name: 'Убрать из профиля', exact: true }).click()
  await movedCourse.waitFor({ state: 'detached' })
  await page.goto(`http://127.0.0.1:4173/my-cards?folder=${transportId}`)
  await page.locator('.personal-word').first().waitFor()
  assert.equal(await page.locator('.personal-word').count(), 2)
  await page.addStyleTag({ content: 'html { font-size: 150%; }' })
  await assertLayout('390px, enlarged text')
  assert.deepEqual(errors, [], 'No browser exceptions')
  console.log('PASS: create folders/cards, study, enroll, diary, move with progress, remove course; 18 populated responsive screens, landscape dialog, enlarged text.')
} finally {
  await page.screenshot({ path: 'tmp/responsive/personal-last-state.png', fullPage: true }).catch(() => {})
  if (testAccountId) await pool.query('DELETE FROM personal.accounts WHERE id = $1', [testAccountId])
  await pool.end()
  await context.close()
  await browser.close()
}
