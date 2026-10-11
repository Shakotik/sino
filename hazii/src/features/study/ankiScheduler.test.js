import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewQueue, scheduleReview } from './ankiScheduler.js'

const now = new Date(2026, 9, 8, 12).getTime()
test('failed recall returns after one minute; successful recall grows interval', () => {
  const again = scheduleReview(null, 'again', now)
  assert.equal(Date.parse(again.dueAt) - now, 60_000)
  const good = scheduleReview(null, 'good', now)
  assert.equal(good.intervalDays, 1)
  assert.ok(scheduleReview(good, 'good', now + 86_400_000).intervalDays > good.intervalDays)
  assert.equal(scheduleReview(good, 'again', now).lapses, 1)
})
test('due cards take priority and future reviews are never included', () => {
  const schedules = { 1: { dueAt: new Date(now - 1000).toISOString() }, 2: { dueAt: new Date(now + 1000).toISOString() } }
  assert.deepEqual(buildReviewQueue([{ id: 3 }, { id: 2 }, { id: 1 }], schedules, { limit: 10, newPerDay: 1, now }).map((word) => word.id), [1, 3])
})
test('new daily quota counts words introduced today, not every repetition', () => {
  const schedules = { 1: scheduleReview(null, 'good', now) }
  assert.deepEqual(buildReviewQueue([{ id: 1 }, { id: 2 }], schedules, { newPerDay: 1, now }), [])
})
test('unknown grades cannot mutate the schedule', () => {
  assert.throws(() => scheduleReview(null, 'incorrect-value', now))
})
