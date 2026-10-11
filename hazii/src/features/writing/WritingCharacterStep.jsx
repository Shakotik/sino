import { useEffect, useRef, useState } from 'react'
import { HanziQuiz } from './HanziQuiz'
import { hideChineseExamples } from './writingPractice'

// Each step owns its canvas. Changing a phase unmounts the old writer completely:
// the template and the learner's previous strokes cannot leak into memory mode.
export function WritingCharacterStep({ step, onResult, onNext, nextLabel }) {
  const [status, setStatus] = useState('drawing')
  const [progress, setProgress] = useState({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [reviewingTemplate, setReviewingTemplate] = useState(false)
  const hadMistake = useRef(false)
  const completionGuard = useRef(false)
  const nextGuard = useRef(false)
  const headingRef = useRef(null)
  const guided = step.phase === 'trace' || reviewingTemplate

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])

  function receiveProgress(value) {
    // Clearing the drawing is not a new graded attempt and cannot erase errors.
    if (value.state === 'mistake') hadMistake.current = true
    setProgress(value)
  }

  function completeCharacter(mistakes) {
    if (completionGuard.current) return
    completionGuard.current = true
    if (guided) {
      setStatus('traced')
      return
    }
    const correct = mistakes === 0 && !hadMistake.current
    onResult(step, { correct })
    setStatus(correct ? 'correct' : 'retry')
  }

  function restart(useTemplate = false) {
    hadMistake.current = false
    completionGuard.current = false
    setReviewingTemplate(useTemplate)
    setStatus('drawing')
    setProgress({ state: 'loading' })
    setAttempt((value) => value + 1)
  }

  function next() {
    if (nextGuard.current) return
    nextGuard.current = true
    onNext()
  }

  function skip() {
    if (nextGuard.current) return
    if (step.phase === 'memory') onResult(step, { correct: false, skipped: true, unavailable: status === 'unavailable' })
    next()
  }

  function reviewTemplate() {
    // Asking for a template during a memory task is assistance, not a first-try
    // success. The learner must still complete a fresh hidden-target attempt.
    onResult(step, { correct: false })
    restart(true)
  }

  return <section className="study-exercise-panel writing-practice-panel" aria-label="Пропись иероглифа">
    <h2 ref={headingRef} tabIndex={-1} className="writing-phase-heading">{guided ? 'Обведите иероглиф' : 'Повторите без образца'}</h2>
    <p className="writing-practice-meaning"><ReadableText text={hideChineseExamples(step.word.translationRu ?? step.word.translationEn)} /></p>
    <p className="writing-practice-pinyin">{hideChineseExamples(step.word.pinyin)}</p>
    <p className="study-character-position">Слово {step.wordIndex + 1} · иероглиф {step.position + 1} из {step.wordLength}</p>
    <div className="writing-word-positions" aria-label={`Позиция ${step.position + 1} из ${step.wordLength}`}>
      {Array.from({ length: step.wordLength }, (_, index) => <span key={index} className={index === step.position ? 'is-current' : ''} aria-hidden="true">{index + 1}</span>)}
    </div>
    {status === 'unavailable' ? <div className="writing-step-feedback" role="alert">
      <strong>Не удалось загрузить порядок черт</strong>
      <p>Проверьте, что сервер сайта запущен. Без проверки написание не засчитывается.</p>
      <button type="button" className="study-primary-button" onClick={() => restart(reviewingTemplate)}>Загрузить снова</button>
    </div> : status === 'drawing' ? <>
      <div className="writing-practice-canvas">
        <HanziQuiz key={`${step.phase}-${attempt}`} character={step.character} guided={guided}
          onProgress={receiveProgress} onComplete={completeCharacter} onUnavailable={() => setStatus('unavailable')} />
      </div>
      {progress.state !== 'ready' && progress.state !== 'demonstrating' && <p className="study-writing-status" role="status">
        {progress.state === 'loading' && 'Готовим поле для письма…'}
        {progress.state === 'mistake' && 'Попробуйте ещё раз: важны форма, направление и порядок черт.'}
        {progress.state === 'drawing' && `Верно: ${progress.correctStrokes} из ${progress.totalStrokes} черт.`}
      </p>}
    </> : <div className={`writing-step-feedback ${status === 'retry' ? 'needs-practice' : ''}`} role="status">
      <span className="writing-feedback-symbol" aria-hidden="true">{status === 'retry' ? '↻' : '✓'}</span>
      <strong>{status === 'traced' ? 'Трафарет пройден' : status === 'correct' ? 'Написано по памяти!' : 'Получилось, теперь закрепим'}</strong>
      <p>{status === 'traced' ? 'Обводка помогает запомнить, но ещё не засчитывается как самостоятельное написание.' : status === 'correct' ? 'Форма, направление и порядок всех черт верны.' : 'Во время попытки были ошибки. Повторите без ошибок, чтобы закрепить иероглиф.'}</p>
      {status === 'traced' && reviewingTemplate
        ? <button type="button" className="study-primary-button" onClick={() => restart()}>Теперь по памяти</button>
        : status === 'retry'
          ? <button type="button" className="study-primary-button" onClick={() => restart()}>Повторить по памяти</button>
          : <button type="button" className="study-primary-button" onClick={next}>{nextLabel}</button>}
    </div>}
    {step.phase === 'memory' && !guided && ['drawing', 'retry'].includes(status) && <button type="button" className="study-secondary-button writing-template-help" onClick={reviewTemplate}>Не помню — изучить трафарет</button>}
    {step.phase === 'memory' && !['correct', 'traced'].includes(status) && <button type="button" className="study-skip-button" onClick={skip}>
      Пропустить и повторить позже
    </button>}
  </section>
}
import { ReadableText } from '../../components/ReadableText.jsx'
