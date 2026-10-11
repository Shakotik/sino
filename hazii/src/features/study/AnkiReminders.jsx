import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { studyLevels } from '../../data/studyDemo'
import { profileStorageKey, readProfileValue, writeProfileValue } from '../profile/profileStorage'
import { readDailyActivityHistory } from '../profile/localProfile'
import { getDueCount } from './ankiStorage'
import { readCourseSettings, readKnownWordIds } from './studyStorage'
import { reviewCourseUrl, showDueReviewNotification, showLearningNotification } from './reminderNotifications'
import { isLearningReminderDue, localStudyDay, normalizeLearningReminder } from './learningReminderSchedule'

const REFRESH_INTERVAL = 60_000
const DISMISS_COOLDOWN = 60 * 60_000

function readReminders() {
  const now = new Date()
  const todayWords = readDailyActivityHistory()[localStudyDay(now)]?.words ?? []
  const reviewCourses = []
  const learningCourses = []
  for (const level of studyLevels) {
    const settings = readCourseSettings(level.id)
    if (settings.reminders && Number(readProfileValue(`anki:${level.id}:reminder-snoozed-until`, 0)) <= now.getTime()) {
      const dueCount = getDueCount(level.id, now.getTime())
      if (dueCount > 0) reviewCourses.push({ ...level, kind: 'anki', dueCount })
    }
    if (settings.learningReminders) {
      const learnedToday = todayWords.filter((word) => word.courseId === level.id).length
      const knownWords = readKnownWordIds(level.id).size
      const snoozedUntil = Number(readProfileValue(`learning:${level.id}:reminder-snoozed-until`, 0))
      if (isLearningReminderDue({ settings, learnedToday, knownWords, totalWords: level.totalWords, snoozedUntil, now })) {
        const goal = normalizeLearningReminder(settings).learningDailyGoal
        learningCourses.push({ ...level, kind: 'learning', dueCount: Math.min(goal - learnedToday, level.totalWords - knownWords) })
      }
    }
  }
  return { profileKey: profileStorageKey('study:reminders'), courses: [...reviewCourses, ...learningCourses] }
}

// This component checks due dates while the application is open. A service
// worker can display a notification but cannot act as a background alarm.
export function AnkiReminders({ user }) {
  const { pathname } = useLocation()
  const [snapshot, setSnapshot] = useState(readReminders)
  const isReviewing = /\/study\/[^/]+\/(?:anki|learning|knowledge|writing|cards)(?:\/|$)/u.test(pathname)

  useEffect(() => {
    if (isReviewing) return undefined
    let isActive = true
    async function notifyNextCourse(courses) {
      // Skip already-notified courses; issue at most one new notification per
      // check so returning after a long absence does not produce a burst.
      for (const course of courses) {
        if (!isActive) return
        const notify = course.kind === 'learning' ? showLearningNotification : showDueReviewNotification
        const sent = await notify({
          levelId: course.id,
          levelName: course.name,
          count: course.dueCount,
          remaining: course.dueCount,
          shouldNotify: () => isActive
            && readReminders().courses.some((current) => current.id === course.id && current.kind === course.kind),
        })
        if (sent) return
      }
    }
    function refresh() {
      const next = readReminders()
      setSnapshot(next)
      void notifyNextCourse(next.courses)
    }
    refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL)
    window.addEventListener('focus', refresh)
    window.addEventListener('sino:progress-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      isActive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('sino:progress-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [isReviewing, user?.id])

  if (isReviewing || snapshot.profileKey !== profileStorageKey('study:reminders')) return null
  const course = snapshot.courses[0]
  if (!course) return null

  function dismissReminder() {
    writeProfileValue(`${course.kind}:${course.id}:reminder-snoozed-until`, Date.now() + DISMISS_COOLDOWN)
    setSnapshot(readReminders())
  }

  return (
    <aside className="anki-due-banner" aria-label="Напоминание об учёбе" aria-live="polite">
      <p><strong>{course.name}: {course.kind === 'learning' ? 'пора изучить слова' : 'пора повторить'}</strong><br />{course.kind === 'learning' ? 'Осталось до дневной цели' : 'Карточек на сегодня'}: {course.dueCount}.</p>
      <Link className="study-primary" to={course.kind === 'learning' ? `/study/${course.id}` : reviewCourseUrl(course.id)}>{course.kind === 'learning' ? 'Изучать' : 'Повторить'}</Link>
      <button type="button" onClick={dismissReminder} aria-label={`Напомнить о ${course.name} через час`} title="Напомнить через час">×</button>
    </aside>
  )
}
