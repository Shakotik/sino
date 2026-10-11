import { studyLevels } from '../../data/studyDemo.js'
import { readProfileArray, readProfileValue, writeProfileValue } from './profileStorage.js'

// This module is deliberately small: it is the temporary bridge between the
// profile interface and localStorage. When the account API appears, callers
// can keep the same functions while their internals switch to HTTP requests.
const PROFILE_STORAGE_KEY = 'sino:profile'
const SAVED_PROFILES_KEY = 'sino:saved-local-profiles'
const DAILY_ACTIVITY_STORAGE_KEY = 'sino:daily-activity'

function readJson(storageKey, fallbackValue) {
  try {
    const savedValue = window.localStorage.getItem(storageKey)
    return savedValue ? JSON.parse(savedValue) : fallbackValue
  } catch {
    return fallbackValue
  }
}

function getLocalDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${now.getFullYear()}-${month}-${day}`
}

function createProfileId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `local-${Date.now()}`
}

export function readLocalProfile() {
  const savedProfile = readJson(PROFILE_STORAGE_KEY, null)

  if (!savedProfile || typeof savedProfile.displayName !== 'string' || typeof savedProfile.email !== 'string') {
    return null
  }

  const profile = {
    id: savedProfile.id ?? createProfileId(),
    displayName: savedProfile.displayName,
    email: savedProfile.email,
    joinedAt: savedProfile.joinedAt ?? new Date().toISOString(),
    dailyGoal: Number.isFinite(savedProfile.dailyGoal) ? savedProfile.dailyGoal : 10,
    enrolledCourseIds: Array.isArray(savedProfile.enrolledCourseIds)
      ? savedProfile.enrolledCourseIds.filter((courseId) => studyLevels.some((level) => level.id === courseId))
      : [],
  }
  if (!savedProfile.id) saveLocalProfile(profile)
  return profile
}

export function saveLocalProfile(profile) {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  const profiles = readSavedLocalProfiles().filter((saved) => saved.id !== profile.id)
  window.localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify([...profiles, profile]))
}

// This is a local profile switcher, not authenticated email sign-in. Keeping
// identities allows a demo user to log out without losing the server-card key.
export function readSavedLocalProfiles() {
  const profiles = readJson(SAVED_PROFILES_KEY, [])
  return Array.isArray(profiles) ? profiles.filter((profile) => (
    typeof profile?.id === 'string' && typeof profile?.displayName === 'string'
    && typeof profile?.email === 'string'
  )) : []
}

export function resumeLocalProfile(profileId) {
  const profile = readSavedLocalProfiles().find((saved) => saved.id === profileId)
  if (!profile) return null
  saveLocalProfile(profile)
  return readLocalProfile()
}

export function createLocalProfile({ displayName, email }) {
  const normalizedEmail = email.trim().toLowerCase()
  const existing = readSavedLocalProfiles().find((profile) => profile.email === normalizedEmail)
  const profile = {
    id: existing?.id ?? createProfileId(),
    displayName: displayName.trim(),
    email: normalizedEmail,
    joinedAt: existing?.joinedAt ?? new Date().toISOString(),
    dailyGoal: existing?.dailyGoal ?? 10,
    enrolledCourseIds: existing?.enrolledCourseIds ?? [],
  }

  saveLocalProfile(profile)
  return profile
}

export function removeLocalProfile() {
  const profile = readLocalProfile()
  if (profile) saveLocalProfile(profile)
  window.localStorage.removeItem(PROFILE_STORAGE_KEY)
}

// The first backend version will store these counters in the user's account.
// For now, one local daily record lets the profile already reflect real card
// activity without pretending that it is synchronised between devices.
export function readDailyActivity() {
  const history = readDailyActivityHistory()
  const date = getLocalDate()

  return { date, completedCards: history[date]?.completedCards ?? 0 }
}

export function readDailyActivityHistory() {
  const savedActivity = readProfileValue('daily-activity', null, DAILY_ACTIVITY_STORAGE_KEY)

  // The first profile version stored one date and one number. Keep that
  // number during the upgrade to the calendar-shaped history below.
  if (savedActivity?.date && Number.isFinite(savedActivity.completedCards)) {
    return {
      [savedActivity.date]: {
        completedCards: savedActivity.completedCards,
        words: [],
      },
    }
  }

  if (!savedActivity?.entries || typeof savedActivity.entries !== 'object') {
    return {}
  }

  return Object.fromEntries(Object.entries(savedActivity.entries).flatMap(([date, entry]) => {
    // Version two stored just a numeric value for each day. New entries also
    // retain the word snapshot so a learner can revisit that day's material.
    if (Number.isFinite(entry) && entry >= 0) {
      return [[date, { completedCards: entry, words: [] }]]
    }

    if (!entry || !Number.isFinite(entry.completedCards) || entry.completedCards < 0) {
      return []
    }

    return [[date, {
      completedCards: entry.completedCards,
      words: Array.isArray(entry.words) ? entry.words.filter((word) => (
        typeof word?.courseId === 'string'
        && Number.isFinite(word?.wordId)
        && typeof word?.hanzi === 'string'
      )) : [],
    }]]
  }))
}

export function recordCompletedCard({ courseId, word }) {
  // Guest history has its own namespace; it is never written into a signed-out
  // profile. Keeping it also lets daily reminders recognise completed goals.
  if (!courseId || !word) return

  const history = readDailyActivityHistory()
  const date = getLocalDate()
  const currentEntry = history[date] ?? { completedCards: 0, words: [] }
  const wasAlreadyRecorded = currentEntry.words.some((savedWord) => (
    savedWord.courseId === courseId && savedWord.wordId === word.id
  ))

  if (wasAlreadyRecorded) return

  const wordSnapshot = {
    courseId,
    wordId: word.id,
    hanzi: word.hanzi,
    pinyin: word.pinyin,
    translation: word.translationRu ?? word.translationEn ?? '',
  }
  const nextHistory = {
    ...history,
    [date]: {
      completedCards: currentEntry.completedCards + 1,
      words: [...currentEntry.words, wordSnapshot],
    },
  }

  writeProfileValue('daily-activity', { entries: nextHistory })
}

function readStringArray(storageKey) {
  return readProfileArray(storageKey.replace(/^sino:/u, ''), storageKey)
}

export function readLearningSummary() {
  const totalWords = studyLevels.reduce((total, level) => total + level.totalWords, 0)
  const knownWords = studyLevels.reduce((total, level) => (
    total + new Set(readStringArray(`sino:${level.id}:passed-word-ids`)).size
  ), 0)
  const writtenCharacters = studyLevels.reduce((total, level) => (
    total + new Set(readStringArray(`sino:writing:${level.id}:completed-attempts`)).size
  ), 0)

  return {
    totalWords,
    knownWords: Math.min(knownWords, totalWords),
    writtenCharacters,
  }
}

export function readCourseSummary(courseId) {
  const level = studyLevels.find((item) => item.id === courseId)

  if (!level) return null

  const learnedWordIds = new Set(readStringArray(`sino:${courseId}:passed-word-ids`))
  const writtenAttemptKeys = new Set(readStringArray(`sino:writing:${courseId}:completed-attempts`))
  const learnedWords = Math.min(learnedWordIds.size, level.totalWords)
  const writtenCharacters = Math.min(writtenAttemptKeys.size, level.totalCharacters)

  return {
    id: level.id,
    name: level.name,
    totalWords: level.totalWords,
    learnedWords,
    learningWords: level.totalWords - learnedWords,
    totalCharacters: level.totalCharacters,
    writtenCharacters,
  }
}
