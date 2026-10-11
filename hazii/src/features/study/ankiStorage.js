import { readProfileValue, writeProfileValue } from '../profile/profileStorage'
import { scheduleReview } from './ankiScheduler'

export function readAnkiSchedule(levelId) {
  return readProfileValue(`anki:${levelId}`, {})
}

export function reviewAnkiWord(levelId, wordId, grade) {
  const schedule = readAnkiSchedule(levelId)
  const next = scheduleReview(schedule[wordId], grade)
  writeProfileValue(`anki:${levelId}`, { ...schedule, [wordId]: next })
  return next
}

export function getDueCount(levelId, now = Date.now()) {
  return Object.values(readAnkiSchedule(levelId)).filter((entry) => Date.parse(entry.dueAt) <= now).length
}
