import { useState } from 'react'
import { studyLevels } from '../../data/studyDemo'
import { usePageNavigation } from '../study/usePageNavigation'

export function WritingHome() {
  const navigate = usePageNavigation()
  const [selectedLevelId, setSelectedLevelId] = useState('hsk-1')

  function openWritingLevel(level) {
    setSelectedLevelId(level.id)
    navigate(`/writing/${level.id}`)
  }

  return (
    <main className="writing-home-shell">
      <button className="back-button" type="button" onClick={() => navigate('/')}>
        ← К учёбе
      </button>

      <header className="writing-home-header">
        <p className="eyebrow">Прописи</p>
        <h1>Пишите иероглифы по памяти.</h1>
        <p>
          Выберите уровень. Внутри тренировки есть чистое поле с сеткой, а ответ
          не показывается — ни до, ни во время письма.
        </p>
      </header>

      <section aria-labelledby="writing-levels-title">
        <div className="section-heading">
          <div>
            <h2 id="writing-levels-title">Выберите HSK</h2>
            <p>Слова берутся из тех же каталогов, что и карточки.</p>
          </div>
        </div>

        <div className="levels writing-levels">
          {studyLevels.map((level) => (
            <button
              key={level.id}
              className={`level-card writing-level-card ${selectedLevelId === level.id ? 'is-selected' : ''}`}
              type="button"
              onClick={() => openWritingLevel(level)}
            >
              <span className="level-meta">
                <strong>{level.name}</strong>
                <span className={`label ${level.status === 'free' ? 'free' : 'available'}`}>
                  {level.totalWords} слов
                </span>
              </span>
              <h3>{level.title}</h3>
              <p>{level.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="writing-principle" aria-label="Как работает тренажёр прописей">
        <h2>Как работает тренажёр</h2>
        <ol>
          <li>Видны чтение и значение слова, но не китайское написание.</li>
          <li>Каждый штрих записывается отдельно: можно отменить последний или очистить клетку.</li>
          <li>В слове из нескольких иероглифов пишется один знак за раз, а затем открывается новая чистая клетка.</li>
        </ol>
      </section>
    </main>
  )
}
