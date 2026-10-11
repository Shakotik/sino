import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { StudyDialog } from '../../components/StudyDialog'
import { loadHskCatalog } from '../../data/hskCatalogs'
import { findStudyLevel } from '../../data/studyDemo'
import { CourseSettingsForm } from '../study/CourseSettingsForm'
import { filterStudyWords, readCourseSettings, readKnownWordIds, recordStudyAttempt, recordVerifiedWritingWord, saveCourseSettings, setWordKnown } from '../study/studyStorage'
import { usePageNavigation } from '../study/usePageNavigation'
import { WritingCharacterStep } from './WritingCharacterStep'
import { createWritingPlan, getWordCharacters, getWritingWordResult, normalizeWritingOptions, recordCharacterResult } from './writingPractice'
import '../study/study-session.css'
import './writing-practice.css'
import { markSkillMastered } from '../study/learningInsights.js'
import { useSessionCompletion } from '../study/useSessionCompletion.js'

function selectLessonWords(words, options, knownIds) {
  const selection = filterStudyWords(words, options.filter, knownIds).filter((word) => getWordCharacters(word).length > 0)
  if (options.order === 'shuffle') {
    for (let index = selection.length - 1; index > 0; index -= 1) {
      const otherIndex = Math.floor(Math.random() * (index + 1))
      ;[selection[index], selection[otherIndex]] = [selection[otherIndex], selection[index]]
    }
  }
  return selection.slice(0, options.count)
}

// Old bookmarks still work, but always pass through the new course settings.
export function LegacyWritingRedirect() {
  const { levelId } = useParams()
  return <Navigate to={levelId ? `/study/${levelId}/writing` : '/'} replace />
}

export function CourseWritingSession() {
  const { levelId } = useParams()
  const [params] = useSearchParams()
  return <WritingSessionPage key={`${levelId}:${params}`} levelId={levelId} query={params.toString()} />
}

function WritingSessionPage({ levelId, query }) {
  const level = findStudyLevel(levelId)
  const navigate = usePageNavigation()
  const params = new URLSearchParams(query)
  const started = params.get('start') === '1'
  const options = normalizeWritingOptions({
    practice: params.get('practice'), batchSize: params.get('batch'),
    count: params.get('count'), filter: params.get('filter'), order: params.get('order'),
  })
  const [lesson, setLesson] = useState(null)
  const [error, setError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [characterResults, setCharacterResults] = useState({})
  const [round, setRound] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(!started)
  // Refs protect synchronous completion callbacks from double persistence and
  // keep results available before React renders the next character.
  const resultsRef = useRef({})
  const savedAttempts = useRef(new Set())
  const savedMastery = useRef(new Set())

  useEffect(() => {
    if (!started || !level) return
    let disposed = false
    const requested = new URLSearchParams(query)
    const settings = normalizeWritingOptions({
      practice: requested.get('practice'), batchSize: requested.get('batch'),
      count: requested.get('count'), filter: requested.get('filter'), order: requested.get('order'),
    })
    loadHskCatalog(levelId).then(({ words }) => {
      if (disposed) return
      const requestedWords = requested.get('word') ? words.filter((word) => String(word.id) === requested.get('word')) : words
      const selectedWords = selectLessonWords(requestedWords, settings, readKnownWordIds(levelId))
      setLesson({ words: selectedWords, ...createWritingPlan(selectedWords, settings) })
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [levelId, level, query, started, loadAttempt])

  function startLesson(settings) {
    const saved = saveCourseSettings(levelId, settings)
    const next = new URLSearchParams({
      start: '1', practice: saved.writingPractice, batch: String(saved.writingBatchSize),
      count: String(saved.count), filter: saved.filter, order: saved.order,
    })
    // The same options can start a new lesson after the results screen. A URL
    // change alone would leave the old session mounted when the query matches.
    resultsRef.current = {}
    savedAttempts.current = new Set()
    savedMastery.current = new Set()
    setCharacterResults({})
    setStepIndex(0)
    setRound((value) => value + 1)
    setLesson(null)
    setError(false)
    setLoadAttempt((value) => value + 1)
    setSettingsOpen(false)
    navigate(`/study/${levelId}/writing?${next}`)
  }

  function receiveResult(step, attemptResult) {
    const updated = {
      ...resultsRef.current,
      [step.id]: recordCharacterResult(resultsRef.current[step.id], attemptResult),
    }
    resultsRef.current = updated
    setCharacterResults(updated)
    const outcome = getWritingWordResult(step.word, updated)
    if (outcome.resolved && !savedAttempts.current.has(step.word.id)) {
      savedAttempts.current.add(step.word.id)
      recordStudyAttempt(levelId, step.word, { mode: 'writing', correct: outcome.firstTryCorrect, score: outcome.score })
    }
    if (outcome.mastered && !savedMastery.current.has(step.word.id)) {
      savedMastery.current.add(step.word.id)
      recordVerifiedWritingWord(levelId, step.word)
      markSkillMastered(levelId, step.word.id, 'writing')
      setWordKnown(levelId, step.word, true)
    }
  }

  function repeatWords(words) {
    resultsRef.current = {}
    savedAttempts.current = new Set()
    savedMastery.current = new Set()
    setCharacterResults({})
    setStepIndex(0)
    setRound((value) => value + 1)
    setLesson({ words, ...createWritingPlan(words, options) })
  }

  const step = lesson?.steps[stepIndex]
  const nextStep = lesson?.steps[stepIndex + 1]
  const finished = lesson?.steps.length > 0 && !step
  useSessionCompletion(Boolean(finished))
  const wordResults = lesson?.words.map((word) => ({ word, ...getWritingWordResult(word, characterResults) })) ?? []
  const masteredCharacters = Object.values(characterResults).filter((result) => result.mastered).length
  const missedWords = wordResults.filter((result) => !result.firstTryCorrect).map((result) => result.word)
  const nextLabel = !nextStep ? 'Посмотреть результат'
    : step.phase === 'trace' && nextStep.phase === 'memory' ? 'Убрать трафарет — написать по памяти'
      : step.phase === 'memory' && nextStep.phase === 'trace' ? 'Следующая серия'
        : 'Следующий иероглиф'

  return <main className="study-session-shell">
    <button type="button" className="back-button" onClick={() => navigate(level ? `/study/${levelId}` : '/')}>← {level ? `К разделам ${level.name}` : 'Все уровни'}</button>
    <header className="study-session-header">
      <p className="eyebrow">{level?.name ?? 'HSK'} · Прописи</p>
      <h1>{options.practice === 'memory' ? 'Проверка написания' : 'Изучение написания'}</h1>
      <p>{options.practice === 'memory' ? 'Вспомните и напишите каждый иероглиф на пустом поле.' : 'Сначала по трафарету, затем — по памяти. В своём темпе, по одному иероглифу.'}</p>
    </header>
    {!level || error ? <section className="study-exercise-panel study-empty-state" role="alert">
      <p>{level ? 'Не удалось загрузить слова курса.' : 'Такого курса пока нет.'}</p>
      {level && <button type="button" className="study-primary-button" onClick={() => { setError(false); setLoadAttempt((value) => value + 1) }}>Попробовать снова</button>}
    </section> : !started ? <section className="study-exercise-panel study-empty-state">
      <p>Выберите режим, количество слов и длину серии перед занятием.</p>
      <button type="button" className="study-primary-button" onClick={() => setSettingsOpen(true)}>Настроить прописи</button>
    </section> : !lesson ? <p role="status">Подготавливаем занятие…</p>
      : !lesson.steps.length ? <section className="study-exercise-panel study-empty-state">
        <h2>В этой подборке пока нет слов</h2><p>Выберите другую группу в настройках.</p>
        <button type="button" className="study-primary-button" onClick={() => setSettingsOpen(true)}>Изменить настройки</button>
      </section> : finished ? <section className="study-exercise-panel study-session-results" aria-label="Результаты прописей">
        <p className="study-step-label">Занятие завершено</p>
        <h2>По памяти: {masteredCharacters} из {lesson.characters.length} иероглифов</h2>
        <p>Полностью написано слов: {wordResults.filter((result) => result.mastered).length} из {lesson.words.length}. С первой попытки: {wordResults.filter((result) => result.firstTryCorrect).length}.</p>
        <p>Пропущенные задания и обводка не увеличивают прогресс. Слова с повторяющимися знаками учитывают каждую позицию отдельно.</p>
        <ul className="study-result-list">{wordResults.map((result) => <li key={result.word.id}>
          <div><strong lang="zh">{result.word.hanzi}</strong><span>{result.word.pinyin} · {result.word.translationRu ?? result.word.translationEn}</span></div>
          <span className={result.mastered ? 'study-result-success' : 'study-result-review'}>{result.firstTryCorrect ? 'С первого раза' : result.mastered ? 'После повторения' : 'Повторить'}</span>
        </li>)}</ul>
        <div className="study-result-actions">
          {missedWords.length > 0 && <button type="button" className="study-primary-button" onClick={() => repeatWords(missedWords)}>Повторить сложные слова</button>}
          <button type="button" className="study-secondary-button" onClick={() => setSettingsOpen(true)}>Новое занятие</button>
          <button type="button" className="study-secondary-button" onClick={() => navigate(`/study/${levelId}`)}>К разделам курса</button>
        </div>
      </section> : <>
        <div className="study-session-position"><span>Серия {step.batchIndex + 1} из {Math.ceil(lesson.characters.length / options.batchSize)} · знак {step.batchPosition + 1} из {step.batchLength}</span><span>{stepIndex} / {lesson.steps.length} шагов</span></div>
        <div className="study-session-progress" role="progressbar" aria-label="Прогресс прописей" aria-valuemin={0} aria-valuemax={lesson.steps.length} aria-valuenow={stepIndex}><span style={{ width: `${stepIndex / lesson.steps.length * 100}%` }} /></div>
        <WritingCharacterStep key={`${round}-${stepIndex}`} step={step} onResult={receiveResult} onNext={() => setStepIndex((value) => value + 1)} nextLabel={nextLabel} />
        <p className="writing-lesson-summary">В занятии: {lesson.words.length} слов · {lesson.characters.length} иероглифов. Самостоятельно написано: {masteredCharacters}.</p>
      </>}
    {settingsOpen && level && <StudyDialog title={`Прописи · ${level.name}`} onClose={() => setSettingsOpen(false)}>
      <CourseSettingsForm section="writing" initialSettings={{
        ...readCourseSettings(levelId),
        ...(started ? { writingPractice: options.practice, writingBatchSize: options.batchSize, count: options.count, filter: options.filter, order: options.order } : {}),
      }} onStart={startLesson} />
    </StudyDialog>}
  </main>
}
