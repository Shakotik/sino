import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { Pool } from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from './config.mjs'
import { calculatePersonalReview, createPersonalCardsRouter } from './personalCards.mjs'

test('personal repetition schedule counts attempts and resets forgotten words', () => {
  const now = new Date('2026-10-08T12:00:00.000Z')
  const initial = { repetitions: 0, interval_days: 0, attempts: 0, correct_answers: 0 }
  const learned = calculatePersonalReview(initial, 'good', now)
  assert.equal(learned.known, true)
  assert.equal(learned.intervalDays, 1)
  assert.equal(learned.attempts, 1)
  assert.equal(learned.correctAnswers, 1)
  assert.equal(learned.dueAt.toISOString(), '2026-10-09T12:00:00.000Z')
  const forgotten = calculatePersonalReview({ repetitions: 4, interval_days: 7, attempts: 6, correct_answers: 5 }, 'again', now)
  assert.equal(forgotten.known, false)
  assert.equal(forgotten.repetitions, 0)
  assert.equal(forgotten.correctAnswers, 5)
  assert.equal(forgotten.attempts, 7)
  assert.equal(forgotten.dueAt.toISOString(), '2026-10-08T12:10:00.000Z')
  assert.throws(() => calculatePersonalReview(initial, 'anything', now), /Выберите оценку/)
})

// Opt-in integration test, using disposable owners only. It never truncates a
// table or deletes existing collections. Run after the personal-cards migration.
test('PostgreSQL API persists cards and refuses every cross-owner mutation', {
  skip: process.env.PERSONAL_CARDS_DB_TESTS !== '1',
}, async () => {
  loadLocalEnvironment()
  const pool = new Pool({ connectionString: getDatabaseUrl(), max: 2 })
  const app = express()
  app.use('/api/personal', createPersonalCardsRouter(pool))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/personal`
  const temporaryOwnerIds = []

  async function request(path, { token, method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = response.status === 204 ? null : await response.json()
    return { status: response.status, payload }
  }
  try {
    const ownerA = (await request('/accounts', { method: 'POST' })).payload
    temporaryOwnerIds.push(ownerA.accountId)
    const ownerB = (await request('/accounts', { method: 'POST' })).payload
    temporaryOwnerIds.push(ownerB.accountId)
    assert.notEqual(ownerA.token, ownerB.token)
    const storedAccount = (await pool.query('SELECT capability_hash FROM personal.accounts WHERE id = $1', [ownerA.accountId])).rows[0]
    assert.notEqual(storedAccount.capability_hash, ownerA.token, 'only token hash may be stored')
    assert.equal((await request('/cards')).status, 401)
    assert.equal((await request('/cards', { token: '0'.repeat(64) })).status, 401)

    const folder = (await request('/folders', { token: ownerA.token, method: 'POST', body: { title: 'Чувства и эмоции' } })).payload.folder
    const word = { folderId: folder.id, hanzi: '爱', pinyin: 'ài', translationRu: 'любить; нравиться', notes: '我爱学习。' }
    const created = await request('/cards', { method: 'POST', token: ownerA.token, body: { ...word, ownerId: ownerB.accountId } })
    assert.equal(created.status, 201)
    assert.equal(created.payload.card.known, false)
    assert.equal(created.payload.card.translationRu, word.translationRu)
    const cardId = created.payload.card.id
    assert.equal((await request('/cards', { token: ownerA.token })).payload.cards.length, 1)
    assert.equal((await request('/cards', { token: ownerB.token })).payload.cards.length, 0)
    assert.equal((await request('/cards', { method: 'POST', token: ownerA.token, body: word })).status, 409)
    assert.equal((await request(`/cards/${cardId}`, { method: 'PATCH', token: ownerB.token, body: word })).status, 404)
    assert.equal((await request(`/cards/${cardId}/reviews`, { method: 'POST', token: ownerB.token, body: { grade: 'easy', requestId: randomUUID() } })).status, 404)
    assert.equal((await request(`/cards/${cardId}`, { method: 'DELETE', token: ownerB.token })).status, 404)
    assert.equal((await request('/cards/not-a-uuid', { method: 'DELETE', token: ownerA.token })).status, 400)

    assert.equal((await request(`/cards/${cardId}`, { method: 'PATCH', token: ownerA.token, body: { ...word, notes: 'обновлённый пример' } })).status, 200)
    const reviewRequestId = randomUUID()
    const reviewed = await request(`/cards/${cardId}/reviews`, { method: 'POST', token: ownerA.token, body: { grade: 'good', requestId: reviewRequestId } })
    assert.equal(reviewed.status, 200)
    assert.equal(reviewed.payload.review.known, true)
    const retried = await request(`/cards/${cardId}/reviews`, { method: 'POST', token: ownerA.token, body: { grade: 'good', requestId: reviewRequestId } })
    assert.deepEqual(retried.payload.review, reviewed.payload.review, 'lost-response retry returns the first receipt')
    const statistics = (await request('/statistics', { token: ownerA.token })).payload.statistics
    assert.equal(statistics.total, 1)
    assert.equal(statistics.learned, 1)
    assert.equal(statistics.attempts, 1)
    assert.equal(statistics.accuracy, 100)
    assert.equal((await request('/statistics', { token: ownerB.token })).payload.statistics.total, 0)
    assert.equal((await request('/cards', { token: ownerA.token })).payload.cards[0].notes, 'обновлённый пример')
    const forgotten = await request(`/cards/${cardId}/reviews`, { method: 'POST', token: ownerA.token, body: { grade: 'again', requestId: randomUUID() } })
    assert.equal(forgotten.payload.review.known, false)
    assert.equal(forgotten.payload.review.attempts, 2)
    assert.equal((await request(`/cards/${cardId}`, { method: 'DELETE', token: ownerA.token })).status, 204)
    assert.equal((await request('/cards', { token: ownerA.token })).payload.cards.length, 0)
  } finally {
    for (const ownerId of temporaryOwnerIds) {
      await pool.query('DELETE FROM personal.accounts WHERE id = $1', [ownerId])
    }
    await new Promise((resolve) => server.close(resolve))
    await pool.end()
  }
})
