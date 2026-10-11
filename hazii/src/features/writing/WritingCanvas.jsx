import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeWritingAttempt, renderWritingAttempt } from './writingEngine'

function getCanvasPalette() {
  const pageStyles = window.getComputedStyle(document.documentElement)

  return {
    background: pageStyles.getPropertyValue('--writing-canvas').trim(),
    guide: pageStyles.getPropertyValue('--writing-guide').trim(),
    line: pageStyles.getPropertyValue('--writing-canvas-line').trim(),
    ink: pageStyles.getPropertyValue('--writing-ink').trim(),
  }
}

// The canvas stores pointer movements as normalized coordinates. That makes a
// handwritten attempt survive phone rotation, responsive resizing and theme changes.
export function WritingCanvas({ onAttemptChange }) {
  const canvasRef = useRef(null)
  const isDrawingRef = useRef(false)
  const strokesRef = useRef([])
  const [strokeCount, setStrokeCount] = useState(0)

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const bounds = canvas.getBoundingClientRect()
    const pixelRatio = window.devicePixelRatio || 1
    const context = canvas.getContext('2d')

    canvas.width = Math.round(bounds.width * pixelRatio)
    canvas.height = Math.round(bounds.height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

    renderWritingAttempt(context, bounds.width, bounds.height, getCanvasPalette(), strokesRef.current)
  }, [])

  const publishAttemptState = useCallback(() => {
    onAttemptChange(analyzeWritingAttempt(strokesRef.current))
  }, [onAttemptChange])

  useEffect(() => {
    redrawCanvas()
    publishAttemptState()

    const resizeObserver = new ResizeObserver(redrawCanvas)
    resizeObserver.observe(canvasRef.current)

    const themeObserver = new MutationObserver(redrawCanvas)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
    }
  }, [publishAttemptState, redrawCanvas])

  function pointFromEvent(event) {
    const bounds = event.currentTarget.getBoundingClientRect()

    return {
      x: Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1),
      y: Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1),
      pressure: event.pressure || 0.5,
    }
  }

  function startDrawing(event) {
    event.preventDefault()

    const canvas = event.currentTarget
    isDrawingRef.current = true
    strokesRef.current = [...strokesRef.current, [pointFromEvent(event)]]
    setStrokeCount(strokesRef.current.length)
    canvas.setPointerCapture(event.pointerId)

    redrawCanvas()
    publishAttemptState()
  }

  function continueDrawing(event) {
    if (!isDrawingRef.current) return

    const activeStroke = strokesRef.current.at(-1)
    const nextPoint = pointFromEvent(event)
    const previousPoint = activeStroke.at(-1)

    // Ignore duplicate browser pointer events. This keeps the saved attempt
    // compact while preserving the visible brush movement.
    if (Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) < 0.002) return

    activeStroke.push(nextPoint)
    redrawCanvas()
  }

  function stopDrawing(event) {
    if (!isDrawingRef.current) return

    isDrawingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    publishAttemptState()
  }

  function undoLastStroke() {
    strokesRef.current = strokesRef.current.slice(0, -1)
    setStrokeCount(strokesRef.current.length)
    redrawCanvas()
    publishAttemptState()
  }

  function clearCanvas() {
    strokesRef.current = []
    setStrokeCount(0)
    redrawCanvas()
    publishAttemptState()
  }

  const hasStrokes = strokeCount > 0

  return (
    <div className="writing-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="writing-canvas"
        aria-label="Чистое поле для написания иероглифа"
        onPointerDown={startDrawing}
        onPointerMove={continueDrawing}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
      <div className="writing-canvas-actions">
        <button className="writing-secondary-action" type="button" disabled={!hasStrokes} onClick={undoLastStroke}>
          Отменить штрих
        </button>
        <button className="writing-clear-button" type="button" disabled={!hasStrokes} onClick={clearCanvas}>
          Очистить поле
        </button>
      </div>
    </div>
  )
}
