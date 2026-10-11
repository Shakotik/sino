import { recordCompletedCard, readDailyActivityHistory } from '../profile/localProfile.js'
import { readProfileArray, readProfileValue, writeProfileValue } from '../profile/profileStorage.js'
import { normalizeLearningReminder } from './learningReminderSchedule.js'
import { recordSkillResult } from './learningInsights.js'

export const DEFAULT_COURSE_SETTINGS = {
  mode: 'meaning', filter: 'all', count: 10, order: 'sequential', hints: true,
  newPerDay: 10, reminders: false, writingPractice: 'learn', writingBatchSize: 1,
  learningReminders: false, learningReminderTime: '18:00', learningDailyGoal: 10,
}

export function readCourseSettings(levelId) {
  const saved = readProfileValue(`study:${levelId}:settings`, {})
  return { ...DEFAULT_COURSE_SETTINGS, ...saved }
}

export function saveCourseSettings(levelId, settings) {
  const value = { ...readCourseSettings(levelId), ...settings }
  value.count = Math.max(1, Math.min(100, Number(value.count) || 10))
  value.newPerDay = Math.max(0, Math.min(100, Number(value.newPerDay) || 0))
  value.writingBatchSize = Math.max(1, Math.min(10, Math.trunc(Number(value.writingBatchSize)) || 1))
  value.writingPractice = value.writingPractice === 'memory' ? 'memory' : 'learn'
  Object.assign(value, normalizeLearningReminder(value))
  writeProfileValue(`study:${levelId}:settings`, value)
  return value
}

export function readKnownWordIds(levelId) {
  return new Set(readProfileArray(`${levelId}:passed-word-ids`, `sino:${levelId}:passed-word-ids`))
}

export function setWordKnown(levelId, word, isKnown) {
  const knownIds = readKnownWordIds(levelId)
  const wasKnown = knownIds.has(word.id)
  if (isKnown) knownIds.add(word.id)
  else knownIds.delete(word.id)
  writeProfileValue(`${levelId}:passed-word-ids`, [...knownIds])
  if (isKnown && !wasKnown) recordCompletedCard({ courseId: levelId, word })
  return knownIds
}

export function recordStudyAttempt(levelId, word, { mode, correct, score, explanation }) {
  const attempts = readProfileValue(`study:${levelId}:attempts`, {})
  const key = `${word.id}:${mode}`
  const previous = attempts[key] || { attempts: 0, correct: 0 }
  attempts[key] = {
    attempts: previous.attempts + 1,
    correct: previous.correct + Number(correct),
    lastScore: score, lastAttemptAt: new Date().toISOString(),
  }
  writeProfileValue(`study:${levelId}:attempts`, attempts)
  recordSkillResult(levelId, word, { mode, correct, explanation })
  if (mode === 'writing' && correct) recordVerifiedWritingWord(levelId, word)
}

export function recordVerifiedWritingWord(levelId, word) {
  const suffix = `writing:${levelId}:completed-attempts`
  const written = new Set(readProfileArray(suffix, `sino:${suffix}`))
  Array.from(word.hanzi).forEach((character, index) => {
    if (/\p{Script=Han}/u.test(character)) written.add(`${word.id}-${index}`)
  })
  writeProfileValue(suffix, [...written])
}

export function filterStudyWords(words, filter, knownIds) {
  return words.filter((word) => filter === 'learned' ? knownIds.has(word.id)
    : filter === 'unlearned' ? !knownIds.has(word.id) : true)
}

export function getLearningStreak() {
  const history = readDailyActivityHistory()
  const day = new Date()
  let streak = 0
  // Yesterday's streak remains visible until today's study is completed.
  for (let i = 0; i < 3660; i += 1) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    if (history[key]?.completedCards > 0) streak += 1
    else if (i !== 0) break
    day.setDate(day.getDate() - 1)
  }
  return streak
}
