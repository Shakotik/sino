import { readProfileValue, writeProfileValue } from '../profile/profileStorage.js'

export const SKILL_NAMES = { meaning: 'Узнавание', typing: 'Ввод слова', listening: 'На слух', writing: 'Письмо' }
const skillMode = (mode) => mode === 'anki' ? 'meaning' : mode

export function recordSkillResult(levelId, word, { mode, correct, explanation = '' }) {
  const skill = skillMode(mode)
  if (!Object.hasOwn(SKILL_NAMES, skill)) return
  const skills = readProfileValue(`skills:${levelId}`, {})
  const key = `${word.id}:${skill}`
  const previous = skills[key] ?? { attempts: 0, correct: 0 }
  skills[key] = { ...previous, wordId: word.id, skill, attempts: previous.attempts + 1,
    correct: previous.correct + Number(correct), lastCorrect: Boolean(correct),
    explanation: correct ? '' : explanation || (skill === 'writing' ? 'Нужна ещё одна самостоятельная попытка написания.' : 'Ответ не совпал с ожидаемым или слово было пропущено.'),
    updatedAt: new Date().toISOString() }
  writeProfileValue(`skills:${levelId}`, skills)
}

export function readSkillSummary(levelId) {
  const records = Object.values(readProfileValue(`skills:${levelId}`, {}))
  return Object.entries(SKILL_NAMES).map(([skill, label]) => ({ skill, label,
    tried: records.filter((record) => record.skill === skill).length,
    successful: records.filter((record) => record.skill === skill && record.lastCorrect).length,
  }))
}

export function readDifficultWords(levelId, mode) {
  return Object.values(readProfileValue(`skills:${levelId}`, {}))
    .filter((record) => !record.lastCorrect && (!mode || record.skill === mode))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function markSkillMastered(levelId, wordId, mode) {
  const skills = readProfileValue(`skills:${levelId}`, {})
  const key = `${wordId}:${skillMode(mode)}`
  if (!skills[key]) return
  writeProfileValue(`skills:${levelId}`, { ...skills, [key]: { ...skills[key], lastCorrect: true, explanation: '' } })
}
