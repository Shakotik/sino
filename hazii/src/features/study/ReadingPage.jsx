import { Link, useParams } from 'react-router-dom'
import { readingTexts } from '../../data/readingTexts.js'
import { DictionaryPage } from '../dictionary/DictionaryPage.jsx'

export function ReadingPage({ user }) {
  const { textId } = useParams()
  const reading = readingTexts.find((text) => text.id === textId)
  if (reading) return <DictionaryPage key={reading.id} user={user} reading={reading} />
  return <main className="personal-shell"><Link to="/" className="back-button">← Сегодня</Link>
    <header className="personal-header"><h1>Чтение</h1><p>Небольшие истории для практики. Разберите текст на слова, откройте значение и сохраните нужное слово вместе с контекстом.</p></header>
    <div className="personal-card-grid">{readingTexts.map((text) => <Link key={text.id} className="personal-word reading-story" to={`/texts/${text.id}`}>
      <small>{text.level} · {text.text.match(/\p{Script=Han}/gu).length} иероглифов</small><h2>{text.title}</h2><p lang="zh">{text.text.slice(0, 36)}…</p><span>Читать →</span>
    </Link>)}</div>
  </main>
}
