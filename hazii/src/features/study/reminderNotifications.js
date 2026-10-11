import { profileStorageKey } from '../profile/profileStorage.js'

const REMINDER_WORKER_URL = '/reminders-sw.js'
const REMINDER_WORKER_SCOPE = '/reminders/'
const WORKER_ACTIVATION_TIMEOUT = 8000
const pendingNotifications = new Set()
let registrationPromise

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function notificationsSupported() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && 'Notification' in window
    && 'serviceWorker' in navigator
}

function waitForActiveWorker(registration) {
  if (registration.active?.state === 'activated') return Promise.resolve(registration)
  const worker = registration.installing || registration.waiting || registration.active
  if (!worker) return Promise.reject(new Error('Reminder worker unavailable'))

  return new Promise((resolve, reject) => {
    function cleanup() {
      window.clearTimeout(timeoutId)
      worker.removeEventListener('statechange', onStateChange)
    }
    function onStateChange() {
      if (worker.state === 'activated') {
        cleanup()
        resolve(registration)
      } else if (worker.state === 'redundant') {
        cleanup()
        reject(new Error('Reminder worker replaced'))
      }
    }
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Reminder worker activation timed out'))
    }, WORKER_ACTIVATION_TIMEOUT)
    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}

function getReminderRegistration() {
  if (!registrationPromise) {
    // A separate narrow scope keeps the offline app worker untouched. This
    // worker displays notifications; it does not schedule background timers.
    registrationPromise = navigator.serviceWorker.register(REMINDER_WORKER_URL, {
      scope: REMINDER_WORKER_SCOPE,
      updateViaCache: 'none',
    }).then(waitForActiveWorker).catch((error) => {
      registrationPromise = undefined
      throw error
    })
  }
  return registrationPromise
}

// Call only from an explicit settings-button click: browsers require the
// permission request to originate from the learner's own action.
export async function requestStudyNotifications() {
  if (!notificationsSupported()) {
    return 'В этом браузере системные уведомления недоступны. Напоминания появятся внутри Sino; для закрытого приложения добавьте напоминание в календарь.'
  }
  try {
    const permission = window.Notification.permission === 'default'
      ? await window.Notification.requestPermission()
      : window.Notification.permission
    if (permission !== 'granted') {
      return permission === 'denied'
        ? 'Уведомления запрещены в настройках браузера. Напоминания внутри Sino и календарь остаются доступны.'
        : 'Разрешение не получено. Напоминания пока будут появляться внутри Sino.'
    }
    await getReminderRegistration()
    window.dispatchEvent(new Event('sino:progress-changed'))
    return 'Уведомления включены для открытого приложения. Когда Sino закрыто, напомнить о занятии сможет календарь.'
  } catch {
    return 'Браузер не смог включить системные уведомления. Напоминания внутри Sino продолжают работать; можно добавить ежедневное событие в календарь.'
  }
}

export function reviewCourseUrl(levelId) {
  return `/study/${encodeURIComponent(levelId)}/anki?count=20`
}

export async function showDueReviewNotification({ levelId, levelName, count, now = new Date(), shouldNotify = () => true }) {
  if (count < 1) return false
  return showCourseNotification({
    levelId, kind: 'anki', now, shouldNotify,
    title: `Sino · пора повторить ${levelName}`,
    body: `Карточек к повторению: ${count}. Несколько минут помогут сохранить изученное.`,
    url: reviewCourseUrl(levelId),
  })
}

export function showLearningNotification({ levelId, levelName, remaining, now = new Date(), shouldNotify = () => true }) {
  if (remaining < 1) return Promise.resolve(false)
  return showCourseNotification({
    levelId, kind: 'learning', now, shouldNotify,
    title: `Sino · время для ${levelName}`,
    body: `До цели на сегодня осталось изучить слов: ${remaining}. Начнём небольшое занятие?`,
    url: `/study/${encodeURIComponent(levelId)}`,
  })
}

async function showCourseNotification({ levelId, kind, title, body, url, now, shouldNotify }) {
  if (!notificationsSupported() || window.Notification.permission !== 'granted') return false

  const suffix = `${kind}:${levelId}:notification-day`
  const storageKey = profileStorageKey(suffix)
  const day = localDayKey(now)
  if (pendingNotifications.has(storageKey)) return false
  pendingNotifications.add(storageKey)

  async function showOnce() {
    try {
      if (localStorage.getItem(storageKey) === day) return false
      const registration = await getReminderRegistration()
      // Account changes while a worker is starting must not send a previous
      // learner's reminder or write a cooldown into the next learner's data.
      if (profileStorageKey(suffix) !== storageKey) return false
      if (!shouldNotify()) return false
      if (localStorage.getItem(storageKey) === day) return false
      await registration.showNotification(title, {
        body,
        // Android notifications do not render SVG icons.
        icon: '/sino-icon-192.png',
        lang: 'ru',
        tag: `${storageKey}:${day}`,
        renotify: false,
        data: { url },
      })
      localStorage.setItem(storageKey, day)
      return true
    } catch {
      // The in-app banner remains usable if notifications/storage fail.
      return false
    }
  }

  try {
    // Multiple open tabs share one daily reminder when Web Locks is available.
    return navigator.locks?.request
      ? await navigator.locks.request(storageKey, showOnce)
      : await showOnce()
  } catch {
    return false
  } finally {
    pendingNotifications.delete(storageKey)
  }
}

function calendarText(value) {
  return String(value).replaceAll('\\', '\\\\').replace(/\r?\n/gu, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,')
}

function calendarLocalDate(date) {
  return `${localDayKey(date).replaceAll('-', '')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`
}

// RFC 5545 line folding counts UTF-8 bytes, not letters: Russian text and
// Chinese characters otherwise produce invalid long lines in some calendars.
function foldCalendarLine(line) {
  const encoder = new TextEncoder()
  const parts = []
  let part = ''
  let bytes = 0
  for (const character of line) {
    const characterBytes = encoder.encode(character).length
    if (bytes + characterBytes > 75) {
      parts.push(part)
      part = ' '
      bytes = 1
    }
    part += character
    bytes += characterBytes
  }
  parts.push(part)
  return parts.join('\r\n')
}

export function createReviewCalendar({ levelId, levelName, hour = 18, minute = 0, now = new Date(), origin = '', kind = 'anki', goal = 10 } = {}) {
  const start = new Date(now)
  start.setDate(start.getDate() + 1)
  start.setHours(Math.min(23, Math.max(0, Number(hour) || 0)), Math.min(59, Math.max(0, Number(minute) || 0)), 0, 0)
  const courseLabel = levelName ? ` · ${levelName}` : ''
  const isLearning = kind === 'learning'
  const target = levelId ? (isLearning ? `/study/${encodeURIComponent(levelId)}` : reviewCourseUrl(levelId)) : '/'
  const summary = isLearning ? `Изучить ${goal} слов в Sino${courseLabel}` : `Повторить слова в Sino${courseLabel}`
  const url = origin ? new URL(target, origin).href : ''
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sino//Study reminders//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:sino-${isLearning ? 'learning' : 'review'}-${encodeURIComponent(levelId || 'all')}@sino.local`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')}`,
    // A floating local time keeps daily practice at 18:00 in the calendar's
    // local timezone, including after daylight-saving changes.
    `DTSTART:${calendarLocalDate(start)}`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${calendarText(summary)}`,
    `DESCRIPTION:${calendarText(isLearning ? 'Откройте курс Sino и изучите новые слова. Это отдельное ежедневное событие календаря: оно не знает, выполнена ли цель, и не меняется при изменении настроек в Sino.' : 'Откройте Sino и проверьте карточки к повторению. Это ежедневное напоминание о занятии; фактическая очередь ANKI обновляется внутри приложения.')}`,
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    `DESCRIPTION:${calendarText(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(foldCalendarLine).join('\r\n')}\r\n`
}

export function downloadReviewCalendar(options = {}) {
  const calendar = createReviewCalendar({ origin: window.location.origin, ...options })
  const downloadUrl = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = `sino-${options.levelId || 'daily'}-reminder.ics`
  document.body.append(link)
  link.click()
  link.remove()
  // Keep the object URL alive long enough for mobile browsers to start import.
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000)
  const time = `${String(options.hour ?? 18).padStart(2, '0')}:${String(options.minute ?? 0).padStart(2, '0')}`
  return `Файл календаря скачан. Откройте его и подтвердите добавление: повторять ежедневно в ${time}, начиная с завтрашнего дня.`
}
