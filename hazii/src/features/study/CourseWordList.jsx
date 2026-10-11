import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { loadHskCatalog } from '../../data/hskCatalogs'
import { findStudyLevel } from '../../data/studyDemo'
import { filterStudyWords, readKnownWordIds, setWordKnown } from './studyStorage'
import { usePageNavigation } from './usePageNavigation'

function searchable(value) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replaceAll('ё', 'е') }

export function CourseWordList() {
  const { levelId } = useParams()
  const [params] = useSearchParams()
  const navigate = usePageNavigation()
  const [words, setWords] = useState(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(params.get('filter') || 'all')
  const [page, setPage] = useState(0)
  const [known, setKnown] = useState(() => readKnownWordIds(levelId))
  const level = findStudyLevel(levelId)
  useEffect(() => {
    let active = true
    loadHskCatalog(levelId).then((catalog) => { if (active) setWords(catalog.words) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [levelId])
  const matchingWords = filterStudyWords(words || [], filter, known).filter((word) => searchable(`${word.hanzi} ${word.pinyin} ${word.translationRu || ''}`).includes(searchable(query.trim())))
  const pages = Math.max(1, Math.ceil(matchingWords.length / 30))
  const safePage = Math.min(page, pages - 1)
  return <main className="course-shell">
    <button className="back-button" onClick={() => navigate(`/study/${levelId}`)}>← К разделам {level?.name}</button>
    <header className="course-header"><p className="eyebrow">{level?.name}</p><h1>Список слов</h1><p className="course-subtitle">Иероглифы, пиньинь и значения вашего курса.</p></header>
    {error ? <p role="alert">Не удалось открыть этот курс.</p> : !words ? <p role="status">Загружаем список…</p> : <>
      <label className="study-options">Поиск по списку<input className="word-list-search" value={query} placeholder="Например: 爱, ai или любить" onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></label>
      <div className="word-list-heading"><span className="study-note">Найдено: {matchingWords.length}</span><label className="study-options"><select aria-label="Какие слова показывать" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0) }}><option value="all">Все слова</option><option value="learned">Изученные</option><option value="unlearned">Неизученные</option></select></label></div>
      <section className="course-word-list" aria-label="Слова курса">{matchingWords.slice(safePage * 30, safePage * 30 + 30).map((word) => <article className="course-word-row" key={word.id}>
        <div><strong lang="zh"><ReadableText text={word.hanzi} /></strong><small>{word.pinyin}</small></div><p><ReadableText text={word.translationRu || word.translationEn} /></p>
        <button className={`study-secondary ${known.has(word.id) ? 'is-known' : ''}`} aria-pressed={known.has(word.id)} onClick={() => setKnown(setWordKnown(levelId, word, !known.has(word.id)))}>{known.has(word.id) ? '✓ Изучено' : 'Знаю'}</button>
      </article>)}</section>
      {matchingWords.length === 0 && <p className="study-status">В этой группе нет подходящих слов. Измените поиск или фильтр.</p>}
      <nav className="word-list-pagination" aria-label="Страницы списка"><button className="study-secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>←</button><span>{safePage + 1} / {pages}</span><button className="study-secondary" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>→</button></nav>
    </>}
  </main>
}
import { ReadableText } from '../../components/ReadableText.jsx'
