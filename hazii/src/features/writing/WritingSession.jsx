import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadHskCatalog } from '../../data/hskCatalogs'
import { findStudyLevel } from '../../data/studyDemo'
import { usePageNavigation } from '../study/usePageNavigation'
import { HanziQuiz } from './HanziQuiz'
import { WritingCanvas } from './WritingCanvas'
import { analyzeWritingAttempt } from './writingEngine'
import { readProfileArray, writeProfileValue } from '../profile/profileStorage'

const initialQuizProgress = {
  state: 'loading',
  correctStrokes: 0,
  totalStrokes: null,
  mistakes: 0,
}

function describeQuizProgress(progress) {
  if (progress.state === 'loading') return 'Готовим скрытую проверку порядка штрихов…'
  if (progress.state === 'ready') return 'Начинайте писать: образец скрыт, но порядок штрихов проверяется.'
  if (progress.state === 'mistake') return `Этот штрих не совпал с ожидаемым. Ошибок: ${progress.mistakes}. Попробуйте ещё раз.`
  if (progress.state === 'drawing') {
    const total = progress.totalStrokes ? ` из ${progress.totalStrokes}` : ''
    return `Верных штрихов: ${progress.correctStrokes}${total}. Продолжайте.`
  }
  return 'Порядок штрихов подтверждён.'
}

function readCompletedAttempts(storageKey, validAttemptKeys) {
  try {
    const savedAttempts = readProfileArray(storageKey.replace(/^sino:/u, ''), storageKey)

    return new Set(savedAttempts.filter((attemptKey) => validAttemptKeys.has(attemptKey)))
  } catch {
    return new Set()
  }
}

function saveCompletedAttempts(storageKey, attemptKeys) {
  writeProfileValue(storageKey.replace(/^sino:/u, ''), [...attemptKeys])
}

export function WritingSession() {
  const { levelId } = useParams()
  const navigate = usePageNavigation()
  const level = findStudyLevel(levelId)
  const [catalog, setCatalog] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [wordIndex, setWordIndex] = useState(0)
  const [characterIndex, setCharacterIndex] = useState(0)
  const [writingAttempt, setWritingAttempt] = useState(() => analyzeWritingAttempt([]))
  const [practiceMode, setPracticeMode] = useState('quiz')
  const [quizProgress, setQuizProgress] = useState(initialQuizProgress)
  const [attemptSubmitted, setAttemptSubmitted] = useState(false)
  const [completedAttempts, setCompletedAttempts] = useState(new Set())
  const [isCourseFinished, setIsCourseFinished] = useState(false)

  const handleQuizProgress = useCallback((nextProgress) => {
    setQuizProgress(nextProgress)
  }, [])

  const handleQuizComplete = useCallback((mistakeCount) => {
    setQuizProgress({ state: 'complete', correctStrokes: null, totalStrokes: null, mistakes: mistakeCount })
    setAttemptSubmitted(true)
  }, [])

  const useFreeWritingFallback = useCallback(() => {
    setPracticeMode('freehand')
    setQuizProgress({ ...initialQuizProgress, state: 'unavailable' })
  }, [])

  useEffect(() => {
    let isCurrentCourse = true

    loadHskCatalog(levelId)
      .then((nextCatalog) => {
        if (!isCurrentCourse) return

        const validAttemptKeys = new Set(nextCatalog.words.flatMap((word) => (
          Array.from(word.hanzi).map((_, index) => `${word.id}-${index}`)
        )))
        const storageKey = `sino:writing:${levelId}:completed-attempts`

        setCatalog(nextCatalog)
        setCompletedAttempts(readCompletedAttempts(storageKey, validAttemptKeys))
      })
      .catch(() => {
        if (isCurrentCourse) setLoadError(true)
      })

    return () => {
      isCurrentCourse = false
    }
  }, [levelId])

  const totalCharacters = useMemo(() => (
    catalog ? catalog.words.reduce((total, word) => total + Array.from(word.hanzi).length, 0) : 0
  ), [catalog])

  if (!level || loadError) {
    return (
      <main className="writing-session-shell">
        <button className="back-button" type="button" onClick={() => navigate('/writing')}>
          ← К прописям
        </button>
        <p className="course-selection">Не удалось открыть этот набор прописей.</p>
      </main>
    )
  }

  if (!catalog) {
    return (
      <main className="writing-session-shell">
        <button className="back-button" type="button" onClick={() => navigate('/writing')}>
          ← К прописям
        </button>
        <p className="course-selection">Готовим прописи {level.name}…</p>
      </main>
    )
  }

  const activeWord = catalog.words[wordIndex]
  const charactersInWord = Array.from(activeWord.hanzi)
  const attemptKey = `${activeWord.id}-${characterIndex}`
  const storageKey = `sino:writing:${levelId}:completed-attempts`
  const meaning = activeWord.translationRu ?? activeWord.translationEn
  const meaningLabel = activeWord.translationRu ? 'Значение' : 'Meaning (English)'
  const completedCharactersBeforeActiveWord = catalog.words
    .slice(0, wordIndex)
    .reduce((total, word) => total + Array.from(word.hanzi).length, 0)
  const sessionProgress = (completedCharactersBeforeActiveWord + characterIndex) / totalCharacters * 100

  function submitAttempt() {
    if (!writingAttempt.isReady) return
    setAttemptSubmitted(true)
  }

  function continuePractice() {
    // Free drawing is useful when the checker is offline, but is not evidence
    // of correct stroke order and must not increase verified profile progress.
    if (practiceMode === 'quiz') {
      const nextAttempts = new Set(completedAttempts)
      nextAttempts.add(attemptKey)
      saveCompletedAttempts(storageKey, nextAttempts)
      setCompletedAttempts(nextAttempts)
    }

    const isLastCharacterInWord = characterIndex === charactersInWord.length - 1
    const isLastWordInCourse = wordIndex === catalog.words.length - 1

    if (!isLastCharacterInWord) {
      setCharacterIndex((currentIndex) => currentIndex + 1)
    } else if (!isLastWordInCourse) {
      setWordIndex((currentIndex) => currentIndex + 1)
      setCharacterIndex(0)
    } else {
      setIsCourseFinished(true)
    }

    setWritingAttempt(analyzeWritingAttempt([]))
    setPracticeMode('quiz')
    setQuizProgress(initialQuizProgress)
    setAttemptSubmitted(false)
  }

  return (
    <main className="writing-session-shell">
      <button className="back-button" type="button" onClick={() => navigate('/writing')}>
        ← Все прописи
      </button>

      <header className="writing-session-header">
        <p className="eyebrow">{level.name} · Прописи</p>
        <h1>Напишите иероглиф по памяти</h1>
        <p>Ответ намеренно скрыт. Тренажёр проверяет форму и порядок штрихов, а затем открывает новую чистую клетку для следующего знака.</p>
      </header>

      <section className="writing-progress" aria-label="Прогресс упражнения">
        <div>
          <span>Слово {wordIndex + 1} из {catalog.meta.totalWords}</span>
          <strong>Иероглиф {characterIndex + 1} из {charactersInWord.length}</strong>
        </div>
        <div className="writing-progress-track" aria-hidden="true">
          <span style={{ width: `${sessionProgress}%` }} />
        </div>
      </section>

      <section className="writing-prompt" aria-label="Подсказка к написанию">
        <span className="writing-prompt-label">Чтение слова</span>
        <strong className="writing-pinyin">{activeWord.pinyin}</strong>
        <span className="writing-prompt-label">{meaningLabel}</span>
        <p>{meaning}</p>
      </section>

      <section className="writing-workspace" aria-label="Поле для прописывания">
        {practiceMode === 'quiz' ? (
          <HanziQuiz
            key={attemptKey}
            character={charactersInWord[characterIndex]}
            onProgress={handleQuizProgress}
            onComplete={handleQuizComplete}
            onUnavailable={useFreeWritingFallback}
          />
        ) : (
          <WritingCanvas key={attemptKey} onAttemptChange={setWritingAttempt} />
        )}

        {!attemptSubmitted && !isCourseFinished && (
          <div className={`writing-attempt-status ${(practiceMode === 'quiz' && quizProgress.state === 'complete') || writingAttempt.isReady ? 'is-ready' : ''}`} aria-live="polite">
            <div>
              <span>
                {practiceMode === 'quiz'
                  ? `Ошибок: ${quizProgress.mistakes}`
                  : `Штрихов: ${writingAttempt.strokeCount}`}
              </span>
              <strong>
                {practiceMode === 'quiz'
                  ? 'Проверка порядка'
                  : writingAttempt.isReady ? 'Попытка готова' : 'Резервный режим'}
              </strong>
            </div>
            <p>{practiceMode === 'quiz' ? describeQuizProgress(quizProgress) : writingAttempt.hint}</p>
          </div>
        )}

        {isCourseFinished ? (
          <div className="writing-feedback" role="status">
            <strong>Все попытки в этом проходе завершены</strong>
            <p>Можно вернуться к выбору HSK и начать следующую тренировку.</p>
            <button className="writing-primary-action" type="button" onClick={() => navigate('/writing')}>
              Выбрать уровень
            </button>
          </div>
        ) : attemptSubmitted ? (
          <div className="writing-feedback" role="status">
            <strong>{practiceMode === 'quiz' ? 'Иероглиф проверен' : 'Свободная практика без оценки'}</strong>
            <p>
              {practiceMode === 'quiz'
                ? `Порядок штрихов подтверждён. Ошибок в этой попытке: ${quizProgress.mistakes}.`
                : `Записано движений: ${writingAttempt.strokeCount}. Проверка недоступна; прогресс не увеличен.`}
              {' '}Следующий иероглиф откроется в новой пустой клетке — без показа правильного ответа.
            </p>
            <button className="writing-primary-action" type="button" onClick={continuePractice}>
              {characterIndex < charactersInWord.length - 1 ? 'Следующий иероглиф' : 'Следующее слово'}
            </button>
          </div>
        ) : practiceMode === 'freehand' ? (
          <button className="writing-primary-action" type="button" disabled={!writingAttempt.isReady} onClick={submitAttempt}>
            Закончить свободную попытку
          </button>
        ) : null}
      </section>

      <p className="writing-session-note">
        Выполнено попыток: {completedAttempts.size} из {totalCharacters}. Прогресс пока хранится
        только в этом браузере.
      </p>
    </main>
  )
}
