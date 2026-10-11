export function normalizeLearningReminder(settings = {}) {
  return {
    learningReminders: settings.learningReminders === true,
    learningReminderTime: /^([01]\d|2[0-3]):[0-5]\d$/u.test(settings.learningReminderTime) ? settings.learningReminderTime : '18:00',
    learningDailyGoal: Math.max(1, Math.min(100, Math.trunc(Number(settings.learningDailyGoal)) || 10)),
  }
}

export function localStudyDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function isLearningReminderDue({ settings, learnedToday, knownWords, totalWords, snoozedUntil = 0, now = new Date() }) {
  const reminder = normalizeLearningReminder(settings)
  const [hours, minutes] = reminder.learningReminderTime.split(':').map(Number)
  return reminder.learningReminders
    && now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes
    && now.getTime() >= snoozedUntil
    && learnedToday < reminder.learningDailyGoal
    && knownWords < totalWords
}
