import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { Pool } from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from './config.mjs'
import { createPersonalCardsRouter } from './personalCards.mjs'
import { summarizeFolderCards, validateFolderTitle } from './personalFolders.mjs'

test('folder names require a real topic and are normalised consistently', () => {
  for (const title of ['', ' ', 'Папка 1', 'Новая папка', 'Курс', 'Тема 2', 'Без темы', '123', '🙂', 'x', '字'.repeat(81), null]) assert.throws(() => validateFolderTitle(title))
  assert.equal(validateFolderTitle('  Китайская   кухня  '), 'Китайская кухня')
  assert.equal(validateFolderTitle('南京'), '南京')
})

test('folder statistics count unique characters and keep word and answer counts separate', () => {
  const stats = summarizeFolderCards([
    { hanzi: '爸爸', known: true, attempts: 2, correct_answers: 1, due_at: '2020-01-01', last_reviewed_at: '2026-10-09' },
    { hanzi: '爸妈', known: false, attempts: 0 },
  ])
  assert.deepEqual([stats.total, stats.learned, stats.learning, stats.characters, stats.learnedCharacters, stats.accuracy, stats.due, stats.new], [2, 1, 1, 2, 1, 50, 1, 1])
  assert.equal(summarizeFolderCards([]).accuracy, 0)
})

test('folders persist enrollment, isolate owners and move words without losing progress', { skip: process.env.PERSONAL_CARDS_DB_TESTS !== '1' }, async () => {
  loadLocalEnvironment()
  const pool = new Pool({ connectionString: getDatabaseUrl(), max: 2 })
  const app = express()
  app.use('/personal', createPersonalCardsRouter(pool))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const owners = []
  async function request(path, token, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/personal${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, payload: response.status === 204 ? null : await response.json() }
  }
  try {
    const ownerA = (await request('/accounts', null, 'POST')).payload
    owners.push(ownerA.accountId)
    const ownerB = (await request('/accounts', null, 'POST')).payload
    owners.push(ownerB.accountId)
    const token = ownerA.token
    assert.equal((await request('/folders')).status, 401)
    assert.equal((await request('/folders', token, 'POST', { title: 'Папка 1' })).status, 400)
    const folderA = (await request('/folders', token, 'POST', { title: 'Путешествия' })).payload.folder
    const folderA2 = (await request('/folders', token, 'POST', { title: 'Китайская кухня' })).payload.folder
    const folderB = (await request('/folders', ownerB.token, 'POST', { title: 'Работа' })).payload.folder
    assert.equal((await request('/folders', token, 'POST', { title: 'путешествия' })).status, 409)
    assert.equal((await request(`/folders/${folderA.id}/enrollment`, token, 'PUT', { enrolled: true })).status, 409)
    assert.equal((await request(`/folders/${folderA.id}`, ownerB.token, 'PATCH', { title: 'Чужая тема' })).status, 404)
    assert.equal((await request(`/folders/${folderA.id}/enrollment`, ownerB.token, 'PUT', { enrolled: true })).status, 404)
    const word = { hanzi: '机场', pinyin: 'jīchǎng', translationRu: 'аэропорт', folderId: folderA.id }
    assert.equal((await request('/cards', ownerB.token, 'POST', word)).status, 404)
    assert.equal((await request('/cards', token, 'POST', { ...word, folderId: null })).status, 400)
    const card = (await request('/cards', token, 'POST', word)).payload.card
    const foreignCard = (await request('/cards', ownerB.token, 'POST', { ...word, folderId: folderB.id })).payload.card
    assert.equal((await request(`/cards/${card.id}`, token, 'PATCH', { ...word, folderId: folderB.id })).status, 404)
    const reviewId = randomUUID()
    const review = { grade: 'good', requestId: reviewId }
    assert.equal((await request(`/cards/${card.id}/reviews`, token, 'POST', review)).status, 200)
    await request(`/cards/${card.id}/reviews`, token, 'POST', review)
    assert.equal((await request(`/folders/${folderA.id}/enrollment`, token, 'PUT', { enrolled: true })).status, 200)
    let courses = (await request('/folders', token)).payload.folders
    let course = courses.find((folder) => folder.id === folderA.id)
    assert.ok(course.enrolledAt)
    assert.equal(course.statistics.attempts, 1)
    assert.equal(course.statistics.learned, 1)
    assert.equal(course.learnedWords.length, 1)
    const firstLearnedAt = course.learnedWords[0].learnedAt
    assert.equal((await request(`/folders/${folderA2.id}/move-cards`, token, 'POST', { cardIds: [card.id, foreignCard.id] })).status, 404)
    assert.equal((await request('/cards', token)).payload.cards[0].folderId, folderA.id, 'mixed-owner move rolls back entirely')
    assert.equal((await request(`/folders/${folderB.id}/move-cards`, token, 'POST', { cardIds: [card.id] })).status, 404)
    assert.equal((await request(`/folders/${folderA2.id}/move-cards`, token, 'POST', { cardIds: [card.id] })).status, 200)
    courses = (await request('/folders', token)).payload.folders
    assert.equal(courses.find((folder) => folder.id === folderA.id).statistics.total, 0)
    course = courses.find((folder) => folder.id === folderA2.id)
    assert.equal(course.statistics.learned, 1)
    assert.equal(course.learnedWords[0].learnedAt, firstLearnedAt)
    await request(`/folders/${folderA2.id}/enrollment`, token, 'PUT', { enrolled: true })
    await request(`/folders/${folderA2.id}/enrollment`, token, 'PUT', { enrolled: false })
    await request(`/folders/${folderA2.id}/enrollment`, token, 'PUT', { enrolled: true })
    course = (await request('/folders', token)).payload.folders.find((folder) => folder.id === folderA2.id)
    assert.equal(course.statistics.attempts, 1)
    assert.ok(course.enrolledAt)
    assert.equal((await request('/folders', ownerB.token)).payload.folders.length, 1)
    assert.equal((await request('/folders', ownerB.token)).payload.folders[0].statistics.learned, 0)
    // Legacy cards remain valid and can be assigned a topic without recreation.
    const legacyId = randomUUID()
    await pool.query('INSERT INTO personal.cards (id,owner_id,hanzi,translation_ru) VALUES ($1,$2,$3,$4)', [legacyId, ownerA.accountId, '菜', 'блюдо'])
    assert.equal((await request(`/folders/${folderA2.id}/move-cards`, token, 'POST', { cardIds: [legacyId] })).status, 200)
  } finally {
    for (const owner of owners) await pool.query('DELETE FROM personal.accounts WHERE id = $1', [owner])
    await new Promise((resolve) => server.close(resolve))
    await pool.end()
  }
})
