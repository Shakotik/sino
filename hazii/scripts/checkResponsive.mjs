// Headless QA for our own local app. Uses a clean browser profile and no user data.
// SINO_PLAYWRIGHT_MODULE points to the bundled Playwright index.mjs, no download.
import { pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { chromium } = await import(pathToFileURL(process.env.SINO_PLAYWRIGHT_MODULE).href)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('tmp/responsive', { recursive: true })
async function checkLayout(label) {
  await page.evaluate(() => document.fonts.ready)
  const overflow = await page.evaluate(() => {
    const scope = document.querySelector('dialog[open], [role="dialog"]') || document.querySelector('main')
    return [...scope.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      if (style.display === 'none' || style.visibility === 'hidden' || !bounds.width || element.closest('[inert], [aria-hidden="true"], .sidebar, .vocabulary-stack')) return false
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX) && parent.clientWidth < parent.scrollWidth) return false
      }
      return bounds.right > innerWidth + 1 || bounds.left < -1
    }).slice(0, 10).map((element) => `${element.tagName}.${element.className}: ${element.textContent.slice(0, 60)}`)
  })
  assert.deepEqual(overflow, [], label)
}
try {
  for (const theme of ['dark', 'light']) {
  await page.goto('http://127.0.0.1:4173/')
  await page.evaluate((value) => localStorage.setItem('sino:theme', value), theme)
  for (const width of [320, 360, 375, 390, 414, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/dictionary', '/my-cards', '/profile', '/study/hsk-1', '/study/hsk-1/words', '/study/hsk-1/cards?filter=all', '/study/hsk-1/learning?count=5', '/study/hsk-1/anki', '/study/hsk-1/writing?practice=learn&start=1&count=5']) {
      await page.goto(`http://127.0.0.1:4173${route}`)
      if (route.includes('/words')) await page.locator('.course-word-row').first().waitFor()
      if (route.includes('/cards?')) await page.locator('.vocabulary-card').waitFor()
      if (route.includes('/learning')) await page.locator('.study-exercise-panel').waitFor()
      if (route.includes('/writing?')) await page.locator('.hanzi-quiz-canvas svg').waitFor()
      await checkLayout(`${theme} ${width}px ${route}`)
      if (width === 390 && ['/', '/dictionary'].includes(route)) await page.screenshot({ path: `tmp/responsive/${route === '/' ? 'home' : 'dictionary'}-${theme}-390.png`, fullPage: true })
    }
    console.log(`PASS ${theme} ${width}px: 10 routes`)
  }
  }
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.goto('http://127.0.0.1:4173/study/hsk-1')
    await page.getByRole('button', { name: /^Обучение/ }).click()
    await page.getByRole('dialog').waitFor()
    await checkLayout(`Learning dialog ${viewport.width}x${viewport.height}`)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://127.0.0.1:4173/dictionary')
  await page.getByRole('button', { name: 'Предложение', exact: true }).click()
  await page.getByRole('button', { name: 'Попробовать пример' }).click()
  await page.getByRole('button', { name: '学习: открыть значение' }).click()
  await page.getByRole('heading', { name: 'Полная статья', exact: true }).waitFor()
  await checkLayout('Dictionary article 390px')
  assert.equal(await page.evaluate(() => {
    const bounds = document.querySelector('.theme-toggle').getBoundingClientRect()
    return Boolean(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.dictionary-dialog-backdrop'))
  }), true, 'Modal backdrop covers global controls')
  await page.screenshot({ path: 'tmp/responsive/article-390.png', fullPage: true })
  await page.goto('http://127.0.0.1:4173/')
  await page.getByRole('button', { name: /^Показать мудрость/ }).click()
  await checkLayout('Home with open panda advice')
  assert.equal(await page.evaluate(() => {
    const bubble = document.querySelector('.panda-tip').getBoundingClientRect()
    const hero = document.querySelector('.study-hero h1').getBoundingClientRect()
    const levels = document.querySelector('.levels').getBoundingClientRect()
    return bubble.top >= hero.bottom && bubble.bottom <= levels.top
  }), true, 'Panda advice never covers the heading or course tiles')
  await page.screenshot({ path: 'tmp/responsive/home-advice-390.png', fullPage: true })

  const typographyFailures = await page.evaluate(async () => {
    const { splitReadableText } = await import('/src/components/typography.js')
    const fixture = document.createElement('article')
    fixture.className = 'personal-word'
    document.querySelector('main').append(fixture)
    const paragraph = document.createElement('p')
    for (const part of splitReadableText('Учение — труд. Железнодорожный вокзал — место встречи. По-китайски и по русски. 10 км, 5 кг. 我喜欢学习中文。')) {
      if (part.chinese) {
        const span = document.createElement('span')
        span.className = 'text-word'
        span.lang = 'zh'
        span.textContent = part.text
        paragraph.append(span)
      } else paragraph.append(document.createTextNode(part.text))
    }
    fixture.append(paragraph)
    const failures = []
    const range = document.createRange()
    for (const width of [180, 230, 310]) {
      fixture.style.width = `${width}px`
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        for (const match of node.textContent.matchAll(/[\p{L}\p{M}]+(?:\u2011[\p{L}\p{M}]+)*/gu)) {
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          const lines = new Set([...range.getClientRects()].filter((rect) => rect.width).map((rect) => Math.round(rect.y)))
          if (lines.size > 1) failures.push({ width, word: match[0] })
        }
        for (const match of node.textContent.matchAll(/[^\s\u2060][\s\u2060]*[—–][\s\u2060]*[^\s\u2060]/gu)) {
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          const lines = new Set([...range.getClientRects()].filter((rect) => rect.width).map((rect) => Math.round(rect.y)))
          if (lines.size > 1) failures.push({ width, dash: match[0] })
        }
      }
    }
    fixture.remove()
    return failures
  })
  assert.deepEqual(typographyFailures, [], 'Rendered words stay whole; dashes stay with both neighbours')
  assert.deepEqual(errors, [], 'No browser exceptions')
  console.log('PASS: 180 page/viewport/theme combinations, course settings in portrait/landscape, full dictionary article')
} finally {
  await context.close()
  await browser.close()
}
