import { useEffect, useId, useState } from 'react'
import pandaLotus from '../assets/mascots/sino-panda-lotus-v3.png'
import { pandaWisdoms } from '../data/pandaWisdoms.js'
import { ReadableText } from './ReadableText.jsx'
import './MunchingPanda.css'
import { readProfileValue, writeProfileValue } from '../features/profile/profileStorage.js'

const REST_DURATION = 9000
const TALKING_DURATION = 10000
const DIALOG_CLOSE_DURATION = 850

// The panda is deliberately calm: it stays in one place and only has a slow
// breathing motion. React is responsible for the unhurried advice cycle.
export function MunchingPanda() {
  const [mode] = useState(() => readProfileValue('panda-mode', 'auto'))
  const [tipIndex, setTipIndex] = useState(0)
  const [tipVisibility, setTipVisibility] = useState(() => readProfileValue('panda-mode', 'auto') === 'after-session'
    && readProfileValue('last-session-completed', 0) > readProfileValue('panda-last-celebrated', 0) ? 'open' : 'closed')
  const tipId = useId()
  const tip = pandaWisdoms[tipIndex]
  const isTalking = tipVisibility === 'open'
  const isTipVisible = tipVisibility !== 'closed'

  // Automatic and manual dismissals share one closing state. The bubble stays
  // mounted until its exit animation finishes, and each state owns one timer.
  useEffect(() => {
    if (mode === 'hidden' || (mode !== 'auto' && tipVisibility === 'closed')) return undefined
    if (mode === 'after-session' && tipVisibility === 'open') writeProfileValue('panda-last-celebrated', Date.now())
    const duration = tipVisibility === 'closed'
      ? REST_DURATION
      : tipVisibility === 'open' ? TALKING_DURATION : DIALOG_CLOSE_DURATION
    const timerId = window.setTimeout(() => {
      if (tipVisibility === 'closed') {
        setTipVisibility('open')
      } else if (tipVisibility === 'closing') {
        // Change the thought only after the bubble has completely faded out.
        setTipIndex((currentIndex) => (currentIndex + 1) % pandaWisdoms.length)
        setTipVisibility('closed')
      } else {
        setTipVisibility('closing')
      }
    }, duration)

    return () => window.clearTimeout(timerId)
  }, [tipVisibility, mode])

  function closeTip() {
    if (tipVisibility !== 'open') return
    setTipVisibility('closing')
  }

  function toggleTip() {
    setTipVisibility((visibility) => visibility === 'open' ? 'closing' : 'open')
  }

  if (mode === 'hidden') return null
  return (
    <aside className={`panda-companion panda-companion--aligned ${isTalking ? 'is-talking' : ''}`} aria-label="Панда Sino">
      <div className="panda-companion-layout">
        <div className="panda-companion-character">
          <div className="panda-lotus-stage">
            <span className="panda-ground-shadow" aria-hidden="true" />
            <img
              className="panda-lotus"
              src={pandaLotus}
              alt={isTalking ? 'Панда в позе лотоса спокойно делится мыслью' : 'Панда в позе лотоса отдыхает'}
            />
          </div>
          <button className="panda-tip-button" type="button" aria-controls={tipId} aria-expanded={tipVisibility === 'open'} onClick={toggleTip}>
            {tipVisibility === 'open' ? 'Скрыть мудрость' : 'Показать мудрость'} <span aria-hidden="true">{tipVisibility === 'open' ? '×' : '↑'}</span>
          </button>
        </div>
        <div className="panda-tip-slot">
            <div id={tipId} className={`panda-tip is-${tipVisibility}`} aria-live="polite" aria-hidden={!isTipVisible || tipVisibility === 'closing'} inert={tipVisibility !== 'open'}>
              <button className="panda-tip-close" type="button" aria-label="Закрыть мудрость панды" disabled={tipVisibility !== 'open'} onClick={closeTip}>
                ×
              </button>
              <p>{tip.tradition === 'confucian' ? 'Конфуцианство' : 'Буддизм'}</p>
              <strong><ReadableText text={tip.text} /></strong>
            </div>
        </div>
      </div>
    </aside>
  )
}
