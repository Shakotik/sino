import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { findStudyLevel } from '../../data/studyDemo'
import { StudyDialog } from '../../components/StudyDialog'
import { CourseSettingsForm } from './CourseSettingsForm'
import { readKnownWordIds, getLearningStreak, readCourseSettings, saveCourseSettings } from './studyStorage'
import { getDueCount } from './ankiStorage'
import { usePageNavigation } from './usePageNavigation'
import { readSavedLocalProfiles } from '../profile/localProfile'
import { OfflineCourseDownload } from '../offline/OfflineCourseDownload.jsx'

const courseSections = [
  { id: 'cards', title: 'Карточки слов', description: 'Знакомый тренажёр: слово, перевод и ваш прогресс.' },
  { id: 'writing', title: 'Прописи', description: 'Обведите по трафарету, затем повторите по памяти.' },
  { id: 'learning', title: 'Обучение', description: 'Перевод, ввод с клавиатуры и порядок черт.' },
  { id: 'knowledge', title: 'Проверка знаний', description: 'Вспомните слово самостоятельно и оцените результат.' },
  { id: 'anki', title: 'ANKI', description: 'Интервальное повторение в подходящий момент.' },
  { id: 'words', title: 'Список слов', description: 'Поиск по словам, пиньиню и русскому переводу.' },
  { id: 'settings', title: 'Настройки', description: 'Размер занятия, подсказки и напоминания.' },
  { id: 'personal', title: 'Создавать свои карточки', description: 'Собственные слова и отдельная статистика в профиле.' },
]

export function HskCourseHub({ user, onEnroll }) {
  const { levelId } = useParams()
  const navigate = usePageNavigation()
  const [selectedSectionId, setSelectedSectionId] = useState(null)
  const [savedMessage, setSavedMessage] = useState('')
  const [knownIds, setKnownIds] = useState(() => readKnownWordIds(levelId))
  const level = findStudyLevel(levelId)
  const selectedSection = courseSections.find((section) => section.id === selectedSectionId)
  const hasCourse = user?.enrolledCourseIds.includes(levelId)
  const canResumeProfile = !user && readSavedLocalProfiles().length > 0
  useEffect(() => {
    function refresh() { setKnownIds(readKnownWordIds(levelId)) }
    refresh()
    window.addEventListener('sino:progress-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('sino:progress-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [levelId, user?.id])

  if (!level) return <main className="course-shell"><button className="back-button" onClick={() => navigate('/')}>← Все уровни</button><p>Такого курса пока нет.</p></main>
  const learnedCount = Math.min(knownIds.size, level.totalWords)
  const courseStats = [
    { value: learnedCount, label: 'слов освоено' },
    { value: level.totalWords - learnedCount, label: 'слов на изучении' },
    { value: getLearningStreak(), label: 'дней подряд' },
  ]

  function startSection(settings) {
    saveCourseSettings(levelId, settings)
    if (selectedSectionId === 'settings') {
      setSavedMessage('Настройки курса сохранены.')
      setSelectedSectionId(null)
      return
    }
    if (selectedSectionId === 'personal') { navigate('/my-cards'); return }
    const isWriting = selectedSectionId === 'writing' || (['learning', 'knowledge'].includes(selectedSectionId) && settings.mode === 'writing')
    const params = new URLSearchParams({ mode: settings.mode, filter: settings.filter, count: String(settings.count), order: settings.order, hints: settings.hints ? '1' : '0' })
    if (isWriting) {
      params.set('practice', selectedSectionId === 'knowledge' ? 'memory' : selectedSectionId === 'learning' ? 'learn' : settings.writingPractice)
      params.set('batch', String(settings.writingBatchSize))
      params.set('start', '1')
      navigate(`/study/${levelId}/writing?${params}`)
      return
    }
    navigate(`/study/${levelId}/${selectedSectionId}?${params}`)
  }

  return (
    <main className="course-shell">
      <button className="back-button" type="button" onClick={() => navigate('/')}>← Все уровни</button>
      <header className="course-header"><p className="eyebrow">Курс {level.name}</p><h1>Тренажёр словарного запаса</h1><p className="course-subtitle">{level.name}</p></header>
      <section className="course-enrollment" aria-label="Доступ к курсу">
        <div>
          <span className="course-enrollment-label">{hasCourse ? 'Ваш курс' : 'Добавьте в профиль'}</span>
          <strong>{hasCourse ? `${level.name} уже в личном кабинете` : `${level.name} · ${level.totalWords} слов`}</strong>
          <p>{hasCourse ? 'Прогресс по словам и прописям отражается в личном кабинете.' : user ? 'Добавьте курс, чтобы отслеживать его прогресс в личном кабинете.' : canResumeProfile ? 'Выход не удаляет статистику. Вернитесь в сохранённый профиль, чтобы увидеть свой прогресс.' : 'Создайте профиль, чтобы вести личную историю обучения.'}</p>
        </div>
        <button className={`course-enrollment-button ${hasCourse ? 'is-added' : ''}`} type="button" onClick={() => hasCourse ? navigate('/profile') : user ? onEnroll(level.id) : navigate('/profile')}>
          {hasCourse ? 'Открыть профиль' : user ? 'Взять курс' : canResumeProfile ? 'Вернуться в профиль' : 'Создать профиль'}
        </button>
      </section>
      <section className="course-stats" aria-label={`Прогресс по ${level.name}`}>
        {courseStats.map((stat) => <div key={stat.label} className="course-stat"><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
      </section>
      <section className="course-sections" aria-label={`Разделы курса ${level.name}`}>
        {courseSections.map((section) => (
          <button key={section.id} className="course-section-card" type="button" onClick={() => { setSavedMessage(''); setSelectedSectionId(section.id) }}>
            <h2>{section.title}</h2><p>{section.description}</p>
            {section.id === 'anki' && getDueCount(levelId) > 0 && <small className="study-note">Пора повторить: {getDueCount(levelId)}</small>}
          </button>
        ))}
      </section>
      <OfflineCourseDownload key={levelId} levelId={levelId} />
      {savedMessage && <p className="study-status" role="status">{savedMessage}</p>}
      {selectedSection && <StudyDialog title={selectedSection.title} onClose={() => setSelectedSectionId(null)}>
        {selectedSectionId === 'cards' ? <div className="card-filter-options">
          {[['learned', 'Изученные слова', learnedCount], ['unlearned', 'Неизученные слова', level.totalWords - learnedCount], ['all', 'Все слова', level.totalWords]].map(([filter, label, count]) => (
            <button key={filter} type="button" className="card-filter-option" onClick={() => navigate(`/study/${levelId}/cards?filter=${filter}`)}><span>{label}</span><strong>{count}</strong></button>
          ))}
        </div> : <CourseSettingsForm section={selectedSectionId} levelId={levelId} initialSettings={readCourseSettings(levelId)} onStart={startSection} user={user} />}
      </StudyDialog>}
    </main>
  )
}
