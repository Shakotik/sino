import test from 'node:test'
import assert from 'node:assert/strict'
import { isLearningReminderDue, normalizeLearningReminder } from './learningReminderSchedule.js'
import { createReviewCalendar, showLearningNotification, showDueReviewNotification } from './reminderNotifications.js'
import { demonstrateStrokeOrder } from '../writing/strokeDemonstration.js'

test('daily learning reminders wait for local time and stop when the daily goal or course is completed', () => {
  const request = { settings: { learningReminders: true, learningReminderTime: '18:30', learningDailyGoal: 5 }, learnedToday: 2, knownWords: 20, totalWords: 300 }
  assert.equal(isLearningReminderDue({ ...request, now: new Date(2026, 9, 9, 18, 29) }), false)
  assert.equal(isLearningReminderDue({ ...request, now: new Date(2026, 9, 9, 18, 30) }), true)
  assert.equal(isLearningReminderDue({ ...request, learnedToday: 5, now: new Date(2026, 9, 9, 19) }), false)
  assert.equal(isLearningReminderDue({ ...request, knownWords: 300, now: new Date(2026, 9, 9, 19) }), false)
  assert.equal(isLearningReminderDue({ ...request, snoozedUntil: new Date(2026, 9, 9, 20).getTime(), now: new Date(2026, 9, 9, 19) }), false)
  assert.equal(isLearningReminderDue({ ...request, settings: { learningReminders: false }, now: new Date(2026, 9, 9, 19) }), false)
  assert.equal(normalizeLearningReminder({ learningReminderTime: '99:59' }).learningReminderTime, '18:00')
})

test('learning calendar uses chosen time, course URL, new-word goal and a separate event identity', () => {
  const options = { levelId: 'hsk-5', levelName: 'HSK 5', hour: 20, minute: 15, now: new Date(2026, 9, 9, 11), origin: 'https://sino.example.test' }
  const learning = createReviewCalendar({ ...options, kind: 'learning', goal: 7 })
  assert.match(learning, /DTSTART:20261010T201500/)
  assert.match(learning, /RRULE:FREQ=DAILY/)
  assert.match(learning, /SUMMARY:Изучить 7 слов в Sino/)
  assert.match(learning, /URL:https:\/\/sino.example.test\/study\/hsk-5\r\n/)
  assert.match(learning, /UID:sino-learning-hsk-5/)
  assert.match(createReviewCalendar(options), /UID:sino-review-hsk-5/)
  assert.ok(learning.split('\r\n').every((line) => Buffer.byteLength(line) <= 75))
})

test('a full-stroke demonstration restarts practice but never grades the word; leaving cancels the restart', async () => {
  const calls = []
  const writer = { cancelQuiz: () => calls.push('cancel'), hideCharacter: async () => calls.push('hide'), animateCharacter: async () => calls.push('animate-all') }
  await demonstrateStrokeOrder(writer, { isActive: () => true, restartQuiz: () => calls.push('practice') })
  assert.deepEqual(calls, ['cancel', 'hide', 'animate-all', 'practice'])
  calls.length = 0
  let active = true
  writer.animateCharacter = async () => { calls.push('animate-all'); active = false }
  await demonstrateStrokeOrder(writer, { isActive: () => active, restartQuiz: () => calls.push('practice') })
  assert.deepEqual(calls, ['cancel', 'hide', 'animate-all'])
})

test('system reminders deduplicate by course, type and profile and recheck cancellation before showing', async () => {
  const values = new Map([['sino:profile', JSON.stringify({ id: 'reminder-test' })]])
  const notifications = []
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  globalThis.window = { isSecureContext: true, Notification: { permission: 'granted' } }
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    serviceWorker: { register: async () => ({ active: { state: 'activated' }, showNotification: async (title, options) => notifications.push({ title, ...options }) }) },
  } })
  try {
    const options = { levelId: 'hsk-1', levelName: 'HSK 1', remaining: 4, now: new Date(2026, 9, 9, 18) }
    assert.equal(await showLearningNotification(options), true)
    assert.equal(await showLearningNotification(options), false)
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].data.url, '/study/hsk-1')
    assert.equal(await showDueReviewNotification({ ...options, count: 3 }), true, 'ANKI is a separate reminder')
    assert.equal(await showLearningNotification({ ...options, levelId: 'hsk-2', shouldNotify: () => false }), false)
    localStorage.setItem('sino:profile', JSON.stringify({ id: 'second-test-profile' }))
    assert.equal(await showLearningNotification(options), true)
    assert.equal(notifications.length, 3)
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
    delete globalThis.window
    delete globalThis.localStorage
  }
})
