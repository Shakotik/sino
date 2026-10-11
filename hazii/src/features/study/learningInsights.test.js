import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalProfile, removeLocalProfile, resumeLocalProfile, saveLocalProfile } from '../profile/localProfile.js'
import { resetCourseProgress } from '../profile/courseManagement.js'
import { readProfileValue, writeProfileValue } from '../profile/profileStorage.js'
import { markSkillMastered, readDifficultWords, readSkillSummary, recordSkillResult } from './learningInsights.js'

function prepareProfile() {
  const values = new Map()
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }
  globalThis.window = { localStorage, dispatchEvent() {} }
  const profile = { ...createLocalProfile({ displayName: 'Тест', email: 'insights@example.test' }), enrolledCourseIds: ['hsk-1'] }
  saveLocalProfile(profile)
  return profile
}

test('skill progression does not infer writing/listening mastery from recognition or old known words', () => {
  prepareProfile()
  writeProfileValue('hsk-1:passed-word-ids', [1, 2])
  assert.ok(readSkillSummary('hsk-1').every((skill) => skill.successful === 0))
  recordSkillResult('hsk-1', { id: 1 }, { mode: 'meaning', correct: true })
  recordSkillResult('hsk-1', { id: 1 }, { mode: 'writing', correct: false })
  assert.deepEqual(readSkillSummary('hsk-1').map((skill) => skill.successful), [1, 0, 0, 0])
  assert.equal(readDifficultWords('hsk-1')[0].skill, 'writing')
})

test('retry resolves only the relevant difficulty and keeps first-attempt counts intact', () => {
  prepareProfile()
  for (const mode of ['meaning', 'typing']) recordSkillResult('hsk-1', { id: 1 }, { mode, correct: false, explanation: 'Проверьте ответ.' })
  markSkillMastered('hsk-1', 1, 'typing')
  assert.equal(readDifficultWords('hsk-1').length, 1)
  assert.equal(readDifficultWords('hsk-1')[0].skill, 'meaning')
  const saved = readProfileValue('skills:hsk-1', {})['1:typing']
  assert.equal(saved.attempts, 1)
  assert.equal(saved.correct, 0)
  assert.equal(saved.lastCorrect, true)
})

test('logout preserves skills, other profiles stay isolated, reset clears only the selected course', () => {
  const profile = prepareProfile()
  recordSkillResult('hsk-1', { id: 1 }, { mode: 'listening', correct: false })
  recordSkillResult('hsk-2', { id: 2 }, { mode: 'writing', correct: false })
  removeLocalProfile()
  assert.deepEqual(readDifficultWords('hsk-1'), [])
  createLocalProfile({ displayName: 'Другой', email: 'other-insights@example.test' })
  assert.deepEqual(readDifficultWords('hsk-1'), [])
  resumeLocalProfile(profile.id)
  assert.equal(readDifficultWords('hsk-1').length, 1)
  resetCourseProgress('hsk-1', profile.id)
  assert.deepEqual(readDifficultWords('hsk-1'), [])
  assert.equal(readDifficultWords('hsk-2').length, 1)
})
