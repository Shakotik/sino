import { useEffect, useRef, useState } from 'react'
import { ReadableText } from '../../components/ReadableText.jsx'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { loadHskCatalog } from '../../data/hskCatalogs'
import { findStudyLevel } from '../../data/studyDemo'
import { evaluateChineseAnswer, evaluateMeaningAnswer } from './answerEvaluation'
import { readKnownWordIds, recordStudyAttempt, setWordKnown } from './studyStorage'
import { usePageNavigation } from './usePageNavigation'
import './study-session.css'
import { markSkillMastered } from './learningInsights.js'
import { useSessionCompletion } from './useSessionCompletion.js'
import { ListeningPrompt } from './ListeningPrompt.jsx'

const modeNames = { meaning: 'Значение слова', typing: 'Ввод иероглифов', listening: 'Понимание на слух' }

function shuffledCopy(words) {
  const shuffled = [...words]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
  }
  return shuffled
}

function SemanticFeedback({ result }) {
  return (
    <div className="semantic-feedback">
      <div className="semantic-feedback-label"><span>Соответствие переводу</span><strong>{result.score} / 100</strong></div>
      <div className="semantic-match-track" role="meter" aria-label="Соответствие словарному переводу" aria-valuemin={0} aria-valuemax={100} aria-valuenow={result.score}>
        <span style={{ width: `${result.score}%` }} />
      </div>
      <p>{result.explanation}</p>
      <small>Оценка по словарным значениям и проверенным синонимам. Сходство букв помогает найти опечатку, но само по себе не подтверждает смысл. Это приблизительная шкала, а не точное измерение семантического расстояния.</small>
    </div>
  )
}

// A word is introduced, practiced, and then resolved exactly once. Retries are
// local to this component so they do not inflate the session's denominator.
function StudyWordExercise({ word, mode, isLearning, hints, onAttempt, onMastered, onFinish }) {
  const [phase, setPhase] = useState(isLearning ? 'introduction' : 'exercise')
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [hasListened, setHasListened] = useState(false)
  const [attemptNumber, setAttemptNumber] = useState(0)
  const firstAnswerRef = useRef(null)
  const masterySavedRef = useRef(false)
  const isComposingRef = useRef(false)
  const inputRef = useRef(null)
  const finishGuardRef = useRef(false)
  const meaning = word.translationRu ?? word.translationEn ?? ''

  useEffect(() => {
    if (phase === 'exercise') inputRef.current?.focus({ preventScroll: true })
  }, [phase, mode, attemptNumber])

  function receiveAnswer(result) {
    // Persist at the moment of verification. Leaving the page before clicking
    // "Next" must not discard a correct answer or its daily-calendar entry.
    if (!firstAnswerRef.current) {
      firstAnswerRef.current = result
      onAttempt(word, result)
    }
    if (result.correct && !masterySavedRef.current) {
      masterySavedRef.current = true
      onMastered(word)
    }
    setFeedback(result)
  }

  function submitAnswer(event) {
    event.preventDefault()
    if (isComposingRef.current || feedback || !answer.trim() || (mode === 'listening' && !hasListened)) return
    receiveAnswer(mode !== 'typing' ? evaluateMeaningAnswer(answer, meaning) : evaluateChineseAnswer(answer, word.hanzi))
  }

  function finishWord(skipped = false) {
    if (finishGuardRef.current) return
    finishGuardRef.current = true
    const firstAnswer = firstAnswerRef.current
    if (!firstAnswer) onAttempt(word, { correct: false, score: 0 })
    onFinish({
      word,
      correct: firstAnswer?.correct ?? false,
      score: firstAnswer?.score ?? 0,
      mastered: !skipped && feedback?.correct === true,
      skipped,
    })
  }

  function retryAnswer() {
    setAnswer('')
    setFeedback(null)
    setAttemptNumber((value) => value + 1)
  }

  if (phase === 'introduction') {
    return (
      <section className="study-exercise-panel study-introduction" aria-label="Знакомство со словом">
        <p className="study-step-label">Сначала запомните</p>
        <div className="study-large-hanzi" lang="zh"><ReadableText text={word.hanzi} /></div>
        <p className="study-word-pinyin">{word.pinyin}</p>
        <p className="study-word-meaning"><ReadableText text={meaning} /></p>
        <p className="study-help-text">{mode === 'listening' ? 'Дальше прослушайте слово без подсказки и вспомните его значение.' : mode === 'meaning' ? 'Дальше нужно будет вспомнить одно из значений слова.' : 'Дальше нужно будет ввести слово китайской клавиатурой.'}</p>
        <button type="button" className="study-primary-button" onClick={() => setPhase('exercise')}>Запомнил, к практике</button>
      </section>
    )
  }

  return (
    <section className="study-exercise-panel" aria-label="Упражнение со словом">
      <div className="study-prompt">
        <p className="study-step-label">{mode === 'listening' ? 'Прослушайте слово и введите значение на русском' : mode === 'meaning' ? 'Введите значение на русском' : 'Введите слово по-китайски'}</p>
        {mode === 'listening' ? <ListeningPrompt text={word.hanzi} onPlayed={() => setHasListened(true)} /> : mode === 'meaning' ? (
          <><div className="study-large-hanzi" lang="zh"><ReadableText text={word.hanzi} /></div>{isLearning && hints && <p className="study-word-pinyin">{word.pinyin}</p>}</>
        ) : (
          <><p className="study-word-meaning"><ReadableText text={meaning} /></p>{isLearning && hints && <p className="study-word-pinyin">{word.pinyin}</p>}</>
        )}
      </div>

      <form onSubmit={submitAnswer} className="study-answer-form">
        <label htmlFor="study-answer">{mode !== 'typing' ? 'Ваш перевод' : 'Ваш ответ иероглифами'}</label>
        <input
          ref={inputRef}
          id="study-answer"
          className={mode === 'typing' ? 'study-chinese-input' : ''}
          lang={mode === 'typing' ? 'zh' : 'ru'}
          value={answer}
          maxLength={200}
          disabled={Boolean(feedback)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={mode !== 'typing' ? 'Одно из значений…' : 'Введите иероглифы…'}
          onChange={(event) => setAnswer(event.target.value)}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || isComposingRef.current || event.keyCode === 229)) event.preventDefault()
          }}
        />
        {mode === 'typing' && !feedback && <small>Переключитесь на китайскую клавиатуру. Enter при выборе иероглифа не отправляет ответ.</small>}
        {!feedback && <button className="study-primary-button" type="submit" disabled={!answer.trim() || (mode === 'listening' && !hasListened)}>Проверить</button>}
      </form>

      {feedback && (
        <div className={`study-answer-feedback ${feedback.correct ? 'is-correct' : 'is-incorrect'}`} aria-live="polite">
          <strong>{feedback.correct ? 'Верно!' : 'Попробуем ещё раз'}</strong>
          {mode !== 'typing' ? <SemanticFeedback result={feedback} /> : <p>{feedback.explanation}</p>}
          {!feedback.correct && (
            <div className="study-dictionary-answer">
              <span>Словарный ответ</span>
              {mode !== 'meaning' && <strong lang="zh">{word.hanzi}</strong>}
              <p><ReadableText text={meaning} /></p>
              <small>Запомните ответ и попробуйте ещё раз. Результат первой попытки уже сохранён.</small>
            </div>
          )}
          {feedback.correct ? (
            <button type="button" className="study-primary-button" onClick={() => finishWord()}>Следующее слово</button>
          ) : (
            <button type="button" className="study-primary-button" onClick={retryAnswer}>Попробовать снова</button>
          )}
        </div>
      )}
      {!feedback?.correct && <button type="button" className="study-skip-button" onClick={() => finishWord(true)}>Пропустить и повторить позже</button>}
    </section>
  )
}

export function StudySession() {
  const { levelId, activity } = useParams()
  const [searchParams] = useSearchParams()
  // Existing learning/test links use the same writing implementation as the
  // dedicated course tile; no second engine with different scoring rules.
  if (searchParams.get('mode') === 'writing' && ['learning', 'knowledge'].includes(activity)) {
    const writingParams = new URLSearchParams(searchParams)
    writingParams.set('practice', activity === 'knowledge' ? 'memory' : 'learn')
    writingParams.set('start', '1')
    return <Navigate to={`/study/${levelId}/writing?${writingParams}`} replace />
  }
  const query = searchParams.toString()
  // A new route configuration gets a fresh session without clearing the
  // previous session through a chain of synchronous effect updates.
  return <StudySessionContent key={`${levelId}:${activity}:${query}`} levelId={levelId} activity={activity} query={query} />
}

function StudySessionContent({ levelId, activity, query }) {
  const searchParams = new URLSearchParams(query)
  const navigate = usePageNavigation()
  const level = findStudyLevel(levelId)
  const mode = Object.hasOwn(modeNames, searchParams.get('mode')) ? searchParams.get('mode') : 'meaning'
  const isLearning = activity === 'learning'
  const hints = isLearning && searchParams.get('hints') === '1'
  const [sessionWords, setSessionWords] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [wordIndex, setWordIndex] = useState(0)
  const [results, setResults] = useState([])
  const [round, setRound] = useState(0)

  useEffect(() => {
    let disposed = false
    const params = new URLSearchParams(query)
    loadHskCatalog(levelId).then(({ words }) => {
      if (disposed) return
      const knownIds = readKnownWordIds(levelId)
      const filter = params.get('filter')
      const filtered = words.filter((word) => (!params.get('word') || String(word.id) === params.get('word')) && (filter === 'learned' ? knownIds.has(word.id) : filter === 'unlearned' ? !knownIds.has(word.id) : true))
      const count = Math.min(100, Math.max(1, Number.parseInt(params.get('count'), 10) || 10))
      const ordered = params.get('order') === 'shuffle' ? shuffledCopy(filtered) : filtered
      setSessionWords(ordered.slice(0, count))
    }).catch(() => { if (!disposed) setLoadError(true) })
    return () => { disposed = true }
  }, [levelId, activity, query, loadAttempt])

  function finishWord(result) {
    setResults((previous) => [...previous, result])
    setWordIndex((index) => index + 1)
  }

  function recordFirstAnswer(word, result) {
    recordStudyAttempt(levelId, word, { mode, correct: result.correct, score: result.score, explanation: result.explanation })
  }

  function recordMasteredWord(word) {
    markSkillMastered(levelId, word.id, mode)
    setWordKnown(levelId, word, true)
  }

  function repeatWords(words) {
    setSessionWords(words)
    setResults([])
    setWordIndex(0)
    setRound((value) => value + 1)
  }

  const isFinished = sessionWords && sessionWords.length > 0 && wordIndex >= sessionWords.length
  useSessionCompletion(Boolean(isFinished))
  const missed = results.filter((result) => !result.correct)
  const firstTimeCorrect = results.filter((result) => result.correct).length
  const masteredCount = results.filter((result) => result.mastered).length

  return (
    <main className="study-session-shell">
      <button type="button" className="back-button" onClick={() => navigate(level ? `/study/${levelId}` : '/')}>
        ← {level ? `К разделам ${level.name}` : 'Все уровни'}
      </button>
      <header className="study-session-header">
        <p className="eyebrow">{level?.name ?? 'HSK'} · {isLearning ? 'Обучение' : 'Проверка знаний'}</p>
        <h1>{modeNames[mode]}</h1>
        <p>{isLearning ? 'Познакомьтесь со словом, затем закрепите его на практике.' : 'Вспомните ответы без образца. В конце можно повторить сложные слова.'}</p>
      </header>

      {loadError || !level || !['learning', 'knowledge'].includes(activity) ? (
        <section className="study-exercise-panel study-empty-state" role="alert">
          <p>Не удалось загрузить упражнение.</p>
          <button className="study-secondary-button" type="button" onClick={() => { setLoadError(false); setLoadAttempt((value) => value + 1) }}>Попробовать снова</button>
        </section>
      ) : !sessionWords ? <p role="status">Подготавливаем слова…</p> : sessionWords.length === 0 ? (
        <section className="study-exercise-panel study-empty-state">
          <h2>В этой подборке пока нет слов</h2><p>Выберите другую группу слов в настройках упражнения.</p>
          <button type="button" className="study-primary-button" onClick={() => navigate(`/study/${levelId}`)}>Выбрать упражнение</button>
        </section>
      ) : isFinished ? (
        <section className="study-exercise-panel study-session-results" aria-label="Результаты тренировки">
          <p className="study-step-label">Занятие завершено</p>
          <h2>{firstTimeCorrect} из {results.length} с первого раза</h2>
          <p>Закреплено: {masteredCount}. В том числе после повторной попытки: {results.filter((result) => result.mastered && !result.correct).length}.</p>
          <div className="study-session-progress" role="progressbar" aria-label="Правильные ответы с первой попытки" aria-valuemin={0} aria-valuemax={results.length} aria-valuenow={firstTimeCorrect}><span style={{ width: `${firstTimeCorrect / results.length * 100}%` }} /></div>
          <ul className="study-result-list">
            {results.map((result) => <li key={result.word.id}>
              <div><strong lang="zh"><ReadableText text={result.word.hanzi} /></strong><span><ReadableText text={`${result.word.pinyin} · ${result.word.translationRu ?? result.word.translationEn}`} /></span></div>
              <span className={result.correct ? 'study-result-success' : 'study-result-review'}>{result.unavailable ? 'Не загружено' : result.correct ? 'Верно' : result.mastered ? 'После повторения' : 'Повторить'}</span>
            </li>)}
          </ul>
          <div className="study-result-actions">
            {missed.length > 0 && <button type="button" className="study-primary-button" onClick={() => repeatWords(missed.map((result) => result.word))}>Повторить сложные слова ({missed.length})</button>}
            <button type="button" className="study-secondary-button" onClick={() => navigate(`/study/${levelId}`)}>К разделам курса</button>
          </div>
        </section>
      ) : (
        <>
          <div className="study-session-position"><span>Слово {wordIndex + 1} из {sessionWords.length}</span><span>{Math.round(wordIndex / sessionWords.length * 100)}%</span></div>
          <div className="study-session-progress" role="progressbar" aria-label="Прогресс занятия" aria-valuemin={0} aria-valuemax={sessionWords.length} aria-valuenow={wordIndex}><span style={{ width: `${wordIndex / sessionWords.length * 100}%` }} /></div>
          <StudyWordExercise key={`${round}-${sessionWords[wordIndex].id}`} word={sessionWords[wordIndex]} mode={mode} isLearning={isLearning} hints={hints} onAttempt={recordFirstAnswer} onMastered={recordMasteredWord} onFinish={finishWord} />
        </>
      )}
    </main>
  )
}
