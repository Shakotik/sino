// Disposable profile and account only; never drives the user's browser.
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
const profile = { id: randomUUID(), displayName: 'Анна', email: 'journey@example.test', joinedAt: new Date().toISOString(), dailyGoal: 10, enrolledCourseIds: ['hsk-1'] }
await context.addInitScript((value) => {
  if (!localStorage.getItem('sino:qa-seeded')) {
    localStorage.setItem('sino:profile', JSON.stringify(value))
    localStorage.setItem('sino:qa-seeded', '1')
  }
}, profile)
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let accountId
await mkdir('tmp/journey', { recursive: true })
const visit = (route) => page.goto(`http://127.0.0.1:4173${route}`)

async function checkLayout(label) {
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label)
}

try {
  await visit('/')
  await page.getByRole('heading', { name: 'Сегодня, Анна' }).waitFor()
  await page.waitForFunction((id) => localStorage.getItem(`sino:personal-account:${id}`), profile.id)
  accountId = await page.evaluate((id) => JSON.parse(localStorage.getItem(`sino:personal-account:${id}`)).accountId, profile.id)
  assert.match(await page.getByRole('link', { name: 'Начать занятие', exact: true }).getAttribute('href'), /count=5/)
  await page.screenshot({ path: 'tmp/journey/today-mobile.png', fullPage: true })

  await visit('/texts/meeting')
  await page.getByRole('button', { name: 'Разобрать предложение' }).click()
  await page.getByRole('button', { name: '学习: открыть значение' }).first().click()
  await page.getByRole('heading', { name: 'Полная статья', exact: true }).waitFor()
  await page.locator('.dictionary-save-word summary').click()
  assert.match(await page.getByLabel('Пример из текста', { exact: true }).inputValue(), /我学习中文/)
  await page.getByLabel('Значение для карточки', { exact: true }).fill('учиться; изучать')
  await page.getByLabel('Тематическая папка', { exact: true }).selectOption('new')
  await page.getByLabel('Тема новой папки', { exact: true }).fill('Учёба')
  await page.getByRole('button', { name: 'Сохранить в папку', exact: true }).click()
  await page.getByRole('link', { name: 'Открыть папку →', exact: true }).click()
  await page.locator('.personal-word-heading').filter({ hasText: '学习' }).waitFor()
  await page.getByRole('button', { name: 'Взять как курс', exact: true }).click()
  await page.getByRole('button', { name: 'Курс в профиле', exact: true }).waitFor()
  console.log('PASS reading → BKRS → concise meaning and context → thematic course')

  await visit('/study/hsk-1/knowledge?mode=meaning&word=1&count=1')
  assert.equal(await page.getByRole('navigation', { name: 'Основные разделы' }).count(), 0)
  await page.getByLabel('Ваш перевод', { exact: true }).fill('самолёт')
  await page.getByRole('button', { name: 'Проверить', exact: true }).click()
  await page.getByText('Попробуем ещё раз', { exact: true }).waitFor()
  await visit('/difficult')
  await page.locator('.personal-word').filter({ hasText: '爱' }).waitFor()
  await page.getByRole('link', { name: 'Повторить слово', exact: true }).click()
  await page.getByLabel('Ваш перевод', { exact: true }).fill('нравиться')
  await page.getByRole('button', { name: 'Проверить', exact: true }).click()
  await page.getByText('Верно!', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Следующее слово', exact: true }).click()
  await page.getByLabel('Результаты тренировки').waitFor()
  await visit('/difficult')
  await page.getByText(/Пока здесь пусто/).waitFor()
  console.log('PASS incorrect answer → difficulty → synonym accepted → difficulty resolved')

  // Deterministically test the unsupported-audio branch; no fake successful play.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {} } })
  })
  await visit('/study/hsk-1/knowledge?mode=listening&word=1&count=1')
  await page.getByText(/Китайский голос пока недоступен/).waitFor()
  await page.getByLabel('Ваш перевод', { exact: true }).fill('любить')
  assert.equal(await page.getByRole('button', { name: 'Проверить', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('.study-large-hanzi').count(), 0)
  console.log('PASS unavailable voice cannot be graded or reveal the target')

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/texts', '/texts/meeting', '/difficult', '/profile']) {
      await visit(route)
      await checkLayout(`${width}px ${route}`)
    }
  }
  await visit('/')
  await page.screenshot({ path: 'tmp/journey/today-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await visit('/profile')
  await page.getByRole('button', { name: 'Выйти из профиля', exact: true }).click()
  await page.getByRole('heading', { name: 'Создайте личный кабинет', exact: true }).waitFor()
  await page.getByRole('button', { name: /Анна.*Продолжить/ }).click()
  await page.getByRole('heading', { name: 'Личный кабинет', exact: true }).waitFor()
  const skills = await page.evaluate((id) => JSON.parse(localStorage.getItem(`sino:user:${id}:skills:hsk-1`)), profile.id)
  assert.equal(skills['1:meaning'].lastCorrect, true)
  assert.equal(skills['1:listening'], undefined)
  assert.deepEqual(errors, [])
  console.log('PASS 25 populated responsive screens; mobile logout/resume preserves skill progress; no browser exceptions')
} finally {
  await page.screenshot({ path: 'tmp/journey/last-state.png', fullPage: true }).catch(() => {})
  if (accountId) await pool.query('DELETE FROM personal.accounts WHERE id = $1', [accountId])
  await pool.end()
  await browser.close()
}
