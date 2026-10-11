import { readDailyActivityHistory, readLocalProfile, saveLocalProfile } from './localProfile.js'
import { readProfileValue, writeProfileValues } from './profileStorage.js'

function requireEnrolledProfile(courseId, expectedProfileId) {
  const profile = readLocalProfile()
  if (!profile || profile.id !== expectedProfileId || !profile.enrolledCourseIds.includes(courseId)) {
    throw new Error('Профиль или список курсов изменился. Обновите страницу и повторите действие.')
  }
  return profile
}

export function removeCourseActivity(history, courseId) {
  return Object.fromEntries(Object.entries(history).flatMap(([date, entry]) => {
    const words = entry.words.filter((word) => word.courseId !== courseId)
    const removedCount = entry.words.length - words.length
    // Old calendar totals without word snapshots cannot be attributed safely
    // to a particular course. Preserve that unknown remainder.
    const completedCards = Math.max(0, entry.completedCards - removedCount)
    return completedCards > 0 ? [[date, { ...entry, words, completedCards }]] : []
  }))
}

export function resetCourseProgress(courseId, expectedProfileId) {
  requireEnrolledProfile(courseId, expectedProfileId)
  const entries = removeCourseActivity(readDailyActivityHistory(), courseId)
  // Write explicit empty values rather than deleting keys: deletion could
  // re-import old pre-profile progress through the legacy migration reader.
  writeProfileValues({
    [`${courseId}:passed-word-ids`]: [],
    [`writing:${courseId}:completed-attempts`]: [],
    [`study:${courseId}:attempts`]: {},
    [`anki:${courseId}`]: {},
    [`skills:${courseId}`]: {},
    'daily-activity': { entries },
  }, expectedProfileId)
}

// Removing a course is reversible by taking it again. Learning results and
// calendar history remain; only its two kinds of reminders are switched off.
export function removeCourseFromProfile(courseId, expectedProfileId) {
  const profile = requireEnrolledProfile(courseId, expectedProfileId)
  const updated = { ...profile, enrolledCourseIds: profile.enrolledCourseIds.filter((id) => id !== courseId) }
  saveLocalProfile(updated)
  writeProfileValues({
    [`study:${courseId}:settings`]: {
      ...readProfileValue(`study:${courseId}:settings`, {}), reminders: false, learningReminders: false,
    },
  }, expectedProfileId)
  return updated
}
