import { useEffect, useRef, useState } from 'react'
import HanziWriter from 'hanzi-writer'
import { demonstrateStrokeOrder } from './strokeDemonstration'
import { normalizeWritingColor } from './writingColors.js'

const CHARACTER_LOAD_TIMEOUT_MS = 15000

function getQuizPalette() {
  const pageStyles = window.getComputedStyle(document.documentElement)
  return {
    drawingColor: normalizeWritingColor(pageStyles.getPropertyValue('--writing-ink')) || '#24342e',
    highlightColor: normalizeWritingColor(pageStyles.getPropertyValue('--accent')) || '#c96f55',
    outlineColor: normalizeWritingColor(pageStyles.getPropertyValue('--writing-guide')) || '#a9b7ad',
  }
}

// Callbacks live in refs so parent state changes never recreate the drawing.
// Hidden targets are the default. Guided outlines are opt-in for learning.
export function HanziQuiz({ character, onProgress, onComplete, onUnavailable, guided = false }) {
  const quizTargetRef = useRef(null)
  const writerRef = useRef(null)
  const startQuizRef = useRef(null)
  const demonstrateRef = useRef(null)
  const callbacksRef = useRef({ onProgress, onComplete, onUnavailable })
  const [loadedCharacter, setLoadedCharacter] = useState(null)
  const [isComplete, setIsComplete] = useState(false)
  const [isDemonstrating, setIsDemonstrating] = useState(false)
  const isReady = loadedCharacter === character

  useEffect(() => {
    callbacksRef.current = { onProgress, onComplete, onUnavailable }
  }, [onProgress, onComplete, onUnavailable])

  useEffect(() => {
    let isDisposed = false
    let hasLoadFailed = false
    let demonstrationRunning = false
    const quizTarget = quizTargetRef.current
    const palette = getQuizPalette()
    writerRef.current = null
    callbacksRef.current.onProgress?.({ state: 'loading', correctStrokes: 0, totalStrokes: null, mistakes: 0 })

    function failLoading() {
      if (isDisposed || hasLoadFailed) return
      hasLoadFailed = true
      setLoadedCharacter(null)
      callbacksRef.current.onUnavailable?.()
    }

    const loadTimeout = window.setTimeout(failLoading, CHARACTER_LOAD_TIMEOUT_MS)

    function startQuiz() {
      const writer = writerRef.current
      if (!writer || isDisposed) return
      writer.cancelQuiz()
      writer.hideCharacter({ duration: 0 })
      if (guided) writer.showOutline({ duration: 0 })
      else writer.hideOutline({ duration: 0 })
      setIsComplete(false)
      callbacksRef.current.onProgress?.({ state: 'ready', correctStrokes: 0, totalStrokes: null, mistakes: 0 })
      writer.quiz({
        acceptBackwardsStrokes: false,
        highlightOnComplete: false,
        leniency: 0.55,
        markStrokeCorrectAfterMisses: false,
        showHintAfterMisses: guided ? 2 : false,
        onMistake: ({ strokeNum, totalMistakes }) => {
          if (isDisposed) return
          callbacksRef.current.onProgress?.({ state: 'mistake', correctStrokes: strokeNum, totalStrokes: null, mistakes: totalMistakes })
        },
        onCorrectStroke: ({ strokeNum, strokesRemaining, totalMistakes }) => {
          if (isDisposed) return
          callbacksRef.current.onProgress?.({
            state: 'drawing',
            correctStrokes: strokeNum + 1,
            totalStrokes: strokeNum + strokesRemaining + 1,
            mistakes: totalMistakes,
          })
        },
        onComplete: ({ totalMistakes }) => {
          if (isDisposed) return
          setIsComplete(true)
          callbacksRef.current.onProgress?.({ state: 'complete', correctStrokes: null, totalStrokes: null, mistakes: totalMistakes })
          callbacksRef.current.onComplete?.(totalMistakes)
        },
      })
    }

    startQuizRef.current = startQuiz
    demonstrateRef.current = async () => {
      const currentWriter = writerRef.current
      if (!guided || !currentWriter || demonstrationRunning || isDisposed) return
      demonstrationRunning = true
      setIsDemonstrating(true)
      callbacksRef.current.onProgress?.({ state: 'demonstrating' })
      try {
        await demonstrateStrokeOrder(currentWriter, { isActive: () => !isDisposed, restartQuiz: startQuiz })
      } catch {
        if (!isDisposed) startQuiz()
      } finally {
        demonstrationRunning = false
        if (!isDisposed) setIsDemonstrating(false)
      }
    }
    const bounds = quizTarget.getBoundingClientRect()
    const writer = HanziWriter.create(quizTarget, character, {
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      padding: 18,
      ...palette,
      strokeColor: palette.drawingColor,
      showCharacter: false,
      showOutline: guided,
      strokeAnimationSpeed: 0.7,
      delayBetweenStrokes: 280,
      charDataLoader: (requestedCharacter, onLoad, onError) => {
        // Local API keeps the trainer usable without access to foreign CDNs.
        fetch(`/api/hanzi/${encodeURIComponent(requestedCharacter)}`, { signal: AbortSignal.timeout(12000) })
          .then((response) => {
            if (!response.ok) throw new Error('Character data unavailable')
            return response.json()
          })
          .then(onLoad, onError)
      },
      onLoadCharDataSuccess: () => {
        window.clearTimeout(loadTimeout)
        if (isDisposed || hasLoadFailed) return
        writerRef.current = writer
        setLoadedCharacter(character)
        startQuiz()
      },
      onLoadCharDataError: () => {
        window.clearTimeout(loadTimeout)
        failLoading()
      },
    })

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      writer.updateDimensions({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), padding: 18 })
    })
    resizeObserver.observe(quizTarget)

    const themeObserver = new MutationObserver(() => {
      const nextPalette = getQuizPalette()
      writer.updateColor('drawingColor', nextPalette.drawingColor)
      writer.updateColor('strokeColor', nextPalette.drawingColor)
      writer.updateColor('outlineColor', nextPalette.outlineColor)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      isDisposed = true
      window.clearTimeout(loadTimeout)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      writer.cancelQuiz()
      // Cancel pending main-character animation before discarding its SVG.
      if (writerRef.current === writer) void writer.hideCharacter({ duration: 0 }).catch(() => {})
      writerRef.current = null
      startQuizRef.current = null
      demonstrateRef.current = null
      quizTarget.replaceChildren()
    }
  }, [character, guided])

  return (
    <div className="hanzi-quiz-wrap">
      <div ref={quizTargetRef} className={`hanzi-quiz-canvas ${isDemonstrating ? 'is-demonstrating' : ''}`} aria-busy={isDemonstrating} aria-label={guided ? 'Поле с образцом для изучения порядка черт' : 'Поле для написания иероглифа по памяти'} />
      {guided && (
        <button className="writing-secondary-action" type="button" disabled={!isReady || isComplete || isDemonstrating} onClick={() => demonstrateRef.current?.()}>
          {isDemonstrating ? 'Показываем порядок черт…' : 'Показать порядок черт'}
        </button>
      )}
      <button className="writing-secondary-action" type="button" disabled={!isReady || isDemonstrating} onClick={() => startQuizRef.current?.()}>
        Начать заново
      </button>
    </div>
  )
}
