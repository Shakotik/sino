import { useEffect, useMemo, useState } from 'react'
import { LearningPreferences } from './LearningPreferences.jsx'
import { readSkillSummary } from '../study/learningInsights.js'
import { readCourseSummary, readDailyActivityHistory, readLearningSummary, readSavedLocalProfiles } from './localProfile'
import { usePageNavigation } from '../study/usePageNavigation'
import { PersonalCardsSummary } from '../personal/PersonalCardsSummary'
import { PersonalFolderCourses } from '../personal/PersonalFolderCourses.jsx'
import { StudyDialog } from '../../components/StudyDialog'
import { removeCourseFromProfile, resetCourseProgress } from './courseManagement'

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function formatJoinDate(isoDate) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(isoDate))
}

function getDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date)
}

function formatDay(dateKey) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
    .format(new Date(`${dateKey}T12:00:00`))
}

function buildCalendarDays(monthDate, history) {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const mondayFirstOffset = (firstDay.getDay() + 6) % 7
  const todayKey = getDateKey(new Date())
  const cells = Array.from({ length: mondayFirstOffset }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day)
    const dateKey = getDateKey(date)
    const activity = history[dateKey] ?? { completedCards: 0, words: [] }
    cells.push({
      day,
      dateKey,
      activity,
      isToday: dateKey === todayKey,
      isFuture: date > new Date(),
    })
  }

  return cells
}

function DayWordsDialog({ day, isClosing, onClose, onRepeat }) {
  const savedWords = day.activity.words
  const hasWordsToRepeat = savedWords.length > 0

  return (
    <div className={`calendar-dialog-layer ${isClosing ? 'is-closing' : ''}`} role="presentation">
      <button className="calendar-dialog-backdrop" type="button" aria-label="Закрыть список слов" onClick={() => onClose()} />
      <section className="calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title">
        <div className="calendar-dialog-header">
          <div>
            <p className="eyebrow">Дневник учёбы</p>
            <h3 id="calendar-dialog-title">{formatDay(day.dateKey)}</h3>
            <p>Выучено слов: <strong>{day.activity.completedCards}</strong></p>
          </div>
          <button type="button" aria-label="Закрыть" onClick={() => onClose()}>×</button>
        </div>

        {hasWordsToRepeat ? (
          <ul className="calendar-word-list">
            {savedWords.map((word) => (
              <li key={`${word.courseId}-${word.wordId}`}>
                <span className="calendar-word-hanzi" lang="zh">{word.hanzi}</span>
                <span>
                  <strong className="pinyin">{word.pinyin}</strong>
                  <small>{word.translation}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="calendar-empty-words">
            Для этого дня сохранилось число слов, но не их список: календарь начал записывать
            названия слов только после этого обновления.
          </p>
        )}

        <button className="calendar-repeat-button" type="button" disabled={!hasWordsToRepeat} onClick={() => onRepeat(savedWords)}>
          Повторить слова
        </button>
      </section>
    </div>
  )
}

function ProgressIndicator({ label, value, detail, percent }) {
  return (
    <div className="course-progress-indicator">
      <div className="course-progress-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div
        className="course-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(percent)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  )
}

function LearningCalendar({ history }) {
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(null)
  const [isDialogClosing, setIsDialogClosing] = useState(false)
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth, history), [visibleMonth, history])
  const navigate = usePageNavigation()

  function moveMonth(amount) {
    setVisibleMonth((currentMonth) => new Date(currentMonth.getFullYear(), currentMonth.getMonth() + amount, 1))
    setSelectedDay(null)
  }

  function closeDayDialog(afterClose) {
    if (isDialogClosing) return

    setIsDialogClosing(true)
    window.setTimeout(() => {
      setSelectedDay(null)
      setIsDialogClosing(false)
      afterClose?.()
    }, 260)
  }

  function repeatWords(words) {
    const firstCourseId = words[0]?.courseId
    const matchingCourseWords = words.filter((word) => word.courseId === firstCourseId)

    if (!firstCourseId || matchingCourseWords.length === 0) return

    const wordIds = matchingCourseWords.map((word) => word.wordId).join(',')
    closeDayDialog(() => navigate(`/study/${firstCourseId}/cards?review=${encodeURIComponent(wordIds)}`))
  }

  return (
    <article className="learning-diary">
      <div className="learning-calendar-heading">
        <div>
          <h2>Дневник учёбы</h2>
          <p>Слов изучено по дням</p>
        </div>
        <div className="calendar-month-control">
          <button type="button" aria-label="Предыдущий месяц" onClick={() => moveMonth(-1)}>←</button>
          <strong>{formatMonth(visibleMonth)}</strong>
          <button type="button" aria-label="Следующий месяц" onClick={() => moveMonth(1)}>→</button>
        </div>
      </div>

      <div className="learning-calendar" aria-label={`Календарь обучения: ${formatMonth(visibleMonth)}`}>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((weekday) => (
          <span key={weekday} className="learning-calendar-weekday">{weekday}</span>
        ))}
        {calendarDays.map((day, index) => (
          day ? (
            <button
              key={day.dateKey}
              type="button"
              className={`learning-calendar-day ${day.isToday ? 'is-today' : ''} ${day.isFuture ? 'is-future' : ''} ${day.activity.completedCards === 0 ? 'is-empty' : ''}`}
              aria-label={`${day.day} число: изучено слов ${day.activity.completedCards}`}
              disabled={day.isFuture}
              onClick={() => {
                setIsDialogClosing(false)
                setSelectedDay(day)
              }}
            >
              <span>{day.day}</span>
              <strong>{day.activity.completedCards}</strong>
            </button>
          ) : <span key={`empty-${index}`} className="learning-calendar-empty" aria-hidden="true" />
        ))}
      </div>

      <p className="learning-calendar-note">В каждой ячейке — число слов, отмеченных как изученные.</p>
      {selectedDay && (
        <DayWordsDialog
          day={selectedDay}
          isClosing={isDialogClosing}
          onClose={closeDayDialog}
          onRepeat={repeatWords}
        />
      )}
    </article>
  )
}

function RegistrationForm({ onRegister }) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState('')

  function submitForm(event) {
    event.preventDefault()
    const trimmedName = displayName.trim()
    const trimmedEmail = email.trim()

    if (trimmedName.length < 2) {
      setFormError('Введите имя минимум из двух букв.')
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setFormError('Проверьте адрес электронной почты.')
      return
    }

    setFormError('')
    onRegister({ displayName: trimmedName, email: trimmedEmail })
  }

  return (
    <form className="profile-registration-form" onSubmit={submitForm} noValidate>
      <label>
        <span>Как вас зовут</span>
        <input
          value={displayName}
          type="text"
          autoComplete="name"
          placeholder="Например, Анна"
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label>
        <span>Электронная почта</span>
        <input
          value={email}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="anna@example.com"
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {formError && <p className="profile-form-error" role="alert">{formError}</p>}
      <button className="profile-primary-action" type="submit">Создать профиль</button>
      <p className="profile-form-note">
        Это демонстрационный профиль: имя и почта хранятся только в этом браузере.
        Пароль пока не запрашивается и не сохраняется.
      </p>
    </form>
  )
}

export function ProfilePage({ user, onRegister, onResume, onUpdate, onLogOut }) {
  const navigate = usePageNavigation()
  const [, refreshProgress] = useState(0)
  const [courseAction, setCourseAction] = useState(null)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    function refresh() { refreshProgress((value) => value + 1) }
    window.addEventListener('sino:progress-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('sino:progress-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  function confirmCourseAction() {
    try {
      const { course, type } = courseAction
      if (type === 'reset') {
        resetCourseProgress(course.id, user.id)
        setActionMessage(`Прогресс ${course.name} сброшен. Курс остался в профиле.`)
      } else {
        onUpdate(removeCourseFromProfile(course.id, user.id))
        setActionMessage(`${course.name} удалён из списка. Прогресс сохранён, напоминания отключены.`)
      }
      setCourseAction(null)
    } catch (error) { setActionError(error.message) }
  }

  function chooseCourseAction(course, type) {
    setActionError('')
    setCourseAction({ course, type })
  }

  if (!user) {
    return (
      <main className="profile-shell">
        <button className="back-button" type="button" onClick={() => navigate('/')}>
          ← К учёбе
        </button>

        <header className="profile-header">
          <h1>Создайте личный кабинет</h1>
          <p>Сохраните имя и начните собирать свой учебный прогресс.</p>
        </header>

        {readSavedLocalProfiles().length > 0 && <section className="study-options" aria-label="Профили на этом устройстве" style={{ marginBottom: 24 }}>
          <h2>Продолжить на этом устройстве</h2>
          <p>Выход не удаляет курсы и статистику. Выберите прежний профиль, чтобы продолжить. Локальные профили доступны всем, кто пользуется этим браузером — это пока не вход по паролю.</p>
          {readSavedLocalProfiles().map((profile) => <button className="card-filter-option" type="button" key={profile.id} onClick={() => onResume(profile.id)}><span>{profile.displayName}</span><span>Продолжить →</span></button>)}
        </section>}
        <section className="profile-registration" aria-labelledby="registration-title">
          <div className="profile-registration-copy">
            <span className="profile-large-avatar" aria-hidden="true">人</span>
            <h2 id="registration-title">Новый ученик</h2>
            <p>
              После регистрации здесь появятся прогресс по словам, выполненные прописи
              и дневная учебная цель.
            </p>
          </div>
          <RegistrationForm onRegister={onRegister} />
        </section>
      </main>
    )
  }

  const learningSummary = readLearningSummary()
  const activityHistory = readDailyActivityHistory()
  const courseSummaries = user.enrolledCourseIds
    .map((courseId) => readCourseSummary(courseId))
    .filter(Boolean)

  return (
    <main className="profile-shell">
      <button className="back-button" type="button" onClick={() => navigate('/')}>
        ← К учёбе
      </button>

      <header className="profile-header">
        <h1>Личный кабинет</h1>
        <p>Ваше спокойное пространство для отслеживания пути в китайском языке.</p>
      </header>

      <section className="profile-dashboard" aria-label="Сводка вашего обучения">
        <article className="profile-overview">
          <div className="profile-person">
            <span className="profile-large-avatar" aria-hidden="true">{getInitials(user.displayName)}</span>
            <div>
              <h2>{user.displayName}</h2>
              <p>{user.email}</p>
              <span className="profile-status">Начинающий ученик</span>
            </div>
          </div>

          <dl className="profile-stat-list">
            <div>
              <dt>Освоено слов</dt>
              <dd><strong>{learningSummary.knownWords}</strong> / {learningSummary.totalWords}</dd>
              <small>во всех HSK</small>
            </div>
            <div>
              <dt>Прописано знаков</dt>
              <dd><strong>{learningSummary.writtenCharacters}</strong></dd>
              <small>в упражнениях</small>
            </div>
            <div>
              <dt>С Sino</dt>
              <dd><strong>{formatJoinDate(user.joinedAt)}</strong></dd>
              <small>первый шаг уже сделан</small>
            </div>
          </dl>
        </article>

        <LearningCalendar history={activityHistory} />
      </section>

      <section className="profile-courses" aria-labelledby="profile-courses-title">
        <div className="profile-courses-heading">
          <div>
            <p className="eyebrow">Моё обучение</p>
            <h2 id="profile-courses-title">Взятые курсы</h2>
          </div>
          <button className="profile-text-action" type="button" onClick={() => navigate('/')}>
            Выбрать курс →
          </button>
        </div>
        {actionMessage && <p className="study-status" role="status">{actionMessage}</p>}

        {courseSummaries.length === 0 ? (
          <div className="profile-empty-courses">
            <span aria-hidden="true">学</span>
            <div>
              <h3>Курсов пока нет</h3>
              <p>Выберите HSK 1 на главной странице и нажмите «Взять курс».</p>
            </div>
          </div>
        ) : (
          <div className="profile-course-list">
            {courseSummaries.map((course) => {
              const wordProgress = (course.learnedWords / course.totalWords) * 100
              const learningProgress = (course.learningWords / course.totalWords) * 100
              const writingProgress = (course.writtenCharacters / course.totalCharacters) * 100

              return (
                <article key={course.id} className="profile-course-card">
                  <div className="profile-course-card-heading">
                    <div>
                      <span className="profile-course-status">Курс взят</span>
                      <h3>{course.name}</h3>
                    </div>
                    <button type="button" onClick={() => navigate(`/study/${course.id}/cards`)}>
                      Продолжить
                    </button>
                  </div>

                  <div className="course-progress-grid">
                    <ProgressIndicator
                      label="Всего слов"
                      value={course.totalWords}
                      detail="словарь курса"
                      percent={100}
                    />
                    <ProgressIndicator
                      label="Изучено"
                      value={`${course.learnedWords} / ${course.totalWords}`}
                      detail="отмечено «Знаю»"
                      percent={wordProgress}
                    />
                    <ProgressIndicator
                      label="На изучении"
                      value={course.learningWords}
                      detail="слов осталось"
                      percent={learningProgress}
                    />
                    <ProgressIndicator
                      label="Иероглифы"
                      value={`${course.writtenCharacters} / ${course.totalCharacters}`}
                      detail="выполнено в прописях"
                      percent={writingProgress}
                    />
                  </div>
                  <div className="profile-course-actions">
                    <div className="skill-indicators">{readSkillSummary(course.id).map((skill) => <div key={skill.skill}>
                      <span>{skill.label}</span><strong>{skill.successful} / {course.totalWords}</strong><progress value={skill.successful} max={course.totalWords} aria-label={`${course.name}: ${skill.label}`} />
                    </div>)}</div>
                    <button type="button" className="study-secondary" onClick={() => chooseCourseAction(course, 'reset')}>Сбросить прогресс</button>
                    <button type="button" className="profile-remove-course" onClick={() => chooseCourseAction(course, 'remove')}>Удалить курс из профиля</button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {courseAction && <StudyDialog title={courseAction.type === 'reset' ? `Сбросить прогресс ${courseAction.course.name}?` : `Удалить ${courseAction.course.name} из профиля?`} onClose={() => setCourseAction(null)}>
        <div className="study-options">
          <p>{courseAction.type === 'reset'
            ? 'Будут обнулены изученные слова, результаты прописей, попытки и очередь ANKI этого курса. Его слова будут удалены из дневника учёбы. Другие курсы и личные карточки не изменятся. Отменить сброс нельзя.'
            : 'Курс исчезнет из списка, его напоминания отключатся. Статистика и история останутся: если снова взять курс, обучение продолжится с прежнего места.'}</p>
          {actionError && <p className="study-error" role="alert">{actionError}</p>}
          <button type="button" className="profile-confirm-danger" onClick={confirmCourseAction}>{courseAction.type === 'reset' ? 'Да, сбросить прогресс' : 'Удалить из списка'}</button>
        </div>
      </StudyDialog>}

      <LearningPreferences />
      {onLogOut && <button type="button" className="study-secondary-button profile-log-out" onClick={onLogOut}>Выйти из профиля</button>}
      <PersonalCardsSummary user={user} />
      <PersonalFolderCourses user={user} />

      <aside className="profile-local-note">
        <strong>Выход не удаляет ваш прогресс.</strong> Пока профиль сохраняется только в этом браузере на этом устройстве; очистка данных браузера удалит локальную статистику.
        Личные карточки уже хранятся на сервере, а ключ доступа к ним — в этом браузере.
        Вход с паролем, Google и Яндексом и восстановление доступа появятся отдельно.
      </aside>
    </main>
  )
}
