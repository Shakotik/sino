const DAY = 86_400_000

// Anki-style spaced repetition, not a connection to the Anki application.
// Keep scheduling pure so date arithmetic and failure intervals can be tested.
export function scheduleReview(previous, grade, now = Date.now()) {
  if (!['again', 'hard', 'good', 'easy'].includes(grade)) throw new Error('Unknown review grade')
  const prior = previous || { intervalDays: 0, ease: 2.5, reviews: 0, lapses: 0 }
  const ease = Math.max(1.3, (prior.ease || 2.5) + (grade === 'hard' ? -0.15 : grade === 'easy' ? 0.15 : grade === 'again' ? -0.2 : 0))
  let intervalDays
  if (grade === 'again') intervalDays = 1 / 1440
  else if (grade === 'hard') intervalDays = prior.intervalDays >= 1 ? Math.max(1, Math.round(prior.intervalDays * 1.2)) : 6 / 1440
  else if (grade === 'easy') intervalDays = prior.intervalDays >= 1 ? Math.max(4, Math.round(prior.intervalDays * ease * 1.3)) : 4
  else intervalDays = prior.intervalDays >= 1 ? Math.max(1, Math.round(prior.intervalDays * ease)) : 1
  return {
    intervalDays, ease, reviews: (prior.reviews || 0) + 1,
    lapses: (prior.lapses || 0) + Number(grade === 'again'),
    firstReviewedAt: prior.firstReviewedAt || new Date(now).toISOString(),
    lastReviewedAt: new Date(now).toISOString(),
    dueAt: new Date(now + intervalDays * DAY).toISOString(), grade,
  }
}

export function buildReviewQueue(words, schedules, { limit = 10, newPerDay = 10, now = Date.now() } = {}) {
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const introducedToday = Object.values(schedules).filter((item) => Date.parse(item.firstReviewedAt) >= dayStart.getTime()).length
  const due = words.filter((word) => schedules[word.id] && Date.parse(schedules[word.id].dueAt) <= now)
    .sort((left, right) => Date.parse(schedules[left.id].dueAt) - Date.parse(schedules[right.id].dueAt))
  const newWords = words.filter((word) => !schedules[word.id]).slice(0, Math.max(0, newPerDay - introducedToday))
  return [...due, ...newWords].slice(0, limit)
}

export function describeInterval(days) {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))} мин.`
  if (days < 1) return `${Math.round(days * 24)} ч.`
  return `${Math.round(days)} дн.`
}
