import { useState } from 'react'
import { readProfileValue, writeProfileValue } from './profileStorage.js'

export function LearningPreferences() {
  const [pandaMode, setPandaMode] = useState(() => readProfileValue('panda-mode', 'auto'))
  return <section className="personal-summary"><h2>Спокойный интерфейс</h2>
    <label className="learning-preference">Советы панды<select value={pandaMode} onChange={(event) => {
      setPandaMode(event.target.value); writeProfileValue('panda-mode', event.target.value)
    }}><option value="auto">Показывать автоматически</option><option value="after-session">Только после занятия</option><option value="manual">Только по нажатию</option><option value="hidden">Скрыть панду</option></select></label>
    <p className="personal-muted">Во время упражнений навигация и панда скрыты. Кнопка выхода из занятия всегда остаётся доступной.</p>
  </section>
}
