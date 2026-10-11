import { useEffect, useState } from 'react'
import { ReadableText } from '../../components/ReadableText.jsx'
import { useParams, useSearchParams } from 'react-router-dom'
import { loadHskCatalog } from '../../data/hskCatalogs'
import { findStudyLevel } from '../../data/studyDemo'
import { readKnownWordIds, setWordKnown, filterStudyWords } from './studyStorage'
import { StudyDialog } from '../../components/StudyDialog'
import { usePageNavigation } from './usePageNavigation'

export function HskCourseCards() {
  const { levelId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = usePageNavigation()
  const level = findStudyLevel(levelId)
  const [catalog, setCatalog] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [cardIndex, setCardIndex] = useState(0)
  const [isCardFlipped, setIsCardFlipped] = useState(false)
  const [passedWordIds, setPassedWordIds] = useState(new Set())
  const [sessionWords, setSessionWords] = useState([])
  const selectedFilter = searchParams.get('filter')
  const reviewQuery = searchParams.get('review')
  const needsSelection = !['all', 'learned', 'unlearned'].includes(selectedFilter) && !reviewQuery

  useEffect(() => {
    let isCurrentCourse = true

    loadHskCatalog(levelId)
      .then((nextCatalog) => {
        if (!isCurrentCourse) return

        const knownIds = readKnownWordIds(levelId)
        const allowedIds = new Set(nextCatalog.words.map((word) => word.id))
        const validKnownIds = new Set([...knownIds].filter((id) => allowedIds.has(id)))
        const reviewIds = new Set((reviewQuery || '').split(',').filter(Boolean).map(Number))
        setCatalog(nextCatalog)
        setPassedWordIds(validKnownIds)
        // Freeze the selection for this pass; grading must not move the next
        // card's index by removing the current word from a live filter.
        setSessionWords(reviewQuery ? nextCatalog.words.filter((word) => reviewIds.has(word.id)) : filterStudyWords(nextCatalog.words, selectedFilter, validKnownIds))
        setCardIndex(0)
        setIsCardFlipped(false)
        setLoadError(false)
      })
      .catch(() => {
        if (isCurrentCourse) setLoadError(true)
      })

    return () => {
      isCurrentCourse = false
    }
  }, [levelId, selectedFilter, reviewQuery])

  if (!level || loadError) {
    return (
      <main className="cards-shell">
        <button className="back-button" type="button" onClick={() => navigate('/')}>
          ← Все уровни
        </button>
        <p className="course-selection">Не удалось открыть карточки этого курса.</p>
      </main>
    )
  }

  if (!catalog) {
    return (
      <main className="cards-shell">
        <button className="back-button" type="button" onClick={() => navigate(`/study/${level.id}`)}>
          ← К разделам {level.name}
        </button>
        <p className="course-selection">Загружаем слова {level.name}…</p>
      </main>
    )
  }

  const { meta } = catalog
  const isReviewSession = Boolean(reviewQuery)
  if (needsSelection) return <main className="cards-shell"><StudyDialog title="Какие карточки открыть?" onClose={() => navigate(`/study/${levelId}`)}><div className="card-filter-options">{[['learned', 'Изученные слова'], ['unlearned', 'Неизученные слова'], ['all', 'Все слова']].map(([filter, title]) => <button className="card-filter-option" key={filter} onClick={() => setSearchParams({ filter })}>{title}</button>)}</div></StudyDialog></main>
  if (!sessionWords.length) return <main className="cards-shell"><button className="back-button" onClick={() => navigate(`/study/${levelId}`)}>← К разделам {level.name}</button><h1>В этой группе пока нет слов</h1><p>Выберите другую группу или начните изучение курса.</p><button className="study-primary" onClick={() => setSearchParams({ filter: 'all' })}>Открыть все слова</button></main>
  const sessionTotal = sessionWords.length
  const activeWord = sessionWords[cardIndex]
  const activeTranslation = activeWord.translationRu ?? activeWord.translationEn
  const translationLabel = activeWord.translationRu ? 'Перевод' : 'Значение (англ.)'
  const passedCount = passedWordIds.size
  const notPassedCount = meta.totalWords - passedCount
  const cardProgress = ((cardIndex + 1) / sessionTotal) * 100

  function moveToCard(nextIndex) {
    const lastIndex = sessionTotal - 1
    const safeIndex = Math.min(Math.max(nextIndex, 0), lastIndex)

    setCardIndex(safeIndex)
    setIsCardFlipped(false)
  }

  function markCurrentWordAsKnown() {
    setPassedWordIds(setWordKnown(levelId, activeWord, true))
    moveToCard(cardIndex + 1)
  }

  function markCurrentWordForReview() {
    setPassedWordIds(setWordKnown(levelId, activeWord, false))
    moveToCard(cardIndex + 1)
  }

  return (
    <main className="cards-shell">
      <button className="back-button" type="button" onClick={() => navigate(`/study/${level.id}`)}>
        ← К разделам {level.name}
      </button>

      <header className="cards-header">
        <p className="eyebrow">Курс {level.name} · Карточки слов</p>
        <h1>Тренажёр словарного запаса</h1>
        <p>
          {isReviewSession
            ? `Повторение дня: ${sessionTotal} слов.`
            : 'Запоминайте слово, открывайте перевод и отмечайте, удалось ли его вспомнить.'}
        </p>
      </header>

      <section className="cards-summary" aria-label={`Статистика карточек ${level.name}`}>
        <div className="cards-summary-item is-passed">
          <strong>{passedCount}</strong>
          <span>пройдено слов</span>
        </div>
        <div className="cards-summary-item is-not-passed">
          <strong>{notPassedCount}</strong>
          <span>ещё не пройдено</span>
        </div>
        <div className="cards-summary-item is-total">
          <strong>{meta.totalWords}</strong>
          <span>слов всего</span>
        </div>
      </section>

      <section className="card-session" aria-label="Карточка для изучения">
        <div className="card-position">
          <span>Карточка {cardIndex + 1} из {sessionTotal}</span>
          <span>{Math.round(cardProgress)}%</span>
        </div>
        <div className="card-progress-track" aria-hidden="true">
          <span className="card-progress-value" style={{ width: `${cardProgress}%` }} />
        </div>

        <button
          className={`vocabulary-card ${isCardFlipped ? 'is-flipped' : ''}`}
          type="button"
          aria-pressed={isCardFlipped}
          aria-label={isCardFlipped
            ? `${translationLabel} слова ${activeWord.hanzi}: ${activeTranslation}. Нажмите, чтобы вернуться к китайскому слову.`
            : `Китайское слово ${activeWord.hanzi}, ${activeWord.pinyin}. Нажмите, чтобы увидеть перевод.`}
          onClick={() => setIsCardFlipped(!isCardFlipped)}
        >
          <span className="vocabulary-card-inner" aria-hidden="true">
            <span className="vocabulary-card-face vocabulary-card-front">
              <span className="vocabulary-card-label">Китайское слово</span>
              <span className="vocabulary-hanzi" lang="zh"><ReadableText text={activeWord.hanzi} /></span>
              <span className="vocabulary-pinyin">{activeWord.pinyin}</span>
              <span className="vocabulary-card-hint">Нажмите, чтобы перевернуть</span>
            </span>

            <span className="vocabulary-card-face vocabulary-card-back">
              <span className="vocabulary-card-label">{translationLabel}</span>
              <strong className="vocabulary-translation"><ReadableText text={activeTranslation} /></strong>
              <span className="vocabulary-card-hint">Нажмите, чтобы вернуться</span>
            </span>
          </span>
        </button>

        <div className="card-actions" aria-label="Оценка знания слова">
          <button className="card-action-button is-review" type="button" onClick={markCurrentWordForReview}>
            Повторить
          </button>
          <button className="card-action-button is-known" type="button" onClick={markCurrentWordAsKnown}>
            Знаю
          </button>
        </div>

        <div className="card-navigation" aria-label="Навигация по карточкам">
          <button
            type="button"
            onClick={() => moveToCard(cardIndex - 1)}
            disabled={cardIndex === 0}
          >
            ← Предыдущая
          </button>
          <button
            type="button"
            onClick={() => moveToCard(cardIndex + 1)}
            disabled={cardIndex === sessionTotal - 1}
          >
            Следующая →
          </button>
        </div>
      </section>

      <p className="cards-note">
        {activeWord.translationRu
          ? 'Сейчас прогресс сохраняется только в этом браузере. После появления аккаунтов он будет храниться в базе данных пользователя.'
          : 'Сейчас в этом наборе показано английское учебное значение. Русские переводы добавим после проверки преподавателем.'}
      </p>
    </main>
  )
}
