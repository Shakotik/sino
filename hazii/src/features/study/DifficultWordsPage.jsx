import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { studyLevels } from '../../data/studyDemo.js'
import { loadHskCatalog } from '../../data/hskCatalogs.js'
import { readDifficultWords, SKILL_NAMES } from './learningInsights.js'
import { ReadableText } from '../../components/ReadableText.jsx'

export function DifficultWordsPage() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all(studyLevels.map(async (level) => {
      const difficult = readDifficultWords(level.id)
      if (!difficult.length) return []
      const { words } = await loadHskCatalog(level.id)
      return difficult.map((record) => ({ ...record, level, word: words.find((word) => word.id === record.wordId) })).filter((record) => record.word)
    })).then((rows) => { if (active) setItems(rows.flat()) }, () => { if (active) setError('Не удалось загрузить слова. Обновите страницу.') })
    return () => { active = false }
  }, [])
  return <main className="personal-shell"><Link className="back-button" to="/">← Сегодня</Link>
    <header className="personal-header"><h1>Мои трудности</h1><p>Слова, которым полезно уделить немного больше внимания. Успешная самостоятельная проверка уберёт слово из этого списка по соответствующему навыку.</p></header>
    {error && <p role="alert">{error}</p>}{items === null && !error && <p role="status">Собираем слова…</p>}
    {items?.length === 0 && <p>Пока здесь пусто. После упражнений со сложными словами появится персональная подборка.</p>}
    <div className="personal-card-grid">{items?.map(({ word, level, skill, explanation }) => <article className="personal-word" key={`${level.id}:${word.id}:${skill}`}>
      <small>{level.name} · {SKILL_NAMES[skill]}</small><h2 lang="zh"><ReadableText text={word.hanzi} /></h2><p>{word.pinyin}</p><p><ReadableText text={word.translationRu} /></p><p className="personal-muted"><ReadableText text={explanation} /></p>
      <Link className="study-primary-button" to={skill === 'writing' ? `/study/${level.id}/writing?practice=memory&start=1&word=${word.id}&count=1` : `/study/${level.id}/knowledge?mode=${skill}&word=${word.id}&count=1`}>Повторить слово</Link>
    </article>)}</div>
  </main>
}
