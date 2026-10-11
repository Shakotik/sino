// A repeated character is still a separate task: 爸爸 has positions 0 and 1.
// Keep original positions so saved progress matches the profile's identifiers.
export function getWordCharacters(word) {
  return Array.from(word.hanzi).flatMap((character, characterIndex) => (
    /\p{Script=Han}/u.test(character) ? [{ character, characterIndex, id: `${word.id}-${characterIndex}` }] : []
  ))
}

// Dictionary notes may themselves contain Chinese examples. Do not let a
// translation or a malformed pinyin field reveal the target during recall.
export function hideChineseExamples(value) {
  return String(value ?? '').replace(/\p{Script=Han}+/gu, '…')
}

export function normalizeWritingOptions(options = {}) {
  return {
    practice: options.practice === 'memory' ? 'memory' : 'learn',
    batchSize: Math.max(1, Math.min(10, Math.trunc(Number(options.batchSize)) || 1)),
    count: Math.max(1, Math.min(100, Math.trunc(Number(options.count)) || 10)),
    filter: ['learned', 'unlearned'].includes(options.filter) ? options.filter : 'all',
    order: options.order === 'shuffle' ? 'shuffle' : 'sequential',
  }
}

// The plan is fixed when a lesson starts. Learning changes the order of phases,
// never the order of characters within a word. A final batch may be shorter.
export function createWritingPlan(words, options = {}) {
  const { practice, batchSize } = normalizeWritingOptions(options)
  const characters = words.flatMap((word, wordIndex) => {
    const parts = getWordCharacters(word)
    return parts.map((part, position) => ({ ...part, word, wordIndex, position, wordLength: parts.length }))
  })
  const steps = []
  for (let start = 0; start < characters.length; start += batchSize) {
    const batch = characters.slice(start, start + batchSize)
    const phases = practice === 'learn' ? ['trace', 'memory'] : ['memory']
    for (const phase of phases) {
      batch.forEach((item, batchPosition) => steps.push({
        ...item, phase, batchIndex: Math.floor(start / batchSize), batchPosition, batchLength: batch.length,
      }))
    }
  }
  return { characters, steps }
}

// Only memory attempts reach this function. Tracing never creates mastery.
// Preserve the first answer even when a later retry succeeds.
export function recordCharacterResult(previous, { correct, skipped = false, unavailable = false }) {
  return {
    firstTryCorrect: previous?.firstTryCorrect ?? (correct && !skipped && !unavailable),
    mastered: previous?.mastered === true || (correct && !skipped && !unavailable),
    skipped,
    unavailable,
  }
}

export function getWritingWordResult(word, results) {
  const characters = getWordCharacters(word)
  const answers = characters.map(({ id }) => results[id])
  const resolved = answers.length > 0 && answers.every(Boolean)
  return {
    resolved,
    mastered: resolved && answers.every((answer) => answer.mastered),
    firstTryCorrect: resolved && answers.every((answer) => answer.firstTryCorrect),
    score: resolved ? Math.round(answers.filter((answer) => answer.firstTryCorrect).length / answers.length * 100) : 0,
  }
}
