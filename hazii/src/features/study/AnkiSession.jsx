import { useEffect, useState } from 'react'
import { ReadableText } from '../../components/ReadableText.jsx'
import { useParams, useSearchParams } from 'react-router-dom'
import { loadHskCatalog } from '../../data/hskCatalogs'
import { findStudyLevel } from '../../data/studyDemo'
import { readAnkiSchedule, reviewAnkiWord } from './ankiStorage'
import { buildReviewQueue, describeInterval, scheduleReview } from './ankiScheduler'
import { filterStudyWords, readCourseSettings, readKnownWordIds, setWordKnown, recordStudyAttempt } from './studyStorage'
import { usePageNavigation } from './usePageNavigation'
import { useSessionCompletion } from './useSessionCompletion.js'

const grades = [['again', 'Снова'], ['hard', 'Трудно'], ['good', 'Хорошо'], ['easy', 'Легко']]

export function AnkiSession() {
  const { levelId } = useParams()
  const [params] = useSearchParams()
  const navigate = usePageNavigation()
  const level = findStudyLevel(levelId)
  const [words, setWords] = useState(null)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [reload, setReload] = useState(0)
  const [sessionTime] = useState(() => Date.now())
  const count = Math.max(1, Math.min(100, Number(params.get('count')) || 10))
  const filter = params.get('filter') || 'all'
  const dueOnly = params.get('due') === '1'
  useEffect(() => {
    let active = true
    loadHskCatalog(levelId).then((catalog) => {
      if (!active) return
      const settings = readCourseSettings(levelId)
      const selected = filterStudyWords(catalog.words, filter, readKnownWordIds(levelId))
      setWords(buildReviewQueue(selected, readAnkiSchedule(levelId), { limit: count, newPerDay: dueOnly ? 0 : settings.newPerDay }))
      setIndex(0); setRevealed(false); setError('')
    }).catch(() => { if (active) setError('Не удалось загрузить карточки. Попробуйте ещё раз.') })
    return () => { active = false }
  }, [levelId, count, filter, reload, dueOnly])

  const word = words?.[index]
  useSessionCompletion(Boolean(words?.length && !word))
  const schedule = readAnkiSchedule(levelId)
  const nextDue = Object.values(schedule).filter((entry) => Date.parse(entry.dueAt) > sessionTime).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]

  function gradeWord(grade) {
    if (!revealed || !word) return
    reviewAnkiWord(levelId, word.id, grade)
    const correct = grade === 'good' || grade === 'easy'
    setWordKnown(levelId, word, correct)
    recordStudyAttempt(levelId, word, { mode: 'anki', correct, score: correct ? 100 : grade === 'hard' ? 50 : 0 })
    setRevealed(false)
    setIndex((current) => current + 1)
  }

  return <main className="course-shell">
    <button className="back-button" onClick={() => navigate(`/study/${levelId}`)}>← К разделам {level?.name || ''}</button>
    <header className="course-header"><p className="eyebrow">{level?.name} · ANKI</p><h1>Вспомнить вовремя</h1><p className="course-subtitle">Сначала вспомните значение, затем откройте ответ и оцените себя.</p></header>
    {error ? <div className="study-status"><p role="alert">{error}</p><button className="study-secondary" onClick={() => setReload((value) => value + 1)}>Повторить загрузку</button></div> : !words ? <p role="status">Готовим очередь повторения…</p> : word ? <section className="anki-surface" aria-label="Интервальное повторение">
      <p className="study-note">Карточка {index + 1} из {words.length} · {schedule[word.id] ? 'Повторение' : 'Новое слово'}</p>
      <h2 className="anki-word" lang="zh"><ReadableText text={word.hanzi} /></h2><p className="pinyin">{word.pinyin}</p>
      {!revealed ? <button className="study-primary" onClick={() => setRevealed(true)}>Показать ответ</button> : <>
        <p className="anki-meaning" aria-live="polite"><ReadableText text={word.translationRu || word.translationEn} /></p>
        <div className="anki-actions">{grades.map(([grade, label]) => <button key={grade} className={`is-${grade}`} onClick={() => gradeWord(grade)}>{label}<small>{describeInterval(scheduleReview(schedule[word.id], grade, sessionTime).intervalDays)}</small></button>)}</div>
      </>}
    </section> : <section className="anki-surface" role="status">
      <h2>{index > 0 ? 'Занятие завершено' : 'Сейчас очередь пуста'}</h2>
      <p>{index > 0 ? `Повторено слов: ${index}. Новые даты сохранены.` : 'Слова из выбранной группы ещё не подошли к повторению или достигнут лимит новых слов на сегодня.'}</p>
      {nextDue && <p>Следующее повторение: {new Date(nextDue.dueAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}.</p>}
      <button className="study-secondary" onClick={() => setReload((value) => value + 1)}>Проверить очередь</button>
    </section>}
    <p className="study-note">Интервалы хранятся для этого профиля в браузере. Это режим повторения Sino по принципу ANKI, без синхронизации с AnkiWeb.</p>
  </main>
}
