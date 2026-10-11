import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createServer } from 'vite'
import { createWritingPlan } from '../writing/writingPractice.js'

// This verifies real JSX and catalogue wiring without pretending to be a
// browser drawing test. Vite's SSR loader transforms the same source as the app.
test('writing UI, all HSK catalogues and hidden-target prompts are wired together', async () => {
  const storage = new Map()
  globalThis.window = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  }
  globalThis.localStorage = window.localStorage
  const server = await createServer({ cacheDir: 'node_modules/.vite-writing-tests', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  try {
    const { HskCourseHub } = await server.ssrLoadModule('/src/features/study/HskCourseHub.jsx')
    const { CourseSettingsForm } = await server.ssrLoadModule('/src/features/study/CourseSettingsForm.jsx')
    const { WritingCharacterStep } = await server.ssrLoadModule('/src/features/writing/WritingCharacterStep.jsx')
    const { DEFAULT_COURSE_SETTINGS } = await server.ssrLoadModule('/src/features/study/studyStorage.js')
    const { loadHskCatalog, hskLevelIds } = await server.ssrLoadModule('/src/data/hskCatalogs.js')
    const { StudyHome } = await server.ssrLoadModule('/src/features/study/StudyHome.jsx')
    const { ProfilePage } = await server.ssrLoadModule('/src/features/profile/ProfilePage.jsx')
    const { DictionaryPage, DictionaryArticleDialog } = await server.ssrLoadModule('/src/features/dictionary/DictionaryPage.jsx')
    const { DictionarySentenceReader, SentenceTokens } = await server.ssrLoadModule('/src/features/dictionary/DictionarySentenceReader.jsx')

    const home = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StudyHome)))
    assert.doesNotMatch(home, /<span>Прописи<\/span>/)
    for (const levelId of hskLevelIds) assert.ok(home.includes(`href="/study/${levelId}"`))
    assert.doesNotMatch(home, /Все шесть каталогов доступны для тестирования/)
    assert.match(home, /panda-companion-layout/)
    assert.match(home, /Конфуцианство/)
    assert.match(home.replaceAll('\u00a0', ' '), /Возвращайся к изученному и применяй его/)
    assert.doesNotMatch(home, /panda-tip-source|Луньюй 1\.1\.1 · пересказ/)
    assert.doesNotMatch(home, /Учебный проект|topbar-note/)
    assert.match(home, /class="brand"><span>Sino<\/span>/)

    const dictionary = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DictionaryPage)))
    assert.match(dictionary, /<h1>БОЛЬШОЙ СЛОВАРЬ<\/h1>/)
    assert.doesNotMatch(dictionary, /отдельно от курсов|Словарь Sino|самостоятельной базе/)
    assert.match(dictionary, />Предложение<\/button>/)
    const reader = renderToStaticMarkup(createElement(DictionarySentenceReader))
    assert.match(reader, /<textarea/)
    assert.match(reader, /Разобрать предложение/)
    const sentence = renderToStaticMarkup(createElement(SentenceTokens, {
      selectedStart: 0,
      tokens: [
        { text: '学习', start: 0, end: 2, kind: 'word', entryId: '1' },
        { text: '。', start: 2, end: 3, kind: 'text', entryId: null },
        { text: '𠀀', start: 3, end: 5, kind: 'word', entryId: null },
      ],
    }))
    assert.equal((sentence.match(/<button/g) ?? []).length, 2)
    assert.match(sentence, /aria-pressed="true"/)
    assert.match(sentence, /нет точной статьи в БКРС/)
    assert.match(sentence, /class="sentence-punctuation">。<\/span>/)
    const sentenceWords = [
      { text: '学习', start: 0, kind: 'word', entryId: '1' },
      { text: '𠀀', start: 2, kind: 'word', entryId: null },
    ]
    const article = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DictionaryArticleDialog, {
      sentenceSelection: { words: sentenceWords, index: 0 },
      dialog: { lifecycle: 'open', requestState: 'ready', entry: {
        id: '1', direction: 'zh-ru', headword: '学习', pinyin: 'xuéxí', article: 'учиться; изучать', source: { title: 'БКРС', version: 'test' },
      } },
    })))
    assert.match(article, /Полная статья/)
    assert.match(article, /xuéxí/)
    assert.match(article, /<button type="button" disabled="">← Предыдущее/)
    assert.match(article, /<button type="button">Следующее →/)
    const missingArticle = renderToStaticMarkup(createElement(DictionaryArticleDialog, {
      sentenceSelection: { words: sentenceWords, index: 1 },
      dialog: { lifecycle: 'open', requestState: 'missing', entry: null },
    }))
    assert.match(missingArticle, /Точной статьи в загруженной базе БКРС нет/)
    assert.match(missingArticle, /<button type="button" disabled="">Следующее →/)
    const tokenElement = SentenceTokens({ tokens: sentenceWords, onSelect: (words, index) => {
      assert.equal(index, 1)
      assert.equal(words[index].text, '𠀀')
    } })
    tokenElement.props.children[1].props.onClick()

    for (const levelId of hskLevelIds) {
      const hub = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/study/${levelId}`] },
        createElement(Routes, null, createElement(Route, { path: '/study/:levelId', element: createElement(HskCourseHub) }))))
      assert.match(hub, /<h2>Прописи<\/h2>/)
      assert.doesNotMatch(hub, /Китайский язык ·/)
      const { words } = await loadHskCatalog(levelId)
      const plan = createWritingPlan(words, { batchSize: 3 })
      assert.ok(plan.characters.length >= words.length)
      assert.equal(plan.steps.length, plan.characters.length * 2)
      for (const character of new Set(plan.characters.map((item) => item.character))) {
        assert.ok(existsSync(resolve('node_modules/hanzi-writer-data', `${character}.json`)), `${levelId}: missing data for ${character}`)
      }
    }

    const settings = renderToStaticMarkup(createElement(CourseSettingsForm, { section: 'writing', initialSettings: DEFAULT_COURSE_SETTINGS }))
    assert.match(settings, />Изучение<\/option>/)
    assert.match(settings, />Проверка знаний<\/option>/)
    assert.match(settings, /Иероглифов в серии/)
    assert.match(settings, /Слов за занятие/)
    const memorySettings = renderToStaticMarkup(createElement(CourseSettingsForm, {
      section: 'writing', initialSettings: { ...DEFAULT_COURSE_SETTINGS, writingPractice: 'memory' },
    }))
    assert.doesNotMatch(memorySettings, /Иероглифов в серии/)

    const word = { id: 'qa', hanzi: '爸爸', pinyin: 'bàba', translationRu: 'папа; пример: 爸爸' }
    const { steps } = createWritingPlan([word])
    const guided = renderToStaticMarkup(createElement(WritingCharacterStep, { step: steps[0] }))
    const recall = renderToStaticMarkup(createElement(WritingCharacterStep, { step: steps[1] }))
    assert.match(guided, /Поле с образцом/)
    assert.match(guided, /Показать порядок черт/)
    assert.doesNotMatch(guided, /Продолжить без обводки|writing-phase-steps|Ведите по контуру/)
    assert.match(recall, /Поле для написания иероглифа по памяти/)
    assert.doesNotMatch(recall, /Показать порядок черт/)
    assert.doesNotMatch(recall, /爸爸/)
    assert.match(recall, /иероглиф 1 из 2/)
    const learningSettings = renderToStaticMarkup(createElement(CourseSettingsForm, {
      section: 'learning', levelId: 'hsk-1', initialSettings: { ...DEFAULT_COURSE_SETTINGS, learningReminders: true },
    }))
    assert.match(learningSettings, /Напоминать выучить слова/)
    assert.match(learningSettings, /type="time"/)
    assert.match(learningSettings, /Сохранить напоминания/)
    const profile = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProfilePage, {
      user: { id: 'ui-test', displayName: 'Ученик', email: 'ui@example.test', joinedAt: '2026-10-09T00:00:00Z', enrolledCourseIds: ['hsk-1'] },
    })))
    assert.match(profile, /Сбросить прогресс/)
    assert.match(profile, /Удалить курс из профиля/)
    assert.match(profile, /Выход не удаляет ваш прогресс/)
  } finally {
    await server.close()
    delete globalThis.window
    delete globalThis.localStorage
  }
})
