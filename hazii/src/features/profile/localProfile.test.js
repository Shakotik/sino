import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalProfile, readLocalProfile, readLearningSummary, removeLocalProfile, resumeLocalProfile, saveLocalProfile, readCourseSummary, readDailyActivityHistory } from './localProfile.js'
import { readProfileValue, writeProfileValue } from './profileStorage.js'
import { removeCourseFromProfile, resetCourseProgress } from './courseManagement.js'

function resetStorage() {
  const values = new Map()
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }
  globalThis.window = { localStorage, dispatchEvent() {} }
}

test('logout and local resume keep identity and isolate learning between profiles', () => {
  resetStorage()
  const first = createLocalProfile({ displayName: 'Первый', email: 'first@example.test' })
  writeProfileValue('hsk-1:passed-word-ids', [1, 2])
  removeLocalProfile()
  assert.equal(readLocalProfile(), null)
  const second = createLocalProfile({ displayName: 'Второй', email: 'second@example.test' })
  assert.notEqual(second.id, first.id)
  assert.equal(readLearningSummary().knownWords, 0)
  assert.equal(resumeLocalProfile(first.id).id, first.id)
  assert.equal(readLearningSummary().knownWords, 2)
  removeLocalProfile()
  assert.equal(createLocalProfile({ displayName: 'Первый снова', email: 'FIRST@example.test' }).id, first.id)
})

test('legacy missing IDs are persisted; legacy progress can be claimed by one profile only', () => {
  resetStorage()
  localStorage.setItem('sino:profile', JSON.stringify({ displayName: 'Старый', email: 'old@example.test' }))
  const profile = readLocalProfile()
  assert.equal(readLocalProfile().id, profile.id)
  localStorage.setItem('sino:hsk-1:passed-word-ids', '[1,2,3]')
  assert.equal(readLearningSummary().knownWords, 3)
  saveLocalProfile({ ...profile, id: 'different-owner' })
  assert.equal(readLearningSummary().knownWords, 0)
  assert.equal(readProfileValue('missing', 42), 42)
})

function prepareEnrolledProfile() {
  resetStorage()
  const profile = { ...createLocalProfile({ displayName: 'Ученик', email: 'learner@example.test' }), enrolledCourseIds: ['hsk-1', 'hsk-2'] }
  saveLocalProfile(profile)
  writeProfileValue('hsk-1:passed-word-ids', [1, 2])
  writeProfileValue('hsk-2:passed-word-ids', [3])
  writeProfileValue('writing:hsk-1:completed-attempts', ['1-0', '2-0'])
  writeProfileValue('study:hsk-1:attempts', { '1:writing': { attempts: 2, correct: 1 } })
  writeProfileValue('anki:hsk-1', { 1: { interval: 4 } })
  writeProfileValue('study:hsk-1:settings', { count: 20, reminders: true, learningReminders: true })
  writeProfileValue('daily-activity', { entries: {
    '2026-10-08': { completedCards: 3, words: [
      { courseId: 'hsk-1', wordId: 1, hanzi: '爱' },
      { courseId: 'hsk-1', wordId: 2, hanzi: '八' },
      { courseId: 'hsk-2', wordId: 3, hanzi: '学习' },
    ] },
    '2026-10-07': { completedCards: 1, words: [{ courseId: 'hsk-1', wordId: 1, hanzi: '爱' }] },
    '2026-10-06': { completedCards: 5, words: [] },
  } })
  localStorage.setItem(`sino:personal-account:${profile.id}`, 'personal-collection-secret')
  return profile
}

test('logout and returning preserve course enrollment, writing, attempts, ANKI and calendar', () => {
  const profile = prepareEnrolledProfile()
  const before = readCourseSummary('hsk-1')
  const history = readDailyActivityHistory()
  removeLocalProfile()
  assert.equal(readLocalProfile(), null)
  assert.equal(readCourseSummary('hsk-1').learnedWords, 0, 'guest does not display signed-out user data')
  resumeLocalProfile(profile.id)
  assert.deepEqual(readCourseSummary('hsk-1'), before)
  assert.deepEqual(readDailyActivityHistory(), history)
  assert.deepEqual(readLocalProfile().enrolledCourseIds, ['hsk-1', 'hsk-2'])
  assert.equal(readProfileValue('study:hsk-1:attempts', {})['1:writing'].attempts, 2)
  assert.equal(readProfileValue('anki:hsk-1', {})[1].interval, 4)
})

test('reset is course-scoped, clears historical entries, and cannot resurrect legacy progress', () => {
  const profile = prepareEnrolledProfile()
  localStorage.setItem('sino:hsk-1:passed-word-ids', '[99]')
  resetCourseProgress('hsk-1', profile.id)
  assert.equal(readCourseSummary('hsk-1').learnedWords, 0)
  assert.equal(readCourseSummary('hsk-1').writtenCharacters, 0)
  assert.equal(readCourseSummary('hsk-2').learnedWords, 1)
  assert.deepEqual(readProfileValue('study:hsk-1:attempts', null), {})
  assert.deepEqual(readProfileValue('anki:hsk-1', null), {})
  assert.equal(readProfileValue('study:hsk-1:settings', {}).count, 20)
  assert.equal(readDailyActivityHistory()['2026-10-08'].completedCards, 1)
  assert.equal(readDailyActivityHistory()['2026-10-07'], undefined)
  assert.equal(readDailyActivityHistory()['2026-10-06'].completedCards, 5, 'unattributed legacy totals are preserved')
  assert.equal(localStorage.getItem(`sino:personal-account:${profile.id}`), 'personal-collection-secret')
  resetCourseProgress('hsk-1', profile.id)
  removeLocalProfile()
  resumeLocalProfile(profile.id)
  assert.equal(readCourseSummary('hsk-1').learnedWords, 0)
  assert.deepEqual(readLocalProfile().enrolledCourseIds, ['hsk-1', 'hsk-2'])
})

test('removing a course keeps statistics but disables its reminders and persists across logout', () => {
  const profile = prepareEnrolledProfile()
  const before = readDailyActivityHistory()
  const updated = removeCourseFromProfile('hsk-1', profile.id)
  assert.deepEqual(updated.enrolledCourseIds, ['hsk-2'])
  assert.equal(readCourseSummary('hsk-1').learnedWords, 2)
  assert.deepEqual(readDailyActivityHistory(), before)
  assert.equal(readProfileValue('study:hsk-1:settings', {}).reminders, false)
  assert.equal(readProfileValue('study:hsk-1:settings', {}).learningReminders, false)
  removeLocalProfile()
  resumeLocalProfile(profile.id)
  assert.deepEqual(readLocalProfile().enrolledCourseIds, ['hsk-2'])
  saveLocalProfile({ ...readLocalProfile(), enrolledCourseIds: ['hsk-1', 'hsk-2'] })
  assert.equal(readCourseSummary('hsk-1').learnedWords, 2)
})

test('stale profile confirmations and courses not enrolled cannot reset another profile', () => {
  const profile = prepareEnrolledProfile()
  assert.throws(() => resetCourseProgress('hsk-1', 'other-owner'))
  assert.throws(() => resetCourseProgress('hsk-6', profile.id))
  assert.throws(() => removeCourseFromProfile('hsk-1', 'other-owner'))
  assert.equal(readCourseSummary('hsk-1').learnedWords, 2)
})
