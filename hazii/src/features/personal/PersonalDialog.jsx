import { useCallback, useEffect, useId, useRef, useState } from 'react'

// A native dialog supplies focus trapping, Escape and a real modal backdrop.
// It remains mounted during its exit animation before returning focus.
export function PersonalDialog({ title, onClose, children }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  const [isClosing, setIsClosing] = useState(false)
  const titleId = useId()
  const closeDialog = useCallback(() => setIsClosing(true), [])

  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!isClosing) return undefined
    const timer = window.setTimeout(() => closeRef.current(), 280)
    return () => window.clearTimeout(timer)
  }, [isClosing])

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={`personal-dialog ${isClosing ? 'is-closing' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); closeDialog() }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
    >
      <div className="personal-dialog-content">
        <header className="personal-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="personal-icon-button" aria-label="Закрыть окно" onClick={closeDialog}>×</button>
        </header>
        {typeof children === 'function' ? children(closeDialog) : children}
      </div>
    </dialog>
  )
}
