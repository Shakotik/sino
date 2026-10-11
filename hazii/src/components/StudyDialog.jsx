import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Native dialog provides focus containment and makes the page behind it inert.
// Keep it mounted during the exit transition and restore focus on close.
export function StudyDialog({ title, onClose, children }) {
  const dialogRef = useRef(null)
  const closeTimer = useRef(null)
  const titleId = useId()
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    dialog.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(closeTimer.current)
      dialog.close()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  function close() {
    if (closing) return
    setClosing(true)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = setTimeout(onClose, reducedMotion ? 0 : 320)
  }

  return createPortal(
    <dialog ref={dialogRef} className={`study-dialog ${closing ? 'is-closing' : ''}`}
      aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
      }}>
      <div className="study-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={close} aria-label="Закрыть окно">×</button></div>
      {children}
    </dialog>, document.body,
  )
}
